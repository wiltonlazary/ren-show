// Terminal: a market terminal drawn by ren-skia. The desk (watchlist,
// chart, order book, tape) is one component of portable primitives in a
// Skia root; the same component also renders on ren-dom, and the chart
// alone renders on both side by side, so the frame cost of each renderer is
// measured on the same frames.
//
// The page owns the feed (a seeded market of five symbols, 50,000 candles,
// ticking at 20 to 60 Hz), the desk (view, studies, drawings, crosshair) and
// the clock. Each animation frame that has a change publishes the desk's
// frame to each root as its props, timed from the write to the end of that
// root's work: for Skia its flush, layout, paint, CanvasKit raster and the
// copy to the canvas; for the DOM its flush, the DOM writes and a forced
// style and layout (the browser paints later, which only the page's frame
// times show). The roots send their gestures and presses back as messages.

import { $signal, $read, $write, $lookup, $cleanup, $owner, $defer, $untrack, $watch, $memo, $equals } from 'rrx-core';
import { $active, $media, $viewport, Root, Runtime, Pending, Recover, Label } from 'ren-core';
import { $dom } from 'ren-dom';
import { $skia } from 'ren-skia';
import { Assets } from '../../assets.js';
import { Async } from '../../async.js';
import { Look, look, tone } from '../../themes.js';
import { Feed, Market, SYMBOLS, money } from './market.js';
import { Desk, LEGEND } from './desk.js';
import { Terminal, Chart, LEFT, RIGHT, STRIP, NARROW, TALL } from './view.jsx';
import { measure } from '../../kit.jsx';
import { AXIS } from './chart.js';

/** The desk on its canvas, in CSS pixels. */
export const WIDTH = 960;
export const HEIGHT = 600;
/** Each chart of the side-by-side comparison. */
export const PANE = { width: 470, height: 440 };

/** The feed rates offered, in ticks per second. */
export const RATES = [20, 30, 60];

/** Samples each cost keeps. */
const KEPT = 240;

/** A frame later than this (1.5 periods at 60 Hz) is late. */
const LATE = 25;

/** @typedef {'skia' | 'dom' | 'compare'} Mode */

/**
 * The times one root took to take a frame, a ring of the last KEPT, and how
 * its renderer repainted them (ren-canv's `repaint`: whole, damaged
 * rectangles only, or nothing).
 */
export class Cost {
  constructor() {
    this.ring = new Float64Array(KEPT);
    this.n = 0;
    this.max = 0;
    this.full = 0;
    this.damage = 0;
    this.none = 0;
  }
  /** @param {number} ms @param {'full' | 'damage' | 'none' | null} [repaint] */
  add(ms, repaint = null) {
    this.ring[this.n++ % KEPT] = ms;
    if (ms > this.max) this.max = ms;
    if (repaint !== null) this[repaint]++;
  }
  /** Percentiles of the kept samples. */
  summary() {
    const n = Math.min(this.n, KEPT);
    const sorted = Array.from(this.ring.subarray(0, n)).sort((a, b) => a - b);
    const q = (/** @type {number} */ p) => (n === 0 ? 0 : sorted[Math.min(n - 1, Math.floor(p * n))]);
    let sum = 0;
    for (const v of sorted) sum += v;
    return { frames: this.n, p50: q(0.5), p95: q(0.95), mean: n === 0 ? 0 : sum / n, max: this.max, full: this.full, damage: this.damage, none: this.none };
  }
}

/** The page's frame intervals. */
class Frames {
  constructor() {
    this.ring = new Float64Array(KEPT);
    this.count = 0;
    this.late = 0;
    this.previous = 0;
  }
  /** @param {number} at */
  add(at) {
    if (this.previous > 0) {
      const d = at - this.previous;
      this.ring[this.count++ % KEPT] = d;
      if (d > LATE) this.late++;
    }
    this.previous = at;
  }
  summary() {
    const n = Math.min(this.count, KEPT);
    const sorted = Array.from(this.ring.subarray(0, n)).sort((a, b) => a - b);
    const q = (/** @type {number} */ p) => (n === 0 ? 0 : sorted[Math.min(n - 1, Math.floor(p * n))]);
    let sum = 0;
    for (const v of sorted) sum += v;
    return { p50: q(0.5), p95: q(0.95), fps: sum === 0 ? 0 : (n * 1000) / sum, late: this.late, frames: this.count };
  }
}

