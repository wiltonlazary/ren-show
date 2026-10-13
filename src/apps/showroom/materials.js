// Showroom's catalogue: the product, its options and their prices, and the
// one palette of physical materials it is made of. These colors are not UI
// colors: they are the showroom's own tones, drawn in OKLCH, of physical
// finishes (anodized aluminium, knit polyester, aniline leather, polished
// stainless steel), kept here and only here; everything else on the page and
// in the scene is colored by the theme (`look()`).

/**
 * A physically based material: base color (sRGB hex), roughness and
 * metalness as three.js's MeshPhysicalMaterial reads them, and the fabric's
 * sheen or the lacquer's clearcoat where the finish has one.
 * @typedef {object} Material
 * @property {string} color
 * @property {number} roughness
 * @property {number} metalness
 * @property {number} [sheen] 0..1, a fabric's grazing-angle glow
 * @property {number} [clearcoat] 0..1, a lacquer layer
 */

/**
 * An anodized aluminium finish of the ear cups: the shell, the knit that
 * matches it (the strap and knit cushions) and the laser engraving's tone.
 * @typedef {object} Finish
 * @property {string} id
 * @property {string} name
 * @property {Material} shell
 * @property {Material} knit
 * @property {string} etch the engraving, a laser mark on the shell
 */

/**
 * @typedef {object} Option
 * @property {string} id
 * @property {string} name
 * @property {number} price added to the base price, in dollars
 * @property {number} grams added to the base weight
 * @property {string} note one line for the spec card
 */

/** @type {Finish[]} */
export const FINISHES = [
  {
    id: 'slate',
    name: 'Slate',
    shell: { color: '#383643', roughness: 0.34, metalness: 0.82, clearcoat: 0.3 },
    knit: { color: '#2d2b36', roughness: 0.92, metalness: 0, sheen: 1 },
    etch: '#92909e',
  },
  {
    id: 'oat',
    name: 'Oat',
    shell: { color: '#e5ccb7', roughness: 0.3, metalness: 0.78, clearcoat: 0.3 },
    knit: { color: '#d4beab', roughness: 0.92, metalness: 0, sheen: 1 },
    etch: '#816d5c',
  },
  {
    id: 'glacier',
    name: 'Glacier',
    shell: { color: '#8ebec8', roughness: 0.32, metalness: 0.8, clearcoat: 0.3 },
    knit: { color: '#85aeb7', roughness: 0.92, metalness: 0, sheen: 1 },
    etch: '#3a626a',
  },
  {
    id: 'sage',
    name: 'Sage',
    shell: { color: '#83a590', roughness: 0.32, metalness: 0.8, clearcoat: 0.3 },
    knit: { color: '#789684', roughness: 0.92, metalness: 0, sheen: 1 },
    etch: '#395444',
  },
  {
    id: 'rose',
    name: 'Rose',
    shell: { color: '#cb9baf', roughness: 0.3, metalness: 0.78, clearcoat: 0.3 },
    knit: { color: '#b98fa0', roughness: 0.92, metalness: 0, sheen: 1 },
    etch: '#714b5b',
  },
];

/** The ear cushions: knit in the finish's own color, or leather. @type {(Option & { leather: Material | null })[]} */
export const CUSHIONS = [
  { id: 'knit', name: 'Soft knit', price: 0, grams: 0, note: 'breathable knit over memory foam', leather: null },
  { id: 'saddle', name: 'Saddle leather', price: 50, grams: 14, note: 'full-grain aniline leather', leather: { color: '#8a5a3b', roughness: 0.55, metalness: 0, clearcoat: 0.15 } },
  { id: 'black', name: 'Black leather', price: 50, grams: 14, note: 'full-grain aniline leather', leather: { color: '#1e1c1b', roughness: 0.5, metalness: 0, clearcoat: 0.2 } },
];

/** The headband: a woven strap under the frame, or bare polished steel. @type {(Option & { steel: Material | null })[]} */
export const BANDS = [
  { id: 'strap', name: 'Woven strap', price: 0, grams: 0, note: 'a woven strap spreads the weight', steel: null },
  { id: 'steel', name: 'Stainless steel', price: 79, grams: 27, note: 'a polished stainless steel arc', steel: { color: '#c8cbd0', roughness: 0.16, metalness: 1 } },
];

/** The fit: the headband's radius, in scene units. @type {(Option & { radius: number })[]} */
export const SIZES = [
  { id: 's', name: 'S', price: 0, grams: -6, note: 'small', radius: 0.98 },
  { id: 'm', name: 'M', price: 0, grams: 0, note: 'medium', radius: 1.04 },
  { id: 'l', name: 'L', price: 0, grams: 6, note: 'large', radius: 1.1 },
];

/**
 * The studio's lights, as color temperatures: a warm key (about 4500 K), a
 * cool fill (about 7500 K) and a neutral rim (6500 K, D65 white).
 */
export const LIGHTS = { key: '#ffe9d6', fill: '#dfe7ff', rim: '#ffffff' };

/** The product. */
export const PRODUCT = { name: 'Halo Over-Ear', price: 429, grams: 352, battery: 30 };

/** The longest engraving, in characters. */
export const ENGRAVING = 16;

/**
 * A configuration: the chosen finish, cushions, band and size, the
 * engraving, and what the shopper is looking at.
 * @typedef {object} Config
 * @property {string} finish
 * @property {string} cushion
 * @property {string} band
 * @property {string} size
 * @property {string} engraving
 */

/** @type {Config} */
export const DEFAULTS = { finish: 'slate', cushion: 'knit', band: 'strap', size: 'm', engraving: '' };

/** The entry of a list with this id, or its first. @template {{ id: string }} T @param {T[]} list @param {string} id @returns {T} */
export const pick = (list, id) => list.find(o => o.id === id) ?? list[0];

/** A configuration's price in dollars. @param {Config} c */
export const price = c => PRODUCT.price + pick(CUSHIONS, c.cushion).price + pick(BANDS, c.band).price + pick(SIZES, c.size).price;

/** Its weight in grams. @param {Config} c */
export const weight = c => PRODUCT.grams + pick(CUSHIONS, c.cushion).grams + pick(BANDS, c.band).grams + pick(SIZES, c.size).grams;

/** Dollars as the shop writes them. @param {number} n */
export const dollars = n => `$${n.toLocaleString('en-US')}`;

/** An engraving as it may be etched: one line, at most ENGRAVING characters. @param {string} text */
export const etched = text => text.replace(/[\r\n\t]+/g, ' ').slice(0, ENGRAVING);

/** A configuration in one line. @param {Config} c */
export const summary = c => {
  const parts = [pick(FINISHES, c.finish).name, pick(CUSHIONS, c.cushion).name, pick(BANDS, c.band).name, `size ${pick(SIZES, c.size).name}`];
  if (c.engraving !== '') parts.push(`“${c.engraving}”`);
  return parts.join(' · ');
};
