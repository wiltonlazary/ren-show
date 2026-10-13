// Async in the graph: a memo may return a promise; an update
// that makes a shown value pending is held whole until it is ready (no
// tearing); stale content stays visible; Pending again, Sequence, Times, For
// keying, a quiet $rerun and one announced with $changing; the development diagnostics. Every
// delay goes through the environment's clock.

import { $signal, $read, $write, $memo, $lookup, $task, $pending, $behind, $lastReady, $rerun, $changing, $development, $cleanup, $owner, $untrack } from 'rrx-core';
import { $active, Action, Layout, Label, Pending, Sequence, Times, For } from 'ren-core';
import { Assets } from '../assets.js';
import { Journal, Lines, Block, Value } from '../kit.jsx';

/** The simulated server's latency, in milliseconds. */
export const LATENCY = 300;
const CITIES = ['Lisbon', 'Oslo', 'Nairobi', 'Lima', 'Hanoi'];
const SKIES = ['sunny', 'cloudy', 'rain', 'windy', 'snow'];

/** A promise that resolves with `value` after `ms` on the environment's clock. @template T @param {any} env @param {number} ms @param {T} value @returns {Promise<T>} */
const after = (env, ms, value) => new Promise(resolve => env.later(ms, () => resolve(value))); // timer: feature, a demo's simulated latency

/** A tab that loads its own data the first time it shows. @param {{ name: string }} props */
function Tab(props) {
  const env = $lookup(Assets);
  const data = $memo($active(), () => after(env, LATENCY, `${props.name}: loaded`));
  return <p class="tab">{() => $read(data)}</p>;
}

/** A card that shows once its answer arrives (its own delay). @param {{ label: string, ms: number }} props */
function Card(props) {
  const env = $lookup(Assets);
  const answer = $memo($active(), () => after(env, props.ms, `${props.label} (${props.ms} ms)`));
  return (
    <Pending fallback={<div class="card quiet">{`${props.label}…`}</div>}>
      <div class="card">{() => $read(answer)}</div>
    </Pending>
  );
}

