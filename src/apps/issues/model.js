// The Issues app's state, one rrx-core graph: the issues in a store, the
// grouped view as a mirror of it, board moves as optimistic layers over
// the store, edits with an undo history, the search in the low lane, the
// activity of the open issue as a task, and the preferences in the root's
// Storage. The views only read it and call its actions.

import {
  $context, $signal, $read, $write, $memo, $scan, $equals, $untrack, $batch, $defer, $watch, $cleanup, $owner,
  $store, $at, $put, $raw, $update, $mirror, $overlay, $reuse, $task, $optimistic, $act, $select,
} from 'rrx-core';
import { generate, matches, rank, STATUSES, PRIORITIES, PEOPLE, EPOCH } from './data.js';
import { server } from './server.js';

/**
 * @typedef {import('./data.js').Issue} Issue
 * @typedef {import('./data.js').Status} Status
 * @typedef {import('./server.js').Entry & { draft?: boolean }} Entry
 * @typedef {'list' | 'board' | 'insights'} Mode
 * @typedef {'status' | 'priority' | 'assignee' | 'none'} Grouping
 * @typedef {{ assignee: string[], priority: string[], label: string[] }} Filters
 * @typedef {{ id: string, field: keyof Issue, before: any, after: any }} Change
 * @typedef {{ label: string, changes: Change[] }} Edit
 * @typedef {{ past: Edit[], future: Edit[] }} History
 * @typedef {{ type: 'do', edit: Edit } | { type: 'undo' } | { type: 'redo' }} Command
 * @typedef {{ id: number, text: string, tone: 'info' | 'danger' }} Toast
 * @typedef {{ keys: string[], groups: Record<string, string[]>, columns: Record<string, string[]>, shown: number, total: number }} Grouped
 */

/** Rows a group shows before "Show all". */
export const PAGE = 50;
/** Cards a board column shows before "Show more". */
export const CARDS = 40;
/** The search service's latency, in milliseconds. */
export const SEARCH_MS = 120;
/** How long a toast stays. */
export const TOAST_MS = 4000;
/** The Storage key of the preferences. */
export const PREFS = 'issues-prefs';

/** The keys of a grouping, in display order. @param {Grouping} by @returns {string[]} */
export const groupKeys = by =>
  by === 'status' ? STATUSES.map(s => s.id)
  : by === 'priority' ? PRIORITIES.map(p => String(p.id))
  : by === 'assignee' ? [...PEOPLE.map(p => p.id), 'none']
  : ['all'];

/** The group an issue falls in. @param {Issue} issue @param {Grouping} by */
const groupOf = (issue, by) => (by === 'status' ? issue.status : by === 'priority' ? String(issue.priority) : by === 'assignee' ? (issue.assignee ?? 'none') : 'all');

/** Priority first, then newest. @param {Issue} a @param {Issue} b */
const order = (a, b) => rank(a.priority) - rank(b.priority) || b.number - a.number;

/** @param {string | null | undefined} text @returns {any} */
const parse = text => {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
};

/**
 * The tracker: state and actions of one Issues app.
 * @param {import('rrx-core').Graph} R
 * @param {import('../../assets.js').Environment} env
 * @param {import('ren-core').Shelf | null} shelf
 * @param {number} [count]
 */
