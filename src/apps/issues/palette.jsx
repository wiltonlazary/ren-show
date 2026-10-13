// The command palette (Ctrl/Cmd+K): one fuzzy search over the app's commands
// and its 2,000 issues, walked with the arrow keys and run with Enter. It
// renders in a Portal, above everything, and closes with Escape or a click
// outside.

import { $signal, $read, $write, $memo, $after, $raw, $lookup, $untrack } from 'rrx-core';
import { $active, For, Show } from 'ren-core';
import { Model } from './model.js';
import { STATUSES, PRIORITIES, PEOPLE, fuzzy } from './data.js';
import { StatusIcon, PriorityIcon, Avatar, Key } from './icons.jsx';

/**
 * @typedef {{ id: string, group: 'Commands' | 'Issues', title: string, hint?: string, icon?: any, run: () => void }} Item
 */

/** Items shown at most. */
export const SHOWN = 12;

/**
 * The commands, for the current target (the checked issues, else the open
 * one, else the focused one).
 * @param {import('./model.js').Tracker} m @returns {Item[]}
 */
export function commands(m) {
  const target = () => {
    const picked = $read(m.selection);
    if (picked.length > 0) return picked;
    const one = $read(m.opened) ?? $read(m.focused);
    return one === null ? [] : [one];
  };
  const name = () => {
    const t = target();
    return t.length === 1 ? t[0] : `${t.length} issues`;
  };
  /** @type {Item[]} */
  const out = [
    { id: 'view-list', group: 'Commands', title: 'Switch to list view', run: () => $write(m.mode, 'list') },
    { id: 'view-board', group: 'Commands', title: 'Switch to board view', run: () => $write(m.mode, 'board') },
    { id: 'view-insights', group: 'Commands', title: 'Open insights', run: () => $write(m.mode, 'insights') },
    { id: 'sync', group: 'Commands', title: 'Sync with the server', run: m.sync },
    { id: 'undo', group: 'Commands', title: 'Undo', hint: 'Ctrl Z', run: m.undo },
    { id: 'redo', group: 'Commands', title: 'Redo', hint: 'Ctrl Shift Z', run: m.redo },
    { id: 'clear', group: 'Commands', title: 'Clear filters', run: m.clearFilters },
    ...(/** @type {const} */ (['status', 'priority', 'assignee', 'none'])).map(by => ({ id: `group-${by}`, group: /** @type {const} */ ('Commands'), title: by === 'none' ? 'No grouping' : `Group by ${by}`, run: () => $write(m.grouping, by) })),
    ...PEOPLE.map(p => ({ id: `filter-${p.id}`, group: /** @type {const} */ ('Commands'), title: `Filter: assigned to ${p.name}`, icon: <Avatar id={p.id} size="small" />, run: () => m.toggleFilter('assignee', p.id) })),
  ];
  if (target().length > 0) {
    const ids = target();
    const label = name();
    for (const s of STATUSES) out.push({ id: `status-${s.id}`, group: 'Commands', title: `Set status of ${label}: ${s.name}`, icon: <StatusIcon status={s.id} />, run: () => m.edit(`set ${label} to ${s.name}`, ids.map(id => ({ id, field: 'status', value: s.id }))) });
    for (const p of PRIORITIES) out.push({ id: `priority-${p.id}`, group: 'Commands', title: `Set priority of ${label}: ${p.name}`, icon: <PriorityIcon priority={p.id} />, run: () => m.edit(`set ${label} priority`, ids.map(id => ({ id, field: 'priority', value: p.id }))) });
    for (const p of PEOPLE) out.push({ id: `assign-${p.id}`, group: 'Commands', title: `Assign ${label} to ${p.name}`, icon: <Avatar id={p.id} size="small" />, run: () => m.edit(`assign ${label}`, ids.map(id => ({ id, field: 'assignee', value: p.id }))) });
  }
  return out;
}

export function Palette() {
  const m = $lookup(Model);
  const R = $active();
  const query = $signal(R, '');
  const active = $signal(R, 0);
  // The commands depend on the target when the palette opened.
  const all = $untrack(R, () => commands(m));
  const results = $memo(R, () => {
    const q = $read(query).trim().toLowerCase();
    const found = all.map(item => ({ item, score: fuzzy(q, item.title) })).filter(r => r.score >= 0);
    if (q !== '') {
      const issues = $raw(m.store).issues;
      for (const id in issues) {
        const score = fuzzy(q, `${id} ${issues[id].title}`);
        if (score >= 0) found.push({ item: { id, group: 'Issues', title: issues[id].title, hint: id, icon: <StatusIcon status={issues[id].status} />, run: () => m.open(id) }, score: score - 2 });
      }
    }
    const top = q === '' ? found.slice(0, SHOWN) : found.sort((a, b) => b.score - a.score).slice(0, SHOWN);
    return top.map(r => r.item);
  });
  const close = () => $write(m.palette, false);
  /** @param {Item | undefined} item */
  const run = item => {
    if (item === undefined) return;
    close();
    item.run();
  };
  /** @param {any} e */
  const key = e => {
    const n = $read(results).length;
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      $write(active, n === 0 ? 0 : ($read(active) + 1) % n);
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      $write(active, n === 0 ? 0 : ($read(active) - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run($read(results)[$read(active)]);
    } else if (e.key === 'Escape') close();
  };
  return (
    <div class="palette-backdrop" onClick={e => e.target === e.currentTarget && close()}>
      <div class="palette" role="dialog" aria-label="Command palette">
        <input
          class="palette-input"
          placeholder="Type a command or search issues…"
          aria-label="Command"
          role="combobox"
          aria-expanded="true"
          value={query}
          ref={el => $after(R, () => el.focus?.())}
          onInput={e => {
            $write(query, e.target.value);
            $write(active, 0);
          }}
          onKeyDown={key}
        />
        <ul class="palette-list" role="listbox">
          <For each={results} by={item => item.id} fallback={<li class="none">No results</li>}>
            {(item, index) => {
              // An issue's row keeps its key when the issue changes (a status rolled back): it reads the item live.
              const first = () => index() === 0 || $read(results)[index() - 1]?.group !== item().group;
              return (
                <li
                  class={() => `palette-item${$read(active) === index() ? ' active' : ''}`}
                  role="option"
                  aria-selected={() => String($read(active) === index())}
                  data-group={() => (first() ? item().group : null)}
                  onPointerMove={() => $read(active) !== index() && $write(active, index())}
                  onClick={() => run(item())}
                >
                  <span class="icon">{() => item().icon ?? null}</span>
                  <span class="title">{() => item().title}</span>
                  {() => (item().hint ? <span class="hint">{item().hint}</span> : null)}
                </li>
              );
            }}
          </For>
        </ul>
        <footer class="palette-foot">
          <span>
            <Key>↑</Key>
            <Key>↓</Key> navigate
          </span>
          <span>
            <Key>↵</Key> run
          </span>
          <span>
            <Key>Esc</Key> close
          </span>
          <Show when={() => $read(query) !== ''}>
            <span class="found">{() => `${$read(results).length} shown`}</span>
          </Show>
        </footer>
      </div>
    </div>
  );
}
