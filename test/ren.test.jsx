// The ren-core demos and the shell: opened in an application root on happy-dom,
// with headless CanvasKit for Skia and a MessageChannel for the worker root.
// The async and resilience demos run on real timers (a fast pace) and are
// awaited.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { fileURLToPath } from 'node:url';
import { Root, $active } from 'ren-core';
import { measure, follow, Value } from '../src/kit.jsx';
import { $json } from 'ren-json';
import { Assets, environment } from '../src/assets.js';
import { serve } from 'ren-core/worker';
import { open, clock, flushed, after } from './page.jsx';
import { App, sections } from '../src/app.jsx';
import { apps } from '../src/apps/index.js';
import { demos } from '../src/demos/index.js';
import flow from '../src/demos/flow.jsx';
import primitives from '../src/demos/primitives.jsx';
import style, { ARABIC } from '../src/demos/style.jsx';
import events from '../src/demos/events.jsx';
import resilience from '../src/demos/resilience.jsx';
import roots from '../src/demos/roots.jsx';
import skia from '../src/demos/skia.jsx';
import three from '../src/demos/three.jsx';
import together from '../src/demos/together.jsx';
import * as THREE from 'three';
import { CONSTRUCT, loadLayout } from 'ren-three';
import { Scene } from '../src/scene.jsx';
import { THEMES, argb } from '../src/themes.js';
import { color } from 'ren-dom';
import workers from '../src/demos/workers.jsx';
import compiler from '../src/demos/compiler.jsx';
import server from '../src/demos/server.jsx';
import transitions, { LATENCY as LOAD } from '../src/demos/transitions.jsx';
import table from '../src/demos/table.jsx';
import input from '../src/demos/input.jsx';
import render from '../src/demos/render.jsx';
import async, { DELAYS } from '../src/demos/async.jsx';
import { Remote, ROWS } from '../src/remote.jsx';
import { Sfnt, remoteLayout, serveLayout } from 'ren-canv';

// Each WebAssembly memory reserves its whole address range up front; at most
// 1 GB each, Taffy's and CanvasKit's fit the address cap
// (../../../.ai/config/resources.md).
setFlagsFromString('--wasm-max-mem-pages=16384');

/** The layout engine of the drawn primitives (Taffy's WebAssembly), once. */
await loadLayout();

const font = readFileSync(fileURLToPath(import.meta.resolve('ren-skia/font.ttf')));
const badge = readFileSync(new URL('../assets/badge.png', import.meta.url));
/** @type {any} */
let kit;
before(async () => {
  const CanvasKitInit = (await import('canvaskit-wasm')).default;
  kit = await CanvasKitInit();
});

/**
 * Re-checks `check` until it holds or `ms` pass; returns whether it held.
 * The page runs workers, WebAssembly and frames that report no single event.
 * @param {() => boolean} check
 */
const until = async (check, ms = 2000) => {
  // timer: poll, a bounded re-check of the page's state
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 5))) if (check()) return true;
  return check();
};
/** @param {ReturnType<typeof open>} page @param {string} label */
const value = (page, label) => page.all('.value').find(v => v.querySelector('small').textContent === label)?.querySelector('b').textContent;
/** The pace the async tests run at: a twentieth of the browser's delays. */
const PACE = 0.05;

describe('flow', () => {
  it('builds branches lazily and stops them on switch', () => {
    const page = open(flow.View);
    // Choose shows its fallback (mild) from the start.
    assert.deepEqual(page.log(), ['built fallback', 'built mild']);
    page.click('+1');
    page.click('+1');
    assert.ok(page.text().includes('count is 2'));
    assert.ok(page.log().includes('built branch') && page.log().includes('stopped fallback'));
    assert.equal(page.log().filter(l => l === 'built branch').length, 1, 'the branch is kept while truthy');
    page.click('Reset');
    assert.deepEqual(page.log().slice(-2), ['built fallback', 'stopped branch']);
    page.click('Warmer');
    page.click('Warmer');
    // The new branch builds first (detached); the old one stops when the new
    // one takes its place, so it stays live until then (a held update keeps it).
    assert.equal(page.log().at(-2), 'built hot');
    assert.equal(page.log().at(-1), 'stopped mild');
    page.click('Square');
    assert.equal(page.all('.stage rect').length, 1);
    page.click('<em> tag');
    assert.equal(page.all('.stage em')[0].textContent, 'an em element');
    page.click('Open a toast');
    assert.equal(page.all('.portal-target .toast').length, 1);
    page.click('Close the toast');
    assert.equal(page.all('.portal-target .toast').length, 0);
    assert.equal(page.log().at(-1), 'stopped toast');
    // Steps reads its Step children (Lazy) for the bar and runs only the chosen one.
    assert.deepEqual(page.log(1), ['built hall']);
    assert.deepEqual(page.texts('.stepper p.leg'), ['Hall B, 120 seats.']);
    assert.ok(page.button('2. Choose a date') && page.button('3. Confirm'));
    page.click('Next');
    assert.deepEqual(page.texts('.stepper p.leg'), ['Thursday evening.']);
    page.click('3. Confirm');
    page.click('1. Pick a hall');
    assert.deepEqual(page.log(1), ['built hall', 'built date', 'stopped hall', 'built confirm', 'stopped date', 'built hall', 'stopped confirm']);
    page.dispose();
  });
});

