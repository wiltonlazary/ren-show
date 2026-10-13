// The list view: issues grouped (by status, priority or assignee) in
// collapsible groups, a keyed For per group over the mirror's ids, one
// row per issue reading its own fields from the store, so an edit re-renders
// one row. Focus and the open issue are $select, so moving them reruns two
// rows; the checked rows are a store read per row.

import { $read, $at, $lookup, $memo, $untrack } from 'rrx-core';
import { $active, For, Show } from 'ren-core';
import { Model, PAGE } from './model.js';
import { statusName, priorityName, person, ago } from './data.js';
import { StatusIcon, PriorityIcon, Avatar, LabelChip } from './icons.jsx';

/** A group's title and glyph. @param {import('./model.js').Grouping} by @param {string} key */
function heading(by, key) {
  if (by === 'status') return { name: statusName(/** @type {any} */ (key)), icon: <StatusIcon status={/** @type {any} */ (key)} /> };
  if (by === 'priority') return { name: priorityName(Number(key)), icon: <PriorityIcon priority={Number(key)} /> };
  if (by === 'assignee') return { name: person(key)?.name ?? 'Unassigned', icon: <Avatar id={key === 'none' ? null : key} size="small" /> };
  return { name: 'All issues', icon: null };
}

/** One issue row. @param {{ id: string }} props */
export function Row(props) {
  const m = $lookup(Model);
  const id = props.id;
  const f = (/** @type {keyof import('./data.js').Issue} */ key) => () => m.field(id, key);
  return (
    <div
      class={() => `row${m.isFocused(id) ? ' focused' : ''}${m.isOpen(id) ? ' open' : ''}${$at(m.checked, [id]) ? ' checked' : ''}`}
      data-id={id}
      role="row"
      onClick={() => m.open(id)}
    >
      <span
        class="check"
        role="checkbox"
        aria-checked={() => String($at(m.checked, [id]) === true)}
        title="Select (x)"
        onClick={e => {
          e.stopPropagation();
          m.toggleCheck(id);
        }}
      />
      <PriorityIcon priority={f('priority')} />
      <span class="id">{id}</span>
      <StatusIcon status={f('status')} />
      <span class="title">{f('title')}</span>
      <span class="labels">
        <For each={f('labels')}>{name => <LabelChip name={name()} />}</For>
      </span>
      <span class="estimate" title="Estimate">{() => (m.field(id, 'estimate') ? `${m.field(id, 'estimate')}` : '')}</span>
      <time class="updated">{() => ago(m.field(id, 'updated'), m.stamp())}</time>
      <Avatar id={f('assignee')} size="small" />
    </div>
  );
}

/** One group: a header that collapses it, its rows, and "Show all". @param {{ name: string }} props */
function Group(props) {
  const m = $lookup(Model);
  const R = $active();
  const key = props.name;
  const ids = () => m.group(key);
  const count = $memo(R, () => ids().length);
  const open = () => !$read(m.collapsed).includes(key);
  const limit = () => $read(m.limits)[key] ?? PAGE;
  const rows = $memo(R, () => (open() ? ids().slice(0, limit()) : []));
  // The list region rebuilds the groups when the grouping changes.
  const head = heading($untrack(R, () => $read(m.grouping)), key);
  return (
    <section class={() => `group${open() ? '' : ' collapsed'}`} data-group={key}>
      <button type="button" class="group-head" aria-expanded={() => String(open())} onClick={() => m.toggleGroup(key)}>
        <svg class="chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M3 2l4 3-4 3" />
        </svg>
        {head.icon}
        <span class="name">{head.name}</span>
        <span class="count">{count}</span>
      </button>
      <div class="rows">
        <For each={rows}>{id => <Row id={id()} />}</For>
      </div>
      <Show when={() => open() && $read(count) > limit()}>
        <button type="button" class="more" onClick={() => m.showMore(key, $read(count))}>
          {() => `Show all ${$read(count).toLocaleString('en-US')}`}
        </button>
      </Show>
    </section>
  );
}

/** The list view. */
export function List() {
  const m = $lookup(Model);
  return (
    <div class="list" role="grid" aria-label="Issues">
      <Show
        when={() => $at(m.view, ['shown']) > 0}
        fallback={
          <div class="empty">
            <p>No issues match these filters.</p>
            <button type="button" onClick={m.clearFilters}>
              Clear filters
            </button>
          </div>
        }
      >
        {() => (
          // A new grouping rebuilds the groups (their headings differ).
          <>{() => ($read(m.grouping), <For each={() => $at(m.view, ['keys'])}>{key => <Group name={key()} />}</For>)}</>
        )}
      </Show>
    </div>
  );
}
