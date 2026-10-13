// The overlay's geometry: the canvas, the configurator bar and the corner
// controls are fixed sizes, so where each control shows is known without
// asking the renderer. The overlay (ui.jsx) is built from these numbers, the
// page publishes `controls()` for tools outside (the browser check presses
// the options through it), and the test presses there to prove the two agree.

import { FINISHES, CUSHIONS, BANDS, SIZES } from './materials.js';

/** The scene's canvas, in CSS pixels. */
export const WIDTH = 1000;
export const HEIGHT = 640;
/**
 * Below this width (a phone) the canvas takes the page's width and a
 * taller shape, and the overlay stacks (ui.jsx, Compact); `controls()`
 * has no places for it. From it up to WIDTH (a tablet) the canvas takes the
 * page's width too, the overlay keeps its places and the configurator bar
 * takes two rows (`TABLET` high), the canvas as much taller.
 */
export const COMPACT = 720;
/** The compact canvas's height for a width. @param {number} width */
export const compactHeight = width => Math.max(640, Math.min(820, Math.round(width * 2.2)));
/** The overlay's margin. */
export const EDGE = 20;
/** The configurator bar: its height, padding and the gap between its groups. */
export const BAR = { height: 128, padding: 16, gap: 16 };
/** A group of the bar: its heading, then its controls. */
export const GROUP = { heading: 18, gap: 10, control: 30 };
/** Each group's controls: width and gap (swatches are round). */
export const SWATCH = { size: 30, gap: 10 };
export const CUSHION = { width: 72, gap: 8 };
export const BANDING = { width: 80, gap: 8 };
export const SIZING = { width: 36, gap: 8 };
/** The summary: the price line, then "Add to bag". */
export const BAG = { width: 150, height: 38, price: 22, gap: 8 };
/**
 * The view controls, a row at the bottom right just above the bar: three
 * toggles, then zoom out and in (the side cards stand where a top-right
 * column was).
 */
export const CORNER = { width: 140, height: 32, gap: 8, zoom: 66, above: 12 };

/** A group's height: its heading, then its controls. */
export const GROUPED = GROUP.heading + GROUP.gap + GROUP.control;
/** The summary's height: the price, then "Add to bag". */
export const SUMMED = BAG.price + BAG.gap + BAG.height;
/** A tablet's bar: finish, cushions and headband, then the size beside the summary. */
export const TABLET = 2 * BAR.padding + GROUPED + BAR.gap + Math.max(GROUPED, SUMMED);

/**
 * The canvas for a page `width` wide: its size and layout (`full`,
 * `tablet` or `compact`).
 * @param {number} width
 * @returns {{ layout: 'full' | 'tablet' | 'compact', size: [number, number] }}
 */
export function canvasFor(width) {
  if (width >= WIDTH) return { layout: 'full', size: [WIDTH, HEIGHT] };
  if (width >= COMPACT) return { layout: 'tablet', size: [width, HEIGHT + TABLET - BAR.height] };
  return { layout: 'compact', size: [width, compactHeight(width)] };
}

/**
 * How much further back the camera stands on a tablet's canvas: the
 * product and the panels beside it span the same share of its width as on
 * the full canvas (1 there).
 * @param {number} width @param {number} height
 */
export const widen = (width, height) => Math.max(1, WIDTH / HEIGHT / (width / height));

/** The bar's height on a canvas `width` wide (full or tablet). @param {number} width */
export const barOf = width => (width >= WIDTH ? BAR.height : TABLET);

/**
 * Where the overlay's parts lie on a full or tablet canvas, as [x, y,
 * width, height]: the configurator bar and the view controls' row (the
 * heading block's height is its own: the scene reports it).
 * @param {number} [width] @param {number} [height]
 */
export function regions(width = WIDTH, height = HEIGHT) {
  const bar = barOf(width);
  const top = height - EDGE - bar;
  const row = span(3, CORNER.width, CORNER.gap) + CORNER.gap + span(2, CORNER.zoom, CORNER.gap);
  return {
    bar: [EDGE, top, width - 2 * EDGE, bar],
    corner: [width - EDGE - row, top - CORNER.above - CORNER.height, row, CORNER.height],
  };
}

/** A row of `n` controls `width` wide and `gap` apart. @param {number} n @param {number} width @param {number} gap */
export const span = (n, width, gap) => n * width + (n - 1) * gap;

/** The groups' widths, left to right. */
export const WIDTHS = [span(FINISHES.length, SWATCH.size, SWATCH.gap), span(CUSHIONS.length, CUSHION.width, CUSHION.gap), span(BANDS.length, BANDING.width, BANDING.gap), span(SIZES.length, SIZING.width, SIZING.gap)];

/**
 * Where each control's centre shows on the canvas, by name: `finish:<id>`,
 * `cushion:<id>`, `band:<id>`, `size:<id>`, `bag`, `explode`, `rotate`,
 * `reset`, `zoom-out`, `zoom-in`, on a full or tablet canvas.
 * @param {number} [width] @param {number} [height]
 * @returns {Record<string, [number, number]>}
 */
export function controls(width = WIDTH, height = HEIGHT) {
  /** @type {Record<string, [number, number]>} */
  const at = {};
  const tablet = width < WIDTH;
  const top = height - EDGE - barOf(width) + BAR.padding;
  // A tablet's second row: the size, and the summary at the right.
  const second = top + GROUPED + BAR.gap;
  let row = top + GROUP.heading + GROUP.gap + GROUP.control / 2;
  let x = EDGE + BAR.padding;
  /** @param {string} kind @param {{ id: string }[]} list @param {number} width @param {number} gap @param {number} i */
  const group = (kind, list, width, gap, i) => {
    list.forEach((o, n) => (at[`${kind}:${o.id}`] = [x + width / 2 + n * (width + gap), row]));
    x += WIDTHS[i] + BAR.gap;
  };
  group('finish', FINISHES, SWATCH.size, SWATCH.gap, 0);
  group('cushion', CUSHIONS, CUSHION.width, CUSHION.gap, 1);
  group('band', BANDS, BANDING.width, BANDING.gap, 2);
  if (tablet) {
    x = EDGE + BAR.padding;
    row = second + GROUP.heading + GROUP.gap + GROUP.control / 2;
  }
  group('size', SIZES, SIZING.width, SIZING.gap, 3);
  // The summary takes the rest, its button at the right.
  at.bag = [width - EDGE - BAR.padding - BAG.width / 2, (tablet ? second : top) + BAG.price + BAG.gap + BAG.height / 2];
  // The view controls' row, right-aligned above the bar.
  const [cx0, cy] = regions(width, height).corner;
  const y = cy + CORNER.height / 2;
  let cx = cx0;
  for (const name of ['explode', 'rotate', 'reset']) {
    at[name] = [cx + CORNER.width / 2, y];
    cx += CORNER.width + CORNER.gap;
  }
  at['zoom-out'] = [cx + CORNER.zoom / 2, y];
  at['zoom-in'] = [cx + CORNER.zoom + CORNER.gap + CORNER.zoom / 2, y];
  return at;
}
