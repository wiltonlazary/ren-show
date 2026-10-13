// Terminal's market: a deterministic (seeded) feed of five synthetic
// symbols, 10,000 one-minute OHLCV candles each (50,000 in all) in typed
// columns, then live ticks that move every symbol's last candle, roll a new
// candle each simulated minute, print trades to a tape and reshape an order
// book around the price. It is plain JavaScript, no reactive state: like a
// market data connection, one feed is shared by every root that shows it
// (each gets it through the `Market` context and follows the tick number in
// its props), and two feeds with one seed agree to the bit.

import { $context } from 'rrx-core';

/** The first candle's time: 2026-09-18 00:00 UTC. */
export const EPOCH = Date.UTC(2026, 8, 18);

/** One candle per simulated minute. */
export const MINUTE = 60_000;

/** Candles of history per symbol (five symbols: 50,000 in all). */
export const HISTORY = 10_000;

/** Room for live candles past the history. */
const ROOM = 20_000;

/** Simulated seconds per tick: a new candle every 60 ticks. */
export const SECONDS = 1;

/** Levels on each side of the order book. */
export const LEVELS = 12;

/** Trades each symbol's tape keeps. */
export const TAPE = 64;

/** Candles in a watchlist sparkline. */
export const SPARK = 90;

/** Candles in a trading day (the change is against the close a day ago). */
export const DAY = 1440;

/**
 * A symbol of the feed.
 * @typedef {object} Ticker
 * @property {string} id the ticker
 * @property {string} name
 * @property {number} price where its history starts
 * @property {number} step its price increment (tick size)
 * @property {number} vol its volatility per minute (a fraction)
 */

/** The symbols: made up, so no price here is anyone's real one. @type {readonly Ticker[]} */
export const SYMBOLS = [
  { id: 'RENX', name: 'Ren Systems', price: 182.4, step: 0.01, vol: 0.0011 },
  { id: 'SKIA', name: 'Skia Graphics', price: 47.85, step: 0.01, vol: 0.0016 },
  { id: 'TAFY', name: 'Taffy Layout', price: 12.31, step: 0.005, vol: 0.0024 },
  { id: 'CANV', name: 'Canvas Works', price: 316.2, step: 0.05, vol: 0.0009 },
  { id: 'RRXC', name: 'RRX Core Index', price: 4210, step: 0.25, vol: 0.0006 },
];

/**
 * A 32-bit generator (mulberry32): the same seed gives the same numbers.
 * @param {number} seed
 * @returns {() => number} numbers in [0, 1)
 */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal number from a generator (Box–Muller). @param {() => number} next */
const normal = next => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());

/**
 * One symbol's candles, in columns: `length` are filled; the columns have
 * room for live candles past the history.
 */
export class Series {
  /** @param {Ticker} symbol @param {number} capacity */
  constructor(symbol, capacity) {
    this.symbol = symbol;
    this.length = 0;
    this.time = new Float64Array(capacity);
    this.open = new Float64Array(capacity);
    this.high = new Float64Array(capacity);
    this.low = new Float64Array(capacity);
    this.close = new Float64Array(capacity);
    this.volume = new Float64Array(capacity);
  }
  /** The last close. */
  get last() {
    return this.close[this.length - 1];
  }
  /** @param {number} time @param {number} open */
  push(time, open) {
    const i = this.length++;
    this.time[i] = time;
    this.open[i] = this.high[i] = this.low[i] = this.close[i] = open;
    this.volume[i] = 0;
    return i;
  }
}

/** A print on the tape: its price, size, side (1 bought at the ask, -1 sold at the bid) and time. */
export class Trade {
  /** @param {number} id @param {number} price @param {number} size @param {number} side @param {number} time */
  constructor(id, price, size, side, time) {
    this.id = id;
    this.price = price;
    this.size = size;
    this.side = side;
    this.time = time;
  }
}

