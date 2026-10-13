// Terminal (src/apps/terminal): the chart math and the seeded market on
// their own, then the desk drawn by a Skia root (headless CanvasKit, read
// back through its commands and pixels) and by ren-dom. The tests drive it
// as a trader would: drags, wheels and hovers through the Skia renderer's
// pointer input and through events dispatched on its canvas, keys, the
// watchlist search on the canvas, streaming ticks; and they check that the
// DOM and Skia charts show the same values from the same frames.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { fileURLToPath } from 'node:url';
import { loadLayout } from 'ren-skia';
import { open } from './page.jsx';
import terminal, { WIDTH, HEIGHT, PANE } from '../src/apps/terminal/index.jsx';
import { Feed, SYMBOLS, HISTORY, MINUTE, EPOCH, LEVELS, random, money, compact } from '../src/apps/terminal/market.js';
import { sma, ema, bollinger, rsi, windowOf, xOf, indexAt, yOf, priceAt, priceTicks, timeTicks, pan, zoom, clampView, latest, autoRange, candles, panes, AXIS, READOUT, ZOOM } from '../src/apps/terminal/chart.js';
import { Desk } from '../src/apps/terminal/desk.js';
import { LEFT, RIGHT, BAR, STRIP, NARROW, TALL, candleColors } from '../src/apps/terminal/view.jsx';
import { THEMES, Look } from '../src/themes.js';
import { $signal, $write } from 'rrx-core';
import { $active } from 'ren-core';

// Each WebAssembly memory reserves its whole range up front; at most 1 GB
// each, Taffy's and CanvasKit's fit the machine's address cap.
setFlagsFromString('--wasm-max-mem-pages=16384');
await loadLayout();

const font = readFileSync(fileURLToPath(import.meta.resolve('ren-skia/font.ttf')));
/** @type {any} */
let kit;
before(async () => {
  const CanvasKitInit = (await import('canvaskit-wasm')).default;
  kit = await CanvasKitInit();
});

/**
 * Re-checks `check` until it holds or `ms` pass; returns whether it held.
 * The page runs workers, WebAssembly and frames that report no single event.
 * @param {() => boolean} check
 */
const until = async (check, ms = 5000) => {
  // timer: poll, a bounded re-check of the page's state
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 5))) if (check()) return true;
  return check();
};

/** The naive references the windowed studies must match. */
const reference = {
  /** @param {number[]} v @param {number} p */
  sma: (v, p) => v.map((_, i) => (i < p - 1 ? NaN : v.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p)),
  /** @param {number[]} v @param {number} p */
  ema(v, p) {
    const out = v.map(() => NaN);
    let e = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
    out[p - 1] = e;
    for (let i = p; i < v.length; i++) out[i] = e = e + (v[i] - e) * (2 / (p + 1));
    return out;
  },
  /** @param {number[]} v @param {number} p */
  rsi(v, p) {
    const out = v.map(() => NaN);
    let g = 0;
    let l = 0;
    for (let i = 1; i <= p; i++) {
      const d = v[i] - v[i - 1];
      g += Math.max(0, d);
      l += Math.max(0, -d);
    }
    g /= p;
    l /= p;
    out[p] = 100 - 100 / (1 + g / l);
    for (let i = p + 1; i < v.length; i++) {
      const d = v[i] - v[i - 1];
      g = (g * (p - 1) + Math.max(0, d)) / p;
      l = (l * (p - 1) + Math.max(0, -d)) / p;
      out[i] = 100 - 100 / (1 + g / l);
    }
    return out;
  },
};

/** @param {ArrayLike<number>} got @param {number[]} want @param {number} tolerance @param {string} what */
function close(got, want, tolerance, what) {
  assert.equal(got.length, want.length, `${what}: length`);
  for (let i = 0; i < want.length; i++) {
    if (Number.isNaN(want[i])) assert.ok(Number.isNaN(got[i]), `${what}[${i}] is undefined`);
    else assert.ok(Math.abs(got[i] - want[i]) <= tolerance * Math.max(1, Math.abs(want[i])), `${what}[${i}]: ${got[i]} against ${want[i]}`);
  }
}

