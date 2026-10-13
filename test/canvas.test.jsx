// A renderer of your own: Blueprint (a ren-canv Document) drawing the work
// order, its frames decoded, input routed by attach from the canvas, and
// its layout served over a port by ren-show's own engine. This file sets
// that engine with useLayout for its whole process, as the layout worker
// does in the browser; no other suite shares it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveLayout, useLayout } from 'ren-canv/worker';
import { open } from './page.jsx';
import { Stack } from '../src/stack.js';
import canvas from '../src/demos/canvas.jsx';

useLayout(Stack);

const font = readFileSync(fileURLToPath(import.meta.resolve('ren-skia/font.ttf')));

/** Re-checks `check` until it holds or `ms` pass: frames come from the layout port. @param {() => boolean} check */
const until = async (check, ms = 2000) => {
  // timer: poll, a bounded re-check of the page's state
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 5))) if (check()) return true;
  return check();
};
/** @param {ReturnType<typeof open>} page @param {string} label */
const value = (page, label) => page.all('.value').find(v => v.querySelector('small').textContent === label)?.querySelector('b').textContent;

describe('Stack', () => {
  it('lays out rows that grow and columns that stretch, with padding and gaps', () => {
    const solver = Stack();
    const style = (/** @type {any} */ fields) => solver.define(/** @type {any} */ ({ display: 'flex', position: 'relative', inset: ['auto', 'auto', 'auto', 'auto'], direction: 'row', columnGap: 0, rowGap: 0, padding: [0, 0, 0, 0], border: [0, 0, 0, 0], margin: [0, 0, 0, 0], width: 'auto', height: 'auto', minWidth: 'auto', minHeight: 'auto', maxWidth: 'auto', maxHeight: 'auto', basis: 'auto', grow: 0, shrink: 1, align: 'stretch', self: 'auto', justify: 'normal', ...fields }));
    const page = solver.leaf();
    const row = solver.leaf();
    const a = solver.leaf();
    const b = solver.leaf();
    const under = solver.leaf();
    solver.set(page, style({ direction: 'column', padding: [10, 10, 10, 10], rowGap: 6 }));
    solver.set(row, style({ columnGap: 4 }));
    solver.sized(a, style({}), 30, 16, 30);
    solver.sized(b, style({ grow: 1 }), 20, 20, 20);
    solver.set(under, style({ height: 12 }));
    solver.children(row, [a, b]);
    solver.children(page, [row, under]);
    solver.compute(page, 200);
    const box = (/** @type {any} */ node) => {
      const out = new Float64Array(6);
      solver.read(node, out);
      return [...out.slice(0, 4)];
    };
    assert.deepEqual(box(page), [0, 0, 200, 10 + 20 + 6 + 12 + 10]);
    assert.deepEqual(box(row), [10, 10, 180, 20], 'the row stretches across the column');
    assert.deepEqual(box(a), [0, 0, 30, 20], 'a stretches to the line');
    assert.deepEqual(box(b), [34, 0, 146, 20], 'b grows over the free space');
    assert.deepEqual(box(under), [10, 36, 180, 12]);
  });
});

describe('a renderer of your own', () => {
  it('draws the work order with Blueprint, decodes its frames, takes presses through attach, laid out by Stack', async () => {
    /** @type {(() => void)[]} */
    const stops = [];
    const worker = () => {
      const { port1, port2 } = new MessageChannel();
      const stop = serveLayout(/** @type {any} */ (port1));
      let open = true;
      const terminate = () => {
        if (!open) return;
        open = false;
        stop();
        port1.close();
        port2.close();
      };
      stops.push(terminate);
      return Object.assign(port2, { terminate });
    };
    const page = open(canvas.View, { typefaces: async () => ({ font, mono: font }), worker });
    const texts = () => JSON.parse(`[${page.all('[data-commands]')[0].textContent.split('\n').join(',')}]`).filter((/** @type {any[]} */ c) => c[0] === 'text');
    const text = (/** @type {string} */ s) => texts().find((/** @type {any[]} */ c) => c[1] === s);
    assert.ok(await until(() => page.all('[data-commands]')[0].textContent.includes('Work order 14')), page.text());
    assert.ok(Number(value(page, 'frames drawn')) >= 1);
    // The frame's texts, decoded: [name, string, x, baseline, size, color, flags].
    const [title, first, second] = ['Work order 14', 'Cut the panels', 'Sand the edges'].map(text);
    assert.ok(title[3] < first[3] && first[3] < second[3], 'Stack stacks the column');
    assert.equal(title[4], 18);
    assert.ok(text('1.')[2] < first[2] && text('1.')[3] === first[3], 'each step is a row: its number, then its text');
    assert.match(String(title[5]), /^#[0-9a-f]{8}$/);
    // A press on the canvas reaches the Action through attach.
    const add = text('Add a step');
    const target = page.all('canvas.blueprint')[0];
    for (const type of ['pointerdown', 'pointerup']) {
      const event = new page.window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { offsetX: add[2] + 4, offsetY: add[3] - 4, button: 0, detail: 1, pointerType: 'mouse' });
      target.dispatchEvent(event);
    }
    assert.ok(await until(() => text('Step 3') !== undefined && text('3 steps') !== undefined), JSON.stringify(texts().map((/** @type {any[]} */ c) => c[1])));
    assert.ok(text('Step 3')[3] > second[3], 'the new step is laid out below the others');
    page.dispose();
    assert.equal(stops.length, 1, 'one layout worker');
    stops.forEach(stop => stop());
  });

  it('says so where there are no font files', async () => {
    const page = open(canvas.View, { typefaces: null });
    assert.ok(await until(() => page.text().includes('Blueprint is unavailable: this environment has no font files')));
    page.dispose();
  });
});
