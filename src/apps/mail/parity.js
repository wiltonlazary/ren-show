// The parity script and what "visible text" means on each renderer. The
// script is a list of the client's own commands (the ones its keyboard and
// pointer run); after each step the page reads the text the renderer shows:
// ren-dom's Labels, Actions and Edits (the DOM's own text), and the text
// commands a ren-canv Document painted (ren-skia, ren-three's overlay and
// panels). Line breaks differ with the fonts, so whitespace is collapsed
// before the texts are compared. Visible means drawn: a canvas skips what
// lies outside its clip, so the script keeps whole rows in view (scrolls
// by whole rows) and opens messages that fit the reading pane.

import { ROW } from './model.js';

/**
 * @typedef {{ name: string, op: import('./mail.jsx').Command['op'], arg?: any }} Step
 */

/**
 * The script: the same steps on every renderer. Scrolls move by whole rows,
 * so each renderer shows the same rows whole.
 * @type {Step[]}
 */
export const SCRIPT = [
  { name: 'inbox', op: 'go', arg: 'inbox' },
  { name: 'j', op: 'key', arg: 'j' },
  { name: 'j again', op: 'key', arg: 'j' },
  { name: 'open (Enter)', op: 'key', arg: 'Enter' },
  { name: 'star (s)', op: 'key', arg: 's' },
  { name: 'archive (e)', op: 'key', arg: 'e' },
  { name: 'undo (z)', op: 'key', arg: 'z' },
  { name: 'search “invoice”', op: 'search', arg: 'invoice' },
  { name: 'open the first result', op: 'open', arg: 0 },
  { name: 'starred', op: 'go', arg: 'starred' },
  { name: 'compose (c)', op: 'key', arg: 'c' },
  { name: 'write', op: 'draft', arg: { to: 'Tamsin Varga', subject: 'Parity', body: 'The same text on every renderer.\n\nA second paragraph, sent from the script.' } },
  { name: 'send', op: 'send' },
  { name: 'sent', op: 'go', arg: 'sent' },
  { name: 'scroll five rows', op: 'scroll', arg: 5 * ROW },
  { name: 'label Travel', op: 'go', arg: 'label:Travel' },
];

/** Collapses whitespace. @param {string[]} parts */
export const normalize = parts => parts.join(' ').replace(/\s+/g, ' ').trim();

/**
 * The text a ren-dom root shows: its Labels and Actions, and each Edit's
 * value (its label, the placeholder, when empty), in document order,
 * leaving out what is not displayed.
 * @param {any} host the root's host element
 */
export function domText(host) {
  if (host == null) return '';
  /** @type {string[]} */
  const out = [];
  for (const node of host.querySelectorAll('[data-ren]')) {
    const role = node.getAttribute('data-ren');
    if (role !== 'Label' && role !== 'Action' && role !== 'Edit') continue;
    if (hidden(node, host)) continue;
    out.push(role === 'Edit' ? node.value || node.placeholder || '' : node.textContent);
  }
  return normalize(out);
}

/** True when the node or an ancestor below the host is not displayed. @param {any} node @param {any} host */
function hidden(node, host) {
  for (let n = node; n != null && n !== host; n = n.parentElement) if (n.style?.display === 'none') return true;
  return false;
}

/**
 * The text a ren-canv Document painted in its last frame, in paint order.
 * @param {any} doc a ren-skia renderer, or a ren-three surface
 */
export function canvasText(doc) {
  if (doc == null) return '';
  doc.present();
  /** @type {string[]} */
  const out = [];
  for (const command of doc.commands()) if (command[0] === 'text') out.push(String(command[1]));
  return normalize(out);
}

/**
 * Where two texts part: null when equal, else a few words of each around
 * the first word that differs.
 * @param {string} expected @param {string} actual
 * @returns {string | null}
 */
export function differ(expected, actual) {
  if (expected === actual) return null;
  const a = expected.split(' ');
  const b = actual.split(' ');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const around = (/** @type {string[]} */ words) => words.slice(Math.max(0, i - 2), i + 4).join(' ') || '(end)';
  return `word ${i + 1}: expected “${around(a)}”, shown “${around(b)}”`;
}
