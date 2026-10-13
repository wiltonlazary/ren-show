// Signals, memos and observers: the reactive core's primitives.

import { $signal, $read, $write, $memo, $scan, $derive, $equals, $watch, $render, $effect, $untrack } from 'rrx-core';
import { $active, Action, Edit, Label, Layout } from 'ren-core';
import { Journal, Lines, Block, Value } from '../kit.jsx';

function View() {
  const R = $active();
  const journal = Journal(R);
  const note = journal.note;

  // A signal is a writable source; a memo is lazy and caches its value.
  const count = $signal(R, 0);
  const step = $signal(R, 1);
  let doubled = 0;
  const double = $memo(R, () => (doubled++, $read(count) * 2));
  // The parity memo changes only on every other write: its readers run then only.
  const parity = $memo(R, () => ($read(count) % 2 === 0 ? 'even' : 'odd'));
  // $watch: a pure tracked read, applied after the graph settles and only on change.
  $watch(R, () => $read(parity), value => note(`$watch: parity is ${value}`));
  // $render applies earlier in the flush than $watch (the renderer's phase).
  $render(R, () => $read(count), value => note(`$render: count is ${value}`));
  // $scan folds each new value into its previous result.
  const history = $scan(R, /** @type {number[]} */ ([]), previous => [...previous.slice(-5), $read(count)]);
  // $untrack: the step is read untracked, so changing it reruns nothing.
  const add = () => $write(count, $read(count) + $untrack(R, () => $read(step)));

  // $derive: a writable derivation that follows its source until written locally.
  const people = ['Nora Quill', 'Tamsin Varga', 'Oskar Lindqvist'];
  const chosen = $signal(R, 0);
  const draft = $derive(R, () => people[$read(chosen)]);

  // Equals: a custom equality decides whether a write notifies.
  const point = $equals($signal(R, { x: 0, y: 0 }), (a, b) => a.x === b.x && a.y === b.y);
  let moved = 0;
  const moves = $signal(R, 0);
  $effect(R, () => {
    const p = $read(point);
    moved++;
    // An effect may write: it is not a pure computation.
    $write(moves, moved);
    note(`$effect: point at ${p.x},${p.y}`);
  });

  return (
    <div class="demo">
      <Block title="$signal, $memo, $watch, $render, $scan" note="Each write flushes at once here (ren-core turns on $auto). The parity $watch runs only when parity changes; $render applies before $watch.">
        <Layout layout="row" gap={8}>
          <Action text="+ step" onPress={add} />
          <Action text="- 1" onPress={() => $write(count, $read(count) - 1)} />
          <Action text={() => `step is ${$read(step)}`} onPress={() => $write(step, $read(step) === 1 ? 5 : 1)} />
        </Layout>
        <p class="values">
          <Value label="count" value={count} />
          <Value label="double (memo)" value={double} />
          <Value label="double computed" value={() => ($read(double), `${doubled}×`)} />
          <Value label="parity" value={parity} />
          <Value label="last six ($scan)" value={() => $read(history).join(' ')} />
        </p>
      </Block>
      <Block title="$derive" note="The draft follows the chosen person until you edit it; choosing another person resets it.">
        <Layout layout="row" gap={8}>
          {people.map((name, i) => (
            <Action text={name.split(' ')[0]} selected={() => $read(chosen) === i} onPress={() => $write(chosen, i)} />
          ))}
        </Layout>
        <Edit label="Draft" value={draft} onChange={e => $write(draft, e.value)} />
        <Label text={() => `draft: ${$read(draft)}`} />
      </Block>
      <Block title="$equals" note="Writing an equal point notifies nobody; moving it does.">
        <Layout layout="row" gap={8}>
          <Action text="Write the same point" onPress={() => $write(point, { ...$read(point) })} />
          <Action text="Move right" onPress={() => $write(point, { x: $read(point).x + 1, y: $read(point).y })} />
        </Layout>
        <Label text={() => `effect runs: ${$read(moves)}`} />
      </Block>
      <Block title="Journal">
        <Lines of={journal.lines} />
      </Block>
    </div>
  );
}

export default {
  id: 'signals',
  group: 'rrx-core',
  title: 'Signals and memos',
  apis: ['$signal', '$read', '$write', '$memo', '$scan', '$derive', '$equals', '$watch', '$render', '$effect', '$untrack'],
  summary: 'Signals hold values. Memos derive values lazily and cache them. $watch and $render apply changes after the graph settles. Effects run eagerly.',
  View,
};