describe('terminal chart math', () => {
  const next = random(7);
  const values = [100];
  for (let i = 1; i < 3000; i++) values.push(values[i - 1] * (1 + (next() - 0.5) * 0.02));

  it('computes SMA, EMA, Bollinger bands and RSI over a window as over the whole series', () => {
    for (const [from, to] of [[0, 40], [5, 60], [1200, 1330], [2900, 3000]]) {
      close(sma(values, 20, from, to), reference.sma(values, 20).slice(from, to), 1e-12, `sma ${from}`);
      close(ema(values, 50, from, to), reference.ema(values, 50).slice(from, to), 1e-8, `ema ${from}`);
      close(rsi(values, 14, from, to), reference.rsi(values, 14).slice(from, to), 1e-6, `rsi ${from}`);
      const b = bollinger(values, 20, 2, from, to);
      const mid = reference.sma(values, 20);
      for (let i = from; i < to; i++) {
        if (Number.isNaN(mid[i])) continue;
        const sd = Math.sqrt(values.slice(i - 19, i + 1).reduce((a, v) => a + (v - mid[i]) ** 2, 0) / 20);
        assert.ok(Math.abs(b.upper[i - from] - (mid[i] + 2 * sd)) < 1e-9 && Math.abs(b.lower[i - from] - (mid[i] - 2 * sd)) < 1e-9, `bands at ${i}`);
      }
    }
    // RSI stays in 0–100; an all-rising series reads 100.
    assert.ok(Array.from(rsi(values, 14, 100, 3000)).every(v => v >= 0 && v <= 100));
    assert.equal(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14, 15, 16)[0], 100);
  });

  it('maps candles and prices to pixels and back, and ticks round values', () => {
    const win = windowOf({ end: 500.5, count: 100 }, 1000, 400);
    assert.deepEqual([win.from, win.to, win.width], [400, 501, 4]);
    for (const i of [400, 450.25, 500]) assert.ok(Math.abs(indexAt(win, xOf(win, i)) - i) < 1e-9);
    assert.equal(xOf(win, 400), 0, 'the view starts half a candle in: the first centre is at 0');
    const r = { lo: 90, hi: 110 };
    assert.equal(yOf(r, 200, 110), 0);
    assert.equal(yOf(r, 200, 90), 200);
    assert.ok(Math.abs(priceAt(r, 200, yOf(r, 200, 97.3)) - 97.3) < 1e-9);
    const t = priceTicks(r, 460);
    assert.deepEqual(t.prices, [90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110]);
    assert.equal(t.decimals, 0);
    assert.equal(priceTicks({ lo: 1.01, hi: 1.37 }, 400).decimals, 2);
    assert.equal(priceTicks({ lo: 0, hi: 10 }, 200).decimals, 1, 'a step of 2.5 shows one decimal');
    // Time ticks land on round minutes, at least 84 px apart, dated at midnight.
    const feed = new Feed(1, 3000);
    const s = feed.series[0];
    const view = windowOf({ end: 1500, count: 300 }, s.length, 600);
    const times = timeTicks(s, view);
    assert.ok(times.length >= 2);
    for (let k = 1; k < times.length; k++) assert.ok((times[k].index - times[k - 1].index) * view.width >= 84);
    assert.ok(times.every(tt => (s.time[tt.index] / MINUTE) % 30 === 0), 'every half hour at 2 px a candle');
    const day = timeTicks(s, windowOf({ end: 1500, count: 1200 }, s.length, 600));
    assert.ok(day.some(tt => tt.text === 'Sep 19'), 'a day starts with its date');
    // The auto scale pads the window's range.
    const auto = autoRange(s, view, 0.01);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = view.from; i < view.to; i++) {
      lo = Math.min(lo, s.low[i]);
      hi = Math.max(hi, s.high[i]);
    }
    assert.ok(auto.lo < lo && auto.hi > hi && Math.abs(hi - auto.hi - (auto.lo - lo)) < 1e-9);
  });

  it('pans with the pointer and zooms around it, within limits', () => {
    const view = { end: 800, count: 100 };
    assert.deepEqual(pan(view, 50, 500, 1000), { end: 790, count: 100 }, 'dragging right shows earlier candles');
    const zoomed = zoom(view, 0.5, 125, 500, 1000);
    assert.equal(zoomed.count, 50);
    const before = indexAt(windowOf(view, 1000, 500), 125);
    const after = indexAt(windowOf(zoomed, 1000, 500), 125);
    assert.ok(Math.abs(before - after) < 1e-9, 'the candle under the pointer stays');
    assert.equal(zoom(view, 0.01, 0, 500, 1000).count, ZOOM.min);
    assert.equal(zoom(view, 100, 0, 500, 1000).count, ZOOM.max);
    assert.equal(clampView({ end: 5000, count: 100 }, 1000).end, 1080, 'at most 80% past the last candle');
    assert.equal(clampView({ end: -50, count: 100 }, 1000).end, 20);
    assert.deepEqual(latest(1000, 100), { end: 1006, count: 100 });
    assert.deepEqual(panes(500, 400, true), { plot: 500 - AXIS, main: 400 - READOUT - 22 - Math.round((400 - READOUT - 22) * 0.26), lower: Math.round((400 - READOUT - 22) * 0.26) });
  });

  it('draws only the visible candles, a wick and a body each, in the theme colors', () => {
    const feed = new Feed(3, 500);
    const s = feed.series[1];
    const win = windowOf({ end: 300, count: 50 }, s.length, 400);
    const paint = { ...candleColors(THEMES[0].colors), grid: 0, ink: 0, muted: 0, accent: 0, sma: 0, ema: 0, bb: 0, rsi: 0, surface: 0 };
    const figures = candles(s, win, autoRange(s, win, 0.01), 300, paint);
    assert.equal(figures.length, (win.to - win.from) * 2);
    const i = win.from + 3;
    const body = figures[7];
    assert.equal(body.color, s.close[i] >= s.open[i] ? paint.up : paint.down);
  });
});

