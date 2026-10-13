// The Issues app's fake server, on the environment's clock (`later`): its
// own copy of the tracker, latency on every request, and a deterministic
// failure now and then (every fourth write is rejected; the first activity
// request of every eleventh issue fails), so the optimistic moves, the
// rollbacks and the error boundaries run for real in the page and in tests.

import { generate, fresh, EPOCH, PEOPLE, STATUSES } from './data.js';

/**
 * @typedef {import('./data.js').Issue} Issue
 * @typedef {import('rrx-core').Result<any>} Result
 * @typedef {{ id: string, kind: 'created' | 'status' | 'priority' | 'assignee' | 'comment', who: string | null, text: string, at: number }} Entry
 */

/** Every fourth write is rejected. */
export const REJECT_EVERY = 4;

/** @param {import('../../assets.js').Environment} env @param {number} [count] */
export function server(env, count = 2000) {
  /** The server's truth, by id. @type {Map<string, Issue>} */
  const truth = new Map(generate(count).map(i => [i.id, i]));
  let requests = 0;
  let writes = 0;
  let rounds = 0;
  /** @type {Set<string>} */
  const failedOnce = new Set();
  /** @type {Map<string, Entry[]>} */
  const comments = new Map();
  const stats = { requests: 0, aborted: 0, rejected: 0 };
  /** Latency in ms: 180–420, varying per request. */
  const latency = () => 180 + ((requests++ * 97) % 241);
  /**
   * Runs `fn` after the latency; the returned cancel aborts it.
   * @param {() => void} fn
   */
  const answer = fn => {
    stats.requests++;
    let done = false;
    const cancel = env.later(latency(), () => { // timer: feature, the fake server's latency
      done = true;
      fn();
    });
    return () => {
      if (done) return;
      done = true;
      stats.aborted++;
      cancel();
    };
  };
  /** True when this write is rejected. */
  const rejects = () => {
    const no = ++writes % REJECT_EVERY === 0;
    if (no) stats.rejected++;
    return no;
  };
  const now = () => EPOCH + env.now();
  return {
    stats,
    /**
     * Moves an issue to a status.
     * @param {string} id @param {import('./data.js').Status} status @param {(result: Result) => void} complete
     */
    move(id, status, complete) {
      const rejected = rejects();
      return answer(() => {
        const found = truth.get(id);
        if (rejected || found === undefined) complete({ ok: false, error: new Error(`${id} could not move: it changed on the server`) });
        else {
          truth.set(id, { ...found, status, updated: now() });
          complete({ ok: true, value: status });
        }
      });
    },
    /**
     * A write-through save of fields edited in the app (no latency, never
     * rejected), so a sync never reverts them.
     * @param {string} id @param {Partial<Issue>} fields
     */
    save(id, fields) {
      const found = truth.get(id);
      if (found !== undefined) truth.set(id, { ...found, ...fields });
    },
    /**
     * The activity of an issue: its history and comments.
     * @param {string} id @param {(result: Result) => void} complete
     */
    activity(id, complete) {
      return answer(() => {
        const found = truth.get(id);
        if (found === undefined) return complete({ ok: false, error: new Error(`${id} not found`) });
        if (found.number % 11 === 0 && !failedOnce.has(id)) {
          failedOnce.add(id);
          return complete({ ok: false, error: new Error('the activity service timed out') });
        }
        complete({ ok: true, value: history(found).concat(comments.get(id) ?? []) });
      });
    },
    /**
     * Posts a comment.
     * @param {{ id: string, text: string }} input @param {(result: Result) => void} complete
     */
    comment(input, complete) {
      const rejected = rejects();
      return answer(() => {
        if (rejected) return complete({ ok: false, error: new Error('the comment was not saved') });
        /** @type {Entry} */
        const entry = { id: `c${writes}`, kind: 'comment', who: 'you', text: input.text, at: now() };
        comments.set(input.id, [...(comments.get(input.id) ?? []), entry]);
        complete({ ok: true, value: entry });
      });
    },
    /**
     * A full snapshot after the team's own changes: a few issues moved on,
     * reassigned or reprioritized, and two new ones. Every row is a new
     * object, as parsed from the network.
     * @param {(result: Result) => void} complete
     */
    sync(complete) {
      return answer(() => {
        rounds++;
        const open = [...truth.values()].filter(i => i.status !== 'shipped' && i.status !== 'dropped');
        for (let k = 0; k < 8; k++) {
          const target = open[(rounds * 131 + k * 257) % open.length];
          const at = now();
          const next = STATUSES[Math.min(4, STATUSES.findIndex(s => s.id === target.status) + 1)].id;
          truth.set(target.id, k % 3 === 0 ? { ...target, status: next, updated: at } : k % 3 === 1 ? { ...target, assignee: PEOPLE[(rounds + k) % PEOPLE.length].id, updated: at } : { ...target, priority: /** @type {any} */ ((target.priority % 4) + 1), updated: at });
        }
        for (let k = 0; k < 2; k++) {
          const made = fresh(truth.size + 1, rounds * 10 + k);
          truth.set(made.id, made);
        }
        complete({ ok: true, value: [...truth.values()].map(i => ({ ...i, labels: [...i.labels] })) });
      });
    },
  };
}

/**
 * The generated history of an issue: created, its moves and a few comments,
 * deterministic per issue.
 * @param {Issue} issue @returns {Entry[]}
 */
function history(issue) {
  const n = issue.number;
  const who = (/** @type {number} */ k) => PEOPLE[(n + k) % PEOPLE.length].id;
  /** @type {Entry[]} */
  const out = [{ id: 'h0', kind: 'created', who: who(0), text: 'created the issue', at: issue.created }];
  const span = Math.max(1, issue.updated - issue.created);
  const steps = ['ready', 'doing', 'checking', 'shipped'];
  const reached = Math.max(0, steps.indexOf(issue.status) + 1);
  for (let k = 0; k < reached; k++) out.push({ id: `h${k + 1}`, kind: 'status', who: issue.assignee ?? who(k), text: `moved to ${STATUSES.find(s => s.id === steps[k])?.name}`, at: issue.created + Math.round((span * (k + 1)) / (reached + 1)) });
  const remarks = [
    'I can reproduce this on main.',
    'Bisected to the last scheduler change; looking into it.',
    'Added a failing test, see the linked branch.',
    'This also shows in the market benchmark run from yesterday.',
    'Could we keep the old behaviour behind a flag until the next release?',
    'Pairing on this tomorrow morning.',
    'Measured: 12% faster on the keyed table, no change elsewhere.',
  ];
  for (let k = 0; k < n % 4; k++) out.push({ id: `m${k}`, kind: 'comment', who: who(k + 3), text: remarks[(n + k) % remarks.length], at: issue.created + Math.round((span * (k + 1)) / (n % 4 + 1)) + 1 });
  return out.sort((a, b) => a.at - b.at);
}
