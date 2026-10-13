// What Studio draws, in ren-core's portable primitives only: each shape is
// a View, Label or Shape placed on a one-cell grid (every item in row 1,
// column 1, offset by its margin, so they overlap in paint order as on an
// artboard). The same Item renders on the Skia canvas (with the editor's
// overlay: selection, handles, snapping guides, the marquee and a zoom HUD
// of Actions) and, unchanged, in the HTML (ren-html) and data (ren-json)
// exports. Colors come from the theme through `look()`, so a new theme
// draws the same design in its palette.

import { $at, $memo, $read, $mirror } from 'rrx-core';
import { $active, $lookup, For, Show, Props, Send, View as Box, Label, Shape, Action, Layout } from 'ren-core';
import { THEMES, Look, look, argb } from '../../themes.js';
import { paint, bounds, frame, handles, ends, turns, extent } from './document.js';

/** @typedef {import('./document.js').Shape} Shape */
/** @typedef {import('./document.js').Doc} Doc */
/** @typedef {import('./document.js').Box} Area */
/** @typedef {import('./editor.js').Camera} Camera */

/** The one grid cell every item sits in. */
const CELL = { row: 1, column: 1 };

/** A grid of one cell, `width` × `height`, clipping what lies outside. @param {number} width @param {number} height */
export const board = (width, height) => ({ display: /** @type {const} */ ('grid'), columns: 'minmax(0, 1fr)', rows: 'minmax(0, 1fr)', width, height, overflow: /** @type {const} */ ('hidden') });

/** A document box on the screen, as an item's place in the cell. @param {Area} b @param {Camera} c */
export const place = (b, c) => ({ ...CELL, margin: /** @type {[number, number, number, number]} */ ([b.y * c.zoom + c.y, 0, 0, b.x * c.zoom + c.x]), width: Math.max(1, b.w * c.zoom), height: Math.max(1, b.h * c.zoom) });

/** A theme token as ARGB for a Shape's figures (0 for none). @param {string} token */
const figure = token => {
  const hex = paint(look().colors, token);
  return hex === null ? 0 : argb(hex);
};

