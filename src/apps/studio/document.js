// Studio's document: plain, persistent data (an rrx-core store holds it,
// so every edit copies only the path it changes), the seeded starter design,
// and the geometry every view shares: bounds, hit testing, handles,
// resizing, snapping and the paint of a theme token. Nothing here renders.

/** @typedef {'rect' | 'ellipse' | 'text' | 'frame' | 'arrow'} Kind */

/**
 * One shape. An arrow runs from (x, y) to (x + w, y + h); every other kind
 * is the box x, y, w, h (rotated about its centre by `rotation` degrees,
 * rectangles and ellipses only). Colors are theme tokens (`series-0` …
 * `series-5`, `surface`, `soft`, `ink`, `muted`, `none`), resolved where
 * they are drawn, so a design follows the theme.
 * @typedef {object} Shape
 * @property {string} id
 * @property {Kind} kind
 * @property {string} name
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} rotation
 * @property {string} fill the fill; a text's color
 * @property {string} stroke
 * @property {number} line the stroke width
 * @property {number} radius
 * @property {string} text
 * @property {number} size the font size
 * @property {boolean} hidden
 * @property {boolean} locked
 */

/**
 * The document: the shapes by id, and their paint order (last on top).
 * @typedef {{ order: string[], shapes: Record<string, Shape> }} Doc
 */

/** @typedef {{ x: number, y: number, w: number, h: number }} Box */

/** A snapping guide: a vertical line at x (`axis` 'x') or a horizontal one at y, from `from` to `to`. @typedef {{ axis: 'x' | 'y', at: number, from: number, to: number }} Guide */

/** The kinds, in the toolbar's order. @type {Kind[]} */
export const KINDS = ['frame', 'rect', 'ellipse', 'text', 'arrow'];

/** The paint tokens a fill or stroke may take: the theme's series, then its neutrals. */
export const TOKENS = ['series-0', 'series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'surface', 'soft', 'ink', 'muted', 'none'];

/**
 * A token's color in a theme's palette, or null for `none`.
 * @param {{ series: string[] } & Record<string, any>} colors @param {string} token
 * @returns {string | null}
 */
export function paint(colors, token) {
  if (token === 'none') return null;
  if (token.startsWith('series-')) return colors.series[Number(token.slice(7)) % colors.series.length];
  const value = colors[token];
  return typeof value === 'string' ? value : colors.ink;
}

/** A token as a CSS color from the page's custom properties. @param {string} token */
export const cssPaint = token => (token === 'none' ? 'transparent' : `var(--${token})`);

/** The defaults of a new shape of each kind. @type {Record<Kind, Partial<Shape>>} */
const DEFAULTS = {
  frame: { w: 320, h: 220, fill: 'surface', stroke: 'muted', line: 1, radius: 0 },
  rect: { w: 120, h: 80, fill: 'series-1', stroke: 'none', line: 0, radius: 8 },
  ellipse: { w: 96, h: 96, fill: 'series-2', stroke: 'none', line: 0 },
  text: { w: 180, h: 28, fill: 'ink', stroke: 'none', line: 0, text: 'Text', size: 18 },
  arrow: { w: 140, h: 0, fill: 'none', stroke: 'ink', line: 2 },
};

/**
 * A new shape of `kind` with its defaults, then `fields`.
 * @param {string} id @param {Kind} kind @param {Partial<Shape>} [fields]
 * @returns {Shape}
 */
export function make(id, kind, fields = {}) {
  return {
    id,
    kind,
    name: `${kind[0].toUpperCase()}${kind.slice(1)}`,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    fill: 'none',
    stroke: 'none',
    line: 0,
    radius: 0,
    text: '',
    size: 16,
    hidden: false,
    locked: false,
    ...DEFAULTS[kind],
    ...fields,
  };
}

/** The default size of a kind, for a shape made with a click. @param {Kind} kind */
export const standard = kind => ({ w: /** @type {number} */ (DEFAULTS[kind].w), h: /** @type {number} */ (DEFAULTS[kind].h) });

/**
 * The starter design: a small analytics dashboard mockup, with a sticky
 * note and an arrow pointing at the best week.
 * @returns {Doc}
 */
export function seed() {
  /** @type {Shape[]} */
  const list = [
    make('frame', 'frame', { name: 'Dashboard', x: 0, y: 0, w: 560, h: 380 }),
    make('header', 'rect', { name: 'Header', x: 0, y: 0, w: 560, h: 56, fill: 'series-0', radius: 0 }),
    make('title', 'text', { name: 'Title', x: 24, y: 14, w: 300, h: 28, text: 'Weekly revenue', size: 20, fill: 'surface' }),
    make('avatar', 'ellipse', { name: 'Avatar', x: 508, y: 12, w: 32, h: 32, fill: 'series-3', stroke: 'surface', line: 2 }),
    ...[
      ['Revenue', '$48.2k'],
      ['Orders', '1,284'],
      ['Churn', '2.1%'],
    ].flatMap(([label, value], i) => [
      make(`card-${i}`, 'rect', { name: `Card · ${label}`, x: 24 + i * 176, y: 76, w: 160, h: 84, fill: 'soft', radius: 12 }),
      make(`card-${i}-text`, 'text', { name: `${label} value`, x: 40 + i * 176, y: 88, w: 128, h: 60, text: `${label}\n${value}`, size: 16, fill: 'ink' }),
    ]),
    make('caption', 'text', { name: 'Chart caption', x: 24, y: 176, w: 220, h: 20, text: 'Last six weeks', size: 13, fill: 'muted' }),
    ...[92, 128, 74, 150, 112, 170].map((height, i) =>
      make(`bar-${i}`, 'rect', { name: `Bar ${i + 1}`, x: 48 + i * 84, y: 356 - height, w: 44, h: height, fill: i === 5 ? 'series-4' : 'series-1', radius: 6 }),
    ),
    make('note', 'rect', { name: 'Sticky note', x: 600, y: 48, w: 160, h: 96, fill: 'soft', stroke: 'series-3', line: 2, radius: 4, rotation: -4 }),
    make('note-text', 'text', { name: 'Note text', x: 614, y: 62, w: 132, h: 68, text: 'Best week yet:\nship the report!', size: 14, fill: 'ink' }),
    make('pointer', 'arrow', { name: 'Arrow', x: 640, y: 156, w: -104, h: 34, stroke: 'ink', line: 2 }),
  ];
  return { order: list.map(s => s.id), shapes: Object.fromEntries(list.map(s => [s.id, s])) };
}

/** Degrees to radians. @param {number} deg */
const rad = deg => (deg * Math.PI) / 180;

/**
 * The four corners of a shape's box, rotated about its centre.
 * @param {Shape} s @returns {number[]} x, y pairs
 */
export function corners(s) {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const a = rad(s.rotation);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const out = [];
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const px = (dx * s.w) / 2;
    const py = (dy * s.h) / 2;
    out.push(cx + px * cos - py * sin, cy + px * sin + py * cos);
  }
  return out;
}

