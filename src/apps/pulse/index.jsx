// Pulse on the page: the dashboard application in a worker root (or, for
// comparison, the same component in a root on this thread), the alert rule
// and the theme's colors sent to it as props, its alerts shown as a banner
// and toasts, and what the boundary and the page's frames cost, measured.

import { $signal, $read, $write, $lookup, $cleanup, $owner } from 'rrx-core';
import { $active, Root, Runtime, Show, For } from 'ren-core';
import { $dom } from 'ren-dom';
import { Assets } from '../../assets.js';
import { look } from '../../themes.js';
import { Pulse } from './dashboard.jsx';

/** A metric's default threshold: percent for the error rate, ms for the p99. */
export const THRESHOLDS = { errors: 2, p99: 800 };

/** How long a toast stays, in ms (times the pace). */
const TOAST = 8000;

/** Frames the probe keeps. */
const FRAMES = 120;

/** A frame later than this (1.5 periods at 60 Hz) is late, as ren-core counts it. */
const LATE = 25;

/** What the connection reported, summed since the application started. */
export class Wire {
  constructor() {
    this.messages = 0;
    this.records = 0;
    this.deferred = 0;
    this.bytes = 0;
    this.apply = 0;
    this.present = 0;
    this.max = 0;
    this.urgent = 0;
    this.framed = 0;
  }
}

/** The page's frame intervals: a ring, summarized. */
class Frames {
  constructor() {
    this.ring = new Float64Array(FRAMES);
    this.count = 0;
    this.late = 0;
    this.previous = 0;
  }
  /** @param {number} at */
  add(at) {
    if (this.previous > 0) {
      const d = at - this.previous;
      this.ring[this.count++ % FRAMES] = d;
      if (d > LATE) this.late++;
    }
    this.previous = at;
  }
  /** p50 and p95 of the kept intervals. */
  summary() {
    const n = Math.min(this.count, FRAMES);
    const sorted = Array.from(this.ring.subarray(0, n)).sort((a, b) => a - b);
    const q = (/** @type {number} */ p) => (n === 0 ? 0 : sorted[Math.min(n - 1, Math.floor(p * n))]);
    return { p50: q(0.5), p95: q(0.95), late: this.late, frames: this.count };
  }
}

