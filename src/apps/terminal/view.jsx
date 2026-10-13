// What Terminal draws, in ren-core's portable primitives only, so the same
// components render on ren-skia (CanvasKit) and on ren-dom (SVG shapes and
// elements). `Chart` is the price chart: a readout row, the main pane
// (grid, volume, candles, studies, drawings, crosshair, price axis), the
// RSI pane and the time axis, each pane a one-cell grid whose items are
// placed by their margins. `Terminal` is the whole desk around it: the
// watchlist with sparklines and a search field, a toolbar and a drawing
// strip, the order book and the trades tape.
//
// Both read the frame the page publishes as the root's props and the
// candles from the shared feed (`Market`); each field of the frame is a memo
// cut off by identity, so a hover recomputes the crosshair and readout, a
// pan the window's figures, and a tick what shows the last candle. Pointer
// gestures and presses go back to the page's desk through Send. Every color
// comes from the theme through `look()`.

import { $memo, $read, $equals, $signal, $write, $lookup, $untrack } from 'rrx-core';
import { $active, Props, Send, For, Show, View as Box, Label, Shape, Action, Edit } from 'ren-core';
import { look } from '../../themes.js';
import { Market, SYMBOLS, HISTORY, LEVELS, money, compact, decimals } from './market.js';
import { sma, ema, bollinger, rsi, windowOf, autoRange, xOf, indexAt, yOf, priceTicks, timeTicks, candles, volumes, line, band, grid, drawn, shift, panes, paintOf, fade, argb, stamp, PERIODS, BAND, READOUT, AXIS, TIME, readoutOf } from './chart.js';
import { LEGEND } from './desk.js';

/** @typedef {import('./desk.js').Frame} Frame */
/** @typedef {import('./market.js').Feed} Feed */
/** @typedef {import('./chart.js').Window} Window */

/** The frame before the page publishes one. @type {Frame} */
export const EMPTY = { tick: 0, symbol: 0, end: HISTORY + 6, count: 120, range: null, studies: { sma: true, ema: false, bb: false, rsi: true }, tool: 'cursor', drawings: [], draft: null, cursor: null };

/** An item placed in its pane's one cell, `w` × `h` at (x, y). @param {number} x @param {number} y @param {number} w @param {number} h */
const cell = (x, y, w, h) => ({ row: 1, column: 1, margin: /** @type {[number, number, number, number]} */ ([Math.round(y), 0, 0, Math.round(x)]), width: w, height: h });

/** A pane: a grid of one cell, `w` × `h`, clipping what lies outside. @param {number} w @param {number} h */
const pane = (w, h) => ({ display: /** @type {const} */ ('grid'), columns: 'minmax(0, 1fr)', rows: 'minmax(0, 1fr)', width: w, height: h, overflow: /** @type {const} */ ('hidden') });

/**
 * The theme's colors, following the theme the page publishes with each
 * frame (before the first, the root's own Look): read in a binding or
 * memo, a color follows a theme change, which the renderer takes at once
 * (setTheme) with the view and its state kept.
 * @param {import('rrx-core').Graph} R
 */
function palette(R) {
  const theme = $memo(R, () => /** @type {Frame | undefined} */ ($lookup(Props))?.theme ?? look());
  const paints = $memo(R, () => paintOf($read(theme).colors));
  const c = /** @type {import('../../themes.js').Palette} */ (new Proxy({}, { get: (_, key) => /** @type {any} */ ($read(theme).colors)[key] }));
  const paint = /** @type {import('./chart.js').Paint} */ (new Proxy({}, { get: (_, key) => /** @type {any} */ ($read(paints))[key] }));
  return { c, paint };
}

/** Windows equal in every field. @param {Window} a @param {Window} b */
const sameWindow = (a, b) => a.from === b.from && a.to === b.to && a.start === b.start && a.width === b.width;

/**
 * The pointer handlers of a pane's input layer: its gestures, in the pane's
 * own pixels (`offsetX`/`offsetY`: the layer has no children, so it is the
 * target on every renderer), sent to the desk with the pane's size. A
 * press captures the pointer, so a drag keeps it past the pane (as on the
 * DOM, on the canvases too); leaving the pane hides the crosshair. A press
 * the browser takes back (a touch that scrolls the page: the panes let a
 * phone's vertical swipe pan it) ends as a release does.
 * @param {(data: any) => void} send @param {'main' | 'lower' | 'axis'} name @param {() => number} w the plot's width @param {() => number} h the pane's height
 */
