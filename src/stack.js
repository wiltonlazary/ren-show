// Stack: a small layout engine of ren-show's own, in plain JavaScript, for
// ren-canv's Solver boundary (`useLayout`). It lays out flex rows and
// columns without wrapping: lengths and percentages, padding, borders,
// margins, gaps, grow and shrink, align and justify, minimum and maximum
// sizes, and absolute children placed by their top and left. Grids lay out
// as columns. The "A renderer of your own" demo runs it in a layout worker
// (stack-worker.js), so the page's other canvases keep Taffy.

/** An engine as `useLayout` takes it. @typedef {ReturnType<Parameters<typeof import('ren-canv/worker').useLayout>[0]>} Solver */

/** CSS's initial style, for a new leaf. @type {any} */
const INITIAL = {
  display: 'flex',
  position: 'relative',
  inset: ['auto', 'auto', 'auto', 'auto'],
  direction: 'row',
  columnGap: 0,
  rowGap: 0,
  padding: [0, 0, 0, 0],
  border: [0, 0, 0, 0],
  margin: [0, 0, 0, 0],
  width: 'auto',
  height: 'auto',
  minWidth: 'auto',
  minHeight: 'auto',
  maxWidth: 'auto',
  maxHeight: 'auto',
  basis: 'auto',
  grow: 0,
  shrink: 1,
  align: 'stretch',
  self: 'auto',
  justify: 'normal',
};

/** A layout node: its style, children and last box. */
class Node {
  constructor() {
    /** @type {any} */
    this.style = INITIAL;
    /** @type {Node[]} */
    this.kids = [];
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
    /** The content's extent, for a box that scrolls. */
    this.cw = 0;
    this.ch = 0;
  }
}

/** A length against `base`: a number, a percentage of a finite base, else NaN ('auto'). @param {number | string} v @param {number} base */
const len = (v, base) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.endsWith('%')) return Number.isFinite(base) ? (base * parseFloat(v)) / 100 : NaN;
  return NaN;
};

/** `v` kept within a style's minimum and maximum lengths. @param {number} v @param {number | string} min @param {number | string} max @param {number} base */
const clamp = (v, min, max, base) => {
  const hi = len(max, base);
  const lo = len(min, base);
  if (Number.isFinite(hi)) v = Math.min(v, hi);
  if (Number.isFinite(lo)) v = Math.max(v, lo);
  return v;
};

/** The children laid out in the flow. @param {Node} n */
const flowing = n => n.kids.filter(k => k.style.display !== 'none' && k.style.position !== 'absolute');

/** Whether a box lays its children out in a row. @param {any} s */
const isRow = s => s.display === 'flex' && s.direction === 'row';

/** The sum of a style's horizontal (1, 3) or vertical (0, 2) padding and border. @param {any} s @param {boolean} across */
const edges = (s, across) => (across ? s.padding[1] + s.padding[3] + s.border[1] + s.border[3] : s.padding[0] + s.padding[2] + s.border[0] + s.border[2]);

/** A node's max-content width: its border box, without margins. @param {Node} n @returns {number} */
function natural(n) {
  const s = n.style;
  if (s.display === 'none') return 0;
  const fixed = len(s.width, NaN);
  if (Number.isFinite(fixed)) return clamp(fixed, s.minWidth, s.maxWidth, NaN);
  const kids = flowing(n);
  let content = 0;
  if (isRow(s)) {
    for (const k of kids) content += natural(k) + k.style.margin[1] + k.style.margin[3];
    content += s.columnGap * Math.max(0, kids.length - 1);
  } else for (const k of kids) content = Math.max(content, natural(k) + k.style.margin[1] + k.style.margin[3]);
  let width = content + edges(s, true);
  const basis = len(s.basis, NaN);
  if (Number.isFinite(basis)) width = Math.max(width, basis);
  return clamp(width, s.minWidth, s.maxWidth, NaN);
}