describe('transitions', () => {
  it('holds async updates whole, keeps stale content, shows in order, repeats, reruns and reports frozen reads', async () => {
    const time = clock();
    const page = open(transitions.View, { later: time.later, now: time.now });
    /**
     * Advances the clock, then waits for the flushes of what it resolved until `check` holds (with
     * none, the first flush).
     * @param {number} ms @param {() => boolean} [check]
     */
    const advance = (ms, check) => {
      const applied = flushed(page.root, check);
      time.advance(ms);
      return applied;
    };
    const one = (/** @type {string} */ selector) => page.all(selector)[0]?.textContent;
    await advance(450, () => one('p.forecast') === '#1 Oslo: windy');
    assert.equal(one('p.forecast'), '#1 Oslo: windy');
    // No tearing: the new city waits for its forecast; the indicators show at once.
    page.click('Next city');
    assert.equal(one('p.forecast'), '#1 Oslo: windy');
    assert.equal(value(page, 'city'), '1');
    assert.equal(value(page, 'pending'), 'true');
    assert.equal(value(page, 'chosen city'), '2');
    await advance(LOAD, () => one('p.forecast') === '#2 Nairobi: cloudy');
    assert.equal(one('p.forecast'), '#2 Nairobi: cloudy');
    assert.equal(value(page, 'city'), '2');
    assert.equal(value(page, 'pending'), 'false');
    // Stale content stays visible, with the tab bar, until the new tab is ready.
    page.click('Tab two');
    assert.equal(one('p.tab'), 'one: always here');
    assert.equal(value(page, 'tab'), 'one');
    await advance(LOAD, () => one('p.tab') === 'two: loaded');
    assert.equal(one('p.tab'), 'two: loaded');
    assert.equal(value(page, 'tab'), 'two');
    // Pending again: a new page shows the fallback.
    page.click('Next page');
    assert.ok(page.text().includes('loading the page…'));
    await advance(LOAD, () => one('p.article') === 'article 2');
    assert.equal(one('p.article'), 'article 2');
    // Sequence: in turn, the second waits for the first; as ready, it shows alone.
    page.click('In turn');
    // The second arrives (its flush) and waits for the first.
    await advance(150);
    assert.deepEqual(page.all('.card').map(c => c.textContent), ['first…', 'second…', 'third…']);
    await advance(300, () => page.all('.card').map(c => c.textContent)[0] === 'first (450 ms)');
    assert.deepEqual(page.all('.card').map(c => c.textContent), ['first (450 ms)', 'second (150 ms)', 'third (300 ms)']);
    page.click('As ready');
    await advance(150, () => page.all('.card').map(c => c.textContent)[1] === 'second (150 ms)');
    assert.deepEqual(page.all('.card').map(c => c.textContent), ['first…', 'second (150 ms)', 'third…']);
    await advance(300, () => page.all('.card').map(c => c.textContent).join() === 'first (450 ms),second (150 ms),third (300 ms)');
    // Times and For keying.
    assert.equal(page.all('ol.times li').length, 3);
    page.click('More');
    page.click('Fewer');
    page.click('Fewer');
    assert.deepEqual(page.all('ol.times li').map(li => li.textContent), ['row 0', 'row 1']);
    page.click('Reverse people');
    assert.equal(one('p.keyed'), 'OskarTamsinNora');
    assert.equal(one('p.positional'), 'OskarTamsinNora');
    assert.equal(value(page, 'keyed rows built'), '3', 'keyed rows moved');
    // A quiet rerun, then one announced with $changing.
    assert.equal(one('p.report'), 'report v1');
    page.click('Run again quietly');
    assert.equal(value(page, 'report pending'), 'false');
    assert.equal(value(page, 'report behind'), 'false', 'a quiet rerun is not behind');
    await advance(LOAD, () => one('p.report') === 'report v2');
    assert.equal(one('p.report'), 'report v2');
    page.click('Run again, announced');
    assert.equal(value(page, 'report pending'), 'true');
    assert.equal(value(page, 'report behind'), 'true', 'the shown report waits on its next version');
    await advance(LOAD, () => one('p.report') === 'report v3');
    assert.equal(one('p.report'), 'report v3');
    assert.equal(value(page, 'report pending'), 'false');
    assert.equal(value(page, 'report behind'), 'false');
    // Development: the frozen read is reported.
    page.click('Development: off');
    page.click('Insert a frozen read');
    assert.ok(page.texts('ol.log')[0].includes('REN dev: Frozen read reactive state in its body'));
    page.click('Development: on');
    page.dispose();
  });
});

describe('primitives', () => {
  it('maps every primitive to the DOM with portable events', async () => {
    const page = open(primitives.View);
    const roles = new Set(page.all('[data-ren]').map(n => n.getAttribute('data-ren')));
    for (const role of ['View', 'Layout', 'Scroll', 'Label', 'Edit', 'Action', 'Image', 'Shape']) assert.ok(roles.has(role), role);
    assert.equal(page.all('[data-ren="Shape"] > *').length, 6);
    const hand = () => page.all('[data-ren="Shape"] line')[0].getAttribute('x2');
    const before = hand();
    page.click('Turn the hand');
    assert.notEqual(hand(), before);
    const [name] = page.all('input');
    page.type(name, '');
    assert.equal(name.getAttribute('aria-invalid'), 'true');
    page.type(name, 'Tamsin');
    assert.ok(page.text().includes('Hello, Tamsin'));
    name.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.ok(page.text().includes('submitted "Tamsin"') || page.text().includes('key Enter'));
    page.click('Hide the list');
    assert.equal(page.all('[data-ren="Scroll"]')[0].style.display, 'none');
    assert.equal(page.all('[data-ren="Image"]')[0].getAttribute('src'), './badge.png');
    // The Code field: its value in highlighted runs, a mirror after the field; typing keeps it plain.
    // The mirror shows once its field is in the document (the Root puts its host in after the build),
    // which the renderer hears as a mutation of the document: delivered after this job.
    await Promise.resolve();
    const code = page.all('textarea').find(t => t.getAttribute('aria-label') === 'Code');
    assert.ok(code, 'the Code field');
    const mirror = code.nextSibling;
    assert.equal(mirror.getAttribute('data-ren-mirror'), '');
    assert.equal(mirror.textContent, code.value, 'the runs join to the value');
    assert.ok([...mirror.firstChild.children].some(s => s.textContent === 'let' && /font-weight: 700/.test(s.getAttribute('style'))), 'a bold keyword');
    page.type(code, 'return 7');
    assert.equal(mirror.textContent, 'return 7');
    assert.equal(mirror.style.display, 'block');
    page.dispose();
  });
});

describe('events', () => {
  it('delegates along the path, stops propagation, batches and prevents', () => {
    const page = open(events.View);
    page.click('Click the inner button');
    assert.deepEqual(page.log(), ['inner handler, currentTarget inner', 'middle handler, currentTarget middle', 'outer handler, currentTarget outer']);
    page.click('Clear the journal');
    page.click('Inner lets it bubble');
    page.click('Click the inner button');
    assert.deepEqual(page.log(), ['inner handler, currentTarget inner']);
    page.click('Write a and b in one handler');
    assert.equal(value(page, 'a + b'), '2');
    assert.equal(value(page, 'sum computed'), '2×', 'one recompute for two writes');
    page.type(page.all('input[name=word]')[0], 'ren');
    const submit = new page.window.Event('submit', { bubbles: true, cancelable: true });
    page.all('form')[0].dispatchEvent(submit);
    assert.equal(submit.defaultPrevented, true);
    assert.ok(page.text().includes('submitted "ren" without reloading'));
    page.dispose();
  });
});

