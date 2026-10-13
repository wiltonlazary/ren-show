// What ren-show needs from its environment, as one rrx-core context: the
// browser entry (main.jsx) provides the real clock, CanvasKit, the font,
// three.js and the worker; the tests provide a manual clock, headless
// CanvasKit, three.js with a drawer stub and a MessageChannel. Demos read it with `$lookup(Assets)`.

import { $context } from 'rrx-core';

/**
 * @typedef {object} Environment
 * @property {(ms: number, fn: () => void) => () => void} later runs `fn` after `ms`; returns a cancel function
 * @property {() => number} now a monotonic clock in milliseconds
 * @property {(() => Promise<{ kit: any, font: ArrayBuffer | Uint8Array, mono?: ArrayBuffer | Uint8Array, image?: (source: string) => any }>) | null} skia loads CanvasKit, the font and the monospace one, and optionally an image loader
 * @property {(() => Promise<{ THREE: Record<string, any>, renderer?: any, font?: ArrayBuffer | Uint8Array, mono?: ArrayBuffer | Uint8Array }>) | null} three loads three.js (its own chunk in the browser) and the fonts its primitives are drawn in; tests add a drawer stub as `renderer`, since node has no WebGL
 * @property {{ font: string, mono: string } | null} fonts the canvases' font files (URLs): a DOM root given them (ren-dom's `font` and `mono`) sets its text as Skia and three.js draw it (null: the page's font)
 * @property {(() => Promise<{ font: ArrayBuffer | Uint8Array, mono: ArrayBuffer | Uint8Array }>) | null} typefaces loads the canvases' font files (their bytes), for a renderer that measures with them
 * @property {any} locks the page's Web Locks manager (`navigator.locks`), null where there is none
 * @property {((id: string) => any) | null} worker makes the port of a worker-runtime root (a Worker in the browser)
 * @property {(() => Promise<{ fonts: any, layout: any }>) | null} engine the layout engine beside the renderers (Taffy, loaded here), a measure of the page's text for a DOM laid out by it, and the port of a layout worker (`remoteLayout`)
 * @property {Record<string, string>} sources each module's source text, by path (`demos/signals.jsx`)
 * @property {'compiled' | 'runtime'} mode how this bundle's JSX was built
 * @property {() => void} settle forces style and layout, so timings include it (a no-op outside a browser)
 * @property {number} pace multiplies the real delays of the async demos (1 in the browser; tests run faster)
 * @property {Drains} drains ren-show root's background-disposal reports (its `swept` option)
 * @property {boolean} isolated the page is cross-origin isolated (SharedArrayBuffer: ren-core's worker mailbox is on)
 * @property {() => number} scale the canvases' pixel ratio now (the display's, at most 2), read per canvas so a zoom or display change reaches new ones
 */

/**
 * A background-disposal drain as ren-core reports it (`swept`): $sweep calls, the
 * longest slice, the time spent sweeping and from the first retire to the
 * last freeing (ms), and late frames seen meanwhile.
 * @typedef {{ slices: number, longest: number, busy: number, time: number, late: number }} Drain
 */

/**
 * The drain reports of ren-show root: its `swept` option calls `emit`,
 * and a demo `listen`s while it is shown.
 */
export class Drains {
  constructor() {
    /** @type {Set<(drain: Drain) => void>} */
    this.listeners = new Set();
    /** @param {Drain} drain */
    this.emit = drain => {
      for (const listen of this.listeners) listen(drain);
    };
  }
  /** @param {(drain: Drain) => void} listen @returns {() => void} the unsubscribe */
  listen(listen) {
    this.listeners.add(listen);
    return () => void this.listeners.delete(listen);
  }
}

/** @type {Environment} */
const fallback = {
  later: (ms, fn) => {
    // timer: feature, the environment's real clock (tests supply a manual one)
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
  now: () => performance.now(),
  skia: null,
  three: null,
  fonts: null,
  typefaces: null,
  locks: null,
  worker: null,
  engine: null,
  sources: {},
  mode: 'runtime',
  settle: () => {},
  pace: 1,
  drains: new Drains(),
  isolated: false,
  scale: () => Math.min(2, /** @type {any} */ (globalThis).devicePixelRatio ?? 1),
};

export const Assets = $context(fallback);

/** @param {Partial<Environment>} overrides @returns {Environment} */
export const environment = overrides => ({ ...fallback, drains: new Drains(), ...overrides });