/** The corners of a turned box, in its screen box's own coordinates. @param {Shape} s @param {Camera} c @param {Area} b the screen box's document area */
const turned = (s, c, b) => {
  const a = (s.rotation * Math.PI) / 180;
  const cx = (s.x + s.w / 2 - b.x) * c.zoom;
  const cy = (s.y + s.h / 2 - b.y) * c.zoom;
  /** @param {number} px @param {number} py */
  const at = (px, py) => [cx + (px * Math.cos(a) - py * Math.sin(a)) * c.zoom, cy + (px * Math.sin(a) + py * Math.cos(a)) * c.zoom];
  if (s.kind === 'rect') return [[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([dx, dy]) => at((dx * s.w) / 2, (dy * s.h) / 2));
  // An ellipse as a polygon of 48 sides.
  return Array.from({ length: 48 }, (_, i) => at((Math.cos((i / 48) * Math.PI * 2) * s.w) / 2, (Math.sin((i / 48) * Math.PI * 2) * s.h) / 2)).flat();
};

/**
 * The figures of a shape drawn with Shape: an ellipse, a turned rectangle
 * or ellipse, or an arrow; in the coordinates of its screen box.
 * @param {Shape} s @param {Camera} c @returns {Record<string, unknown>[]}
 */
export function figures(s, c) {
  const b = reach(s);
  const fill = figure(s.fill);
  const stroke = figure(s.stroke);
  const width = Math.max(1, s.line * c.zoom);
  if (s.kind === 'arrow') {
    const x0 = (s.x - b.x) * c.zoom;
    const y0 = (s.y - b.y) * c.zoom;
    const x1 = (s.x + s.w - b.x) * c.zoom;
    const y1 = (s.y + s.h - b.y) * c.zoom;
    const length = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / length;
    const uy = (y1 - y0) / length;
    const head = Math.min(length, Math.max(8, s.line * 5) * c.zoom);
    const bx = x1 - ux * head;
    const by = y1 - uy * head;
    const half = head * 0.45;
    return [
      { kind: 'line', x: x0, y: y0, right: bx + ux, bottom: by + uy, color: stroke, stroke: width },
      { kind: 'path', points: [x1, y1, bx - uy * half, by + ux * half, bx + uy * half, by - ux * half], closed: true, color: stroke },
    ];
  }
  const out = [];
  if (s.rotation !== 0 && turns(s)) {
    const points = turned(s, c, b);
    if (fill !== 0) out.push({ kind: 'path', points, closed: true, color: fill });
    if (stroke !== 0 && s.line > 0) out.push({ kind: 'path', points, closed: true, color: stroke, stroke: width });
    return out;
  }
  const inset = stroke !== 0 && s.line > 0 ? width / 2 : 0;
  const w = s.w * c.zoom;
  const h = s.h * c.zoom;
  if (fill !== 0) out.push({ kind: 'oval', x: 0, y: 0, right: w, bottom: h, color: fill });
  if (inset > 0) out.push({ kind: 'oval', x: inset, y: inset, right: w - inset, bottom: h - inset, color: stroke, stroke: width });
  return out;
}

/** The document area a shape's item covers: an arrow's bounds with room for its head. @param {Shape} s @returns {Area} */
export function reach(s) {
  const b = bounds(s);
  if (s.kind !== 'arrow') return b;
  const pad = Math.max(8, s.line * 5);
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

/**
 * One shape, as the primitive that draws it. `get` reads the shape (from
 * a store path on the canvas, so only its own changes redraw it) and
 * `camera` the view.
 * `cursor`, on the canvas, is the pointer's cursor over it.
 * @param {{ get: () => Shape, camera: () => Camera, cursor?: () => string | null }} props
 */
export function Item(props) {
  const { camera } = props;
  // A removed shape's item may read once more before its row goes: it keeps the last shape.
  let last = props.get();
  const get = () => (last = props.get() ?? last);
  const first = last;
  const kind = first.kind;
  const common = { 'data-shape': kind, 'data-name': () => get().name, hidden: () => get().hidden };
  // What a drawn shape means, for the data export: an image named by its layer, of its kind.
  const drawn = { ...common, role: 'img', 'aria-label': () => get().name, 'aria-roledescription': kind === 'rect' ? 'rectangle' : kind };
  /** The place of a box, with the cursor over it. @param {Area} b */
  const at = b => {
    const cursor = props.cursor?.() ?? null;
    const placed = place(b, camera());
    return cursor === null ? placed : { ...placed, cursor };
  };
  if (kind === 'text') {
    return (
      <Label
        {...common}
        wrap
        text={() => get().text}
        style={() => {
          const s = get();
          const c = look().colors;
          return { ...at(frame(s)), fontSize: s.size * camera().zoom, lineHeight: 1.3, color: paint(c, s.fill) ?? c.ink, select: 'none', overflow: 'hidden' };
        }}
      />
    );
  }
  if (kind === 'frame' || kind === 'rect') {
    const R = $active();
    const straight = $memo(R, () => get().rotation === 0 || kind === 'frame');
    const box = () => {
      const s = get();
      const cam = camera();
      const c = look().colors;
      const stroked = s.stroke !== 'none' && s.line > 0;
      return { ...at(frame(s)), background: paint(c, s.fill) ?? 'transparent', radius: s.radius * cam.zoom, border: stroked ? Math.max(1, s.line * cam.zoom) : 0, borderColor: paint(c, s.stroke) ?? 'transparent' };
    };
    // A turned rectangle is drawn as a Shape; the region rebuilds only when it turns or straightens.
    return () => ($read(straight) ? <Box {...drawn} style={box} /> : <Shape {...drawn} style={() => at(reach(get()))} shapes={() => figures(get(), camera())} />);
  }
  return <Shape {...drawn} style={() => at(reach(get()))} shapes={() => figures(get(), camera())} />;
}

/**
 * The design alone, for the exports: its shown shapes at their size, on a
 * board around them. Reads the document from the root's props.
 */
export function Design() {
  const doc = /** @type {Doc} */ ($lookup(Props));
  const area = extent(doc) ?? { x: 0, y: 0, w: 0, h: 0 };
  const margin = 24;
  const camera = { zoom: 1, x: margin - area.x, y: margin - area.y };
  const c = look().colors;
  return (
    <Box data-design="studio" role="figure" aria-label="Studio design" style={{ ...board(Math.ceil(area.w + margin * 2), Math.ceil(area.h + margin * 2)), background: c.canvas }}>
      {doc.order.map(id => (
        <Item get={() => doc.shapes[id]} camera={() => camera} />
      ))}
    </Box>
  );
}

/**
 * What the canvas root receives as props from the editor.
 * @typedef {object} View
 * @property {Doc} doc
 * @property {Camera} camera
 * @property {string[]} selection
 * @property {import('./document.js').Guide[]} guides
 * @property {Area | null} marquee
 * @property {string | null} hover
 * @property {import('./editor.js').Tool} tool
 * @property {import('../../themes.js').Theme | null} theme
 * @property {number} width
 * @property {number} height
 */

/** No area. @type {Area} */
const EMPTY = { x: 0, y: 0, w: 0, h: 0 };

/** The canvas before its props arrive. @type {View} */
const NONE = { doc: { order: [], shapes: {} }, camera: { zoom: 1, x: 0, y: 0 }, selection: [], guides: [], marquee: null, hover: null, tool: 'select', theme: null, width: 0, height: 0 };

/** The board's cursor for each tool. @type {Record<string, string>} */
const TOOL_CURSORS = { select: 'default', hand: 'grab', text: 'text', frame: 'crosshair', rect: 'crosshair', ellipse: 'crosshair', arrow: 'crosshair' };

/** The cursor over each handle. @type {Record<string, string>} */
const HANDLE_CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', start: 'move', end: 'move' };

/** A dot every `step` document units, thinned out when they crowd. @param {Camera} c @param {number} width @param {number} height @param {number} color */
function dots(c, width, height, color) {
  let step = 20 * c.zoom;
  while (step < 18) step *= 2;
  const out = [];
  const x0 = ((c.x % step) + step) % step;
  const y0 = ((c.y % step) + step) % step;
  for (let y = y0; y < height; y += step) for (let x = x0; x < width; x += step) out.push({ kind: 'rect', x: x - 0.75, y: y - 0.75, right: x + 0.75, bottom: y + 0.75, color });
  return out;
}

/**
 * The editing canvas (the Skia root's view). Everything it shows comes
 * from the root's props, kept in a store of its own with `$mirror`, so a
 * change redraws only the shapes it touched; the theme is one of them, so
 * a new theme restyles the board in place (with the renderer's `setTheme`).
 */
export function Canvas() {
  const R = $active();
  // Props arrive after the first build (and, in worker mode, a message later): until then, an empty board.
  const S = /** @type {import('rrx-core').Box<View>} */ ($mirror(R, () => $lookup(Props) ?? NONE));
  const theme = $memo(R, () => /** @type {import('../../themes.js').Theme | null} */ ($at(S, ['theme'])) ?? THEMES[0]);
  return (
    <Look value={theme}>
      <Board S={S} />
    </Look>
  );
}

/**
 * The dotted board, the design, and over it the selection, handles,
 * guides, marquee and the zoom HUD. The board takes the pointer itself
 * (ren-canv's pointer events) and sends each gesture to the editor, which
 * owns the document; its cursor follows the tool, a selected shape's is
 * move and each handle's resizes.
 * @param {{ S: import('rrx-core').Box<View> }} props
 */
function Board(props) {
  const { S } = props;
  const R = $active();
  const send = $lookup(Send);
  const width = () => /** @type {number} */ ($at(S, ['width']));
  const height = () => /** @type {number} */ ($at(S, ['height']));
  const camera = () => /** @type {Camera} */ ($at(S, ['camera']));
  const tool = () => /** @type {string} */ ($at(S, ['tool']));
  const c = () => look().colors;
  const ren = () => look().ren;
  const accent = () => /** @type {number} */ (ren().accent);
  /** @param {string} id */
  const shape = id => /** @type {Shape} */ ($at(S, ['doc', 'shapes', id]));
  const selection = () => /** @type {string[]} */ ($at(S, ['selection'])).filter(id => shape(id) != null);
  /** The one selected shape, or null. */
  const single = $memo(R, () => {
    const ids = selection();
    return ids.length === 1 ? ids[0] : null;
  });
  const outline = () => ({ background: 'transparent', border: 1, borderColor: accent() });
  /** A shape's cursor: move while it is selected and the select tool is on. @param {string} id */
  const cursor = id => () => (tool() === 'select' && $at(S, ['selection']).includes(id) && !shape(id)?.locked ? 'move' : null);
  /** A pointer event's gesture, for the editor. @param {string} gesture @param {any} e */
  const gesture = (gesture, e) => ({ gesture, x: e.x, y: e.y, shift: e.shiftKey, button: e.button });
  return (
    <Box
      style={() => ({ ...board(width(), height()), background: c().canvas, cursor: TOOL_CURSORS[tool()] ?? 'default', touchAction: 'none' })}
      onPointerDown={e => {
        // The drag keeps the pointer past the board, as on the DOM.
        /** @type {any} */ (e.currentTarget).setPointerCapture?.(e.pointerId);
        send(gesture('down', e));
      }}
      onPointerMove={e => send(gesture('move', e))}
      onPointerUp={() => send({ gesture: 'up' })}
      // A press the browser takes back ends the gesture as a release does.
      onPointerCancel={() => send({ gesture: 'up' })}
      onPointerLeave={() => send({ gesture: 'leave' })}
      onWheel={e => {
        e.preventDefault();
        send({ gesture: 'wheel', x: e.x, y: e.y, dx: e.deltaX, dy: e.deltaY, zoom: e.ctrlKey || e.metaKey });
      }}
    >
      <Shape style={() => ({ ...CELL, width: width(), height: height() })} shapes={() => dots(camera(), width(), height(), /** @type {number} */ (ren().border))} />
      <For each={() => $at(S, ['doc', 'order'])}>{id => <Item get={() => shape(id())} camera={camera} cursor={cursor(id())} />}</For>
      {/* Frame names, above each frame, at the screen's size. */}
      <For each={() => /** @type {string[]} */ ($at(S, ['doc', 'order'])).filter(id => shape(id).kind === 'frame')}>
        {row => {
          const id = row();
          // A removed frame's title may read once more before its row goes: it keeps the last frame.
          let last = shape(id);
          const get = () => (last = shape(id) ?? last);
          return (
            <Label
              text={() => get().name}
              hidden={() => get().hidden}
              style={() => {
                const s = get();
                const cam = camera();
                return { ...CELL, margin: [s.y * cam.zoom + cam.y - 18, 0, 0, s.x * cam.zoom + cam.x], height: 16, fontSize: 11, color: $at(S, ['selection']).includes(id) ? accent() : c().muted, select: 'none' };
              }}
            />
          );
        }}
      </For>
      {/* Bindings under a Show may read once more as it closes: they fall back to an empty box. */}
      <Show when={() => { const id = $at(S, ['hover']); return id !== null && shape(id) != null && !$at(S, ['selection']).includes(id); }}>
        <Box style={() => { const id = $at(S, ['hover']); const s = id === null ? null : shape(id); return { ...place(s == null ? EMPTY : bounds(s), camera()), ...outline(), border: 2 }; }} />
      </Show>
      <For each={selection}>{id => <Box style={() => { const s = shape(id()); return { ...place(s == null ? EMPTY : bounds(s), camera()), ...outline() }; }} />}</For>
      <For by="position" each={() => /** @type {import('./document.js').Guide[]} */ ($at(S, ['guides']))}>
        {g => (
          <Box
            style={() => {
              const guide = g();
              const box = guide.axis === 'x' ? { x: guide.at, y: guide.from, w: 0, h: guide.to - guide.from } : { x: guide.from, y: guide.at, w: guide.to - guide.from, h: 0 };
              return { ...place(box, camera()), background: ren().danger };
            }}
          />
        )}
      </For>
      <Show when={() => $at(S, ['marquee']) !== null}>
        <Box style={() => ({ ...place(/** @type {Area | null} */ ($at(S, ['marquee'])) ?? EMPTY, camera()), background: ((accent() & 0xffffff) | 0x1f000000) >>> 0, border: 1, borderColor: accent() })} />
      </Show>
      {/* Keyed by the id: another shape selected builds its handles afresh. */}
      <For each={() => { const id = $read(single); return id === null ? [] : [id]; }}>
        {one => {
          const id = one();
          const points = () => {
            const s = shape(id);
            return s == null || s.locked ? [] : s.kind === 'arrow' ? ends(s) : handles(frame(s));
          };
          return (
            <>
              <For by="position" each={points}>
                {h => (
                  // A handle is a 12-pixel target around its 8-pixel square: a press there resizes by it.
                  <Box
                    style={() => {
                      const [name, x, y] = h();
                      const cam = camera();
                      return { ...CELL, margin: [y * cam.zoom + cam.y - 6, 0, 0, x * cam.zoom + cam.x - 6], width: 12, height: 12, padding: 2, cursor: HANDLE_CURSORS[name] };
                    }}
                    onPointerDown={e => {
                      e.stopPropagation();
                      /** @type {any} */ (e.currentTarget).setPointerCapture?.(e.pointerId);
                      send({ ...gesture('down', e), handle: h()[0] });
                    }}
                  >
                    <Box style={() => ({ width: 8, height: 8, background: ren().paper, border: 1, borderColor: accent(), radius: 2 })} />
                  </Box>
                )}
              </For>
              {/* The size under the selection, centred. */}
              <Box
                style={() => {
                  const s = shape(id);
                  const cam = camera();
                  const b = s == null ? EMPTY : bounds(s);
                  return { ...CELL, margin: [(b.y + b.h) * cam.zoom + cam.y + 8, 0, 0, (b.x + b.w / 2) * cam.zoom + cam.x - 60], width: 120, align: 'center' };
                }}
              >
                <Label
                  text={() => {
                    const s = shape(id);
                    const b = s == null ? EMPTY : bounds(s);
                    return `${Math.round(b.w)} × ${Math.round(b.h)}`;
                  }}
                  style={() => ({ background: accent(), color: c().accentInk, fontSize: 11, padding: [2, 6], radius: 4, select: 'none' })}
                />
              </Box>
            </>
          );
        }}
      </For>
      {/* The zoom HUD: Actions on the canvas, whose presses reach the editor as messages; a press there is no gesture on the board. */}
      <Layout layout="row" onPointerDown={e => e.stopPropagation()} style={() => ({ ...CELL, margin: [height() - 46, 0, 0, 12], self: 'start', justify: 'start', align: 'center', gap: 2, padding: 4, background: c().surface, radius: 10, border: 1, borderColor: c().rule, shadow: { y: 2, blur: 8, color: ((/** @type {number} */ (ren().ink) & 0xffffff) | 0x24000000) >>> 0 }, cursor: 'default' })}>
        {[
          ['−', 'out'],
          [() => `${Math.round(camera().zoom * 100)}%`, 'reset'],
          ['+', 'in'],
          ['Fit', 'fit'],
        ].map(([text, zoom]) => (
          <Action text={text} style={() => ({ height: 28, padding: [0, 10], radius: 6, background: 'transparent', color: c().ink, border: 0, fontSize: 13, hover: { background: c().soft } })} onPress={() => send({ zoom })} />
        ))}
      </Layout>
    </Box>
  );
}