/** @param {number} ms */
const ms = ms => `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;

/**
 * What the page shows twice a second.
 * @typedef {{ page: ReturnType<Frames['summary']>, skia: ReturnType<Cost['summary']>, dom: ReturnType<Cost['summary']>, hz: number, ticks: number, mode: Mode, raster: 'WebGL' | 'software' | null }} Stats
 */

/**
 * What tests reach through `probe`.
 * @typedef {object} Probe
 * @property {Feed} feed
 * @property {Desk} desk
 * @property {() => boolean} publish publishes the desk's frame now, if it changed
 * @property {() => void} step one feed tick, as the clock makes it
 * @property {Record<'skia' | 'skiaChart' | 'dom' | 'domChart', any>} renderers the renderers, as made
 * @property {Record<'skia' | 'dom', Cost>} costs
 * @property {(mode: Mode) => void} show
 */

/**
 * The application. `probe` receives the page's model (tests drive it);
 * `manual` leaves the clock and the frame loop to the caller.
 * @param {{ probe?: (probe: Probe) => void, manual?: boolean }} props
 */
function View(props) {
  const R = $active();
  const env = $lookup(Assets);
  const feed = new Feed();
  const desk = new Desk(feed);
  const mode = $signal(R, /** @type {Mode} */ ('skia'));
  const live = $signal(R, props.manual !== true);
  const rate = $signal(R, 30);
  // The tick, as the DOM status shows it: published in the low lane.
  const tick = $signal(R, 0);
  const skia = Async(R, () => env.skia, async load => {
    if (load === null) throw new Error('this environment has no CanvasKit');
    return load();
  });
  const doc = /** @type {any} */ ($lookup(Runtime).element)?.ownerDocument ?? null;
  const view = doc?.defaultView ?? null;

  // The desk's size: 960 by 600, or on a phone (the viewport's media query)
  // the stage's width, less the pane's frame, in one column (view.jsx,
  // NARROW); where nothing lays the page out, the viewport's less a phone's
  // gutters. The comparison's charts are as wide as the phone too.
  const viewport = $viewport();
  const phone = $media(`(max-width: ${NARROW - 1}px)`);
  const box = measure(R, 0);
  const size = $equals(
    $memo(R, () => {
      if (!$read(phone)) return { desk: /** @type {[number, number]} */ ([WIDTH, HEIGHT]), pane: /** @type {[number, number]} */ ([PANE.width, PANE.height]) };
      const room = box.width() > 0 ? box.width() - 2 : $read(viewport.width) - 26;
      const w = Math.max(300, Math.min(NARROW - 1, room));
      return { desk: /** @type {[number, number]} */ ([w, TALL]), pane: /** @type {[number, number]} */ ([Math.min(PANE.width, w), PANE.height]) };
    }),
    (a, b) => a.desk.join() === b.desk.join() && a.pane.join() === b.pane.join(),
  );

  // The theme travels with each frame, and each renderer takes it at once
  // (setTheme): a new theme restyles the roots, their state kept.
  let theme = $untrack(R, look);
  $watch(R, look, t => {
    if (t === theme) return;
    theme = t;
    desk.touch();
  });
  /** The theme each renderer was last given. @type {WeakMap<object, import('../../themes.js').Theme>} */
  const given = new WeakMap();
  /** @param {any} renderer */
  const restyle = renderer => {
    if (renderer === null || renderer.closed === true || given.get(renderer) === theme) return;
    if (given.has(renderer)) renderer.setTheme(theme.ren);
    given.set(renderer, theme);
  };
  /** Where the Skia roots rasterize: WebGL (the renderer's default where the browser has it) or CanvasKit's software raster. */
  const raster = $signal(R, /** @type {'gpu' | 'cpu'} */ ('gpu'));

  // Each root's props: the frames published to it.
  const first = { ...desk.frame(), theme };
  const toSkia = $signal(R, first);
  const toDom = $signal(R, first);
  /** The frame shown last, for the attributes tools read. */
  const current = $signal(R, first);
  /** @type {Probe['renderers']} */
  const renderers = { skia: null, skiaChart: null, dom: null, domChart: null };
  const costs = { skia: new Cost(), dom: new Cost() };
  let published = desk.version;

  /** The plot's width in the current mode, for the keys that zoom around its centre. */
  const plot = () =>
    $untrack(R, () => {
      const { desk, pane } = $read(size);
      if ($read(mode) === 'compare') return pane[0];
      return desk[0] < NARROW ? desk[0] - STRIP : desk[0] - LEFT - RIGHT - STRIP;
    }) - AXIS;

  /**
   * Publishes the desk's frame to each root shown, each timed on its own.
   * Outside any batch (a frame callback), so each write flushes its root
   * at once.
   */
  const publish = () => {
    if (desk.version === published) return false;
    published = desk.version;
    const f = { ...desk.frame(), theme };
    const m = $untrack(R, () => $read(mode));
    const renderer = m === 'compare' ? renderers.skiaChart : renderers.skia;
    if (m !== 'dom' && renderer !== null && !renderer.closed) {
      const painted = renderer.frames;
      const t0 = env.now();
      restyle(renderer);
      $write(toSkia, f);
      costs.skia.add(env.now() - t0, renderer.frames === painted ? 'none' : renderer.repaint);
    } else $write(toSkia, f);
    if (m !== 'skia') {
      const t0 = env.now();
      restyle(m === 'compare' ? renderers.domChart : renderers.dom);
      $write(toDom, f);
      env.settle();
      costs.dom.add(env.now() - t0);
    } else $write(toDom, f);
    $write(current, f);
    return true;
  };

  /** One feed tick: the market moves, the desk follows, the status hears it in the low lane. */
  const step = () => {
    feed.tick();
    desk.ticked();
    $defer(R, () => $write(tick, feed.ticks));
  };

  // The clock: ticks at the chosen rate while live.
  let ticks = 0;
  let cancelTick = () => {};
  const clock = () => {
    if ($untrack(R, () => $read(live))) {
      step();
      ticks++;
    }
    cancelTick = env.later((1000 / $untrack(R, () => $read(rate))) * env.pace, clock); // timer: feature, the feed's tick rate
  };

  // The frame loop: each animation frame publishes what changed and counts the page's frames.
  let frames = new Frames();
  let alive = true;
  let handle = 0;
  const raf = typeof view?.requestAnimationFrame === 'function' ? view : null;
  const loop = (/** @type {number} */ at) => {
    if (!alive) return;
    frames.add(at);
    publish();
    // timer: feature, the frame loop publishes once a frame and counts the page's frames.
    if (raf !== null) handle = raf.requestAnimationFrame(loop);
    else cancelLoop = env.later(16, () => loop(env.now())); // timer: fallback, the frame loop where the host has no requestAnimationFrame
  };
  let cancelLoop = () => {};

  // What the meters show, twice a second.
  const stats = $signal(R, /** @type {Stats | null} */ (null));
  let cancelStats = () => {};
  let since = env.now();
  /** How the shown Skia root rasterizes, as its renderer settled it (WebGL may be missing). */
  const rasterOf = () => {
    const m = $untrack(R, () => $read(mode));
    const r = m === 'compare' ? renderers.skiaChart : m === 'skia' ? renderers.skia : null;
    return r === null || r.closed ? null : r.gpu ? 'WebGL' : 'software';
  };
  const report = () => {
    const now = env.now();
    $write(stats, { page: frames.summary(), skia: costs.skia.summary(), dom: costs.dom.summary(), hz: (ticks * 1000) / Math.max(1, now - since), ticks: feed.ticks, mode: $untrack(R, () => $read(mode)), raster: rasterOf() });
    ticks = 0;
    since = now;
    cancelStats = env.later(500 * env.pace, report); // timer: feature, the stats readout's interval
  };
  if (props.manual !== true) {
    clock();
    // timer: feature, starts the frame loop.
    if (raf !== null) handle = raf.requestAnimationFrame(loop);
    else cancelLoop = env.later(16, () => loop(env.now())); // timer: fallback, the frame loop where the host has no requestAnimationFrame
    cancelStats = env.later(500 * env.pace, report); // timer: feature, the stats readout's interval
  }
  $cleanup(/** @type {any} */ ($owner(R)), () => {
    alive = false;
    if (raf !== null) raf.cancelAnimationFrame(handle);
    cancelLoop();
    cancelTick();
    cancelStats();
  });

  /** Starts the measurements afresh. */
  const reset = () => {
    costs.skia = new Cost();
    costs.dom = new Cost();
    frames = new Frames();
    $write(stats, null);
  };
  /** A new mode is measured on its own. @param {Mode} m */
  const show = m => {
    if ($untrack(R, () => $read(mode)) === m) return;
    reset();
    $write(mode, m);
  };
  /** So is a new raster. @param {'gpu' | 'cpu'} r */
  const rasterize = r => {
    if ($untrack(R, () => $read(raster)) === r) return;
    reset();
    $write(raster, r);
  };

  /** A root's message: a gesture on a chart, or a press on the desk. @param {any} data */
  const message = data => {
    if (data.gesture !== undefined) desk.gesture(data);
    else if (data.pick !== undefined) desk.pick(data.pick);
    else if (data.toggle !== undefined) desk.toggle(data.toggle);
    else if (data.tool !== undefined) desk.use(data.tool);
    else if (data.clear) desk.clear();
    else if (data.auto) desk.auto();
    else if (data.zoom === 'in') desk.zoomBy(0.8, plot());
    else if (data.zoom === 'out') desk.zoomBy(1.25, plot());
    else if (data.zoom === 'latest') desk.toLatest();
  };

  props.probe?.({ feed, desk, publish, step, renderers, costs, show });

  const failed = (/** @type {string} */ what) => (/** @type {Error} */ error) => <Label text={`${what} is unavailable: ${error.message}`} color={tone('danger')} />;
  const provide = () => /** @type {[any, any][]} */ ([
    [Look, theme],
    [Market, feed],
  ]);
  /** A Skia root, rasterizing as chosen; its renderer is kept for the measurements and theme changes. @param {'skia' | 'skiaChart'} which @param {number} width @param {number} height @param {string} id @param {() => any} content */
  const skiaRoot = (which, width, height, id, content) => {
    const { kit, font, mono } = /** @type {any} */ ($read(skia));
    const renderer = $skia(kit, { font, mono, width, height, scale: env.scale(), theme: theme.ren, gpu: $read(raster) === 'gpu' });
    renderers[which] = renderer;
    given.set(renderer, theme);
    return (
      <Root id={id} renderer={renderer} props={toSkia} provide={provide()} onMessage={message}>
        {content}
      </Root>
    );
  };
  /** A ren-dom root, in the theme's tokens. @param {'dom' | 'domChart'} which @param {string} id @param {() => any} content */
  const domRoot = (which, id, content) => {
    const renderer = $dom(doc, { theme: theme.ren, styles: true, ...env.fonts });
    renderers[which] = renderer;
    given.set(renderer, theme);
    return (
      <Root id={id} renderer={renderer} props={toDom} provide={provide()} onMessage={message}>
        {content}
      </Root>
    );
  };
  const shown = () => $read(stats);
  const cost = (/** @type {'skia' | 'dom'} */ which) => () => {
    const s = shown();
    if (s === null || s[which].frames === 0) return '–';
    const c = s[which];
    return `${ms(c.p50)} p50 · ${ms(c.p95)} p95 · ${ms(c.max)} max`;
  };
  const inMode = (/** @type {Mode} */ m) => () => String($read(mode) === m);
  const status = () => {
    $read(tick);
    const f = $read(current);
    const s = feed.series[f.symbol];
    return `${s.symbol.id} ${money(s.last, s.symbol.step)} · tick ${feed.ticks.toLocaleString('en-US')}`;
  };
  const copied = $signal(R, '');
  return (
    <div
      class="app-terminal"
      tabIndex={-1}
      data-mode={() => $read(mode)}
      data-view={() => { const f = $read(current); return `${f.end.toFixed(3)} ${f.count.toFixed(3)}`; }}
      data-cursor={() => { const c = $read(current).cursor; return c === null ? '' : `${c.pane} ${Math.round(c.x)} ${Math.round(c.y)}`; }}
      data-studies={() => Object.entries($read(current).studies).filter(([, on]) => on).map(([name]) => name).join(' ')}
      data-drawings={() => String($read(current).drawings.length)}
      data-tool={() => $read(current).tool}
      data-symbol={() => SYMBOLS[$read(current).symbol].id}
      data-stats={() => JSON.stringify(shown())}
      onKeyDown={(/** @type {KeyboardEvent} */ e) => {
        const target = /** @type {any} */ (e.target);
        // Fields keep their keys (the canvas's text entry too, while its Edit has focus).
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '') || target?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'p') {
          $write(live, !$read(live));
          e.preventDefault();
        } else if (desk.key(e.key, plot())) e.preventDefault();
      }}
    >
      <div class="term-bar">
        <div class="group">
          <small>Rendered by</small>
          <div class="seg" role="group" aria-label="Renderer">
            <button type="button" aria-pressed={inMode('skia')} onClick={() => show('skia')}>
              Skia
            </button>
            <button type="button" aria-pressed={inMode('dom')} onClick={() => show('dom')}>
              DOM
            </button>
            <button type="button" aria-pressed={inMode('compare')} onClick={() => show('compare')}>
              DOM vs Skia
            </button>
          </div>
        </div>
        <div class="group">
          <small>Skia raster</small>
          <div class="seg" role="group" aria-label="Skia raster">
            <button type="button" aria-pressed={() => String($read(raster) === 'gpu')} onClick={() => rasterize('gpu')}>
              WebGL
            </button>
            <button type="button" aria-pressed={() => String($read(raster) === 'cpu')} onClick={() => rasterize('cpu')}>
              Software
            </button>
          </div>
        </div>
        <div class="group">
          <small>Feed</small>
          <div class="seg" role="group" aria-label="Feed">
            <button type="button" aria-pressed={() => String(!$read(live))} onClick={() => $write(live, !$read(live))}>
              {() => ($read(live) ? 'Pause' : 'Resume')}
            </button>
            {RATES.map(hz => (
              <button type="button" aria-pressed={() => String($read(rate) === hz)} onClick={() => $write(rate, hz)}>
                {`${hz} Hz`}
              </button>
            ))}
          </div>
        </div>
        <div class="group">
          <small>Studies</small>
          <div class="seg" role="group" aria-label="Studies">
            {/** @type {const} */ (['sma', 'ema', 'bb', 'rsi']).map(name => (
              <button type="button" aria-pressed={() => String($read(current).studies[name])} onClick={() => desk.toggle(name)}>
                {LEGEND[name]}
              </button>
            ))}
          </div>
        </div>
        <div class="group grow">
          <small>Last</small>
          <span class="status">{status}</span>
        </div>
      </div>
      <div class="term-stage" ref={box.ref} data-stage={() => $read(mode)} data-layout={() => ($read(size).desk[0] < NARROW ? 'narrow' : 'wide')}>
        {() => {
          const m = $read(mode);
          const [deskWidth, deskHeight] = $read(size).desk;
          const [paneWidth, paneHeight] = $read(size).pane;
          if (m === 'dom')
            return (
              <div class="pane" data-side="dom" style={{ width: `${deskWidth}px`, height: `${deskHeight}px` }}>
                {domRoot('dom', 'terminal-dom', () => <Terminal width={deskWidth} height={deskHeight} />)}
              </div>
            );
          return (
            <Recover fallback={failed('Skia')}>
              <Pending fallback={<p class="quiet">Loading CanvasKit…</p>}>
                {() =>
                  m === 'skia' ? (
                    <div class="pane" data-side="skia" style={{ width: `${deskWidth}px`, height: `${deskHeight}px` }}>
                      {skiaRoot('skia', deskWidth, deskHeight, 'terminal-skia', () => <Terminal width={deskWidth} height={deskHeight} />)}
                    </div>
                  ) : (
                    <div class="versus">
                      <figure data-side="dom">
                        <figcaption>
                          <b>ren-dom</b> · SVG shapes and elements
                        </figcaption>
                        <div class="pane" style={{ width: `${paneWidth}px`, height: `${paneHeight}px` }}>
                          {domRoot('domChart', 'terminal-chart-dom', () => <Chart width={paneWidth} height={paneHeight} slim={deskWidth < NARROW} />)}
                        </div>
                        <p class="cost" data-cost="dom">{cost('dom')}</p>
                      </figure>
                      <figure data-side="skia">
                        <figcaption>
                          <b>ren-skia</b> · CanvasKit
                        </figcaption>
                        <div class="pane" style={{ width: `${paneWidth}px`, height: `${paneHeight}px` }}>
                          {skiaRoot('skiaChart', paneWidth, paneHeight, 'terminal-chart-skia', () => <Chart width={paneWidth} height={paneHeight} slim={deskWidth < NARROW} />)}
                        </div>
                        <p class="cost" data-cost="skia">{cost('skia')}</p>
                      </figure>
                    </div>
                  )
                }
              </Pending>
            </Recover>
          );
        }}
      </div>
      <div class="term-copy">
        <button
          type="button"
          onClick={() => {
            const m = $read(mode);
            const r = m === 'compare' ? renderers.skiaChart : renderers.skia;
            const text = m === 'dom' ? (view?.getSelection?.()?.toString() ?? '') : (r?.copied?.() ?? '');
            $write(copied, text || '(nothing selected)');
            if (text) view?.navigator?.clipboard?.writeText?.(text).catch(() => {});
          }}
        >
          Copy selection
        </button>
        <span class="copied" data-copied="">{() => $read(copied) || 'Select the readout (drag across it, or double press a value), then copy it.'}</span>
      </div>
      <section class="term-meters" aria-label="Measured">
        <Meter label="renderer" value={() => ({ skia: 'ren-skia · CanvasKit', dom: 'ren-dom', compare: 'ren-dom and ren-skia, same frames' })[$read(mode)]} />
        <Meter label="feed" value={() => { const s = shown(); return s === null ? '–' : `${s.hz.toFixed(1)} ticks/s`; }} />
        <Meter label="skia raster" value={() => shown()?.raster ?? '–'} />
        <Meter label="skia frame" value={cost('skia')} />
        <Meter label="skia repaint" value={() => { const s = shown()?.skia; return s == null || s.frames === 0 ? '–' : `${s.damage} damage · ${s.full} full · ${s.none} none`; }} />
        <Meter label="dom frame" value={cost('dom')} />
        <Meter label="page frames" value={() => { const s = shown(); return s === null || s.page.frames === 0 ? '–' : `${s.page.fps.toFixed(1)} fps · ${ms(s.page.p50)} p50 · ${ms(s.page.p95)} p95`; }} />
        <Meter label="late frames" value={() => { const s = shown(); return s === null || s.page.frames === 0 ? '–' : `${s.page.late} of ${s.page.frames}`; }} />
      </section>
      <p class="term-note">
        A frame's cost runs from the props write to the end of that root's work. Skia: the flush, layout, paint and CanvasKit's drawing, on this thread; through WebGL the GPU finishes the drawing afterwards, and where the browser composites in software it waits for it at the next commit, which only the page frames show (compare the Software raster). DOM: the flush, the DOM writes and a forced style and layout; the browser paints and composites afterwards, which only the page frames show. Keys: arrows pan and zoom, S E B R studies, T trend line, H horizontal line, Esc crosshair, Del removes drawings, A auto scale, End latest, 1–5 symbols, P pauses.
      </p>
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
  id: 'terminal',
  title: 'Terminal',
  tagline: 'A market terminal on a Skia canvas, measured against the DOM',
  apis: ['$skia', '$dom', 'Root', 'Props', 'Send', 'provide', 'onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerLeave', 'onPointerCancel', 'touchAction', '$media', '$viewport', 'onWheel', 'setPointerCapture', 'preventDefault', 'cursor', 'setTheme', 'gpu', 'repaint', 'copied', 'text selection', '$defer', '$memo', '$equals', '$untrack', '$task', 'For', 'For by position', 'Show', 'Pending', 'Recover', 'View', 'Label', 'Shape', 'Action', 'Edit', 'style', 'display: grid'],
  summary:
    'Five symbols, 50,000 seeded one-minute candles and a live feed at 20 to 60 ticks a second. The watchlist with sparklines, the candlestick chart with volume, SMA, EMA, Bollinger bands and an RSI pane, the order book and the trades tape are portable primitives drawn by ren-skia on a CanvasKit canvas: drag to pan, wheel to zoom (Ctrl for a pinch), drag the price axis to scale, hover for the crosshair (it goes when the pointer leaves the plot), draw trend and horizontal lines, select the readout to copy it. The same component renders on ren-dom, and the chart renders on both side by side from the same frames, each frame timed per renderer.',
  View,
};
