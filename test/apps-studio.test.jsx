// Studio (src/apps/studio): one document drawn by a Skia root (headless
// CanvasKit, read back through its pixels), the DOM panels and a three.js
// root (real three.js scenes, a drawer stub for WebGL), and exported by
// ren-html and ren-json. The tests drive it as a person would: pointer
// gestures on the canvas, keys, the toolbar, layers and inspector.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { $signal, $write, $read, $raw, $root, $dispose } from 'rrx-core';
import { $active } from 'ren-core';
import { loadLayout } from 'ren-skia';
import { Sfnt, remoteLayout, serveLayout } from 'ren-canv';
import { open, after } from './page.jsx';
import studio, { WIDTH, HEIGHT } from '../src/apps/studio/index.jsx';
import { Editor } from '../src/apps/studio/editor.js';
import { seed, bounds, snap, resize, hits, pick, paint, extent, shown } from '../src/apps/studio/document.js';
import { THEMES, Look, argb } from '../src/themes.js';

// Each WebAssembly memory reserves its whole range up front; at most 1 GB
// each, Taffy's and CanvasKit's fit the machine's address cap.
setFlagsFromString('--wasm-max-mem-pages=16384');
await loadLayout();

const font = readFileSync(fileURLToPath(import.meta.resolve('ren-skia/font.ttf')));
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
const until = async (check, ms = 3000) => {
  // timer: poll, a bounded re-check of the page's state
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 5))) if (check()) return true;
  return check();
};

/** three.js in node: the scene graph is real, a stub stands in for WebGL. */
const threeStub = () => {
  const drawer = { frames: 0, render: () => void drawer.frames++, setSize: () => {}, dispose: () => {} };
  return async () => ({ THREE, renderer: drawer, font });
};

/**
 * Opens Studio with CanvasKit, three.js and (optionally) a layout engine,
 * and waits for both roots. Returns the page, the renderers as they are
 * made, the editor and ways to drive the canvas.
 * @param {{ engine?: any, themed?: boolean, pace?: number }} [options]
 */
async function studioPage(options = {}) {
  /** @type {{ skia: any[], three: any[], studio: any }} */
  const made = { skia: [], three: [], studio: null };
  const probe = (/** @type {'skia' | 'three'} */ which, /** @type {any} */ renderer, /** @type {any} */ editor) => {
    made[which].push(renderer);
    made.studio = editor;
  };
  /** @type {any} */
  let theme = null;
  const View = studio.View;
  const Themed = () => {
    theme = $signal($active(), THEMES[0]);
    return (
      <Look value={theme}>
        <View probe={probe} />
      </Look>
    );
  };
  const page = open(options.themed ? Themed : () => <View probe={probe} />, { skia: async () => ({ kit, font }), three: threeStub(), engine: options.engine ?? null, pace: options.pace ?? 0.05 });
  assert.ok(await until(() => page.all('[data-ren-root="studio-canvas"] canvas').length === 1 && page.all('[data-ren-root="studio-preview"]').length === 1), 'both roots render');
  const canvas = () => page.all('[data-ren-root="studio-canvas"] canvas')[0];
  const skia = () => made.skia.at(-1);
  const editor = () => made.studio;
  /** Dispatches a pointer event on the canvas at a screen point. @param {string} type @param {number} x @param {number} y @param {Record<string, any>} [extra] */
  const pointer = (type, x, y, extra = {}) => {
    const event = new page.window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { offsetX: x, offsetY: y, button: 0, pointerId: 1, detail: 1, shiftKey: false, ...extra });
    canvas().dispatchEvent(event);
    return event;
  };
  /** A drag from one screen point to another, in steps. @param {number[]} from @param {number[]} to @param {Record<string, any>} [extra] */
  const drag = (from, to, extra = {}, steps = 4) => {
    pointer('pointerdown', from[0], from[1], extra);
    for (let i = 1; i <= steps; i++) pointer('pointermove', from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, extra);
    pointer('pointerup', to[0], to[1], extra);
  };
  /** A key on the canvas. @param {string} key @param {Record<string, any>} [mods] */
  const key = (key, mods = {}) => {
    const event = new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
    canvas().dispatchEvent(event);
    page.window.document.dispatchEvent(new page.window.Event('noop'));
    canvas().dispatchEvent(new page.window.KeyboardEvent('keyup', { key, bubbles: true }));
    return event;
  };
  /** A document point on the screen. @param {number} x @param {number} y */
  const screen = (x, y) => {
    const c = $read(editor().camera);
    return [x * c.zoom + c.x, y * c.zoom + c.y];
  };
  /** The screen centre of a shape. @param {string} id */
  const centre = id => {
    const b = bounds(editor().shape(id));
    return screen(b.x + b.w / 2, b.y + b.h / 2);
  };
  /** The canvas's pixel at a screen point, painted. @param {number[]} at */
  const pixel = at => {
    skia().present();
    return skia().pixel(Math.round(at[0]), Math.round(at[1])) >>> 0;
  };
  /** A theme token's ARGB in the first theme. @param {string} token */
  const tokenColor = token => argb(/** @type {string} */ (paint(THEMES[0].colors, token)));
  /** The inspector's numeric field of a label. @param {string} label */
  const field = label => page.all('.inspector label.num').find(l => l.querySelector('span').textContent === label)?.querySelector('input');
  const layers = () => page.all('.layers li').map(li => li.getAttribute('data-id'));
  return { page, made, canvas, skia, editor, pointer, drag, key, screen, centre, pixel, tokenColor, field, layers, setTheme: (/** @type {any} */ t) => $write(theme, t) };
}

