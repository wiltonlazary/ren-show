// Scheduling: when work runs. Each scenario is a script on a fresh graph
// (kit.jsx `lab`) whose notes show the order things happened in.

import { $signal, $read, $write, $memo, $effect, $watch, $render, $flush, $batch, $batching, $auto, $defer, $deferred, $after, $settled, $commit, $task } from 'rrx-core';
import { $active, Action, Layout } from 'ren-core';
import { lab, Lines, Block } from '../kit.jsx';

/** @type {Record<string, { title: string, run: (root: import('rrx-core').Graph, note: (text: string) => void) => void }>} */
export const scenarios = {
  coalesce: {
    title: 'Writes coalesce until $flush',
    run: (root, note) => {
      const a = $signal(root, 1);
      const b = $signal(root, 2);
      $effect(root, () => note(`effect: a + b = ${$read(a) + $read(b)}`));
      $write(a, 10);
      $write(b, 20);
      note('wrote a and b: the effect has not run again');
      $flush(root);
      note('$flush: it ran once for both writes');
    },
  },
  auto: {
    title: '$auto flushes each write; $batch groups them',
    run: (root, note) => {
      $auto(root, true);
      const a = $signal(root, 1);
      const b = $signal(root, 2);
      $effect(root, () => note(`effect: a + b = ${$read(a) + $read(b)}`));
      $write(a, 10);
      $write(b, 20);
      note('$auto on: two writes, two runs');
      $batch(root, () => {
        $write(a, 100);
        $write(b, 200);
        note(`inside $batch ($batching = ${$batching(root)})`);
      });
      note('$batch: one run at its end');
    },
  },
  lanes: {
    title: '$defer queues work in the low lane',
    run: (root, note) => {
      const urgent = $signal(root, 0);
      const background = $signal(root, 0);
      $effect(root, () => note(`background effect sees ${$read(background)} ($deferred = ${$deferred(root)})`));
      $effect(root, () => note(`urgent effect sees ${$read(urgent)} ($deferred = ${$deferred(root)})`));
      $defer(root, () => $write(background, 1));
      $write(urgent, 1);
      $flush(root);
      note('the urgent effect ran first, though it was created second');
    },
  },
  phases: {
    title: 'The phases of one flush',
    run: (root, note) => {
      const source = $signal(root, 0);
      const derived = $memo(root, () => $read(source) * 10);
      $effect(root, () => note(`effect reads ${$read(derived)}`));
      $watch(root, () => $read(derived), value => note(`$watch applies ${value}`));
      $render(root, () => $read(derived), value => note(`$render applies ${value}`));
      $commit(root, null, () => note('$commit hook, after each round'));
      $flush(root);
      note('--- write and flush ---');
      $write(source, 1);
      $after(root, () => note('$after, once the graph settles'));
      $settled(root, () => note('$settled, once no task is pending'));
      $flush(root);
    },
  },
  settled: {
    title: '$settled waits for tasks',
    run: (root, note) => {
      /** @type {((result: any) => void) | null} */
      let complete = null;
      $task(root, () => 1, (_input, done) => {
        complete = done;
      });
      $settled(root, () => note('$settled: nothing pending'));
      $flush(root);
      note('flushed with a pending task: not settled yet');
      /** @type {any} */ (complete)({ ok: true, value: 1 });
      $flush(root);
    },
  },
};

function View() {
  const R = $active();
  const shown = $signal(R, /** @type {string[]} */ ([]));
  const which = $signal(R, '');
  const play = (/** @type {string} */ key) => {
    $write(which, key);
    $write(shown, lab(scenarios[key].run));
  };
  return (
    <div class="demo">
      <Block title="Scenarios" note="Each one runs on its own graph with $auto off (unless it turns it on), then disposes it.">
        <Layout layout="row" gap={8} wrap>
          {Object.keys(scenarios).map(key => (
            <Action wrap text={scenarios[key].title} selected={() => $read(which) === key} onPress={() => play(key)} />
          ))}
        </Layout>
        <Lines of={shown} />
      </Block>
    </div>
  );
}

export default {
  id: 'scheduling',
  group: 'rrx-core',
  title: 'Scheduling',
  apis: ['$flush', '$batch', '$batching', '$auto', '$defer', '$deferred', '$after', '$settled', '$commit'],
  summary: 'Writes coalesce until $flush unless $auto is on, and $batch groups them. $defer queues work in a low lane. A flush runs in fixed phases: effects, $render, $watch, $commit, $after, $settled.',
  View,
};
