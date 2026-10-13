// Mail: the model on its own, then the one client on every renderer: the
// DOM (happy-dom), Skia (headless CanvasKit), a three.js overlay and panel
// (real three.js scenes, a drawer stub for WebGL) and Skia with the client
// in a "worker" (a MessageChannel, the real serve on the other end); the
// same presses, keys, selection and typing on each; and the parity script,
// whose texts must match the DOM's on every renderer.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { $read, $write, $batch, $dispose, $flush, $signal } from 'rrx-core';
import { Root, $active } from 'ren-core';
import { THEMES, Look } from '../src/themes.js';
import { serve } from 'ren-core/worker';
import { loadLayout } from 'ren-canv';
import { open, after } from './page.jsx';
import mail from '../src/apps/mail/index.jsx';
import { Mail, TOP, HEAD, SIDE, LIST, NARROW } from '../src/apps/mail/mail.jsx';
import { Mailbox, ROW } from '../src/apps/mail/model.js';
import { seed, short, long, NOW } from '../src/apps/mail/data.js';
import { SCRIPT, canvasText, domText } from '../src/apps/mail/parity.js';

// Each WebAssembly memory reserves its whole address range up front; at most
// 1 GB each, Taffy's and CanvasKit's fit the address cap.
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
const until = async (check, ms = 5000) => {
  // timer: poll, a bounded re-check of the page's state
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 5))) if (check()) return true;
  return check();
};

/** three.js in node: the scene graph is real, a stub stands in for WebGL. */
const threeStub = () => {
  const drawer = { frames: 0, render: () => void drawer.frames++, setSize: () => {}, dispose: () => {} };
  return async () => ({ THREE, renderer: drawer, font });
};

/** The client's worker: Mail served over a MessageChannel, closed with the root. */
const workers = () => {
  /** @type {(() => void)[]} */
  const open = [];
  const make = (/** @type {string} */ id) => {
    const { port1, port2 } = new MessageChannel();
    const session = serve(() => <Mail />, { port: port1, root: Root(id) });
    const stop = () => (session.close(), port1.close(), port2.close());
    open.push(stop);
    return Object.assign(port2, { terminate: stop });
  };
  return { make, close: () => open.splice(0).forEach(stop => stop()) };
};

// Points on the client, in its pixels (the same on every renderer).
const ROWS_TOP = TOP + 1 + HEAD + 1;
const LIST_X = SIDE + 1 + LIST / 2;
/** The middle of row `i` on screen. @param {number} i */
const rowAt = i => [LIST_X, ROWS_TOP + i * ROW + ROW / 2];
const READER_X = SIDE + 1 + LIST + 1;
/** The reading pane's subject (its padding is 22 by 28). */
const SUBJECT = [READER_X + 40, TOP + 1 + 22 + 12];
/** The compose sheet's To field: the title (28) and a gap (12) below the padding. */
const TO = [READER_X + 120, TOP + 1 + 22 + 28 + 12 + 19];