function gestures(send, name, w, h) {
  /** @param {string} gesture @param {any} e @param {Record<string, unknown>} [more] */
  const post = (gesture, e, more) => send({ gesture, pane: name, x: e.offsetX, y: e.offsetY, w: w(), h: h(), buttons: e.buttons, ...more });
  return {
    'data-input': name,
    onPointerDown: (/** @type {any} */ e) => {
      // No text selection or focus from a press on a chart: it is a gesture.
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      post('down', e);
    },
    onPointerMove: (/** @type {any} */ e) => post('move', e),
    onPointerUp: (/** @type {any} */ e) => post('up', e),
    onPointerCancel: (/** @type {any} */ e) => post('up', e),
    onPointerLeave: (/** @type {any} */ e) => post('leave', e),
    onWheel: (/** @type {any} */ e) => {
      e.preventDefault();
      post('wheel', e, { dx: e.deltaX, dy: e.deltaY, zoom: e.ctrlKey || e.metaKey });
    },
  };
}

/**
 * The price chart, `width` × `height`, of the frame in the root's props;
 * `slim` (a phone's) puts its readout on two rows.
 * @param {{ width: number, height: number, slim?: boolean }} props
 */
export function Chart(props) {
  const R = $active();
  const send = $lookup(Send);
  const feed = /** @type {Feed} */ ($lookup(Market));
  const W = props.width;
  const H = props.height;
  const { c, paint } = palette(R);
  const F = () => /** @type {Frame} */ ($lookup(Props) ?? EMPTY);
  // The frame's fields: each changes only when its value does.
  const tick = $memo(R, () => F().tick);
  const symbol = $memo(R, () => F().symbol);
  const end = $memo(R, () => F().end);
  const count = $memo(R, () => F().count);
  const manual = $memo(R, () => F().range);
  const studies = $memo(R, () => F().studies);
  const drawings = $memo(R, () => F().drawings);
  const draft = $memo(R, () => F().draft);
  const cursor = $memo(R, () => F().cursor);
  const lower = $memo(R, () => $read(studies).rsi);
  const geo = $memo(R, () => panes(W, H, $read(lower), props.slim === true));
  const plot = () => $read(geo).plot;
  const main = () => $read(geo).main;
  const series = () => feed.series[$read(symbol)];
  const step = () => series().symbol.step;
  // Candles in the series: a tick adds one each simulated minute.
  const length = $memo(R, () => {
    $read(tick);
    return series().length;
  });
  // The window, the price scale and the axes: a tick moves them only when the last candle does.
  const win = $equals(
    $memo(R, () => windowOf({ end: $read(end), count: $read(count) }, $read(length), plot())),
    sameWindow,
  );
  const range = $equals(
    $memo(R, () => {
      $read(tick);
      return $read(manual) ?? autoRange(series(), $read(win), step());
    }),
    (a, b) => a.lo === b.lo && a.hi === b.hi,
  );
  const y = (/** @type {number} */ p) => yOf($read(range), main(), p);
  const ticks = $memo(R, () => priceTicks($read(range), main()));
  const times = $equals(
    $memo(R, () => timeTicks(series(), $read(win))),
    (a, b) => a.length === b.length && a.every((t, k) => t.index === b[k].index && t.text === b[k].text),
  );
  // The candle under the crosshair, snapped, or -1.
  const hover = $memo(R, () => {
    const at = $read(cursor);
    if (at === null) return -1;
    const w = $read(win);
    return Math.max(w.from, Math.min(w.to - 1, Math.round(indexAt(w, at.x))));
  });
  /** The candle the readout shows: the hovered one, else the last. */
  const shown = $memo(R, () => {
    $read(tick);
    const h = $read(hover);
    return h >= 0 ? h : series().length - 1;
  });

  // The figures, one Shape each: a hover redraws none of them. Closed
  // candles never change, so their Shapes change only with the window, the
  // scale or a new minute; the live candle (the last), its volume and its
  // studies' last segments are small Shapes of their own, which is all a
  // tick redraws (and all a canvas repaints) while the scale holds.
  const closed = $equals(
    $memo(R, () => {
      const w = $read(win);
      return { ...w, to: Math.min(w.to, $read(length) - 1) };
    }),
    sameWindow,
  );
  const busiest = $memo(R, () => {
    const w = $read(closed);
    const v = series().volume;
    let top = 0;
    for (let i = w.from; i < w.to; i++) if (v[i] > top) top = v[i];
    return top;
  });
  const back = $memo(R, () => {
    const w = $read(win);
    return [...grid($read(ticks).prices.map(y), $read(times).map(t => xOf(w, t.index)), plot(), main(), fade(paint.grid, 0x90)), ...volumes(series(), $read(closed), main(), paint, $read(busiest))];
  });
  const bars = $memo(R, () => candles(series(), $read(closed), $read(range), main(), paint));
  /** The studies over a window: Bollinger's band and lines, the EMA, the SMA. @param {Window} w */
  const studyFigures = w => {
    const on = $read(studies);
    const close = series().close;
    const out = [];
    if (on.bb) {
      const b = bollinger(close, PERIODS.bb, BAND, w.from, w.to);
      out.push(...band(b.upper, b.lower, w, y, fade(paint.bb, 0x1e)), ...line(b.upper, w, y, fade(paint.bb, 0xb0), 1), ...line(b.lower, w, y, fade(paint.bb, 0xb0), 1), ...line(b.mid, w, y, fade(paint.bb, 0x80), 1));
    }
    if (on.ema) out.push(...line(ema(close, PERIODS.ema, w.from, w.to), w, y, paint.ema));
    if (on.sma) out.push(...line(sma(close, PERIODS.sma, w.from, w.to), w, y, paint.sma));
    return out;
  };
  const lines = $memo(R, () => studyFigures($read(closed)));
  const marks = $memo(R, () => {
    const d = $read(draft);
    return drawn(d === null ? $read(drawings) : [...$read(drawings), d], $read(win), $read(range), plot(), main(), paint.accent);
  });
  /** The live candle's box: from the previous candle's centre to past its own body; null when it is out of view. */
  const liveBox = $memo(R, () => {
    const w = $read(win);
    const i = $read(length) - 1;
    if (i < w.from || i >= w.to) return null;
    const x = xOf(w, i);
    const left = Math.floor(x - Math.max(w.width, 2)) - 2;
    return { i, left, width: Math.ceil(x + Math.max(1, w.width * 0.68) / 2) + 2 - left };
  });
  /** The live candle's figures, under the closed candles (its volume and study segments) or over them (its candle), in its box. */
  const liveUnder = $memo(R, () => {
    $read(tick);
    const box = $read(liveBox);
    if (box === null) return [];
    const w = $read(win);
    return shift([...volumes(series(), { ...w, from: box.i, to: box.i + 1 }, main(), paint, Math.max(1, $read(busiest))), ...studyFigures({ ...w, from: Math.max(0, box.i - 1), to: box.i + 1 })], -box.left);
  });
  const liveOver = $memo(R, () => {
    $read(tick);
    const box = $read(liveBox);
    return box === null ? [] : shift(candles(series(), { ...$read(win), from: box.i, to: box.i + 1 }, $read(range), main(), paint), -box.left);
  });
  const liveStyle = () => {
    const box = $read(liveBox);
    return box === null ? cell(0, 0, 1, 1) : cell(box.left, 0, box.width, main());
  };
  const last = () => {
    $read(tick);
    const s = series();
    return { price: s.close[s.length - 1], up: s.close[s.length - 1] >= s.open[s.length - 1] };
  };
  const ink = () => fade(paint.ink, 0x88);
  const hidden = { ...cell(0, 0, 1, 1), background: 'transparent' };
  const tag = { fontSize: 11, padding: /** @type {[number, number]} */ ([1, 4]), radius: 3, select: /** @type {const} */ ('none') };
  // The readout: one row, or on a slim chart (a phone's) the prices over the volume and change.
  const slim = props.slim === true;
  const prices = () => {
    const s = series();
    const i = $read(shown);
    const d = decimals(s.symbol.step);
    const gap = slim ? ' ' : '  ';
    return `O ${s.open[i].toFixed(d)}${gap}H ${s.high[i].toFixed(d)}${gap}L ${s.low[i].toFixed(d)}${gap}C ${s.close[i].toFixed(d)}`;
  };
  const moved = () => {
    const s = series();
    const i = $read(shown);
    const prev = i > 0 ? s.close[i - 1] : s.open[i];
    const change = ((s.close[i] - prev) / prev) * 100;
    return `V ${compact(s.volume[i])}  ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
  };
  const readout = () => `${prices()}  ${moved()}`;
  // The studies' values at the shown candle, for the legend.
  const legend = () => {
    const on = $read(studies);
    const s = series();
    const i = $read(shown);
    const d = decimals(s.symbol.step);
    const parts = [];
    if (on.sma) parts.push(`${LEGEND.sma} ${sma(s.close, PERIODS.sma, i, i + 1)[0].toFixed(d)}`);
    if (on.ema) parts.push(`${LEGEND.ema} ${ema(s.close, PERIODS.ema, i, i + 1)[0].toFixed(d)}`);
    if (on.bb) {
      const b = bollinger(s.close, PERIODS.bb, BAND, i, i + 1);
      parts.push(`${LEGEND.bb} ${b.lower[0].toFixed(d)} – ${b.upper[0].toFixed(d)}`);
    }
    return parts.join('   ');
  };
  const cross = () => {
    const at = $read(cursor);
    const h = $read(hover);
    return at === null || h < 0 ? null : { x: Math.round(xOf($read(win), h)), y: Math.round(at.y), pane: at.pane };
  };
  const RSI_H = () => $read(geo).lower;
  const rsiY = (/** @type {number} */ v) => ((100 - v) / 100) * (RSI_H() - 8) + 4;
  const rsiValues = $memo(R, () => {
    const w = $read(closed);
    return rsi(series().close, PERIODS.rsi, w.from, w.to);
  });
  /** The RSI at the live candle and the one before it. */
  const rsiLive = $memo(R, () => {
    $read(tick);
    const box = $read(liveBox);
    return box === null ? null : rsi(series().close, PERIODS.rsi, Math.max(0, box.i - 1), box.i + 1);
  });
  /** The RSI at the shown candle. */
  const rsiShown = () => {
    const i = $read(shown);
    const box = $read(liveBox);
    if (box !== null && i === box.i) return /** @type {Float64Array} */ ($read(rsiLive)).at(-1) ?? NaN;
    return $read(rsiValues)[i - $read(closed).from] ?? rsi(series().close, PERIODS.rsi, i, i + 1)[0];
  };
  return (
    <Box data-chart="price" style={() => ({ width: W, height: H, background: c.surface, color: c.ink })}>
      {slim ? (
        <Box style={{ height: readoutOf(true), padding: [3, 8], overflow: 'hidden', justify: 'center' }}>
          <Box style={{ direction: 'row', align: 'center', gap: 8, height: 20 }}>
            <Label text={() => series().symbol.id} style={{ fontWeight: 'bold', fontSize: 13 }} />
            <Label data-readout="ohlc" text={prices} style={() => ({ fontSize: 12, color: c.muted })} />
          </Box>
          <Box style={{ direction: 'row', align: 'center', gap: 10, height: 20 }}>
            <Label data-readout="volume" text={moved} style={() => ({ fontSize: 12, color: c.muted })} />
            <Label text={legend} style={() => ({ fontSize: 11, color: c.muted, shrink: 1 })} />
          </Box>
        </Box>
      ) : (
        <Box style={{ direction: 'row', align: 'center', gap: 10, height: READOUT, padding: [0, 8], overflow: 'hidden' }}>
          <Label text={() => series().symbol.id} style={{ fontWeight: 'bold', fontSize: 13 }} />
          <Label data-readout="ohlc" text={readout} style={() => ({ fontSize: 12, color: c.muted })} />
          <Label text={legend} style={() => ({ fontSize: 11, color: c.muted, shrink: 1 })} />
        </Box>
      )}
      <Box style={() => pane(W, main())}>
        <Shape style={() => cell(0, 0, plot(), main())} shapes={back} />
        <Shape style={() => cell(0, 0, plot(), main())} shapes={lines} />
        <Shape data-live="under" style={liveStyle} shapes={liveUnder} />
        <Shape style={() => cell(0, 0, plot(), main())} shapes={bars} />
        <Shape data-live="over" style={liveStyle} shapes={liveOver} />
        <Shape style={() => cell(0, 0, plot(), main())} shapes={marks} />
        <Box style={() => ({ ...cell(plot(), 0, 1, main()), background: c.rule })} />
        <For by="position" each={() => $read(ticks).prices}>
          {p => <Label text={() => p().toFixed($read(ticks).decimals)} style={() => ({ ...cell(plot() + 6, Math.max(0, Math.min(main() - 14, y(p()) - 7)), AXIS - 8, 14), fontSize: 11, color: c.muted, select: 'none' })} />}
        </For>
        <Label
          data-tag="last"
          text={() => money(last().price, step())}
          style={() => ({ ...cell(plot() + 1, Math.max(0, Math.min(main() - 16, y(last().price) - 8)), AXIS - 2, 16), ...tag, background: last().up ? paint.up : paint.down, color: c.surface })}
        />
        {/* The crosshair: two hairlines and the price at the pointer; out of the way (1 × 1, transparent) when the pointer is elsewhere. */}
        <Box style={() => { const x = cross(); return x === null ? hidden : { ...cell(x.x, 0, 1, main()), background: ink() }; }} />
        <Box style={() => { const x = cross(); return x === null || x.pane !== 'main' ? hidden : { ...cell(0, x.y, plot(), 1), background: ink() }; }} />
        <Label
          data-tag="cursor"
          text={() => { const x = cross(); return x === null || x.pane !== 'main' ? '' : money(($read(range).hi - (x.y / main()) * ($read(range).hi - $read(range).lo)), step()); }}
          hidden={() => { const x = cross(); return x === null || x.pane !== 'main'; }}
          style={() => { const x = cross(); return { ...cell(plot() + 1, Math.max(0, Math.min(main() - 16, (x?.y ?? 0) - 8)), AXIS - 2, 16), ...tag, background: c.ink, color: c.surface }; }}
        />
        <Box style={() => ({ ...cell(0, 0, plot(), main()), cursor: 'crosshair', touchAction: 'pan-y' })} {...gestures(send, 'main', plot, main)} />
        <Box style={() => ({ ...cell(plot(), 0, AXIS, main()), cursor: 'ns-resize', touchAction: 'none' })} {...gestures(send, 'axis', plot, main)} />
      </Box>
      <Show when={lower}>
        <Box style={() => ({ ...pane(W, RSI_H()), border: 0 })}>
          <Box style={() => ({ ...cell(0, 0, W, 1), background: c.rule })} />
          <Shape
            style={() => cell(0, 0, plot(), RSI_H())}
            shapes={() => {
              const g = fade(paint.grid, 0x90);
              const w = plot();
              return [
                { kind: 'rect', x: 0, y: rsiY(70), right: w, bottom: rsiY(30), color: fade(paint.rsi, 0x14) },
                { kind: 'line', x: 0, y: rsiY(70), right: w, bottom: rsiY(70), color: g, stroke: 1 },
                { kind: 'line', x: 0, y: rsiY(30), right: w, bottom: rsiY(30), color: g, stroke: 1 },
                ...line($read(rsiValues), $read(closed), rsiY, paint.rsi),
              ];
            }}
          />
          <Shape
            style={() => { const box = $read(liveBox); return box === null ? cell(0, 0, 1, 1) : cell(box.left, 0, box.width, RSI_H()); }}
            shapes={() => {
              const box = $read(liveBox);
              const values = $read(rsiLive);
              return box === null || values === null ? [] : shift(line(values, { ...$read(win), from: Math.max(0, box.i - 1), to: box.i + 1 }, rsiY, paint.rsi), -box.left);
            }}
          />
          <Box style={() => ({ ...cell(plot(), 0, 1, RSI_H()), background: c.rule })} />
          {[70, 30].map(v => (
            <Label text={String(v)} style={() => ({ ...cell(plot() + 6, rsiY(v) - 7, AXIS - 8, 14), fontSize: 11, color: c.muted, select: 'none' })} />
          ))}
          <Label text={() => `${LEGEND.rsi} ${rsiShown().toFixed(1)}`} style={() => ({ ...cell(8, 4, 160, 14), fontSize: 11, color: c.series[5] })} />
          <Box style={() => { const x = cross(); return x === null ? hidden : { ...cell(x.x, 0, 1, RSI_H()), background: ink() }; }} />
          <Box style={() => ({ ...cell(0, 0, plot(), RSI_H()), cursor: 'crosshair', touchAction: 'pan-y' })} {...gestures(send, 'lower', plot, RSI_H)} />
        </Box>
      </Show>
      <Box style={() => ({ ...pane(W, TIME), border: 0 })}>
        <Box style={() => ({ ...cell(0, 0, W, 1), background: c.rule })} />
        <For by="position" each={times}>
          {t => <Label text={() => t().text} style={() => ({ ...cell(Math.max(0, Math.min(plot() - 44, xOf($read(win), t().index) - 22)), 4, 44, 14), fontSize: 11, color: c.muted, textAlign: 'center', select: 'none' })} />}
        </For>
        <Label
          data-tag="time"
          text={() => { const h = $read(hover); return h < 0 ? '' : stamp(series().time[h]); }}
          hidden={() => cross() === null}
          style={() => { const x = cross(); return { ...cell(Math.max(0, Math.min(plot() - 96, (x?.x ?? 0) - 48)), 2, 96, 17), ...tag, textAlign: 'center', background: c.ink, color: c.surface }; }}
        />
      </Box>
    </Box>
  );
}

/** The desk's columns, in logical pixels. */
export const LEFT = 190;
export const RIGHT = 226;
/** The toolbar's height and the drawing strip's width. */
export const BAR = 36;
export const STRIP = 38;
/**
 * Below this width (a phone) the desk is one column: the toolbar, the chart
 * with its drawing strip (`CHART` high), then a switch of three panels
 * (`PANELS`) under it: the watchlist, the order book or the trades tape,
 * one at a time, in the room the tallest takes.
 */
export const NARROW = 720;
export const CHART = 360;
/** A watchlist row's height. */
const QUOTE = 46;
/** The switch's height. */
export const TABS = 34;
/** The panels a phone's desk switches between, in the switch's order. */
export const PANELS = /** @type {const} */ (['watchlist', 'book', 'trades']);
/** A phone's desk height: the toolbar, the chart, the switch and the watchlist of every symbol (the book and the tape fit its room). */
export const TALL = BAR + 1 + CHART + 1 + TABS + 1 + 20 + 17 + 8 + 30 + 8 + SYMBOLS.length * (QUOTE + 8) + 4;

/** Order book levels shown on each side. */
const SHOWN = 9;
/** Trades the tape shows. */
const PRINTS = 13;

/**
 * The whole terminal, `width` × `height`: watchlist, toolbar, drawing
 * strip, the chart, the order book and the tape.
 * @param {{ width: number, height: number }} props
 */
export function Terminal(props) {
  const R = $active();
  const send = $lookup(Send);
  const feed = /** @type {Feed} */ ($lookup(Market));
  const { c, paint } = palette(R);
  const F = () => /** @type {Frame} */ ($lookup(Props) ?? EMPTY);
  const tick = $memo(R, () => F().tick);
  const symbol = $memo(R, () => F().symbol);
  const studies = $memo(R, () => F().studies);
  const tool = $memo(R, () => F().tool);
  const narrow = props.width < NARROW;
  const center = narrow ? props.width : props.width - LEFT - RIGHT;
  const button = () => ({ height: 26, padding: /** @type {[number, number]} */ ([0, 9]), radius: 6, fontSize: 12, background: 'transparent', color: c.ink, border: 0, hover: { background: c.soft } });
  const on = () => ({ ...button(), background: c.accentSoft, color: c.accent, hover: { background: c.accentSoft } });
  /** @param {string} text @param {() => boolean} active @param {any} message @param {string} [label] */
  const toggle = (text, active, message, label) => <Action text={text} label={label ?? text} selected={active} style={() => (active() ? on() : button())} onPress={() => send(message)} />;
  const study = (/** @type {'sma' | 'ema' | 'bb' | 'rsi'} */ name, /** @type {string} */ text) => toggle(text, () => $read(studies)[name], { toggle: name }, LEGEND[name]);
  const tools = /** @type {const} */ ([
    ['cursor', '+', 'Crosshair (Esc)'],
    ['trend', '╱', 'Trend line (T)'],
    ['level', '―', 'Horizontal line (H)'],
  ]);
  const chartHigh = narrow ? CHART : props.height - BAR;
  // A phone's panel under the chart: this root's own state, as the watchlist's search.
  const panel = $signal(R, /** @type {typeof PANELS[number]} */ ('watchlist'));
  const watchlist = () => <Watchlist tick={() => $read(tick)} symbol={() => $read(symbol)} paint={paint} width={narrow ? props.width : LEFT} spark={narrow ? 120 : 56} fill={narrow} />;
  return (
    <Box data-terminal="desk" style={() => ({ width: props.width, height: props.height, direction: narrow ? 'column' : 'row', background: c.canvas, color: c.ink })}>
      {narrow ? null : watchlist()}
      <Box style={{ width: center }}>
        <Box style={() => ({ direction: 'row', align: 'center', gap: 2, height: BAR, padding: [0, 6], background: c.surface, border: 0 })}>
          {study('sma', 'SMA')}
          {study('ema', 'EMA')}
          {study('bb', 'BB')}
          {study('rsi', 'RSI')}
          <Box style={() => ({ width: 1, height: 18, background: c.rule, margin: [0, 6] })} />
          <Action text="Auto" label="Auto scale (A)" style={button} onPress={() => send({ auto: true })} />
          <Action text="−" label="Zoom out" style={button} onPress={() => send({ zoom: 'out' })} />
          <Action text="+" label="Zoom in" style={button} onPress={() => send({ zoom: 'in' })} />
          <Action text="Latest" label="Latest (End)" style={button} onPress={() => send({ zoom: 'latest' })} />
        </Box>
        <Box style={() => ({ direction: 'row', height: chartHigh, background: c.rule, gap: 1, padding: [1, 0, 0, 0] })}>
          <Box style={() => ({ width: STRIP - 1, padding: [6, 4], gap: 4, background: c.surface })}>
            {tools.map(([name, text, label]) => toggle(text, () => $read(tool) === name, { tool: name }, label))}
            <Action text="×" label="Remove drawings (Del)" style={button} onPress={() => send({ clear: true })} />
          </Box>
          <Chart width={center - STRIP} height={chartHigh - 1} slim={narrow} />
        </Box>
      </Box>
      {narrow ? <Box style={() => ({ height: 1, shrink: 0, background: c.rule })} /> : null}
      {narrow ? (
        <>
          <Box style={() => ({ direction: 'row', align: 'center', gap: 4, height: TABS, shrink: 0, padding: [0, 8], background: c.surface })}>
            {PANELS.map(name => (
              <Action
                text={{ watchlist: 'Watchlist', book: 'Order book', trades: 'Trades' }[name]}
                label={`Show the ${{ watchlist: 'watchlist', book: 'order book', trades: 'trades' }[name]}`}
                data-panel={name}
                selected={() => $read(panel) === name}
                style={() => ($read(panel) === name ? on() : button())}
                onPress={() => $write(panel, name)}
              />
            ))}
          </Box>
          <Box style={() => ({ height: 1, shrink: 0, background: c.rule })} />
          {() => {
            switch ($read(panel)) {
              case 'book':
                return (
                  <Box style={() => ({ grow: 1, background: c.surface, padding: [10, 12] })}>
                    <Book tick={() => $read(tick)} symbol={() => $read(symbol)} paint={paint} width={props.width - 24} />
                  </Box>
                );
              case 'trades':
                return (
                  <Box style={() => ({ grow: 1, background: c.surface, padding: [0, 12, 10, 12] })}>
                    <Tape tick={() => $read(tick)} symbol={() => $read(symbol)} paint={paint} />
                  </Box>
                );
              default:
                return watchlist();
            }
          }}
        </>
      ) : (
        <Box style={() => ({ width: RIGHT, background: c.surface, padding: [10, 8, 10, 14], gap: 2 })}>
          <Book tick={() => $read(tick)} symbol={() => $read(symbol)} paint={paint} width={RIGHT - 22} />
          <Tape tick={() => $read(tick)} symbol={() => $read(symbol)} paint={paint} />
        </Box>
      )}
    </Box>
  );
}

/**
 * The watchlist: a search field over the symbols, `width` wide (the desk's
 * left column, or on a phone the whole desk under the chart), each row
 * with a sparkline `spark` wide; `fill` takes the height left under the chart.
 * @param {{ tick: () => number, symbol: () => number, paint: import('./chart.js').Paint, width: number, spark: number, fill: boolean }} props
 */
function Watchlist(props) {
  const R = $active();
  const send = $lookup(Send);
  const { c } = palette(R);
  // The search is this root's own state: the page hears only the pick.
  const query = $signal(R, '');
  const found = $memo(R, () => {
    const q = $read(query).trim().toLowerCase();
    return SYMBOLS.map((_, n) => n).filter(n => q === '' || SYMBOLS[n].id.toLowerCase().includes(q) || SYMBOLS[n].name.toLowerCase().includes(q));
  });
  return (
    <Box data-watchlist="" style={() => ({ width: props.width, grow: props.fill ? 1 : 0, padding: [10, 8], gap: 8, background: c.surface })}>
      <Label text="Watchlist" style={{ fontWeight: 'bold', fontSize: 13, padding: [0, 4], select: 'none' }} />
      <Edit
        label="Search symbols"
        value=""
        style={{ height: 30, fontSize: 13 }}
        onChange={e => $write(query, e.value)}
        onSubmit={() => {
          const first = $read(found)[0];
          if (first !== undefined) send({ pick: first });
        }}
      />
      <For each={found} fallback={<Label text="No symbol matches" style={() => ({ color: c.muted, fontSize: 12, padding: [4, 4] })} />}>
        {row => {
          // Keyed by the symbol's index: a row's item never changes.
          const n = $untrack(R, row);
          return <Quote n={n} tick={() => props.tick()} selected={() => props.symbol() === n} paint={props.paint} spark={props.spark} />;
        }}
      </For>
    </Box>
  );
}

/**
 * A watchlist row: ticker and name, a sparkline, the last price and the
 * day's change; a press shows it on the chart.
 * @param {{ n: number, tick: () => number, selected: () => boolean, paint: import('./chart.js').Paint, spark: number }} props
 */
function Quote(props) {
  const R = $active();
  const send = $lookup(Send);
  const feed = /** @type {Feed} */ ($lookup(Market));
  const { c } = palette(R);
  const s = SYMBOLS[props.n];
  const quote = $memo(R, () => {
    props.tick();
    return feed.quote(props.n);
  });
  const W = props.spark;
  const H = 24;
  return (
    <Box
      data-quote={s.id}
      style={() => ({ direction: 'row', align: 'center', gap: 6, height: QUOTE, shrink: 0, padding: [6, 6], radius: 6, background: props.selected() ? c.accentSoft : 'transparent', hover: { background: props.selected() ? c.accentSoft : c.soft } })}
      onPress={() => send({ pick: props.n })}
    >
      <Box style={{ grow: 1, shrink: 1, gap: 1, minWidth: 0 }}>
        <Label text={s.id} style={{ fontWeight: 'bold', fontSize: 12 }} />
        <Label text={s.name} style={() => ({ fontSize: 10, color: c.muted })} />
      </Box>
      <Shape
        style={{ width: W, height: H }}
        shapes={() => {
          const q = $read(quote);
          const v = q.spark;
          let lo = Infinity;
          let hi = -Infinity;
          for (let i = 0; i < v.length; i++) {
            if (v[i] < lo) lo = v[i];
            if (v[i] > hi) hi = v[i];
          }
          const span = hi - lo || 1;
          const points = [];
          for (let i = 0; i < v.length; i++) points.push(Math.round((i / (v.length - 1)) * W * 10) / 10, Math.round((H - 2 - ((v[i] - lo) / span) * (H - 4)) * 10) / 10);
          const color = q.change >= 0 ? props.paint.up : props.paint.down;
          return [
            { kind: 'path', points: [...points, W, H, 0, H], closed: true, color: fade(color, 0x26) },
            { kind: 'path', points, closed: false, color, stroke: 1.25 },
          ];
        }}
      />
      <Box style={{ width: 58, gap: 1, align: 'end' }}>
        <Label text={() => money($read(quote).last, s.step)} style={{ fontSize: 12, textAlign: 'end' }} />
        <Label text={() => { const q = $read(quote); return `${q.percent >= 0 ? '+' : ''}${q.percent.toFixed(2)}%`; }} style={() => ({ fontSize: 11, textAlign: 'end', color: $read(quote).change >= 0 ? c.series[1] : c.danger })} />
      </Box>
    </Box>
  );
}

/**
 * The order book: asks above (best lowest), the spread, bids below, each
 * level with its cumulative depth as a bar behind it.
 * @param {{ tick: () => number, symbol: () => number, paint: import('./chart.js').Paint, width: number }} props
 */
function Book(props) {
  const R = $active();
  const feed = /** @type {Feed} */ ($lookup(Market));
  const { c, paint } = palette(R);
  const book = $memo(R, () => {
    props.tick();
    return feed.book(props.symbol());
  });
  const deepest = () => {
    const b = $read(book);
    return Math.max(b.bids[SHOWN - 1].total, b.asks[SHOWN - 1].total);
  };
  const step = () => SYMBOLS[props.symbol()].step;
  const W = props.width;
  /** @param {() => import('./market.js').Level} level @param {'up' | 'down'} side */
  const Row = (level, side) => (
    <Box style={pane(W, 16)}>
      <Box style={() => ({ ...cell(W - Math.max(1, Math.round((level().total / deepest()) * W)), 0, Math.max(1, Math.round((level().total / deepest()) * W)), 16), background: fade(paint[side], 0x2a) })} />
      <Label text={() => money(level().price, step())} style={() => ({ ...cell(4, 1, 80, 14), fontSize: 11, color: side === 'up' ? c.series[1] : c.danger })} />
      <Label text={() => compact(level().size)} style={{ ...cell(W - 128, 1, 60, 14), fontSize: 11, textAlign: 'end' }} />
      <Label text={() => compact(level().total)} style={() => ({ ...cell(W - 64, 1, 60, 14), fontSize: 11, textAlign: 'end', color: c.muted })} />
    </Box>
  );
  return (
    <Box data-book="levels" style={{ gap: 0 }}>
      <Box style={{ direction: 'row', justify: 'between', height: 22 }}>
        <Label text="Order book" style={{ fontWeight: 'bold', fontSize: 13, select: 'none' }} />
        <Label text={() => `${SYMBOLS[props.symbol()].id} · ${LEVELS} levels`} style={() => ({ fontSize: 11, color: c.muted, select: 'none' })} />
      </Box>
      <For by="position" each={() => $read(book).asks.slice(0, SHOWN).reverse()}>{level => Row(level, 'down')}</For>
      <Box style={() => ({ direction: 'row', justify: 'between', align: 'center', height: 22, padding: [0, 4], background: c.soft, radius: 4 })}>
        <Label text={() => money(feed.series[props.symbol()].last, step())} style={{ fontWeight: 'bold', fontSize: 13 }} data-book="last" />
        <Label text={() => `spread ${money($read(book).spread, step())}`} style={() => ({ fontSize: 11, color: c.muted })} />
      </Box>
      <For by="position" each={() => $read(book).bids.slice(0, SHOWN)}>{level => Row(level, 'up')}</For>
    </Box>
  );
}

/**
 * The trades tape: the newest prints first, bought in the up color, sold in the down color.
 * @param {{ tick: () => number, symbol: () => number, paint: import('./chart.js').Paint }} props
 */
function Tape(props) {
  const R = $active();
  const feed = /** @type {Feed} */ ($lookup(Market));
  const { c } = palette(R);
  const prints = $memo(R, () => {
    props.tick();
    return feed.tapes[props.symbol()].slice(-PRINTS).reverse();
  });
  const step = () => SYMBOLS[props.symbol()].step;
  return (
    <Box data-tape="trades" style={{ gap: 0, margin: [10, 0, 0, 0] }}>
      <Label text="Trades" style={{ fontWeight: 'bold', fontSize: 13, height: 22, select: 'none' }} />
      <For by="position" each={prints} fallback={<Label text="Waiting for prints…" style={() => ({ fontSize: 11, color: c.muted })} />}>
        {trade => (
          <Box style={{ direction: 'row', height: 15, gap: 6 }}>
            <Label text={() => new Date(trade().time).toISOString().slice(11, 19)} style={() => ({ width: 62, fontSize: 11, color: c.muted })} />
            <Label text={() => money(trade().price, step())} style={() => ({ width: 70, fontSize: 11, textAlign: 'end', color: trade().side > 0 ? c.series[1] : c.danger })} />
            <Label text={() => compact(trade().size)} style={{ grow: 1, fontSize: 11, textAlign: 'end' }} />
          </Box>
        )}
      </For>
    </Box>
  );
}

/** For tests and tools: the ARGB of a theme's up and down candles. @param {import('../../themes.js').Palette} c */
export const candleColors = c => ({ up: argb(c.series[1]), down: argb(c.danger) });
