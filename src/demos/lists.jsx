// Lists: keyed rows that move instead of rebuilding, positional rows, O(1)
// selection, and rrx-core's list operations under the components.

import * as rrx from 'rrx-core';
import { $signal, $writable, $read, $write, $after, $memo, $effect, $flush, $keyed, $rows, $select, $merge, $split } from 'rrx-core';
import { $active, Action, Layout, For } from 'ren-core';
import { lab, Lines, Block, Value } from '../kit.jsx';

/** rrx-core's list operations, scripted on a lab graph. */
export const script = () =>
  lab((root, note) => {
    const items = $signal(root, [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
    /** @type {string[]} */
    const built = [];
    // $keyed: one row per key, built once; item and index are signals.
    const keyed = $keyed(root, () => $read(items), item => item.id, (item, index) => {
      built.push($read(item).id);
      return $memo(root, () => `${$read(index)}:${$read(item).id}=${$read(item).v}`);
    });
    const show = () => $read(keyed).map(m => $read(m)).join(' ');
    note(`$keyed: ${show()}`);
    $write(items, [{ id: 'b', v: 20 }, { id: 'c', v: 3 }, { id: 'a', v: 1 }]);
    note(`reordered and updated: ${show()}; built ${built.join(', ')} (b and a kept)`);
    // Rows: the item is an accessor whose signal exists once read tracked.
    const rows = $rows(root, () => $read(items), item => item.id, item => item);
    $effect(root, () => void $read(rows));
    note(`$rows: ${$read(rows).map(item => item().id).join(' ')}`);
    // $positions: rows by position; the item signal follows the value there.
    const positions = rrx.$positions(root, () => $read(items).map(item => item.id), (item, index) => $memo(root, () => `${$read(index)}=${$read(item)}`));
    note(`$positions: ${$read(positions).map(m => $read(m)).join(' ')}`);
    // $select: only the old and new keys' readers run.
    const selected = $signal(root, 'a');
    const is = $select(root, () => $read(selected));
    let runs = 0;
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f'])
      $effect(root, () => {
        is(key);
        runs++;
      });
    runs = 0;
    $write(selected, 'c');
    $flush(root);
    note(`$select: 6 readers, changing a → c ran ${runs}`);
    // $merge and $split: property sources, later ones winning, split by keys.
    const props = $merge([{ color: 'red', size: 1 }, () => ({ size: 2 }), { label: 'go' }]);
    const [style, rest] = $split(props, [['color', 'size']]);
    note(`$merge: size ${props('size')}; $split: style has color ${style('color')}, rest has label ${rest('label')} and color ${rest('color')}`);
  });

const NAMES = ['Nora', 'Tamsin', 'Oskar', 'Bea', 'Dario', 'Freya', 'Joel', 'Mira', 'Anton', 'Rhea'];

function View() {
  const R = $active();
  const people = $signal(R, NAMES.slice(0, 5).map((name, i) => ({ id: i + 1, name })));
  let next = 6;
  let built = 0;
  // Rows build inside the list's computation, so the counter must be $writable.
  const builds = $writable($signal(R, 0));
  const selected = $signal(R, 0);
  const is = $select(R, () => $read(selected));
  let checks = 0;
  const checked = $signal(R, 0);
  const shuffle = () => {
    const list = $read(people).slice();
    for (let i = list.length - 1; i > 0; i--) {
      const j = (i * 7 + 3) % (i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
    $write(people, list);
  };
  const letters = $signal(R, ['x', 'y', 'z']);
  const ran = $signal(R, /** @type {string[]} */ ([]));
  const select = (/** @type {number} */ id) => {
    checks = 0;
    $write(selected, id);
    // $after runs once the flush has settled, when the rows' checks have rerun.
    $after(R, () => $write(checked, checks));
  };
  return (
    <div class="demo">
      <Block title="For: keyed rows, and $select" note="Rows are built once per key and move on reorder. Selecting a row reruns the check of only the old and new rows.">
        <Layout layout="row" gap={8} wrap>
          <Action text="Add" onPress={() => $write(people, [...$read(people), { id: next, name: NAMES[next++ % NAMES.length] }])} />
          <Action text="Remove first" onPress={() => $write(people, $read(people).slice(1))} />
          <Action text="Reverse" onPress={() => $write(people, $read(people).slice().reverse())} />
          <Action text="Shuffle" onPress={shuffle} />
          <Action text="Clear" onPress={() => $write(people, [])} />
        </Layout>
        <ul class="rows">
          <For each={people} by={p => p.id} fallback={<li class="quiet">empty</li>}>
            {(person, index) => {
              built++;
              $write(builds, built);
              return (
                <li
                  class={() => {
                    checks++;
                    return is(person().id) ? 'selected' : '';
                  }}
                  onClick={() => select(person().id)}
                >
                  {() => `${index() + 1}. ${person().name} #${person().id}`}
                </li>
              );
            }}
          </For>
        </ul>
        <p class="values">
          <Value label="rows built" value={builds} />
          <Value label="checks on the last selection" value={checked} />
        </p>
      </Block>
      <Block title="For by position: positional rows" note="Each position keeps its row, and the item accessor follows the value at that position.">
        <Layout layout="row" gap={8}>
          <Action text="Rotate" onPress={() => $write(letters, [...$read(letters).slice(1), $read(letters)[0]])} />
          <Action text="Grow" onPress={() => $write(letters, [...$read(letters), String.fromCharCode(97 + $read(letters).length)])} />
        </Layout>
        <ol class="words">
          <For by="position" each={letters}>{(letter, i) => <li>{`${i}: `}{letter}</li>}</For>
        </ol>
      </Block>
      <Block title="$keyed, $rows, $positions, $select, $merge, $split" note="The rrx-core operations under the components, run on a lab graph.">
        <Action text="Run" onPress={() => $write(ran, script())} />
        <Lines of={ran} />
      </Block>
    </div>
  );
}

export default {
  id: 'lists',
  group: 'rrx-core',
  title: 'Lists and selection',
  apis: ['For', 'For by position', '$keyed', '$rows', '$positions', '$select', '$merge', '$split'],
  summary: 'For keeps one row per key and moves rows with the fewest host moves. For by position keeps one row per position. $select answers "is this key selected?" so that a change notifies only two rows.',
  View,
};
