// The rrx-core demos: each one opened in an application root, driven through its
// buttons and fields, and checked against what rrx-core promises.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { open, clock } from './page.jsx';
import signals from '../src/demos/signals.jsx';
import scheduling, { scenarios } from '../src/demos/scheduling.jsx';
import ownership, { lifecycle } from '../src/demos/ownership.jsx';
import context, { provided } from '../src/demos/context.jsx';
import errors, { script as failures } from '../src/demos/errors.jsx';
import tasks, { LATENCY } from '../src/demos/tasks.jsx';
import stores from '../src/demos/stores.jsx';
import lists, { script as listing } from '../src/demos/lists.jsx';
import introspection from '../src/demos/introspection.jsx';
import { lab } from '../src/kit.jsx';

/** The value shown under a caption. @param {ReturnType<typeof open>} page @param {string} label */
const value = (page, label) => page.all('.value').find(v => v.querySelector('small').textContent === label)?.querySelector('b').textContent;

describe('signals', () => {
  it('derives lazily, applies on change, folds history and follows a draft', () => {
    const page = open(signals.View);
    assert.equal(value(page, 'count'), '0');
    page.click('+ step');
    page.click('+ step');
    assert.equal(value(page, 'count'), '2');
    assert.equal(value(page, 'double (memo)'), '4');
    assert.equal(value(page, 'parity'), 'even');
    assert.equal(value(page, 'last six ($scan)'), '0 1 2');
    page.click('step is 1');
    page.click('+ step');
    assert.equal(value(page, 'count'), '7', 'the step is read untracked but used');
    // Parity went even → odd → even → odd: $watch applied each change once.
    assert.deepEqual(page.log().filter(l => l.startsWith('$watch')), ['$watch: parity is even', '$watch: parity is odd', '$watch: parity is even', '$watch: parity is odd']);
    const draft = page.all('input')[0];
    assert.equal(draft.value, 'Nora Quill');
    page.type(draft, 'Nora K.');
    assert.ok(page.text().includes('draft: Nora K.'));
    page.click('Tamsin');
    assert.equal(draft.value, 'Tamsin Varga', 'a source change resets the local write');
    page.click('Write the same point');
    assert.ok(page.text().includes('effect runs: 1'), 'an equal write notifies nobody');
    page.click('Move right');
    assert.ok(page.text().includes('effect runs: 2'));
    page.dispose();
  });
});

describe('scheduling', () => {
  it('shows each scenario in the order rrx-core runs it', () => {
    assert.deepEqual(lab(scenarios.coalesce.run), ['effect: a + b = 3', 'wrote a and b: the effect has not run again', 'effect: a + b = 30', '$flush: it ran once for both writes']);
    assert.deepEqual(lab(scenarios.auto.run), [
      'effect: a + b = 3',
      'effect: a + b = 12',
      'effect: a + b = 30',
      '$auto on: two writes, two runs',
      'inside $batch ($batching = true)',
      'effect: a + b = 300',
      '$batch: one run at its end',
    ]);
    const lanes = lab(scenarios.lanes.run);
    assert.deepEqual(lanes.slice(2), ['urgent effect sees 1 ($deferred = false)', 'background effect sees 1 ($deferred = true)', 'the urgent effect ran first, though it was created second']);
    const settled = lab(scenarios.settled.run);
    assert.deepEqual(settled, ['flushed with a pending task: not settled yet', '$settled: nothing pending']);
    const page = open(scheduling.View);
    page.click(scenarios.phases.title);
    const phases = page.log();
    const after = phases.slice(phases.indexOf('--- write and flush ---') + 1);
    assert.deepEqual(after, ['effect reads 10', '$render applies 10', '$watch applies 10', '$commit hook, after each round', '$after, once the graph settles', '$settled, once no task is pending']);
    page.dispose();
  });
});

