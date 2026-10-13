// ren-show themes: the palettes, the one source of every color on the
// page. The shell turns the chosen one into CSS custom properties (the page
// and ren-dom's --ren-* tokens); the canvases and scenes read it through the
// Look context (Skia and three.js roots are rebuilt with it) or, for the
// scene application that may run in a worker, through its props.

import { $context, $lookup } from 'rrx-core';
import { color } from 'ren-dom';

/**
 * @typedef {object} Palette
 * @property {string} canvas the page background
 * @property {string} surface cards, fields and canvases
 * @property {string} raised a surface one step up (hover, nested boxes)
 * @property {string} ink body text
 * @property {string} muted secondary text
 * @property {string} label field labels
 * @property {string} soft quiet fills (chips, selected rows)
 * @property {string} rule hairlines
 * @property {string} border field and card borders
 * @property {string} accent actions, links, the current section
 * @property {string} accentInk text on the accent
 * @property {string} accentSoft a tint of the accent (chips, highlights, what is selected)
 * @property {string} danger failures and removal
 * @property {string} code code and log backgrounds
 * @property {string} selection selected text
 * @property {string[]} series six distinct colors for shapes, meshes and charts
 */

/**
 * @typedef {object} Theme
 * @property {string} id
 * @property {string} name
 * @property {boolean} dark
 * @property {Palette} colors
 * @property {NonNullable<import('ren-dom').Options['theme']>} ren the ren-core theme tokens (ARGB), for every renderer
 */

/** `#rrggbb` as an opaque ARGB number. @param {string} hex */
export const argb = hex => (0xff000000 | parseInt(hex.slice(1), 16)) >>> 0;

/** @param {string} id @param {string} name @param {boolean} dark @param {Palette} colors @returns {Theme} */
const theme = (id, name, dark, colors) => {
  return {
    id,
    name,
    dark,
    colors,
    ren: {
      paper: argb(colors.surface),
      ink: argb(colors.ink),
      muted: argb(colors.muted),
      soft: argb(colors.soft),
      accent: argb(colors.accent),
      danger: argb(colors.danger),
      canvas: argb(colors.surface),
      rule: argb(colors.rule),
      label: argb(colors.label),
      border: argb(colors.border),
      raised: argb(colors.raised),
      selection: argb(colors.selection),
      caret: argb(colors.accent),
      radius: 8,
    },
  };
};