describe('mail model', () => {
  it('seeds 3,000 messages the same way every time', () => {
    const a = seed();
    const b = seed();
    assert.equal(a.length, 3000);
    assert.deepEqual(a.slice(0, 20), b.slice(0, 20));
    assert.ok(a.every((m, i) => i === 0 || m.date <= a[i - 1].date), 'newest first');
    assert.ok(a.every(m => m.body.length >= 2 && m.body.length <= 3), 'two or three paragraphs');
    const places = new Set(a.map(m => m.place));
    for (const p of ['inbox', 'archive', 'sent', 'drafts']) assert.ok(places.has(p), p);
    assert.equal(short(NOW - 60_000), '10:16');
    assert.equal(long(NOW), 'Fri, Sep 25, 2026 at 10:17');
  });

  it('moves, opens, stars, archives with undo, searches in the low lane and sends', async () => {
    const R = Root('mail-model');
    const m = Mailbox(R, { viewport: 5 * ROW, still: true });
    try {
      const inbox = $read(m.list);
      assert.ok(inbox.length > 1000);
      assert.equal($read(m.selected), inbox[0]);
      // j walks down; the window follows the cursor.
      for (let i = 0; i < 7; i++) m.key('j');
      $flush(R);
      assert.equal($read(m.selected), inbox[7]);
      assert.equal($read(m.offset), 8 * ROW - 5 * ROW);
      m.key('k');
      m.key('Enter');
      $flush(R);
      assert.equal($read(m.opened), inbox[6]);
      assert.equal(m.message(inbox[6])?.read, true);
      // Star, then archive: optimistic, the next message takes its place, and undo restores it.
      const starred = m.message(inbox[6])?.starred;
      m.key('s');
      $flush(R);
      assert.equal(m.message(inbox[6])?.starred, !starred);
      m.key('e');
      $flush(R);
      assert.equal(m.message(inbox[6])?.place, 'archive');
      assert.equal($read(m.opened), inbox[7]);
      assert.equal($read(m.toast)?.text, 'Archived');
      m.key('z');
      $flush(R);
      assert.equal(m.message(inbox[6])?.place, 'inbox');
      assert.equal($read(m.opened), inbox[6]);
      // Search: the field at once, the list in the low lane.
      m.search('invoice');
      assert.equal($read(m.typed), 'invoice');
      $flush(R);
      await until(() => $read(m.query) === 'invoice');
      const hits = $read(m.list);
      assert.ok(hits.length > 10 && hits.every(id => m.message(id)?.hay.includes('invoice')));
      // Compose and send: in Sent at once; undo brings the draft back.
      m.key('c');
      assert.equal($read(m.composing), true);
      const { to, subject, body } = m.draft;
      $batch(R, () => {
        $write(to, 'Ada Okafor');
        $write(subject, 'Hello');
        $write(body, 'One.\n\nTwo.');
      });
      m.send();
      $flush(R);
      assert.equal(m.messages[0].subject, 'Hello');
      assert.deepEqual(m.messages[0].body, ['One.', 'Two.']);
      m.go('sent');
      $flush(R);
      assert.equal($read(m.list)[0], m.messages[0].id);
      m.undo();
      $flush(R);
      assert.equal($read(m.composing), true);
      assert.equal($read(to), 'Ada Okafor');
    } finally {
      m.close();
      $dispose(R);
    }
  });
});

describe('mail on the DOM', () => {
  it('opens, moves with the keyboard, archives with undo, searches and sends', async () => {
    const page = open(mail.View);
    try {
      const host = () => page.all('[data-ren-root="mail-dom"]')[0];
      assert.ok(await until(() => host() !== undefined && domText(host()).includes('Inbox')));
      const rows = () => page.all('[data-ren-root="mail-dom"] button[aria-label]').filter(b => b.getAttribute('aria-label').includes(': '));
      assert.equal(rows().length, Math.ceil((660 - TOP - 32 - 2 - HEAD - 1) / ROW), 'only the rows that show');
      const first = rows()[0];
      const subject = first.getAttribute('aria-label').split(': ').slice(1).join(': ');
      first.click();
      assert.ok(await until(() => domText(host()).includes('Mark unread')), 'the reading pane shows the message');
      assert.ok(domText(host()).includes(subject));
      // j on the focused row, then Enter: the second message opens.
      const key = (/** @type {any} */ el, /** @type {string} */ k) => el.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
      const second = rows()[1].getAttribute('aria-label').split(': ').slice(1).join(': ');
      key(first, 'j');
      key(first, 'Enter');
      assert.ok(await until(() => domText(host()).includes(second)));
      key(first, 'e');
      assert.ok(await until(() => domText(host()).includes('Archived Undo')));
      page.all('[data-ren-root="mail-dom"] button').find(b => b.textContent === 'Undo').click();
      assert.ok(await until(() => domText(host()).includes('Archive undone')));
      // Search: the field is the input; the list follows in the low lane.
      const search = page.all('[data-ren-root="mail-dom"] input').find(i => i.placeholder.startsWith('Search'));
      // / focuses the search field (the DOM's elements take the focus).
      key(rows()[0], '/');
      assert.ok(page.document.activeElement === search, 'the search field takes the focus');
      page.type(search, 'invoice');
      assert.ok(await until(() => /results for “invoice”/.test(domText(host()))));
      // Compose and send.
      page.all('[data-ren-root="mail-dom"] button').find(b => b.textContent === 'Compose').click();
      assert.ok(await until(() => domText(host()).includes('New message')));
      const [to, subjectField] = page.all('[data-ren-root="mail-dom"] input').filter(i => i.placeholder === 'To' || i.placeholder === 'Subject');
      page.type(to, 'Tamsin Varga');
      page.type(subjectField, 'Hello from the DOM');
      const text = page.all('[data-ren-root="mail-dom"] textarea')[0];
      page.type(text, 'First.\n\nSecond.');
      page.all('[data-ren-root="mail-dom"] button').find(b => b.textContent === 'Send').click();
      assert.ok(await until(() => domText(host()).includes('Sent to Tamsin Varga')));
    } finally {
      page.dispose();
    }
  });
});

