// Pulse: a live operations dashboard, one component that runs unchanged in
// a Worker (src/apps/pulse/worker.jsx serves it) or on the main thread. It
// imports no renderer and no DOM API: the page gives it its theme colors and
// alert rule through the root's props, and it tells the page about alerts
// and its own tick cost through Send.
//
// The feed is a `$stream` ticking on the clock it is given; each tick
// advances the engine, judges the alert rule in the urgent lane and publishes
// the new frame inside `$defer`, so every chart, tile and log line it moves
// goes out in the low lane while input (ranges, filters, hover) stays urgent.

import { $signal, $read, $write, $memo, $batch, $defer, $stream, $watch, $untrack, $lookup } from 'rrx-core';
import { $active, Props, Send, Storage, For, Times, Show, Pending, Shape } from 'ren-core';
import { Engine, REGIONS, RANGES, BUCKETS, INCIDENT } from './engine.js';
import { argb, latency, throughput, histogram, sparkline, bar, LATENCY, THROUGHPUT, HISTOGRAM, SPARK, BAR } from './charts.js';
import { Tail } from './logs.jsx';
import { THEMES } from '../../themes.js';

/** The engine's seed: every run of Pulse, in either mode, shows the same data. */
export const SEED = 20260925;

/** How long a breach must last before the alert fires, in simulated ms. */
export const HOLD = 3000;

/** The feed rates offered, in ticks per second. */
export const RATES = [20, 30, 60];

/** The range buttons' labels. */
export const RANGE_LABELS = /** @type {Record<import('./engine.js').Range, string>} */ ({ '5m': '5 min', '1h': '1 h', '24h': '24 h' });

/**
 * @typedef {object} Rule
 * @property {'errors' | 'p99'} metric the error rate (percent) or the p99 latency (ms)
 * @property {number} threshold
 */

/**
 * What the page sends as the root's props.
 * @typedef {object} Settings
 * @property {{ series: string[], accent: string, danger: string, muted: string, rule: string, ink: string }} colors the theme's colors (hex)
 * @property {Rule} rule the alert rule
 * @property {number} pace multiplies the feed's real delays (1 in the browser)
 */

/** The settings before the page sends any: the first theme, errors above 2%. @type {Settings} */
export const DEFAULTS = { colors: THEMES[0].colors, rule: { metric: 'errors', threshold: 2 }, pace: 1 };

/**
 * What the page receives through Send: an alert's state change, or the
 * feed's cost once a second.
 * @typedef {{ type: 'alert', state: 'ok' | 'pending' | 'firing', metric: Rule['metric'], value: number, threshold: number, at: number, region: string | null }
 *   | { type: 'stats', ms: number, max: number, hz: number, ticks: number, lines: number }} Report
 */

/** One published tick: the engine's time and tick, and the previous tick's cost. */
export class Frame {
  /** @param {Engine} engine @param {number} cost */
  constructor(engine, cost) {
    this.tick = engine.ticks;
    this.t = engine.t;
    this.cost = cost;
  }
}

/** The tick cost gathered between two reports. */
class Work {
  constructor() {
    this.ticks = 0;
    this.sum = 0;
    this.max = 0;
    this.since = 0;
  }
}

/** @param {number} n */
const thousands = n => Math.round(n).toLocaleString('en-US');
/** @param {number} ms */
const millis = ms => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
/** @param {number} t */
const clock = t => new Date(t).toISOString().slice(11, 19);
/** @param {number} fraction */
const percent = fraction => `${(fraction * 100).toFixed(fraction < 0.1 ? 2 : 1)}%`;

/** The ARGB palette of some hex colors. @param {Settings['colors']} c @returns {import('./charts.js').Paint} */
const paintOf = c => ({ series: c.series.map(hex => argb(hex)), accent: argb(c.accent), danger: argb(c.danger), muted: argb(c.muted), rule: argb(c.rule), ink: argb(c.ink) });

/**
 * A Shape that fills its box: DOM attributes (a class, the SVG viewBox), since
 * the portable props size a Shape in fixed pixels only.
 * @param {{ w: number, h: number }} box @param {string} name @param {string} label
 */