// The palettes, drawn in OKLCH: per theme a neutral hue and chroma for
// the surfaces, an accent hue, a danger hue and six series hues stepped from
// the accent. Text holds 7:1 on every surface (labels 5:1, secondary text
// and the accent 4.5:1), and the accent's text 4.5:1 on it.
/** The themes: light ones first, then dark. */
export const THEMES = [
  theme('tonal', 'Tonal', false, {
    canvas: '#eef4fd',
    surface: '#fdfdfe',
    raised: '#e9eff8',
    ink: '#1e242e',
    muted: '#60697a',
    label: '#404856',
    soft: '#e2e8f3',
    rule: '#d9dee8',
    border: '#b8bec9',
    accent: '#2466c3',
    accentInk: '#fafcfe',
    accentSoft: '#d5e6ff',
    danger: '#c5353e',
    code: '#e8edf7',
    selection: '#bbd6ff',
    series: ['#2466c3', '#b85207', '#b35aa6', '#817706', '#009296', '#805dc0'],
  }),
  theme('paper', 'Paper', false, {
    canvas: '#f8f4ee',
    surface: '#fffdfa',
    raised: '#f3efe9',
    ink: '#27231d',
    muted: '#6e685d',
    label: '#4c473e',
    soft: '#ede9e1',
    rule: '#e2dfd9',
    border: '#c2beb7',
    accent: '#077688',
    accentInk: '#f8fdfe',
    accentSoft: '#c0eef9',
    danger: '#c5372f',
    code: '#f1eee7',
    selection: '#9ee1f0',
    series: ['#077688', '#8e57b6', '#ca5553', '#807701', '#01967b', '#3972cb'],
  }),
  theme('daylight', 'Daylight', false, {
    canvas: '#f2f7f9',
    surface: '#fdfdfe',
    raised: '#edf2f4',
    ink: '#202528',
    muted: '#626a6f',
    label: '#42494d',
    soft: '#e6ebee',
    rule: '#dde1e4',
    border: '#bcc1c4',
    accent: '#027c56',
    accentInk: '#f9fdfb',
    accentSoft: '#c8f0db',
    danger: '#c5353a',
    code: '#ecf0f3',
    selection: '#abe3c7',
    series: ['#027c56', '#3673cb', '#c65377', '#ad5d00', '#818807', '#018492'],
  }),
  theme('sand', 'Sand', false, {
    canvas: '#faeed8',
    surface: '#fff9ee',
    raised: '#f5e9d3',
    ink: '#2f2204',
    muted: '#7a663c',
    label: '#564521',
    soft: '#f0e2c8',
    rule: '#e4d9c3',
    border: '#c6b89f',
    accent: '#4b7421',
    accentInk: '#fafcf9',
    accentSoft: '#d8ecca',
    danger: '#c53829',
    code: '#f3e8d1',
    selection: '#c3dfaf',
    series: ['#4b7421', '#017fab', '#b658a0', '#bc4b37', '#a47807', '#0a867e'],
  }),
  theme('meadow', 'Meadow', false, {
    canvas: '#ebf5ea',
    surface: '#f8fdf7',
    raised: '#e6f0e5',
    ink: '#1d271b',
    muted: '#5d6e5b',
    label: '#3e4c3c',
    soft: '#deeadd',
    rule: '#d6dfd4',
    border: '#b4c0b3',
    accent: '#a83876',
    accentInk: '#fffafc',
    accentSoft: '#ffd8e9',
    danger: '#c53634',
    code: '#e4eee3',
    selection: '#f9c2db',
    series: ['#a83876', '#3d892a', '#a77601', '#09848f', '#2784d5', '#bc4a3c'],
  }),
  theme('lired', 'lired', false, {
    canvas: '#eef5fc',
    surface: '#fcfeff',
    raised: '#e9f0f7',
    ink: '#1d252c',
    muted: '#5e6a76',
    label: '#3f4953',
    soft: '#e1eaf2',
    rule: '#d9e0e6',
    border: '#b7bfc7',
    accent: '#bc1f4b',
    accentInk: '#fefbfb',
    accentSoft: '#fedadd',
    danger: '#c33355',
    code: '#e7eef5',
    selection: '#ffc2c8',
    series: ['#bc1f4b', '#3373ca', '#058ac3', '#688006', '#029678', '#ad4b8d'],
  }),
  theme('tonal-dark', 'Tonal Dark', true, {
    canvas: '#0c0f17',
    surface: '#151922',
    raised: '#20242d',
    ink: '#dce5f7',
    muted: '#9aa5bc',
    label: '#bdc7dd',
    soft: '#242934',
    rule: '#2a2e37',
    border: '#424854',
    accent: '#80b3fd',
    accentInk: '#0d1624',
    accentSoft: '#20385c',
    danger: '#ff7172',
    code: '#080b13',
    selection: '#2b4872',
    series: ['#80b3fd', '#f79968', '#db8bce', '#c4b74a', '#11c2c7', '#bea1fc'],
  }),
  theme('midnight', 'Midnight', true, {
    canvas: '#060e16',
    surface: '#0f1821',
    raised: '#19232c',
    ink: '#d4e7fa',
    muted: '#8fa8bf',
    label: '#b4cae0',
    soft: '#1c2833',
    rule: '#232c36',
    border: '#3a4753',
    accent: '#c39dee',
    accentInk: '#191221',
    accentSoft: '#402e55',
    danger: '#ff716d',
    code: '#030a12',
    selection: '#523c6a',
    series: ['#c39dee', '#e4a74a', '#73c076', '#f98fa9', '#04c1d0', '#e793d5'],
  }),
  theme('tide', 'Tide', true, {
    canvas: '#021517',
    surface: '#0a2022',
    raised: '#152a2d',
    ink: '#c5edf2',
    muted: '#7bafb5',
    label: '#a1d1d7',
    soft: '#153033',
    rule: '#1f3537',
    border: '#345053',
    accent: '#6bc6a5',
    accentInk: '#071a13',
    accentSoft: '#024331',
    danger: '#ff7076',
    code: '#001113',
    selection: '#02553f',
    series: ['#6bc6a5', '#58bffd', '#ed905e', '#cab547', '#a79df8', '#0acdd2'],
  }),
  theme('nocturne', 'Nocturne', true, {
    canvas: '#170b10',
    surface: '#22151a',
    raised: '#2d2025',
    ink: '#f7dce7',
    muted: '#bb9aa7',
    label: '#ddbdca',
    soft: '#33242a',
    rule: '#37292f',
    border: '#534249',
    accent: '#f49665',
    accentInk: '#21120a',
    accentSoft: '#552b14',
    danger: '#fe6e83',
    code: '#12070c',
    selection: '#6a391e',
    series: ['#f49665', '#35cfb4', '#63b1f9', '#cb9df4', '#ec86aa', '#8ac875'],
  }),
  theme('abyss', 'Abyss', true, {
    canvas: '#000b14',
    surface: '#001523',
    raised: '#04202f',
    ink: '#cbeaff',
    muted: '#6cadd7',
    label: '#95d0f6',
    soft: '#012538',
    rule: '#0e293a',
    border: '#224459',
    accent: '#b4ba35',
    accentInk: '#161707',
    accentSoft: '#393b07',
    danger: '#ff7269',
    code: '#00070e',
    selection: '#494c0f',
    series: ['#b4ba35', '#2ccfba', '#9ea0fa', '#f88fae', '#e5974c', '#82c97b'],
  }),
  theme('hearth', 'Hearth', true, {
    canvas: '#180e08',
    surface: '#231811',
    raised: '#2e221b',
    ink: '#f7dfd1',
    muted: '#bc9d8c',
    label: '#ddc1b0',
    soft: '#35271e',
    rule: '#382c25',
    border: '#55453c',
    accent: '#f09b48',
    accentInk: '#201307',
    accentSoft: '#512e0a',
    danger: '#ff7172',
    code: '#140904',
    selection: '#663d12',
    series: ['#f09b48', '#59ce9b', '#25bce5', '#c4a0f9', '#ed86a4', '#fc937f'],
  }),
  theme('neon', 'Neon', true, {
    canvas: '#0c0819',
    surface: '#151223',
    raised: '#201c2f',
    ink: '#e4e0fe',
    muted: '#a59dcd',
    label: '#c7c1ee',
    soft: '#242037',
    rule: '#292639',
    border: '#433e57',
    accent: '#0fcacc',
    accentInk: '#031a1a',
    accentSoft: '#004142',
    danger: '#fe6d8b',
    code: '#080514',
    selection: '#005354',
    series: ['#0fcacc', '#e893d4', '#b299f3', '#51cea1', '#b6af42', '#81b7ff'],
  }),
];