describe('studio document', () => {
  it('hits, resizes and snaps in document units', () => {
    const doc = seed();
    const bar = doc.shapes['bar-0'];
    assert.ok(hits(bar, bar.x + 1, bar.y + 1, 0));
    assert.ok(!hits(bar, bar.x - 2, bar.y, 0));
    assert.equal(pick(doc, bar.x + 10, bar.y + 10, 0), 'bar-0', 'the bar is above the frame');
    assert.equal(pick(doc, 280, 250, 0), 'frame', 'the frame under empty space inside it');
    assert.equal(pick(doc, -50, -50, 0), null);
    // A turned note is hit in its own frame, not its bounds.
    const note = doc.shapes.note;
    assert.ok(hits(note, note.x + note.w / 2, note.y + note.h / 2, 0));
    assert.deepEqual(resize({ x: 0, y: 0, w: 100, h: 50 }, 'se', 120, 70), { x: 0, y: 0, w: 120, h: 70 });
    assert.deepEqual(resize({ x: 0, y: 0, w: 100, h: 50 }, 'w', 130, 0), { x: 100, y: 0, w: 30, h: 50 }, 'dragged past its opposite edge, it flips');
    const s = snap({ x: 27, y: 200, w: 40, h: 40 }, [{ x: 24, y: 0, w: 100, h: 50 }], 5);
    assert.equal(s.dx, -3);
    assert.equal(s.dy, 0);
    assert.deepEqual(s.guides[0], { axis: 'x', at: 24, from: 0, to: 240 });
    assert.equal(snap({ x: 40, y: 200, w: 40, h: 40 }, [{ x: 24, y: 0, w: 100, h: 50 }], 5).guides.length, 0, 'nothing within reach');
  });

  it('keeps the view’s centre when the canvas takes a new size (a narrower page)', () => {
    const R = $root('studio-size');
    const studio = Editor(R, { now: () => 0, width: WIDTH, height: HEIGHT });
    studio.fit();
    const c = $read(studio.camera);
    // The document point at the canvas's centre, before and after.
    const centre = (/** @type {number} */ w, /** @type {number} */ h) => {
      const k = $read(studio.camera);
      return [(w / 2 - k.x) / k.zoom, (h / 2 - k.y) / k.zoom];
    };
    const before = centre(WIDTH, HEIGHT);
    studio.setSize(336, HEIGHT);
    assert.deepEqual([studio.width, studio.height], [336, HEIGHT]);
    assert.equal($read(studio.camera).zoom, c.zoom, 'the zoom stays');
    assert.deepEqual(centre(336, HEIGHT), before);
    $dispose(R);
  });
});