describe('ownership', () => {
  it('spawns scopes, stops them newest first, and counts what is live', () => {
    const page = open(ownership.View);
    page.click('Spawn a scope');
    assert.deepEqual(page.log(), ['scope 1 sees tick 0', 'scope 1: mounted']);
    // The pool had one node (the tick); a scope adds a memo, an effect, and a child scope.
    assert.equal(value(page, 'nodes'), '3');
    assert.equal(value(page, 'scopes'), '2');
    assert.equal(value(page, 'effects'), '2', 'the effect, and the memo it watches');
    page.click('Tick');
    assert.equal(page.log().at(-1), 'scope 1 sees tick 1');
    page.click('Spawn a scope');
    page.click('Release cleanup');
    assert.equal(page.log().at(-1), 'scope 1: cleanup released, 0 left');
    page.click('Stop');
    assert.deepEqual(page.log().slice(-2), ['scope 1: child scope stopped', 'scope 1 alive: false']);
    page.click('Stop');
    assert.deepEqual(page.log().slice(-3), ['scope 2: child scope stopped', 'scope 2: cleanup ran', 'scope 2 alive: false']);
    assert.equal(value(page, 'nodes'), '1');
    assert.equal(value(page, 'scopes'), '0');
    page.click('Make unowned');
    assert.equal(value(page, 'nodes'), '2');
    page.click('Discard it');
    assert.equal(value(page, 'nodes'), '1');
    assert.equal(page.log().at(-1), 'discarded it; its handle still reads "unowned"');
    page.dispose();
  });

  it("runs a graph's life: cancel, whenUnwatched, retire and sweep on the host's schedule, dispose", () => {
    assert.deepEqual(lifecycle(), [
      'effect sees 0',
      'effect sees 1',
      'count lost its last observer ($whenUnwatched)',
      'effect cancelled ($cancel)',
      'a scope of 100 memos retired at once; the sweeper was asked 1 time(s)',
      '$sweep freed it: 0 left to sweep',
      '$closed before $dispose: false',
      '$closed after: true',
    ]);
  });
});

describe('context', () => {
  it('reads the nearest provider, updates only below it, and re-enters a captured layer', () => {
    const page = open(context.View);
    const cards = () => page.texts('[data-ren="Label"]').filter(t => t.includes(': tone'));
    assert.deepEqual(cards(), ['outside: tone plain, size 14', 'dark: tone dark, size 14', 'follows a signal: tone warm, size 14']);
    page.click('Set the signal to cool');
    assert.equal(cards()[2], 'follows a signal: tone cool, size 14');
    page.all('button').filter(b => b.textContent === 'Update the nearest tone')[0].click();
    assert.equal(cards()[0], 'outside: tone plain, size 14 (nothing provides Tone here)', 'no provider: `$update` throws, and the card says so');
    page.all('button').filter(b => b.textContent === 'Update the nearest tone')[1].click();
    assert.deepEqual(cards(), ['outside: tone plain, size 14 (nothing provides Tone here)', 'dark: tone dark!, size 14', 'follows a signal: tone cool, size 14']);
    page.all('button').filter(b => b.textContent === 'Update the nearest tone')[2].click();
    assert.equal(cards()[2], 'follows a signal: tone cool!, size 14');
    page.click('Read the tone here and in the captured layer');
    assert.deepEqual(page.log(), ['here: plain', '$with(captured): cool!']);
    page.click('List the entries visible in the captured layer');
    assert.equal(page.log().at(-1), 'Tone=cool! (plus the root’s built-in contexts)');
    assert.deepEqual(provided(), ['outside: plain', 'inside $provide: lab', 'after $update: lab, updated', 'outside again: plain']);
    page.dispose();
  });
});

describe('errors', () => {
  it('keeps failures as data, catches them at owners, and resets a boundary', () => {
    assert.deepEqual(failures(), [
      'ratio: 5',
      '$outcome: failed (division by zero)',
      'a source change recomputes it: 2',
      'scope caught: effect failed',
      'scope caught: thrown by hand',
      '$deliver without a boundary returns: no boundary at the root',
      'root caught: now handled',
      '$deliver with a root boundary returns: null',
    ]);
    const page = open(errors.View);
    assert.ok(page.text().includes('100 / 4 = 25'));
    page.type(page.all('input')[0], '0');
    assert.ok(page.text().includes('failed: cannot divide 100 by zero'));
    page.click('Set 1 and reset');
    assert.ok(page.text().includes('100 / 1 = 100'));
    page.dispose();
  });
});

