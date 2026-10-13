// Opens a demo, or the whole ren-show, in an application root on a happy-dom
// document, with the environment the browser entry would provide, and gives
// the tests a few ways to drive it.

import { afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { $after } from 'rrx-core';
import { Root, $dispose } from 'ren-core';
import { $dom } from 'ren-dom';
import { Assets, environment } from '../src/assets.js';

/** A manual clock: `later` queues, `advance(ms)` runs what falls due, in order. */
export function clock() {
  let now = 0;
  /** @type {{ at: number, fn: () => void, n: number }[]} */
  let queue = [];
  let made = 0;
  return {
    now: () => now,
    /** @param {number} ms @param {() => void} fn */
    later: (ms, fn) => {
      const entry = { at: now + ms, fn, n: made++ };
      queue.push(entry);
      return () => {
        queue = queue.filter(e => e !== entry);
      };
    },
    /** @param {number} ms */
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = queue.filter(e => e.at <= end).sort((a, b) => a.at - b.at || a.n - b.n)[0];
        if (due === undefined) break;
        queue = queue.filter(e => e !== due);
        now = due.at;
        due.fn();
      }
      now = end;
    },
    pending: () => queue.length,
  };
}

/**
 * Resolves once `check` holds, re-checking it after each flush of `graph`
 * (the flush is the graph applying what arrived, such as a promise the
 * manual clock resolved); with no check, after the next flush. Rejects when
 * `ms` pass first.
 * @param {any} graph @param {() => boolean} [check] @param {number} [ms]
 * @returns {Promise<void>}
 */
export function flushed(graph, check = () => true, ms = 2000) {
  return new Promise((resolve, reject) => {
    let done = false;
    // timer: deadline
    const deadline = setTimeout(() => {
      done = true;
      reject(new Error(`no flush made it hold: ${check}`));
    }, ms);
    const next = () => {
      if (done) return;
      if (!check()) return void $after(graph, next);
      done = true;
      clearTimeout(deadline);
      resolve();
    };
    $after(graph, next);
  });
}

/**
 * Runs `close` after the test `t`, pass or fail (a `finally` never runs
 * after a hung await). node:test keeps every hook until the run ends, so the
 * hook holds `close` in a slot it clears once run: what `close` captured
 * (pages, workers, ports) is then free.
 * @param {import('node:test').TestContext} t @param {() => unknown} close
 */
export function after(t, close) {
  /** @type {{ close: (() => unknown) | null }} */
  const slot = { close };
  t.after(() => {
    const run = slot.close;
    slot.close = null;
    return run?.();
  });
}

/** Windows closing: happy-dom frees a window once its close settles, which takes turns of the event loop. @type {Set<Promise<void>>} */
const closing = new Set();

/**
 * Closes a happy-dom window (its `window.close()` closes only a window a
 * script opened, so it does nothing here), and tracks the close.
 * @param {any} window
 */
export function closeWindow(window) {
  const done = window.happyDOM.close().finally(() => closing.delete(done));
  closing.add(done);
}

/** Resolves once every window closed so far is freed. */
export const closed = () => Promise.all(closing).then(() => {});

/** The pages open now: a test that fails before it disposes its page leaves it here. @type {Set<{ dispose: () => void }>} */
const pages = new Set();

// After each test of a file using these pages: every page still open is
// disposed (its roots, their workers and ports, its window), so a failed
// test ends the run instead of hanging it; then the windows closed are awaited.
afterEach(() => {
  for (const page of [...pages]) page.dispose();
  return closed();
});

/**
 * @param {any} view a component
 * @param {Partial<import('../src/assets.js').Environment>} [overrides]
 */
export function open(view, overrides = {}) {
  const window = new Window({ url: 'http://localhost/' });
  const document = window.document;
  const page = document.createElement('main');
  document.body.appendChild(page);
  const env = environment(overrides);
  const View = view;
  const root = Root({ id: 'ren-show', target: page, renderer: $dom(document), storage: window.localStorage, locks: null, provide: [[Assets, env]], swept: env.drains.emit, children: () => <View /> });
  const host = /** @type {any} */ (page.firstChild);
  const all = (/** @type {string} */ selector) => /** @type {any[]} */ ([...host.querySelectorAll(selector)]);
  /** The first button whose text is `text`. @param {string} text */
  const button = text => {
    const found = all('button').find(b => b.textContent === text);
    if (!found) throw new Error(`no button "${text}" in: ${all('button').map(b => b.textContent).join(' | ')}`);
    return found;
  };
  const opened = {
    env,
    window,
    document,
    host,
    root,
    all,
    button,
    /** @param {string} text */
    click: text => button(text).click(),
    /** @param {any} input @param {string} value */
    type(input, value) {
      input.value = value;
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    /** The texts of a selector's matches. @param {string} selector */
    texts: selector => all(selector).map(n => n.textContent),
    /** The journal or lab lines of the nth log. */
    log: (n = 0) => [...all('ol.log')[n].children].map(li => li.textContent),
    text: () => host.textContent,
    dispose() {
      if (!pages.delete(opened)) return;
      $dispose(root);
      closeWindow(window);
    },
  };
  pages.add(opened);
  return opened;
}