/**
 * The axis-aligned box a shape covers (an arrow's two ends; a rotated box's corners).
 * @param {Shape} s @returns {Box}
 */
export function bounds(s) {
  if (s.kind === 'arrow') return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
  if (s.rotation === 0 || !turns(s)) return { x: s.x, y: s.y, w: s.w, h: s.h };
  const c = corners(s);
  const xs = [c[0], c[2], c[4], c[6]];
  const ys = [c[1], c[3], c[5], c[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The box a shape's handles resize: its own, unturned box (an arrow's bounds). @param {Shape} s @returns {Box} */
export const frame = s => (s.kind === 'arrow' ? bounds(s) : { x: s.x, y: s.y, w: s.w, h: s.h });

/** Whether a kind rotates (rectangles and ellipses). @param {Shape} s */
export const turns = s => s.kind === 'rect' || s.kind === 'ellipse';

/** The box around several boxes, or null for none. @param {Box[]} boxes @returns {Box | null} */
export function union(boxes) {
  if (boxes.length === 0) return null;
  let x = Infinity;
  let y = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const box of boxes) {
    x = Math.min(x, box.x);
    y = Math.min(y, box.y);
    r = Math.max(r, box.x + box.w);
    b = Math.max(b, box.y + box.h);
  }
  return { x, y, w: r - x, h: b - y };
}

/** Whether two boxes overlap. @param {Box} a @param {Box} b */
export const overlaps = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** Whether box `outer` holds box `inner` whole. @param {Box} outer @param {Box} inner */
export const holds = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/**
 * Whether a document point is on a shape: inside its (rotated) box or
 * ellipse, or within `slop` of an arrow's line.
 * @param {Shape} s @param {number} px @param {number} py @param {number} slop
 */
export function hits(s, px, py, slop) {
  if (s.kind === 'arrow') {
    const vx = s.w;
    const vy = s.h;
    const length = vx * vx + vy * vy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x) * vx + (py - s.y) * vy) / length));
    return Math.hypot(px - (s.x + t * vx), py - (s.y + t * vy)) <= slop + s.line / 2;
  }
  // Into the shape's own frame: about its centre, unrotated.
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const a = turns(s) ? -rad(s.rotation) : 0;
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  const hw = s.w / 2 + slop;
  const hh = s.h / 2 + slop;
  if (s.kind === 'ellipse') return (lx * lx) / (hw * hw) + (ly * ly) / (hh * hh) <= 1;
  return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
}

