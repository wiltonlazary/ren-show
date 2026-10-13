// Terminal's desk: what the trader has set up, and the gestures that change
// it, in plain JavaScript. The page owns one desk; every chart root (Skia,
// the DOM, both) shows the `Frame` it publishes as props, and sends its
// pointer gestures and presses back as messages, which the desk turns into
// a new view (pan, zoom, price scale), a crosshair, a drawing or a setting.
// Gestures carry their pane's size, so the desk needs no layout of its own.

import { windowOf, autoRange, clampView, pan, zoom, latest, indexAt, priceAt, PERIODS } from './chart.js';
import { SYMBOLS } from './market.js';

/** @typedef {import('./chart.js').View} View */
/** @typedef {import('./chart.js').Range} Range */
/** @typedef {import('./chart.js').Drawing} Drawing */

/** The studies shown. @typedef {{ sma: boolean, ema: boolean, bb: boolean, rsi: boolean }} Studies */

/** The drawing tools. @typedef {'cursor' | 'trend' | 'level'} Tool */

/**
 * The crosshair: where the pointer is, in a pane's own pixels.
 * @typedef {{ x: number, y: number, pane: 'main' | 'lower' }} Cursor
 */

/**
 * What each chart root receives as props: the whole picture, small and
 * plain (the candles themselves are read from the shared feed).
 * @typedef {object} Frame
 * @property {number} tick the feed's tick it shows
 * @property {number} symbol the symbol's index
 * @property {number} end the view's right edge (a fractional candle index)
 * @property {number} count candles in view
 * @property {Range | null} range the price scale, or null for auto
 * @property {Studies} studies
 * @property {Tool} tool
 * @property {readonly Drawing[]} drawings the symbol's drawings
 * @property {Drawing | null} draft the drawing being drawn
 * @property {Cursor | null} cursor
 * @property {import('../../themes.js').Theme=} theme the theme to draw in (the page adds it as it publishes)
 */

/**
 * A gesture a chart sends: a pointer event on one of its panes, in that
 * pane's pixels, with the pane's size.
 * @typedef {object} Gesture
 * @property {'down' | 'move' | 'up' | 'wheel' | 'leave'} gesture
 * @property {'main' | 'lower' | 'axis'} pane
 * @property {number} x
 * @property {number} y
 * @property {number} w the plot's width
 * @property {number} h the pane's height
 * @property {number=} buttons
 * @property {number=} dx
 * @property {number=} dy
 * @property {boolean=} zoom a pinch: the wheel with Ctrl or Cmd
 */

/** Pixels a trend line must span to be kept. */
const SPAN = 4;

/** The feed the desk reads lengths and prices from (a `Feed`, or anything with its series). @typedef {{ series: import('./market.js').Series[] }} Source */

export class Desk {
  /** @param {Source} feed */
  constructor(feed) {
    this.feed = feed;
    this.symbol = 0;
    /** Each symbol's view. @type {View[]} */
    this.views = feed.series.map(s => latest(s.length));
    /** Each symbol's manual price scale, or null for auto. @type {(Range | null)[]} */
    this.ranges = feed.series.map(() => null);
    /** Each series' length when the desk last looked. */
    this.lengths = feed.series.map(s => s.length);
    /** @type {Studies} */
    this.studies = { sma: true, ema: false, bb: false, rsi: true };
    /** @type {Tool} */
    this.tool = 'cursor';
    /** Each symbol's drawings. @type {Drawing[][]} */
    this.drawings = feed.series.map(() => []);
    /** @type {Drawing | null} */
    this.draft = null;
    /** @type {Cursor | null} */
    this.cursor = null;
    /** What a pointer drag does, from where it started. @type {null | { kind: 'pan', x: number, y: number, view: View, range: Range, auto: boolean } | { kind: 'scale', y: number, range: Range } | { kind: 'draw' }} */
    this.drag = null;
    this.made = 0;
    this.tick = 0;
    /** Bumped by every change; the page publishes when it moved. */
    this.version = 0;
    /** The last frame, whose parts the next one reuses when they did not change. @type {Frame | null} */
    this.last = null;
  }

  /** The current symbol's series. */
  get series() {
    return this.feed.series[this.symbol];
  }

  get view() {
    return this.views[this.symbol];
  }

  set view(view) {
    this.views[this.symbol] = view;
  }

  /** Marks a change. */
  touch() {
    this.version++;
    return true;
  }

