// Issues, a keyboard-first tracker: 2,000 issues in a store, a list grouped
// by a mirror, a board with optimistic drag and drop, a low-lane search,
// a side panel whose activity is a task, undo and redo, a command palette and
// toasts in a Portal, preferences in the root's Storage, and an Insights view
// loaded as a chunk of its own. Every delay runs on the environment's clock.

import { $signal, $read, $write, $lookup, $batch, $cleanup, $owner, $pending, $at, $task, $untrack } from 'rrx-core';
import { $active, Storage, Runtime, Show, Choose, When, For, Portal, Pending, Recover } from 'ren-core';
import { Assets } from '../../assets.js';
import { Model, tracker } from './model.js';
import { REJECT_EVERY } from './server.js';
import { PEOPLE, PRIORITIES, LABELS, person, priorityName } from './data.js';
import { List } from './list.jsx';
import { Board } from './board.jsx';
import { Panel } from './panel.jsx';
import { Palette } from './palette.jsx';
import { Avatar, PriorityIcon, LabelChip, Key } from './icons.jsx';

/** True when a key event comes from a field, where keys type. @param {any} target */
const typing = target => {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true;
};

/**
 * The app's keyboard: one listener on the document while the app lives.
 * @param {import('./model.js').Tracker} m @param {any} doc
 */
function shortcuts(m, doc) {
  const R = m.R;
  /** @param {any} e */
  const listen = e => {
    const key = e.key;
    const mod = e.ctrlKey || e.metaKey;
    const lower = typeof key === 'string' ? key.toLowerCase() : '';
    $batch(R, () => {
      if (mod && lower === 'k') {
        e.preventDefault();
        $write(m.palette, !$read(m.palette));
        return;
      }
      if (typing(e.target) || $read(m.palette)) return;
      if (mod && lower === 'z') {
        e.preventDefault();
        if (e.shiftKey) m.redo();
        else m.undo();
        return;
      }
      if (mod && lower === 'y') {
        e.preventDefault();
        m.redo();
        return;
      }
      if (mod || e.altKey) return;
      if (key === 'Escape') {
        if ($read(m.opened) !== null) m.open(null);
        else clearChecks(m);
        return;
      }
      if (key === '/') {
        e.preventDefault();
        m.refs.search?.focus();
        return;
      }
      if ($read(m.mode) !== 'list') return;
      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        m.walk(1);
      } else if (key === 'k' || key === 'ArrowUp') {
        e.preventDefault();
        m.walk(-1);
      } else if ((key === 'Enter' || key === 'o') && $read(m.focused) !== null) m.open($read(m.focused));
      else if (key === 'x' && $read(m.focused) !== null) m.toggleCheck(/** @type {string} */ ($read(m.focused)));
    });
  };
  if (doc === null) return;
  doc.addEventListener('keydown', listen);
  $cleanup(/** @type {any} */ ($owner(R)), () => doc.removeEventListener('keydown', listen));
}

/** @param {import('./model.js').Tracker} m */
const clearChecks = m => {
  for (const id of $read(m.selection)) m.toggleCheck(id);
};

