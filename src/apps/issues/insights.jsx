// Insights, a chunk of its own: the Issues app loads this module with
// import() the first time the view opens. Headline numbers, issues by status,
// open work by assignee and issues created per week, all following the
// filters, drawn in HTML and SVG with the theme's series colors.

import { $read, $at, $lookup, $memo, $signal, $write } from 'rrx-core';
import { $active, For, Show } from 'ren-core';
import { Model } from './model.js';
import { STATUSES, PEOPLE, EPOCH, statusName } from './data.js';
import { StatusIcon, Avatar } from './icons.jsx';

const WEEK = 7 * 86_400_000;
/** Weeks the throughput chart covers. */
export const WEEKS = 16;

/** @param {number} n */
const fmt = n => n.toLocaleString('en-US');

export default function Insights() {
  const m = $lookup(Model);
  const R = $active();
  /** The issues the filters leave, as records. */
  const shown = $memo(R, () => {
    const issues = $read(m.shown);
    return STATUSES.flatMap(s => /** @type {string[]} */ ($at(m.view, ['columns', s.id]) ?? []).map(id => issues[id]));
  });
  const byStatus = $memo(R, () => STATUSES.map(s => ({ id: s.id, name: s.name, n: /** @type {string[]} */ ($at(m.view, ['columns', s.id]) ?? []).length })));
  const open = $memo(R, () => $read(shown).filter(i => i.status !== 'shipped' && i.status !== 'dropped'));
  const byPerson = $memo(R, () => {
    const list = [...PEOPLE.map(p => ({ id: /** @type {string | null} */ (p.id), name: p.name, n: 0, points: 0 })), { id: null, name: 'Unassigned', n: 0, points: 0 }];
    for (const i of $read(open)) {
      const row = list.find(r => r.id === i.assignee);
      if (row) {
        row.n++;
        row.points += i.estimate;
      }
    }
    return list.sort((a, b) => b.n - a.n);
  });
  const weeks = $memo(R, () => {
    const now = EPOCH;
    const out = Array.from({ length: WEEKS }, (_, k) => ({ k, created: 0, closed: 0 }));
    for (const i of $read(shown)) {
      const c = Math.floor((now - i.created) / WEEK);
      if (c >= 0 && c < WEEKS) out[WEEKS - 1 - c].created++;
      if (i.status === 'shipped') {
        const d = Math.floor((now - i.updated) / WEEK);
        if (d >= 0 && d < WEEKS) out[WEEKS - 1 - d].closed++;
      }
    }
    return out;
  });
  const hover = $signal(R, /** @type {string | null} */ (null));
  const total = () => $read(shown).length;
  const max = (/** @type {{ n: number }[]} */ rows) => Math.max(1, ...rows.map(r => r.n));
  const H = 120;
  const peak = () => Math.max(1, ...$read(weeks).flatMap(w => [w.created, w.closed]));
  return (
    <div class="insights">
      <div class="tiles">
        <div class="tile">
          <small>Issues</small>
          <b>{() => fmt(total())}</b>
        </div>
        <div class="tile">
          <small>Open</small>
          <b>{() => fmt($read(open).length)}</b>
        </div>
        <div class="tile">
          <small>Doing</small>
          <b>{() => fmt($read(byStatus).find(s => s.id === 'doing')?.n ?? 0)}</b>
        </div>
        <div class="tile">
          <small>P1 and open</small>
          <b>{() => fmt($read(open).filter(i => i.priority === 1).length)}</b>
        </div>
        <div class="tile">
          <small>Open points</small>
          <b>{() => fmt($read(open).reduce((t, i) => t + i.estimate, 0))}</b>
        </div>
      </div>
      <div class="charts">
        <figure class="chart">
          <figcaption>Issues by status</figcaption>
          <ul class="bars">
            <For each={byStatus} by={r => r.id}>
              {row => (
                <li title={() => `${statusName(row().id)}: ${fmt(row().n)}`}>
                  <span class="what">
                    <StatusIcon status={row().id} />
                    {row().name}
                  </span>
                  <span class="track">
                    <span class={`bar s-${row().id}`} style={() => `width: ${(100 * row().n) / max($read(byStatus))}%`} />
                  </span>
                  <span class="n">{() => fmt(row().n)}</span>
                </li>
              )}
            </For>
          </ul>
        </figure>
        <figure class="chart">
          <figcaption>Open issues by assignee</figcaption>
          <ul class="bars">
            <For each={byPerson} by={r => r.id ?? 'none'}>
              {row => (
                <li title={() => `${row().name}: ${fmt(row().n)} open, ${fmt(row().points)} points`}>
                  <span class="what">
                    <Avatar id={row().id} size="small" />
                    {row().name}
                  </span>
                  <span class="track">
                    <span class="bar" style={() => `width: ${(100 * row().n) / max($read(byPerson))}%`} />
                  </span>
                  <span class="n">{() => fmt(row().n)}</span>
                </li>
              )}
            </For>
          </ul>
        </figure>
        <figure class="chart wide">
          <figcaption>
            Created and completed per week
            <span class="legend">
              <i class="created" /> created <i class="closed" /> completed
            </span>
          </figcaption>
          <svg class="weeks" viewBox={`0 0 ${WEEKS * 24} ${H + 16}`} preserveAspectRatio="none" role="img" aria-label="Issues created and completed per week">
            <line class="base" x1="0" x2={WEEKS * 24} y1={H} y2={H} />
            <For each={weeks}>
              {(week, index) => (
                <g onPointerEnter={() => $write(hover, `${index() === WEEKS - 1 ? 'This week' : `${WEEKS - 1 - index()} weeks ago`}: ${week().created} created, ${week().closed} completed`)} onPointerLeave={() => $write(hover, null)}>
                  <rect class="hit" x={index() * 24} y="0" width="24" height={H} />
                  <rect class="created" x={index() * 24 + 4} width="7" rx="2" y={() => H - (H * week().created) / peak()} height={() => (H * week().created) / peak()} />
                  <rect class="closed" x={index() * 24 + 13} width="7" rx="2" y={() => H - (H * week().closed) / peak()} height={() => (H * week().closed) / peak()} />
                </g>
              )}
            </For>
          </svg>
          <p class="readout">{() => $read(hover) ?? `Peak ${peak()} a week · hover a week for its numbers`}</p>
        </figure>
      </div>
      <Show when={() => total() === 0}>
        <p class="empty">No issues match these filters.</p>
      </Show>
    </div>
  );
}