describe('terminal market', () => {
  it('seeds 50,000 candles, the same for the same seed, each a valid OHLC', () => {
    const a = new Feed();
    const b = new Feed();
    assert.equal(a.series.reduce((n, s) => n + s.length, 0), SYMBOLS.length * HISTORY);
    assert.equal(SYMBOLS.length * HISTORY, 50_000);
    for (let n = 0; n < SYMBOLS.length; n++) {
      const s = a.series[n];
      assert.deepEqual(Array.from(s.close.subarray(0, s.length)), Array.from(b.series[n].close.subarray(0, s.length)));
      for (let i = 0; i < s.length; i++) {
        if (!(s.low[i] <= Math.min(s.open[i], s.close[i]) && s.high[i] >= Math.max(s.open[i], s.close[i]) && s.volume[i] > 0)) assert.fail(`${s.symbol.id} candle ${i}`);
      }
      assert.equal(s.time[0], EPOCH);
      assert.equal(s.time[s.length - 1] - s.time[s.length - 2], MINUTE);
    }
  });

  it('ticks: the last candle follows the price, a new one opens each minute, trades print and the book stays sorted', () => {
    const feed = new Feed(11, 400);
    const s = feed.series[0];
    const length = s.length;
    let heard = 0;
    feed.listen(() => heard++);
    for (let k = 0; k < 59; k++) feed.tick();
    assert.equal(s.length, length, 'still the same minute');
    feed.tick();
    assert.equal(s.length, length + 1, 'a new candle at the minute');
    assert.equal(s.open[length], s.close[length - 1], 'it opens at the last close');
    assert.equal(heard, 60);
    assert.ok(feed.tapes[0].length > 0 && feed.tapes[0].length <= 64);
    const book = feed.book(0);
    assert.equal(book.bids.length, LEVELS);
    for (let k = 1; k < LEVELS; k++) {
      assert.ok(book.bids[k].price < book.bids[k - 1].price && book.asks[k].price > book.asks[k - 1].price);
      assert.equal(book.bids[k].total, book.bids[k - 1].total + book.bids[k].size);
    }
    assert.ok(book.asks[0].price > book.bids[0].price && book.spread > 0);
    assert.ok(book.bids[0].price < s.last && book.asks[0].price > s.last, 'the touch is either side of the last price');
    assert.equal(money(12.3456, 0.005), '12.346');
    assert.equal(compact(12_345), '12.3K');
  });
});

describe('terminal desk', () => {
  it('pans on a drag, scales on the price axis, draws and follows the newest candle', () => {
    const feed = new Feed(5, 600);
    const desk = new Desk(feed);
    const w = 400;
    const h = 300;
    const start = desk.view;
    desk.gesture({ gesture: 'down', pane: 'main', x: 200, y: 100, w, h, buttons: 1 });
    desk.gesture({ gesture: 'move', pane: 'main', x: 260, y: 140, w, h, buttons: 1 });
    desk.gesture({ gesture: 'up', pane: 'main', x: 260, y: 140, w, h });
    assert.ok(Math.abs(desk.view.end - (start.end - (60 / w) * start.count)) < 1e-9);
    assert.equal(desk.ranges[0], null, 'with the auto scale, a vertical drag moves no prices');
    // Dragging the price axis down widens the scale and leaves auto.
    const auto = desk.range(w);
    desk.gesture({ gesture: 'down', pane: 'axis', x: 10, y: 100, w, h, buttons: 1 });
    desk.gesture({ gesture: 'move', pane: 'axis', x: 10, y: 150, w, h, buttons: 1 });
    desk.gesture({ gesture: 'up', pane: 'axis', x: 10, y: 150, w, h });
    const scaled = /** @type {any} */ (desk.ranges[0]);
    assert.ok(scaled.hi - scaled.lo > auto.hi - auto.lo);
    desk.key('a', w);
    assert.equal(desk.ranges[0], null);
    // A trend line from a drag, a level from a press; both back to the crosshair.
    desk.key('t', w);
    desk.gesture({ gesture: 'down', pane: 'main', x: 50, y: 50, w, h, buttons: 1 });
    desk.gesture({ gesture: 'move', pane: 'main', x: 150, y: 120, w, h, buttons: 1 });
    desk.gesture({ gesture: 'up', pane: 'main', x: 150, y: 120, w, h });
    desk.key('h', w);
    desk.gesture({ gesture: 'down', pane: 'main', x: 50, y: 75, w, h, buttons: 1 });
    desk.gesture({ gesture: 'up', pane: 'main', x: 50, y: 75, w, h });
    assert.deepEqual(desk.drawings[0].map(d => d.kind), ['trend', 'level']);
    assert.equal(desk.tool, 'cursor');
    const trend = /** @type {any} */ (desk.drawings[0][0]);
    assert.ok(Math.abs(trend.b.i - trend.a.i - 100 / (w / desk.view.count)) < 1e-9);
    // At the latest candles, the view scrolls along as new ones open.
    desk.toLatest();
    const end = desk.view.end;
    for (let k = 0; k < 60; k++) {
      feed.tick();
      desk.ticked();
    }
    assert.equal(desk.view.end, end + 1);
    // Scrolled back in history, it stays.
    desk.panBy(-2);
    const back = desk.view.end;
    for (let k = 0; k < 60; k++) {
      feed.tick();
      desk.ticked();
    }
    assert.equal(desk.view.end, back);
  });
});

/**
 * Opens Terminal with headless CanvasKit, its clock and frame loop left to
 * the test, and waits for the Skia root.
 */
