// Mail's data: 3,000 deterministic messages (a seeded generator, so every
// renderer, the worker and the tests see the same mailbox), the folders and
// labels, and the date formats. Plain JavaScript with no renderer and no
// DOM: it runs on the page and in the worker alike.

/**
 * @typedef {'inbox' | 'sent' | 'drafts' | 'archive'} Place where a message lives
 * @typedef {object} Message
 * @property {number} id
 * @property {string} from the sender's name ("You" for sent mail)
 * @property {string} email the sender's address
 * @property {string} to the recipient's name
 * @property {string} subject
 * @property {string} preview the body's first sentence
 * @property {string[]} body its paragraphs
 * @property {number} date ms since the epoch (UTC)
 * @property {string[]} labels
 * @property {Place} place
 * @property {boolean} read
 * @property {boolean} starred
 * @property {string} hay what search matches, in lower case
 */

/** The mailbox's "now": data is dated against it, never against the real clock. */
export const NOW = Date.UTC(2026, 8, 25, 10, 17);
/** How many messages the seed makes. */
export const COUNT = 3000;
/** The generator's seed. */
export const SEED = 20260925;

const MINUTE = 60_000;
const DAY = 86_400_000;

/** The labels, in the sidebar's order; each takes a series color. */
export const LABELS = ['Work', 'Finance', 'Travel', 'Family', 'Receipts'];

/** The folders, in the sidebar's order. */
export const FOLDERS = /** @type {const} */ ([
  { id: 'inbox', name: 'Inbox', glyph: '▣' },
  { id: 'starred', name: 'Starred', glyph: '★' },
  { id: 'sent', name: 'Sent', glyph: '➤' },
  { id: 'drafts', name: 'Drafts', glyph: '✎' },
  { id: 'archive', name: 'Archive', glyph: '▤' },
]);

/** mulberry32: a small, fast seeded generator. @param {number} seed @returns {() => number} in [0, 1) */
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

const PEOPLE = [
  ['Ada Okafor', 'ada@quillmere.example'],
  ['Mateo Silva', 'mateo@lumen.example'],
  ['Priya Raman', 'priya@harbor.example'],
  ['Jonas Weber', 'jonas@kestrel.example'],
  ['Hana Sato', 'hana@origami.example'],
  ['Liam Brennan', 'liam@fieldnotes.example'],
  ['Sofia Rossi', 'sofia@atelier.example'],
  ['Noah Kim', 'noah@parallel.example'],
  ['Tamsin Varga', 'tamsin@wicklow.example'],
  ['Oskar Lindqvist', 'oskar@birchwood.example'],
  ['Amara Diallo', 'amara@savanna.example'],
  ['Lucas Moreau', 'lucas@brasserie.example'],
  ['Mei Chen', 'mei@lantern.example'],
  ['Olivia Park', 'olivia@meridian.example'],
  ['Rafael Costa', 'rafael@tropico.example'],
  ['Ingrid Larsen', 'ingrid@fjord.example'],
  ['Kofi Mensah', 'kofi@gold.example'],
  ['Elena Petrova', 'elena@neva.example'],
  ['Quillmere Billing', 'billing@quillmere.example'],
  ['Skyline Air', 'trips@skyline.example'],
  ['Harbor Bank', 'alerts@harborbank.example'],
  ['Mom', 'mom@family.example'],
  ['Design Weekly', 'digest@designweekly.example'],
  ['Forge Builds', 'builds@forge.example'],
];

