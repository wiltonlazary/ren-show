// The browser entry: ren-show root on the page, with the real clock,
// CanvasKit and three.js (each loaded on first use), the font, the worker and
// the sources.

import { Root } from 'ren-core';
import { $dom } from 'ren-dom';
import { Assets, environment } from './assets.js';
import { mode, sources } from './build.js';
import { App } from './app.jsx';
import { loadLayout, loadShaper, remoteLayout, CanvasFonts } from 'ren-canv';

/** Loads a classic script once. @param {string} src @returns {Promise<void>} */
const script = src =>
  new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(tag);
  });

/** The canvases' typeface and monospace one; the DOM roots set their text in them too (ren-dom's font and mono). */
const FONTS = { font: './font.ttf', mono: './mono.ttf' };
/** @type {Promise<[ArrayBuffer, ArrayBuffer]> | null} */
let faces = null;
const typefaces = () => (faces ??= Promise.all([fetch(FONTS.font), fetch(FONTS.mono)].map(f => f.then(r => r.arrayBuffer()))).then(([font, mono]) => [font, mono]));
/**
 * What the drawn primitives need before they render, beside the page and
 * loaded together: Taffy, their layout engine, and HarfBuzz, which shapes
 * the text they measure (Arabic joined, marks on their bases).
 */
const engines = () => Promise.all([loadLayout('./taffy.wasm'), loadShaper('./harfbuzz.wasm')]);
/** @type {Promise<{ kit: any, font: ArrayBuffer, mono: ArrayBuffer }> | null} */
let skia = null;
/** @type {Promise<{ fonts: any, layout: any }> | null} */
let engine = null;

const env = environment({
  mode,
  sources,
  settle: () => void document.body.offsetHeight,
  isolated: globalThis.crossOriginIsolated === true,
  fonts: FONTS,
  locks: navigator.locks ?? null,
  // A renderer measuring with the font files shapes its text with them too.
  typefaces: () => Promise.all([typefaces(), loadShaper('./harfbuzz.wasm')]).then(([[font, mono]]) => ({ font, mono })),
  skia: () =>
    (skia ??= (async () => {
      await Promise.all([script('./canvaskit/canvaskit.js'), engines()]);
      const init = /** @type {any} */ (globalThis).CanvasKitInit;
      const [kit, [font, mono]] = await Promise.all([init({ locateFile: (/** @type {string} */ file) => `./canvaskit/${file}` }), typefaces()]);
      return { kit, font, mono };
    })()),
  // three.js is its own chunk: it loads when a three.js demo first opens.
  // With the fonts the primitives in its scenes are drawn in.
  three: () => Promise.all([import('three'), typefaces(), engines()]).then(([THREE, [font, mono]]) => ({ THREE, font, mono })),
  // Each worker-runtime root has a worker entry of its own: the application only.
  // The layout engine for a DOM laid out by it (measuring in the root's
  // font, the canvases', once loaded, unkerned as the root sets it), and a
  // layout worker, the only one, shared by what lays out there.
  engine: () =>
    (engine ??= Promise.all([loadLayout('./taffy.wasm'), document.fonts.ready]).then(() => {
      const context = /** @type {any} */ (document.createElement('canvas').getContext('2d'));
      context.fontKerning = 'none';
      const host = document.querySelector('[data-ren-root="ren-show"]') ?? document.body;
      return { fonts: new CanvasFonts(context, getComputedStyle(host).fontFamily), layout: remoteLayout(new Worker(new URL('./layout.js', import.meta.url), { type: 'module' })) };
    })),
  // (`three-worker`, `stack-worker` (a layout worker), or `<app>-worker` for src/apps/<app>/worker.jsx; any other root id: worker.js).
  worker: id => new Worker(new URL(`./${/^[a-z]+(-[a-z]+)*-worker$/.test(id) ? id : 'worker'}.js`, import.meta.url), { type: 'module' }),
});

Root({
  id: 'ren-show',
  target: /** @type {HTMLElement} */ (document.getElementById('app')),
  // The shell sets the theme's tokens itself (src/themes.js), so the renderer
  // keeps its defaults; its text is set in the canvases' fonts.
  renderer: $dom(document, FONTS),
  provide: [[Assets, env]],
  // Background-disposal drains reach the demos that listen.
  swept: env.drains.emit,
  // ?theme=<id> opens the page in that theme (src/themes.js: tonal, tide, lired, …).
  children: () => <App start={location.hash} window={window} theme={new URLSearchParams(location.search).get('theme') ?? undefined} />,
});
