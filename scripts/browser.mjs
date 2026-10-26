// Opens the built ren-show in headless Chrome, both bundles (compiled and
// runtime), visits every demo, runs a few real interactions (CanvasKit,
// three.js on SwiftShader WebGL, a real Worker, timed table operations) and fails on any page error.
// Then, on the compiled bundle, a phone pass (touch, mobile viewport): the
// sections drawer at 390 pixels wide, Mail's and Terminal's phone layouts
// there, a real touch swipe on the events demo's pads (touchAction, onPointerCancel), and every page at 360 without horizontal overflow or a canvas
// shown at another size than it draws; then Showroom on an 800-wide tablet.
//
//   flock -w 1800 "$HOME/.cache/chrome-bench.lock" node scripts/browser.mjs [--only compiled|runtime] [--demos mail,showroom] [--no-phone | --phone]
//
// Run scripts/build.mjs first. Take the machine-wide Chrome lock, as above:
// only one Chrome runs at a time.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { start } from './serve.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const modes = ['compiled', 'runtime'].filter(m => only === null || m === only);
/** `--demos a,b`: only these sections (and the home page it starts on). */
const chosen = args.includes('--demos') ? args[args.indexOf('--demos') + 1].split(',') : null;
const phone = !args.includes('--no-phone');
/** `--phone`: the phone pass only. */
const phoneOnly = args.includes('--phone');

const chrome = ['google-chrome', 'chromium', 'chromium-browser'].find(name => {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (!chrome) throw new Error('Chrome or Chromium is required');

/**
 * How long one DevTools call may take, ms: a page check is one call, and its
 * own waits reach 180 s (Mail's parity script) after others; a Chrome that
 * stops answering fails the run.
 */
const CALL_DEADLINE = 600000;

/** A minimal DevTools protocol session over a page's WebSocket. @param {string} url */
async function devtools(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  /** @type {Map<number, { resolve: (message: any) => void, reject: (error: Error) => void, timer: NodeJS.Timeout }>} */
  const calls = new Map();
  /** @type {((message: any) => void)[]} */
  const listeners = [];
  /** Why the session ended (Chrome went away), null while open. @type {Error | null} */
  let ended = null;
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    const call = message.id ? calls.get(message.id) : undefined;
    if (call !== undefined) {
      clearTimeout(call.timer);
      calls.delete(message.id);
      call.resolve(message);
    } else for (const listen of listeners) listen(message);
  };
  /** Fails every call still waiting: no answer comes on a closed socket. @param {Error} error */
  const end = error => {
    ended ??= error;
    for (const call of calls.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    calls.clear();
  };
  socket.onclose = () => end(new Error('the DevTools connection closed: Chrome went away'));
  socket.onerror = () => end(new Error('the DevTools connection failed: Chrome went away'));
  return {
    /** @param {string} method @param {object} [params] @returns {Promise<any>} */
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        if (ended !== null) return reject(ended);
        const call = ++id;
        // timer: deadline, a call Chrome never answers fails the run.
        const timer = setTimeout(() => {
          calls.delete(call);
          reject(new Error(`${method} got no answer in ${CALL_DEADLINE / 1000} s`));
        }, CALL_DEADLINE);
        calls.set(call, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: call, method, params }));
      }),
    /** @param {(message: any) => void} listen */
    on: listen => void listeners.push(listen),
    close: () => socket.close(),
  };
}

/**
 * Chrome's accessibility tree under a canvas root (CDP Accessibility): the
 * mirror must expose its buttons and text fields by role and name. Throws
 * when either role has no named, unignored node there.
 * @param {{ send: (method: string, params?: object) => Promise<any> }} cdp @param {string} selector
 */
async function mirrored(cdp, selector) {
  await cdp.send('Accessibility.enable');
  const doc = await cdp.send('DOM.getDocument', { depth: 0 });
  const found = await cdp.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  const nodeId = found.result?.nodeId;
  if (!nodeId) throw new Error(`no ${selector}`);
  /** @type {string[]} */
  const out = [];
  for (const role of ['button', 'textbox']) {
    const r = await cdp.send('Accessibility.queryAXTree', { nodeId, role });
    const named = (r.result?.nodes ?? []).filter((/** @type {any} */ n) => !n.ignored && (n.name?.value ?? '') !== '').map((/** @type {any} */ n) => n.name.value);
    if (named.length === 0) throw new Error(`no ${role} with a name in the accessibility tree under ${selector}`);
    out.push(`${role}: ${named.length} ("${named[0]}")`);
  }
  return out.join(', ');
}

// Checks of their own: scripts/checks/<id>.js holds one async arrow
// function (in-page code, with wait, text, button and press in scope).
const own = join(root, 'scripts', 'checks');
const CHECKS_SOURCE = existsSync(own) ? readdirSync(own).filter(f => f.endsWith('.js')).map(f => `${JSON.stringify(f.slice(0, -3))}: ${readFileSync(join(own, f), 'utf8').trim().replace(/;$/, '')},`).join('\n') : '';