/** Reads its name once, in its body: it never updates (development mode reports it). @param {{ name: any }} props */
function Frozen(props) {
  const once = $read(props.name);
  return <p class="frozen">{`frozen read: ${once}`}</p>;
}

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const journal = Journal(R);
  const note = journal.note;

  // An async memo: the promise it returns is its value, pending until then.
  const city = $signal(R, 1);
  const forecast = $memo(R, () => {
    const n = $read(city);
    return after(env, LATENCY, `${CITIES[n % CITIES.length]}: ${SKIES[(n * 3) % SKIES.length]}`);
  });

  // Stale content stays visible: the new tab loads before it replaces the old one.
  const tab = $signal(R, 'one');

  // Pending again: a new key shows the fallback again.
  const page = $signal(R, 1);
  const article = $memo(R, () => after(env, LATENCY, `article ${$read(page)}`));

  // Sequence: three cards answer in their own time; the order decides how they show.
  const order = $signal(R, /** @type {'in-turn' | 'at-once' | 'as-ready'} */ ('in-turn'));
  const run = $signal(R, 0);

  // Times and For keying.
  const count = $signal(R, 3);
  const people = $signal(R, [{ id: 1, name: 'Nora' }, { id: 2, name: 'Tamsin' }, { id: 3, name: 'Oskar' }]);
  let builds = 0;

  // Development diagnostics: a component that reads a signal in its body.
  const dev = $signal(R, false);
  const frozen = $signal(R, 0);
  const name = $signal(R, 'Nora');

  // A quiet rerun, and one announced with $changing.
  let version = 0;
  const report = $task(R, () => 1, (_, complete) => env.later(LATENCY, () => complete({ ok: true, value: `report v${++version}` }))); // timer: feature, the report's simulated latency

  // Development mode is the page's; leave it off when the demo closes.
  $cleanup(/** @type {any} */ ($owner(R)), () => void ($untrack(R, () => $read(dev)) && $development(false, null)));

  return (
    <div class="demo">
      <Block title="An async memo, and no tearing" note="The forecast is a memo that returns a promise. Next city changes the city: the city and its forecast show together once the answer arrives. Pending shows the change in flight at once.">
        <Layout layout="row" gap={8}>
          <Action text="Next city" onPress={() => $write(city, $read(city) + 1)} />
        </Layout>
        <Pending fallback={<p class="quiet">loading the forecast…</p>}>
          <p class="forecast">{() => `#${$read(city)} ${$read(forecast)}`}</p>
          <p class="values">
            <Value label="city" value={() => String($read(city))} />
            <Value label="forecast" value={() => $read(forecast)} />
          </p>
        </Pending>
        <p class="values">
          <Value label="pending" value={() => String($pending(forecast))} />
          <Value label="chosen city" value={() => String($lastReady(city))} />
        </p>
      </Block>
      <Block title="Stale content stays visible" note="Tab two loads its data the first time it shows. The old tab stays, live, until the new one is ready; the tab bar changes with it.">
        <Layout layout="row" gap={8}>
          <Action text="Tab one" onPress={() => $write(tab, 'one')} />
          <Action text="Tab two" onPress={() => $write(tab, 'two')} />
        </Layout>
        <Pending fallback={<p class="quiet">loading…</p>}>
          <p class="values"><Value label="tab" value={tab} /></p>
          {() => ($read(tab) === 'one' ? <p class="tab">one: always here</p> : <Tab name="two" />)}
        </Pending>
      </Block>
      <Block title="Pending again on a key" note="With again, a new page shows the fallback again instead of the stale article.">
        <Layout layout="row" gap={8}>
          <Action text="Next page" onPress={() => $write(page, $read(page) + 1)} />
        </Layout>
        <Pending again={page} fallback={<p class="quiet">loading the page…</p>}>
          <p class="article">{() => $read(article)}</p>
        </Pending>
      </Block>
      <Block title="Sequence" note="Three cards answer after 450, 150 and 300 ms. In turn, each waits for those before it; at once, all together; as ready, each on its own.">
        <Layout layout="row" gap={8}>
          <Action text="In turn" onPress={() => ($write(order, 'in-turn'), $write(run, $read(run) + 1))} />
          <Action text="At once" onPress={() => ($write(order, 'at-once'), $write(run, $read(run) + 1))} />
          <Action text="As ready" onPress={() => ($write(order, 'as-ready'), $write(run, $read(run) + 1))} />
        </Layout>
        <p class="values"><Value label="order" value={order} /></p>
        {() => {
          const mode = $read(order);
          $read(run);
          return (
            <div class="cards">
              <Sequence order={mode}>
                <Card label="first" ms={450} />
                <Card label="second" ms={150} />
                <Card label="third" ms={300} />
              </Sequence>
            </div>
          );
        }}
      </Block>
      <Block title="Times and For keying" note="Times renders by count, adding and removing at the end. For keyed by id moves rows; For by position keeps each position's row.">
        <Layout layout="row" gap={8}>
          <Action text="More" onPress={() => $write(count, $read(count) + 1)} />
          <Action text="Fewer" onPress={() => $write(count, Math.max(0, $read(count) - 1))} />
          <Action text="Reverse people" onPress={() => $write(people, [...$read(people)].reverse())} />
        </Layout>
        <ol class="times">
          <Times count={count} fallback={<li class="quiet">none</li>}>{i => <li>{`row ${i}`}</li>}</Times>
        </ol>
        <p class="keyed"><For each={people} by={(/** @type {any} */ p) => p.id}>{p => (builds++, <b>{() => p().name}</b>)}</For></p>
        <p class="positional"><For each={people} by="position">{p => <i>{() => p().name}</i>}</For></p>
        <p class="values"><Value label="keyed rows built" value={() => ($read(people), String(builds))} /></p>
      </Block>
      <Block title="Quiet and announced reruns" note="Run again quietly: the shown report stays ready while the next version is fetched, and replaces it when it lands. Announced, $changing marks the report first, so it reads pending, and behind its next version, until that lands.">
        <Layout layout="row" gap={8}>
          <Action text="Run again quietly" onPress={() => $rerun(report)} />
          <Action
            text="Run again, announced"
            onPress={() => {
              $changing(report);
              $rerun(report);
            }}
          />
        </Layout>
        <Pending fallback={<p class="quiet">loading the report…</p>}>
          <p class="report">{() => $read(report)}</p>
        </Pending>
        <p class="values">
          <Value label="report pending" value={() => String($pending(report))} />
          <Value label="report behind" value={() => String($behind(report))} />
        </p>
      </Block>
      <Block title="Development diagnostics" note="In development (the development export condition, or $development), a reactive read in a component body is reported: it runs once and never updates. Turn it on, then insert the component.">
        <Layout layout="row" gap={8}>
          <Action
            text={() => (($read(dev) ? 'Development: on' : 'Development: off'))}
            onPress={() => {
              const on = !$read(dev);
              $development(on, on ? message => note(message) : null);
              $write(dev, on);
            }}
          />
          <Action text="Insert a frozen read" onPress={() => $write(frozen, $read(frozen) + 1)} />
        </Layout>
        {() => ($read(frozen) > 0 ? <Frozen name={name} /> : null)}
        <Lines of={journal.lines} />
      </Block>
    </div>
  );
}

export default {
  id: 'transitions',
  group: 'ren-core',
  title: 'Async in the graph',
  apis: ['$memo (async)', '$pending', '$behind', '$lastReady', '$rerun', '$changing', 'Pending again', 'Sequence', 'Times', 'For by', '$development'],
  summary: 'A memo may return a promise or an async iterator. An update that makes a shown value pending is held whole until it is ready, so the screen never mixes new and old state; indicators show the change in flight. Sequence orders Pendings; Times renders by count; development mode reports reads nothing tracks.',
  View,
};