/**
 * The topmost shown, unlocked shape under a document point, or null.
 * @param {Doc} doc @param {number} px @param {number} py @param {number} slop
 * @returns {string | null}
 */
export function pick(doc, px, py, slop) {
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const s = doc.shapes[doc.order[i]];
    if (!s.hidden && !s.locked && hits(s, px, py, slop)) return s.id;
  }
  return null;
}

/** The handles of a box, by name, at its corners and edge midpoints. @typedef {'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end'} Handle */

/** @param {Box} b @returns {[Handle, number, number][]} */
export function handles(b) {
  const r = b.x + b.w;
  const m = b.x + b.w / 2;
  const d = b.y + b.h;
  const c = b.y + b.h / 2;
  return [['nw', b.x, b.y], ['n', m, b.y], ['ne', r, b.y], ['e', r, c], ['se', r, d], ['s', m, d], ['sw', b.x, d], ['w', b.x, c]];
}

/** An arrow's two handles. @param {Shape} s @returns {[Handle, number, number][]} */
export const ends = s => [['start', s.x, s.y], ['end', s.x + s.w, s.y + s.h]];

/**
 * A box resized by dragging `handle` to a document point: the opposite
 * edges stay; a box turned inside out flips; sizes are at least 1.
 * @param {Box} b @param {Handle} handle @param {number} px @param {number} py
 * @returns {Box}
 */
export function resize(b, handle, px, py) {
  let left = b.x;
  let top = b.y;
  let right = b.x + b.w;
  let bottom = b.y + b.h;
  if (handle.includes('w')) left = px;
  if (handle.includes('e')) right = px;
  if (handle.includes('n')) top = py;
  if (handle.includes('s')) bottom = py;
  const x = Math.min(left, right);
  const y = Math.min(top, bottom);
  return { x, y, w: Math.max(1, Math.abs(right - left)), h: Math.max(1, Math.abs(bottom - top)) };
}

/**
 * Snaps a moving box to other boxes' edges and centres: on each axis the
 * closest pair of lines (left, centre or right; top, middle or bottom)
 * within `threshold` wins. Returns the correction to add and the guides to
 * draw, which run across both boxes.
 * @param {Box} moving @param {Box[]} others @param {number} threshold
 * @param {{ x?: number[], y?: number[] }} [lines] which of the moving box's lines may snap (0 start, 1 centre, 2 end; all by default)
 * @returns {{ dx: number, dy: number, guides: Guide[] }}
 */
export function snap(moving, others, threshold, lines = {}) {
  const at = (/** @type {Box} */ b, /** @type {'x' | 'y'} */ axis) => (axis === 'x' ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h]);
  /** @type {Guide[]} */
  const guides = [];
  const out = { dx: 0, dy: 0, guides };
  for (const axis of /** @type {const} */ (['x', 'y'])) {
    const mine = at(moving, axis);
    const allowed = lines[axis] ?? [0, 1, 2];
    let best = threshold + 1;
    let shift = 0;
    for (const other of others)
      for (const target of at(other, axis))
        for (const i of allowed) {
          const d = target - mine[i];
          if (Math.abs(d) < Math.abs(best)) {
            best = d;
            shift = d;
          }
        }
    if (Math.abs(best) > threshold) continue;
    if (axis === 'x') out.dx = shift;
    else out.dy = shift;
    // Every line that now coincides gets a guide across the boxes that share it.
    const moved = at({ x: moving.x + out.dx, y: moving.y + out.dy, w: moving.w, h: moving.h }, axis);
    for (const i of allowed) {
      const line = moved[i];
      const sharing = others.filter(o => at(o, axis).some(v => Math.abs(v - line) < 0.5));
      if (sharing.length === 0) continue;
      const span = union([{ x: moving.x + out.dx, y: moving.y + out.dy, w: moving.w, h: moving.h }, ...sharing]);
      if (span === null) continue;
      guides.push(axis === 'x' ? { axis: 'x', at: line, from: span.y, to: span.y + span.h } : { axis: 'y', at: line, from: span.x, to: span.x + span.w });
    }
  }
  return out;
}

/**
 * The shapes shown and in paint order, as a document of their own (the
 * exports and the 3D preview leave hidden shapes out).
 * @param {Doc} doc @returns {Doc}
 */
export function shown(doc) {
  const order = doc.order.filter(id => !doc.shapes[id].hidden);
  return { order, shapes: Object.fromEntries(order.map(id => [id, doc.shapes[id]])) };
}

/** The box around a document's shown shapes, or null when it has none. @param {Doc} doc */
export const extent = doc => union(doc.order.filter(id => !doc.shapes[id].hidden).map(id => bounds(doc.shapes[id])));