// The in-page checks, installed once as globalThis.showCheck: each demo's
// check returns a short report, or throws.
const PAGE = String.raw`globalThis.showCheck = (() => {
// A bounded re-check of the page's state: workers, WebAssembly, WebGL and
// frames change it and report no single event a check could await.
const wait = async (check, ms = 15000) => {
  // timer: poll
  for (const end = performance.now() + ms; performance.now() < end; await new Promise(r => setTimeout(r, 20))) {
    const value = check();
    if (value) return value;
  }
  throw new Error('timed out waiting for ' + check);
};
// What a check reads next, waited for with a bound: a layout that follows a
// box (a measured canvas, a ResizeObserver) lands in a later frame. On a
// time-out the check that follows says what is wrong.
const ready = (check, ms = 3000) => wait(check, ms).catch(() => {});
const text = () => document.querySelector('main.page').textContent;
const button = label => [...document.querySelectorAll('main.page button')].find(b => b.textContent === label);
const press = async label => (await wait(() => button(label))).click();
const CHECKS = {
${CHECKS_SOURCE}
};
const checks = {
  ...CHECKS,
  skia: async () => {
    const canvas = await wait(() => document.querySelector('[data-ren-root="gallery-skia"] canvas'));
    await wait(() => canvas.width > 0);
    return 'canvas ' + canvas.width + 'x' + canvas.height;
  },
  three: async () => {
    const canvas = await wait(() => document.querySelector('[data-ren-root="three-scene"] canvas'));
    const value = label => [...document.querySelectorAll('.value')].find(v => v.querySelector('small').textContent === label)?.querySelector('b').textContent;
    await wait(() => Number(value('frames animated')) >= 30);
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) throw new Error('no WebGL context on the scene canvas');
    // A click at the knot, in the middle of the canvas, is raycast to it.
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height * 0.42 }));
    await wait(() => value('picked') === 'knot');
    await press('Remove a cube');
    const direct = 'frames ' + value('frames animated') + ', picked ' + value('picked') + ', cubes ' + value('cubes');
    // The scene's application in a Worker: three.js stays on this thread.
    await press('Run the scene in a worker');
    const moved = await wait(() => document.querySelector('[data-ren-root="three-worker"] canvas'));
    await wait(() => Number(value('frames animated')) >= 30);
    // Cube 2 of 4 sits at x 0.425, y -1.45 in the scene: canvas (371.5, 287) of 680 x 360.
    const box = moved.getBoundingClientRect();
    await wait(() => {
      moved.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: box.left + (box.width * 371.5) / 680, clientY: box.top + (box.height * 287) / 360 }));
      return value('picked') === 'cube 2';
    });
    const worker = 'worker: frames ' + value('frames animated') + ', picked ' + value('picked');
    // A new theme keeps the scene in the worker, live and framed.
    const swatches = [...document.querySelectorAll('.swatch')];
    const was = document.querySelector('.shell').getAttribute('data-theme');
    const other = swatches.find(b => b.getAttribute('data-theme-id') !== was);
    other.click();
    await wait(() => document.querySelector('.shell').getAttribute('data-theme') === other.getAttribute('data-theme-id'));
    const again = await wait(() => document.querySelector('[data-ren-root="three-worker"] canvas'));
    if (value('scene application') !== 'in a worker') throw new Error('a new theme moved the scene out of the worker');
    if (getComputedStyle(again.parentElement.closest('[data-ren-root]')).borderTopWidth === '0px') throw new Error('the worker scene has no frame');
    const before = Number(value('frames animated'));
    await wait(() => Number(value('frames animated')) > before);
    swatches.find(b => b.getAttribute('data-theme-id') === was).click();
    await press('Run the scene on this thread');
    await wait(() => document.querySelector('[data-ren-root="three-scene"] canvas'));
    return direct + ' | ' + worker + ' | ' + gl.getParameter(gl.VERSION);
  },
  together: async () => {
    const roots = ['shadow', 'skia', 'three'].map(k => '[data-ren-root="together-' + k + '"]');
    await wait(() => roots.every(r => document.querySelector(r)));
    await wait(() => document.querySelector(roots[1] + ' canvas') && document.querySelector(roots[2] + ' canvas'));
    const shadow = document.querySelector(roots[0]).shadowRoot;
    await press('Count +1');
    await wait(() => shadow.textContent.includes('(shadow): 2'));
    shadow.querySelector('[data-ren="Action"]').click();
    const value = label => [...document.querySelectorAll('.value')].find(v => v.querySelector('small').textContent === label)?.querySelector('b').textContent;
    await wait(() => value('count') === '3');
    const live = 'dom, skia and three roots live; count ' + value('count') + ', +1 from ' + value('+1 from');
    // Every theme, on the fly: each nested root is made again with it.
    const themes = [...document.querySelectorAll('.swatch')];
    for (const swatch of [...themes.slice(1), themes[0]]) {
      const before = document.querySelector(roots[1] + ' canvas');
      swatch.click();
      const id = swatch.getAttribute('data-theme-id');
      await wait(() => document.querySelector('.shell').getAttribute('data-theme') === id && document.documentElement.getAttribute('data-theme') === id);
      await wait(() => { const now = document.querySelector(roots[1] + ' canvas'); return now && now !== before && document.querySelector(roots[2] + ' canvas'); });
    }
    return live + ' | ' + themes.length + ' themes switched, canvases remade';
  },
  style: async () => {
    // One card on the DOM, Skia and three.js: a triple press on each
    // canvas's paragraph selects it, through each renderer's own input.
    const canvases = ['style-skia', 'style-three', 'gallery-three'].map(id => '[data-ren-root="' + id + '"] canvas');
    await wait(() => canvases.every(c => document.querySelector(c)));
    const value = label => [...document.querySelectorAll('.value')].find(v => v.querySelector('small').textContent === label)?.querySelector('b').textContent;
    const triple = (selector, x, y) => {
      const canvas = document.querySelector(selector);
      const box = canvas.getBoundingClientRect();
      for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: box.left + x, clientY: box.top + y, button: 0, detail: 3 }));
    };
    const out = [];
    for (const [i, which, x, y] of [[0, 'Skia', 40, 80], [1, 'three.js', 52, 92]]) {
      await wait(() => { triple(canvases[i], x, y); button('Copy the ' + which + ' selection').click(); return (value('selected on the canvas') ?? '').startsWith('Padding, a border'); });
      out.push(which + ' selected');
    }
    // The Arabic line: Skia and three.js shape it with HarfBuzz (loaded beside
    // the page) as Chrome shapes the DOM's, so each is as wide within a pixel;
    // drawn by the typeface's advances, its letters set apart, it is some 26
    // pixels wider. The DOM's width settles once its font has loaded.
    const measured = () => {
      button('Measure the Arabic line').click();
      return Object.fromEntries((value('Arabic line, px') ?? '').split(', ').map(p => [p.slice(0, p.lastIndexOf(' ')), Number(p.slice(p.lastIndexOf(' ') + 1))]));
    };
    await wait(() => { const read = measured(); return ['DOM', 'Skia', 'three.js'].every(k => read[k] > 0); });
    await document.fonts.ready;
    await wait(() => { const read = measured(); return Math.abs(read.Skia - read.DOM) <= 1; }, 3000).catch(() => {});
    const widths = measured();
    for (const on of ['Skia', 'three.js']) if (Math.abs(widths[on] - widths.DOM) > 1) throw new Error('the Arabic line is ' + widths[on] + ' wide on ' + on + ', ' + widths.DOM + ' on the DOM: not shaped as the browser shapes it');
    out.push('Arabic line shaped: ' + value('Arabic line, px'));
    // Where layout runs: the DOM card laid out by Taffy beside the browser's,
    // box for box, and the Skia card laid out in the layout worker.
    await wait(() => document.querySelector('[data-ren-root="style-skia-worker"] canvas'));
    const cards = ['[data-side="dom"]', '[data-ren-root="style-dom-taffy"]'].map(s => document.querySelector(s + ' [data-ren="View"]'));
    await wait(() => cards[1] && cards[1].style.width === '300px');
    const boxes = card => [card, ...card.querySelectorAll('[data-ren]')].map(el => { const r = el.getBoundingClientRect(), o = card.getBoundingClientRect(); return [r.left - o.left, r.top - o.top, r.width, r.height]; });
    const [browser, taffy] = cards.map(boxes);
    const worst = Math.max(...browser.flatMap((b, i) => b.map((v, k) => Math.abs(v - taffy[i][k]))));
    if (browser.length !== taffy.length || worst > 3) throw new Error('the DOM laid out by Taffy differs from the browser by ' + worst.toFixed(2) + 'px: ' + JSON.stringify({ browser, taffy }));
    out.push('DOM by Taffy within ' + worst.toFixed(2) + 'px of the browser over ' + taffy.length + ' boxes', 'Skia laid out in a worker');
    // The DOM sets its text in the canvases' fonts (ren-dom's font and mono), loaded and unkerned.
    const host = getComputedStyle(document.querySelector('[data-ren-root="ren-show"]'));
    const face = host.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    await wait(() => document.fonts.check('16px "' + face + '"') && [...document.fonts].some(f => f.family.replace(/^["']|["']$/g, '') === face && f.status === 'loaded'));
    const mono = host.getPropertyValue('--ren-mono').trim();
    if (!face.startsWith('ren-') || mono === '' || host.fontKerning !== 'none') throw new Error('the DOM text is not in the fonts of the canvases: ' + JSON.stringify({ family: host.fontFamily, mono, kerning: host.fontKerning }));
    out.push('DOM text in ' + face + ' and ' + mono);
    return out.join(', ');
  },
  workers: async () => {
    await wait(() => text().includes('worker root "worker-app"'));
    await press('Start a background burst');
    const host = document.querySelector('[data-ren-root="worker-app"]');
    await wait(() => host.textContent.includes('burst 10'));
    await press('Stop the burst');
    // The rows scroll inside their region; the page does not grow with them.
    const region = host.querySelector('[data-ren="Scroll"]');
    if (region === null || Math.round(region.getBoundingClientRect().height) !== 160 || region.scrollHeight <= region.clientHeight) throw new Error('the rows are not in a 160-high scrolling region');
    if (!crossOriginIsolated) throw new Error('the page is not cross-origin isolated: no shared mailbox');
    const values = [...document.querySelectorAll('.value')].map(v => v.textContent).join(', ');
    return values;
  },
  table: async () => {
    const out = [];
    const drained = () => [...document.querySelectorAll('.value')].map(v => v.textContent).find(t => t.startsWith('last background drain') && / slices, /.test(t));
    for (const op of ['Make 1,000 rows', 'Mark every tenth row', 'Trade rows 2 and 999', 'Make 10,000 rows', 'Empty the table']) {
      await press(op);
      out.push(await wait(() => { const t = [...document.querySelectorAll('main.page [data-ren="Label"]')].map(l => l.textContent).find(t => t.startsWith(op + ':')); return t; }));
    }
    out.push(await wait(drained));
    await press('Load 1,000 rows (async)');
    out.push(await wait(() => [...document.querySelectorAll('main.page [data-ren="Label"]')].map(l => l.textContent).find(t => t.startsWith('Load 1,000 rows (async):'))));
    return out.join(' | ');
  },
  async: async () => {
    await wait(() => text().includes('city 1: Oslo'));
    await press('Next city');
    await wait(() => text().includes('city 2: Nairobi'));
    await press('Count down from 5');
    await wait(() => text().includes('ready: liftoff'));
    return 'city 2 loaded, countdown done';
  },
  resilience: async () => {
    const label = start => wait(() => [...document.querySelectorAll('main.page [data-ren="Label"]')].map(l => l.textContent).find(t => t.startsWith(start)));
    const values = () => [...document.querySelectorAll('.value')].map(v => v.textContent);
    const out = [];
    for (const size of ['20,000 components', '100,000 components']) {
      await press(size);
      await press('Build');
      out.push(await label('built '));
      await press('Dispose all');
      out.push(await label('disposed all'));
      // The drain report arrives once the last retired component is freed.
      await wait(() => values().some(t => t.startsWith('drain slices') && !t.endsWith('-')), 30000);
      await wait(() => values().some(t => t.startsWith('components cleaned') && /cleaned([1-9]\d*) of \1$/.test(t)));
      out.push(values().filter(t => /^(drain slices|longest slice|sweeping time|freed after|late frames)/.test(t)).join(', '));
    }
    return out.join(' | ');
  },
};
async function visit(id) {
  location.hash = '#' + id;
  await wait(() => document.querySelector('article[data-demo="' + id + '"]'));
  return checks[id] ? await checks[id]() : 'rendered';
}
// The phone pass. The drawer: the menu button opens the sections over a
// backdrop, focus on the current one, the page behind held still; choosing
// a section goes there and closes it; Escape and the backdrop close it.
async function drawer() {
  const menu = await wait(() => document.querySelector('button.menu'));
  const nav = document.getElementById(menu.getAttribute('aria-controls'));
  const shown = () => getComputedStyle(nav).visibility === 'visible' && nav.getBoundingClientRect().left >= 0;
  // Open or closed, and what goes with it: aria-expanded, the page behind held still or free, the focus in it when open.
  const settled = async open => {
    await wait(() => shown() === open && (open || getComputedStyle(nav).visibility === 'hidden'), 3000);
    await ready(() => menu.getAttribute('aria-expanded') === String(open) && (getComputedStyle(document.documentElement).overflow === 'hidden') === open && (!open || nav.contains(document.activeElement)));
  };
  if (getComputedStyle(document.querySelector('.side')).position !== 'fixed' || menu.getBoundingClientRect().width < 40) throw new Error('no drawer at phone width');
  if (shown()) throw new Error('the drawer shows before it is opened');
  const out = [];
  menu.click();
  await settled(true);
  if (menu.getAttribute('aria-expanded') !== 'true') throw new Error('aria-expanded did not follow');
  if (document.activeElement !== nav.querySelector('a.here')) throw new Error('the focus is not on the current section: ' + document.activeElement?.outerHTML.slice(0, 80));
  if (getComputedStyle(document.documentElement).overflow !== 'hidden') throw new Error('the page behind scrolls');
  const width = nav.getBoundingClientRect().width;
  if (width > Math.min(300, innerWidth * 0.85) + 1) throw new Error('the drawer is ' + width + ' wide');
  out.push('opened ' + Math.round(width) + 'px wide');
  nav.querySelector('a[href="#stores"]').click();
  await wait(() => document.querySelector('article[data-demo="stores"]'));
  await settled(false);
  if (menu.getAttribute('aria-expanded') !== 'false' || getComputedStyle(document.documentElement).overflow === 'hidden') throw new Error('choosing a section left it open');
  out.push('a section closes it');
  menu.click();
  await settled(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settled(false);
  await ready(() => document.activeElement === menu);
  if (document.activeElement !== menu) throw new Error('Escape did not give the focus back to the button');
  out.push('Escape closes it');
  menu.click();
  await settled(true);
  // A tap beside the drawer lands on the backdrop.
  const backdrop = document.elementFromPoint(innerWidth - 8, innerHeight / 2);
  if (!backdrop?.classList.contains('scrim')) throw new Error('no backdrop beside the drawer: ' + backdrop?.outerHTML.slice(0, 80));
  backdrop.click();
  await settled(false);
  out.push('the backdrop closes it');
  return out.join(', ');
}
// A page fits a phone: nothing wider than the viewport, every canvas shown
// at the size it draws. Canvases follow their box once measured: waited for.
async function fits(id) {
  location.hash = '#' + id;
  await wait(() => document.querySelector('article[data-demo="' + id + '"]'));
  const wrong = () => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    if (document.scrollingElement.scrollWidth > vw) out.push('the page is ' + document.scrollingElement.scrollWidth + 'px wide in ' + vw);
    for (const canvas of document.querySelectorAll('main.page canvas')) {
      const box = canvas.getBoundingClientRect();
      if (box.width === 0) continue;
      const drawn = canvas.width / devicePixelRatio;
      if (Math.abs(box.width - drawn) > 1.5 && Math.abs(box.width - canvas.width) > 1.5) out.push('a canvas drawn ' + Math.round(drawn) + ' wide shown at ' + Math.round(box.width));
    }
    return out;
  };
  try {
    await wait(() => wrong().length === 0, 4000);
  } catch {
    throw new Error(wrong().join('; '));
  }
  return 'fits ' + document.documentElement.clientWidth + 'px';
}
// A box inside another, to half a pixel. Boxes as DOMRects.
const within = (inner, outer) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
// An element's content that scrolls sideways, or reaches past the viewport's right.
const sideways = el => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5;
// Mail on a phone: one pane at a time, the client as wide as its stage; the
// list, a message in its place, back to the list, on the DOM and on Skia;
// then the parity script on every renderer, in that layout.
async function mailPhone() {
  location.hash = '#mail';
  const app = await wait(() => document.querySelector('article[data-demo="mail"] .app-mail[data-layout="narrow"]'));
  const scroller = app.querySelector('.mail-scroller');
  const out = [];
  const host = await wait(() => app.querySelector('[data-ren-root="mail-dom"]'));
  const rows = () => [...host.querySelectorAll('button[aria-label]')].filter(b => b.getAttribute('aria-label').includes(': '));
  await wait(() => rows().length === 7);
  // Nothing of the client reaches past its box.
  const cut = () => [...host.querySelectorAll('[data-ren="Action"], [data-ren="Edit"]')].filter(el => el.getBoundingClientRect().width > 0 && !within(el.getBoundingClientRect(), scroller.getBoundingClientRect())).map(el => el.textContent || el.getAttribute('aria-label') || el.placeholder);
  await ready(() => !sideways(scroller) && cut().length === 0);
  if (sideways(scroller)) throw new Error('the stage scrolls sideways: ' + scroller.scrollWidth + ' in ' + scroller.clientWidth);
  if (cut().length > 0) throw new Error('cut at the stage: ' + cut().join(', '));
  out.push('dom ' + Math.round(scroller.clientWidth) + 'px, no sideways scroll');
  const subject = rows()[1].getAttribute('aria-label').split(': ').slice(1).join(': ');
  rows()[1].click();
  await wait(() => rows().length === 0 && host.textContent.includes('Mark unread') && host.textContent.includes(subject));
  await ready(() => cut().length === 0 && !sideways(scroller));
  if (cut().length > 0 || sideways(scroller)) throw new Error('the message does not fit: ' + cut().join(', '));
  const back = [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Back to the list');
  if (!back) throw new Error('no way back from the message');
  back.click();
  await wait(() => rows().length === 7 && !host.textContent.includes('Mark unread'));
  out.push('list, message, back');
  // Skia: the same flow by pointer events on the canvas (rows 75 high under the bar and the list's head).
  await press('Skia');
  const skia = await wait(() => app.querySelector('[data-ren-root="mail-skia"]'), 30000);
  const canvas = await wait(() => skia.querySelector('canvas'), 30000);
  await wait(() => canvas.width > 0 && skia.textContent.includes('Inbox'), 30000);
  canvas.scrollIntoView({ block: 'center' });
  await ready(() => !sideways(scroller) && Math.abs(canvas.getBoundingClientRect().width - scroller.clientWidth) <= 1);
  if (sideways(scroller) || Math.abs(canvas.getBoundingClientRect().width - scroller.clientWidth) > 1) throw new Error('the Skia client is ' + canvas.getBoundingClientRect().width + ' wide in ' + scroller.clientWidth);
  const tap = (x, y) => {
    const box = canvas.getBoundingClientRect();
    for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: box.left + x, clientY: box.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, detail: 1 }));
  };
  tap(canvas.getBoundingClientRect().width / 2, 56 + 1 + 44 + 1 + 75 + 37);
  await wait(() => skia.textContent.includes('Mark unread'));
  // The back button: at the left of the pane's head, under the bar.
  tap(40, 56 + 1 + 22);
  await wait(() => !skia.textContent.includes('Mark unread'));
  out.push('skia: list, message, back');
  await press('DOM');
  await press('Run the parity script');
  await wait(() => /\d+ of \d+ renderers/.test(app.querySelector('.mail-parity .summary').textContent) && !button('Running the parity script…'), 180000);
  const results = [...app.querySelectorAll('tr[data-parity]')].map(tr => [...tr.children].map(td => td.textContent));
  const failed = results.filter(r => r[1] !== 'pass' && r[1] !== 'skipped');
  if (failed.length > 0) throw new Error('parity failed on a phone: ' + failed.map(r => r.join(' | ')).join(' / '));
  out.push('parity ' + results.map(r => r[0] + ' ' + r[1]).join(', '));
  return out.join(', ');
}
// Terminal on a phone: the desk in one column as wide as its stage, the
// chart over the watchlist, both whole; on Skia and on the DOM (whose boxes say where each lies).
async function terminalPhone() {
  location.hash = '#terminal';
  const stage = await wait(() => document.querySelector('article[data-demo="terminal"] .term-stage[data-layout="narrow"]'));
  const canvas = await wait(() => stage.querySelector('[data-ren-root="terminal-skia"] canvas'), 30000);
  await wait(() => canvas.width > 0);
  await ready(() => !sideways(stage));
  if (sideways(stage)) throw new Error('the stage scrolls sideways: ' + stage.scrollWidth + ' in ' + stage.clientWidth);
  const mirror = stage.querySelector('[data-ren-root="terminal-skia"]').textContent;
  if (!mirror.includes('Watchlist') || !mirror.includes('RSI')) throw new Error('the Skia desk lacks the chart or the watchlist');
  const out = ['skia ' + Math.round(canvas.getBoundingClientRect().width) + ' by ' + Math.round(canvas.getBoundingClientRect().height)];
  await press('DOM');
  const desk = await wait(() => stage.querySelector('[data-ren-root="terminal-dom"] [data-terminal]'));
  await ready(() => !sideways(stage));
  if (sideways(stage)) throw new Error('the DOM desk scrolls sideways');
  const box = el => el.getBoundingClientRect();
  const chart = box(desk.querySelector('[data-chart="price"]'));
  const list = box(desk.querySelector('[data-watchlist]'));
  const whole = box(stage);
  if (!(chart.width > 200 && chart.height > 200 && within(chart, box(desk)) && chart.left >= whole.left - 0.5 && chart.right <= whole.right + 0.5)) throw new Error('the chart is not whole: ' + JSON.stringify(chart));
  if (!(list.top >= chart.bottom - 0.5 && within(list, box(desk)))) throw new Error('the watchlist is not under the chart, whole: ' + JSON.stringify({ chart, list }));
  const quotes = [...desk.querySelectorAll('[data-quote]')];
  if (quotes.length === 0 || !quotes.every(q => within(box(q), list))) throw new Error('a watchlist row is cut');
  out.push('dom: chart ' + Math.round(chart.width) + ' by ' + Math.round(chart.height) + ' over ' + quotes.length + ' symbols');
  // The readout on two rows, each whole in the chart's width.
  const rows = [...desk.querySelectorAll('[data-readout]')];
  const text = el => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect(); };
  if (rows.length !== 2 || !rows.every(r => text(r).right <= chart.right + 0.5)) throw new Error('the readout is cut: ' + rows.map(r => r.textContent + ' to ' + Math.round(text(r).right)).join(', ') + ' in ' + Math.round(chart.right));
  // The switch under the chart: the order book, then the tape, whole in the watchlist's place.
  for (const [name, selector] of [['book', '[data-book="levels"]'], ['trades', '[data-tape="trades"]']]) {
    desk.querySelector('[data-panel="' + name + '"]').click();
    const shown = await wait(() => desk.querySelector(selector));
    await ready(() => desk.querySelector('[data-watchlist]') === null && within(box(shown), box(desk)) && box(shown).top >= chart.bottom);
    if (desk.querySelector('[data-watchlist]') !== null || !within(box(shown), box(desk)) || box(shown).top < chart.bottom) throw new Error('the ' + name + ' is not whole under the chart');
  }
  desk.querySelector('[data-panel="watchlist"]').click();
  await wait(() => desk.querySelector('[data-watchlist]'));
  out.push('readout on two rows, book and trades switched in');
  await press('Skia');
  await wait(() => stage.querySelector('[data-ren-root="terminal-skia"] canvas'));
  return out.join(', ');
}
// Showroom on a tablet: the canvas as wide as the page, the bar in two rows;
// what the scene reports of its overlay and panels lies inside the canvas,
// none over another; a press on a control of the second row lands.
async function showroomTablet() {
  location.hash = '#showroom';
  const app = await wait(() => document.querySelector('article[data-demo="showroom"] .app-showroom[data-layout="tablet"]'));
  const scene = app.querySelector('.scene');
  const canvas = await wait(() => app.querySelector('[data-ren-root="showroom-scene"] canvas'), 30000);
  await wait(() => canvas.width > 0);
  const boxes = await wait(() => { const b = JSON.parse(app.dataset.boxes || 'null'); return b && b.head[3] > 0 && b.canvas[2] === Math.round(canvas.getBoundingClientRect().width) && b; });
  await ready(() => !sideways(scene));
  if (sideways(scene)) throw new Error('the scene scrolls sideways: ' + scene.scrollWidth + ' in ' + scene.clientWidth);
  const [, , w, h] = boxes.canvas;
  const inside = b => b && b[0] >= 0 && b[1] >= 0 && b[0] + b[2] <= w && b[1] + b[3] <= h;
  const apart = (a, b) => a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1];
  const names = ['head', 'corner', 'bar', 'spec', 'engrave'];
  for (const n of names) if (!inside(boxes[n])) throw new Error(n + ' is cut: ' + boxes[n] + ' in ' + w + ' by ' + h);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (!apart(boxes[names[i]], boxes[names[j]])) throw new Error(names[i] + ' ' + boxes[names[i]] + ' overlaps ' + names[j] + ' ' + boxes[names[j]]);
  canvas.scrollIntoView({ block: 'center' });
  const controls = JSON.parse(app.dataset.controls);
  const click = ([x, y]) => {
    const r = canvas.getBoundingClientRect();
    for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: r.left + x, clientY: r.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, detail: 1 }));
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: 0, detail: 1 }));
  };
  const config = () => app.querySelector('.strip .config').textContent;
  click(controls['size:l']);
  await wait(() => config().includes('size L'));
  click(controls['size:m']);
  await wait(() => config().includes('size M'));
  return 'canvas ' + w + ' by ' + h + ', ' + names.length + ' parts inside and apart, the second row pressed';
}
// Touch on every renderer (the events demo's pads): where a pad lies on the
// screen now, scrolled to the middle of the viewport first, and what it says.
async function touchPads() {
  location.hash = '#events';
  await wait(() => document.querySelector('[data-ren-root="events-touch-skia"] canvas')?.width > 0 && document.querySelector('[data-ren-root="events-touch-three"] canvas')?.width > 0, 30000);
  return 'ready';
}
// The page at rest: a swipe's fling scrolls on after the finger lifts, and
// a scroll (a fling's or scrollIntoView's) ends in scrollend. A page that sends
// no scroll event in the next two frames is not scrolling.
async function still() {
  let moved = false;
  const moving = () => { moved = true; };
  let ended = () => {};
  const end = new Promise(r => (ended = r));
  addEventListener('scroll', moving, { passive: true });
  addEventListener('scrollend', ended);
  const last = scrollY;
  try {
    // timer: poll, a page at rest sends no event: a frame dispatches a scroll that is under way; two at most.
    for (let n = 0; n < 2 && !moved && scrollY === last; n++) await new Promise(r => requestAnimationFrame(r));
    if (!moved && scrollY === last) return;
    let timer = 0;
    // timer: deadline, a scroll that never sends scrollend fails the check.
    const late = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('the page scrolled and sent no scrollend in 5 s')), 5000)));
    await Promise.race([end, late]).finally(() => clearTimeout(timer));
  } finally {
    removeEventListener('scroll', moving);
    removeEventListener('scrollend', ended);
  }
}
async function touchPad(side, name) {
  await still();
  const at = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  if (side === 'dom') {
    const pad = document.querySelector('[data-touch="dom"] [data-pad="' + name + '"]');
    pad.scrollIntoView({ block: 'center' });
    await still();
    return { ...at(pad), scroll: scrollY, touch: getComputedStyle(pad).touchAction };
  }
  const canvas = document.querySelector('[data-ren-root="events-touch-' + side + '"] canvas');
  canvas.scrollIntoView({ block: 'center' });
  await still();
  const r = at(canvas);
  const half = Math.floor((r.w - 8) / 2);
  return { x: r.x + (name === 'none' ? 0 : half + 8), y: r.y, w: half, h: r.h, scroll: scrollY };
}
function touchState(side, name) {
  if (side === 'dom') return document.querySelector('[data-touch="dom"] [data-state="' + name + '"]').textContent;
  return document.querySelector('[data-ren-root="events-touch-' + side + '"]').textContent;
}
// The selected buttons on the page (a pressed segment, a chosen tool).
const chosen = () => [...document.querySelectorAll('main.page button[aria-pressed="true"], main.page button.on')].filter(b => b.getBoundingClientRect().width > 0 && !b.closest('[data-ren-aria]'));
const selected = () => chosen().length;
// The selected button i, scrolled into view: its center and name.
const spot = i => {
  const b = chosen()[i];
  b.scrollIntoView({ block: 'center' });
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.textContent.trim() || b.getAttribute('aria-label') || '?' };
};
// A CSS color as [r, g, b, a], each 0-1, read back from a pixel.
const pixel = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
const rgba = css => {
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = css;
  pixel.fillRect(0, 0, 1, 1);
  const d = pixel.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
};
const luminance = ([r, g, b]) => { const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
// The contrast of the text under the pointer with the background it is painted on: the backgrounds
// from the button out to the first opaque one, laid over each other.
function underPointer(i) {
  const button = chosen()[i];
  if (!button.matches(':hover')) throw new Error('the pointer is not over ' + button.textContent);
  const layers = [];
  for (let n = button; n; n = n.parentElement) {
    const c = rgba(getComputedStyle(n).backgroundColor);
    if (c[3] > 0) layers.push(c);
    if (c[3] >= 0.999) break;
  }
  let back = [1, 1, 1];
  for (const [r, g, b, a] of layers.reverse()) back = [r * a + back[0] * (1 - a), g * a + back[1] * (1 - a), b * a + back[2] * (1 - a)];
  const [p, q] = [luminance(rgba(getComputedStyle(button).color)), luminance(back)];
  return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05);
}
// Every running CSS transition on the page finished (a hover's, a theme's); endless animations are not waited on.
const settled = () => Promise.all(document.getAnimations().filter(a => a instanceof CSSTransition).map(a => a.finished.catch(() => {})));
return { wait, visit, drawer, fits, mailPhone, terminalPhone, showroomTablet, touchPads, touchPad, touchState, selected, spot, underPointer, settled };
})();
`;

