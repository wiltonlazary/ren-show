// Mail's state and commands, on one rrx-core graph: the mailbox, the folder
// and search (the query reaches the list in the low lane, so the field stays
// urgent and the old results stay until the new ones are ready), the cursor
// and the list's window, the open message, optimistic star and archive with
// undo, and the compose sheet. No renderer and no DOM: the same model runs
// on the page and in a worker, and the keyboard and the parity script call
// the same commands.

import { $signal, $read, $write, $memo, $batch, $defer, $untrack } from 'rrx-core';
import { seed, clip, LABELS, NOW } from './data.js';

/** @typedef {import('./data.js').Message} Message */
/** @typedef {'inbox' | 'starred' | 'sent' | 'drafts' | 'archive' | `label:${string}`} Folder */
/** @typedef {{ id: number, text: string, undo: (() => void) | null }} Toast */

/**
 * A message row's height in the list, in pixels, on every renderer. The
 * client's list shows exactly seven (its height is 525), so the cursor's
 * moves keep whole rows in view.
 */
export const ROW = 75;

/** How long the pretend server takes to confirm a change, in ms. */
export const SYNC = 350;

/** How long a toast stays, in ms. */
export const TOAST = 6000;

/**
 * @typedef {object} Options
 * @property {number} viewport the list's visible height, in pixels
 * @property {boolean} [still] toasts stay and nothing waits on timers (the parity script)
 * @property {(ms: number, fn: () => void) => () => void} [later] timers (setTimeout by default)
 * @property {number} [count] how many messages to seed
 */