describe('mail on the canvases', () => {
  it('runs the same client on Skia: press, keys, wheel, selection and typing', async () => {
    /** @type {Record<string, any>} */
    const made = {};
    const page = open(() => mail.View({ probe: (t, r) => (made[t] = r) }), { skia: async () => ({ kit, font }) });
    try {
      page.click('Skia');
      assert.ok(await until(() => made.skia !== undefined && canvasText(made.skia).includes('Inbox')));
      const skia = made.skia;
      assert.equal(page.all('[data-ren-root="mail-skia"] canvas').length, 1);
      skia.press(...rowAt(0));
      const before = canvasText(skia);
      assert.ok(before.includes('Mark unread'), 'the reading pane shows the message');
      // A triple press on the subject selects it, as in a browser.
      skia.press(...SUBJECT, 3);
      const subject = skia.copied();
      assert.ok(subject.length > 5 && before.includes(subject), subject);
      // The row keeps the keyboard: press it again, then j and Enter.
      skia.press(...rowAt(0));
      skia.key('j');
      skia.key('Enter');
      assert.notEqual(canvasText(skia), before);
      skia.key('s');
      assert.match(canvasText(skia), /(Starred|Unstarred) “/);
      // The wheel scrolls the list's window.
      const top = canvasText(skia);
      skia.wheel(...rowAt(2), 3 * ROW);
      const wheeled = canvasText(skia);
      assert.notEqual(wheeled, top);
      // The thumb drags (pointer events, kept by the pressed item past its box).
      const thumb = [SIDE + 1 + LIST - 5, ROWS_TOP + 6];
      skia.press(...thumb);
      skia.move(thumb[0] - 120, thumb[1] + 150);
      skia.release(thumb[0] - 120, thumb[1] + 150);
      const dragged = canvasText(skia);
      assert.notEqual(dragged, wheeled, 'the drag scrolled the list');
      // A drag the browser takes back ends there: later moves scroll nothing.
      // Back at the top, the thumb is there again.
      skia.wheel(...rowAt(2), -1e7);
      const top2 = canvasText(skia);
      skia.press(...thumb);
      skia.move(thumb[0], thumb[1] + 60);
      const held = canvasText(skia);
      assert.notEqual(held, top2, 'the thumb drags again');
      skia.cancel(thumb[0], thumb[1] + 60);
      skia.move(thumb[0], thumb[1] + 200);
      assert.equal(canvasText(skia), held, 'the cancelled drag ended');
      // / focuses the search field through its ref; typing searches.
      skia.press(...rowAt(0));
      skia.key('/');
      assert.ok(skia.type('invoice'), 'the search field has the focus');
      assert.ok(await until(() => /results for “invoice”/.test(canvasText(skia))));
      // Escape leaves the field; the keys are shortcuts again.
      skia.key('Escape');
      skia.press(...rowAt(0));
      // c composes, and the To field takes the focus as the sheet opens; its
      // keys are text, not shortcuts (e, s, c do nothing but type).
      skia.key('c');
      assert.ok(canvasText(skia).includes('New message'));
      assert.ok(skia.type('Ada Okafor'), 'the To field has the focus');
      for (const k of ['e', 's', 'c']) skia.key(k);
      assert.ok(canvasText(skia).includes('Ada Okaforesc'));
      skia.press(...TO);
      assert.ok(canvasText(skia).includes('New message'));
    } finally {
      page.dispose();
    }
  });

  it('runs it in a three.js overlay and on a panel in the scene', async () => {
    /** @type {Record<string, any>} */
    const made = {};
    const page = open(() => mail.View({ probe: (t, r) => (made[t] = r) }), { three: threeStub() });
    try {
      page.click('three.js overlay');
      assert.ok(await until(() => made.three?.overlay != null && canvasText(made.three.overlay).includes('Inbox')));
      const three = made.three;
      // The pointer through the renderer's own input: the overlay first.
      three.input('pointerdown', ...rowAt(1), { button: 0, buttons: 1, detail: 1 });
      three.input('pointerup', ...rowAt(1), { button: 0, buttons: 0, detail: 1 });
      assert.ok(canvasText(three.overlay).includes('Mark unread'));
      three.overlay.press(...SUBJECT, 3);
      assert.ok(three.overlay.copied().length > 5);
      page.click('three.js panel');
      assert.ok(await until(() => made.panel !== undefined && [...made.panel.surfaces].some(s => s.panel)));
      const panel = [...made.panel.surfaces].find(s => s.panel);
      assert.ok(await until(() => canvasText(panel).includes('Inbox')));
      assert.equal(panel.width, 1100, 'the panel is as large as the client');
      panel.press(...rowAt(2));
      panel.key('j');
      panel.key('Enter');
      assert.ok(canvasText(panel).includes('Mark unread'));
      page.click('Face the camera');
      assert.ok(page.text().includes('Tilt the panel'));
    } finally {
      page.dispose();
    }
  });

  it('runs it on Skia with the client in a worker', async (/** @type {import('node:test').TestContext} */ t) => {
    /** @type {Record<string, any>} */
    const made = {};
    const channel = workers();
    const page = open(() => mail.View({ probe: (t, r) => (made[t] = r) }), { skia: async () => ({ kit, font }), worker: channel.make });
    after(t, () => {
      page.dispose();
      channel.close();
    });
    page.click('Skia + worker');
    assert.ok(await until(() => made.worker !== undefined && canvasText(made.worker).includes('Inbox')));
    const skia = made.worker;
    skia.press(...rowAt(0));
    assert.ok(await until(() => canvasText(skia).includes('Mark unread')), 'the press crossed to the worker and the answer came back');
    skia.key('j');
    skia.key('Enter');
    skia.key('e');
    assert.ok(await until(() => canvasText(skia).includes('Archived Undo')));
  });
});

