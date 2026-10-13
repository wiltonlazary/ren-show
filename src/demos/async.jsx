// Async JavaScript with rrx-core and ren-core: promises, async/await, AbortController
// and async generators, on real timers. src/async.js turns an async function
// into a Task and an async iterable into a Stream.

import { $signal, $read, $write, $memo, $lookup, $settled, $outcome, $pending } from 'rrx-core';
import { $active, Action, Edit, Label, Layout, For, Pending, Recover, Show } from 'ren-core';
import { Assets } from '../assets.js';
import { Async, Each, latency } from '../async.js';
import { Journal, Lines, Block, Value } from '../kit.jsx';
import { tone } from '../themes.js';

/** Real delays of the demo, in milliseconds (times the environment's pace). */
export const DELAYS = { forecast: 300, typing: 250, part: 200, retry: 150, timeout: 500, tick: 200 };

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const ms = (/** @type {keyof typeof DELAYS} */ key) => DELAYS[key] * env.pace;
  const journal = Journal(R, 10);
  const note = journal.note;

  // An async function as a task: a new city aborts the request in flight.
  const city = $signal(R, 1);
  let aborted = 0;
  const abortions = $signal(R, 0);
  const forecast = Async(R, () => $read(city), async (/** @type {number} */ n, signal) => {
    // Count only requests aborted while still waiting (a finished one is cancelled too, harmlessly).
    const counted = () => $write(abortions, ++aborted);
    signal.addEventListener('abort', counted);
    await latency(env.later, ms('forecast'), signal);
    signal.removeEventListener('abort', counted);
    if (n % 13 === 0) throw new Error(`city ${n} has no weather station`);
    return { n, name: ['Lisbon', 'Oslo', 'Nairobi', 'Lima', 'Hanoi'][n % 5], high: 10 + ((n * 7) % 15) };
  });

  // Debounce with async/await: each keystroke aborts the previous wait.
  const query = $signal(R, '');
  const searches = $signal(R, 0);
  let searched = 0;
  const results = Async(R, () => $read(query), async (/** @type {string} */ q, signal) => {
    await latency(env.later, ms('typing'), signal);
    $write(searches, ++searched);
    return q === '' ? [] : ['async', 'await', 'abort', 'promise', 'generator', 'iterator'].filter(w => w.includes(q));
  });

  // Parallel tasks: one Pending waits for all of them, like Promise.all.
  const round = $signal(R, 0);
  const part = (/** @type {string} */ name, /** @type {number} */ factor) =>
    Async(R, () => $read(round), async (/** @type {number} */ r, signal) => {
      await latency(env.later, ms('part') * factor, signal);
      return `${name}#${r}`;
    });
  const parts = [part('a', 1), part('b', 2), part('c', 3)];
  const joined = $memo(R, () => parts.map(p => $read(p)).join(' + '));

  // Promise.race against a timeout, and retries with backoff.
  const slow = $signal(R, false);
  const raced = Async(R, () => $read(slow), async (/** @type {boolean} */ isSlow, signal) => {
    const work = latency(env.later, isSlow ? ms('timeout') * 2 : ms('timeout') / 4, signal).then(() => 'answered in time');
    const timeout = latency(env.later, ms('timeout'), signal).then(() => {
      throw new Error('timed out');
    });
    return Promise.race([work, timeout]);
  });
  const attempt = $signal(R, 0);
  const retried = Async(R, () => $read(attempt), async (/** @type {number} */ run, signal) => {
    if (run === 0) return 'press Retry';
    for (let tries = 1; ; tries++) {
      await latency(env.later, ms('retry') * 2 ** (tries - 1), signal);
      // The flaky call succeeds on the third try.
      if (tries >= 3) return `succeeded after ${tries} tries`;
      note(`try ${tries} failed, backing off`);
    }
  });

  // An async generator as a stream.
  const count = $signal(R, 0);
  const countdown = Each(R, () => $read(count), async function* (/** @type {number} */ from, signal) {
    for (let i = from; i >= 0; i--) {
      yield i === 0 ? 'liftoff' : String(i);
      if (i > 0) await latency(env.later, ms('tick'), signal);
    }
  });

  // Awaiting the graph from async code: $settled as a promise.
  const settled = () => new Promise(resolve => $settled(R, () => resolve(undefined)));
  const refreshAll = async () => {
    $write(round, $read(round) + 1);
    note('started three parallel requests');
    await settled();
    // A write after an await is outside every handler batch: $auto flushes it.
    note(`all settled: ${$read(joined)}`);
  };

  return (
    <div class="demo">
      <Block title="async functions as tasks" note="Each city starts an async request for its forecast. Changing the city aborts the request in flight through its AbortSignal. Cities whose number is a multiple of 13 fail.">
        <Layout layout="row" gap={8}>
          <Action text="Previous city" onPress={() => $write(city, Math.max(1, $read(city) - 1))} />
          <Action text="Next city" onPress={() => $write(city, $read(city) + 1)} />
          <Action text="City 13" onPress={() => $write(city, 13)} />
        </Layout>
        <Recover
          fallback={(/** @type {Error} */ error, /** @type {() => void} */ reset) => (
            <Layout layout="row" gap={8}>
              <Label text={`failed: ${error.message}`} color={tone('danger')} />
              <Action
                text="Back to city 1"
                onPress={() => {
                  $write(city, 1);
                  reset();
                }}
              />
            </Layout>
          )}
        >
          <Pending fallback={<p class="quiet">loading the forecast…</p>}>
            <Label text={() => `city ${$read(forecast).n}: ${$read(forecast).name}, high ${$read(forecast).high} °C`} />
          </Pending>
        </Recover>
        <p class="values">
          <Value label="pending" value={() => String($pending(forecast))} />
          <Value label="aborted" value={abortions} />
        </p>
      </Block>
      <Block title="Debounce with await" note="Type quickly: each keystroke aborts the previous wait, so only the last one searches.">
        <Edit label="Search async words" value={query} onChange={e => $write(query, e.value)} />
        <p class="values">
          <Value label="searches run" value={searches} />
          <Value label="results" value={() => ($outcome(results).value ?? []).join(', ') || '—'} />
        </p>
      </Block>
      <Block title="Promise.all, awaiting $settled" note="Three requests of different lengths. One Pending holds until all of them are ready. The handler awaits $settled before it notes the result.">
        <Action text="Refresh all three" onPress={refreshAll} />
        <Pending fallback={<p class="quiet">waiting for all three…</p>}>
          <Label text={joined} />
        </Pending>
      </Block>
      <Block title="Promise.race and retries">
        <Layout layout="row" gap={8}>
          <Action text={() => ($read(slow) ? 'Make it fast' : 'Make it slow')} onPress={() => $write(slow, !$read(slow))} />
          <Label text={() => {
            const o = $outcome(raced);
            return o.status === 'failed' ? `race: ${o.error.message}` : `race: ${o.status} ${o.value ?? ''}`;
          }} />
        </Layout>
        <Layout layout="row" gap={8}>
          <Action text="Retry" onPress={() => $write(attempt, $read(attempt) + 1)} />
          <Label text={() => `retry: ${$outcome(retried).value ?? '…'}`} />
        </Layout>
      </Block>
      <Block title="Async generators as streams">
        <Layout layout="row" gap={8}>
          <Action text="Count down from 5" onPress={() => $write(count, 5)} />
          <Show when={() => $read(count) > 0}>
            <Label text={() => `${$outcome(countdown).status}: ${$outcome(countdown).value ?? ''}`} />
          </Show>
        </Layout>
      </Block>
      <Block title="Journal">
        <Lines of={journal.lines} />
      </Block>
    </div>
  );
}

export default {
  id: 'async',
  group: 'rrx-core',
  title: 'Async JavaScript',
  apis: ['$task', '$stream', 'AbortSignal', 'async/await', 'Promise.all', 'Promise.race', 'async generators', '$settled'],
  summary: 'Promises, async functions and async generators become tasks and streams. A superseded request is aborted through its AbortSignal. Pending, Recover and $outcome handle the waiting and the failures.',
  View,
};