/** @param {number} ms @param {() => void} fn */
const timer = (ms, fn) => {
  // timer: feature, a toast's hold and the pretend server's sync delay
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** Every word of the query appears in the message. @param {Message} m @param {string[]} words */
const matches = (m, words) => words.every(w => m.hay.includes(w));

/**
 * The mail model, on graph `R`.
 * @param {import('rrx-core').Graph} R @param {Options} options
 */
export function Mailbox(R, options) {
  const later = options.later ?? timer;
  const still = options.still === true;
  const viewport = options.viewport;
  /** Every message, newest first; new mail (sent) goes in front. Flags change in place, and `version` tells. */
  const messages = seed(options.count);
  /** @type {Map<number, Message>} */
  const byId = new Map(messages.map(m => [m.id, m]));
  let made = messages.length;
  const version = $signal(R, 0);
  const touch = () => $write(version, $untrack(R, () => $read(version)) + 1);

  const folder = $signal(R, /** @type {Folder} */ ('inbox'));
  /** The field's text, urgent; the query the list reads, in the low lane. */
  const typed = $signal(R, '');
  const query = $signal(R, '');
  /** The cursor (the selected row) and the open message, by id. */
  const selected = $signal(R, /** @type {number | null} */ (null));
  const opened = $signal(R, /** @type {number | null} */ (null));
  /** The list's scroll offset, in pixels. */
  const offset = $signal(R, 0);
  const composing = $signal(R, false);
  const draft = { to: $signal(R, ''), subject: $signal(R, ''), body: $signal(R, '') };
  const toast = $signal(R, /** @type {Toast | null} */ (null));
  /** Changes the pretend server has not confirmed yet. */
  const syncing = $signal(R, 0);
  /** @type {Set<() => void>} */
  const timers = new Set();
  /** @param {number} ms @param {() => void} fn */
  const after = (ms, fn) => {
    const cancel = later(ms, () => { // timer: feature, a toast's hold and the pretend server's sync delay
      timers.delete(cancel);
      fn();
    });
    timers.add(cancel);
    return cancel;
  };
  let toasts = 0;

  /** Whether a message shows in a folder. @param {Message} m @param {Folder} f */
  const within = (m, f) => {
    if (f === 'starred') return m.starred && m.place !== 'drafts';
    if (f.startsWith('label:')) return m.labels.includes(f.slice(6));
    return m.place === f;
  };

  /** The rows of the list, as ids, newest first: the folder's, or every match of the query. */
  const list = $memo(R, () => {
    $read(version);
    const q = $read(query).trim().toLowerCase();
    const f = $read(folder);
    /** @type {number[]} */
    const out = [];
    if (q !== '') {
      const words = q.split(/\s+/);
      for (const m of messages) if (matches(m, words)) out.push(m.id);
    } else for (const m of messages) if (within(m, f)) out.push(m.id);
    return out;
  });

  /** The sidebar's counts: unread in the inbox and each label, totals for the rest. */
  const counts = $memo(R, () => {
    $read(version);
    /** @type {Record<string, number>} */
    const c = { inbox: 0, starred: 0, sent: 0, drafts: 0, archive: 0, all: messages.length, unread: 0 };
    for (const l of LABELS) c[`label:${l}`] = 0;
    for (const m of messages) {
      if (m.place === 'inbox' && !m.read) c.inbox++;
      if (!m.read && m.place !== 'sent' && m.place !== 'drafts') c.unread++;
      if (m.starred && m.place !== 'drafts') c.starred++;
      if (m.place === 'sent' || m.place === 'drafts' || m.place === 'archive') c[m.place]++;
      for (const l of m.labels) if (!m.read) c[`label:${l}`]++;
    }
    return c;
  });

  /** The largest offset: the last row at the bottom. */
  const limit = () => Math.max(0, $read(list).length * ROW - viewport);
  /** @param {number} px */
  const scrollTo = px => $write(offset, Math.max(0, Math.min(limit(), Math.round(px))));
  /** @param {number} dy */
  const scrollBy = dy => scrollTo($read(offset) + dy);

  /** The cursor's row, -1 when it is not in the list. */
  const cursor = () => {
    const id = $read(selected);
    return id === null ? -1 : $read(list).indexOf(id);
  };

  /** Moves the cursor to row `i` (clamped), scrolling it into view. @param {number} i */
  const select = i => {
    const rows = $read(list);
    if (rows.length === 0) return;
    const at = Math.max(0, Math.min(rows.length - 1, i));
    $write(selected, rows[at]);
    const top = at * ROW;
    const o = $read(offset);
    if (top < o) scrollTo(top);
    else if (top + ROW > o + viewport) scrollTo(top + ROW - viewport);
  };

  /** Opens a message (the cursor's by default) and marks it read. @param {number | null} [id] */
  const open = id => {
    const target = id ?? $read(selected) ?? $read(list)[0] ?? null;
    if (target === null) return;
    $batch(R, () => {
      $write(composing, false);
      $write(selected, target);
      $write(opened, target);
      const m = byId.get(target);
      if (m !== undefined && !m.read) {
        m.read = true;
        touch();
      }
      select($read(list).indexOf(target));
    });
  };

  /** Shows a toast, replacing the last; it goes by itself unless the model is still. @param {string} text @param {(() => void) | null} undo */
  const say = (text, undo) => {
    const t = { id: ++toasts, text, undo };
    $write(toast, t);
    if (!still) after(TOAST, () => $read(toast) === t && $write(toast, null));
  };

  /** The pretend server: a change counts as syncing until it confirms. */
  const sync = () => {
    if (still) return;
    $write(syncing, $read(syncing) + 1);
    after(SYNC, () => $write(syncing, Math.max(0, $read(syncing) - 1)));
  };

  /** The message a command acts on: the open one, else the cursor's. */
  const current = () => byId.get($read(opened) ?? $read(selected) ?? -1) ?? null;

  /** Stars or unstars at once (optimistic), with undo. */
  const star = () => {
    const m = current();
    if (m === null) return;
    $batch(R, () => {
      m.starred = !m.starred;
      touch();
      sync();
      const now = m.starred;
      say(now ? `Starred “${clip(m.subject, 40)}”` : `Unstarred “${clip(m.subject, 40)}”`, () => {
        m.starred = !now;
        touch();
        sync();
        say(now ? 'Star removed' : 'Star restored', null);
      });
    });
  };

  /** Archives at once (optimistic), moving on to the next message, with undo; in the archive, moves back to the inbox. */
  const archive = () => {
    const m = current();
    if (m === null || m.place === 'sent' || m.place === 'drafts') return;
    $batch(R, () => {
      const rows = $read(list);
      const at = rows.indexOf(m.id);
      const was = m.place;
      const wasOpen = $read(opened) === m.id;
      m.place = was === 'archive' ? 'inbox' : 'archive';
      touch();
      sync();
      // The cursor stays at the same place: the next message moves up into it.
      const rest = $read(list);
      const next = rest.length === 0 ? null : rest[Math.min(Math.max(0, at), rest.length - 1)];
      $write(selected, next);
      if (wasOpen) $write(opened, next);
      if (next !== null && wasOpen) {
        const n = byId.get(next);
        if (n !== undefined && !n.read) {
          n.read = true;
          touch();
        }
      }
      if (next !== null) select($read(list).indexOf(next));
      say(was === 'archive' ? 'Moved to Inbox' : 'Archived', () => {
        m.place = was;
        touch();
        sync();
        $write(selected, m.id);
        if (wasOpen) $write(opened, m.id);
        select($read(list).indexOf(m.id));
        say('Archive undone', null);
      });
    });
  };

  /** Marks the current message unread. */
  const unread = () => {
    const m = current();
    if (m === null) return;
    $batch(R, () => {
      m.read = false;
      touch();
      sync();
      $write(opened, null);
    });
  };

  /** Runs the toast's undo. */
  const undo = () => {
    const t = $read(toast);
    if (t?.undo == null) return;
    $batch(R, () => {
      $write(toast, null);
      t.undo?.();
    });
  };

  /** Shows a folder from its top. @param {Folder} f */
  const go = f =>
    $batch(R, () => {
      $write(folder, f);
      $write(typed, '');
      $write(query, '');
      $write(offset, 0);
      $write(composing, false);
      const first = $read(list)[0] ?? null;
      $write(selected, first);
    });

  /** The search field: urgent; the list follows in the low lane. @param {string} text */
  const search = text => {
    $write(typed, text);
    $defer(R, () => {
      $write(query, text);
      $write(offset, 0);
      $write(selected, $read(list)[0] ?? null);
    });
  };

  /** Opens the compose sheet, empty or as a reply to the current message. @param {boolean} [reply] */
  const compose = reply => {
    const m = reply ? current() : null;
    $batch(R, () => {
      $write(draft.to, m === null ? '' : m.from === 'You' ? m.to : m.from);
      $write(draft.subject, m === null ? '' : m.subject.startsWith('Re: ') ? m.subject : `Re: ${m.subject}`);
      $write(draft.body, '');
      $write(composing, true);
    });
  };

  /** Sends the draft: it goes to Sent at once, with undo back to the sheet. */
  const send = () => {
    const to = $read(draft.to).trim();
    const subject = $read(draft.subject).trim() || '(no subject)';
    const text = $read(draft.body).trim();
    if (to === '') {
      say('Add a recipient first', null);
      return;
    }
    const body = text === '' ? ['(no text)'] : text.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim());
    /** @type {Message} */
    const m = { id: ++made, from: 'You', email: 'you@mail.example', to, subject, preview: clip(body[0], 90), body, date: NOW + (made - messages.length) * 60_000, labels: [], place: 'sent', read: true, starred: false, hay: '' };
    m.hay = `you ${to} ${subject} ${body.join(' ')}`.toLowerCase();
    $batch(R, () => {
      messages.unshift(m);
      byId.set(m.id, m);
      touch();
      sync();
      $write(composing, false);
      say(`Sent to ${clip(to, 30)}`, () => {
        messages.splice(messages.indexOf(m), 1);
        byId.delete(m.id);
        touch();
        $write(draft.to, to);
        $write(draft.subject, subject === '(no subject)' ? '' : subject);
        $write(draft.body, text);
        $write(composing, true);
        say('Sending undone', null);
      });
    });
  };

  /** Closes the compose sheet. */
  const discard = () => $write(composing, false);

  /** Back a step: the compose sheet closes, else the open message (a phone's list shows again). */
  const back = () =>
    $batch(R, () => {
      if ($read(composing)) $write(composing, false);
      else $write(opened, null);
    });

  /**
   * The keyboard: j and k move, Enter opens, e archives, s stars, u marks
   * unread, r replies, c composes, z undoes, Escape closes. Returns whether
   * it acted. `/` asks the view to focus the search (it returns 'search').
   * @param {string} key @returns {boolean | 'search'}
   */
  const key = key => {
    switch (key) {
      case 'j':
      case 'ArrowDown':
        $batch(R, () => select(cursor() + 1));
        return true;
      case 'k':
      case 'ArrowUp':
        $batch(R, () => select(Math.max(0, cursor() - 1)));
        return true;
      case 'Enter':
      case ' ':
      case 'o':
        open();
        return true;
      case 'e':
        archive();
        return true;
      case 's':
        star();
        return true;
      case 'u':
        unread();
        return true;
      case 'r':
        compose(true);
        return true;
      case 'c':
        compose(false);
        return true;
      case 'z':
        undo();
        return true;
      case 'Escape':
        back();
        return true;
      case '/':
        return 'search';
      default:
        return false;
    }
  };

  // The first row starts selected.
  $write(selected, $untrack(R, () => $read(list)[0] ?? null));

  return {
    messages,
    /** @param {number} id */
    message: id => byId.get(id) ?? null,
    version,
    folder,
    typed,
    query,
    list,
    counts,
    selected,
    opened,
    offset,
    composing,
    draft,
    toast,
    syncing,
    viewport,
    limit,
    scrollTo,
    scrollBy,
    select,
    cursor,
    open,
    star,
    archive,
    unread,
    undo,
    go,
    search,
    compose,
    send,
    discard,
    back,
    key,
    /** Stops the timers (toasts and the pretend server). */
    close() {
      for (const cancel of timers) cancel();
      timers.clear();
    },
  };
}

/** @typedef {ReturnType<typeof Mailbox>} Mail */