async function terminalPage() {
  /** @type {any} */
  let probe = null;
  /** @type {any} */
  let theme = null;
  const View = terminal.View;
  const Themed = () => {
    theme = $signal($active(), THEMES[0]);
    return (
      <Look value={theme}>
        <View manual probe={(/** @type {any} */ p) => (probe = p)} />
      </Look>
    );
  };
  const page = open(Themed, { skia: async () => ({ kit, font }), pace: 0.05 });
  assert.ok(await until(() => page.all('[data-ren-root="terminal-skia"] canvas').length === 1), 'the Skia root renders');
  const skia = () => probe.renderers.skia;
  /** The chart's plot origin on the desk's canvas. */
  const origin = [LEFT + STRIP, BAR + 1 + READOUT];
  const chartWidth = WIDTH - LEFT - RIGHT - STRIP;
  const geo = panes(chartWidth, HEIGHT - BAR - 1, true);
  /** The texts the canvas drew, in order. @param {any} [renderer] */
  const texts = (renderer = skia()) => renderer.commands().filter((/** @type {any[]} */ c) => c[0] === 'text').map((/** @type {any[]} */ c) => c[1]);
  const publish = () => {
    probe.publish();
    skia()?.present();
  };
  /** A key on the canvas; it bubbles to the application. @param {string} key */
  const key = key => {
    const canvas = page.all('[data-ren-root="terminal-skia"] canvas')[0];
    const event = new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event;
  };
  /** Where the canvas drew the first text that starts with `start` (right of `left`): a point on its first characters. @param {string} start @param {any} [renderer] */
  const spot = (start, renderer = skia(), left = 0) => {
    const c = renderer.commands().find((/** @type {any[]} */ c) => c[0] === 'text' && String(c[1]).startsWith(start) && c[2] >= left);
    assert.ok(c, `the canvas drew "${start}"`);
    return [c[2] + 4, c[3] - c[4] / 3];
  };
  /** A point on the plot, from its origin. @param {number} x @param {number} y */
  const plot = (x, y) => [origin[0] + x, origin[1] + y];
  /** Dispatches a pointer event on the canvas at a point of it (the browser path: attach reads offsetX and offsetY). @param {string} type @param {number[]} at @param {Record<string, any>} [extra] */
  const pointer = (type, at, extra = {}) => {
    const canvas = page.all('[data-ren-root="terminal-skia"] canvas')[0];
    const event = new page.window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { offsetX: at[0], offsetY: at[1], button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, detail: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, deltaX: 0, deltaY: 0, ...extra });
    canvas.dispatchEvent(event);
    return event;
  };
  /**
   * The candle with the tallest body in view: the pixel at its body's
   * centre, and the up or down color it should be in a palette.
   * @param {import('../src/themes.js').Palette} palette
   */
  const candle = palette => {
    const { desk, feed } = probe;
    const s = feed.series[desk.symbol];
    const win = windowOf(desk.view, s.length, geo.plot);
    let best = win.from;
    for (let i = win.from; i < win.to - 1; i++) if (Math.abs(s.close[i] - s.open[i]) > Math.abs(s.close[best] - s.open[best])) best = i;
    const colors = candleColors(palette);
    const x = origin[0] + xOf(win, best);
    const y = origin[1] + yOf(desk.range(geo.plot), geo.main, (s.open[best] + s.close[best]) / 2);
    return { pixel: skia().pixel(x, y) >>> 0, want: s.close[best] >= s.open[best] ? colors.up : colors.down };
  };
  return { page, probe: () => probe, skia, candle, setTheme: (/** @type {any} */ t) => $write(theme, t), origin, chartWidth, geo, texts, publish, key, spot, plot, pointer, stage: () => page.all('.app-terminal')[0] };
}