/** @param {number} ms */
const ms = ms => `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;
/** @param {number} n */
const thousands = n => Math.round(n).toLocaleString('en-US');

/** The theme's colors the dashboard draws with, from the current theme. @returns {import('./dashboard.jsx').Settings['colors']} */
const colors = () => {
  const c = look().colors;
  return { series: c.series.slice(0, 6), accent: c.accent, danger: c.danger, muted: c.muted, rule: c.rule, ink: c.ink };
};

/**
 * @typedef {{ id: number, kind: 'firing' | 'resolved', title: string, text: string }} Toast
 */

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const worker = env.worker;
  const runtime = $signal(R, /** @type {'worker' | 'main'} */ (worker === null ? 'main' : 'worker'));
  const metric = $signal(R, /** @type {'errors' | 'p99'} */ ('errors'));
  const threshold = $signal(R, THRESHOLDS.errors);
  /** @returns {import('./dashboard.jsx').Settings} */
  const settings = () => ({ colors: colors(), rule: { metric: $read(metric), threshold: $read(threshold) }, pace: env.pace });

  // What the application reports through Send.
  const alert = $signal(R, /** @type {Extract<import('./dashboard.jsx').Report, { type: 'alert' }> | null} */ (null));
  const stats = $signal(R, /** @type {Extract<import('./dashboard.jsx').Report, { type: 'stats' }> | null} */ (null));
  const toasts = $signal(R, /** @type {Toast[]} */ ([]));
  let made = 0;
  /** @param {Toast['kind']} kind @param {string} title @param {string} text */
  const toast = (kind, title, text) => {
    const t = { id: ++made, kind, title, text };
    $write(toasts, [...$read(toasts).slice(-2), t]);
    env.later(TOAST * env.pace, () => $write(toasts, $read(toasts).filter(x => x !== t))); // timer: feature, a toast's hold
  };
  /** @param {any} data */
  const onMessage = data => {
    const report = /** @type {import('./dashboard.jsx').Report} */ (data);
    if (report.type === 'stats') $write(stats, report);
    else if (report.type === 'alert') {
      const before = $read(alert)?.state ?? 'ok';
      $write(alert, report);
      const what = report.metric === 'p99' ? `p99 ${Math.round(report.value)} ms` : `error rate ${report.value.toFixed(2)}%`;
      const limit = report.metric === 'p99' ? `${report.threshold} ms` : `${report.threshold}%`;
      if (report.state === 'firing') toast('firing', 'Alert firing', `${what} above ${limit}${report.region ? ` · ${report.region}` : ''}`);
      else if (report.state === 'ok' && before === 'firing') toast('resolved', 'Resolved', `${what}, back under ${limit}`);
    }
  };

  // The boundary: the connection's report of each applied message, summed
  // here and shown twice a second.
  let wire = new Wire();
  const shown = $signal(R, new Wire());
  /** @param {import('ren-core/remote').Applied} info */
  const applied = info => {
    wire.messages++;
    wire.records += info.records;
    wire.deferred += info.deferred;
    wire.bytes += info.bytes;
    wire.apply += info.ms;
    wire.present += info.present;
    if (info.ms + info.present > wire.max) wire.max = info.ms + info.present;
    if (info.urgent) wire.urgent++;
    if (info.framed) wire.framed++;
  };

  // The page's own frames, where it has them.
  let frames = new Frames();
  const measured = $signal(R, frames.summary());
  const view = /** @type {any} */ ($lookup(Runtime).element)?.ownerDocument?.defaultView ?? null;
  const doc = view?.document ?? null;
  let frame = 0;
  let live = true;
  if (typeof view?.requestAnimationFrame === 'function') {
    const tick = (/** @type {number} */ at) => {
      if (!live) return;
      frames.add(at);
      frame = view.requestAnimationFrame(tick); // timer: feature, the page's frames are what the meters count
    };
    frame = view.requestAnimationFrame(tick); // timer: feature, starts counting the page's frames
  }
  let cancel = () => {};
  const publish = () => {
    $write(shown, Object.assign(new Wire(), wire));
    $write(measured, frames.summary());
    cancel = env.later(500 * env.pace, publish); // timer: feature, the readout's interval
  };
  cancel = env.later(500 * env.pace, publish); // timer: feature, the readout's interval
  $cleanup(/** @type {any} */ ($owner(R)), () => {
    live = false;
    view?.cancelAnimationFrame?.(frame);
    cancel();
  });

  /** @param {'worker' | 'main'} mode */
  const run = mode => {
    if ($read(runtime) === mode) return;
    wire = new Wire();
    frames = new Frames();
    $write(shown, new Wire());
    $write(measured, frames.summary());
    $write(stats, null);
    $write(alert, null);
    $write(runtime, mode);
  };
  /** @param {'errors' | 'p99'} m */
  const measure = m => {
    $write(metric, m);
    $write(threshold, THRESHOLDS[m]);
  };
  const inWorker = () => $read(runtime) === 'worker';

  return (
    <div class="app-pulse">
      <div class="pulse-toolbar">
        <div class="group">
          <small>Application runs</small>
          <div class="seg" role="group" aria-label="Where the application runs">
            <button type="button" disabled={worker === null} aria-pressed={() => String(inWorker())} onClick={() => run('worker')}>
              In a worker
            </button>
            <button type="button" aria-pressed={() => String(!inWorker())} onClick={() => run('main')}>
              On the main thread
            </button>
          </div>
        </div>
        <div class="group">
          <small>Alert rule (sent as props)</small>
          <div class="rule-edit">
            <div class="seg" role="group" aria-label="Alert metric">
              <button type="button" aria-pressed={() => String($read(metric) === 'errors')} onClick={() => measure('errors')}>
                Error rate
              </button>
              <button type="button" aria-pressed={() => String($read(metric) === 'p99')} onClick={() => measure('p99')}>
                p99 latency
              </button>
            </div>
            <label class="threshold">
              <span>above</span>
              <input
                type="number"
                min="0"
                step={() => ($read(metric) === 'p99' ? '50' : '0.5')}
                aria-label="Alert threshold"
                value={() => String($read(threshold))}
                onInput={(/** @type {any} */ e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) $write(threshold, n);
                }}
              />
              <span>{() => ($read(metric) === 'p99' ? 'ms' : '%')}</span>
            </label>
          </div>
        </div>
        <div class="group grow">
          <small>Alert state (sent back with Send)</small>
          <span class={() => `state ${$read(alert)?.state ?? 'ok'}`}>{() => ($read(alert)?.state === 'firing' ? 'Firing' : $read(alert)?.state === 'pending' ? 'Pending' : 'OK')}</span>
        </div>
      </div>
      <Show when={() => $read(alert)?.state === 'firing'}>
        <div class="pulse-banner" role="alert">
          <b>Alert firing</b>
          <span>
            {() => {
              const a = $read(alert);
              if (a === null) return '';
              const value = a.metric === 'p99' ? `p99 is ${Math.round(a.value)} ms` : `the error rate is ${a.value.toFixed(2)}%`;
              return `${value}, above ${a.threshold}${a.metric === 'p99' ? ' ms' : '%'}${a.region ? `: an incident in ${a.region}` : ''}. It resolves when the reading falls back.`;
            }}
          </span>
        </div>
      </Show>
      <div class="pulse-frame">
        {() => {
          // Each root sets every ren token on its host: it gets the page's theme,
          // and is made again when that changes.
          const renderer = $dom(doc, { theme: look().ren, styles: true });
          return inWorker() ? (
            <Root id="pulse-worker" runtime="worker" worker={/** @type {any} */ (worker)} renderer={renderer} props={settings} onMessage={onMessage} connect={{ applied }} />
          ) : (
            <Root id="pulse-main" renderer={renderer} props={settings} onMessage={onMessage}>
              {() => <Pulse later={env.later} now={env.now} />}
            </Root>
          );
        }}
      </div>
      <section class="pulse-meters" aria-label="Measured">
        <Meter label="application" value={() => (inWorker() ? 'in a worker' : 'on the main thread')} />
        <Meter label="feed" value={() => ($read(stats) === null ? '–' : `${($read(stats)?.hz ?? 0).toFixed(1)} ticks/s`)} />
        <Meter label="tick work" value={() => ($read(stats) === null ? '–' : `${ms($read(stats)?.ms ?? 0)} avg · ${ms($read(stats)?.max ?? 0)} max`)} />
        <Meter label="messages applied" value={() => (inWorker() ? thousands($read(shown).messages) : 'none: direct')} />
        <Meter label="records" value={() => (inWorker() ? `${thousands($read(shown).records)} · ${thousands($read(shown).deferred)} low lane` : '–')} />
        <Meter label="apply time" value={() => (inWorker() ? `${ms($read(shown).messages === 0 ? 0 : ($read(shown).apply + $read(shown).present) / $read(shown).messages)} avg · ${ms($read(shown).max)} max` : '–')} />
        <Meter label="received" value={() => (inWorker() ? `${thousands($read(shown).bytes / 1024)} KB` : '–')} />
        <Meter label="page frames" value={() => ($read(measured).frames === 0 ? '–' : `${ms($read(measured).p50)} p50 · ${ms($read(measured).p95)} p95`)} />
        <Meter label="late frames" value={() => ($read(measured).frames === 0 ? '–' : `${thousands($read(measured).late)} of ${thousands($read(measured).frames)}`)} />
      </section>
      <div class="pulse-toasts" aria-live="polite">
        <For each={toasts}>
          {t => (
            <div class={`toast ${t().kind}`}>
              <b>{t().title}</b>
              <span>{t().text}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/** A measured value with its caption. @param {{ label: string, value: () => string }} props */
const Meter = props => (
  <div class="meter" data-meter={props.label}>
    <small>{props.label}</small>
    <b>{props.value}</b>
  </div>
);

export default {
  id: 'pulse',
  title: 'Pulse',
  tagline: 'A live operations dashboard, entirely in a Web Worker',
  apis: ['Root runtime="worker"', 'serve', 'connect', 'applied', 'Props', 'Send', 'Storage', '$stream', '$defer', '$batch', '$memo', '$watch', '$untrack', 'For', 'Times', 'Show', 'Pending', 'Shape', 'Scroll'],
  summary:
    'A seeded telemetry model of a service in four regions and 24 hosts ticks at 20 to 60 Hz. The whole dashboard application (its graph, engine, charts and a 10,000-line log tail) runs in a Worker; the page only applies the op buffers it publishes. Each tick publishes in the low lane, so hovering, filtering and switching ranges stay urgent. Switch it to the main thread to compare the measured cost.',
  View,
};
