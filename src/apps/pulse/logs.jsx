// Pulse's live log tail: a window of the engine's 10,000-line ring, newest
// first, in a Scroll. Level chips and a text filter are input (urgent lane);
// new lines arrive with the feed (low lane). Following, the window slides with
// the ring; paused, it stays on the line it was paused at while new lines
// count up, and "Older lines" pages back through what the ring holds.

import { $signal, $read, $write, $memo } from 'rrx-core';
import { $active, For, Scroll } from 'ren-core';
import { LEVELS, ALL, REGIONS, SERVICES, CAPACITY } from './engine.js';

/** Lines shown at once. */
export const WINDOW = 120;

/** A shown line: made once per sequence number while it stays in the window. */
export class Line {
  /** @param {import('./engine.js').Ring} ring @param {number} seq */
  constructor(ring, seq) {
    const slot = seq % ring.capacity;
    this.seq = seq;
    this.time = new Date(ring.time[slot]).toISOString().slice(11, 23);
    this.level = LEVELS[ring.level[slot]];
    this.where = `${REGIONS[ring.region[slot]].id} · ${SERVICES[ring.service[slot]]}`;
    this.text = ring.text[slot];
  }
}

/** Thousands separators. @param {number} n */
const count = n => Math.round(n).toLocaleString('en-US');

/**
 * @param {{ engine: import('./engine.js').Engine, feed: any }} props
 */
export function Tail(props) {
  const R = $active();
  const ring = props.engine.logs;
  const feed = props.feed;
  const mask = $signal(R, ALL);
  const query = $signal(R, '');
  const follow = $signal(R, true);
  /** The newest line the window shows while paused. */
  const anchor = $signal(R, -1);
  /** @type {Map<number, Line>} */
  let made = new Map();
  // The window: newest first, up to WINDOW lines that pass the filters. Lines
  // keep their objects while they stay, so the keyed list only adds and drops rows.
  const view = $memo(R, () => {
    const until = $read(follow) ? ($read(feed), ring.total - 1) : $read(anchor);
    const m = $read(mask);
    const q = $read(query).trim().toLowerCase();
    const seqs = ring.find(until, WINDOW, m, q);
    /** @type {Map<number, Line>} */
    const next = new Map();
    const lines = seqs.map(seq => {
      const line = made.get(seq) ?? new Line(ring, seq);
      next.set(seq, line);
      return line;
    });
    made = next;
    const filtered = m !== ALL || q !== '';
    return { lines, until, matching: filtered ? ring.count(until, m, q) : Math.max(0, Math.min(until + 1, ring.total) - ring.first) };
  });
  const lines = $memo(R, () => $read(view).lines);
  /** @param {number} level */
  const toggle = level => $write(mask, $read(mask) ^ (1 << level));
  const pause = () => {
    if ($read(follow)) {
      $write(anchor, ring.total - 1);
      $write(follow, false);
    } else $write(follow, true);
  };
  const older = () => {
    const shown = $read(lines);
    if (shown.length === 0) return;
    $write(anchor, Math.max(ring.first, shown[shown.length - 1].seq - 1));
    $write(follow, false);
  };
  return (
    <section class="panel tail" aria-label="Live logs">
      <header class="panel-head">
        <h3>
          Live tail <span class={() => ($read(follow) ? 'badge live' : 'badge')}>{() => ($read(follow) ? 'following' : 'paused')}</span>
        </h3>
        <div class="tail-tools">
          <div class="chips" role="group" aria-label="Levels">
            {LEVELS.map((level, i) => (
              <button type="button" class={`chip ${level}`} aria-pressed={() => String(($read(mask) & (1 << i)) !== 0)} onClick={() => toggle(i)}>
                {level}
              </button>
            ))}
          </div>
          <input class="filter" type="search" placeholder="Filter: text, service, region…" aria-label="Filter logs" value={query} onInput={(/** @type {any} */ e) => $write(query, e.target.value)} />
          <button type="button" class="ghost" onClick={pause}>
            {() => ($read(follow) ? 'Pause tail' : 'Follow tail')}
          </button>
          <button type="button" class="ghost" onClick={older}>
            Older lines
          </button>
        </div>
      </header>
      <p class="tail-meta">
        <span>{() => `${count($read(lines).length)} shown of ${count($read(view).matching)} matching`}</span>
        <span>{() => ($read(feed), `${count(ring.size)} / ${count(CAPACITY)} lines in the ring · ${count(ring.total)} since start`)}</span>
        <span class="counts">
          {LEVELS.map((level, i) => (
            <span class={`count ${level}`}>{() => ($read(feed), `${level} ${count(ring.counts[i])}`)}</span>
          ))}
        </span>
        <span class="fresh">{() => ($read(follow) ? '' : ($read(feed), `${count(Math.max(0, ring.total - 1 - $read(anchor)))} newer lines`))}</span>
      </p>
      <Scroll style={{ height: 320 }}>
        <div class="lines" role="log">
          <For each={lines} fallback={<p class="quiet">No line matches.</p>}>
            {line => (
              <div class={`line ${line().level}`} data-seq={line().seq}>
                <time>{line().time}</time>
                <b>{line().level}</b>
                <span class="where">{line().where}</span>
                <span class="text">{line().text}</span>
              </div>
            )}
          </For>
        </div>
      </Scroll>
    </section>
  );
}