describe('mail themes', () => {
  it('restyles a live client in a new theme, keeping its state, on the DOM and on Skia', async () => {
    /** @type {Record<string, any>} */
    const made = {};
    /** @type {any} */
    let theme = null;
    const Themed = () => {
      theme = $signal($active(), THEMES[0]);
      const Client = mail.View;
      return (
        <Look value={theme}>
          <Client probe={(/** @type {string} */ t, /** @type {any} */ r) => (made[t] = r)} />
        </Look>
      );
    };
    const page = open(Themed, { skia: async () => ({ kit, font }) });
    try {
      const dom = () => page.all('[data-ren-root="mail-dom"]')[0];
      assert.ok(await until(() => dom() !== undefined && domText(dom()).includes('Inbox')));
      const host = dom();
      page.all('[data-ren-root="mail-dom"] button[aria-label]').filter(b => b.getAttribute('aria-label').includes(': '))[2].click();
      assert.ok(domText(host).includes('Mark unread'));
      const tide = /** @type {any} */ (THEMES.find(t => t.id === 'tide'));
      const client = () => host.querySelector('[data-ren="View"]');
      const accent = host.style.getPropertyValue('--ren-accent');
      const paper = client().style.background;
      $batch(page.root, () => $write(theme, tide));
      assert.ok(await until(() => host.style.getPropertyValue('--ren-accent') !== accent), `tokens: ${accent} → ${host.style.getPropertyValue('--ren-accent')}`);
      assert.ok(await until(() => client().style.background !== paper), `colors: ${paper} → ${client().style.background}`);
      assert.equal(dom(), host, 'the same root');
      assert.ok(domText(host).includes('Mark unread'), 'the open message stays');
      page.click('Skia');
      assert.ok(await until(() => made.skia !== undefined && canvasText(made.skia).includes('Inbox')));
      const skia = made.skia;
      skia.press(...rowAt(1));
      const before = canvasText(skia);
      const colors = () => skia.commands().filter((/** @type {any[]} */ c) => c[0] === 'rect').map((/** @type {any[]} */ c) => c[5]).join(' ');
      const painted = colors();
      $batch(page.root, () => $write(theme, THEMES[0]));
      assert.ok(await until(() => colors() !== painted), 'repainted in the new colors');
      assert.equal(made.skia, skia, 'the same renderer');
      assert.equal(canvasText(skia), before, 'the same text: the open message stays');
    } finally {
      page.dispose();
    }
  });
});