/**
 * The Chrome running now: its process (the leader of its own group), its
 * profile and temp folders, its exit, and its stop once asked for.
 * @typedef {{ browser: import('node:child_process').ChildProcess, profile: string, temp: string, exited: Promise<unknown>, done: Promise<void> | null }} Running
 */
/** @type {Running | null} */
let running = null;

/** Whether any process of a group is left. @param {number} group */
const alive = group => {
  try {
    process.kill(-group, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stops Chrome's whole group (SIGTERM, then SIGKILL) and removes its folders; one stop per Chrome, however often asked. */
function stop() {
  const r = running;
  if (r === null) return Promise.resolve();
  r.done ??= (async () => {
    const group = /** @type {number} */ (r.browser.pid);
    const signal = (/** @type {NodeJS.Signals} */ name) => {
      try {
        process.kill(-group, name);
      } catch {}
    };
    signal('SIGTERM');
    // timer: deadline, Chrome gets 2 s to exit on SIGTERM before the kill.
    await Promise.race([r.exited, new Promise(resolve => setTimeout(resolve, 2000))]);
    signal('SIGKILL');
    await r.exited;
    // Its other processes (renderers, GPU) go with the group; a bounded wait, then the folders whatever is left.
    for (let i = 0; i < 100 && alive(group); i++) await new Promise(resolve => setTimeout(resolve, 20)); // timer: poll, a group's end has no event
    rmSync(r.profile, { recursive: true, force: true, maxRetries: 3 });
    rmSync(r.temp, { recursive: true, force: true, maxRetries: 3 });
    if (running === r) running = null;
  })();
  return r.done;
}

/** @type {import('node:http').Server | null} */
let server = null;
/** Set once the run is being stopped (a signal, an error): the stop owns the exit. */
let stopping = false;
/** Stops Chrome, removes its folders, closes the server and exits with `code`. @param {string} why @param {number} code */
async function abort(why, code) {
  if (stopping) return;
  stopping = true;
  console.error(`browser check: stopped: ${why}`);
  try {
    await stop();
  } finally {
    server?.close();
    process.exit(code);
  }
}
// A signal or an error no try took: Chrome's detached group, its profile and its temp folder go too.
process.on('SIGINT', () => void abort('SIGINT', 130));
process.on('SIGTERM', () => void abort('SIGTERM', 143));
process.on('SIGHUP', () => void abort('SIGHUP', 129));
process.on('uncaughtException', error => void abort(String(error?.stack ?? error), 1));
process.on('unhandledRejection', error => void abort(String(/** @type {any} */ (error)?.stack ?? error), 1));

const artifact = existsSync(join(root, 'artifact')) ? join(root, 'artifact') : null;
const base = process.env.TMPDIR || (artifact === null ? tmpdir() : join(artifact, 'tmp'));
mkdirSync(base, { recursive: true });
server = await start();
const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
let failed = 0;
try {
  for (const mode of modes) {
    const profile = mkdtempSync(join(base, 'ren-show-chrome-'));
    // Chrome's own temp folder (its singleton socket's com.google.Chrome.XXXXXX, which a Chrome stopped by a signal
    // leaves behind): one per run, removed with the profile. It stays short, as a socket's path must be.
    const temp = mkdtempSync(join(tmpdir(), 'ren-show-'));
    const browser = spawn(
      chrome,
      ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-first-run', '--disable-extensions', '--js-flags=--max-old-space-size=1024', `--user-data-dir=${profile}`, '--window-size=1280,900', '--remote-debugging-port=0', 'about:blank'],
      { stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: { ...process.env, TMPDIR: temp } },
    );
    running = { browser, profile, temp, exited: new Promise(resolve => browser.once('exit', resolve)), done: null };
    try {
      const endpoint = await new Promise((resolve, reject) => {
        let log = '';
        // timer: deadline
        const timer = setTimeout(() => reject(new Error('Chrome did not start')), 20000);
        browser.on('exit', code => reject(new Error(`Chrome exited (${code}): ${log.slice(-800)}`)));
        browser.stderr.on('data', chunk => {
          log += chunk;
          const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
      });
      const http = String(endpoint).replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
      const target = (await (await fetch(`${http}/json/list`)).json()).find((/** @type {any} */ t) => t.type === 'page');
      const cdp = await devtools(target.webSocketDebuggerUrl);
      /** @type {string[]} */
      const errors = [];
      /** Resolves on the next page load. @type {() => void} */
      let reload = () => {};
      cdp.on(message => {
        if (message.method === 'Page.loadEventFired') reload();
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((/** @type {any} */ a) => a.value ?? a.description).join(' '));
        if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(`${message.params.entry.text} ${message.params.entry.url ?? ''}`);
      });
      await cdp.send('Runtime.enable');
      await cdp.send('Log.enable');
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/${mode === 'runtime' ? '?runtime' : ''}` });
      const ready = await cdp.send('Runtime.evaluate', { expression: `${PAGE}; (async () => { await showCheck.wait(() => document.querySelectorAll('#sections a').length > 0); return [...document.querySelectorAll('#sections a')].map(a => a.getAttribute('href').slice(1)); })()`, awaitPromise: true, returnByValue: true });
      if (ready.result.exceptionDetails) throw new Error(`page did not start: ${JSON.stringify(ready.result.exceptionDetails)}`);
      const ids = /** @type {string[]} */ (ready.result.result.value).filter(id => chosen === null || chosen.includes(id));
      console.log(`${mode}: ${ids.length} demos`);
      for (const id of phoneOnly ? [] : ids) {
        const before = errors.length;
        const result = await cdp.send('Runtime.evaluate', { expression: `showCheck.visit(${JSON.stringify(id)})`, awaitPromise: true, returnByValue: true });
        const thrown = result.result.exceptionDetails;
        const report = thrown ? `FAILED ${thrown.exception?.description ?? thrown.text}` : result.result.result.value;
        const pageErrors = errors.slice(before);
        const ok = !thrown && pageErrors.length === 0;
        if (!ok) failed++;
        console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(14)} ${report}${pageErrors.length ? `\n       page errors: ${pageErrors.join(' / ')}` : ''}`);
        if (id === 'skia' && ok) {
          // The accessibility mirror in Chrome's own accessibility tree: what assistive technology reads of a canvas.
          let line;
          try {
            line = await mirrored(cdp, '[data-ren-root="gallery-skia"]');
          } catch (error) {
            failed++;
            line = `FAILED ${/** @type {Error} */ (error).message}`;
          }
          console.log(`  ${line.startsWith('FAILED') ? 'FAIL' : 'ok  '} ${'skia a11y'.padEnd(14)} ${line}`);
        }
      }
      if (!phoneOnly && mode === modes[0]) {
        // A selected button under the pointer, in every theme: its text keeps its contrast (a hover must not
        // paint a light fill under the accent's light ink).
        const themes = /** @type {string[]} */ ((await cdp.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.swatch')].map(b => b.getAttribute('data-theme-id'))`, returnByValue: true })).result.result.value);
        for (const id of ['mail', 'studio', 'terminal', 'pulse', 'issues', 'showroom'].filter(id => ids.includes(id))) {
          await cdp.send('Runtime.evaluate', { expression: `showCheck.visit(${JSON.stringify(id)})`, awaitPromise: true });
          /** @type {string[]} */
          const weak = [];
          let seen = 0;
          for (const theme of themes) {
            // The page's colors ease to the theme's: measure them once their transitions end.
            await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.swatch[data-theme-id="${theme}"]').click(); showCheck.settled()`, awaitPromise: true });
            const count = /** @type {number} */ ((await cdp.send('Runtime.evaluate', { expression: 'showCheck.selected()', returnByValue: true })).result.result.value);
            for (let i = 0; i < count; i++) {
              const spot = /** @type {{ x: number, y: number, label: string }} */ ((await cdp.send('Runtime.evaluate', { expression: `showCheck.spot(${i})`, returnByValue: true })).result.result.value);
              await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spot.x, y: spot.y });
              const measured = await cdp.send('Runtime.evaluate', { expression: `showCheck.settled().then(() => showCheck.underPointer(${i}))`, awaitPromise: true, returnByValue: true });
              const contrast = measured.result.exceptionDetails ? NaN : measured.result.result.value;
              seen++;
              if (!(contrast >= 3)) weak.push(`${theme} "${spot.label}" ${Number(contrast).toFixed(2)}`);
            }
          }
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
          const ok = weak.length === 0;
          if (!ok) failed++;
          console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${`hover ${id}`.padEnd(14)} ${seen} selected buttons under the pointer in ${themes.length} themes${ok ? '' : `: ${weak.join(', ')}`}`);
        }
        await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.swatch[data-theme-id="${'tonal'}"]')?.click()` });
      }
      if (phone && mode === modes[0]) {
        // The phone pass: a touch screen, the drawer at 390 wide, every page at 360.
        /** @param {string} what @param {string} expression */
        const run = async (what, expression) => {
          const before = errors.length;
          const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          const thrown = result.result.exceptionDetails;
          const pageErrors = errors.slice(before);
          const ok = !thrown && pageErrors.length === 0;
          if (!ok) failed++;
          console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what.padEnd(14)} ${thrown ? `FAILED ${thrown.exception?.description ?? thrown.text}` : result.result.result.value}${pageErrors.length ? `\n       page errors: ${pageErrors.join(' / ')}` : ''}`);
        };
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        /** @param {string} expression */
        const value = async expression => {
          const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
          return r.result.result.value;
        };
        /** A real touch swipe (CDP's touch events, as a finger sends them) from (x, y) by dy, in steps. @param {number} x @param {number} y @param {number} dy */
        const swipe = async (x, y, dy) => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 8 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        // On every renderer: a swipe on the 'none' pad stays its drag (released, the page still);
        // a vertical swipe on the 'pan-y' pad scrolls the page and cancels the press.
        const touch = async () => {
          const before = errors.length;
          /** @type {string[]} */
          const out = [];
          let wrong = '';
          try {
            await value('showCheck.touchPads()');
            for (const side of ['dom', 'skia', 'three']) {
              const kept = await value(`showCheck.touchPad('${side}', 'none')`);
              await swipe(kept.x + 30, kept.y + 30, 80);
              const held = await value(`showCheck.wait(() => /released after [1-9]/.test(showCheck.touchState('${side}', 'none')), 3000).then(() => [scrollY, showCheck.touchState('${side}', 'none')])`);
              if (Math.abs(held[0] - kept.scroll) > 1) throw new Error(`${side}: touchAction 'none' let the page scroll ${held[0] - kept.scroll}px`);
              const pan = await value(`showCheck.touchPad('${side}', 'pan-y')`);
              // Downward: the page scrolls back up (the pads may sit where the page ends).
              await swipe(pan.x + 30, pan.y + 20, 120);
              const gone = await value(`showCheck.wait(() => /cancelled after/.test(showCheck.touchState('${side}', 'pan-y')), 3000).then(() => [scrollY, showCheck.touchState('${side}', 'pan-y')])`);
              if (pan.scroll - gone[0] < 20) throw new Error(`${side}: touchAction 'pan-y' did not let the swipe scroll the page (${pan.scroll - gone[0]}px)`);
              out.push(`${side}: kept, scrolled ${Math.round(pan.scroll - gone[0])}px and cancelled`);
            }
          } catch (error) {
            wrong = String(/** @type {any} */ (error)?.message ?? error);
          }
          const pageErrors = errors.slice(before);
          const ok = wrong === '' && pageErrors.length === 0;
          if (!ok) failed++;
          console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${'touch'.padEnd(14)} ${wrong === '' ? out.join(', ') : `FAILED ${wrong}`}${pageErrors.length ? `\n       page errors: ${pageErrors.join(' / ')}` : ''}`);
        };
        for (const width of [390, 360]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
          const loaded = new Promise(resolve => (reload = () => resolve(undefined)));
          await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${mode === 'runtime' ? 'runtime&' : ''}phone=${width}#home` });
          // timer: deadline
          await Promise.race([loaded, new Promise((_, reject) => setTimeout(() => reject(new Error('the phone page did not load')), 30000))]);
          await cdp.send('Runtime.evaluate', { expression: `${PAGE}; showCheck.wait(() => document.querySelector('#sections a'))`, awaitPromise: true });
          console.log(`${mode}: phone, ${width} wide`);
          if (width === 390) {
            await run('drawer', 'showCheck.drawer()');
            if (ids.includes('mail')) await run('mail', 'showCheck.mailPhone()');
            if (ids.includes('terminal')) await run('terminal', 'showCheck.terminalPhone()');
            if (ids.includes('events')) await touch();
          } else for (const id of ['home', ...ids.filter(id => id !== 'home')]) await run(id, `showCheck.fits(${JSON.stringify(id)})`);
        }
        // A tablet: Showroom at 800 wide.
        if (ids.includes('showroom')) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 1100, deviceScaleFactor: 2, mobile: true });
          const loaded = new Promise(resolve => (reload = () => resolve(undefined)));
          await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${mode === 'runtime' ? 'runtime&' : ''}tablet=800#home` });
          // timer: deadline
          await Promise.race([loaded, new Promise((_, reject) => setTimeout(() => reject(new Error('the tablet page did not load')), 30000))]);
          await cdp.send('Runtime.evaluate', { expression: `${PAGE}; showCheck.wait(() => document.querySelector('#sections a'))`, awaitPromise: true });
          console.log(`${mode}: tablet, 800 wide`);
          await run('showroom', 'showCheck.showroomTablet()');
        }
      }
      cdp.close();
    } finally {
      // Chrome lets go of its profile when it exits.
      await stop();
    }
  }
} catch (error) {
  // Chrome gone mid-run (its DevTools calls fail), or a call with no answer: stopped, cleaned, failed.
  await abort(String(/** @type {any} */ (error)?.stack ?? error), 1);
}
if (!stopping) {
  server.close();
  console.log(failed === 0 ? 'browser check: all demos ok' : `browser check: ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