  /** The price scale over a plot `w` wide and a pane `h` high: the manual one, or the window's auto scale. @param {number} w */
  range(w) {
    const manual = this.ranges[this.symbol];
    if (manual !== null) return manual;
    const s = this.series;
    return autoRange(s, windowOf(this.view, s.length, w), s.symbol.step);
  }

  /** The feed ticked: the view follows the newest candle when it showed it. */
  ticked() {
    this.tick++;
    for (let n = 0; n < this.views.length; n++) {
      const length = this.feed.series[n].length;
      const before = this.lengths[n];
      if (length === before) continue;
      // New candles opened while the view showed the last one: it scrolls along.
      const view = this.views[n];
      if (view.end >= before - 0.5) this.views[n] = { end: view.end + (length - before), count: view.count };
      this.lengths[n] = length;
    }
    return this.touch();
  }

  /** Shows another symbol. @param {number} n */
  pick(n) {
    if (n < 0 || n >= this.views.length || n === this.symbol) return false;
    this.symbol = n;
    this.draft = null;
    this.drag = null;
    this.cursor = null;
    return this.touch();
  }

  /** Turns a study on or off. @param {keyof Studies} name */
  toggle(name) {
    this.studies = { ...this.studies, [name]: !this.studies[name] };
    if (name === 'rsi') this.cursor = null;
    return this.touch();
  }

  /** @param {Tool} tool */
  use(tool) {
    this.tool = tool;
    this.draft = null;
    return this.touch();
  }

  /** Removes the symbol's drawings. */
  clear() {
    if (this.drawings[this.symbol].length === 0 && this.draft === null) return false;
    this.drawings[this.symbol] = [];
    this.draft = null;
    return this.touch();
  }

  /** Back to the auto price scale. */
  auto() {
    this.ranges[this.symbol] = null;
    return this.touch();
  }

  /** Zooms around the plot's centre. @param {number} factor @param {number} w */
  zoomBy(factor, w) {
    this.view = zoom(this.view, factor, w / 2, w, this.series.length);
    return this.touch();
  }

  /** Pans by a share of the view (negative: earlier). @param {number} share */
  panBy(share) {
    this.view = clampView({ end: this.view.end + share * this.view.count, count: this.view.count }, this.series.length);
    return this.touch();
  }

  /** Back to the latest candles at the current zoom. */
  toLatest() {
    this.view = latest(this.series.length, this.view.count);
    return this.touch();
  }

  /** A data point under a pane point. @param {number} x @param {number} y @param {number} w @param {number} h */
  point(x, y, w, h) {
    const s = this.series;
    return { i: indexAt(windowOf(this.view, s.length, w), x), p: priceAt(this.range(w), h, y) };
  }

