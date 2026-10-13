// The Issues app's data: 2,000 deterministic issues of an engineering team
// (a seeded generator, so every page and test sees the same tracker), the
// vocabulary (statuses, priorities, people, labels) and the fuzzy matcher
// the search and the command palette share.

/**
 * @typedef {'idea' | 'ready' | 'doing' | 'checking' | 'shipped' | 'dropped'} Status
 * @typedef {0 | 1 | 2 | 3 | 4} Priority P1 (most pressing) to P4 by number, 0 unset
 * @typedef {{
 *   id: string, number: number, title: string, status: Status, priority: Priority,
 *   assignee: string | null, labels: string[], estimate: number, created: number, updated: number,
 * }} Issue
 * @typedef {{ id: string, name: string, initials: string, hue: number }} Person
 */

/** @type {{ id: Status, name: string }[]} */
export const STATUSES = [
  { id: 'idea', name: 'Idea' },
  { id: 'ready', name: 'Ready' },
  { id: 'doing', name: 'Doing' },
  { id: 'checking', name: 'Checking' },
  { id: 'shipped', name: 'Shipped' },
  { id: 'dropped', name: 'Dropped' },
];

/** Priorities in display order: P1 first, unset last. @type {{ id: Priority, name: string }[]} */
export const PRIORITIES = [
  { id: 1, name: 'P1' },
  { id: 2, name: 'P2' },
  { id: 3, name: 'P3' },
  { id: 4, name: 'P4' },
  { id: 0, name: 'Unset' },
];

/** @type {Person[]} */
export const PEOPLE = [
  ['ada', 'Ada Okafor'],
  ['mateo', 'Mateo Silva'],
  ['priya', 'Priya Raman'],
  ['jonas', 'Jonas Weber'],
  ['hana', 'Hana Sato'],
  ['liam', 'Liam Brennan'],
  ['sofia', 'Sofia Rossi'],
  ['noah', 'Noah Kim'],
].map(([id, name], hue) => ({ id, name, initials: name.split(' ').map(w => w[0]).join(''), hue: hue % 6 }));

export const LABELS = ['Bug', 'Feature', 'Performance', 'Docs', 'DX', 'Renderer', 'Reactivity', 'Accessibility', 'Infra', 'Security'];

/** The team key: issues are REN-1 … REN-2000. */
export const TEAM = 'REN';
/** The tracker's "now": data is dated against it, so it never depends on the real clock. */
export const EPOCH = Date.UTC(2026, 8, 25, 9, 0);
const HOUR = 3_600_000;

/** @param {Status} id */
export const statusName = id => STATUSES.find(s => s.id === id)?.name ?? id;
/** @param {number} id */
export const priorityName = id => PRIORITIES.find(p => p.id === id)?.name ?? 'Unset';
/** @param {string | null} id @returns {Person | null} */
export const person = id => PEOPLE.find(p => p.id === id) ?? null;
/** Sort rank of a priority: P1 0 … unset 4. @param {number} p */
export const rank = p => (p === 0 ? 4 : p - 1);

/** A small, fast seeded generator (mulberry32). @param {number} seed */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARTS = {
  thing: ['event listeners', 'text selection', 'the focus ring', 'scroll position', 'hover state', 'the layout cache', 'the glyph atlas', 'the worker port', 'the storage listener', 'the style sheet', 'keyed rows', 'the portal layer', 'pointer capture', 'the damage region'],
  event: ['the root is disposed', 'a list is cleared', 'the theme changes', 'the window resizes', 'a worker restarts', 'fonts finish loading', 'a transition is held', 'navigating back', 'a row moves', 'the tab is hidden'],
  ui: ['the command palette', 'the board view', 'the date picker', 'the sidebar', 'the settings dialog', 'the issue panel', 'the data table', 'tabs', 'the toast stack', 'the context menu', 'the filter bar'],
  pkg: ['ren-dom', 'ren-skia', 'ren-three', 'ren-canv', 'rrx-core', 'ren-core', 'ren-html', 'ren-json'],
  feature: ['grid layout', 'RTL text', 'IME composition', 'high-DPI canvases', 'reduced motion', 'server rendering', 'streaming tasks', 'nested roots', 'custom fonts', 'variable fonts', 'sticky headers'],
  tech: ['Taffy', 'constructable style sheets', 'ResizeObserver', 'OffscreenCanvas', 'structured clone', 'SharedArrayBuffer'],
  test: ['roots › dispose releases the id', 'lists › swap rows', 'worker › mailbox ordering', 'skia › text entry', 'three › raycast hover', 'tasks › superseded completion', 'store › reuse keeps rows'],
  metric: ['first paint', 'memory use', 'input latency', 'scroll performance', 'startup time', 'bundle size'],
  setting: ['prefers-reduced-motion', 'the system font size', 'dark mode', 'the zoom level', 'forced colors'],
  operation: ['creating 10k rows', 'style recalculation', 'the first layout', 'font shaping', 'background sweeps', 'the initial sync'],
  platform: ['Safari', 'Firefox', 'low-end Android', 'Windows high contrast', 'iPadOS', 'Chrome on Linux'],
  api: ['the $bind helper', 'the legacy Find context', 'string-keyed layers', 'the v0 wire format', 'implicit auto flush'],
};