describe('studio', () => {
  it('draws the starter design on the canvas, fitted, beside the layers, inspector, 3D preview and export', async () => {
    const s = await studioPage();
    try {
      const doc = seed();
      assert.deepEqual(s.layers(), [...doc.order].reverse(), 'the layers, topmost first');
      assert.ok(s.page.text().includes('Design'), 'the inspector shows the document with nothing selected');
      // The canvas paints each shape in the theme's palette.
      assert.equal(s.pixel(s.centre('bar-5')), s.tokenColor('series-4'));
      assert.equal(s.pixel(s.centre('bar-1')), s.tokenColor('series-1'));
      assert.equal(s.pixel(s.centre('header').map((v, i) => v + (i === 0 ? 120 : 0))), s.tokenColor('series-0'));
      // The turned sticky note is a Shape path (below its text), in the theme's quiet fill.
      assert.equal(s.pixel(s.screen(680, 138)), s.tokenColor('soft'));
      // The fit leaves the whole design in view.
      const c = $read(s.editor().camera);
      assert.ok(c.zoom > 0.5 && c.zoom < 1, `zoom ${c.zoom}`);
      // The 3D preview: a mesh or panel per shape.
      const scene = s.made.three[0].scene;
      assert.ok(scene.getObjectByName('rect bar-0'), 'bars are slabs');
      assert.ok(scene.getObjectByName('ellipse avatar'), 'the avatar is a disc');
      assert.ok(scene.getObjectByName('arrow pointer'), 'the arrow is a shaft and a cone');
      assert.ok(scene.getObjectByName('text title'), 'text is a panel');
      // The model sways with $animate until paused.
      const model = scene.getObjectByName('rect bar-0').parent;
      const sway = model.rotation.y;
      assert.ok(await until(() => model.rotation.y !== sway), 'it sways');
      s.page.click('Pause');
      const paused = model.rotation.y;
      // The frame loop keeps running (the sway stays registered): watch a few frames.
      const three = s.made.three[0];
      const from = three.frames;
      assert.ok(await until(() => three.frames >= from + 5), 'frames run while paused');
      assert.equal(model.rotation.y, paused, 'paused');
      s.page.click('Orbit');
      // The export: HTML from ren-html, once the edits pause.
      assert.ok(await until(() => (s.page.all('.export pre.code')[0]?.textContent ?? '').includes('data-shape')));
      const html = s.page.all('.export pre.code')[0].textContent;
      assert.ok(html.startsWith('<div data-ren-root="studio-export"'));
      assert.ok(html.includes('Weekly revenue') && html.includes('data-name="Bar 6"'));
    } finally {
      s.page.dispose();
    }
  });

  it('selects on a press, drags with snapping guides, and the inspector, layers and 3D follow; one undo step', async () => {
    const s = await studioPage();
    try {
      const ed = s.editor();
      s.drag(s.centre('bar-0'), s.centre('bar-0'), {}, 1);
      assert.deepEqual($read(ed.selection), ['bar-0']);
      assert.equal(s.page.all('.layers li.on')[0].getAttribute('data-id'), 'bar-0', 'the layer row is selected');
      assert.equal(s.field('X').value, '48');
      // Drag it left by 22 units: its left edge comes within reach of the
      // card's (24) and snaps there, with a guide while dragging.
      const zoom = $read(ed.camera).zoom;
      const [x0, y0] = s.centre('bar-0');
      s.pointer('pointerdown', x0, y0);
      s.pointer('pointermove', x0 - 11 * zoom, y0 + 40 * zoom);
      s.pointer('pointermove', x0 - 22 * zoom, y0 + 40 * zoom);
      assert.equal(ed.shape('bar-0').x, 24, 'snapped to the card edge');
      assert.ok($read(ed.guides).some((/** @type {any} */ g) => g.axis === 'x' && g.at === 24), 'a guide shows the edge');
      s.pointer('pointerup', x0 - 22 * zoom, y0 + 40 * zoom);
      assert.deepEqual($read(ed.guides), []);
      assert.equal(s.field('X').value, '24', 'the inspector follows the canvas');
      assert.equal(s.field('Y').value, String(Math.round(ed.shape('bar-0').y * 10) / 10));
      // The canvas repainted the bar at its new place.
      assert.equal(s.pixel(s.centre('bar-0')), s.tokenColor('series-1'));
      // The mesh moved too.
      const mesh = s.made.three[0].scene.getObjectByName('rect bar-0');
      const middle = /** @type {any} */ (extent(shown($raw(ed.doc))));
      assert.ok(Math.abs(mesh.position.x - (24 + 22 - (middle.x + middle.w / 2)) * 0.01) < 1e-9, 'the mesh follows');
      // One gesture, one undo step.
      assert.equal($read(ed.history.past).length, 1);
      s.key('z', { ctrlKey: true });
      assert.equal(ed.shape('bar-0').x, 48);
      assert.equal(s.field('X').value, '48');
      s.key('Z', { ctrlKey: true, shiftKey: true });
      assert.equal(ed.shape('bar-0').x, 24, 'redo');
      // A frame carries what it holds.
      s.key('Escape');
      s.drag(s.screen(280, 250), s.screen(280, 250), {}, 1);
      assert.deepEqual($read(ed.selection), ['frame']);
      const [fx, fy] = s.screen(280, 250);
      s.drag([fx, fy], [fx + 30 * zoom, fy]);
      const dx = ed.shape('frame').x;
      assert.ok(dx > 20, `moved by ${dx}`);
      assert.deepEqual([ed.shape('bar-1').x, ed.shape('title').x].map(v => Math.round((v - dx) * 1000) / 1000), [48 + 84, 24], 'its contents by as much');
      assert.equal(ed.shape('note').x, 600, 'the note outside it stays');
    } finally {
      s.page.dispose();
    }
  });

  it('edits in the inspector redraw the canvas and the 3D model at once', async () => {
    const s = await studioPage();
    try {
      const ed = s.editor();
      s.drag(s.centre('avatar'), s.centre('avatar'), {}, 1);
      const before = s.centre('avatar');
      s.page.type(s.field('X'), '400');
      s.page.type(s.field('Y'), '200');
      assert.deepEqual([ed.shape('avatar').x, ed.shape('avatar').y], [400, 200]);
      assert.equal(s.pixel(s.centre('avatar')), s.tokenColor('series-3'), 'drawn at the new place');
      assert.notEqual(s.pixel(before), s.tokenColor('series-3'), 'and gone from the old');
      // A fill swatch from the theme's series.
      s.page.all('.inspector .swatch[data-token="series-5"]')[0].click();
      assert.equal(ed.shape('avatar').fill, 'series-5');
      assert.equal(s.pixel(s.centre('avatar')), s.tokenColor('series-5'));
      const disc = s.made.three[0].scene.getObjectByName('ellipse avatar').children[0];
      assert.equal(`#${disc.material.color.getHexString()}`, THEMES[0].colors.series[5]);
      // Typing a field is one undo step, however many keystrokes.
      const steps = $read(ed.history.past).length;
      s.page.type(s.field('W'), '4');
      s.page.type(s.field('W'), '48');
      assert.equal(ed.shape('avatar').w, 48);
      assert.equal($read(ed.history.past).length, steps + 1);
      // Text: the layer's text is drawn on the canvas and in its mirror.
      s.drag(s.centre('title'), s.centre('title'), {}, 1);
      const text = s.page.all('.inspector textarea')[0];
      // A double click on the text layer edits its text.
      s.pointer('dblclick', ...s.centre('title'));
      assert.ok(s.page.document.activeElement === text, 'the text field takes the focus');
      s.page.type(text, 'Monthly revenue');
      assert.equal(ed.shape('title').text, 'Monthly revenue');
      assert.ok(await until(() => s.page.all('[data-ren-root="studio-canvas"]')[0].textContent.includes('Monthly revenue')), 'the accessibility mirror has the new text');
    } finally {
      s.page.dispose();
    }
  });

  it('creates shapes with the tools, selects with a marquee, aligns, resizes by a handle', async () => {
    const s = await studioPage();
    try {
      const ed = s.editor();
      const count = ed.at(['order']).length;
      // Rectangle tool: a drag makes one; the tool goes back to select.
      s.page.all('.bar button[data-tool="rect"]')[0].click();
      assert.equal(s.page.all('.stage')[0].getAttribute('data-tool'), 'rect');
      s.drag(s.screen(100, 420), s.screen(180, 470));
      const made = $read(ed.selection)[0];
      assert.equal(ed.shape(made).kind, 'rect');
      assert.deepEqual([ed.shape(made).x, ed.shape(made).y, ed.shape(made).w, ed.shape(made).h].map(Math.round), [100, 420, 80, 50]);
      assert.equal($read(ed.tool), 'select');
      assert.equal(s.layers()[0], made, 'on top of the layers');
      // A drag the browser takes back (a touch it scrolls with) ends there: later moves size nothing.
      s.page.all('.bar button[data-tool="rect"]')[0].click();
      s.pointer('pointerdown', ...s.screen(220, 420));
      s.pointer('pointermove', ...s.screen(260, 450));
      s.pointer('pointercancel', ...s.screen(260, 450));
      const cut = $read(ed.selection)[0];
      s.pointer('pointermove', ...s.screen(330, 480));
      assert.deepEqual([ed.shape(cut).w, ed.shape(cut).h].map(Math.round), [40, 30], 'the cancelled drag ended where it was');
      assert.equal($read(ed.tool), 'select', 'the gesture ended');
      s.key('z', { ctrlKey: true });
      assert.equal(ed.shape(cut), undefined, 'one undo step takes it back');
      // A click with the ellipse tool makes a standard one.
      s.key('o');
      s.drag(s.screen(300, 430), s.screen(300, 430), {}, 1);
      assert.equal(ed.shape($read(ed.selection)[0]).w, 96);
      // Text and arrow tools.
      s.key('t');
      // An empty spot in view (a press off the canvas reaches nothing on it).
      s.drag(s.screen(-40, 20), s.screen(-40, 20), {}, 1);
      assert.equal(ed.shape($read(ed.selection)[0]).text, 'Text');
      s.key('a');
      s.drag(s.screen(-40, 100), s.screen(20, 160));
      const arrow = ed.shape($read(ed.selection)[0]);
      assert.deepEqual([arrow.kind, Math.round(arrow.w), Math.round(arrow.h)], ['arrow', 60, 60]);
      assert.equal(ed.at(['order']).length, count + 4);
      // A marquee over the bars (from empty space below the frame) selects all six.
      s.key('Escape');
      s.drag(s.screen(60, 395), s.screen(480, 300));
      assert.deepEqual([...$read(ed.selection)].sort(), ['bar-0', 'bar-1', 'bar-2', 'bar-3', 'bar-4', 'bar-5'], 'the six bars, not the frame around them');
      assert.ok(s.page.text().includes('6 layers'));
      s.page.click('Align top');
      assert.equal(new Set(['bar-0', 'bar-1', 'bar-5'].map(id => ed.shape(id).y)).size, 1, 'aligned');
      // A handle resizes the one selected shape.
      // (Pressed beside its text, which lies over its centre.)
      s.drag(s.screen(30, 155), s.screen(30, 155), {}, 1);
      assert.deepEqual($read(ed.selection), ['card-0']);
      const card = ed.shape('card-0');
      s.drag(s.screen(card.x + card.w, card.y + card.h), s.screen(card.x + card.w + 60, card.y + card.h + 2));
      assert.deepEqual([ed.shape('card-0').w, Math.round(ed.shape('card-0').h)], [220, 84], 'its right edge snapped to the caption’s, its bottom to the other cards’');
      assert.equal(ed.shape('card-0').x, card.x, 'the opposite corner stays');
    } finally {
      s.page.dispose();
    }
  });

  it('deletes, duplicates, nudges, selects all and undoes from the keyboard', async () => {
    const s = await studioPage();
    try {
      const ed = s.editor();
      const count = ed.at(['order']).length;
      s.drag(s.centre('bar-2'), s.centre('bar-2'), {}, 1);
      s.key('Delete');
      assert.equal(ed.shape('bar-2'), undefined);
      assert.ok(!s.layers().includes('bar-2'));
      s.key('z', { ctrlKey: true });
      assert.ok(s.layers().includes('bar-2'), 'undo brings it back');
      s.drag(s.centre('bar-2'), s.centre('bar-2'), {}, 1);
      s.key('d', { ctrlKey: true });
      const copy = $read(ed.selection)[0];
      assert.notEqual(copy, 'bar-2');
      assert.equal(ed.shape(copy).x, ed.shape('bar-2').x + 16);
      assert.equal(ed.at(['order']).length, count + 1);
      const x = ed.shape(copy).x;
      s.key('ArrowRight');
      s.key('ArrowRight', { shiftKey: true });
      s.key('ArrowUp');
      assert.equal(ed.shape(copy).x, x + 11);
      const steps = $read(ed.history.past).length;
      s.key('ArrowLeft');
      assert.equal($read(ed.history.past).length, steps, 'nudges in a row are one step');
      s.key('a', { ctrlKey: true });
      assert.equal($read(ed.selection).length, count + 1);
      assert.ok(s.page.text().includes(`${count + 1} layers`));
      s.key('Escape');
      assert.equal($read(ed.selection).length, 0);
      // Undo everything, then redo it.
      while ($read(ed.history.past).length > 0) s.key('z', { ctrlKey: true });
      assert.deepEqual($raw(ed.doc), seed());
      assert.ok(s.page.all('.bar button[aria-label="Undo"]')[0].disabled, 'nothing left to undo');
      s.page.all('.bar button[aria-label="Redo"]')[0].click();
      assert.equal(ed.at(['order']).length, count + 1, 'the duplicate again (the delete was undone before it)');
    } finally {
      s.page.dispose();
    }
  });

  it('renames, hides, locks and reorders in the layers list', async () => {
    const s = await studioPage();
    try {
      const ed = s.editor();
      const row = (/** @type {string} */ id) => s.page.all(`.layers li[data-id="${id}"]`)[0];
      row('avatar').dispatchEvent(new s.page.window.MouseEvent('dblclick', { bubbles: true }));
      const input = row('avatar').querySelector('input');
      assert.ok(s.page.document.activeElement === input, 'the rename input is focused');
      assert.deepEqual([input.selectionStart, input.selectionEnd], [0, input.value.length], 'and its name selected');
      assert.ok(input.value.length > 0);
      s.page.type(input, 'Profile picture');
      input.dispatchEvent(new s.page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      assert.equal(ed.shape('avatar').name, 'Profile picture');
      assert.equal(row('avatar').querySelector('.name').textContent, 'Profile picture');
      // Hide: gone from the canvas, the 3D model and the export.
      const at = s.centre('avatar');
      [...row('avatar').querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Hide').click();
      assert.equal(ed.shape('avatar').hidden, true);
      assert.notEqual(s.pixel(at), s.tokenColor('series-3'));
      assert.equal(s.made.three[0].scene.getObjectByName('ellipse avatar'), undefined);
      assert.ok(await until(() => !(s.page.all('.export pre.code')[0]?.textContent ?? 'Profile picture').includes('Profile picture')), 'the export leaves it out');
      // Lock: a press does not pick a locked shape; it passes to what is below.
      s.drag(s.centre('bar-3'), s.centre('bar-3'), {}, 1);
      [...row('bar-3').querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Lock').click();
      s.key('Escape');
      s.drag(s.centre('bar-3'), s.centre('bar-3'), {}, 1);
      assert.deepEqual($read(ed.selection), ['frame'], 'the frame under the locked bar');
      // Reorder: drop the caption on the header's row, taking its place.
      const order = () => ed.at(['order']);
      const drop = order().indexOf('header');
      row('caption').dispatchEvent(new s.page.window.Event('dragstart', { bubbles: true }));
      row('header').dispatchEvent(new s.page.window.Event('drop', { bubbles: true, cancelable: true }));
      assert.equal(order().indexOf('caption'), drop);
      assert.equal(s.layers().indexOf('caption'), s.layers().length - 1 - drop);
      // Clicking a row selects; Shift adds.
      row('title').click();
      row('card-0').dispatchEvent(new s.page.window.MouseEvent('click', { bubbles: true, shiftKey: true }));
      assert.deepEqual([...$read(ed.selection)].sort(), ['card-0', 'title']);
    } finally {
      s.page.dispose();
    }
  });

  it('zooms at the pointer, pans with the wheel and space-drag, and zooms from the HUD on the canvas', async () => {
    const s = await studioPage();
    try {
      const ed = s.editor();
      const c0 = $read(ed.camera);
      const [px, py] = s.centre('bar-3');
      const doc = ed.toDoc(px, py);
      s.pointer('wheel', px, py, { deltaY: -200, deltaX: 0, ctrlKey: true });
      const c1 = $read(ed.camera);
      assert.ok(c1.zoom > c0.zoom, 'zoomed in');
      const after = ed.toDoc(px, py);
      assert.ok(Math.abs(after.x - doc.x) < 1e-6 && Math.abs(after.y - doc.y) < 1e-6, 'the point under the pointer stays');
      s.pointer('wheel', px, py, { deltaY: 30, deltaX: 10, ctrlKey: false });
      assert.deepEqual([$read(ed.camera).x, $read(ed.camera).y], [c1.x - 10, c1.y - 30], 'a plain wheel pans');
      // Space and drag pans, and selects nothing.
      const c2 = $read(ed.camera);
      s.canvas().dispatchEvent(new s.page.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
      s.drag([200, 200], [260, 230]);
      s.canvas().dispatchEvent(new s.page.window.KeyboardEvent('keyup', { key: ' ', bubbles: true }));
      assert.deepEqual([$read(ed.camera).x, $read(ed.camera).y], [c2.x + 60, c2.y + 30]);
      assert.equal($read(ed.selection).length, 0);
      // The HUD is Actions in the Skia root: its presses come back as messages.
      const hud = (/** @type {string} */ text) => [...s.page.all('[data-ren-root="studio-canvas"] button')].find(b => b.textContent === text);
      assert.ok(await until(() => hud('Fit') !== undefined), 'the HUD is in the canvas mirror');
      hud('Fit').click();
      assert.equal($read(ed.camera).zoom, c0.zoom, 'fitted again');
      hud('+').click();
      assert.equal(Math.round($read(ed.camera).zoom * 1000), Math.round(c0.zoom * 1250));
      assert.ok(await until(() => hud(`${Math.round(c0.zoom * 125)}%`) !== undefined), 'the HUD shows the new zoom');
      // The toolbar zooms too, and the status bar follows.
      s.page.all('.bar button[aria-label="Zoom out"]')[0].click();
      assert.ok(s.page.all('.status')[0].textContent.includes(`${Math.round($read(ed.camera).zoom * 100)}%`));
      // A press on the HUD does not start a marquee or clear the selection.
      s.drag(s.centre('bar-3'), s.centre('bar-3'), {}, 1);
      hud('−').click();
      assert.deepEqual($read(ed.selection), ['bar-3']);
    } finally {
      s.page.dispose();
    }
  });

  it('exports HTML with ren-html and data with ren-json, following edits', async () => {
    const s = await studioPage();
    try {
      const code = () => s.page.all('.export pre.code')[0]?.textContent ?? '';
      assert.ok(await until(() => code().includes('data-shape')));
      s.page.click('Data · ren-json');
      assert.ok(await until(() => code().startsWith('[')));
      const data = JSON.parse(code());
      // What the design means: a figure of named shapes and its texts, no layout.
      assert.equal(data[0].role, 'figure');
      assert.equal(data[0].label, 'Studio design');
      const texts = JSON.stringify(data);
      assert.ok(texts.includes('"Weekly revenue"') && texts.includes('"roleDescription":"rectangle"'), 'the content and the shapes, as data');
      assert.ok(!texts.includes('data-'), 'no data-* hooks in the data');
      assert.ok(!texts.includes('background') && !texts.includes('margin'), 'no styles in the data');
      // An edit re-renders the export.
      const ed = s.editor();
      ed.change(['title'], { text: 'Quarterly revenue' });
      assert.ok(await until(() => code().includes('Quarterly revenue')));
      assert.ok(s.page.all('.export .meta')[0].textContent.match(/kB · [1-9]\d* nodes/));
      s.page.click('Copy');
      assert.ok(await until(() => /Copied|clipboard/.test(s.page.all('.export .meta')[0].textContent)));
    } finally {
      s.page.dispose();
    }
  });

  it('restyles the canvas and the scene in place for a new theme (setTheme), keeping every renderer and its state', async () => {
    const s = await studioPage({ themed: true });
    try {
      const ed = s.editor();
      s.drag(s.centre('bar-1'), s.centre('bar-1'), {}, 1);
      const camera = $read(ed.camera);
      const [skia, three, canvas] = [s.skia(), s.made.three[0], s.canvas()];
      const later = THEMES[2];
      s.setTheme(later);
      assert.ok(await until(() => s.pixel(s.centre('bar-1')) === argb(later.colors.series[1])), 'the design in the new palette');
      assert.equal(s.pixel(s.centre('bar-5')), argb(later.colors.series[4]));
      assert.deepEqual([s.made.skia.length, s.made.three.length], [1, 1], 'no renderer was made again');
      assert.equal(s.skia(), skia);
      assert.equal(s.canvas(), canvas, 'the same canvas element');
      assert.equal(skia.theme.accent, later.ren.accent, 'the Skia renderer took the new tokens');
      // The model recolors in place, background included.
      const slab = three.scene.getObjectByName('rect bar-1');
      assert.equal(`#${slab.material.color.getHexString()}`, later.colors.series[1]);
      assert.equal(`#${three.scene.background.getHexString()}`, later.colors.canvas);
      assert.deepEqual($read(ed.selection), ['bar-1']);
      assert.deepEqual($read(ed.camera), camera);
    } finally {
      s.page.dispose();
    }
  });

  it('shows the cursor of the tool, a handle and a selected shape, and clears the hover when the pointer leaves the board', async () => {
    const s = await studioPage();
    try {
      const ed = s.editor();
      const cursor = () => s.canvas().style.cursor;
      // Over the empty board: the select tool's arrow; a drawing tool's crosshair; the hand's grab.
      const empty = s.screen(-30, 420);
      s.pointer('pointermove', ...empty);
      assert.equal(cursor(), 'default');
      for (const [key, shown] of /** @type {const} */ ([['r', 'crosshair'], ['h', 'grab'], ['t', 'text']])) {
        s.key(key);
        s.pointer('pointermove', ...empty);
        assert.equal(cursor(), shown, key);
      }
      s.key('v');
      // Each handle of the selected card has its resize cursor, and a press on it resizes.
      s.drag(s.screen(30, 155), s.screen(30, 155), {}, 1);
      const card = ed.shape('card-0');
      s.pointer('pointermove', ...s.screen(card.x + card.w, card.y + card.h));
      assert.equal(cursor(), 'nwse-resize');
      s.pointer('pointermove', ...s.screen(card.x + card.w, card.y + card.h / 2));
      assert.equal(cursor(), 'ew-resize');
      s.pointer('pointermove', ...s.screen(card.x, card.y + card.h));
      assert.equal(cursor(), 'nesw-resize');
      s.drag(s.screen(card.x, card.y + card.h / 2), s.screen(card.x - 40, card.y + card.h / 2));
      assert.equal(Math.round(ed.shape('card-0').x), card.x - 40, 'the west handle moved the left edge');
      assert.equal(Math.round(ed.shape('card-0').x + ed.shape('card-0').w), card.x + card.w, 'the right edge stayed');
      // Hover follows the pointer; leaving the board clears it (the board's onPointerLeave).
      s.pointer('pointermove', ...s.centre('bar-4'));
      assert.equal($read(ed.hover), 'bar-4');
      s.pointer('pointerleave', ...s.centre('bar-4'));
      assert.equal($read(ed.hover), null);
      assert.ok(s.page.all('.status')[0].textContent.includes('x –, y –'), 'the status bar lost the pointer');
    } finally {
      s.page.dispose();
    }
  });

  it('shows move over a selected shape, and a new tool\u2019s cursor under a still pointer', async () => {
    const s = await studioPage();
    try {
      const cursor = () => s.canvas().style.cursor;
      s.drag(s.screen(30, 155), s.screen(30, 155), {}, 1);
      s.pointer('pointermove', ...s.screen(60, 154));
      assert.equal(cursor(), 'move', 'over the selected card');
      const empty = s.screen(-30, 420);
      s.pointer('pointermove', ...empty);
      s.key('r');
      s.pointer('pointermove', empty[0] + 1, empty[1]);
      assert.equal(cursor(), 'crosshair', 'the rectangle tool, without leaving the board');
    } finally {
      s.page.dispose();
    }
  });

  it('moves the canvas layout to a layout worker and back', async (/** @type {import('node:test').TestContext} */ t) => {
    const channel = new MessageChannel();
    const stop = serveLayout(channel.port2);
    const layout = remoteLayout(channel.port1);
    after(t, () => {
      layout.close();
      stop();
      channel.port1.close();
    });
    const s = await studioPage({ engine: async () => ({ fonts: new Sfnt(font), layout }) });
    after(t, () => {
      s.page.dispose();
    });
    const first = s.skia();
    s.page.click('Layout worker');
    assert.ok(await until(() => s.skia() !== first && s.page.all('[data-ren-root="studio-canvas"] canvas').length === 1), 'a canvas laid out in the worker');
    assert.ok(s.page.all('.status')[0].textContent.includes('layout in a worker'));
    // Its boxes come back from the worker, then it paints.
    assert.ok(await until(() => s.pixel(s.centre('bar-5')) === s.tokenColor('series-4')), 'painted from the worker’s boxes');
    s.drag(s.centre('bar-5'), s.centre('bar-5'), {}, 1);
    s.key('ArrowDown', { shiftKey: true });
    assert.ok(await until(() => s.pixel(s.centre('bar-5')) === s.tokenColor('series-4')), 'and repaints an edit');
    s.page.click('This thread');
    assert.ok(await until(() => s.page.all('[data-ren-root="studio-canvas"] canvas').length === 1 && s.made.skia.length === 3));
  });
});