  /**
   * A pointer gesture on a chart pane. Returns whether anything changed.
   * @param {Gesture} g
   */
  gesture(g) {
    const s = this.series;
    const { x, y, w, h } = g;
    if (g.gesture === 'leave') {
      if (this.cursor === null) return false;
      this.cursor = null;
      return this.touch();
    }
    if (g.gesture === 'wheel') {
      const dx = g.dx ?? 0;
      const dy = g.dy ?? 0;
      if (!g.zoom && Math.abs(dx) > Math.abs(dy)) this.view = pan(this.view, -dx, w, s.length);
      else {
        // A pinch sends small deltas with Ctrl; a wheel notch is about 100.
        const factor = Math.min(2, Math.max(0.5, Math.exp(dy * (g.zoom ? 0.01 : 0.0015))));
        this.view = zoom(this.view, factor, g.pane === 'axis' ? w / 2 : x, w, s.length);
      }
      return this.touch();
    }
    if (g.gesture === 'down') {
      if (g.pane === 'axis') {
        this.drag = { kind: 'scale', y, range: this.range(w) };
        return false;
      }
      if (g.pane === 'main' && this.tool === 'level') {
        this.drawings[this.symbol] = [...this.drawings[this.symbol], { id: ++this.made, kind: 'level', p: this.point(x, y, w, h).p }];
        this.tool = 'cursor';
        return this.touch();
      }
      if (g.pane === 'main' && this.tool === 'trend') {
        const at = this.point(x, y, w, h);
        this.draft = { id: ++this.made, kind: 'trend', a: at, b: at };
        this.drag = { kind: 'draw' };
        return this.touch();
      }
      this.drag = { kind: 'pan', x, y, view: this.view, range: this.range(w), auto: this.ranges[this.symbol] === null };
      return false;
    }
    if (g.gesture === 'up') {
      const drag = this.drag;
      this.drag = null;
      const draft = this.draft;
      if (drag?.kind === 'draw' && draft !== null && draft.kind === 'trend') {
        this.draft = null;
        const win = windowOf(this.view, s.length, w);
        const r = this.range(w);
        // A press without a drag draws nothing.
        if (Math.hypot((draft.b.i - draft.a.i) * win.width, ((draft.b.p - draft.a.p) / (r.hi - r.lo)) * h) >= SPAN) this.drawings[this.symbol] = [...this.drawings[this.symbol], draft];
        this.tool = 'cursor';
        return this.touch();
      }
      return false;
    }
    // A move: the crosshair follows; a drag pans, scales or draws. A move
    // with no button down ends a drag whose release went elsewhere.
    const drag = g.buttons === 0 ? null : this.drag;
    if (drag === null && this.drag !== null && this.drag.kind !== 'draw') this.drag = null;
    if (g.pane !== 'axis') this.cursor = { x, y, pane: g.pane === 'lower' ? 'lower' : 'main' };
    if (drag?.kind === 'pan') {
      this.view = pan(drag.view, x - drag.x, w, s.length);
      // With a manual price scale, a vertical drag moves the prices too.
      if (!drag.auto && g.pane === 'main') {
        const dp = ((y - drag.y) / h) * (drag.range.hi - drag.range.lo);
        this.ranges[this.symbol] = { lo: drag.range.lo + dp, hi: drag.range.hi + dp };
      }
    } else if (drag?.kind === 'scale') {
      // Dragging the price axis down widens the scale, up narrows it.
      const factor = Math.exp((y - drag.y) * 0.008);
      const mid = (drag.range.lo + drag.range.hi) / 2;
      const half = ((drag.range.hi - drag.range.lo) / 2) * factor;
      this.ranges[this.symbol] = { lo: mid - half, hi: mid + half };
    } else if (drag?.kind === 'draw' && this.draft !== null && this.draft.kind === 'trend' && g.pane === 'main') {
      this.draft = { ...this.draft, b: this.point(x, y, w, h) };
    }
    return this.touch();
  }

  /**
   * A key: the chart's shortcuts. Returns whether it was one.
   * @param {string} key @param {number} w the plot's width
   */
  key(key, w) {
    switch (key) {
      case 'ArrowLeft':
        return this.panBy(-0.1);
      case 'ArrowRight':
        return this.panBy(0.1);
      case '+':
      case '=':
      case 'ArrowUp':
        return this.zoomBy(0.8, w);
      case '-':
      case '_':
      case 'ArrowDown':
        return this.zoomBy(1.25, w);
      case 'End':
        return this.toLatest();
      case 'a':
        return this.auto();
      case 's':
        return this.toggle('sma');
      case 'e':
        return this.toggle('ema');
      case 'b':
        return this.toggle('bb');
      case 'r':
        return this.toggle('rsi');
      case 't':
        return this.use('trend');
      case 'h':
        return this.use('level');
      case 'Escape':
        return this.use('cursor');
      case 'Delete':
      case 'Backspace':
        return this.clear();
      default:
        if (/^[1-9]$/.test(key)) return this.pick(Number(key) - 1);
        return false;
    }
  }

  /** The frame to publish, reusing the last one's unchanged parts (so the roots' memos keep them). @returns {Frame} */
  frame() {
    const last = this.last;
    const drawings = this.drawings[this.symbol];
    const range = this.ranges[this.symbol];
    /** @type {Frame} */
    const frame = {
      tick: this.tick,
      symbol: this.symbol,
      end: this.view.end,
      count: this.view.count,
      range: last !== null && range !== null && last.range !== null && last.range.lo === range.lo && last.range.hi === range.hi ? last.range : range,
      studies: this.studies,
      tool: this.tool,
      drawings,
      draft: this.draft,
      cursor: last !== null && last.cursor !== null && this.cursor !== null && last.cursor.x === this.cursor.x && last.cursor.y === this.cursor.y && last.cursor.pane === this.cursor.pane ? last.cursor : this.cursor,
    };
    this.last = frame;
    return frame;
  }
}

/** The studies' labels, as the legend shows them. */
export const LEGEND = { sma: `SMA ${PERIODS.sma}`, ema: `EMA ${PERIODS.ema}`, bb: `BB ${PERIODS.bb} ${2}`, rsi: `RSI ${PERIODS.rsi}` };

/** The symbols' tickers, for messages and the watchlist. */
export const TICKERS = SYMBOLS.map(s => s.id);
