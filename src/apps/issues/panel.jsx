// The side panel of the open issue: its title and properties, edited in
// place as undoable steps, and its activity, a task on the fake server
// (switching issues aborts the request in flight) shown under Pending with a
// skeleton and Recover with a retry. Comments post optimistically.

import { $read, $lookup, $rerun, $signal, $write, $pending } from 'rrx-core';
import { $active, For, Pending, Recover, Show } from 'ren-core';
import { Model } from './model.js';
import { STATUSES, PRIORITIES, PEOPLE, LABELS, person, ago } from './data.js';
import { StatusIcon, PriorityIcon, Avatar, LabelChip, Key } from './icons.jsx';

/** The skeleton of a loading timeline. */
const Skeleton = () => (
  <ol class="timeline skeleton" aria-label="Loading activity">
    {[0, 1, 2].map(i => (
      <li class="entry">
        <span class="bone dot" />
        <span class={`bone line w${i}`} />
      </li>
    ))}
  </ol>
);

/** The open issue's activity and comments. @param {{ id: string }} props */
function Activity(props) {
  const m = $lookup(Model);
  const R = $active();
  const draft = $signal(R, '');
  const send = () => {
    m.comment(props.id, $read(draft));
    $write(draft, '');
  };
  return (
    <section class="activity">
      <h4>
        Activity
        <Show when={() => $pending(m.activity)}>
          <span class="spinner" aria-label="loading" />
        </Show>
      </h4>
      <Recover
        fallback={(/** @type {Error} */ error, /** @type {() => void} */ reset) => (
          <div class="failed" role="alert">
            <p>{`Couldn't load the activity: ${error.message}.`}</p>
            <button
              type="button"
              onClick={() => {
                $rerun(m.activity);
                reset();
              }}
            >
              Retry
            </button>
          </div>
        )}
      >
        <Pending fallback={<Skeleton />}>
          <ol class="timeline">
            <For each={m.timeline} by={e => e.id}>
              {entry => {
                // A committed draft keeps its key and updates in place: the row reads its entry live.
                // Its kind and author do not change.
                const e = entry();
                const who = e.who === 'you' ? 'You' : (person(e.who)?.name ?? 'Someone');
                return e.kind === 'comment' ? (
                  <li class={() => (entry().draft ? 'entry comment draft' : 'entry comment')}>
                    <Avatar id={e.who === 'you' ? null : e.who} size="small" />
                    <div class="bubble">
                      <p class="meta">
                        <b>{who}</b>
                        <time>{() => (entry().draft ? 'sending…' : ago(entry().at, m.stamp()))}</time>
                      </p>
                      <p>{() => entry().text}</p>
                    </div>
                  </li>
                ) : (
                  <li class="entry event">
                    <span class="dot" />
                    <p>
                      <b>{who}</b> {() => entry().text} <time>{() => ago(entry().at, m.stamp())}</time>
                    </p>
                  </li>
                );
              }}
            </For>
          </ol>
        </Pending>
      </Recover>
      <form class="composer" prevent="submit" onSubmit={send}>
        <textarea
          placeholder="Leave a comment…"
          rows="2"
          value={draft}
          onInput={e => $write(draft, e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        <button type="submit" class="primary" disabled={() => $read(draft).trim() === ''}>
          Comment
        </button>
      </form>
    </section>
  );
}

/** The panel. */
export function Panel() {
  const m = $lookup(Model);
  const id = () => /** @type {string} */ ($read(m.opened));
  /** @param {keyof import('./data.js').Issue} key */
  const f = key => m.field(id(), key);
  /** @param {string} label @param {keyof import('./data.js').Issue} field @param {any} value */
  const set = (label, field, value) => m.edit(label, [{ id: id(), field, value }]);
  /** @param {any} input */
  const rename = input => {
    const text = input.value.trim();
    if (text === '' || text === f('title')) input.value = f('title');
    else set(`rename ${id()}`, 'title', text);
  };
  return (
    <aside class="panel" aria-label={() => `Issue ${id()}`}>
      <header class="panel-head">
        <span class="crumb">
          <StatusIcon status={() => f('status')} />
          <b>{id}</b>
        </span>
        <span class="nav">
          <button type="button" class="icon" title="Previous (k)" onClick={() => m.walk(-1)}>
            ↑
          </button>
          <button type="button" class="icon" title="Next (j)" onClick={() => m.walk(1)}>
            ↓
          </button>
          <button type="button" class="icon" title="Close (Esc)" aria-label="Close" onClick={() => m.open(null)}>
            ✕
          </button>
        </span>
      </header>
      <div class="panel-body">
        <input
          class="title-edit"
          aria-label="Title"
          value={() => f('title')}
          onKeyDown={e => {
            if (e.key === 'Enter') e.target.blur();
            if (e.key === 'Escape') {
              e.target.value = f('title');
              e.target.blur();
            }
          }}
          onBlur={e => rename(e.target)}
        />
        <dl class="props">
          <dt>Status</dt>
          <dd>
            <StatusIcon status={() => f('status')} />
            <select aria-label="Status" onChange={e => set(`set ${id()} status`, 'status', e.target.value)}>
              {STATUSES.map(s => (
                <option value={s.id} selected={() => f('status') === s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </dd>
          <dt>Priority</dt>
          <dd>
            <PriorityIcon priority={() => f('priority')} />
            <select aria-label="Priority" onChange={e => set(`set ${id()} priority`, 'priority', Number(e.target.value))}>
              {PRIORITIES.map(p => (
                <option value={String(p.id)} selected={() => f('priority') === p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </dd>
          <dt>Assignee</dt>
          <dd>
            <Avatar id={() => f('assignee')} size="small" />
            <select aria-label="Assignee" onChange={e => set(`assign ${id()}`, 'assignee', e.target.value === '' ? null : e.target.value)}>
              <option value="" selected={() => f('assignee') === null}>
                Unassigned
              </option>
              {PEOPLE.map(p => (
                <option value={p.id} selected={() => f('assignee') === p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </dd>
          <dt>Labels</dt>
          <dd class="chips">
            <For each={() => f('labels')}>{name => <LabelChip name={name()} />}</For>
            <select
              class="add"
              aria-label="Add a label"
              onChange={e => {
                const name = e.target.value;
                e.target.value = '';
                if (name !== '' && !f('labels').includes(name)) set(`label ${id()}`, 'labels', [...f('labels'), name]);
              }}
            >
              <option value="">+ Label</option>
              {LABELS.map(l => (
                <option value={l}>{l}</option>
              ))}
            </select>
          </dd>
          <dt>Estimate</dt>
          <dd>{() => (f('estimate') ? `${f('estimate')} ${f('estimate') === 1 ? 'point' : 'points'}` : 'None')}</dd>
          <dt>Created</dt>
          <dd>{() => `${ago(f('created'), m.stamp())} ago`}</dd>
          <dt>Updated</dt>
          <dd>{() => `${ago(f('updated'), m.stamp())} ago`}</dd>
        </dl>
        <p class="hint">
          <Key>Ctrl</Key> <Key>Z</Key> undo · <Key>Ctrl</Key> <Key>Shift</Key> <Key>Z</Key> redo
        </p>
        {() => <Activity id={id()} />}
      </div>
    </aside>
  );
}