describe('touch', () => {
  it('sets touchAction and ends a press on onPointerCancel, on the DOM, Skia and three.js', async () => {
    const { load } = threeStub();
    const page = open(events.View, { three: load, skia: async () => ({ kit, font }) });
    try {
      const roots = ['events-touch-skia', 'events-touch-three'];
      assert.ok(await until(() => roots.every(id => page.all(`[data-ren-root="${id}"] canvas`).length === 1)), 'both canvases');
      /** @param {any} target @param {string} type @param {number} x @param {number} y */
      const fire = (target, type, x, y) => {
        const event = new page.window.Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, { button: 0, buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0, offsetX: x, offsetY: y, clientX: x, clientY: y, x, y, pointerId: 1, detail: 1, shiftKey: false, pointerType: 'touch' });
        target.dispatchEvent(event);
      };
      // The DOM: CSS's touch-action on each pad; a release, then a cancel.
      const pad = (/** @type {string} */ name) => page.all(`[data-touch="dom"] [data-pad="${name}"]`)[0];
      assert.equal(pad('none').style.getPropertyValue('touch-action'), 'none');
      assert.equal(pad('pan-y').style.getPropertyValue('touch-action'), 'pan-y');
      const state = (/** @type {string} */ name) => page.all(`[data-touch="dom"] [data-state="${name}"]`)[0].textContent;
      fire(pad('none'), 'pointerdown', 20, 20);
      fire(pad('none'), 'pointermove', 20, 60);
      assert.equal(state('none'), 'dragging 40 px');
      fire(pad('none'), 'pointerup', 20, 60);
      assert.equal(state('none'), 'released after 40 px');
      fire(pad('pan-y'), 'pointerdown', 20, 20);
      fire(pad('pan-y'), 'pointermove', 20, 32);
      fire(pad('pan-y'), 'pointercancel', 20, 32);
      assert.equal(state('pan-y'), 'cancelled after 12 px');
      fire(pad('pan-y'), 'pointerup', 20, 90);
      assert.equal(state('pan-y'), 'cancelled after 12 px', 'nothing after the cancel');
      // The canvases: the same pads, through each renderer's pointer input.
      for (const id of roots) {
        const canvas = page.all(`[data-ren-root="${id}"] canvas`)[0];
        const host = page.all(`[data-ren-root="${id}"]`)[0];
        fire(canvas, 'pointerdown', 30, 60);
        fire(canvas, 'pointermove', 30, 90);
        fire(canvas, 'pointerup', 30, 90);
        assert.ok(await until(() => host.textContent.includes('released after 30 px')), `${id}: ${host.textContent}`);
        const right = 250;
        fire(canvas, 'pointerdown', right, 60);
        fire(canvas, 'pointermove', right, 70);
        fire(canvas, 'pointercancel', right, 70);
        fire(canvas, 'pointermove', right, 140);
        assert.ok(await until(() => host.textContent.includes('cancelled after 10 px')), `${id}: ${host.textContent}`);
      }
    } finally {
      page.dispose();
    }
  });
});

describe('async', () => {
  it('runs async functions, aborts superseded ones, races, retries and streams', async () => {
    const page = open(async.View, { pace: PACE });
    const ms = (/** @type {keyof typeof DELAYS} */ key) => DELAYS[key] * PACE;
    assert.ok(page.text().includes('loading the forecast…'));
    page.click('Next city');
    page.click('Next city');
    assert.equal(value(page, 'aborted'), '2', 'each new city aborts the request in flight');
    assert.ok(await until(() => page.text().includes('city 3: Lima, high 16 °C')));
    page.click('City 13');
    assert.ok(await until(() => page.text().includes('failed: city 13 has no weather station')));
    page.click('Back to city 1');
    assert.ok(await until(() => page.text().includes('city 1: Oslo, high 17 °C')));
    // Debounce: three quick keystrokes, one search.
    const field = page.all('input')[0];
    // The initial empty query has searched by now; count from here.
    const before = Number(value(page, 'searches run'));
    for (const text of ['a', 'ab', 'abo']) page.type(field, text);
    assert.ok(await until(() => value(page, 'results') === 'abort'));
    assert.equal(Number(value(page, 'searches run')), before + 1, 'three quick keystrokes, one search');
    // Promise.all: one Pending for three requests, then a note after $settled.
    page.click('Refresh all three');
    assert.ok(await until(() => page.log().includes('all settled: a#1 + b#1 + c#1')));
    assert.ok(page.text().includes('a#1 + b#1 + c#1'));
    // Promise.race: fast answers, slow times out.
    assert.ok(await until(() => page.text().includes('race: ready answered in time')));
    page.click('Make it slow');
    assert.ok(await until(() => page.text().includes('race: timed out'), ms('timeout') * 4 + 500));
    page.click('Retry');
    assert.ok(await until(() => page.text().includes('retry: succeeded after 3 tries')));
    assert.deepEqual(page.log().filter(l => l.startsWith('try')), ['try 1 failed, backing off', 'try 2 failed, backing off']);
    page.click('Count down from 5');
    assert.ok(await until(() => page.text().includes('ready: liftoff')));
    page.dispose();
  });
});

describe('resilience', () => {
  it('delivers every failure to its boundary and keeps the view current', () => {
    const page = open(resilience.View, { pace: PACE });
    for (const [place, message] of [['body', 'thrown while building'], ['binding', 'thrown by a binding'], ['effect', 'thrown by an effect'], ['watch', 'thrown by a $watch apply']]) {
      page.click(`Arm ${place}`);
      assert.ok(page.text().includes(`caught: ${message}`), place);
      page.click(`Reset ${place}`);
      assert.ok(page.text().includes(`${place}: fine`), `${place} resets`);
    }
    page.click('Fail in the handler');
    assert.ok(page.text().includes('caught: thrown by a handler'));
    // An armed cleanup throws as its branch is hidden: the branch still goes,
    // and the failure reaches the nearest boundary, this place's Recover.
    page.click('Arm cleanup');
    page.click('Hide it');
    assert.ok(page.text().includes('caught: thrown by a cleanup'));
    page.click('Reset cleanup');
    assert.ok(page.text().includes('cleanup: hidden'), 'the hide took effect');
    page.dispose();
  });

  it('aborts work in flight when widgets are removed; late results change nothing', async () => {
    const time = clock();
    const page = open(resilience.View, { pace: PACE, later: time.later, now: time.now });
    page.click('Start 20 widgets');
    assert.equal(page.all('.widgets li').length, 20);
    time.advance(400 * PACE / 2);
    page.click('Remove them all');
    assert.deepEqual([value(page, 'requests started'), value(page, 'aborted'), value(page, 'cleanups run')], ['20', '20', '20']);
    // Every request's wait and every poll left the clock, so nothing can complete late.
    assert.equal(time.pending(), 0, 'nothing is left on the clock');
    time.advance(400 * PACE * 3);
    page.click('Refresh the counts');
    assert.equal(value(page, 'completed'), '0', 'no removed widget completed');
    assert.equal(page.all('.widgets li').length, 0);
    page.click('Start 20 widgets');
    const loaded = () => page.all('.widgets li')[0]?.textContent.includes('widget 1 loaded') ?? false;
    const arrived = flushed(page.root, loaded);
    time.advance(400 * PACE);
    await arrived;
    assert.ok(loaded());
    page.click('Remove them all');
    page.click('Refresh the counts');
    assert.equal(value(page, 'cleanups run'), '40');
    page.dispose();
  });

  it('disposes 5,000 components in the background, in paced slices, or at once', async () => {
    const page = open(resilience.View);
    const cells = () => page.all('[data-ren-root="disposal-lab"] i').length;
    page.click('Build');
    assert.equal(cells(), 5000);
    assert.match(page.text(), /built 5,000: [\d.]+ ms in the handler, 0 of 5000 cleanups run so far/);
    page.click('Dispose all');
    assert.equal(cells(), 0, 'the nodes went at once');
    assert.match(page.text(), /disposed all: [\d.]+ ms in the handler, 0 of 5000 cleanups run so far/, 'the cleanups wait for the sweep');
    assert.ok(await until(() => value(page, 'drain slices') !== '-'), 'the lab root reported its drain');
    assert.equal(value(page, 'components cleaned'), '5000 of 5000', 'every cleanup ran once');
    assert.ok(Number(value(page, 'drain slices')) >= 1);
    assert.match(value(page, 'longest slice'), /^[\d.]+ ms$/);
    // At once: the handler stops every component itself.
    page.click('Mode: in the background');
    assert.ok(page.text().includes('Mode: at once'));
    page.click('Build');
    page.click('Dispose all');
    assert.match(page.text(), /disposed all: [\d.]+ ms in the handler, 10000 of 10000 cleanups run so far/);
    page.dispose();
  });
});