/** A level of the book: its price, size, and the size from the touch to it. */
export class Level {
  /** @param {number} price @param {number} size @param {number} total */
  constructor(price, size, total) {
    this.price = price;
    this.size = size;
    this.total = total;
  }
}

/** Rounds a price to a symbol's step. @param {number} price @param {number} step */
export const tickRound = (price, step) => Math.round(price / step) * step;

/**
 * The feed: every symbol's candles, tape and book, advanced by `tick`.
 * Listeners hear each tick after it applied.
 */
export class Feed {
  /** @param {number} [seed] @param {number} [history] candles per symbol */
  constructor(seed = 20260925, history = HISTORY) {
    this.seed = seed;
    this.next = random(seed);
    /** Ticks since the history ended. */
    this.ticks = 0;
    /** The simulated time, ms: the last candle of the history has just opened. */
    this.now = EPOCH + (history - 1) * MINUTE;
    /** @type {Series[]} */
    this.series = [];
    /** Each symbol's tape, newest last (a ring of TAPE). @type {Trade[][]} */
    this.tapes = [];
    /** Each symbol's book sizes, jittered per tick: bids then asks. @type {Float64Array[]} */
    this.sizes = [];
    /** Each symbol's current drift regime. @type {number[]} */
    this.trend = [];
    this.printed = 0;
    /** @type {Set<(feed: Feed) => void>} */
    this.listeners = new Set();
    for (const s of SYMBOLS) this.grow(s, history);
  }

  /** Builds a symbol's history: a random walk with drifting regimes and volume that follows the moves. @param {Ticker} s @param {number} n */
  grow(s, n) {
    const next = this.next;
    const series = new Series(s, n + ROOM);
    let price = s.price;
    let trend = 0;
    for (let i = 0; i < n; i++) {
      // A new regime now and then: a drift of up to a third of the volatility.
      if (next() < 0.004) trend = (next() - 0.5) * s.vol * 0.6;
      // Busier hours: volatility and volume follow the time of day.
      const hour = (i % DAY) / 60;
      const busy = 0.7 + 0.6 * Math.exp(-(((hour - 14.5) / 3) ** 2));
      const vol = s.vol * busy;
      const open = price;
      let high = open;
      let low = open;
      // Four steps inside the minute make the wicks.
      for (let k = 0; k < 4; k++) {
        price *= 1 + trend / 4 + (normal(next) * vol) / 2;
        if (price > high) high = price;
        if (price < low) low = price;
      }
      const close = tickRound(price, s.step);
      price = close;
      const i2 = series.push(EPOCH + i * MINUTE, tickRound(open, s.step));
      series.high[i2] = tickRound(Math.max(high, open, close), s.step);
      series.low[i2] = tickRound(Math.min(low, open, close), s.step);
      series.close[i2] = close;
      const move = Math.abs(close - open) / (open * vol);
      series.volume[i2] = Math.round((400 + 900 * move + 600 * next()) * busy * (1000 / s.price + 1));
    }
    this.series.push(series);
    this.tapes.push([]);
    this.trend.push(trend);
    const sizes = new Float64Array(LEVELS * 2);
    for (let k = 0; k < sizes.length; k++) sizes[k] = this.size(s, k % LEVELS);
    this.sizes.push(sizes);
  }

  /** A fresh book size at a depth: deeper levels rest larger. @param {Ticker} s @param {number} depth */
  size(s, depth) {
    return Math.round((20 + depth * 14 + this.next() * 90) * (1 + 200 / s.price));
  }

  /** The symbol with this ticker, as an index (-1: none). @param {string} id */
  index(id) {
    return SYMBOLS.findIndex(s => s.id === id);
  }

