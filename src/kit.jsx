// Pieces every demo uses: a journal that any computation may write, a lab
// graph for scripted runs, and small view helpers.

import { $root, $signal, $writable, $read, $write, $untrack, $dispose, $watch } from 'rrx-core';
import { For, $resizes } from 'ren-core';

/**
 * A journal of recent lines. Its signal is `$writable`, so memos and `$watch`
 * reads may note what they do; the read of the previous lines is untracked,
 * so noting never subscribes the writer to the journal.
 * @param {import('rrx-core').Graph} root
 * @param {number} [size]
 */
export function Journal(root, size = 8) {
  const lines = $writable($signal(root, /** @type {string[]} */ ([])));
  /** @param {string} text */
  const note = text => {
    const old = $untrack(root, () => $read(lines));
    $write(lines, [...old.slice(Math.max(0, old.length - size + 1)), text]);
  };
  const clear = () => $write(lines, []);
  return { lines, note, clear };
}

/**
 * Runs a script on a fresh graph and returns what it noted. The graph is
 * disposed afterwards, so each run starts clean. A throw ends the script and
 * is noted.
 * @param {(root: import('rrx-core').Graph, note: (text: string) => void) => void} script
 * @returns {string[]}
 */
export function lab(script) {
  const root = $root('lab');
  /** @type {string[]} */
  const lines = [];
  try {
    script(root, text => lines.push(text));
  } catch (error) {
    lines.push(`throws: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    $dispose(root);
  }
  return lines;
}

/** The lines of a journal or lab run, positional so equal lines are fine. @param {{ of: any }} props */
export const Lines = props => (
  <ol class="log">
    <For by="position" each={props.of} fallback={<li class="quiet">nothing yet</li>}>
      {line => <li>{line}</li>}
    </For>
  </ol>
);

/** A titled block inside a demo. @param {{ title: string, note?: string, children?: any }} props */
export const Block = props => (
  <section class="block">
    <h3>{props.title}</h3>
    {props.note ? <p class="note">{props.note}</p> : null}
    {props.children}
  </section>
);

/**
 * A read-only value with a caption: a group named by the caption, so its
 * data reads `{ role: 'group', label, text }` (the caption shown, but hidden
 * from the name's readers, as the group carries it).
 * @param {{ label: string, value: any }} props
 */
export const Value = props => (
  <span class="value" role="group" aria-label={props.label}>
    <small aria-hidden="true">{props.label}</small>
    <b>{props.value}</b>
  </span>
);

/**
 * A box's width, followed: `ref` goes on the element (a DOM tag of the
 * calling component's ren-dom root, with no padding or border), and
 * `width()` is its width once measured (ren-core's `$resizes`: ren-dom's
 * ResizeObserver), `fallback` until then and where nothing measures (the
 * tests). Canvases are made at the width they are shown at, never stretched
 * by CSS, so they stay sharp and their input lands where it is drawn.
 * Called in a component.
 * @param {import('rrx-core').Graph} R @param {number} fallback
 */
export function measure(R, fallback) {
  const width = $signal(R, fallback);
  const node = $signal(R, /** @type {any} */ (null));
  $resizes(() => $read(node), e => {
    const w = Math.floor(e.width);
    if (w > 0 && w !== $untrack(R, () => $read(width))) $write(width, w);
  });
  return { ref: (/** @type {any} */ el) => $write(node, el), width: () => $read(width) };
}

/**
 * Resizes a canvas renderer (ren-skia's, ren-three's: `resize(width,
 * height)`) as `size` changes from the size it was made at.
 * @template {{ resize: (width: number, height: number) => void }} T
 * @param {import('rrx-core').Graph} R @param {T} renderer @param {() => [number, number]} size
 * @returns {T}
 */
export function follow(R, renderer, size) {
  let last = $untrack(R, size).join();
  $watch(R, size, s => {
    if (s.join() === last) return;
    last = s.join();
    renderer.resize(s[0], s[1]);
  });
  return renderer;
}
