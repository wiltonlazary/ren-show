// Terminal's chart math, pure functions over a series' columns: the
// studies (SMA, EMA, Bollinger bands, RSI) computed over the visible window
// only (with the warm-up each needs), the time and price scales, the axes'
// ticks, the view's pan and zoom, and the figures of ren-core's `Shape`
// primitive that draw the window (candles, volume, studies, drawings, the
// crosshair). Colors are ARGB numbers made from the theme's palette.

import { MINUTE } from './market.js';

/** A shape of ren-core's Shape primitive. @typedef {Record<string, unknown>} Figure */

/** A column of numbers. @typedef {ArrayLike<number>} Column */

/** The studies' periods. */
export const PERIODS = { sma: 20, ema: 50, bb: 20, rsi: 14 };

/** Bollinger bands' width, in standard deviations. */
export const BAND = 2;

/** Candles a view shows, at most and at least. */
export const ZOOM = { min: 12, max: 1200 };

/** The chart's fixed parts, in logical pixels: the readout row, the price axis, the time axis. */
export const READOUT = 26;
export const AXIS = 64;
export const TIME = 22;
/**
 * A slim chart (a phone's) shows its readout on two rows: the symbol with
 * open, high, low and close, then the volume, the change and the studies.
 * @param {boolean} slim
 */
export const readoutOf = slim => (slim ? 2 * READOUT - 6 : READOUT);

/** The share of the main pane the volume bars may reach. */
export const VOLUME = 0.18;

/**
 * The simple moving average of `values` over `period`, for indices
 * [from, to): NaN where fewer than `period` values lead up to it.
 * @param {Column} values @param {number} period @param {number} from @param {number} to
 * @returns {Float64Array}
 */
export function sma(values, period, from, to) {
  const out = new Float64Array(Math.max(0, to - from)).fill(NaN);
  const start = Math.max(0, from - period + 1);
  let sum = 0;
  for (let i = start; i < to; i++) {
    sum += values[i];
    if (i - start >= period) sum -= values[i - period];
    if (i >= from && i - period + 1 >= 0) out[i - from] = sum / period;
  }
  return out;
}

/** How far back the recursive studies start, in periods: their weight there is below e⁻²⁰. */
export const WARM = 20;

/**
 * The exponential moving average (α = 2 / (period + 1)) for [from, to),
 * seeded with the SMA of its first period, starting WARM periods before
 * `from` (so it equals the whole series' EMA to about 1e-9 of the values).
 * NaN before the first full period.
 * @param {Column} values @param {number} period @param {number} from @param {number} to
 * @returns {Float64Array}
 */
export function ema(values, period, from, to) {
  const out = new Float64Array(Math.max(0, to - from)).fill(NaN);
  const start = Math.max(0, from - period * WARM);
  if (to - start < period) return out;
  const k = 2 / (period + 1);
  let e = 0;
  for (let i = start; i < start + period; i++) e += values[i];
  e /= period;
  const first = start + period - 1;
  if (first >= from) out[first - from] = e;
  for (let i = first + 1; i < to; i++) {
    e += (values[i] - e) * k;
    if (i >= from) out[i - from] = e;
  }
  return out;
}

/**
 * Bollinger bands for [from, to): the SMA and `width` population standard
 * deviations above and below it.
 * @param {Column} values @param {number} period @param {number} width @param {number} from @param {number} to
 * @returns {{ mid: Float64Array, upper: Float64Array, lower: Float64Array }}
 */
export function bollinger(values, period, width, from, to) {
  const mid = sma(values, period, from, to);
  const upper = new Float64Array(mid.length).fill(NaN);
  const lower = new Float64Array(mid.length).fill(NaN);
  for (let i = from; i < to; i++) {
    const m = mid[i - from];
    if (Number.isNaN(m)) continue;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j] - m) ** 2;
    const d = Math.sqrt(v / period) * width;
    upper[i - from] = m + d;
    lower[i - from] = m - d;
  }
  return { mid, upper, lower };
}

/**
 * Wilder's relative strength index for [from, to), 0 to 100: averages of
 * gains and losses seeded with their mean over the first period, starting
 * WARM periods before `from`. NaN until a period of changes.
 * @param {Column} values @param {number} period @param {number} from @param {number} to
 * @returns {Float64Array}
 */