/** A filter menu: a button, and a popover of toggleable values with counts. @param {{ kind: 'assignee' | 'priority' | 'label', title: string, menu: any }} props */
function Menu(props) {
  const m = $lookup(Model);
  const kind = props.kind;
  /** @type {{ value: string, name: string, icon: () => any }[]} */
  const options =
    kind === 'assignee' ? [...PEOPLE.map(p => ({ value: p.id, name: p.name, icon: () => <Avatar id={p.id} size="small" /> })), { value: 'none', name: 'Unassigned', icon: () => <Avatar id={null} size="small" /> }]
    : kind === 'priority' ? PRIORITIES.map(p => ({ value: String(p.id), name: p.name, icon: () => <PriorityIcon priority={p.id} /> }))
    : LABELS.map(l => ({ value: l, name: l, icon: () => <LabelChip name={l} /> }));
  const open = () => $read(props.menu) === kind;
  const active = () => $read(m.filters)[kind].length;
  return (
    <div class="menu">
      <button type="button" class={() => `chip-button${active() ? ' on' : ''}`} aria-haspopup="true" aria-expanded={() => String(open())} onClick={() => $write(props.menu, open() ? null : kind)}>
        {props.title}
        {() => (active() ? <span class="badge">{String(active())}</span> : null)}
      </button>
      <Show when={open}>
        <div class="menu-scrim" onClick={() => $write(props.menu, null)} />
        <ul class="popover" role="menu">
          {options.map(o => (
            <li role="menuitemcheckbox" aria-checked={() => String($read(m.filters)[kind].includes(o.value))} class={() => ($read(m.filters)[kind].includes(o.value) ? 'on' : '')} onClick={() => m.toggleFilter(kind, o.value)}>
              <span class="tick" />
              {kind === 'label' ? null : o.icon()}
              <span class="name">{kind === 'label' ? o.icon() : o.name}</span>
              <span class="n">{() => String($read(m.facets)[`${kind}:${o.value}`] ?? 0)}</span>
            </li>
          ))}
        </ul>
      </Show>
    </div>
  );
}