/** Where `free` space puts the first of `count` items, and the space between them. @param {string} justify @param {number} free @param {number} count @returns {[number, number]} */
function spread(justify, free, count) {
  if (free <= 0 || count === 0) return [0, 0];
  if (justify === 'center') return [free / 2, 0];
  if (justify === 'end') return [free, 0];
  if (justify === 'between') return count > 1 ? [0, free / (count - 1)] : [0, 0];
  if (justify === 'around') return [free / count / 2, free / count];
  if (justify === 'evenly') return [free / (count + 1), free / (count + 1)];
  return [0, 0];
}

/** Where an item sits across a line `room` long, being `size`. @param {string} align @param {number} room @param {number} size */
const across = (align, room, size) => (align === 'center' ? (room - size) / 2 : align === 'end' ? room - size : 0);

/**
 * Lays `n` out at the border-box width `width` and height `height` (NaN:
 * from its content); sets its size and its children's boxes.
 * @param {Node} n @param {number} width @param {number} height
 */
function lay(n, width, height) {
  const s = n.style;
  n.w = width;
  const left = s.padding[3] + s.border[3];
  const top = s.padding[0] + s.border[0];
  const innerW = Math.max(0, width - edges(s, true));
  const innerH = Number.isFinite(height) ? Math.max(0, height - edges(s, false)) : NaN;
  const kids = flowing(n);
  let content = 0;
  if (isRow(s)) {
    // Main sizes: the basis (or width, or max-content), then grown or shrunk to the line.
    const sizes = kids.map(k => {
      const ks = k.style;
      const basis = len(ks.basis, innerW);
      const fixed = len(ks.width, innerW);
      return clamp(Number.isFinite(basis) ? basis : Number.isFinite(fixed) ? fixed : natural(k), ks.minWidth, ks.maxWidth, innerW);
    });
    const gaps = s.columnGap * Math.max(0, kids.length - 1);
    let free = innerW - gaps - kids.reduce((sum, k, i) => sum + sizes[i] + k.style.margin[1] + k.style.margin[3], 0);
    const grow = kids.reduce((sum, k) => sum + k.style.grow, 0);
    if (free > 0 && grow > 0) {
      kids.forEach((k, i) => (sizes[i] += (free * k.style.grow) / grow));
      free = 0;
    } else if (free < 0) {
      const weight = kids.reduce((sum, k, i) => sum + k.style.shrink * sizes[i], 0);
      if (weight > 0)
        kids.forEach((k, i) => {
          const floor = len(k.style.minWidth, innerW);
          sizes[i] = Math.max(Number.isFinite(floor) ? floor : 0, sizes[i] + (free * k.style.shrink * sizes[i]) / weight);
        });
      free = innerW - gaps - kids.reduce((sum, k, i) => sum + sizes[i] + k.style.margin[1] + k.style.margin[3], 0);
    }
    // Cross sizes: each from its content, then the line's for those that stretch.
    let line = 0;
    kids.forEach((k, i) => {
      lay(k, sizes[i], len(k.style.height, innerH));
      line = Math.max(line, k.h + k.style.margin[0] + k.style.margin[2]);
    });
    const room = Number.isFinite(innerH) ? innerH : line;
    const [start, between] = spread(s.justify, free, kids.length);
    let x = left + start;
    kids.forEach((k, i) => {
      const ks = k.style;
      const align = ks.self === 'auto' ? s.align : ks.self;
      if (align === 'stretch' && !Number.isFinite(len(ks.height, innerH))) lay(k, sizes[i], clamp(room - ks.margin[0] - ks.margin[2], ks.minHeight, ks.maxHeight, innerH));
      k.x = x + ks.margin[3];
      k.y = top + ks.margin[0] + across(align, room - ks.margin[0] - ks.margin[2], k.h);
      x = k.x + k.w + ks.margin[1] + s.columnGap + between;
    });
    content = line;
  } else {
    // A column: each child as wide as the column where it stretches, else its max-content.
    const widths = kids.map(k => {
      const ks = k.style;
      const fixed = len(ks.width, innerW);
      const room = innerW - ks.margin[1] - ks.margin[3];
      const align = ks.self === 'auto' ? s.align : ks.self;
      return clamp(Number.isFinite(fixed) ? fixed : align === 'stretch' ? room : Math.min(natural(k), room), ks.minWidth, ks.maxWidth, innerW);
    });
    kids.forEach((k, i) => lay(k, widths[i], len(k.style.height, innerH)));
    const gaps = s.rowGap * Math.max(0, kids.length - 1);
    let used = gaps + kids.reduce((sum, k) => sum + k.h + k.style.margin[0] + k.style.margin[2], 0);
    let free = Number.isFinite(innerH) ? innerH - used : 0;
    const grow = kids.reduce((sum, k) => sum + k.style.grow, 0);
    if (free > 0 && grow > 0) {
      kids.forEach((k, i) => k.style.grow > 0 && lay(k, widths[i], k.h + (free * k.style.grow) / grow));
      used += free;
      free = 0;
    }
    const [start, between] = spread(s.justify, free, kids.length);
    let y = top + start;
    kids.forEach(k => {
      const ks = k.style;
      const align = ks.self === 'auto' ? s.align : ks.self;
      k.y = y + ks.margin[0];
      k.x = left + ks.margin[3] + across(align, innerW - ks.margin[1] - ks.margin[3], k.w);
      y = k.y + k.h + ks.margin[2] + s.rowGap + between;
    });
    content = used;
  }
  const fixedH = Number.isFinite(height) ? height : len(s.height, NaN);
  n.h = clamp(Number.isFinite(fixedH) ? fixedH : content + edges(s, false), s.minHeight, s.maxHeight, NaN);
  // Absolute children: their own size, placed by top and left in the padding box.
  for (const k of n.kids) {
    if (k.style.display === 'none') {
      k.x = k.y = k.w = k.h = 0;
      continue;
    }
    if (k.style.position !== 'absolute') continue;
    const ks = k.style;
    const fixed = len(ks.width, innerW);
    lay(k, Number.isFinite(fixed) ? fixed : natural(k), len(ks.height, innerH));
    const x = len(ks.inset[3], innerW);
    const y = len(ks.inset[0], innerH);
    k.x = s.border[3] + (Number.isFinite(x) ? x : s.padding[3]) + ks.margin[3];
    k.y = s.border[0] + (Number.isFinite(y) ? y : s.padding[0]) + ks.margin[0];
  }
  // The content's extent, as far as the children reach.
  let cw = 0;
  let ch = 0;
  for (const k of kids) {
    cw = Math.max(cw, k.x + k.w + k.style.margin[1]);
    ch = Math.max(ch, k.y + k.h + k.style.margin[2]);
  }
  n.cw = cw + s.padding[1];
  n.ch = ch + s.padding[2];
}

/** A Stack engine: a Solver of nodes laid out by `lay`. @returns {Solver} */
export function Stack() {
  return {
    leaf: () => new Node(),
    define: style => style,
    undefine: () => {},
    set: (node, style) => {
      node.style = style;
    },
    sized: (node, style, minWidth, minHeight, basis) => {
      node.style = { ...style, minWidth, minHeight, basis };
    },
    children: (node, children) => {
      node.kids = children;
    },
    remove: () => {},
    compute: (node, width, height = NaN) => {
      node.x = 0;
      node.y = 0;
      lay(node, Number.isFinite(width) ? width : natural(node), height);
    },
    read: (node, out) => {
      out[0] = node.x;
      out[1] = node.y;
      out[2] = node.w;
      out[3] = node.h;
      out[4] = node.ch;
      out[5] = node.cw;
    },
    close: () => {},
  };
}