describe('mail on a phone', () => {
  it('switches to one pane at a time with the viewport, and back: list, message, back, mailboxes', async () => {
    const page = open(mail.View);
    try {
      const app = () => page.all('.app-mail')[0];
      const host = () => page.all('[data-ren-root="mail-dom"]')[0];
      const client = () => host()?.querySelector('[data-ren="View"]');
      const button = (/** @type {string} */ text) => page.all('[data-ren-root="mail-dom"] button').find(b => b.textContent === text || b.getAttribute('aria-label') === text);
      assert.ok(await until(() => host() !== undefined && domText(host()).includes('Inbox')));
      assert.equal(app().getAttribute('data-layout'), 'wide');
      assert.equal(client().style.width, '1100px');
      // A phone's viewport: the client is made again at the phone's width, one pane at a time.
      page.window.happyDOM.setViewport({ width: 390, height: 844 });
      assert.ok(await until(() => app().getAttribute('data-layout') === 'narrow' && client() != null), 'the phone layout');
      const width = parseFloat(client().style.width);
      assert.ok(width < NARROW && width <= 390, `the client fits the phone: ${width}`);
      assert.equal(page.all('.mail-stage')[0].style.width, `${width}px`, 'the stage is the client’s size');
      const rows = () => page.all('[data-ren-root="mail-dom"] button[aria-label]').filter(b => b.getAttribute('aria-label').includes(': '));
      assert.equal(rows().length, 7, 'the list: the same seven rows');
      assert.ok(!domText(host()).includes('MAILBOXES') && !domText(host()).includes('No message open'), 'no sidebar, no reading pane beside the list');
      assert.ok(!domText(host()).includes('j k move'), 'no shortcuts line');
      // The list, then the message in its place, then back.
      const subject = rows()[2].getAttribute('aria-label').split(': ').slice(1).join(': ');
      rows()[2].click();
      assert.ok(await until(() => domText(host()).includes('Mark unread')), 'the message shows');
      assert.equal(rows().length, 0, 'in place of the list');
      assert.ok(domText(host()).includes(subject));
      assert.ok(button('Back to the list')?.textContent === '‹ Inbox');
      button('Back to the list').click();
      assert.ok(await until(() => rows().length === 7), 'the list again');
      assert.ok(!domText(host()).includes('Mark unread'));
      // The menu: the mailboxes take the pane; one shows its list.
      button('Mailboxes').click();
      assert.ok(await until(() => domText(host()).includes('MAILBOXES')));
      page.all('[data-ren-root="mail-dom"] button[aria-label]').find(b => b.getAttribute('aria-label').startsWith('Starred, ')).click();
      assert.ok(await until(() => rows().length === 7 && /Starred [\d,]+ messages/.test(domText(host()))), domText(host()).slice(0, 120));
      // Compose takes the pane, and Send gives the list back.
      button('Compose').click();
      assert.ok(await until(() => domText(host()).includes('New message')));
      assert.equal(rows().length, 0);
      button('Discard').click();
      assert.ok(await until(() => rows().length === 7));
      // A wide viewport again: the three panes.
      page.window.happyDOM.setViewport({ width: 1280, height: 900 });
      assert.ok(await until(() => app().getAttribute('data-layout') === 'wide' && client()?.style.width === '1100px'));
      assert.ok(domText(host()).includes('MAILBOXES'));
    } finally {
      page.dispose();
    }
  });

  it('shows the DOM’s text on every renderer after every step of the script, one pane at a time', async () => {
    const channel = workers();
    const page = open(mail.View, { skia: async () => ({ kit, font }), three: threeStub(), worker: channel.make });
    try {
      page.window.happyDOM.setViewport({ width: 390, height: 844 });
      assert.ok(await until(() => page.all('.app-mail')[0]?.getAttribute('data-layout') === 'narrow'));
      page.click('Run the parity script');
      assert.ok(await until(() => page.text().includes('renderers show the DOM'), 120000), page.text().slice(-400));
      const rows = page.all('tr[data-parity]').map(tr => [...tr.children].map(td => td.textContent));
      for (const row of rows) assert.equal(row[1], 'pass', row.join(' | '));
      assert.ok(page.text().includes('5 of 5 renderers'));
    } finally {
      page.dispose();
      channel.close();
    }
  });
});

describe('mail parity', () => {
  it('shows the DOM’s text on every renderer after every step of the script', async () => {
    const channel = workers();
    const page = open(mail.View, { skia: async () => ({ kit, font }), three: threeStub(), worker: channel.make });
    try {
      page.click('Run the parity script');
      assert.ok(await until(() => page.text().includes('renderers show the DOM'), 120000), page.text().slice(-400));
      const rows = page.all('tr[data-parity]').map(tr => [...tr.children].map(td => td.textContent));
      for (const row of rows) assert.equal(row[1], 'pass', row.join(' | '));
      assert.equal(rows.length, 5);
      assert.ok(rows.every(r => r[2] === `${SCRIPT.length} / ${SCRIPT.length}`));
      assert.ok(page.text().includes('5 of 5 renderers'));
    } finally {
      page.dispose();
      channel.close();
    }
  });
});