/** The filter bar: the menus, the active chips, the grouping. */
function Filters() {
  const m = $lookup(Model);
  const menu = $signal($active(), /** @type {string | null} */ (null));
  /** @type {{ kind: 'assignee' | 'priority' | 'label', value: string }[]} */
  const none = [];
  const chips = () => {
    const f = $read(m.filters);
    return none.concat(
      f.assignee.map(value => ({ kind: /** @type {const} */ ('assignee'), value })),
      f.priority.map(value => ({ kind: /** @type {const} */ ('priority'), value })),
      f.label.map(value => ({ kind: /** @type {const} */ ('label'), value })),
    );
  };
  const describe = (/** @type {{ kind: string, value: string }} */ c) => (c.kind === 'assignee' ? (person(c.value)?.name ?? 'Unassigned') : c.kind === 'priority' ? priorityName(Number(c.value)) : c.value);
  return (
    <div class="filters">
      <Menu kind="assignee" title="Assignee" menu={menu} />
      <Menu kind="priority" title="Priority" menu={menu} />
      <Menu kind="label" title="Label" menu={menu} />
      <span class="active">
        <For each={chips} by={c => `${c.kind}:${c.value}`}>
          {chip => (
            <button type="button" class="filter-chip" title="Remove this filter" onClick={() => m.toggleFilter(chip().kind, chip().value)}>
              <small>{chip().kind}</small>
              {describe(chip())}
              <span aria-hidden="true">×</span>
            </button>
          )}
        </For>
        <Show when={() => chips().length > 0 || $read(m.query) !== ''}>
          <button type="button" class="link" onClick={m.clearFilters}>
            Clear
          </button>
        </Show>
      </span>
      <label class="grouping">
        <span>Group</span>
        <select aria-label="Group by" onChange={e => $write(m.grouping, e.target.value)}>
          {['status', 'priority', 'assignee', 'none'].map(by => (
            <option value={by} selected={() => $read(m.grouping) === by}>
              {by === 'none' ? 'No grouping' : by[0].toUpperCase() + by.slice(1)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** The header: title, view tabs, search, sync and the palette. */
function Header() {
  const m = $lookup(Model);
  /** @type {{ id: import('./model.js').Mode, name: string }[]} */
  const tabs = [
    { id: 'list', name: 'List' },
    { id: 'board', name: 'Board' },
    { id: 'insights', name: 'Insights' },
  ];
  return (
    <header class="top">
      <div class="team">
        <span class="team-mark">R</span>
        <b>Issues</b>
        <span class="total">{() => ($at(m.view, ['total']) ?? 0).toLocaleString('en-US')}</span>
      </div>
      <nav class="tabs" role="tablist">
        {tabs.map(t => (
          <button type="button" role="tab" class={() => ($read(m.mode) === t.id ? 'tab on' : 'tab')} aria-selected={() => String($read(m.mode) === t.id)} onClick={() => $write(m.mode, t.id)}>
            {t.name}
          </button>
        ))}
      </nav>
      <label class={() => `search${$pending(m.hits) ? ' busy' : ''}`}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5l3 3" />
        </svg>
        <input type="search" placeholder="Search issues" aria-label="Search issues" value={m.query} ref={el => (m.refs.search = el)} onInput={e => m.search(e.target.value)} onKeyDown={e => e.key === 'Escape' && e.target.blur()} />
        {() => ($pending(m.hits) ? <span class="spinner" aria-label="searching" /> : <Key>/</Key>)}
      </label>
      <button type="button" class={() => `ghost-button${$read(m.syncing) ? ' busy' : ''}`} onClick={m.sync} disabled={m.syncing}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M13 5.5A5.5 5.5 0 0 0 3.2 4.6M3 10.5a5.5 5.5 0 0 0 9.8.9M3 2v3h3M13 14v-3h-3" />
        </svg>
        {() => ($read(m.syncing) ? 'Syncing…' : 'Sync')}
      </button>
      <button type="button" class="ghost-button command" onClick={() => $write(m.palette, true)}>
        Commands <Key>Ctrl</Key>
        <Key>K</Key>
      </button>
    </header>
  );
}

/** The Insights view: its module loads with import() the first time, as a task, under Pending. */
function InsightsView() {
  const R = $active();
  const chunk = $task(R, () => 1, (_, complete) => {
    import('./insights.jsx').then(
      mod => complete({ ok: true, value: mod.default }),
      error => complete({ ok: false, error }),
    );
  });
  return (
    <Recover
      fallback={(/** @type {Error} */ error) => (
        <div class="failed" role="alert">
          {`Insights failed to load: ${error.message}`}
        </div>
      )}
    >
      <Pending
        fallback={
          <div class="insights skeleton" aria-label="Loading insights">
            <div class="tiles">
              {[0, 1, 2, 3, 4].map(() => (
                <div class="tile bone" />
              ))}
            </div>
            <div class="charts">
              <div class="chart bone" />
              <div class="chart bone" />
            </div>
          </div>
        }
      >
        {() => {
          const Insights = /** @type {any} */ ($read(chunk));
          return <Insights />;
        }}
      </Pending>
    </Recover>
  );
}

/** The bar at the bottom: counts, the bulk actions, the server and the last background drain. */
function Status() {
  const m = $lookup(Model);
  const R = $active();
  const drain = $signal(R, /** @type {import('../../assets.js').Drain | null} */ (null));
  $cleanup(/** @type {any} */ ($owner(R)), m.env.drains.listen(report => $write(drain, report)));
  /** @param {any} e @param {'status' | 'priority' | 'assignee'} field */
  const bulk = (e, field) => {
    const value = e.target.value;
    e.target.value = '';
    if (value === '') return;
    const ids = $read(m.selection);
    const parsed = field === 'priority' ? Number(value) : value === 'none' ? null : value;
    m.edit(`${field} of ${ids.length} issues`, ids.map(id => ({ id, field, value: parsed })));
  };
  return (
    <footer class="status-bar">
      <Show
        when={() => $read(m.selection).length > 0}
        fallback={
          <span class="counts">
            {() => `${($at(m.view, ['shown']) ?? 0).toLocaleString('en-US')} of ${($at(m.view, ['total']) ?? 0).toLocaleString('en-US')} issues`}
          </span>
        }
      >
        <span class="bulk">
          <b>{() => `${$read(m.selection).length} selected`}</b>
          <select aria-label="Set status of the selected issues" onChange={e => bulk(e, 'status')}>
            <option value="">Status…</option>
            <option value="idea">Idea</option>
            <option value="ready">Ready</option>
            <option value="doing">Doing</option>
            <option value="checking">Checking</option>
            <option value="shipped">Shipped</option>
            <option value="dropped">Dropped</option>
          </select>
          <select aria-label="Set priority of the selected issues" onChange={e => bulk(e, 'priority')}>
            <option value="">Priority…</option>
            {PRIORITIES.map(p => (
              <option value={String(p.id)}>{p.name}</option>
            ))}
          </select>
          <select aria-label="Assign the selected issues" onChange={e => bulk(e, 'assignee')}>
            <option value="">Assignee…</option>
            {PEOPLE.map(p => (
              <option value={p.id}>{p.name}</option>
            ))}
            <option value="none">Unassigned</option>
          </select>
          <button type="button" class="link" onClick={() => clearChecks(m)}>
            Clear
          </button>
        </span>
      </Show>
      <span class="keys">
        <Key>j</Key>
        <Key>k</Key> move <Key>↵</Key> open <Key>x</Key> select
      </span>
      <span class="server" title={`The fake server answers in 180–420 ms and rejects every ${REJECT_EVERY}th write.`}>
        <i class={() => ($read(m.overlay.pending) || $read(m.syncing) ? 'light busy' : 'light')} />
        {() => ($read(m.overlay.pending) ? 'Saving…' : $read(m.syncing) ? 'Syncing…' : 'Synced')}
      </span>
      <Show when={drain}>
        <span class="drain" title="Rows removed in one go are freed in the background (retire and sweep)">
          {() => {
            const d = /** @type {import('../../assets.js').Drain} */ ($read(drain));
            return `Freed in the background: ${d.slices} slices, longest ${d.longest.toFixed(1)} ms`;
          }}
        </span>
      </Show>
    </footer>
  );
}

/** A toast. @param {{ toast: import('./model.js').Toast }} props */
const ToastView = props => {
  const m = $lookup(Model);
  return (
    <li class={`toast ${props.toast.tone}`} role={props.toast.tone === 'danger' ? 'alert' : 'status'}>
      <span>{props.toast.text}</span>
      <button type="button" class="icon" aria-label="Dismiss" onClick={() => m.dismiss(props.toast.id)}>
        ✕
      </button>
    </li>
  );
};

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const m = tracker(R, env, $lookup(Storage));
  const doc = /** @type {any} */ ($lookup(Runtime).element)?.ownerDocument ?? null;
  shortcuts(m, doc);
  return (
    <Model value={m}>
      <div class={() => `app-issues mode-${$read(m.mode)}${$read(m.opened) !== null ? ' with-panel' : ''}`}>
        <Header />
        <Filters />
        <div class="body">
          <section class="main">
            <Choose>
              <When when={() => $read(m.mode) === 'list'}>
                <List />
              </When>
              <When when={() => $read(m.mode) === 'board'}>
                <Board />
              </When>
              <When when={() => $read(m.mode) === 'insights'}>
                <InsightsView />
              </When>
            </Choose>
          </section>
          <Show when={m.opened}>
            <Panel />
          </Show>
        </div>
        <Status />
        <div class="layer" ref={m.layer} />
        <Show when={m.layer}>
          {() => (
            <Portal into={$untrack(R, () => $read(m.layer))}>
              <ol class="toasts" aria-live="polite">
                <For each={m.toasts} by={t => t.id}>
                  {t => <ToastView toast={t()} />}
                </For>
              </ol>
              <Show when={m.palette}>
                <Palette />
              </Show>
            </Portal>
          )}
        </Show>
      </div>
    </Model>
  );
}

export default {
  id: 'issues',
  title: 'Issues',
  tagline: 'A keyboard-first issue tracker: 2,000 issues, list and board, optimistic drag and drop, command palette.',
  apis: [
    '$store', '$at', '$put', '$update', '$raw', '$mirror', '$reuse', '$overlay', '$act', '$optimistic', '$task', '$rerun', '$pending',
    '$defer', '$scan', '$select', '$memo', '$watch', '$context', '$batch', '$after',
    'For', 'Show', 'Choose', 'When', 'Portal', 'Pending', 'Recover', 'Storage', 'Runtime', 'import()', 'retire', 'swept',
  ],
  summary:
    'Two thousand seeded issues live in one store; the grouped list is a mirror of it, so a title edit re-renders one row and a move touches two groups. Drag a card across the board and the move shows at once, layered over the store until the fake server answers; every fourth write is rejected and rolls back with a toast. The search runs in the low lane and keeps the old results while the new ones load. The side panel loads each issue\'s activity as a task that aborts on switch, edits are undoable, Ctrl+K opens the command palette, preferences persist in the root\'s Storage, and Insights loads as its own chunk.',
  View,
};