const fit = (box, name, label) => /** @type {any} */ ({ class: `plot ${name}`, viewBox: `0 0 ${box.w} ${box.h}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label });

const SPARK_FIT = fit(SPARK, 'spark', 'the last minute');
const LATENCY_FIT = fit(LATENCY, 'latency', 'Latency percentiles over time');
const THROUGHPUT_FIT = fit(THROUGHPUT, 'throughput', 'Requests and errors per second over time');
const HISTOGRAM_FIT = fit(HISTOGRAM, 'histogram', 'Latency distribution');
const BAR_FIT = fit(BAR, 'bar', 'share of requests');

/**
 * The dashboard.
 * @param {{ later?: (ms: number, fn: () => void) => () => void, now?: () => number, seed?: number }} props
 */
export function Pulse(props) {
  const R = $active();
  const later =
    props.later ??
    ((/** @type {number} */ ms, /** @type {() => void} */ fn) => {
      // timer: feature, the feed's ticks (tests inject a manual clock)
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    });
  const now = props.now ?? (() => performance.now());
  const send = /** @type {(data: Report) => void} */ ($lookup(Send));
  const shelf = $lookup(Storage);
  /** @returns {Settings} */
  const settings = () => $lookup(Props) ?? DEFAULTS;
  const engine = new Engine(props.seed ?? SEED);

  const kept = shelf?.get('range');
  const range = $signal(R, /** @type {import('./engine.js').Range} */ (kept === '1h' || kept === '24h' ? kept : '5m'));
  const paused = $signal(R, false);
  const rate = $signal(R, 30);
  const hover = $signal(R, -1);
  const sort = $signal(R, /** @type {'name' | 'cpu'} */ ('name'));
  /** The alert: ok, breached but not yet for HOLD ms (pending), or firing. */
  const alert = $signal(R, /** @type {'ok' | 'pending' | 'firing'} */ ('ok'));

  // The rule as last judged, and when the current breach began.
  /** @type {Rule} */
  let rule = DEFAULTS.rule;
  let reading = 0;
  let since = 0;
  /** Runs inside the tick's batch, outside `$defer`: the alert is urgent. */
  const judge = () => {
    rule = $untrack(R, () => settings().rule);
    reading = rule.metric === 'p99' ? engine.live.p99 : engine.live.errors * 100;
    const state = $untrack(R, () => $read(alert));
    let next = state;
    if (!(reading > rule.threshold)) next = 'ok';
    else if (state === 'ok') {
      next = 'pending';
      since = engine.t;
    } else if (state === 'pending' && engine.t - since >= HOLD) next = 'firing';
    if (next !== state) $write(alert, next);
  };
  $watch(
    R,
    () => $read(alert),
    state => {
      const burning = engine.burning;
      send({ type: 'alert', state, metric: rule.metric, value: reading, threshold: rule.threshold, at: engine.t, region: burning >= 0 ? REGIONS[burning].id : null });
    },
  );

  const work = new Work();
  // The feed: a stream of frames at the chosen rate; paused, it completes with
  // the last frame. Each tick's frame is published in the low lane.
  const feed = $stream(R, () => ($read(paused) ? 0 : $read(rate)), (/** @type {number} */ hz, next, complete) => {
    if (hz === 0) {
      complete({ ok: true, value: new Frame(engine, 0) });
      return undefined;
    }
    let last = now();
    let cost = 0;
    let cancel = () => {};
    work.since = last;
    const pace = () => $untrack(R, () => settings().pace) || 1;
    const step = () => {
      const at = now();
      const p = pace();
      const began = performance.now();
      // Simulated time follows the clock; a stalled tab catches up at most 2 s.
      engine.advance(Math.min((at - last) / p, 2000));
      last = at;
      const frame = new Frame(engine, cost);
      $batch(R, () => {
        judge();
        $defer(R, () => next(frame));
      });
      cost = performance.now() - began;
      work.ticks++;
      work.sum += cost;
      if (cost > work.max) work.max = cost;
      if (at - work.since >= 1000 * p) {
        send({ type: 'stats', ms: work.sum / work.ticks, max: work.max, hz: (work.ticks * 1000 * p) / (at - work.since), ticks: engine.ticks, lines: engine.logs.total });
        work.ticks = 0;
        work.sum = 0;
        work.max = 0;
        work.since = at;
      }
      cancel = later((1000 / hz) * p, step); // timer: feature, the feed's tick rate
    };
    next(new Frame(engine, 0));
    cancel = later((1000 / hz) * pace(), step); // timer: feature, the feed's tick rate
    return () => cancel();
  });
  /** The current frame; every live reading depends on it. */
  const frame = () => /** @type {Frame} */ ($read(feed));

  const paint = $memo(R, () => paintOf(settings().colors));
  const series = $memo(R, () => (frame(), engine.series(RANGES[$read(range)])));
  const deploys = $memo(R, () => {
    frame();
    const s = $read(series);
    return $read(range) === '24h' ? [] : engine.deploys(s.time[0], engine.t).map(d => d.at);
  });
  const lat = $memo(R, () => latency($read(series), $read(paint), $read(hover), $read(deploys)));
  const through = $memo(R, () => throughput($read(series), $read(paint), $read(hover)));
  const recent = $memo(R, () => (frame(), engine.deploys(engine.t - 4 * 3_600_000, engine.t).slice(-4).reverse()));
  const hosts = $memo(R, () => {
    if ($read(sort) === 'name') return engine.hosts;
    frame();
    return engine.hosts.slice().sort((a, b) => engine.cpu[b.i] - engine.cpu[a.i]);
  });
  const busiest = () => (frame(), Math.max(...engine.regions.map(r => r.rps)));

  /** @param {import('./engine.js').Range} k */
  const choose = k => {
    $write(range, k);
    $write(hover, -1);
    shelf?.set('range', k);
  };
  /** The alert's class on the tile of its metric. @param {Rule['metric']} metric */
  const alarm = metric => () => (settings().rule.metric === metric ? $read(alert) : 'ok');
  const ruleText = () => {
    const r = settings().rule;
    return r.metric === 'p99' ? `p99 > ${r.threshold} ms` : `error rate > ${r.threshold}%`;
  };
  const range0 = () => $read(series).time[0];

  return (
    <div class="pulse-app" data-alert={alert}>
      <header class="bar">
        <div class="ident">
          <span class={() => ($read(paused) ? 'pulse-dot paused' : 'pulse-dot')} aria-hidden="true" />
          <div>
            <h2>checkout-platform</h2>
            <p>
              <span class="env">production</span> · 4 regions · 24 hosts · <span class="clock">{() => `${clock(frame().t)} UTC`}</span>
            </p>
          </div>
        </div>
        <div class="controls">
          <div class="seg" role="group" aria-label="Time range">
            {/** @type {import('./engine.js').Range[]} */ (['5m', '1h', '24h']).map(k => (
              <button type="button" aria-pressed={() => String($read(range) === k)} onClick={() => choose(k)}>
                {RANGE_LABELS[k]}
              </button>
            ))}
          </div>
          <div class="seg" role="group" aria-label="Feed rate">
            {RATES.map(hz => (
              <button type="button" aria-pressed={() => String($read(rate) === hz)} onClick={() => $write(rate, hz)}>
                {`${hz} Hz`}
              </button>
            ))}
          </div>
          <button type="button" class="ghost" aria-pressed={() => String($read(paused))} onClick={() => $write(paused, !$read(paused))}>
            {() => ($read(paused) ? 'Resume' : 'Pause')}
          </button>
          <button type="button" class="danger" onClick={() => void engine.incident()}>
            Simulate incident
          </button>
        </div>
      </header>
      <Pending fallback={<p class="connecting">Connecting to the telemetry feed…</p>}>
        <div class="status">
          <span class={() => `rule ${$read(alert)}`}>
            <b>{() => ($read(alert) === 'firing' ? 'Firing' : $read(alert) === 'pending' ? 'Pending' : 'OK')}</b> {ruleText}
          </span>
          <span class="incident">
            {() => {
              frame();
              const r = engine.burning;
              if (r < 0) return 'No active incident';
              const incident = /** @type {import('./engine.js').Incident} */ (engine.incidents.findLast(i => i.region === r));
              return `Incident in ${REGIONS[r].id} · ${Math.max(0, Math.ceil((incident.start + INCIDENT - engine.t) / 1000))} s left`;
            }}
          </span>
          <span class="tick">{() => `tick ${thousands(frame().tick)} · ${frame().cost.toFixed(2)} ms`}</span>
        </div>
        <section class="kpis">
          <Kpi
            label="Requests / s"
            value={() => (frame(), thousands(engine.live.rps))}
            delta={() => (frame(), change(engine.spark('rps')))}
            shapes={() => (frame(), sparkline(engine.spark('rps'), $read(paint).series[1], 0.6))}
            state={() => 'ok'}
          />
          <Kpi
            label="p99 latency"
            value={() => (frame(), millis(engine.live.p99))}
            delta={() => (frame(), `p50 ${millis(engine.live.p50)} · p95 ${millis(engine.live.p95)}`)}
            shapes={() => (frame(), sparkline(engine.spark('p99'), $read(paint).series[4]))}
            state={alarm('p99')}
          />
          <Kpi
            label="Error rate"
            value={() => (frame(), percent(engine.live.errors))}
            delta={() => (frame(), `${thousands(engine.live.errors * engine.live.rps)} failed / s`)}
            shapes={() => (frame(), sparkline(engine.spark('errors'), $read(paint).danger, 0))}
            state={alarm('errors')}
          />
          <Kpi
            label="Fleet CPU"
            value={() => {
              frame();
              let sum = 0;
              for (const c of engine.cpu) sum += c;
              return `${(sum / engine.cpu.length).toFixed(1)}%`;
            }}
            delta={() => {
              frame();
              let hot = 0;
              for (const c of engine.cpu) if (c > 80) hot++;
              return hot === 0 ? 'all hosts under 80%' : `${hot} host${hot === 1 ? '' : 's'} over 80%`;
            }}
            shapes={() => (frame(), sparkline(engine.spark('cpu'), $read(paint).series[2], 0.5))}
            state={() => 'ok'}
          />
        </section>
        <section class="row main">
          <div class="panel chart">
            <header class="panel-head">
              <h3>Latency</h3>
              <p class="legend">
                <span class="key s0">p50</span>
                <span class="key s1">p95</span>
                <span class="key s4">p99</span>
                <span class="key deploy">deploy</span>
              </p>
            </header>
            <div class="plotting">
              <div class="axis y">
                {[4, 3, 2, 1, 0].map(q => (
                  <span>{() => millis(($read(lat).max * q) / 4)}</span>
                ))}
              </div>
              <div class="stage" onMouseleave={() => $write(hover, -1)}>
                <Shape shapes={() => $read(lat).figures} {...LATENCY_FIT} />
                <div class="hits" aria-hidden="true">
                  <Times count={BUCKETS}>{i => <i onMouseover={() => $write(hover, i)} />}</Times>
                </div>
                <Show when={() => $read(hover) >= 0}>
                  <Tip series={series} hover={hover} />
                </Show>
              </div>
              <div class="axis x">
                {[0, 1, 2, 3, 4].map(q => (
                  <span>{() => clock(range0() + (q / 4) * ($read(series).step * (BUCKETS - 1))).slice(0, $read(range) === '5m' ? 8 : 5)}</span>
                ))}
              </div>
            </div>
          </div>
          <div class="panel regions">
            <header class="panel-head">
              <h3>Regions</h3>
              <p class="legend">requests / s · p99 · errors</p>
            </header>
            <ul class="region-list">
              <For each={REGIONS}>
                {region => {
                  const r = REGIONS.indexOf(region());
                  const reading = engine.regions[r];
                  return (
                    <li class={() => (frame(), engine.burning === r ? 'region burning' : 'region')}>
                      <div class="region-name">
                        <b>{region().name}</b>
                        <small>{region().id}</small>
                      </div>
                      <Shape shapes={() => (frame(), bar(reading.rps / busiest(), reading.errors, $read(paint), $read(paint).series[r % 6]))} {...BAR_FIT} />
                      <div class="region-nums">
                        <span>{() => (frame(), thousands(reading.rps))}</span>
                        <span>{() => (frame(), millis(reading.p99))}</span>
                        <span class={() => (frame(), reading.errors > 0.02 ? 'bad' : '')}>{() => (frame(), percent(reading.errors))}</span>
                      </div>
                    </li>
                  );
                }}
              </For>
            </ul>
            <h4>Recent deploys</h4>
            <ul class="deploys">
              <For each={recent} by={d => d.k} fallback={<li class="quiet">none in the last 4 hours</li>}>
                {d => (
                  <li>
                    <b>{d().service}</b> <code>{d().version}</code> <time>{clock(d().at).slice(0, 5)}</time>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </section>
        <section class="row three">
          <div class="panel chart">
            <header class="panel-head">
              <h3>Throughput and errors</h3>
              <p class="legend">
                <span class="key s1">{() => `requests / s (max ${thousands($read(through).max)})`}</span>
                <span class="key danger">{() => `errors / s (max ${thousands($read(through).errors)})`}</span>
              </p>
            </header>
            <div class="stage short" onMouseleave={() => $write(hover, -1)}>
              <Shape shapes={() => $read(through).figures} {...THROUGHPUT_FIT} />
              <div class="hits" aria-hidden="true">
                <Times count={BUCKETS}>{i => <i onMouseover={() => $write(hover, i)} />}</Times>
              </div>
            </div>
          </div>
          <div class="panel chart">
            <header class="panel-head">
              <h3>Latency distribution</h3>
              <p class="legend">
                <span class="key s0">p50</span>
                <span class="key s1">p95</span>
                <span class="key danger">p99</span>
              </p>
            </header>
            <div class="stage short">
              <Shape shapes={() => (frame(), histogram(engine.histogram(), engine.live, $read(paint)))} {...HISTOGRAM_FIT} />
            </div>
            <div class="axis x">
              <span>0</span>
              <span>80 ms</span>
              <span>250 ms</span>
              <span>650 ms</span>
              <span>1.5 s+</span>
            </div>
          </div>
          <div class="panel hosts">
            <header class="panel-head">
              <h3>Hosts · CPU</h3>
              <div class="seg small" role="group" aria-label="Sort hosts">
                <button type="button" aria-pressed={() => String($read(sort) === 'name')} onClick={() => $write(sort, 'name')}>
                  by name
                </button>
                <button type="button" aria-pressed={() => String($read(sort) === 'cpu')} onClick={() => $write(sort, 'cpu')}>
                  by CPU
                </button>
              </div>
            </header>
            <div class="heat">
              <For each={hosts}>
                {host => {
                  const h = host();
                  return (
                    <div class="cell" data-host={h.name} title={`${h.name} · ${REGIONS[h.region].id} · ${h.service}`} style={() => (frame(), `--heat:${Math.round(engine.cpu[h.i])}`)}>
                      <span>{h.name}</span>
                      <b>{() => (frame(), `${Math.round(engine.cpu[h.i])}%`)}</b>
                      <small>{() => (frame(), `mem ${Math.round(engine.memory[h.i])}%`)}</small>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </section>
        <Tail engine={engine} feed={feed} />
      </Pending>
    </div>
  );
}

/** The change over a sparkline's samples, as a signed percentage. @param {number[]} samples */
function change(samples) {
  if (samples.length < 2 || samples[0] === 0) return 'steady';
  const d = (samples[samples.length - 1] - samples[0]) / samples[0];
  return `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}% vs ${samples.length} s ago`;
}

/**
 * A KPI tile: its value, a line of context, and a sparkline.
 * @param {{ label: string, value: () => string, delta: () => string, shapes: () => any[], state: () => string }} props
 */
function Kpi(props) {
  return (
    <div class={() => `kpi ${props.state()}`}>
      <small>{props.label}</small>
      <b>{props.value}</b>
      <span class="delta">{props.delta}</span>
      <Shape shapes={props.shapes} {...SPARK_FIT} />
    </div>
  );
}

/**
 * The crosshair's tooltip: the hovered bucket's time and readings.
 * @param {{ series: import('rrx-core').Readable<import('./engine.js').Series>, hover: import('rrx-core').Readable<number> }} props
 */
function Tip(props) {
  const at = () => Math.max(0, $read(props.hover));
  const s = () => $read(props.series);
  return (
    <div class={() => (at() > BUCKETS * 0.7 ? 'tip left' : 'tip')} style={() => `left:${((at() / (BUCKETS - 1)) * 100).toFixed(2)}%`} role="tooltip">
      <time>{() => `${clock(s().time[at()])} UTC`}</time>
      <span class="key s0">{() => `p50 ${millis(s().p50[at()])}`}</span>
      <span class="key s1">{() => `p95 ${millis(s().p95[at()])}`}</span>
      <span class="key s4">{() => `p99 ${millis(s().p99[at()])}`}</span>
      <span>{() => `${thousands(s().rps[at()])} req/s · ${percent(s().errors[at()])} errors`}</span>
    </div>
  );
}