/** Subject templates by topic; `{p}` a project, `{d}` a day, `{n}` a number, `{c}` a city. */
const TOPICS = [
  {
    label: 'Work',
    subjects: ['Review: {p} launch plan', 'Notes from the {p} sync', '{p}: the numbers for Q{n}', 'Can we move {p} to {d}?', 'Draft spec for {p}', 'Quick question about {p}', '{p} retro on {d}'],
    openers: ['Here are my notes on {p} from this morning.', 'The {p} plan is ready for a first review.', 'Could we look at {p} together on {d}?', 'I pulled the numbers for {p} into one sheet.', 'The {p} draft is in the shared folder now.'],
  },
  {
    label: 'Finance',
    subjects: ['Invoice #{n} for {p}', 'Your statement is ready', 'Payment received: invoice #{n}', 'Budget for {p}, revised', 'Expense report {n} approved'],
    openers: ['Your invoice #{n} is attached to this message.', 'We received your payment, thank you.', 'Your monthly statement is now available.', 'The revised budget for {p} is below.', 'Expense report {n} was approved today.'],
  },
  {
    label: 'Travel',
    subjects: ['Your trip to {c} is confirmed', 'Boarding pass: {c}, {d}', 'Hotel in {c}: check-in {d}', 'Itinerary change for {c}'],
    openers: ['Your flight to {c} leaves on {d} morning.', 'Your boarding pass for {c} is ready.', 'Your room in {c} is booked from {d}.', 'The schedule of your trip to {c} changed.'],
  },
  {
    label: 'Family',
    subjects: ['Dinner on {d}?', 'Photos from {c}', 'Birthday plans', 'Call this {d}?'],
    openers: ['Are you free for dinner on {d}?', 'I finally sorted the photos from {c}.', 'We should plan the birthday soon.', 'Call me when you have a minute on {d}.'],
  },
  {
    label: 'Receipts',
    subjects: ['Your receipt from {p}', 'Order #{n} has shipped', 'Thanks for your order #{n}', 'Subscription renewed'],
    openers: ['Here is your receipt from {p}.', 'Good news: order #{n} is on its way.', 'Thanks for shopping with {p}.', 'Your subscription to {p} was renewed.'],
  },
  {
    label: '',
    subjects: ['Welcome to {p}', 'This week in design, issue {n}', '[{p}] Pull request #{n} merged', 'Coffee on {d}?', 'Re: the {p} demo', 'Following up'],
    openers: ['Welcome aboard, and thanks for signing up for {p}.', 'This week: type, color and a lot of grids.', 'Pull request #{n} was merged into main.', 'Do you have time for a coffee on {d}?', 'The {p} demo went better than expected.', 'Just following up on my last message.'],
  },
];