export function rsi(values, period, from, to) {
  const out = new Float64Array(Math.max(0, to - from)).fill(NaN);
  const start = Math.max(0, from - period * WARM);
  if (to - start <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = start + 1; i <= start + period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const index = (/** @type {number} */ g, /** @type {number} */ l) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  if (start + period >= from) out[start + period - from] = index(gain, loss);
  for (let i = start + period + 1; i < to; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    if (i >= from) out[i - from] = index(gain, loss);
  }
  return out;
}

/**
 * The view of a chart: the (fractional) index at its right edge and how many
 * candles it spans.
 * @typedef {{ end: number, count: number }} View
 */

/**
 * The visible window: the candles [from, to) that fall in the view, each
 * `width` pixels wide, the first slot's index `start`.
 * @typedef {{ from: number, to: number, start: number, width: number }} Window
 */

/**
 * The window a view shows over a plot `w` pixels wide.
 * @param {View} view @param {number} length the series' length @param {number} w
 * @returns {Window}
 */
export function windowOf(view, length, w) {
  const start = view.end - view.count;
  return { from: Math.max(0, Math.floor(start)), to: Math.max(0, Math.min(length, Math.ceil(view.end))), start, width: w / view.count };
}

/** The x of a candle's centre. @param {Window} win @param {number} i */
export const xOf = (win, i) => (i + 0.5 - win.start) * win.width;

/** The (fractional) index at an x. @param {Window} win @param {number} x */
export const indexAt = (win, x) => win.start + x / win.width - 0.5;

/** A price range. @typedef {{ lo: number, hi: number }} Range */

/**
 * The auto scale: the lows and highs of the window, padded by 8% of their
 * span (at least one price step), so the candles never touch the edges.
 * @param {{ low: Column, high: Column }} s @param {Window} win @param {number} step
 * @returns {Range}
 */
export function autoRange(s, win, step) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = win.from; i < win.to; i++) {
    if (s.low[i] < lo) lo = s.low[i];
    if (s.high[i] > hi) hi = s.high[i];
  }
  if (lo === Infinity) return { lo: 0, hi: 1 };
  const pad = Math.max(step, (hi - lo) * 0.08);
  return { lo: lo - pad, hi: hi + pad };
}

/** The y of a price in a pane `h` high. @param {Range} r @param {number} h @param {number} price */
export const yOf = (r, h, price) => ((r.hi - price) / (r.hi - r.lo)) * h;

/** The price at a y. @param {Range} r @param {number} h @param {number} y */
export const priceAt = (r, h, y) => r.hi - (y / h) * (r.hi - r.lo);

/** A round step at or above `x`: 1, 2, 2.5 or 5 times a power of ten. @param {number} x */
export function nice(x) {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/**
 * The price axis's ticks: round prices about `gap` pixels apart in a pane
 * `h` high, with the decimals their step needs.
 * @param {Range} r @param {number} h @param {number} [gap]
 * @returns {{ prices: number[], decimals: number }}
 */
export function priceTicks(r, h, gap = 46) {
  const step = nice(((r.hi - r.lo) * gap) / Math.max(1, h));
  const prices = [];
  for (let p = Math.ceil(r.lo / step) * step; p <= r.hi; p += step) prices.push(Math.round(p / step) * step);
  // A step of m × 10^e shows -e decimals, one more for 2.5.
  const e = Math.floor(Math.log10(step) + 1e-9);
  const half = Math.abs(step / 10 ** e - 2.5) < 1e-9 ? 1 : 0;
  return { prices, decimals: Math.min(6, Math.max(0, half - e)) };
}

/** The time axis's steps, in minutes. */
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440, 2880, 10080];

/**
 * The time axis's ticks: candles on round minutes at least `gap` pixels
 * apart, each with its label (the date at a day's start, else HH:MM).
 * @param {{ time: Column }} s @param {Window} win @param {number} [gap]
 * @returns {{ index: number, text: string }[]}
 */