describe('roots', () => {
  it('isolates nested roots and joins them by props and messages', async () => {
    const page = open(roots.View);
    const shadow = page.all('[data-ren-root="note-shadow"]')[0];
    const light = page.all('[data-ren-root="note-light"]')[0];
    assert.ok(shadow.shadowRoot.textContent.includes('root "note-shadow" (shadow), props: hello, tone: cool'));
    assert.ok(light.textContent.includes('root "note-light" (dom), props: HELLO, tone: none'));
    // Each nested root has a theme of its own: the page's, with another accent.
    const rgba = (/** @type {string} */ hex) => `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')}, 1)`;
    assert.equal(shadow.style.getPropertyValue('--ren-accent'), rgba(THEMES[0].colors.series[1]));
    assert.equal(light.style.getPropertyValue('--ren-accent'), rgba(THEMES[0].colors.series[4]));
    page.type(page.all('input')[0], 'hi');
    assert.ok(shadow.shadowRoot.textContent.includes('props: hi,'));
    assert.ok(light.textContent.includes('props: HI,'));
    // Element ids come from Name: one per root.
    assert.equal(light.querySelector('input').id, 'note-light-text');
    assert.equal(shadow.shadowRoot.querySelector('input').id, 'note-shadow-text');
    // Storage is namespaced by id.
    const field = light.querySelector('input');
    field.value = 'kept';
    field.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    [...light.querySelectorAll('button')].find(b => b.textContent === 'Save').click();
    assert.equal(page.window.localStorage.getItem('ren:note-light:text'), 'kept');
    assert.equal(page.window.localStorage.getItem('ren:note-shadow:text'), null);
    // The private root keeps what it saves in memory: nothing reaches localStorage.
    const secret = page.all('[data-ren-root="note-private"]')[0];
    const own = secret.querySelector('input');
    own.value = 'private';
    own.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    [...secret.querySelectorAll('button')].find(b => b.textContent === 'Save').click();
    assert.equal(page.window.localStorage.getItem('ren:note-private:text'), null);
    assert.ok(!Object.keys(page.window.localStorage).some(k => k.startsWith('ren:note-private:')));
    [...light.querySelectorAll('button')].find(b => b.textContent === 'Send to parent').click();
    assert.deepEqual(page.log(), ['message from note-light: "kept"']);
    [...shadow.shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Tone +').click();
    assert.ok(shadow.shadowRoot.textContent.includes('tone: cool+'));
    page.click('List live roots');
    assert.equal(value(page, '$roots(document)'), 'note-light, note-private, note-shadow, ren-show');
    page.click('Dispose the shadow root');
    page.click('List live roots');
    assert.equal(value(page, '$roots(document)'), 'note-light, note-private, ren-show');
    page.click('Start it again');
    assert.equal(page.all('[data-ren-root="note-shadow"]').length, 1, 'the id is free again');
    page.dispose();
  });
});

describe('skia', () => {
  it('renders the same Gallery on a canvas once CanvasKit loads', async () => {
    const page = open(skia.View, { skia: async () => ({ kit, font, image: () => badge }) });
    assert.ok(page.text().includes('Loading CanvasKit…'));
    assert.ok(await until(() => page.all('[data-ren-root="gallery-skia"] canvas').length === 1));
    page.dispose();
    const none = open(skia.View, { skia: null });
    assert.ok(await until(() => none.text().includes('Skia is unavailable: this environment has no CanvasKit')));
    none.dispose();
  });
});

/** three.js in node: the scene graph is real, a stub stands in for WebGL and counts frames. */
const threeStub = () => {
  const drawer = { frames: 0, render: () => void drawer.frames++, setSize: () => {}, dispose: () => {} };
  return { drawer, load: async () => ({ THREE, renderer: drawer, font }) };
};

describe('three', () => {
  it('renders the scene in a three.js root, driven by DOM props, with picks sent back', async (/** @type {import('node:test').TestContext} */ t) => {
    const { load } = threeStub();
    const page = open(three.View, { three: load });
    assert.ok(page.text().includes('Loading three.js…'));
    assert.ok(await until(() => page.all('[data-ren-root="three-scene"]').length === 1));
    page.click('Remove a cube');
    assert.equal(value(page, 'cubes'), '4');
    page.click('Faster');
    assert.equal(value(page, 'speed'), '2×');
    page.dispose();
    // The scene's application in a "worker" (a MessageChannel): three.js stays here.
    /** Each worker's end: its session and both ports, closed whatever the test did. @type {(() => void)[]} */
    const ends = [];
    const worker = (/** @type {string} */ id) => {
      const { port1, port2 } = new MessageChannel();
      const session = serve(() => <Scene />, { port: port1, root: Root(id), construct: CONSTRUCT });
      const end = () => (session.close(), port1.close(), port2.close());
      ends.push(end);
      return Object.assign(port2, { terminate: end });
    };
    const moved = open(three.View, { three: load, worker });
    after(t, () => {
      moved.dispose();
      for (const end of ends) end();
    });
    assert.ok(await until(() => moved.all('[data-ren-root="three-scene"]').length === 1));
    moved.click('Run the scene in a worker');
    assert.ok(await until(() => moved.all('[data-ren-root="three-worker"]').length === 1), 'the worker root replaces the direct one');
    assert.equal(moved.all('[data-ren-root="three-scene"]').length, 0);
    assert.equal(value(moved, 'scene application'), 'in a worker');
    assert.ok(await until(() => Number(value(moved, 'frames animated')) >= 30, 3000), '$animate runs in the worker and its messages arrive');
    moved.click('Run the scene on this thread');
    assert.ok(await until(() => moved.all('[data-ren-root="three-scene"]').length === 1));
    const none = open(three.View, { three: null });
    assert.ok(await until(() => none.text().includes('three.js is unavailable: this environment has no three.js')));
    none.dispose();
  });
});

describe('style', () => {
  it('renders one styled card on the DOM, Skia and three.js, and selects its text on the canvases', async (/** @type {import('node:test').TestContext} */ t) => {
    const { load } = threeStub();
    // The layout worker: served over a channel in this process.
    const channel = new MessageChannel();
    const stop = serveLayout(channel.port2);
    const layout = remoteLayout(channel.port1);
    /** @type {ReturnType<typeof open> | null} */
    let page = null;
    after(t, () => {
      page?.dispose();
      layout.close();
      stop();
      channel.port1.close();
    });
    page = open(style.View, { three: load, skia: async () => ({ kit, font }), engine: async () => ({ fonts: new Sfnt(font), layout }) });
    assert.ok(await until(() => ['style-skia', 'style-three', 'gallery-three', 'style-dom-taffy', 'style-skia-worker'].every(id => page.all(`[data-ren-root="${id}"]`).length === 1)));
    // The DOM card: the style written as CSS.
    const card = page.all('[data-side="dom"] > [data-ren="View"]')[0];
    assert.equal(card.style.getPropertyValue('border-radius'), '14px');
    assert.equal(card.style.getPropertyValue('width'), '300px');
    assert.equal(card.style.getPropertyValue('user-select'), 'text', 'its text opted in to selection');
    page.click('Copy the Skia selection');
    assert.equal(value(page, 'selected on the canvas'), '(nothing selected)');
    // A triple press on the wrapped Label selects it all, on either canvas
    // (the card's padding, a 40-high header and a 12 gap above it).
    const triple = (/** @type {string} */ root, /** @type {number} */ x, /** @type {number} */ y) => {
      const canvas = page.all(`[data-ren-root="${root}"] canvas`)[0];
      const event = new page.window.Event('pointerdown', { bubbles: true, cancelable: true });
      Object.assign(event, { button: 0, offsetX: x, offsetY: y, detail: 3, shiftKey: false });
      canvas.dispatchEvent(event);
    };
    const text = 'Padding, a border, a shadow, rounded corners, a row that grows, wrapped text. Select it: drag, or double and triple click.';
    triple('style-skia', 40, 80);
    page.click('Copy the Skia selection');
    assert.equal(value(page, 'selected on the canvas'), text);
    triple('style-three', 52, 92);
    page.click('Copy the three.js selection');
    assert.equal(value(page, 'selected on the canvas'), text);
    // The Arabic line, shaped on both canvases: its letters joined, as wide
    // as the typeface's shaped advance and narrower than the letters set apart.
    page.click('Measure the Arabic line');
    const widths = Object.fromEntries(String(value(page, 'Arabic line, px')).split(', ').map(p => [p.slice(0, p.lastIndexOf(' ')), Number(p.slice(p.lastIndexOf(' ') + 1))]));
    const sfnt = new Sfnt(font);
    const apart = [...ARABIC].reduce((sum, letter) => sum + sfnt.width(letter, 16), 0);
    for (const on of ['Skia', 'three.js']) {
      assert.ok(Math.abs(widths[on] - sfnt.width(ARABIC, 16)) < 0.01, `${on}: ${widths[on]}`);
      assert.ok(widths[on] < apart - 10, `${on} joins the letters: ${widths[on]} of ${apart} apart`);
    }
    // Where layout runs: the DOM card at Taffy's boxes (its padding, the header's
    // two lines, 18 and 14 at 1.4, 2 apart, and a gap), and the Skia card
    // laid out in the worker, then painted.
    const placed = page.all('[data-ren-root="style-dom-taffy"] [data-ren="View"]')[0];
    assert.equal(placed.style.position, 'relative');
    assert.equal(placed.style.width, '300px');
    assert.equal(placed.style.getPropertyValue('border-radius'), '14px', 'paint stays CSS');
    const wrapped = page.all('[data-ren-root="style-dom-taffy"] [data-ren="Label"]')[2];
    assert.equal(wrapped.style.position, 'absolute');
    // Each line box down to a 64th of a pixel, as Blink lays it out (ren-canv).
    const line = (/** @type {number} */ size) => Math.floor(size * 1.4 * 64) / 64;
    assert.ok(Math.abs(parseFloat(wrapped.style.top) - (16 + line(18) + 2 + line(14) + 12)) < 0.01, wrapped.style.top);
    const painted = /** @type {any} */ (page.all('[data-ren-root="style-skia-worker"] canvas')[0]);
    assert.ok(await until(() => painted !== undefined));
  });
});

describe('together', () => {
  it('runs DOM, Skia and three.js roots side by side on one counter', async () => {
    const { load } = threeStub();
    const page = open(together.View, { three: load, skia: async () => ({ kit, font }) });
    assert.ok(await until(() => ['shadow', 'skia', 'three'].every(k => page.all(`[data-ren-root="together-${k}"]`).length === 1)));
    const shadow = page.all('[data-ren-root="together-shadow"]')[0].shadowRoot;
    assert.match(shadow.textContent, /together-shadow \(shadow\): 1/);
    page.click('Count +1');
    assert.match(shadow.textContent, /together-shadow \(shadow\): 2/, 'props reach the shadow root');
    shadow.querySelector('[data-ren="Action"]').click();
    assert.equal(value(page, 'count'), '3', 'its +1 comes back as a message');
    assert.equal(value(page, '+1 from'), 'shadow 1');
    page.dispose();
  });
});

describe('data', () => {
  it('reads a readout as its label and value, and each card on its own', async () => {
    // A readout is a group named by its caption: not the caption glued to the value.
    assert.deepEqual(await $json(() => <div><Value label="city" value={1} /><Value label="forecast" value="Oslo: windy" /></div>), [
      { role: 'group', label: 'city', text: '1' },
      { role: 'group', label: 'forecast', text: 'Oslo: windy' },
    ]);
    // The Sequence cards are blocks: three strings, not one (their answers take up to 450 ms).
    const out = JSON.stringify(await $json(() => <transitions.View />, { provide: [[Assets, environment({})]], timeout: 5000 }));
    assert.ok(out.includes('"first (450 ms)","second (150 ms)","third (300 ms)"'), out.slice(0, 400));
  });
});

describe('server', () => {
  it('renders the card as HTML and as data, after its items loaded', async () => {
    const page = open(server.View);
    // The live root's owner is loading: changed(nodes) has pushed that, and the settled data waits.
    const settled = () => page.all('[data-settled-json]')[0].textContent;
    assert.equal(JSON.parse(page.all('[data-live-json]')[0].textContent)[2], 'loading the owner…');
    assert.equal(settled(), '(settling…)');
    page.click('Render');
    assert.ok(await until(() => page.text().includes('"itemListElement"')));
    const [html, json] = page.all('pre.code').map(p => p.textContent);
    assert.ok(html.startsWith('<div data-ren-root="card"'));
    assert.ok(html.includes('<li data-item="Server one" itemprop="itemListElement">Server one</li>'), 'the HTML waited for the items, and carries the marks');
    assert.ok(!html.includes('loading'));
    // The data is what the card means: an item list with its name, and its button; no wrapper, class or style.
    assert.deepEqual(JSON.parse(json), [
      { role: 'article', item: { '@type': 'ItemList', name: 'Server', itemListElement: ['Server one', 'Server two'] }, children: [{ role: 'button', text: 'Open' }] },
    ]);
    // The live data root: its JSON follows each change.
    const live = () => JSON.parse(page.all('[data-live-json]')[0].textContent);
    const tasks = (/** @type {any[]} */ nodes) => [nodes[0].text, ...nodes[1].children.map((/** @type {any} */ c) => c.text)];
    assert.deepEqual(tasks(live()), ['2 open', 'write the docs', 'ship it']);
    // $settle resolved once the owner loaded: the first push has it, and no loading text.
    assert.ok(await until(() => settled() !== '(settling…)'));
    const first = [{ role: 'status', text: '2 open' }, { role: 'list', children: [{ role: 'listitem', text: 'write the docs' }, { role: 'listitem', text: 'ship it' }] }, { role: 'note', text: 'owner: Ada' }];
    assert.deepEqual(JSON.parse(settled()), first);
    assert.deepEqual(live(), first);
    page.click('Add a task');
    page.click('Complete the first');
    assert.deepEqual(tasks(live()), ['2 open', 'ship it', 'task 3']);
    page.dispose();
  });
});

describe('workers', () => {
  it('runs the Remote application in a worker root over a port', async (/** @type {import('node:test').TestContext} */ t) => {
    /** Each worker's end: its session and both ports, closed whatever the test did. @type {(() => void)[]} */
    const ends = [];
    const worker = (/** @type {string} */ id) => {
      const { port1, port2 } = new MessageChannel();
      const session = serve(() => <Remote />, { port: port1, root: Root(id) });
      const end = () => {
        session.close();
        port1.close();
        port2.close();
      };
      ends.push(end);
      return Object.assign(port2, { terminate: end });
    };
    const page = open(workers.View, { worker, isolated: true });
    after(t, () => {
      page.dispose();
      for (const end of ends) end();
    });
    await driveWorker(page);
  });
});

/** The worker demo's steps, over the port. @param {ReturnType<typeof open>} page */
async function driveWorker(page) {
  {
    const host = () => page.all('[data-ren-root="worker-app"]')[0];
    assert.ok(await until(() => host()?.textContent.includes('worker root "worker-app", props: from the main thread')));
    assert.equal(host().querySelectorAll('[data-ren="Label"]').length, ROWS + 3);
    // The rows scroll inside a region of their own height, not the page.
    const region = host().querySelector('[data-ren="Scroll"]');
    assert.equal(region.querySelectorAll('[data-ren="Label"]').length, ROWS);
    assert.equal(region.style.getPropertyValue('height'), '160px');
    assert.equal(region.style.getPropertyValue('overflow'), 'auto');
    assert.ok(Number(value(page, 'messages applied')) >= 1);
    assert.equal(value(page, 'shared mailbox'), 'on: the page is cross-origin isolated');
    page.type(page.all('input')[0], 'changed');
    assert.ok(await until(() => host().textContent.includes('props: changed')));
    const edit = host().querySelector('input');
    edit.value = 'typed';
    edit.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    assert.ok(await until(() => host().textContent.includes('echo: typed')));
    [...host().querySelectorAll('button')].find(b => b.textContent === 'Save and tell the parent').click();
    assert.ok(await until(() => page.log().includes('the worker saved "typed"')));
    [...host().querySelectorAll('button')].find(b => b.textContent === 'Start a background burst').click();
    assert.ok(await until(() => host().textContent.includes('row 0 · burst 3')));
    [...host().querySelectorAll('button')].find(b => b.textContent === 'Stop the burst').click();
    assert.ok(Number(value(page, 'from the low lane')) > 0, 'the burst crossed in the low lane');
    page.click('Terminate the worker');
    assert.equal(page.all('[data-ren-root="worker-app"]').length, 0);
  }
}

describe('compiler and table', () => {
  it('shows the sample and its compiled output', () => {
    const page = open(compiler.View, { sources: { 'compiler:input': 'IN', 'compiler:output': 'OUT' }, mode: 'compiled' });
    assert.equal(page.all('pre.code')[0].textContent, 'OUT');
    page.click('Input');
    assert.equal(page.all('pre.code')[0].textContent, 'IN');
    assert.ok(page.text().includes('compiled templates (ren-core/esbuild)'));
    page.dispose();
  });

  it('runs the keyed table operations, async loads and background clears', async () => {
    const page = open(table.View, { pace: PACE });
    const rows = () => page.all('tbody tr');
    page.click('Make 1,000 rows');
    assert.equal(rows().length, 1000);
    assert.match(page.text(), /Make 1,000 rows: [\d.]+ ms \(1000 rows\)/);
    const [second, last] = [rows()[1], rows()[998]];
    page.click('Trade rows 2 and 999');
    assert.equal(rows()[1], last);
    assert.equal(rows()[998], second);
    page.click('Mark every tenth row');
    assert.ok(rows()[0].textContent.endsWith('(marked)×'));
    rows()[5].querySelector('a').click();
    assert.equal(rows()[5].className, 'chosen');
    const next = rows()[6];
    rows()[5].querySelector('.remove').click();
    assert.equal(rows().length, 999);
    assert.equal(rows()[5], next, 'removing a row moves nothing else');
    page.click('Add 1,000 more');
    assert.equal(rows().length, 1999);
    page.click('Empty the table');
    assert.equal(rows().length, 0, 'the nodes went in the handler');
    assert.ok(await until(() => /\d+ slices, longest [\d.]+ ms, freed after [\d.]+ ms/.test(value(page, 'last background drain'))), 'the 1,999 rows were freed in the background');
    page.click('Load 1,000 rows (async)');
    assert.ok(page.text().includes('Loading 1,000 rows…'));
    assert.ok(await until(() => rows().length === 1000));
    assert.ok(await until(() => page.texts('[data-ren="Label"]').some(l => /^Load 1,000 rows \(async\): [\d.]+ ms from the click/.test(l))));
    page.dispose();
  });
});

describe('shell', () => {
  it('sizes a canvas to its box: the measured width resizes the renderer, once per change and not at first', () => {
    /** @type {((entries: any[]) => void)[]} */
    const observers = [];
    /** @type {number[][]} */
    const resized = [];
    /** @type {any} */
    let box = null;
    const Fit = () => {
      const R = $active();
      const fit = measure(R, 680);
      follow(R, { resize: (/** @type {number} */ w, /** @type {number} */ h) => void resized.push([w, h]) }, () => [Math.min(680, fit.width()), 100]);
      // happy-dom's ResizeObserver never reports: a fake one, installed before the box is measured (ren-dom's, through $resizes).
      const ref = (/** @type {any} */ el) => {
        box = el;
        el.ownerDocument.defaultView.ResizeObserver = class {
          /** @param {(entries: any[]) => void} report */
          constructor(report) {
            observers.push(report);
          }
          observe() {}
          unobserve() {}
          disconnect() {}
        };
        fit.ref(el);
      };
      return (
        <div class="fit" ref={ref}>
          {() => `${fit.width()} wide`}
        </div>
      );
    };
    const page = open(() => <Fit />);
    const report = (/** @type {number} */ width) => observers[0]([{ target: box, borderBoxSize: [{ inlineSize: width, blockSize: 20 }] }]);
    assert.equal(observers.length, 1, 'observed through ren-dom');
    assert.equal(page.all('.fit')[0].textContent, '680 wide', 'the fallback until measured');
    assert.deepEqual(resized, [], 'made at its size: nothing to resize');
    report(316.6);
    assert.equal(page.all('.fit')[0].textContent, '316 wide');
    report(316.2);
    report(1200);
    assert.deepEqual(resized, [[316, 100], [680, 100]], 'whole pixels, capped, once per change');
    page.dispose();
  });

  it('lists every section, opens each one and disposes the previous', () => {
    const page = open(() => <App start="#signals" />);
    const links = page.all('nav a');
    assert.deepEqual(links.map(a => a.getAttribute('href')), sections.map(s => `#${s.id}`));
    assert.deepEqual(sections.slice(1 + apps.length).map(s => s.id), demos.map(d => d.id), 'the demos after home and the applications');
    for (const section of sections) {
      page.all('nav a').find(a => a.getAttribute('href') === `#${section.id}`).click();
      assert.equal(page.all('article')[0].getAttribute('data-demo'), section.id);
      assert.equal(page.all('nav a.here')[0].getAttribute('href'), `#${section.id}`);
    }
    page.dispose();
  });

  it('opens the sections as a drawer from the menu button: a page, Escape, the backdrop or the button close it', async () => {
    const page = open(() => <App start="#signals" />);
    const menu = page.all('button.menu')[0];
    const shell = () => page.all('.shell')[0];
    const html = page.document.documentElement;
    const shown = () => shell().classList.contains('drawer-open');
    assert.equal(menu.getAttribute('aria-controls'), page.all('nav')[0].id, 'the button controls the nav');
    assert.equal(menu.getAttribute('aria-expanded'), 'false');
    menu.click();
    assert.ok(shown());
    assert.equal(menu.getAttribute('aria-expanded'), 'true');
    assert.ok(html.classList.contains('drawer-open'), 'the page behind does not scroll');
    await Promise.resolve();
    assert.ok(page.document.activeElement === page.all('nav a.here')[0], 'the focus moves to the current section');
    // Choosing a section goes there and closes.
    page.all('nav a').find(a => a.getAttribute('href') === '#stores').click();
    assert.equal(page.all('article')[0].getAttribute('data-demo'), 'stores');
    assert.ok(!shown() && !html.classList.contains('drawer-open'));
    // Escape closes and gives the focus back to the button.
    menu.click();
    page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!shown());
    assert.ok(page.document.activeElement === menu, 'the menu takes the focus');
    // The backdrop, the drawer's own close button and the menu button again.
    for (const close of [() => page.all('.scrim')[0].click(), () => page.all('.drawer-head .close')[0].click(), () => menu.click()]) {
      menu.click();
      assert.ok(shown());
      close();
      assert.ok(!shown());
      assert.equal(menu.getAttribute('aria-expanded'), 'false');
    }
    page.dispose();
  });

  it('steps to the very next section, not the one after', () => {
    const page = open(() => <App start="#signals" />);
    const at = () => page.all('article')[0].getAttribute('data-demo');
    const order = [at()];
    for (let i = 0; i < 3; i++) {
      const link = page.all('.step.next')[0];
      const event = new page.window.MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);
      // The browser would follow the link's href as it is after the click.
      assert.ok(event.defaultPrevented, 'the step does not also follow its href');
      order.push(at());
    }
    assert.equal(new Set(order).size, 4);
    page.all('.step')[0].click();
    assert.equal(at(), order[2], 'previous goes back one');
    page.dispose();
  });

  it('opens on the home page: its applications and feature pillars lead to their sections', () => {
    const page = open(() => <App />);
    assert.equal(page.all('article')[0].getAttribute('data-demo'), 'home');
    assert.equal(page.all('.app-card').length, apps.length);
    const reading = () => page.all('.live output')[0].textContent;
    assert.equal(reading(), '21 °C · 69.8 °F');
    page.all('.live button')[1].click();
    assert.equal(reading(), '22 °C · 71.6 °F', 'the live sample runs');
    page.all('.pillar').find(a => a.getAttribute('href') === '#workers').click();
    assert.equal(page.all('article')[0].getAttribute('data-demo'), 'workers');
    page.dispose();
  });

  it('jumps anywhere from the command palette: Ctrl+K, filter, arrows and Enter', async () => {
    const page = open(() => <App />);
    const key = (/** @type {any} */ target, /** @type {string} */ k, /** @type {object} */ more = {}) => target.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
    // A shortcut an application took (its own palette) stays its own.
    const take = (/** @type {any} */ e) => e.preventDefault();
    page.document.addEventListener('keydown', take);
    key(page.document, 'k', { ctrlKey: true, cancelable: true });
    assert.ok(page.document.querySelector('.palette-input') === null, 'no shell palette over the application\'s');
    page.document.removeEventListener('keydown', take);
    key(page.document, 'k', { ctrlKey: true });
    const input = page.document.querySelector('.palette-input');
    assert.ok(input, 'the palette opened');
    await Promise.resolve();
    assert.ok(page.document.activeElement === input, 'its field takes the focus');
    assert.equal(input.hasAttribute('autofocus'), false, 'by its ref: the browser refuses autofocus once something has the focus, and logs it');
    input.value = 'tide';
    input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    assert.deepEqual([...page.document.querySelectorAll('.palette-list li span')].map(s => s.textContent), ['Theme: Tide']);
    key(input, 'Enter');
    assert.equal(page.all('.shell')[0].getAttribute('data-theme'), 'tide');
    key(page.document, 'k', { metaKey: true });
    const again = page.document.querySelector('.palette-input');
    again.value = 'worker runtime';
    again.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    key(again, 'Enter');
    assert.equal(page.all('article')[0].getAttribute('data-demo'), 'workers');
    assert.ok(page.document.querySelector('.palette') === null, 'going closes it');
    page.dispose();
  });

  it("gives every theme readable text and a highlight in its accent's hue, that stands out from its surface and carries the accent's text", () => {
    // A highlight in the page's color or a gray makes a selected item's accent text look out of place.
    const lum = (/** @type {string} */ hex) => {
      const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (/** @type {string} */ a, /** @type {string} */ b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const t of THEMES) {
      const c = t.colors;
      const soft = c.accentSoft;
      for (const back of [c.canvas, c.surface, c.raised]) {
        assert.ok(contrast(c.ink, back) >= 7, `${t.id}: text on ${back}`);
        assert.ok(contrast(c.muted, back) >= 4.5, `${t.id}: secondary text on ${back}`);
        assert.ok(contrast(c.accent, back) >= 4.5, `${t.id}: the accent on ${back}`);
      }
      assert.ok(contrast(c.accentInk, c.accent) >= 4.5, `${t.id}: text on the accent`);
      assert.ok(contrast(soft, c.surface) >= 1.1, `${t.id}: the highlight stands out from the surface (${contrast(soft, c.surface).toFixed(2)})`);
      assert.ok(contrast(c.accent, soft) >= 2.5, `${t.id}: the accent reads on its highlight (${contrast(c.accent, soft).toFixed(2)})`);
      assert.notEqual(soft, c.canvas, `${t.id}: not the page's color`);
    }
  });

  it('switches among the themes on the fly: the page, ren tokens and nested roots follow, and the choice is kept', () => {
    const page = open(() => <App start="#roots" theme="tonal" />);
    const shell = () => page.all('.shell')[0];
    const html = page.document.documentElement;
    const swatches = page.all('.swatch');
    assert.deepEqual(swatches.map(b => b.getAttribute('data-theme-id')), [...THEMES.filter(t => !t.dark), ...THEMES.filter(t => t.dark)].map(t => t.id), 'light, then dark');
    assert.ok(THEMES.some(t => t.id === 'lired') && THEMES.some(t => t.id === 'tonal-dark'));
    assert.equal(shell().style.getPropertyValue('--accent'), THEMES[0].colors.accent);
    assert.equal(html.getAttribute('data-theme'), 'tonal');
    const shadowAccent = () => page.all('[data-ren-root="note-shadow"]')[0].style.getPropertyValue('--ren-accent');
    const before = shadowAccent();
    for (const t of THEMES.slice(1)) {
      page.all('.swatch').find(b => b.getAttribute('data-theme-id') === t.id).click();
      assert.equal(shell().getAttribute('data-theme'), t.id);
      assert.equal(shell().style.getPropertyValue('--accent'), t.colors.accent, 'the page tokens');
      assert.equal(shell().style.getPropertyValue('--ren-accent'), color(argb(t.colors.accent)), 'the ren tokens (ren-dom\'s color of each), nearer than the root host');
      assert.equal(html.getAttribute('data-theme'), t.id, 'the document outside the shell');
      assert.equal(html.style.colorScheme, t.dark ? 'dark' : 'light');
      assert.equal(page.all('.swatch.on').map(b => b.getAttribute('data-theme-id')).join(), t.id);
    }
    assert.notEqual(shadowAccent(), before, 'the nested root was made again with the new theme');
    assert.equal(page.window.localStorage.getItem('ren-show:theme'), THEMES.at(-1)?.id);
    page.dispose();
  });
});