/** The theme with this id, or the first. @param {string | null | undefined} id */
export const themed = id => THEMES.find(t => t.id === id) ?? THEMES[0];

/** The current theme: the shell provides a signal of it; without one, the first theme. */
export const Look = $context(THEMES[0]);

/** The current theme, read where it is used so the reader follows a change. @returns {Theme} */
export const look = () => $lookup(Look);

/** A binding to one of the current theme's ren colors (ARGB). @param {'danger' | 'accent' | 'muted' | 'ink' | 'soft' | 'raised' | 'paper'} token */
export const tone = token => () => /** @type {number} */ (look().ren[token]);

/**
 * The CSS custom properties of a theme: the page's (`--canvas`, `--accent`, …)
 * and ren-dom's (`--ren-*`), which an element nearer than the root host
 * overrides for everything inside it.
 * @param {Theme} t @returns {[string, string][]}
 */
export function properties(t) {
  const c = t.colors;
  /** @type {[string, string][]} */
  const out = [];
  for (const [key, value] of Object.entries(c)) {
    if (key === 'series') continue;
    out.push([`--${key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`, /** @type {string} */ (value)]);
  }
  c.series.forEach((value, i) => out.push([`--series-${i}`, value]));
  for (const [key, value] of Object.entries(t.ren)) out.push([`--ren-${key}`, key === 'radius' ? `${value}px` : color(value)]);
  return out;
}