export function timeTicks(s, win, gap = 84) {
  const minutes = STEPS.find(m => m * win.width >= gap) ?? STEPS[STEPS.length - 1];
  const out = [];
  const every = minutes * MINUTE;
  for (let i = win.from; i < win.to; i++) {
    const t = s.time[i];
    if (t % every !== 0) continue;
    const d = new Date(t);
    const midnight = t % (1440 * MINUTE) === 0;
    out.push({ index: i, text: midnight ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` });
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** @param {number} n */
const pad = n => String(n).padStart(2, '0');

/** A candle's time as `Sep 25 14:05`. @param {number} t */
export function stamp(t) {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * A view moved `dx` pixels to the right (the content follows the pointer:
 * dragging right shows earlier candles), kept where some candles show.
 * @param {View} view @param {number} dx @param {number} w the plot's width @param {number} length
 * @returns {View}
 */
export function pan(view, dx, w, length) {
  return clampView({ end: view.end - (dx / w) * view.count, count: view.count }, length);
}

/**
 * A view zoomed by `factor` (above 1 shows more candles) around the x
 * `anchor`, keeping the candle under it where it is.
 * @param {View} view @param {number} factor @param {number} anchor @param {number} w @param {number} length
 * @returns {View}
 */
export function zoom(view, factor, anchor, w, length) {
  const count = Math.min(ZOOM.max, Math.max(ZOOM.min, view.count * factor));
  const at = view.end - view.count + (anchor / w) * view.count;
  return clampView({ end: at + ((w - anchor) / w) * count, count }, length);
}

/** A view kept over the data: its right edge between a fifth of it in and 80% of it past the last candle. @param {View} view @param {number} length */
export function clampView(view, length) {
  const count = Math.min(ZOOM.max, Math.max(ZOOM.min, view.count));
  const end = Math.min(length + count * 0.8, Math.max(count * 0.2, view.end));
  return { end, count };
}

/** The view that shows the latest `count` candles, with a margin on the right. @param {number} length @param {number} [count] */
export const latest = (length, count = 120) => ({ end: length + Math.max(3, count * 0.06), count });

/** A color with another alpha (0–255). @param {number} color @param {number} alpha */
export const fade = (color, alpha) => (((alpha & 255) << 24) | (color & 0xffffff)) >>> 0;

/** `#rrggbb` as an opaque ARGB number. @param {string} hex */
export const argb = hex => (0xff000000 | parseInt(hex.slice(1, 7), 16)) >>> 0;

/**
 * The palette a chart draws with, as ARGB numbers, from the theme: candles
 * up in its second series color and down in its danger color.
 * @typedef {object} Paint
 * @property {number} up
 * @property {number} down
 * @property {number} grid
 * @property {number} ink
 * @property {number} muted
 * @property {number} accent
 * @property {number} sma
 * @property {number} ema
 * @property {number} bb
 * @property {number} rsi
 * @property {number} surface
 */

/** @param {import('../../themes.js').Palette} c @returns {Paint} */
export const paintOf = c => ({
  up: argb(c.series[1]),
  down: argb(c.danger),
  grid: argb(c.rule),
  ink: argb(c.ink),
  muted: argb(c.muted),
  accent: argb(c.accent),
  sma: argb(c.series[0]),
  ema: argb(c.series[2]),
  bb: argb(c.series[4]),
  rsi: argb(c.series[5]),
  surface: argb(c.surface),
});

/** Two decimals are plenty for a picture. @param {number} x */
const round = x => Math.round(x * 100) / 100;

/**
 * The candles of a window as figures: a wick line and a body per candle
 * (a line when the body is thinner than a pixel), up or down colored.
 * @param {{ open: Column, high: Column, low: Column, close: Column }} s @param {Window} win @param {Range} r @param {number} h @param {Paint} paint
 * @returns {Figure[]}
 */
export function candles(s, win, r, h, paint) {
  /** @type {Figure[]} */
  const out = [];
  const body = Math.max(1, win.width * 0.68);
  for (let i = win.from; i < win.to; i++) {
    const x = round(xOf(win, i));
    const o = s.open[i];
    const c = s.close[i];
    const color = c >= o ? paint.up : paint.down;
    const top = round(yOf(r, h, Math.max(o, c)));
    const bottom = Math.max(top + 1, round(yOf(r, h, Math.min(o, c))));
    out.push({ kind: 'line', x, y: round(yOf(r, h, s.high[i])), right: x, bottom: round(yOf(r, h, s.low[i])), color, stroke: 1 });
    if (body > 2) out.push({ kind: 'rect', x: round(x - body / 2), y: top, right: round(x + body / 2), bottom, color });
    else out.push({ kind: 'line', x, y: top, right: x, bottom, color, stroke: Math.max(1, body) });
  }
  return out;
}

/**
 * Volume bars along the bottom of a pane `h` high: `top` (by default the
 * window's busiest candle) reaches VOLUME of it, and no bar goes higher.
 * @param {{ open: Column, close: Column, volume: Column }} s @param {Window} win @param {number} h @param {Paint} paint @param {number} [top]
 * @returns {Figure[]}
 */
export function volumes(s, win, h, paint, top = 0) {
  if (top === 0) for (let i = win.from; i < win.to; i++) if (s.volume[i] > top) top = s.volume[i];
  if (top === 0) return [];
  const band = h * VOLUME;
  const body = Math.max(1, win.width * 0.68);
  /** @type {Figure[]} */
  const out = [];
  const up = fade(paint.up, 0x55);
  const down = fade(paint.down, 0x55);
  for (let i = win.from; i < win.to; i++) {
    const x = xOf(win, i);
    const y = round(h - Math.min(1, s.volume[i] / top) * band);
    out.push({ kind: 'rect', x: round(x - body / 2), y, right: round(x + body / 2), bottom: h, color: s.close[i] >= s.open[i] ? up : down });
  }
  return out;
}

/**
 * A study's line over the window: one open path per run of defined values.
 * @param {Float64Array} values the study for [win.from, win.to) @param {Window} win @param {(v: number) => number} y @param {number} color @param {number} [width]
 * @returns {Figure[]}
 */
export function line(values, win, y, color, width = 1.5) {
  /** @type {Figure[]} */
  const out = [];
  /** @type {number[]} */
  let points = [];
  const flush = () => {
    if (points.length >= 4) out.push({ kind: 'path', points, closed: false, color, stroke: width });
    points = [];
  };
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (Number.isNaN(v)) flush();
    else points.push(round(xOf(win, win.from + k)), round(y(v)));
  }
  flush();
  return out;
}

/**
 * The area between two study lines (Bollinger's band), as closed paths.
 * @param {Float64Array} upper @param {Float64Array} lower @param {Window} win @param {(v: number) => number} y @param {number} color
 * @returns {Figure[]}
 */
export function band(upper, lower, win, y, color) {
  /** @type {number[]} */
  const top = [];
  /** @type {number[]} */
  const bottom = [];
  for (let k = 0; k < upper.length; k++) {
    if (Number.isNaN(upper[k])) continue;
    const x = round(xOf(win, win.from + k));
    top.push(x, round(y(upper[k])));
    bottom.push(x, round(y(lower[k])));
  }
  if (top.length < 4) return [];
  for (let i = bottom.length - 2; i >= 0; i -= 2) top.push(bottom[i], bottom[i + 1]);
  return [{ kind: 'path', points: top, closed: true, color }];
}

/** Figures moved `dx` pixels right (into a Shape whose box starts `-dx` in). @param {Figure[]} figures @param {number} dx @returns {Figure[]} */
export function shift(figures, dx) {
  return figures.map(f => {
    if (Array.isArray(f.points)) return { ...f, points: f.points.map((/** @type {number} */ v, /** @type {number} */ k) => (k % 2 === 0 ? round(v + dx) : v)) };
    return { ...f, x: round(/** @type {number} */ (f.x) + dx), right: round(/** @type {number} */ (f.right) + dx) };
  });
}

/** Horizontal grid lines at prices and vertical ones at candles. @param {number[]} ys @param {number[]} xs @param {number} w @param {number} h @param {number} color @returns {Figure[]} */
export function grid(ys, xs, w, h, color) {
  /** @type {Figure[]} */
  const out = [];
  for (const y of ys) out.push({ kind: 'line', x: 0, y: round(y), right: w, bottom: round(y), color, stroke: 1 });
  for (const x of xs) out.push({ kind: 'line', x: round(x), y: 0, right: round(x), bottom: h, color, stroke: 1 });
  return out;
}

/**
 * A drawing on the chart, anchored to data: a trend line between two
 * (index, price) points, or a horizontal line at a price.
 * @typedef {{ id: number, kind: 'trend', a: { i: number, p: number }, b: { i: number, p: number } } | { id: number, kind: 'level', p: number }} Drawing
 */

/**
 * The drawings as figures over the window: trend lines between their
 * anchors (with a dot at each), levels across the plot.
 * @param {readonly Drawing[]} drawings @param {Window} win @param {Range} r @param {number} w @param {number} h @param {number} color
 * @returns {Figure[]}
 */
export function drawn(drawings, win, r, w, h, color) {
  /** @type {Figure[]} */
  const out = [];
  for (const d of drawings) {
    if (d.kind === 'level') {
      const y = round(yOf(r, h, d.p));
      if (y >= 0 && y <= h) out.push({ kind: 'line', x: 0, y, right: w, bottom: y, color, stroke: 2 });
      continue;
    }
    const x0 = round(xOf(win, d.a.i));
    const y0 = round(yOf(r, h, d.a.p));
    const x1 = round(xOf(win, d.b.i));
    const y1 = round(yOf(r, h, d.b.p));
    out.push({ kind: 'line', x: x0, y: y0, right: x1, bottom: y1, color, stroke: 2 });
    for (const [x, y] of [[x0, y0], [x1, y1]]) out.push({ kind: 'oval', x: x - 3.5, y: y - 3.5, right: x + 3.5, bottom: y + 3.5, color });
  }
  return out;
}

/**
 * The layout of a chart `width` × `height`: the plot's width, and the main
 * and RSI panes' heights (the RSI pane takes a quarter when shown), under
 * a readout of one row, or two on a slim chart.
 * @param {number} width @param {number} height @param {boolean} rsi @param {boolean} [slim]
 */
export function panes(width, height, rsi, slim = false) {
  const body = height - readoutOf(slim) - TIME;
  const lower = rsi ? Math.round(body * 0.26) : 0;
  return { plot: width - AXIS, main: body - lower, lower };
}