describe('tasks', () => {
  it('loads, reruns, fails, streams and acts optimistically on the clock', () => {
    const time = clock();
    const page = open(tasks.View, { later: time.later, now: time.now });
    const words = () => page.texts('ul.words')[0];
    assert.ok(page.text().includes('Loading the first results…'));
    assert.equal(value(page, 'Pending'), 'true');
    time.advance(LATENCY);
    assert.equal(value(page, 'Outcome'), 'ready');
    assert.ok(words().startsWith('alphabravocharlie'));
    page.type(page.all('input')[0], 'ec');
    assert.equal(value(page, 'Behind'), 'true', 'the old results stay while the new request runs');
    assert.ok(words().startsWith('alpha'));
    // A transition holds the update whole: values show the last consistent
    // state, indicators ($pending, $behind, $outcome) the change in flight.
    assert.equal(value(page, 'Load'), 'ready: 8 results', 'Load is held with the rest of the update');
    assert.equal(value(page, 'Outcome'), 'pending');
    time.advance(LATENCY);
    assert.equal(words(), 'echo');
    assert.equal(value(page, 'Load'), 'ready: 1 results');
    page.click('Fail the next request');
    page.click('Rerun');
    time.advance(LATENCY);
    assert.equal(value(page, 'Outcome'), 'failed');
    assert.equal(value(page, 'Last ready'), '1', 'the last ready value is kept');
    assert.ok(page.text().includes('failed: the server said no'));
    page.click('Retry');
    time.advance(LATENCY);
    assert.equal(words(), 'echo');
    page.click('Start a stream');
    time.advance(150);
    assert.ok(page.text().includes('ready: run 1: chunk 1'));
    time.advance(600);
    assert.ok(page.text().includes('ready: run 1: complete'));
    assert.ok(page.log().includes('$whenDone: first value "run 1: chunk 1"'));
    const seats = () => page.all('ul.seats')[0].children;
    page.click('Hold a seat (confirmed)');
    page.click('Hold a seat (sold out)');
    assert.deepEqual([...seats()].map(li => [li.textContent, li.className]), [['A1', ''], ['A2', 'pending'], ['A3', 'pending']]);
    assert.ok(page.text().includes('waiting for the box office…'));
    time.advance(LATENCY);
    assert.deepEqual([...seats()].map(li => [li.textContent, li.className]), [['A1', ''], ['A2', '']]);
    assert.deepEqual(page.log().slice(-2), ['the box office confirmed the seat', 'box office: sold out, the seat is released']);
    page.click('Hold, then let go');
    assert.equal(seats().length, 2, 'a cancelled action drops its update');
    assert.equal(time.pending(), 0);
    page.dispose();
  });
});

