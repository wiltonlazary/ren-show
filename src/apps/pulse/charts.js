// Pulse's charts as ren-core shapes: pure functions from readings to the
// `shapes` list of a `Shape` primitive (lines, paths, areas and bars in a
// fixed coordinate box). Colors are ARGB numbers made from the theme's
// palette, which reaches the application through its root's props.

import { BUCKETS, BINS } from './engine.js';

/**
 * The palette a chart draws with, as ARGB numbers.
 * @typedef {object} Paint
 * @property {number[]} series the theme's six series colors
 * @property {number} accent
 * @property {number} danger
 * @property {number} muted
 * @property {number} rule
 * @property {number} ink
 */

/** A shape of ren-core's Shape primitive. @typedef {Record<string, unknown>} Figure */

/**
 * `#rgb` or `#rrggbb` as ARGB with `alpha` (0–255); anything else reads as
 * mid grey, so a palette entry that is not hex still draws.
 * @param {string | undefined} hex @param {number} [alpha]
 */
export function argb(hex, alpha = 255) {
  let rgb = 0x808080;
  if (typeof hex === 'string' && hex[0] === '#') {
    const body = hex.length === 4 ? hex.slice(1).replace(/./g, c => c + c) : hex.slice(1, 7);
    const n = parseInt(body, 16);
    if (Number.isFinite(n)) rgb = n;
  }
  return ((alpha << 24) | rgb) >>> 0;
}

/** The same color with another alpha. @param {number} color @param {number} alpha */
export const fade = (color, alpha) => (((alpha & 255) << 24) | (color & 0xffffff)) >>> 0;