describe('input', () => {
  it('hears root-wide keys, focuses the composer, and follows the pinned note on the DOM, Skia and three.js', async () => {
    const { load } = threeStub();
    const page = open(input.View, { three: load, skia: async () => ({ kit, font }) });
    try {
      const host = (/** @type {string} */ id) => page.all(`[data-ren-root="board-${id}"]`)[0];
      assert.ok(await until(() => ['dom', 'skia', 'three'].every(id => host(id) !== undefined && host(id).textContent.includes(`On ${id}:`))), page.text());
      // The DOM board: a key with nothing focused reaches its root's $keys.
      const dom = host('dom');
      const press = (/** @type {any} */ target, /** @type {string} */ key) => target.dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      press(page.document.body, 'n');
      assert.ok(dom.textContent.includes('Note 14') && dom.textContent.includes('key n'), dom.textContent);
      // "/" focuses the composer's field ($focus); a key typed there is the field's.
      press(page.document.body, '/');
      const field = dom.querySelector('input');
      assert.equal(page.document.activeElement, field);
      press(field, 'n');
      assert.ok(!dom.textContent.includes('Note 15'), 'a key typed in a field adds nothing');
      // Skia: its canvas routes the root's keys and the wheel.
      const skia = host('skia');
      const canvas = skia.querySelector('canvas');
      const fire = (/** @type {string} */ type, /** @type {Record<string, unknown>} */ fields) => {
        const event = new page.window.Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, fields);
        canvas.dispatchEvent(event);
      };
      fire('keydown', { key: 'n' });
      assert.ok(await until(() => skia.textContent.includes('Note 14') && skia.textContent.includes('key n')), skia.textContent);
      assert.ok(skia.textContent.includes('The pinned note is below'));
      // Scrolled into view, then past it: its moves and the root's scrolls say where it went.
      fire('wheel', { offsetX: 100, offsetY: 120, deltaY: 100, deltaX: 0, deltaMode: 0 });
      assert.ok(await until(() => skia.textContent.includes('The pinned note is in view')), skia.textContent);
      assert.match(skia.textContent, /scrolls [1-9]/);
      fire('wheel', { offsetX: 100, offsetY: 120, deltaY: 300, deltaX: 0, deltaMode: 0 });
      assert.ok(await until(() => skia.textContent.includes('The pinned note is above')), skia.textContent);
    } finally {
      page.dispose();
    }
  });
});

