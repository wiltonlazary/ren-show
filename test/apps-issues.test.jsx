// The Issues app on happy-dom, on the manual clock: the grouped list and its
// keyboard, the low-lane search, filters, the board's optimistic drag and
// drop with its rollback, the side panel's activity task and error boundary,
// undo and redo, the command palette, comments, sync, preferences in
// Storage, the Insights chunk and background disposal.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Root, $dispose } from 'ren-core';
import { $dom } from 'ren-dom';
import { open, clock, closeWindow, after } from './page.jsx';
import { Assets, environment } from '../src/assets.js';
import issues from '../src/apps/issues/index.jsx';
import { SEARCH_MS, PAGE, PREFS } from '../src/apps/issues/model.js';
import { generate, fuzzy, matches } from '../src/apps/issues/data.js';

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

/** Latest a fake-server answer takes. */
const SERVER = 450;

/** Opens the app on a manual clock. */
function app() {
  const time = clock();
  const page = open(issues.View, { later: time.later, now: time.now });
  /** @param {string} key @param {Record<string, any>} [init] @param {any} [target] */
  const press = (key, init = {}, target = page.document) => target.dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  const rows = () => page.all('.list .row');
  const ids = () => rows().map(r => r.getAttribute('data-id'));
  const group = (/** @type {string} */ key) => page.host.querySelector(`.group[data-group="${key}"]`);
  const toasts = () => page.texts('.toast span');
  /** @param {any} node @param {string} type @param {Record<string, any>} [init] */
  const pointer = (node, type, init = {}) => node.dispatchEvent(new page.window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  const column = (/** @type {string} */ s) => page.host.querySelector(`.column[data-status="${s}"]`);
  const cards = (/** @type {string} */ s) => [...column(s).querySelectorAll('.card')].map(c => c.getAttribute('data-id'));
  return { time, page, press, rows, ids, group, toasts, pointer, column, cards };
}

describe('Issues data', () => {
  it('generates 2,000 deterministic issues, most old ones shipped', () => {
    const a = generate();
    const b = generate();
    assert.equal(a.length, 2000);
    assert.deepEqual(a[1234], b[1234]);
    assert.equal(a[0].id, 'REN-1');
    assert.ok(a.filter(i => i.status === 'shipped').length >= 1000, 'enough shipped issues to retire a group');
    assert.ok(a.every(i => i.title.length > 10 && !/lorem/i.test(i.title)));
  });

  it('matches words and fuzzy subsequences', () => {
    assert.ok(fuzzy('brd', 'Board view') > 0);
    assert.equal(fuzzy('zzz', 'Board view'), -1);
    assert.ok(fuzzy('board', 'Switch to board view') > fuzzy('bw', 'Switch to board view'));
    assert.ok(matches('leak root', { id: 'REN-1', title: 'Fix listeners leaking after the root is disposed' }));
  });
});

describe('Issues app', () => {
  it('lists issues grouped by status, with counts, collapsed groups and pages', () => {
    const { page, rows, group } = app();
    try {
      assert.ok(page.host.querySelector('.app-issues'));
      assert.equal(page.host.querySelector('.total').textContent, '2,000');
      const counts = page.all('.group').map(g => [g.getAttribute('data-group'), Number(g.querySelector('.count').textContent)]);
      assert.equal(counts.reduce((t, [, n]) => t + n, 0), 2000);
      assert.ok(group('shipped').classList.contains('collapsed'), 'shipped starts collapsed');
      assert.equal(group('shipped').querySelectorAll('.row').length, 0);
      assert.equal(group('idea').querySelectorAll('.row').length, Math.min(PAGE, Number(group('idea').querySelector('.count').textContent)));
      assert.ok(rows().length > 0);
      // Each group's gauge rises a quarter a stage; a dropped one is a frame with a bar.
      const level = (/** @type {string} */ s) => Number(group(s).querySelector('.group-head .status-icon .level').getAttribute('height'));
      assert.deepEqual(['idea', 'ready', 'doing', 'checking', 'shipped', 'dropped'].map(level), [0, 1.75, 3.5, 5.25, 7, 0]);
      assert.ok(group('dropped').querySelector('.group-head .status-icon .bar') && !group('idea').querySelector('.group-head .status-icon .bar'));
      // P1 issues come first in a group.
      assert.ok(group('ready').querySelector('.row .priority-icon').classList.contains('p-1'));
      group('shipped').querySelector('.group-head').click();
      assert.equal(group('shipped').querySelectorAll('.row').length, PAGE);
      assert.ok(page.text().includes('Show all 1,158'));
    } finally {
      page.dispose();
    }
  });

  it('walks rows with j and k, selects with x and opens with Enter', () => {
    const { page, press, ids } = app();
    try {
      press('j');
      press('j');
      const second = ids()[1];
      assert.equal(page.all('.row.focused').length, 1);
      assert.equal(page.host.querySelector('.row.focused').getAttribute('data-id'), second);
      press('k');
      assert.equal(page.host.querySelector('.row.focused').getAttribute('data-id'), ids()[0]);
      press('x');
      press('j');
      press('x');
      assert.equal(page.all('.row.checked').length, 2);
      assert.ok(page.text().includes('2 selected'));
      press('Escape');
      assert.equal(page.all('.row.checked').length, 0);
      press('Enter');
      assert.equal(page.host.querySelector('.panel .crumb b').textContent, second);
      press('j');
      assert.equal(page.host.querySelector('.panel .crumb b').textContent, ids()[2], 'j follows in the open panel');
      press('Escape');
      assert.ok(page.host.querySelector('.panel') === null, 'no .panel is left');
    } finally {
      page.dispose();
    }
  });

  it('re-renders one row for an edit, and undoes and redoes it with the keyboard', () => {
    const { page, press, rows } = app();
    try {
      const before = rows();
      const row = before[3];
      const id = row.getAttribute('data-id');
      row.click();
      const title = page.host.querySelector('.panel .title-edit');
      title.value = 'Rename the scheduler lanes';
      title.dispatchEvent(new page.window.Event('blur'));
      assert.equal(row.querySelector('.title').textContent, 'Rename the scheduler lanes');
      assert.deepEqual(rows(), before, 'no row was rebuilt or moved');
      // Status through the panel's select.
      const status = page.host.querySelector('.panel select[aria-label="Status"]');
      status.value = 'doing';
      status.dispatchEvent(new page.window.Event('change'));
      assert.ok(page.host.querySelector(`.group[data-group="doing"] .row[data-id="${id}"]`), 'the row moved to its new group');
      press('z', { ctrlKey: true });
      assert.ok(page.host.querySelector(`.group[data-group="doing"] .row[data-id="${id}"]`) === null, `the row ${id} left doing`);
      press('z', { ctrlKey: true });
      assert.equal(page.host.querySelector(`.row[data-id="${id}"] .title`).textContent === 'Rename the scheduler lanes', false);
      assert.ok(page.text().includes('Undid: rename'));
      press('z', { ctrlKey: true, shiftKey: true });
      assert.equal(page.host.querySelector(`.row[data-id="${id}"] .title`).textContent, 'Rename the scheduler lanes');
      press('y', { ctrlKey: true });
      assert.ok(page.host.querySelector(`.group[data-group="doing"] .row[data-id="${id}"]`));
    } finally {
      page.dispose();
    }
  });

  it('searches in the low lane, keeping the old results while the new ones load', () => {
    const { page, time, rows } = app();
    try {
      const shown = rows().length;
      const input = page.host.querySelector('.search input');
      page.type(input, 'leak');
      assert.equal(input.value, 'leak');
      assert.ok(page.host.querySelector('.search .spinner'), 'pending shows');
      assert.equal(rows().length, shown, 'the previous results stay');
      time.advance(SEARCH_MS);
      assert.ok(page.host.querySelector('.search .spinner') === null, 'no .search .spinner is left');
      assert.ok(rows().length > 0 && rows().length < shown);
      assert.ok(rows().every(r => /leak/i.test(r.querySelector('.title').textContent)));
      assert.match(page.host.querySelector('.status-bar .counts').textContent, /^\d+ of 2,000 issues$/);
      page.type(input, 'zzzz nothing');
      time.advance(SEARCH_MS);
      assert.ok(page.text().includes('No issues match these filters.'));
      page.click('Clear filters');
      time.advance(SEARCH_MS);
      assert.equal(rows().length, shown);
    } finally {
      page.dispose();
    }
  });

  it('filters by assignee, priority and label chips', () => {
    const { page, rows } = app();
    try {
      page.host.querySelector('.menu .chip-button').click();
      const ada = page.all('.popover li').find(li => li.textContent.includes('Ada Okafor'));
      const count = Number(ada.querySelector('.n').textContent);
      ada.click();
      assert.ok(rows().length > 0);
      assert.ok(rows().every(r => r.querySelector('.avatar').textContent === 'AO'));
      assert.match(page.host.querySelector('.status-bar .counts').textContent, new RegExp(`^${count.toLocaleString('en-US')} of`));
      assert.ok(page.texts('.filter-chip').some(t => t.includes('Ada Okafor')));
      page.host.querySelector('.menu-scrim').click();
      assert.ok(page.host.querySelector('.popover') === null, 'no .popover is left');
      page.all('.menu .chip-button')[1].click();
      page.all('.popover li').find(li => li.textContent.includes('P1')).click();
      assert.ok(rows().every(r => r.querySelector('.priority-icon').classList.contains('p-1')));
      page.click('Clear');
      assert.equal(page.all('.filter-chip').length, 0);
    } finally {
      page.dispose();
    }
  });

  it('drags a card to another column optimistically, and rolls back a rejected move', () => {
    const { page, time, pointer, column, cards, toasts } = app();
    try {
      page.click('Board');
      const drag = (/** @type {string} */ id, /** @type {string} */ to) => {
        const card = page.host.querySelector(`.card[data-id="${id}"]`);
        pointer(card, 'pointerdown', { clientX: 10, clientY: 10 });
        pointer(page.document, 'pointermove', { clientX: 30, clientY: 12 });
        assert.ok(page.host.querySelector('.layer .card.ghost'), 'the ghost is in the portal layer');
        pointer(column(to), 'pointerover');
        pointer(page.document, 'pointerup', { clientX: 300, clientY: 12 });
        assert.ok(page.host.querySelector('.layer .card.ghost') === null, 'no .layer .card.ghost is left');
      };
      const moved = cards('ready').slice(0, 4);
      drag(moved[0], 'checking');
      assert.ok(cards('checking').includes(moved[0]), 'the card shows in its new column at once');
      assert.ok(!cards('ready').includes(moved[0]));
      assert.ok(page.host.querySelector(`.card[data-id="${moved[0]}"]`).classList.contains('saving'));
      assert.ok(page.text().includes('Saving…'));
      time.advance(SERVER);
      assert.ok(cards('checking').includes(moved[0]), 'accepted');
      assert.ok(!page.host.querySelector(`.card[data-id="${moved[0]}"]`).classList.contains('saving'));
      drag(moved[1], 'doing');
      drag(moved[2], 'doing');
      drag(moved[3], 'shipped');
      assert.ok(cards('shipped').includes(moved[3]));
      time.advance(SERVER);
      assert.ok(cards('doing').includes(moved[1]) && cards('doing').includes(moved[2]));
      assert.ok(cards('ready').includes(moved[3]), 'the fourth write is rejected and rolled back');
      assert.ok(toasts().some(t => t.startsWith(`${moved[3]} could not move`)));
      // A click without travel opens the issue instead of dragging.
      const card = page.host.querySelector(`.card[data-id="${moved[1]}"]`);
      pointer(card, 'pointerdown', { clientX: 5, clientY: 5 });
      pointer(page.document, 'pointerup', { clientX: 5, clientY: 5 });
      card.click();
      assert.equal(page.host.querySelector('.panel .crumb b').textContent, moved[1]);
    } finally {
      page.dispose();
    }
  });

  it('loads the activity as a task, aborting on switch, with a skeleton and a retry', () => {
    const { page, time, rows } = app();
    try {
      const list = rows();
      list[0].click();
      assert.ok(page.host.querySelector('.panel .timeline.skeleton'), 'the skeleton shows while it loads');
      assert.equal(time.pending(), 1, 'one request in flight');
      list[1].click();
      assert.equal(time.pending(), 1, 'switching aborted the first request');
      time.advance(SERVER);
      assert.ok(page.host.querySelector('.panel .timeline.skeleton') === null, 'no .panel .timeline.skeleton is left');
      assert.ok(page.all('.panel .timeline .entry').length >= 1);
      assert.ok(page.text().includes('created the issue'));
      // A failing issue: the boundary shows with a retry that loads it.
      const input = page.host.querySelector('.search input');
      page.type(input, 'REN-1991');
      time.advance(SEARCH_MS);
      const failing = rows().find(r => r.getAttribute('data-id') === 'REN-1991');
      assert.ok(failing, 'REN-1991 is listed');
      failing.click();
      time.advance(SERVER);
      assert.ok(page.text().includes("Couldn't load the activity: the activity service timed out."));
      page.click('Retry');
      assert.ok(page.host.querySelector('.panel .timeline.skeleton'));
      time.advance(SERVER);
      assert.ok(page.text().includes('created the issue'));
    } finally {
      page.dispose();
    }
  });

  it('posts comments optimistically and drops a rejected one', () => {
    const { page, time, rows, toasts } = app();
    try {
      rows()[0].click();
      time.advance(SERVER);
      const area = page.host.querySelector('.composer textarea');
      const post = (/** @type {string} */ text) => {
        page.type(area, text);
        page.host.querySelector('.composer').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
      };
      post('Looks good to me');
      assert.ok(page.host.querySelector('.entry.comment.draft'), 'shown at once, as a draft');
      assert.ok(page.text().includes('sending…'));
      time.advance(SERVER);
      assert.ok(page.host.querySelector('.entry.draft') === null, 'no .entry.draft is left');
      assert.ok(page.text().includes('Looks good to me'));
      post('two');
      post('three');
      post('four');
      assert.equal(page.all('.entry.draft').length, 3);
      time.advance(SERVER);
      assert.ok(page.text().includes('three'));
      assert.ok(!page.all('.entry.comment p').some(p => p.textContent === 'four'), 'the fourth write is rejected');
      assert.ok(toasts().some(t => t.startsWith('Comment not saved')));
    } finally {
      page.dispose();
    }
  });

  it('opens the palette with Ctrl+K and runs commands and issues with the keyboard', () => {
    const { page, press } = app();
    try {
      press('k', { ctrlKey: true });
      const input = page.host.querySelector('.layer .palette-input');
      assert.ok(input, 'the palette is in the portal layer');
      page.type(input, 'board');
      assert.ok(page.host.querySelector('.palette-item.active').textContent.includes('Switch to board view'));
      press('Enter', {}, input);
      assert.ok(page.host.querySelector('.palette') === null, 'no .palette is left');
      assert.ok(page.host.querySelector('.board'));
      press('k', { metaKey: true });
      const again = page.host.querySelector('.palette-input');
      page.type(again, 'REN-1999');
      press('ArrowDown', {}, again);
      press('ArrowUp', {}, again);
      const active = page.host.querySelector('.palette-item.active');
      assert.ok(active.textContent.includes('REN-1999'));
      press('Enter', {}, again);
      assert.equal(page.host.querySelector('.panel .crumb b').textContent, 'REN-1999');
      // A command on the open issue, undoable.
      press('k', { ctrlKey: true });
      page.type(page.host.querySelector('.palette-input'), 'set status dropped');
      press('Enter', {}, page.host.querySelector('.palette-input'));
      assert.ok(page.host.querySelector('.panel .crumb .status-icon').classList.contains('s-dropped'));
      press('k', { ctrlKey: true });
      press('Escape', {}, page.host.querySelector('.palette-input'));
      assert.ok(page.host.querySelector('.palette') === null, 'no .palette is left');
    } finally {
      page.dispose();
    }
  });

  it('keeps an issue in the open palette current when it changes in place', () => {
    const { page, press, time, pointer, column, cards } = app();
    try {
      page.click('Board');
      const drag = (/** @type {string} */ id, /** @type {string} */ to) => {
        pointer(page.host.querySelector(`.card[data-id="${id}"]`), 'pointerdown', { clientX: 10, clientY: 10 });
        pointer(page.document, 'pointermove', { clientX: 30, clientY: 12 });
        pointer(column(to), 'pointerover');
        pointer(page.document, 'pointerup', { clientX: 300, clientY: 12 });
      };
      // The palette reads the store: a move shows there once the server accepts it.
      const id = cards('ready')[0];
      drag(id, 'shipped');
      press('k', { ctrlKey: true });
      const input = /** @type {any} */ (page.host.querySelector('.palette-input'));
      page.type(input, id);
      const icon = () => page.all('.palette-item').find(li => li.textContent.includes(id))?.querySelector('.status-icon');
      assert.ok(icon()?.classList.contains('s-ready'), 'the store still has it ready while the move is out');
      time.advance(SERVER);
      assert.ok(cards('shipped').includes(id), 'accepted');
      // The next keystroke searches again: the same issue keeps its row, which shows it now.
      page.type(input, `${id} `);
      assert.ok(icon()?.classList.contains('s-shipped'), 'the row shows the issue as it is now');
    } finally {
      page.dispose();
    }
  });

  it('syncs a server snapshot, keeping every unchanged row', () => {
    const { page, time, toasts, rows } = app();
    try {
      const before = rows();
      page.click('Sync');
      assert.ok(page.text().includes('Syncing…'));
      time.advance(SERVER);
      assert.ok(toasts().some(t => t === 'Synced: 8 updated, 2 new, 1992 unchanged'), toasts().join(' | '));
      assert.equal(page.host.querySelector('.total').textContent, '2,002');
      const after = rows();
      assert.ok(after.filter(r => before.includes(r)).length >= before.length - 10, 'rows stay');
      time.advance(4000);
      assert.equal(toasts().length, 0, 'toasts leave on their own');
    } finally {
      page.dispose();
    }
  });

  it('keeps the view, grouping and filters in the root Storage', (/** @type {import('node:test').TestContext} */ t) => {
    const window = new Window({ url: 'http://localhost/' });
    /** The roots still open: each is disposed in turn, and whatever a failure left open after the test. @type {Set<any>} */
    const roots = new Set();
    after(t, () => {
      for (const root of roots) $dispose(root);
      closeWindow(window);
    });
    const time = clock();
    const start = () => {
      const target = window.document.createElement('main');
      window.document.body.appendChild(target);
      const env = environment({ later: time.later, now: time.now });
      const root = Root({ id: 'ren-show', target, renderer: $dom(window.document), storage: window.localStorage, locks: null, provide: [[Assets, env]], children: () => <issues.View /> });
      roots.add(root);
      return root;
    };
    const stop = (/** @type {any} */ root) => (roots.delete(root), $dispose(root));
    const first = start();
    const host = window.document.querySelector('.app-issues');
    [...host.querySelectorAll('.tab')].find(b => b.textContent === 'Board').click();
    const group = host.querySelector('select[aria-label="Group by"]');
    group.value = 'priority';
    group.dispatchEvent(new window.Event('change'));
    const kept = JSON.parse(window.localStorage.getItem(`ren:ren-show:${PREFS}`) ?? '{}');
    assert.equal(kept.mode, 'board');
    assert.equal(kept.grouping, 'priority');
    stop(first);
    start();
    assert.ok(window.document.querySelector('.app-issues .board'), 'opens on the board');
    assert.equal(window.document.querySelector('.tab.on').textContent, 'Board');
  });

  it('loads Insights as a chunk of its own, under Pending', async () => {
    const { page } = app();
    try {
      page.click('Insights');
      assert.ok(page.host.querySelector('.insights.skeleton'), 'the skeleton shows while the chunk loads');
      assert.ok(await until(() => page.host.querySelector('.insights .charts .bars') !== null));
      const tiles = page.texts('.tile b');
      assert.equal(tiles[0], '2,000');
      assert.equal(page.all('.insights .bars')[0].querySelectorAll('li').length, 6);
      assert.equal(page.all('svg.weeks rect.created').length, 16);
    } finally {
      page.dispose();
    }
  });

  it('frees a large group in the background when it collapses', async () => {
    const { page, group } = app();
    try {
      group('shipped').querySelector('.group-head').click();
      page.click('Show all 1,158');
      assert.equal(group('shipped').querySelectorAll('.row').length, 1158);
      group('shipped').querySelector('.group-head').click();
      assert.equal(group('shipped').querySelectorAll('.row').length, 0, 'the nodes go at once');
      assert.ok(await until(() => page.host.querySelector('.status-bar .drain') !== null), 'the drain is reported');
      assert.match(page.host.querySelector('.status-bar .drain').textContent, /Freed in the background: \d+ slices/);
    } finally {
      page.dispose();
    }
  });
});