const TITLES = [
  'Fix {thing} leaking after {event}',
  '{Thing} flickers when {event}',
  'Add keyboard navigation to {ui}',
  'Support {feature} in {pkg}',
  'Crash in {pkg} when {event}',
  'Reduce the {metric} of {ui}',
  'Migrate {thing} to {tech}',
  'Document {feature}',
  'Flaky test: {test}',
  'Improve {metric} in {pkg}',
  '{Ui} ignores {setting}',
  'Investigate slow {operation} on {platform}',
  'Remove {api}',
  '{Feature} breaks in {platform}',
  'Audit {ui} for screen readers',
  'Expose {thing} to devtools',
  'Regression: {thing} lost when {event}',
  'Benchmark {operation} against the market libraries',
  'Handle {setting} in {pkg}',
  'Spike: {feature} with {tech}',
];

/** Labels that fit a title's first word. @param {string} template */
const hinted = template =>
  /^(Fix|Crash|Regression|Flaky|\{Thing\} flickers|\{Feature\} breaks)/.test(template) ? 'Bug'
  : /^(Reduce|Improve|Investigate|Benchmark)/.test(template) ? 'Performance'
  : /^Document/.test(template) ? 'Docs'
  : /^Audit|ignores/.test(template) ? 'Accessibility'
  : /^(Migrate|Remove|Expose)/.test(template) ? 'DX'
  : 'Feature';

/** @template T @param {() => number} next @param {readonly T[]} list @returns {T} */
const pick = (next, list) => list[Math.floor(next() * list.length)];

/**
 * One issue, from its number and a generator. Older issues are mostly shipped,
 * as in a real tracker.
 * @param {number} n @param {() => number} next @param {number} count @returns {Issue}
 */
function issue(n, next, count) {
  const template = pick(next, TITLES);
  const title = template.replace(/\{(\w)(\w+)\}/g, (_, first, rest) => {
    const word = pick(next, /** @type {Record<string, string[]>} */ (PARTS)[first.toLowerCase() + rest]);
    return first === first.toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word;
  });
  const age = n / count;
  const roll = next();
  /** @type {Status} */
  const status =
    age < 0.58 ? (roll < 0.9 ? 'shipped' : 'dropped')
    : roll < 0.3 ? 'idea'
    : roll < 0.55 ? 'ready'
    : roll < 0.72 ? 'doing'
    : roll < 0.82 ? 'checking'
    : roll < 0.95 ? 'shipped'
    : 'dropped';
  const p = next();
  /** @type {Priority} */
  const priority = p < 0.05 ? 1 : p < 0.25 ? 2 : p < 0.6 ? 3 : p < 0.85 ? 4 : 0;
  const labels = [hinted(template)];
  if (next() < 0.55) {
    const extra = pick(next, LABELS);
    if (!labels.includes(extra)) labels.push(extra);
  }
  const created = EPOCH - Math.round((count - n) * 5.2 * HOUR + next() * 4 * HOUR);
  const updated = Math.min(EPOCH, created + Math.round(next() * (EPOCH - created) * (status === 'shipped' || status === 'dropped' ? 0.3 : 1)));
  return {
    id: `${TEAM}-${n}`,
    number: n,
    title,
    status,
    priority,
    assignee: next() < 0.9 || status === 'doing' || status === 'checking' ? pick(next, PEOPLE).id : null,
    labels,
    estimate: pick(next, [0, 1, 1, 2, 2, 3, 3, 5, 8]),
    created,
    updated,
  };
}

/** The seeded tracker: `count` issues, REN-1 the oldest. @param {number} [count] @param {number} [seed] @returns {Issue[]} */
export function generate(count = 2000, seed = 7) {
  const next = random(seed);
  const out = new Array(count);
  for (let n = 1; n <= count; n++) out[n - 1] = issue(n, next, count);
  return out;
}

/** A new issue the server made during a sync. @param {number} n @param {number} seed @returns {Issue} */
export const fresh = (n, seed) => ({ ...issue(n, random(seed), n), status: 'ready', created: EPOCH, updated: EPOCH });

/**
 * Fuzzy match of `query` in `text`: every character in order, scored so
 * that contiguous runs and word starts rank first; -1 when it does not match.
 * @param {string} query lower case @param {string} text
 */
export function fuzzy(query, text) {
  if (query === '') return 0;
  const hay = text.toLowerCase();
  const direct = hay.indexOf(query);
  if (direct >= 0) return 1000 - direct + (direct === 0 || hay[direct - 1] === ' ' ? 200 : 0);
  let score = 0;
  let at = 0;
  let run = 0;
  for (const ch of query) {
    const found = hay.indexOf(ch, at);
    if (found < 0) return -1;
    run = found === at ? run + 1 : 0;
    score += 1 + run * 3 + (found === 0 || hay[found - 1] === ' ' ? 5 : 0) - Math.min(found - at, 10) * 0.2;
    at = found + 1;
  }
  return score;
}

/** True when every word of `query` is in the issue's key or title. @param {string} query @param {Issue} issue */
export const matches = (query, issue) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${issue.id} ${issue.title}`.toLowerCase();
  return words.every(w => hay.includes(w));
};

/** "3d", "5h", "just now", against the tracker's now. @param {number} at @param {number} now */
export function ago(at, now) {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days}d`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo` : `${Math.round(months / 12)}y`;
}