describe('render', () => {
  it('renders the ticket with each renderer\'s render, shares one Locker, and writes its static page', async () => {
    const { load, drawer } = threeStub();
    // A lock manager as Web Locks answers ifAvailable: the callback gets null while the name is held.
    /** @type {Set<string>} */
    const held = new Set();
    const locks = {
      /** @param {string} name @param {any} options @param {(lock: any) => any} callback */
      request(name, options, callback) {
        if (held.has(name) && options.ifAvailable) return Promise.resolve(callback(null));
        held.add(name);
        return Promise.resolve(callback({ name })).finally(() => held.delete(name));
      },
      query: async () => ({ held: [...held].map(name => ({ name })), pending: [] }),
    };
    const page = open(render.View, { three: load, skia: async () => ({ kit, font }), locks });
    try {
      const pane = (/** @type {string} */ id) => page.all(`[data-target="${id}"]`)[0];
      assert.ok(pane('dom').textContent.includes('Hall B · row 4 · seat 12'));
      assert.ok(await until(() => /^\d+ commands, [1-9]\d* texts$/.test(value(page, "Skia's last frame (decoded)") ?? '')), page.text());
      assert.equal(pane('skia').querySelectorAll('canvas').length, 1);
      assert.ok(await until(() => drawer.frames > 0), 'three.js draws its scene');
      // Holding the seat takes the box office's lock; the query lists it without the root's prefix.
      const hold = pane('dom').querySelector('button');
      hold.click();
      assert.ok(await until(() => pane('dom').textContent.includes('held here')));
      assert.deepEqual([...held], ['ren:box-office:seat-4-12']);
      page.click('Which locks are held?');
      assert.ok(await until(() => value(page, 'locks held (Locker query)') === 'seat-4-12'));
      hold.click();
      assert.ok(await until(() => held.size === 0 && pane('dom').textContent.includes('free')));
      // The static page: ren-dom's markup inside a page built with ren-html's Document.
      page.click('Make the page');
      const markup = page.all('[data-page]')[0].textContent;
      assert.ok(markup.startsWith('<!doctype html>\n<html lang="en"><head><title>Evening concert: your ticket</title><meta name="theme-color" content="rgba('), markup.slice(0, 200));
      assert.ok(markup.includes('<span data-ren="Label"') && markup.includes('Hall B · row 4 · seat 12') && markup.endsWith('</body></html>'));
    } finally {
      page.dispose();
    }
  });
});