const PROJECTS = ['Atlas', 'Beacon', 'Cobalt', 'Delta', 'Ember', 'Fable', 'Granite', 'Harbor', 'Iris', 'Juniper', 'Kite', 'Lumen'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CITIES = ['Lisbon', 'Kyoto', 'Oslo', 'Accra', 'Montreal', 'Porto', 'Seoul', 'Lima', 'Vienna', 'Cape Town'];

/** Sentences the bodies are made of: short, ordinary words (they wrap at spaces on every renderer). */
const SENTENCES = [
  'Thanks for sending this over so quickly.',
  'I read through the whole thing twice and the direction feels right to me.',
  'There are two open questions we should settle before the end of the week.',
  'The first one is about the timeline, which looks tight but doable.',
  'The second is who owns the rollout once the first version ships.',
  'I attached the latest numbers so you can see where we stand.',
  'Let me know if anything looks off and I will fix it today.',
  'We can also talk it through on a call if that is easier.',
  'I moved the meeting to the afternoon so everyone can join.',
  'The team agreed to keep the scope small and ship in stages.',
  'Most of the feedback so far has been positive.',
  'A few people asked for a clearer summary at the top.',
  'I will send a short recap once we have decided.',
  'Please review the draft and add your comments inline.',
  'The payment is due within thirty days of this notice.',
  'Your booking reference and the details are below.',
  'We are looking forward to seeing you soon.',
  'Everything arrived in good shape, thank you.',
  'No action is needed on your side right now.',
  'Have a great rest of your week.',
];

/** @param {() => number} next @param {readonly any[]} list */
const pick = (next, list) => list[Math.floor(next() * list.length)];

/** A message's own words: one project, day, city and number, used everywhere in it. @param {() => number} next */
const words = next => ({ p: pick(next, PROJECTS), d: pick(next, DAYS), c: pick(next, CITIES), n: String(100 + Math.floor(next() * 9000)) });

/** @param {string} template @param {ReturnType<typeof words>} w */
const fill = (template, w) => template.replace(/\{([pdcn])\}/g, (_, k) => w[/** @type {'p' | 'd' | 'c' | 'n'} */ (k)]);

/**
 * Two or three paragraphs of one or two sentences: the whole message fits
 * the reading pane, so every renderer draws all of it. The first opens
 * with the topic's own line (the list's preview).
 * @param {() => number} next @param {string} opener
 */
function paragraphs(next, opener) {
  const count = 2 + Math.floor(next() * 2);
  /** @type {string[]} */
  const out = [];
  /** @type {Set<string>} */
  const used = new Set();
  for (let p = 0; p < count; p++) {
    const n = 1 + Math.floor(next() * 2);
    const lines = p === 0 ? [opener] : [];
    while (lines.length < n) {
      const sentence = pick(next, SENTENCES);
      if (used.has(sentence)) continue;
      used.add(sentence);
      lines.push(sentence);
    }
    out.push(lines.join(' '));
  }
  return out;
}

/** The haystack search reads. @param {Message} m */
export const hay = m => `${m.from} ${m.email} ${m.to} ${m.subject} ${m.preview} ${m.labels.join(' ')}`.toLowerCase();

/**
 * The mailbox: `count` messages, newest first, the same for every seed.
 * @param {number} [count] @param {number} [seed]
 * @returns {Message[]}
 */
export function seed(count = COUNT, seed = SEED) {
  const next = random(seed);
  /** @type {Message[]} */
  const out = [];
  let at = NOW - 7 * MINUTE;
  for (let id = 1; id <= count; id++) {
    // Newer mail comes closer together.
    at -= Math.floor((4 + next() * 50 + id / 20) * MINUTE);
    const topic = pick(next, TOPICS);
    const [from, email] = topic.label === 'Finance' && next() < 0.5 ? PEOPLE[18 + Math.floor(next() * 3)] : topic.label === 'Travel' ? PEOPLE[19] : topic.label === 'Family' ? PEOPLE[21] : pick(next, PEOPLE.slice(0, 18));
    const roll = next();
    /** @type {Place} */
    const place = roll < 0.56 ? 'inbox' : roll < 0.9 ? 'archive' : roll < 0.985 ? 'sent' : 'drafts';
    const sent = place === 'sent' || place === 'drafts';
    const own = words(next);
    const body = paragraphs(next, fill(pick(next, topic.openers), own));
    const labels = topic.label === '' ? [] : next() < 0.85 ? [topic.label] : [];
    if (next() < 0.08) labels.push(pick(next, LABELS.filter(l => !labels.includes(l))));
    const age = NOW - at;
    /** @type {Message} */
    const m = {
      id,
      from: sent ? 'You' : from,
      email: sent ? 'you@mail.example' : email,
      to: sent ? from : 'me',
      subject: fill(pick(next, topic.subjects), own),
      preview: body[0].split(/(?<=[.?!]) /)[0],
      body,
      date: at,
      labels,
      place,
      read: sent || next() < Math.min(0.97, 0.35 + age / (6 * DAY)),
      starred: next() < 0.06,
      hay: '',
    };
    m.hay = hay(m);
    out.push(m);
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** @param {number} n */
const two = n => String(n).padStart(2, '0');

/** A list's date: the time today, "Yesterday", the weekday this week, else the day and month (all UTC, against NOW). @param {number} t */
export function short(t) {
  const d = new Date(t);
  const today = Math.floor(NOW / DAY);
  const day = Math.floor(t / DAY);
  if (day === today) return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  if (day === today - 1) return 'Yesterday';
  if (today - day < 7) return WEEKDAYS[d.getUTCDay()];
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** The reading pane's date: "Thu, Sep 24, 2026 at 14:05". @param {number} t */
export function long(t) {
  const d = new Date(t);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} at ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** Cuts text to `n` characters with an ellipsis: the same cut on every renderer. @param {string} text @param {number} n */
export const clip = (text, n) => (text.length <= n ? text : `${text.slice(0, Math.max(1, n - 1)).trimEnd()}…`);