describe('terminal', () => {
  it('draws the desk on the canvas: candles in the theme colors, axes, watchlist, book and tape', async () => {
    const t = await terminalPage();
    try {
      const { desk, feed } = t.probe();
      t.publish();
      const texts = t.texts();
      for (const s of SYMBOLS) assert.ok(texts.includes(s.id), `the watchlist lists ${s.id}`);
      assert.ok(texts.includes('Order book') && texts.includes('Trades'));
      const s = feed.series[0];
      assert.ok(texts.includes(money(s.last, s.symbol.step)), 'the last price shows');
      assert.ok(texts.some((/** @type {string} */ x) => x.startsWith('O ') && x.includes(` C ${money(s.last, s.symbol.step)}`)), 'the readout shows the last candle');
      // The price axis: round prices inside the auto scale.
      const range = desk.range(t.geo.plot);
      const ticks = priceTicks(range, t.geo.main);
      for (const p of ticks.prices) if (yOf(range, t.geo.main, p) > 8 && yOf(range, t.geo.main, p) < t.geo.main - 8) assert.ok(texts.includes(p.toFixed(ticks.decimals)), `the axis shows ${p}`);
      // The candle with the tallest body in view, painted at its body's centre in the up or down color.
      const { pixel, want } = t.candle(THEMES[0].colors);
      assert.equal(pixel, want);
      assert.equal(t.stage().getAttribute('data-symbol'), 'RENX');
      assert.equal(t.stage().getAttribute('data-studies'), 'sma rsi');
    } finally {
      t.page.dispose();
    }
  });
  it('pans on a drag, zooms on the wheel and pinch, scales the price axis: through the Skia renderer\'s pointer input', async () => {
    const t = await terminalPage();
    try {
      const { desk, feed } = t.probe();
      const r = t.skia();
      t.publish();
      const s = feed.series[0];
      const view = desk.view;
      // A drag: pressed on the plot, moved 120 px right, released. The canvas keeps the pointer with the plot.
      const [x, y] = t.plot(240, 160);
      r.press(x, y, 1, false, { button: 0, buttons: 1 });
      r.move(x + 60, y + 10, { buttons: 1 });
      r.move(x + 120, y + 20, { buttons: 1 });
      r.release(x + 120, y + 20, { buttons: 0 });
      t.publish();
      const moved = view.end - (120 / t.geo.plot) * view.count;
      assert.ok(Math.abs(desk.view.end - moved) < 1e-9, `end ${desk.view.end} against ${moved}`);
      assert.equal(t.stage().getAttribute('data-view'), `${moved.toFixed(3)} ${view.count.toFixed(3)}`);
      assert.equal(r.copied(), '', 'a drag on the chart selects no text');
      // A press the browser takes back (a touch that scrolls the page) ends the drag: later moves pan nothing.
      const kept = desk.view.end;
      r.press(x, y, 1, false, { button: 0, buttons: 1 });
      r.move(x + 30, y, { buttons: 1 });
      r.cancel(x + 30, y);
      r.move(x + 150, y, { buttons: 1 });
      t.publish();
      assert.ok(Math.abs(desk.view.end - (kept - (30 / t.geo.plot) * view.count)) < 1e-9, 'the cancelled drag panned only until the cancel');
      assert.equal(desk.drag, null, 'no drag under way');
      // The wheel zooms around the pointer: the candle under it stays.
      const anchor = 100;
      const under = indexAt(windowOf(desk.view, s.length, t.geo.plot), anchor);
      r.wheel(...t.plot(anchor, 120), -100, { deltaY: -100 });
      t.publish();
      assert.ok(Math.abs(desk.view.count - view.count * Math.exp(-0.15)) < 1e-9, 'a notch zooms in by e^0.15');
      assert.ok(Math.abs(indexAt(windowOf(desk.view, s.length, t.geo.plot), anchor) - under) < 1e-9);
      // A pinch (the wheel with Ctrl) zooms by its small deltas.
      const count = desk.view.count;
      r.wheel(...t.plot(anchor, 120), 8, { deltaY: 8, ctrlKey: true });
      assert.ok(Math.abs(desk.view.count - count * Math.exp(0.08)) < 1e-9);
      // The same gestures as browser events on the canvas: attach routes them to the plot.
      const before = desk.view.end;
      t.pointer('pointerdown', t.plot(200, 100));
      t.pointer('pointermove', t.plot(150, 100));
      t.pointer('pointermove', t.plot(100, 100));
      t.pointer('pointerup', t.plot(100, 100));
      assert.ok(Math.abs(desk.view.end - (before + (100 / t.geo.plot) * desk.view.count)) < 1e-9, 'dragging left shows later candles');
      const wheel = t.pointer('wheel', t.plot(100, 100), { deltaY: 100, buttons: 0 });
      assert.ok(wheel.defaultPrevented, 'the page does not scroll under the chart');
      // The press captures the pointer: a drag past the plot, over the watchlist, still pans.
      const held = desk.view.end;
      r.press(...t.plot(100, 100), 1, false, { buttons: 1, pointerId: 1 });
      r.move(40, 163, { buttons: 1, pointerId: 1 });
      r.release(40, 163, { buttons: 0, pointerId: 1 });
      assert.ok(Math.abs(desk.view.end - (held + ((t.origin[0] + 100 - 40) / t.geo.plot) * desk.view.count)) < 1e-9, 'the plot kept the pointer');
      // The canvas shows each layer's cursor: a crosshair on the plot, a resize on the price axis.
      const canvas = t.page.all('[data-ren-root="terminal-skia"] canvas')[0];
      t.pointer('pointermove', t.plot(100, 100), { buttons: 0 });
      assert.equal(canvas.style.cursor, 'crosshair');
      t.pointer('pointermove', [t.origin[0] + t.geo.plot + 20, t.origin[1] + 100], { buttons: 0 });
      assert.equal(canvas.style.cursor, 'ns-resize');
      // Dragging the price axis down widens the scale and turns the auto scale off; A turns it on.
      t.publish();
      const auto = desk.range(t.geo.plot);
      const [ax, ay] = [t.origin[0] + t.geo.plot + 20, t.origin[1] + 100];
      r.press(ax, ay, 1, false, { buttons: 1 });
      r.move(ax, ay + 60, { buttons: 1 });
      r.release(ax, ay + 60);
      t.publish();
      const manual = desk.ranges[0];
      assert.ok(manual !== null && manual.hi - manual.lo > auto.hi - auto.lo);
      // With a manual scale, a vertical drag on the plot moves the prices.
      r.press(...t.plot(200, 100), 1, false, { buttons: 1 });
      r.move(...t.plot(200, 150), { buttons: 1 });
      r.release(...t.plot(200, 150));
      assert.ok(desk.ranges[0].hi > manual.hi, 'dragging down shows higher prices');
      t.key('a');
      assert.equal(desk.ranges[0], null);
    } finally {
      t.page.dispose();
    }
  });

  it('shows the crosshair and the hovered candle, and the readout selects and copies as text', async () => {
    const t = await terminalPage();
    try {
      const { desk, feed } = t.probe();
      const r = t.skia();
      t.publish();
      const s = feed.series[0];
      const d = s.symbol.step;
      // Hover: no button down.
      r.move(...t.plot(180.4, 90), { buttons: 0 });
      t.publish();
      assert.equal(t.stage().getAttribute('data-cursor'), 'main 180 90');
      // A hover repaints the crosshair's rectangles, not the canvas.
      r.move(...t.plot(220.4, 120), { buttons: 0 });
      t.publish();
      assert.equal(r.repaint, 'damage');
      r.move(...t.plot(180.4, 90), { buttons: 0 });
      t.publish();
      const win = windowOf(desk.view, s.length, t.geo.plot);
      const i = Math.round(indexAt(win, 180.4));
      const texts = t.texts();
      const readout = texts.find((/** @type {string} */ x) => x.startsWith('O '));
      assert.ok(readout.startsWith(`O ${money(s.open[i], d)}  H ${money(s.high[i], d)}  L ${money(s.low[i], d)}  C ${money(s.close[i], d)}`), readout);
      const range = desk.range(t.geo.plot);
      assert.ok(texts.includes(money(range.hi - (90 / t.geo.main) * (range.hi - range.lo), d)), 'the price at the pointer, on the axis');
      // The vertical hairline sits on the candle's centre, in the ink.
      const x = Math.round(t.origin[0] + xOf(win, i));
      const hair = r.commands().filter((/** @type {any[]} */ c) => c[0] === 'rect' && c[1] === x && c[3] === x + 1);
      assert.ok(hair.length >= 1, 'a one-pixel hairline at the candle');
      // Triple press selects the whole readout; the renderer copies it.
      const [rx, ry] = t.spot('O ');
      r.press(rx, ry, 3, false, {});
      r.release(rx, ry);
      assert.equal(r.copied(), readout);
      // A double press selects a word: the ticker beside it.
      const [sx, sy] = t.spot(s.symbol.id, r, t.origin[0]);
      r.press(sx, sy, 2, false, {});
      r.release(sx, sy);
      assert.equal(r.copied(), s.symbol.id);
      // Leaving the plot for the watchlist hides the crosshair: the plot hears its own pointerleave.
      r.move(40, 300, { buttons: 0 });
      t.publish();
      assert.equal(t.stage().getAttribute('data-cursor'), '');
      r.move(...t.plot(180.4, 90), { buttons: 0 });
      t.publish();
      assert.equal(t.stage().getAttribute('data-cursor'), 'main 180 90');
      // And leaving the canvas does too.
      r.leave();
      t.publish();
      assert.equal(t.stage().getAttribute('data-cursor'), '');
      assert.ok(t.texts().find((/** @type {string} */ x) => x.startsWith('O ')).includes(` C ${money(s.last, d)}`), 'the readout is back on the last candle');
    } finally {
      t.page.dispose();
    }
  });

  it('draws a trend line and a horizontal line with the tools, toggles studies from keys and the canvas toolbar', async () => {
    const t = await terminalPage();
    try {
      const { desk } = t.probe();
      const r = t.skia();
      t.publish();
      assert.ok(t.key('t').defaultPrevented, 'T takes the trend line tool');
      t.publish();
      r.press(...t.plot(60, 60), 1, false, { buttons: 1 });
      r.move(...t.plot(160, 110), { buttons: 1 });
      r.move(...t.plot(260, 160), { buttons: 1 });
      r.release(...t.plot(260, 160));
      t.publish();
      assert.equal(t.stage().getAttribute('data-drawings'), '1');
      assert.equal(desk.tool, 'cursor');
      // The line is painted in the accent, halfway along.
      const accent = parseInt(THEMES[0].colors.accent.slice(1), 16);
      assert.equal(r.pixel(...t.plot(160, 110)) & 0xffffff, accent);
      // H, then a press: a level across the plot.
      t.key('h');
      r.press(...t.plot(100, 40), 1, false, { buttons: 1 });
      r.release(...t.plot(100, 40));
      t.publish();
      assert.equal(t.stage().getAttribute('data-drawings'), '2');
      assert.equal(r.pixel(...t.plot(300, 40)) & 0xffffff, accent);
      // Delete removes them.
      t.key('Delete');
      t.publish();
      assert.equal(t.stage().getAttribute('data-drawings'), '0');
      // Studies: B from the keyboard, then EMA from the Action on the canvas.
      t.key('b');
      t.publish();
      assert.equal(t.stage().getAttribute('data-studies'), 'sma bb rsi');
      assert.ok(t.texts().some((/** @type {string} */ x) => x.includes('BB 20 2 ')), 'the legend shows the bands');
      const [ex, ey] = t.spot('EMA');
      r.press(ex, ey, 1, false, {});
      r.release(ex, ey);
      t.publish();
      assert.equal(t.stage().getAttribute('data-studies'), 'sma ema bb rsi');
      // RSI off: the chart takes the height back.
      t.key('r');
      t.publish();
      assert.ok(!t.texts().some((/** @type {string} */ x) => x.startsWith('RSI 14 ')));
    } finally {
      t.page.dispose();
    }
  });

  it('streams ticks: the last candle, the book, the tape and the watchlist follow', async () => {
    const t = await terminalPage();
    try {
      const { desk, feed, step, costs } = t.probe();
      const r = t.skia();
      t.publish();
      const s = feed.series[0];
      const length = s.length;
      const end = desk.view.end;
      for (let k = 0; k < 60; k++) {
        step();
        t.probe().publish();
      }
      assert.equal(s.length, length + 1, 'a new candle each simulated minute');
      assert.equal(desk.view.end, end + 1, 'the view at the latest candles scrolls along');
      const texts = t.texts();
      const d = s.symbol.step;
      assert.ok(texts.includes(money(s.last, d)));
      const book = feed.book(0);
      assert.ok(texts.includes(money(book.asks[0].price, d)) && texts.includes(money(book.bids[0].price, d)), 'the touch on the ladder');
      assert.ok(texts.includes(`spread ${money(book.spread, d)}`));
      const trade = feed.tapes[0].at(-1);
      assert.ok(texts.includes(new Date(trade.time).toISOString().slice(11, 19)), 'the newest print on the tape');
      const q = feed.quote(3);
      assert.ok(texts.includes(`${q.percent >= 0 ? '+' : ''}${q.percent.toFixed(2)}%`), 'every watchlist row follows');
      // Each published frame was timed, with how it repainted.
      const cost = costs.skia.summary();
      assert.equal(cost.frames, 60);
      assert.equal(cost.damage + cost.full + cost.none, 60);
      assert.ok(r.repaint === 'damage' || r.repaint === 'full');
      // An unchanged desk publishes nothing.
      assert.equal(t.probe().publish(), false);
    } finally {
      t.page.dispose();
    }
  });

  it('searches the watchlist in the canvas field and picks a symbol by Enter or a press', async () => {
    const t = await terminalPage();
    try {
      const { desk } = t.probe();
      const r = t.skia();
      t.publish();
      // Focus the Edit (under the "Watchlist" title) and type.
      const [wx, wy] = t.spot('Watchlist');
      r.press(wx + 20, wy + 26, 1, false, {});
      r.release(wx + 20, wy + 26);
      r.type('graph');
      r.present();
      const texts = t.texts();
      assert.ok(texts.includes('Skia Graphics') && !texts.includes('Ren Systems') && !texts.includes('Taffy Layout'), 'only Skia Graphics matches');
      r.key('Enter');
      t.publish();
      assert.equal(desk.symbol, 1);
      assert.equal(t.stage().getAttribute('data-symbol'), 'SKIA');
      assert.ok(t.texts().some((/** @type {string} */ x) => x.startsWith('SKIA · ')), 'the book follows');
      // Clear the field, then press a row: its symbol shows.
      for (let k = 0; k < 5; k++) r.key('Backspace');
      r.present();
      const [tx, ty] = t.spot('TAFY');
      r.press(tx, ty, 1, false, {});
      r.release(tx, ty);
      t.publish();
      assert.equal(t.stage().getAttribute('data-symbol'), 'TAFY');
      // Number keys pick too.
      t.key('5');
      t.publish();
      assert.equal(t.stage().getAttribute('data-symbol'), 'RRXC');
    } finally {
      t.page.dispose();
    }
  });

  it('renders the same chart on ren-dom and ren-skia side by side, from the same frames, and both take gestures', async () => {
    const t = await terminalPage();
    try {
      const { desk, show, costs } = t.probe();
      show('compare');
      assert.ok(await until(() => t.page.all('[data-ren-root="terminal-chart-skia"] canvas').length === 1 && t.page.all('[data-ren-root="terminal-chart-dom"] [data-chart]').length === 1));
      const r = t.probe().renderers.skiaChart;
      const dom = () => t.page.all('[data-ren-root="terminal-chart-dom"]')[0];
      const same = () => {
        r.present();
        const canvas = t.texts(r);
        const labels = [...dom().querySelectorAll('[data-ren="Label"]')].filter(l => !l.hidden && l.getAttribute('hidden') === null).map(l => l.textContent).filter(Boolean);
        for (const text of labels) assert.ok(canvas.includes(text), `the canvas shows "${text}" as the DOM does`);
        const readout = labels.find(x => x.startsWith('O '));
        assert.ok(readout && canvas.includes(readout));
        return labels;
      };
      desk.touch();
      t.publish();
      same();
      // The candles: one SVG figure per canvas figure.
      const shapes = [...dom().querySelectorAll('svg')].map(svg => svg.childNodes.length);
      assert.ok(shapes.some(n => n > 100), 'the candles are SVG elements');
      // A drag on the DOM chart's plot pans both, through the same desk.
      const layer = dom().querySelector('[data-input="main"]');
      const fire = (/** @type {string} */ type, /** @type {number} */ x, /** @type {number} */ y, extra = {}) => {
        const e = new t.page.window.Event(type, { bubbles: true, cancelable: true });
        Object.assign(e, { offsetX: x, offsetY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 0, ...extra });
        layer.dispatchEvent(e);
        return e;
      };
      const end = desk.view.end;
      const count = desk.view.count;
      fire('pointerdown', 200, 100);
      fire('pointermove', 260, 100);
      fire('pointerup', 260, 100);
      const plotW = PANE.width - AXIS;
      assert.ok(Math.abs(desk.view.end - (end - (60 / plotW) * count)) < 1e-9, 'the DOM gesture reached the desk in the pane\'s pixels');
      // Hover on the DOM, then on the canvas: both show the same crosshair values.
      fire('pointermove', 150, 80, { buttons: 0 });
      t.publish();
      const labels = same();
      assert.ok(labels.length > 10);
      r.move(150, READOUT + 80, { buttons: 0 });
      t.publish();
      same();
      // A pinch on the DOM zooms (and the page does not scroll).
      assert.ok(fire('wheel', 150, 80, { deltaY: -10, ctrlKey: true, buttons: 0 }).defaultPrevented);
      t.publish();
      same();
      // Both were timed on the same frames.
      assert.equal(costs.skia.n, costs.dom.n);
      assert.ok(costs.skia.n >= 3);
    } finally {
      t.page.dispose();
    }
  });

  it('renders the whole desk on ren-dom too, with the same texts', async () => {
    const t = await terminalPage();
    try {
      const { show, feed } = t.probe();
      t.publish();
      const skia = t.texts();
      show('dom');
      assert.ok(await until(() => t.page.all('[data-ren-root="terminal-dom"] [data-terminal]').length === 1));
      const root = t.page.all('[data-ren-root="terminal-dom"]')[0];
      const labels = [...root.querySelectorAll('[data-ren="Label"], [data-ren="Action"]')].map(l => l.textContent).filter(Boolean);
      for (const text of labels) assert.ok(skia.includes(text), `the canvas showed "${text}" too`);
      assert.ok(labels.includes(money(feed.series[0].last, 0.01)));
      assert.equal(root.querySelectorAll('[data-quote]').length, SYMBOLS.length);
      assert.equal(root.querySelectorAll('input, textarea').length, 1, 'the search is a native field on the DOM');
    } finally {
      t.page.dispose();
    }
  });

  it('on a phone lays the desk out in one column, the chart over the watchlist, on Skia and on the DOM', async () => {
    const t = await terminalPage();
    try {
      const { show } = t.probe();
      const stage = () => t.page.all('.term-stage')[0];
      assert.equal(stage().getAttribute('data-layout'), 'wide');
      t.page.window.happyDOM.setViewport({ width: 390, height: 844 });
      assert.ok(await until(() => stage().getAttribute('data-layout') === 'narrow'), 'the phone layout');
      assert.ok(await until(() => t.skia()?.width < NARROW), 'a Skia desk made at the phone’s width');
      const width = t.skia().width;
      assert.ok(width <= 390 - 24, `${width}`);
      assert.equal(t.skia().height, TALL);
      t.publish();
      const texts = t.texts();
      for (const s of SYMBOLS) assert.ok(texts.includes(s.id), `the watchlist shows ${s.id}`);
      assert.ok(texts.includes('SMA') && texts.includes('Latest'), 'the toolbar');
      assert.ok(texts.includes('Order book') && texts.includes('Trades'), 'the switch to the book and the tape');
      // The readout on two rows: the prices, then the volume and change.
      const ohlc = texts.find((/** @type {string} */ t) => t.startsWith('O '));
      assert.ok(ohlc && !ohlc.includes('V '), ohlc);
      assert.ok(texts.some((/** @type {string} */ t) => /^V \S+ {2}[+-]\d/.test(t)), 'the volume row');
      // The switch on the canvas: the order book, then the tape, in the watchlist's place.
      t.skia().press(...t.spot('Order book'));
      t.publish();
      assert.ok(t.texts().some((/** @type {string} */ x) => x.startsWith('spread ')), 'the order book');
      assert.ok(!t.texts().includes('RRXC'), 'in place of the watchlist');
      t.skia().press(...t.spot('Trades'));
      t.publish();
      assert.ok(t.texts().includes('Trades') && !t.texts().some((/** @type {string} */ x) => x.startsWith('spread ')), 'the tape');
      t.skia().press(...t.spot('Watchlist'));
      t.publish();
      // The chart spans the desk over the watchlist: on the DOM, their boxes say so.
      show('dom');
      assert.ok(await until(() => t.page.all('[data-ren-root="terminal-dom"] [data-terminal]').length === 1));
      const root = t.page.all('[data-ren-root="terminal-dom"]')[0];
      const desk = root.querySelector('[data-terminal]');
      assert.equal(desk.style.width, `${width}px`);
      assert.equal(desk.style.flexDirection, 'column');
      assert.equal(root.querySelector('[data-chart="price"]').style.width, `${width - STRIP}px`);
      assert.equal(root.querySelector('[data-watchlist]').style.width, `${width}px`);
      assert.equal(root.querySelectorAll('[data-quote]').length, SYMBOLS.length);
      assert.equal(root.querySelectorAll('[data-readout="volume"]').length, 1, 'the readout on two rows');
      root.querySelector('[data-panel="book"]').click();
      assert.ok(await until(() => root.querySelector('[data-book="levels"]') !== null && root.querySelector('[data-watchlist]') === null), 'the order book in the watchlist’s place');
      root.querySelector('[data-panel="trades"]').click();
      assert.ok(await until(() => root.querySelector('[data-tape="trades"]') !== null && root.querySelector('[data-book="levels"]') === null), 'the tape');
      root.querySelector('[data-panel="watchlist"]').click();
      assert.ok(await until(() => root.querySelector('[data-watchlist]') !== null));
      // Wide again: the desk's three columns.
      t.page.window.happyDOM.setViewport({ width: 1280, height: 900 });
      assert.ok(await until(() => stage().getAttribute('data-layout') === 'wide' && root.isConnected === false));
      assert.ok(await until(() => t.page.all('[data-ren-root="terminal-dom"] [data-terminal]')[0]?.style.width === `${WIDTH}px`));
    } finally {
      t.page.dispose();
    }
  });

  it('follows the theme at once (setTheme): the same canvas, restyled in the new palette, its state kept', async () => {
    const t = await terminalPage();
    try {
      const { desk } = t.probe();
      desk.toggle('bb');
      t.publish();
      const first = t.skia();
      const tide = /** @type {any} */ (THEMES.find(x => x.id === 'tide'));
      // A selection on the canvas, before the theme changes.
      const [sx, sy] = t.spot('RENX', first, t.origin[0]);
      first.press(sx, sy, 2, false, {});
      first.release(sx, sy);
      t.setTheme(tide);
      t.publish();
      assert.equal(t.skia(), first, 'the same renderer');
      assert.ok(!first.closed);
      assert.equal(first.copied(), 'RENX', 'the selection stayed');
      assert.ok(t.texts().some((/** @type {string} */ x) => x.includes('BB 20 2 ')), 'the view stayed');
      const { pixel, want } = t.candle(tide.colors);
      assert.equal(pixel, want);
      assert.equal(t.stage().getAttribute('data-studies'), 'sma bb rsi', 'the desk is the page\'s: it stays');
    } finally {
      t.page.dispose();
    }
  });
});