export function tracker(R, env, shelf, count = 2000) {
  // Every timer this app starts ends with it: nothing fires into a closed root.
  /** @type {Set<() => void>} */
  const live = new Set();
  /** @type {import('../../assets.js').Environment} */
  const clock = {
    ...env,
    later: (ms, fn) => {
      const cancel = env.later(ms, () => { // timer: feature, the clock the app's delays run on (cancelled when it closes)
        live.delete(cancel);
        fn();
      });
      live.add(cancel);
      return () => {
        live.delete(cancel);
        cancel();
      };
    },
  };
  const owner = $owner(R);
  if (owner !== null)
    $cleanup(owner, () => {
      for (const cancel of live) cancel();
      live.clear();
    });
  const api = server(clock, count);
  const stamp = () => EPOCH + Math.round(env.now());

  // The issues, by id: a read of ['issues', id, field] tracks that one field.
  const store = $store(R, { issues: /** @type {Record<string, Issue>} */ (Object.fromEntries(generate(count).map(i => [i.id, i]))) });
  // Moves in flight, layered over the store until the server answers.
  const overlay = $overlay(R, store);
  // The issues as shown, layers applied: computed once per change, not per reader.
  const shown = $memo(R, () => /** @type {Record<string, Issue>} */ (overlay.read(['issues'])));
  /**
   * One field as shown: a read of its own store path, or of the layered
   * issues while a move is in flight.
   * @param {string} id @param {keyof Issue} key @returns {any}
   */
  const field = (id, key) => ($read(overlay.pending) ? $read(shown)[id]?.[key] : $at(store, ['issues', id, key]));

  // Preferences, kept in the root's Storage.
  // Read once, as the app starts.
  const kept = parse($untrack(R, () => shelf?.get(PREFS)));
  const mode = $signal(R, /** @type {Mode} */ (['list', 'board', 'insights'].includes(kept.mode) ? kept.mode : 'list'));
  const grouping = $signal(R, /** @type {Grouping} */ (['status', 'priority', 'assignee', 'none'].includes(kept.grouping) ? kept.grouping : 'status'));
  const filters = $signal(R, /** @type {Filters} */ ({ assignee: [], priority: [], label: [], ...(kept.filters ?? {}) }));
  const collapsed = $signal(R, /** @type {string[]} */ (Array.isArray(kept.collapsed) ? kept.collapsed : ['shipped', 'dropped']));
  $watch(R, () => JSON.stringify({ mode: $read(mode), grouping: $read(grouping), filters: $read(filters), collapsed: $read(collapsed) }), text => shelf?.set(PREFS, text));

  // The search: the field updates at once; the query reaches the search
  // service in the low lane, and its answer is a task, so the list keeps the
  // previous results (a transition) while `$pending(hits)` shows the wait.
  const query = $signal(R, '');
  const term = $signal(R, '');
  /** @param {string} text */
  const search = text => {
    $write(query, text);
    $defer(R, () => $write(term, text.trim()));
  };
  const hits = $task(R, () => $read(term), (/** @type {string} */ q, complete) => {
    if (q === '') return void complete({ ok: true, value: /** @type {Set<string> | null} */ (null) });
    return clock.later(SEARCH_MS, () => { // timer: feature, the search's simulated latency
      const all = Object.values($raw(store).issues);
      complete({ ok: true, value: new Set(all.filter(i => matches(q, i)).map(i => i.id)) });
    });
  });

  /** Whether an issue passes the filter chips. @param {Issue} i @param {Filters} f */
  const passes = (i, f) =>
    (f.assignee.length === 0 || f.assignee.includes(i.assignee ?? 'none')) &&
    (f.priority.length === 0 || f.priority.includes(String(i.priority))) &&
    (f.label.length === 0 || i.labels.some(l => f.label.includes(l)));

  // The grouped view: a mirror, so a write that moves nothing (a title
  // edit) notifies no group, and a move notifies only its two groups.
  const view = /** @type {import('rrx-core').StoreOf<Grouped>} */ ($mirror(R, () => {
    const issues = $read(shown);
    const hit = /** @type {Set<string> | null} */ ($read(hits));
    const f = $read(filters);
    const by = $read(grouping);
    /** @type {Record<string, Issue[]>} */
    const groups = Object.fromEntries(groupKeys(by).map(k => [k, []]));
    /** @type {Record<string, Issue[]>} */
    const columns = Object.fromEntries(STATUSES.map(s => [s.id, []]));
    let passing = 0;
    for (const id in issues) {
      const i = issues[id];
      if ((hit !== null && !hit.has(id)) || !passes(i, f)) continue;
      groups[groupOf(i, by)].push(i);
      columns[i.status].push(i);
      passing++;
    }
    /** @param {Record<string, Issue[]>} map */
    const ids = map => Object.fromEntries(Object.entries(map).map(([k, list]) => [k, list.sort(order).map(i => i.id)]));
    const grouped = ids(groups);
    return { keys: Object.keys(grouped).filter(k => grouped[k].length > 0), groups: grouped, columns: ids(columns), shown: passing, total: Object.keys(issues).length };
  }));
  /** @param {string} key @returns {string[]} */
  const group = key => $at(view, ['groups', key]) ?? [];

  // The rows on screen, in order: j and k walk them.
  const limits = $signal(R, /** @type {Record<string, number>} */ ({}));
  const visible = $memo(R, () => {
    const closed = $read(collapsed);
    const limit = $read(limits);
    /** @type {string[]} */
    const out = [];
    for (const key of /** @type {string[]} */ ($at(view, ['keys']))) if (!closed.includes(key)) out.push(...group(key).slice(0, limit[key] ?? PAGE));
    return out;
  });
  /** @param {string} key */
  const toggleGroup = key => $write(collapsed, $read(collapsed).includes(key) ? $read(collapsed).filter(k => k !== key) : [...$read(collapsed), key]);
  /** @param {string} key @param {number} n */
  const showMore = (key, n) => $write(limits, { ...$read(limits), [key]: n });

  // Focus (one row: $select reruns two rows per move), the checked rows and the open issue.
  const focused = $signal(R, /** @type {string | null} */ (null));
  const isFocused = $select(R, () => $read(focused));
  const opened = $signal(R, /** @type {string | null} */ (null));
  const isOpen = $select(R, () => $read(opened));
  const checked = $store(R, /** @type {Record<string, boolean>} */ ({}));
  const selection = $memo(R, () => Object.entries(/** @type {Record<string, boolean>} */ ($at(checked, []))).filter(([, on]) => on).map(([id]) => id));
  /** @param {number} step */
  const walk = step => {
    const list = $read(visible);
    if (list.length === 0) return;
    const at = list.indexOf(/** @type {string} */ ($read(focused)));
    const next = list[at < 0 ? 0 : Math.max(0, Math.min(list.length - 1, at + step))];
    $write(focused, next);
    if ($read(opened) !== null) $write(opened, next);
  };
  /** @param {string} id */
  const toggleCheck = id => $put(checked, [id], (/** @type {boolean | undefined} */ on) => !on);
  /** @param {string | null} id */
  const open = id => {
    $write(opened, id);
    if (id !== null) $write(focused, id);
  };

  // Toasts.
  const toasts = $signal(R, /** @type {Toast[]} */ ([]));
  let toasted = 0;
  /** @param {number} id */
  const dismiss = id => $write(toasts, $untrack(R, () => $read(toasts)).filter(t => t.id !== id));
  /** @param {string} text @param {Toast['tone']} [tone] */
  const toast = (text, tone = 'info') => {
    const made = { id: ++toasted, text, tone };
    $write(toasts, [...$untrack(R, () => $read(toasts)), made].slice(-4));
    clock.later(TOAST_MS, () => $batch(R, () => dismiss(made.id))); // timer: feature, a toast's hold
  };

  // Edits with an undo history: the history is a scan over the commands.
  const command = $equals($signal(R, /** @type {Command | null} */ (null)), false);
  const history = $scan(R, /** @type {History} */ ({ past: [], future: [] }), h => {
    const c = $read(command);
    if (c === null) return h;
    if (c.type === 'do') return { past: [...h.past, c.edit].slice(-100), future: [] };
    if (c.type === 'undo') return h.past.length === 0 ? h : { past: h.past.slice(0, -1), future: [/** @type {Edit} */ (h.past.at(-1)), ...h.future] };
    return h.future.length === 0 ? h : { past: [...h.past, h.future[0]], future: h.future.slice(1) };
  });
  /** Writes a command and folds it at once, so none is skipped. @param {Command} c */
  const record = c => {
    $write(command, c);
    $untrack(R, () => $read(history));
  };
  /** @param {Change[]} changes @param {'before' | 'after'} side */
  const apply = (changes, side) =>
    $batch(R, () => {
      const at = stamp();
      for (const c of changes) {
        $update(store, ['issues', c.id], { [c.field]: c[side], updated: at });
        api.save(c.id, { [c.field]: c[side], updated: at });
      }
    });
  /**
   * Edits fields of issues, as one undoable step.
   * @param {string} label @param {{ id: string, field: keyof Issue, value: any }[]} wanted
   */
  const edit = (label, wanted) => {
    const issues = $raw(store).issues;
    const changes = wanted.filter(w => issues[w.id] !== undefined && !Object.is(issues[w.id][w.field], w.value)).map(w => ({ id: w.id, field: w.field, before: issues[w.id][w.field], after: w.value }));
    if (changes.length === 0) return;
    apply(changes, 'after');
    record({ type: 'do', edit: { label, changes } });
  };
  const undo = () => {
    const edit = $untrack(R, () => $read(history)).past.at(-1);
    if (edit === undefined) return;
    apply(edit.changes, 'before');
    record({ type: 'undo' });
    toast(`Undid: ${edit.label}`);
  };
  const redo = () => {
    const edit = $untrack(R, () => $read(history)).future[0];
    if (edit === undefined) return;
    apply(edit.changes, 'after');
    record({ type: 'redo' });
    toast(`Redid: ${edit.label}`);
  };

  // Board moves: optimistic, one overlay layer at the issue's path, committed
  // into the store when the server accepts and dropped when it rejects.
  /** @type {(string | number)[]} */
  let path = [];
  const moving = $store(R, /** @type {Record<string, boolean>} */ ({}));
  const moves = $act(
    R,
    {
      apply: update => overlay.apply(path, update),
      settle: overlay.settle,
      commit: overlay.commit,
    },
    (/** @type {Issue} */ issue, /** @type {{ id: string, status: Status, at: number }} */ input) => ({ ...issue, status: input.status, updated: input.at }),
    (input, complete) =>
      api.move(input.id, input.status, result =>
        $batch(R, () => {
          $put(moving, [input.id], false);
          complete(result);
        }),
      ),
    result => {
      if (!result.ok) toast(`${result.error.message}. The move was undone.`, 'danger');
    },
  );
  /** Moves an issue on the board; returns the cancel. @param {string} id @param {Status} status */
  const move = (id, status) => {
    if (field(id, 'status') === status) return () => {};
    path = ['issues', id];
    $put(moving, [id], true);
    return moves({ id, status, at: stamp() });
  };

  // The open issue's activity: a task, so switching issues aborts the request in flight.
  const activity = $task(R, () => $read(opened), (/** @type {string | null} */ id, complete) => (id === null ? complete({ ok: true, value: /** @type {Entry[]} */ ([]) }) : api.activity(id, complete)));
  // Comments posted here: optimistic until the server answers.
  const posted = $signal(R, /** @type {Record<string, Entry[]>} */ ({}));
  const comments = $optimistic(R, posted);
  let drafts = 0;
  const post = $act(
    R,
    comments,
    (current, /** @type {{ id: string, text: string, key: string, at: number }} */ input) => ({ ...current, [input.id]: [...(current[input.id] ?? []), /** @type {Entry} */ ({ id: input.key, kind: 'comment', who: 'you', text: input.text, at: input.at })] }),
    (input, complete) => api.comment(input, complete),
    result => {
      if (!result.ok) toast(`Comment not saved: ${result.error.message}`, 'danger');
    },
  );
  /** @param {string} id @param {string} text */
  const comment = (id, text) => {
    if (text.trim() === '') return;
    post({ id, text: text.trim(), key: `draft-${++drafts}`, at: stamp() });
  };
  /** The open issue's timeline: the server's entries and the comments posted here. */
  const timeline = () => {
    const id = $read(opened);
    const loaded = /** @type {Entry[]} */ ($read(activity));
    if (id === null) return [];
    const confirmed = new Set(($read(posted)[id] ?? []).map(e => e.id));
    const seen = new Set(loaded.map(e => e.id));
    const mine = ($read(comments.value)[id] ?? []).filter(e => !seen.has(e.id)).map(e => (confirmed.has(e.id) ? e : { ...e, draft: true }));
    return [...loaded, ...mine];
  };

  // Sync: a full snapshot from the server; $reuse keeps every unchanged row
  // object, so the store notifies only the rows that changed.
  const syncing = $signal(R, false);
  const sync = () => {
    if ($read(syncing)) return;
    $write(syncing, true);
    api.sync(result =>
      $batch(R, () => {
        $write(syncing, false);
        if (!result.ok) return toast(`Sync failed: ${result.error.message}`, 'danger');
        const old = Object.values($raw(store).issues);
        const known = new Set(old.map(i => i.id));
        const next = $reuse(old, /** @type {Issue[]} */ (result.value), i => i.id);
        const same = new Set(old);
        let changed = 0;
        let added = 0;
        for (const i of next) if (!same.has(i)) known.has(i.id) ? changed++ : added++;
        $put(store, ['issues'], Object.fromEntries(next.map(i => [i.id, i])));
        toast(`Synced: ${changed} updated, ${added} new, ${next.length - changed - added} unchanged`);
      }),
    );
  };

  /** @param {keyof Filters} kind @param {string} value */
  const toggleFilter = (kind, value) => {
    const f = $read(filters);
    $write(filters, { ...f, [kind]: f[kind].includes(value) ? f[kind].filter(v => v !== value) : [...f[kind], value] });
  };
  const clearFilters = () => {
    $write(filters, { assignee: [], priority: [], label: [] });
    search('');
  };

  // Facet counts for the filter menus, over the issues the search leaves.
  const facets = $memo(R, () => {
    const issues = $read(shown);
    /** @type {Record<string, number>} */
    const out = {};
    for (const id in issues) {
      const i = issues[id];
      out[`assignee:${i.assignee ?? 'none'}`] = (out[`assignee:${i.assignee ?? 'none'}`] ?? 0) + 1;
      out[`priority:${i.priority}`] = (out[`priority:${i.priority}`] ?? 0) + 1;
      for (const l of i.labels) out[`label:${l}`] = (out[`label:${l}`] ?? 0) + 1;
    }
    return out;
  });

  const palette = $signal(R, false);
  const layer = $signal(R, /** @type {any} */ (null));
  /** @type {{ search: any }} */
  const refs = { search: null };

  return {
    R, env, api, store, overlay, shown, field, stamp,
    mode, grouping, filters, collapsed, limits, query, hits, search, view, group, visible, facets,
    toggleGroup, showMore, toggleFilter, clearFilters,
    focused, isFocused, opened, isOpen, checked, selection, walk, toggleCheck, open,
    toasts, toast, dismiss,
    history, edit, undo, redo,
    moving, move,
    activity, comments, posted, comment, timeline,
    syncing, sync,
    palette, layer, refs,
  };
}

/** @typedef {ReturnType<typeof tracker>} Tracker */

/** The tracker of the Issues app around a view. */
export const Model = $context(/** @type {Tracker} */ (/** @type {unknown} */ (null)));
