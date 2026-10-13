// Resilience: failures reach the nearest boundary from every place they can
// start, and components torn down with work in flight leave nothing behind.

import { $signal, $read, $write, $untrack, $memo, $effect, $watch, $after, $lookup, $cleanup, $owner, $catch } from 'rrx-core';
import { $active, Action, Label, Layout, For, Show, Recover, Props, Root } from 'ren-core';
import { Assets } from '../assets.js';
import { Async, latency } from '../async.js';
import { Journal, Lines, Block, Value } from '../kit.jsx';
import { tone } from '../themes.js';

/** The places a failure can start, each shown under its own Recover. */
const PLACES = ['body', 'binding', 'effect', 'watch', 'cleanup', 'handler'];

/** A component that fails in one place once armed. @param {{ place: string, armed: any }} props */
function Faulty(props) {
  const R = $active();
  const place = props.place;
  const armed = props.armed;
  if (place === 'body' && $read(armed)) throw new Error('thrown while building');
  if (place === 'effect')
    $effect(R, () => {
      if ($read(armed)) throw new Error('thrown by an effect');
    });
  if (place === 'watch')
    $watch(R, () => $read(armed), on => {
      if (on) throw new Error('thrown by a $watch apply');
    });
  if (place === 'cleanup')
    $cleanup(/** @type {any} */ ($owner(R)), () => {
      if ($untrack(R, () => $read(armed))) throw new Error('thrown by a cleanup');
    });
  return (
    <Layout layout="row" gap={8}>
      <Label
        text={() => {
          if (place === 'binding' && $read(armed)) throw new Error('thrown by a binding');
          return `${place}: fine`;
        }}
      />
      {place === 'handler' ? (
        <Action
          text="Fail in the handler"
          onPress={() => {
            // ren-core delivers what a handler throws to the boundary around its element.
            throw new Error('thrown by a handler');
          }}
        />
      ) : null}
    </Layout>
  );
}

/**
 * A component body runs once, so the body case rebuilds Faulty whenever it
 * is armed: a component that returns a region (a tracked function).
 * @param {{ place: string, armed: any }} props
 */
const Rebuilt = props => () => ($read(props.armed), <Faulty place={props.place} armed={props.armed} />);

/** A widget with async work in flight: a request, a polling loop and a cleanup. @param {{ n: number, stats: any }} props */
function Busy(props) {
  const R = $active();
  const env = $lookup(Assets);
  const stats = props.stats;
  const ticks = $signal(R, 0);
  const load = Async(R, () => props.n, async (/** @type {number} */ n, signal) => {
    stats.started++;
    signal.addEventListener('abort', () => stats.aborted++);
    await latency(env.later, 400 * env.pace, signal);
    stats.completed++;
    return `widget ${n} loaded`;
  });
  let cancel = env.later(100 * env.pace, function poll() { // timer: feature, the ticker's interval
    $write(ticks, $read(ticks) + 1);
    cancel = env.later(100 * env.pace, poll); // timer: feature, the ticker's interval
  });
  $cleanup(/** @type {any} */ ($owner(R)), () => {
    cancel();
    stats.cleaned++;
  });
  return <li>{() => `#${props.n} ticks ${$read(ticks)}, ${$read(load)}`}</li>;
}

/** A plain component with a memo, an effect and a cleanup. @param {{ n: number, count: { built: number, cleaned: number } }} props */
function Cell(props) {
  const R = $active();
  const twice = $memo(R, () => props.n * 2);
  $effect(R, () => void $read(twice));
  props.count.built++;
  $cleanup(/** @type {any} */ ($owner(R)), () => void props.count.cleaned++);
  return <i>{props.n % 1000 === 0 ? `${props.n} ` : ''}</i>;
}

/**
 * The disposal lab's application, in a root of its own (so its disposal
 * options are its own): it shows as many cells as its props ask for.
 * @param {{ count: { built: number, cleaned: number } }} props
 */