/** A round axis maximum at or above `x`: 1, 2, 2.5 or 5 times a power of ten. @param {number} x */
export function nice(x) {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** The largest value of some columns. @param {ArrayLike<number>[]} columns */
function most(columns) {
  let m = 0;
  for (const c of columns) for (let i = 0; i < c.length; i++) if (c[i] > m) m = c[i];
  return m;
}

/**
 * A polyline's points over a box: values spread evenly across `w`, 0 at
 * `h` and `max` at `top`.
 * @param {ArrayLike<number>} values @param {number} w @param {number} h @param {number} max @param {number} [top]
 * @returns {number[]}
 */
export function trace(values, w, h, max, top = 0) {
  const n = values.length;
  /** @type {number[]} */
  const out = new Array(n * 2);
  const dx = n > 1 ? w / (n - 1) : 0;
  const k = (h - top) / (max || 1);
  for (let i = 0; i < n; i++) {
    out[2 * i] = round(i * dx);
    out[2 * i + 1] = round(h - Math.min(values[i], max) * k);
  }
  return out;
}

/** Two decimals are plenty for a picture, and keep the wire short. @param {number} x */
const round = x => Math.round(x * 100) / 100;

/**
 * The closed area between two traces of equal length (`upper` left to
 * right, then `lower` back).
 * @param {number[]} upper @param {number[]} lower
 */
function between(upper, lower) {
  const points = upper.slice();
  for (let i = lower.length - 2; i >= 0; i -= 2) points.push(lower[i], lower[i + 1]);
  return points;
}

/** The area under a trace down to `h`. @param {number[]} line @param {number} w @param {number} h */
function under(line, w, h) {
  return [...line, w, h, 0, h];
}

/** Sparkline box. */
export const SPARK = { w: 160, h: 40 };

/**
 * A KPI tile's sparkline: a soft area, the line, and the newest point.
 * @param {number[]} values @param {number} color @param {number} [floor] the axis minimum's share of the maximum
 * @returns {Figure[]}
 */
export function sparkline(values, color, floor = 0) {
  const { w, h } = SPARK;
  if (values.length < 2) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // Scale to the samples' own band, so a steady metric still shows its motion.
  const base = floor > 0 ? Math.min(lo, hi * floor) : lo - (hi - lo) * 0.25;
  const span = hi - base || 1;
  const shifted = values.map(v => v - base);
  const line = trace(shifted, w, h - 3, span * 1.08, 0);
  const x = line[line.length - 2];
  const y = line[line.length - 1];
  return [
    { kind: 'path', points: under(line, w, h), closed: true, color: fade(color, 0x30) },
    { kind: 'path', points: line, closed: false, color, stroke: 1.5 },
    { kind: 'oval', x: x - 2.5, y: y - 2.5, right: x + 2.5, bottom: y + 2.5, color },
  ];
}

/** The latency chart's box. */
export const LATENCY = { w: 720, h: 220 };

/**
 * The latency chart: gridlines, the p50–p99 and p50–p95 bands, the three
 * percentile lines, deploy markers, and the crosshair at `hover`.
 * @param {import('./engine.js').Series} s @param {Paint} paint @param {number} hover a bucket, or -1
 * @param {number[]} deploys deploy times in the series' span
 * @returns {{ figures: Figure[], max: number }}
 */
export function latency(s, paint, hover, deploys) {
  const { w, h } = LATENCY;
  const max = nice(most([s.p99]) * 1.08);
  /** @type {Figure[]} */
  const figures = grid(w, h, paint);
  const p50 = trace(s.p50, w, h, max);
  const p95 = trace(s.p95, w, h, max);
  const p99 = trace(s.p99, w, h, max);
  const [one, two, , , five] = paint.series;
  figures.push(
    { kind: 'path', points: between(p99, p50), closed: true, color: fade(five, 0x1c) },
    { kind: 'path', points: between(p95, p50), closed: true, color: fade(two, 0x30) },
    { kind: 'path', points: p99, closed: false, color: five, stroke: 1.5 },
    { kind: 'path', points: p95, closed: false, color: two, stroke: 1.5 },
    { kind: 'path', points: p50, closed: false, color: one, stroke: 2 },
  );
  const span = s.step * (BUCKETS - 1);
  for (const at of deploys) {
    const x = round(((at - s.time[0]) / span) * w);
    if (x < 0 || x > w) continue;
    figures.push({ kind: 'line', x, y: 10, right: x, bottom: h, color: fade(paint.accent, 0x90), stroke: 1 });
    figures.push({ kind: 'path', points: [x - 5, 0, x + 5, 0, x, 8], closed: true, color: paint.accent });
  }
  if (hover >= 0) cross(figures, hover, w, h, paint, [
    [p50, one],
    [p95, two],
    [p99, five],
  ]);
  return { figures, max };
}

/** The throughput chart's box. */
export const THROUGHPUT = { w: 720, h: 150 };

/**
 * Requests per second as an area, errors per second as bars along the
 * bottom (on their own scale), and the crosshair.
 * @param {import('./engine.js').Series} s @param {Paint} paint @param {number} hover
 * @returns {{ figures: Figure[], max: number, errors: number }}
 */
export function throughput(s, paint, hover) {
  const { w, h } = THROUGHPUT;
  const max = nice(most([s.rps]) * 1.1);
  const figures = grid(w, h, paint);
  const line = trace(s.rps, w, h, max);
  const color = paint.series[1];
  figures.push({ kind: 'path', points: under(line, w, h), closed: true, color: fade(color, 0x2a) }, { kind: 'path', points: line, closed: false, color, stroke: 1.5 });
  // Errors per second, scaled so the worst bucket reaches a third of the height.
  let errors = 0;
  for (let i = 0; i < BUCKETS; i++) errors = Math.max(errors, s.rps[i] * s.errors[i]);
  const top = nice(errors * 1.05);
  const band = h / 3;
  const dx = w / (BUCKETS - 1);
  // One closed path of bars (down to the axis between them): one shape, not sixty.
  /** @type {number[]} */
  const bars = [0, h];
  for (let i = 0; i < BUCKETS; i++) {
    const y = round(h - ((s.rps[i] * s.errors[i]) / top) * band);
    const x = i * dx;
    const left = round(Math.max(0, x - dx * 0.32));
    const right = round(Math.min(w, x + dx * 0.32));
    bars.push(left, h, left, y, right, y, right, h);
  }
  bars.push(w, h);
  figures.push({ kind: 'path', points: bars, closed: true, color: fade(paint.danger, 0xc0) });
  if (hover >= 0) cross(figures, hover, w, h, paint, [[line, color]]);
  return { figures, max, errors: top };
}

/** Horizontal gridlines at quarters. @param {number} w @param {number} h @param {Paint} paint @returns {Figure[]} */
function grid(w, h, paint) {
  /** @type {Figure[]} */
  const out = [];
  for (let i = 0; i <= 4; i++) {
    const y = round((h * i) / 4);
    out.push({ kind: 'line', x: 0, y: Math.min(h - 0.5, Math.max(0.5, y)), right: w, bottom: Math.min(h - 0.5, Math.max(0.5, y)), color: paint.rule, stroke: 1 });
  }
  return out;
}

/**
 * A crosshair at bucket `i` and a dot on each trace.
 * @param {Figure[]} figures @param {number} i @param {number} w @param {number} h @param {Paint} paint @param {[number[], number][]} traces
 */
function cross(figures, i, w, h, paint, traces) {
  const x = round((i * w) / (BUCKETS - 1));
  figures.push({ kind: 'line', x, y: 0, right: x, bottom: h, color: fade(paint.ink, 0x70), stroke: 1 });
  for (const [points, color] of traces) {
    const y = points[2 * i + 1];
    figures.push({ kind: 'oval', x: x - 4, y: y - 4, right: x + 4, bottom: y + 4, color }, { kind: 'oval', x: x - 4, y: y - 4, right: x + 4, bottom: y + 4, color: paint.ink, stroke: 1 });
  }
}

/** The histogram's box. */
export const HISTOGRAM = { w: 360, h: 150 };

/**
 * The latency histogram: one bar per bin, bins past the p99 in the danger
 * color, and a marker at each percentile.
 * @param {number[]} shares each bin's share of requests @param {{ p50: number, p95: number, p99: number }} live @param {Paint} paint
 * @returns {Figure[]}
 */
export function histogram(shares, live, paint) {
  const { w, h } = HISTOGRAM;
  const n = shares.length;
  const top = nice(Math.max(...shares) * 1.1);
  const slot = w / n;
  /** @type {Figure[]} */
  const figures = [{ kind: 'line', x: 0, y: h - 0.5, right: w, bottom: h - 0.5, color: paint.rule, stroke: 1 }];
  for (let i = 0; i < n; i++) {
    const lo = i === 0 ? 0 : BINS[i - 1];
    const color = lo >= live.p99 ? paint.danger : lo >= live.p95 ? paint.series[4 % paint.series.length] : paint.series[0];
    const y = round(h - (shares[i] / top) * (h - 6));
    figures.push({ kind: 'round', x: round(i * slot + 1.5), y: Math.min(y, h - 1), right: round((i + 1) * slot - 1.5), bottom: h, radius: 2, color: fade(color, lo >= live.p95 ? 0xe0 : 0xb0) });
  }
  // Percentile markers, placed within their bin by linear interpolation.
  const at = (/** @type {number} */ ms) => {
    for (let i = 0; i < n; i++) {
      const lo = i === 0 ? 0 : BINS[i - 1];
      const hi = BINS[i] === Infinity ? lo * 2 : BINS[i];
      if (ms < hi) return round((i + (ms - lo) / (hi - lo)) * slot);
    }
    return w;
  };
  for (const [ms, color] of /** @type {[number, number][]} */ ([
    [live.p50, paint.series[0]],
    [live.p95, paint.series[1]],
    [live.p99, paint.danger],
  ])) {
    const x = at(ms);
    figures.push({ kind: 'line', x, y: 0, right: x, bottom: h, color, stroke: 1.5 });
  }
  return figures;
}

/** A region's bar box. */
export const BAR = { w: 200, h: 10 };

/**
 * A region's share of traffic as a bar on a track, its errors as a red cap.
 * @param {number} share 0–1 of the busiest region @param {number} errors a fraction @param {Paint} paint @param {number} color
 * @returns {Figure[]}
 */
export function bar(share, errors, paint, color) {
  const { w, h } = BAR;
  const x = round(Math.max(4, share * w));
  const bad = round(Math.min(x, Math.max(errors > 0.02 ? 3 : 0, errors * 4 * w)));
  /** @type {Figure[]} */
  const out = [
    { kind: 'round', x: 0, y: 0, right: w, bottom: h, radius: 5, color: fade(paint.muted, 0x26) },
    { kind: 'round', x: 0, y: 0, right: x, bottom: h, radius: 5, color },
  ];
  if (bad > 0) out.push({ kind: 'round', x: round(x - bad), y: 0, right: x, bottom: h, radius: 5, color: paint.danger });
  return out;
}