  /**
   * One tick: the simulated clock moves a second, every symbol's price
   * moves, its last candle follows (a new candle opens each minute), trades
   * print and the book reshapes.
   */
  tick() {
    const next = this.next;
    this.ticks++;
    this.now += SECONDS * 1000;
    for (let n = 0; n < this.series.length; n++) {
      const series = this.series[n];
      const s = series.symbol;
      if (next() < 0.002) this.trend[n] = (next() - 0.5) * s.vol * 0.6;
      let i = series.length - 1;
      if (this.now - series.time[i] >= MINUTE) i = series.push(series.time[i] + MINUTE, series.close[i]);
      const before = series.close[i];
      const price = tickRound(before * (1 + this.trend[n] / 60 + normal(next) * s.vol * 0.13), s.step);
      series.close[i] = price;
      if (price > series.high[i]) series.high[i] = price;
      if (price < series.low[i]) series.low[i] = price;
      // A print or two: bought at the ask when the price rose, sold at the bid when it fell.
      const prints = 1 + (next() < 0.35 ? 1 : 0);
      for (let k = 0; k < prints; k++) {
        const side = price > before ? 1 : price < before ? -1 : next() < 0.5 ? 1 : -1;
        const size = Math.max(1, Math.round((5 + next() * next() * 240) * (1 + 100 / s.price)));
        series.volume[i] += size;
        const tape = this.tapes[n];
        tape.push(new Trade(++this.printed, price, size, side, this.now));
        if (tape.length > TAPE) tape.shift();
      }
      // The book: a few levels refill, the touch thins on the side that traded.
      const sizes = this.sizes[n];
      for (let k = 0; k < 3; k++) {
        const at = Math.floor(next() * sizes.length);
        sizes[at] = this.size(s, at % LEVELS);
      }
      const touch = price >= before ? LEVELS : 0;
      sizes[touch] = Math.max(1, Math.round(sizes[touch] * (0.55 + next() * 0.4)));
    }
    for (const listen of this.listeners) listen(this);
  }

  /** Hears every tick. @param {(feed: Feed) => void} listen @returns {() => void} the unsubscribe */
  listen(listen) {
    this.listeners.add(listen);
    return () => void this.listeners.delete(listen);
  }

  /**
   * A symbol's book: LEVELS bids (best first, below the price) and asks
   * (best first, above it), each with the size from the touch.
   * @param {number} n the symbol's index
   * @returns {{ bids: Level[], asks: Level[], spread: number, mid: number }}
   */
  book(n) {
    const series = this.series[n];
    const step = series.symbol.step;
    const last = series.last;
    const sizes = this.sizes[n];
    // The touch: a step either side of the last price, a step wider now and then.
    const bid = tickRound(last, step) - step;
    const ask = tickRound(last, step) + step * (1 + (this.ticks % 7 === 0 ? 1 : 0));
    /** @type {Level[]} */
    const bids = [];
    /** @type {Level[]} */
    const asks = [];
    let bt = 0;
    let at = 0;
    for (let k = 0; k < LEVELS; k++) {
      bt += sizes[k];
      at += sizes[LEVELS + k];
      bids.push(new Level(bid - k * step, sizes[k], bt));
      asks.push(new Level(ask + k * step, sizes[LEVELS + k], at));
    }
    return { bids, asks, spread: ask - bid, mid: (ask + bid) / 2 };
  }

  /**
   * A symbol's summary for the watchlist: its last price, the change
   * against the close a day earlier, and its sparkline's closes.
   * @param {number} n
   */
  quote(n) {
    const series = this.series[n];
    const last = series.last;
    const base = series.close[Math.max(0, series.length - 1 - DAY)];
    return { last, change: last - base, percent: ((last - base) / base) * 100, spark: series.close.subarray(Math.max(0, series.length - SPARK), series.length) };
  }
}

/** The feed a root shows: the page provides it to each root (a plain object, not reactive state). */
export const Market = $context(/** @type {Feed | null} */ (null));

/** Decimals that show a symbol's step. @param {number} step */
export const decimals = step => (step >= 1 ? 0 : Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))));

/** A price at a symbol's precision. @param {number} price @param {number} step */
export const money = (price, step) => price.toFixed(decimals(step));

/** A size as 1.2K or 3.4M. @param {number} n */
export function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return String(Math.round(n));
}