describe('stores', () => {
  it('notifies by path, projects, reuses and overlays', () => {
    const page = open(stores.View);
    // Each $watch applies its first value as the view opens; count from there.
    const opened = page.log().length;
    page.click('Put age + 1');
    assert.deepEqual(page.log().slice(opened), ['user.age → 37', 'user → {"name":"Nora","age":37}']);
    page.click('Update user.name');
    assert.deepEqual(page.log().slice(-2), ['user.name → "Tamsin"', 'user → {"name":"Tamsin","age":37}']);
    page.click('Put an equal user');
    assert.deepEqual(page.log().slice(-2), ['put an equal user: a new object at user, equal name and age', 'user → {"name":"Tamsin","age":37}']);
    assert.equal(page.log().slice(opened).filter(l => l.startsWith('user.')).length, 2, 'name and age did not notify');
    page.click('Add a tag');
    assert.equal(page.log().at(-1), 'tags → ["math","engines","tag2"]');
    assert.equal(page.all('pre.raw')[0].textContent, '{"user":{"name":"Tamsin","age":37},"tags":["math","engines","tag2"]}');
    page.click('Add a low score');
    assert.equal(value(page, 'total'), '17');
    assert.equal(page.log().slice(opened).filter(l => l.startsWith('mirror')).length, 0, 'max did not change');
    page.click('Add a high score');
    assert.equal(page.log().at(-1), 'mirror: max → 9');
    const first = page.all('ul.words li')[0];
    page.click('Refetch the rows');
    assert.deepEqual(page.texts('ul.words li'), ['three', 'ONE', 'two']);
    assert.ok(page.text().includes('2 of 3 row objects kept'));
    assert.ok(page.all('ul.words li').includes(first) === false, 'the changed row was rebuilt');
    page.click('Like (layer)');
    page.click('Like (layer)');
    assert.deepEqual([value(page, 'shown'), value(page, 'stored'), value(page, 'pending')], ['12', '10', 'true']);
    page.click('Commit the oldest');
    page.click('Settle (drop) the oldest');
    assert.deepEqual([value(page, 'shown'), value(page, 'stored'), value(page, 'pending')], ['11', '11', 'false']);
    // A polled document: deepEqual keeps an equal poll quiet; preserve keeps the unchanged section's object.
    assert.deepEqual(page.log(1), ['profile → {"name":"Nora","city":"Lisbon"}', 'alerts → {"email":true,"sms":false}']);
    page.click('Poll, nothing changed');
    assert.deepEqual(page.log(1).slice(2), ['polled, nothing changed'], 'no section notified');
    page.click('Poll, alerts changed');
    assert.deepEqual(page.log(1).slice(-3), ['polled, the SMS alert changed', 'profile → {"name":"Nora","city":"Lisbon"}', 'alerts → {"email":true,"sms":true}']);
    page.click('Poll, alerts changed (preserve)');
    assert.deepEqual(page.log(1).slice(-2), ['polled, the SMS alert changed (preserve)', 'alerts → {"email":true,"sms":false}']);
    page.dispose();
  });
});

describe('lists', () => {
  it('keeps keyed rows, selects in O(1) and maps by position', () => {
    assert.deepEqual(listing(), [
      '$keyed: 0:a=1 1:b=2',
      'reordered and updated: 0:b=20 1:c=3 2:a=1; built a, b, c (b and a kept)',
      '$rows: b c a',
      '$positions: 0=b 1=c 2=a',
      '$select: 6 readers, changing a → c ran 2',
      '$merge: size 2; $split: style has color red, rest has label go and color null',
    ]);
    const page = open(lists.View);
    const rows = () => page.all('ul.rows li');
    const before = rows();
    page.click('Reverse');
    assert.deepEqual(rows(), before.slice().reverse(), 'rows move instead of rebuilding');
    assert.equal(rows()[0].textContent, '1. Dario #5');
    page.click('Shuffle');
    page.click('Add');
    assert.equal(value(page, 'rows built'), '6');
    rows()[2].click();
    assert.equal(rows()[2].className, 'selected');
    rows()[4].click();
    assert.equal(value(page, 'checks on the last selection'), '2', 'only the old and new rows were checked');
    page.click('Clear');
    assert.deepEqual(page.texts('ul.rows li'), ['empty']);
    const first = page.all('ol.words li')[0];
    page.click('Rotate');
    assert.deepEqual(page.texts('ol.words li'), ['0: y', '1: z', '2: x']);
    assert.equal(page.all('ol.words li')[0], first, 'positions keep their rows');
    page.dispose();
  });
});

describe('introspection', () => {
  it('reports sources, observers and kinds, and reruns without writes', () => {
    const page = open(introspection.View);
    assert.equal(value(page, 'total'), '111');
    assert.equal(value(page, '$sources(total)'), 'a, useB, b');
    assert.equal(value(page, 'Kind'), 'a: signal, total: memo');
    assert.match(value(page, 'this binding'), /^effect #\d+$/);
    page.click('Stop using b');
    assert.equal(value(page, '$sources(total)'), 'a, useB');
    assert.equal(value(page, '$observers(b)'), '0');
    const runs = () => Number(value(page, 'computed').slice(0, -1));
    const before = runs();
    page.click('b + 1');
    assert.equal(runs(), before, 'b is not among its sources');
    page.click('Change the variable and Invalidate');
    assert.equal(value(page, 'total'), '201');
    page.click('Touch a');
    assert.equal(runs(), before + 2);
    page.dispose();
  });
});