function Cells(props) {
  const cells = $memo($active(), () => {
    const n = Number($lookup(Props) ?? 0);
    return Array.from({ length: n }, (_, i) => i + 1);
  });
  return (
    <p class="cells">
      <For each={cells}>{n => <Cell n={n()} count={props.count} />}</For>
    </p>
  );
}

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const journal = Journal(R, 12);
  // This demo's own boundary: whatever no Recover handles lands here.
  $catch(/** @type {any} */ ($owner(R)), error => journal.note(`demo boundary caught: ${error.message}`));

  const arms = PLACES.map(() => $signal(R, false));
  const shown = PLACES.map(() => $signal(R, true));

  // Work in flight: widgets removed before their requests finish.
  const stats = { started: 0, aborted: 0, completed: 0, cleaned: 0 };
  const widgets = $signal(R, /** @type {number[]} */ ([]));
  const flight = $signal(R, { ...stats });
  // After the handler's flush settles, when removed widgets have stopped.
  const report = () => $after(R, () => $write(flight, { ...stats }));

  // Disposal lab: a nested root builds and disposes many components, in
  // the background (ren-core retires them and sweeps in paced slices) or at once.
  const sizes = [5000, 20000, 100000];
  const size = $signal(R, sizes[0]);
  const background = $signal(R, true);
  const population = $signal(R, 0);
  const count = { built: 0, cleaned: 0 };
  const timing = $signal(R, 'nothing timed yet');
  const drain = $signal(R, /** @type {import('../assets.js').Drain | null} */ (null));
  const cleaned = $signal(R, 0);
  const built = $signal(R, 0);
  /**
   * Times a handler's work up to the settled flush and layout: the handler
   * runs as a $batch, so its flush happens after it returns; $after runs then.
   * @param {string} what @param {() => void} fn
   */
  const timed = (what, fn) => {
    const start = env.now();
    fn();
    $after(R, () => {
      env.settle();
      $write(timing, `${what}: ${(env.now() - start).toFixed(1)} ms in the handler, ${count.cleaned} of ${count.built} cleanups run so far`);
      $write(built, count.built);
      $write(cleaned, count.cleaned);
    });
  };
  /** The lab root's drain report, delivered after its last slice. @param {import('../assets.js').Drain} report */
  const swept = report => {
    $write(drain, report);
    $write(built, count.built);
    $write(cleaned, count.cleaned);
  };

  return (
    <div class="demo">
      <Block title="Failures reach the nearest boundary" note="Arm a place: its component fails there, and its Recover shows the failure. Reset rebuilds it. An armed cleanup fails when its component is hidden: the component still goes, and the failure reaches the same boundary. What no Recover handles lands in this demo's own $catch (the journal).">
        {PLACES.map((place, i) => (
          <div class="place">
            <Layout layout="row" gap={8}>
              <Action text={`Arm ${place}`} selected={arms[i]} onPress={() => $write(arms[i], !$read(arms[i]))} />
              {place === 'cleanup' ? <Action text={() => ($read(shown[i]) ? 'Hide it' : 'Show it')} onPress={() => $write(shown[i], !$read(shown[i]))} /> : null}
            </Layout>
            <Recover
              fallback={(/** @type {Error} */ error, /** @type {() => void} */ reset) => (
                <Layout layout="row" gap={8}>
                  <Label text={`caught: ${error.message}`} color={tone('danger')} />
                  <Action
                    text={`Reset ${place}`}
                    onPress={() => {
                      $write(arms[i], false);
                      reset();
                    }}
                  />
                </Layout>
              )}
            >
              <Show when={shown[i]} fallback={<Label text={`${place}: hidden`} />}>
                {place === 'body' ? <Rebuilt place={place} armed={arms[i]} /> : <Faulty place={place} armed={arms[i]} />}
              </Show>
            </Recover>
          </div>
        ))}
      </Block>
      <Block title="Disposal with work in flight" note="Each widget has a request and a polling timer running. Removing widgets aborts their requests, stops their timers and runs their cleanups. Late results change nothing.">
        <Layout layout="row" gap={8}>
          <Action
            text="Start 20 widgets"
            onPress={() => {
              const base = $read(widgets).length;
              $write(widgets, [...$read(widgets), ...Array.from({ length: 20 }, (_, i) => base + i + 1)]);
              report();
            }}
          />
          <Action
            text="Remove them all"
            onPress={() => {
              $write(widgets, []);
              report();
            }}
          />
          <Action text="Refresh the counts" onPress={report} />
        </Layout>
        <p class="values">
          <Value label="requests started" value={() => $read(flight).started} />
          <Value label="aborted" value={() => $read(flight).aborted} />
          <Value label="completed" value={() => $read(flight).completed} />
          <Value label="cleanups run" value={() => $read(flight).cleaned} />
        </p>
        <ul class="widgets">
          <For each={widgets}>{n => <Busy n={n()} stats={stats} />}</For>
        </ul>
      </Block>
      <Block title="Background disposal" note="Build many components (each with a memo, an effect and a cleanup) in a root of their own, then dispose them all. In the background, ren-core removes the nodes at once, makes the components inert, and frees them in small slices in idle time. At once stops every component inside the handler.">
        <Layout layout="row" gap={8} wrap>
          {sizes.map(n => (
            <Action text={`${n.toLocaleString('en')} components`} selected={() => $read(size) === n} onPress={() => $write(size, n)} />
          ))}
          <Action text={() => ($read(background) ? 'Mode: in the background' : 'Mode: at once')} selected={background} onPress={() => ($write(population, 0), $write(background, !$read(background)))} />
        </Layout>
        <Layout layout="row" gap={8}>
          <Action text="Build" onPress={() => timed(`built ${$read(size).toLocaleString('en')}`, () => $write(population, $read(size)))} />
          <Action text="Dispose all" onPress={() => timed('disposed all', () => $write(population, 0))} />
        </Layout>
        <Label text={timing} />
        <p class="values">
          <Value label="components cleaned" value={() => `${$read(cleaned)} of ${$read(built)}`} />
          <Value label="drain slices" value={() => $read(drain)?.slices ?? '-'} />
          <Value label="longest slice" value={() => ($read(drain) ? `${/** @type {any} */ ($read(drain)).longest.toFixed(2)} ms` : '-')} />
          <Value label="sweeping time" value={() => ($read(drain) ? `${/** @type {any} */ ($read(drain)).busy.toFixed(1)} ms` : '-')} />
          <Value label="freed after" value={() => ($read(drain) ? `${/** @type {any} */ ($read(drain)).time.toFixed(1)} ms` : '-')} />
          <Value label="late frames" value={() => $read(drain)?.late ?? '-'} />
        </p>
        {() => {
          // A new lab root per mode: its disposal options are fixed when it starts.
          const retire = $read(background) ? 1000 : false;
          return (
            <Root id="disposal-lab" storage={null} retire={retire} swept={swept} props={() => $read(population)}>
              {() => <Cells count={count} />}
            </Root>
          );
        }}
      </Block>
      <Block title="Journal">
        <Lines of={journal.lines} />
      </Block>
    </div>
  );
}

export default {
  id: 'resilience',
  group: 'ren-core',
  title: 'Resilience',
  apis: ['Recover', '$catch', '$cleanup', '$after', 'AbortSignal', 'retire', 'swept'],
  summary: 'A failure goes to the nearest boundary wherever it starts: a component body, a binding, an effect, a $watch apply, a cleanup or a handler. Components removed while their work is in flight abort that work and leave nothing live. Large sets of components are disposed in the background, in paced slices.',
  View,
};
