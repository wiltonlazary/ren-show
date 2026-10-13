// Asynchronous values: tasks and streams read like signals, pending reads are
// caught by Pending, and optimistic actions show their result before the
// server answers. Every delay goes through the environment's clock.

import { $signal, $read, $write, $after, $lookup, $task, $stream, $load, $outcome, $lastReady, $pending, $rerun, $behind, $whenDone, $optimistic, $act } from 'rrx-core';
import { $active, Action, Edit, Label, Layout, For, Pending, Recover, Show } from 'ren-core';
import { Assets } from '../assets.js';
import { Journal, Lines, Block, Value } from '../kit.jsx';
import { tone } from '../themes.js';

export const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliett', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa'];
/** The simulated server's latency, in milliseconds. */
export const LATENCY = 400;

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const journal = Journal(R);
  const note = journal.note;

  // A search task: new input cancels the running request.
  const query = $signal(R, 'a');
  let failNext = false;
  const search = $task(R, () => $read(query), (/** @type {string} */ q, complete) =>
    env.later(LATENCY, () => { // timer: feature, the simulated request's latency
      if (failNext) {
        failNext = false;
        complete({ ok: false, error: new Error('the server said no') });
      } else complete({ ok: true, value: WORDS.filter(w => w.includes(q.toLowerCase())) });
    }),
  );
  // Load reports the outcome as data and keeps the last ready value while newer work runs.
  const summary = $load(R, () => `${$read(search).length} results`);

  // A stream: values arrive one by one, then it completes.
  const runs = $signal(R, 0);
  const ticker = $stream(R, () => $read(runs), (/** @type {number} */ run, next, complete) => {
    if (run === 0) return complete({ ok: true, value: 'not started' });
    let i = 0;
    let cancel = () => {};
    const step = () => {
      if (++i < 5) {
        next(`run ${run}: chunk ${i}`);
        cancel = env.later(150, step); // timer: feature, the stream's chunk pace
      } else complete({ ok: true, value: `run ${run}: complete` });
    };
    cancel = env.later(150, step); // timer: feature, the stream's chunk pace
    return () => cancel();
  });
  const start = () => {
    $write(runs, $read(runs) + 1);
    // After the flush restarts the stream, $whenDone waits for its first value.
    $after(R, () => $whenDone(R, ticker, outcome => note(`$whenDone: first value "${outcome.value}"`)));
  };

  // Optimistic updates: a held seat shows at once; a refusal releases it.
  const seats = $signal(R, ['A1']);
  const optimistic = $optimistic(R, seats);
  let refuse = false;
  let next = 1;
  const hold = $act(
    R,
    optimistic,
    (/** @type {string[]} */ list, /** @type {string} */ seat) => [...list, seat],
    (/** @type {string} */ _seat, complete) => {
      const refused = refuse;
      return env.later(LATENCY, () => complete(refused ? { ok: false, error: new Error('sold out') } : { ok: true, value: null })); // timer: feature, the simulated booking's latency
    },
    result => note(result.ok ? 'the box office confirmed the seat' : `box office: ${result.error.message}, the seat is released`),
  );
  /** @param {boolean} refused */
  const request = refused => {
    refuse = refused;
    return hold(`A${++next}`);
  };

  return (
    <div class="demo">
      <Block title="Task, Pending and Recover" note="Type to search. The first load shows the Pending fallback; later searches keep the results visible while the new request runs.">
        <Layout layout="row" gap={8}>
          <Edit label="Search" value={query} onChange={e => $write(query, e.value)} />
          <Action text="Rerun" onPress={() => $rerun(search)} />
          <Action text="Fail the next request" onPress={() => void (failNext = true)} />
        </Layout>
        <p class="values">
          <Value label="Outcome" value={() => $outcome(search).status} />
          <Value label="Pending" value={() => String($pending(search))} />
          <Value label="Behind" value={() => String($behind(search))} />
          <Value label="Last ready" value={() => ($lastReady(search) ?? []).length} />
          <Value label="Load" value={() => `${$read(summary).status}: ${$read(summary).value ?? '-'}`} />
        </p>
        <Recover
          fallback={(/** @type {Error} */ error, /** @type {() => void} */ reset) => (
            <Layout layout="row" gap={8}>
              <Label text={`failed: ${error.message}`} color={tone('danger')} />
              <Action
                text="Retry"
                onPress={() => {
                  $rerun(search);
                  reset();
                }}
              />
            </Layout>
          )}
        >
          <Pending fallback={<p class="quiet">Loading the first results…</p>}>
            <ul class="words">
              <For each={() => $read(search)} fallback={<li class="quiet">no match</li>}>
                {word => <li>{word}</li>}
              </For>
            </ul>
          </Pending>
        </Recover>
      </Block>
      <Block title="$stream and $whenDone">
        <Layout layout="row" gap={8}>
          <Action text="Start a stream" onPress={start} />
          <Label text={() => {
            const outcome = $outcome(ticker);
            return `${outcome.status}: ${outcome.value ?? '…'}`;
          }} />
        </Layout>
      </Block>
      <Block title="$optimistic and $act" note="A held seat shows at once, marked pending, and is confirmed or released when the box office answers.">
        <Layout layout="row" gap={8}>
          <Action text="Hold a seat (confirmed)" onPress={() => request(false)} />
          <Action text="Hold a seat (sold out)" onPress={() => request(true)} />
          <Action text="Hold, then let go" onPress={() => request(false)()} />
        </Layout>
        <ul class="words seats">
          <For each={optimistic.value}>
            {seat => <li class={() => ($read(seats).includes(seat()) ? '' : 'pending')}>{seat}</li>}
          </For>
        </ul>
        <Show when={optimistic.pending}>
          <p class="quiet">waiting for the box office…</p>
        </Show>
      </Block>
      <Block title="Journal">
        <Lines of={journal.lines} />
      </Block>
    </div>
  );
}

export default {
  id: 'tasks',
  group: 'rrx-core',
  title: 'Tasks and optimism',
  apis: ['$task', '$stream', '$load', '$outcome', '$lastReady', '$pending', '$rerun', '$behind', '$whenDone', '$optimistic', '$act', 'Pending'],
  summary: 'A task is an asynchronous value that reads like a signal. A pending read throws a sentinel, which Pending, $outcome and $load turn back into data. $optimistic and $act layer updates over a base value until the server answers.',
  View,
};
