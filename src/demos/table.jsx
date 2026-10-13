// A keyed table of generated rows, live: every operation is
// timed from the handler to the forced layout that shows it.

import { $signal, $read, $write, $after, $batch, $lookup, $select, $cleanup, $owner } from 'rrx-core';
import { $active, Action, Layout, Label, For } from 'ren-core';
import { Assets } from '../assets.js';
import { latency } from '../async.js';
import { Block, Value } from '../kit.jsx';

const TONES = ['quiet', 'bright', 'steady', 'amber', 'crisp', 'gentle', 'rapid', 'hollow', 'silver', 'woven', 'rustic', 'lucid', 'nimble', 'polar', 'sunny', 'velvet', 'brisk', 'misty', 'noble', 'tidal'];
const MATERIALS = ['cedar', 'granite', 'linen', 'copper', 'glass', 'wool', 'slate', 'bamboo', 'clay', 'marble'];
const OBJECTS = ['lantern', 'kettle', 'compass', 'ladder', 'basket', 'anchor', 'violin', 'teapot', 'easel', 'hammock', 'satchel', 'sundial'];

/** @typedef {{ id: number, label: import('rrx-core').Writable<string> }} Row */

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const rows = $signal(R, /** @type {Row[]} */ ([]));
  const selected = $signal(R, 0);
  const is = $select(R, () => $read(selected));
  const timing = $signal(R, 'press an operation');
  let next = 1;
  let seed = 1;
  /** @param {readonly string[]} list */
  const pick = list => list[(seed = (seed * 1103515245 + 12345) & 0x7fffffff) % list.length];
  /** @param {number} count @returns {Row[]} */
  const build = count => {
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = { id: next++, label: $signal(R, `${pick(TONES)} ${pick(MATERIALS)} ${pick(OBJECTS)}`) };
    return out;
  };
  /**
   * Times an operation from the handler to the settled flush and a forced
   * layout: the handler runs as a $batch, which flushes after it returns, and
   * After runs once that flush settles.
   * @param {string} name @param {() => void} fn
   */
  const run = (name, fn) => () => {
    const start = env.now();
    fn();
    $after(R, () => {
      env.settle();
      $write(timing, `${name}: ${(env.now() - start).toFixed(1)} ms (${$read(rows).length} rows)`);
    });
  };
  const ops = {
    'Make 1,000 rows': () => $write(rows, build(1000)),
    'Make 10,000 rows': () => $write(rows, build(10000)),
    'Add 1,000 more': () => $write(rows, [...$read(rows), ...build(1000)]),
    'Mark every tenth row': () => {
      const list = $read(rows);
      for (let i = 0; i < list.length; i += 10) $write(list[i].label, `${$read(list[i].label)} (marked)`);
    },
    'Trade rows 2 and 999': () => {
      const list = $read(rows).slice();
      if (list.length < 999) return;
      const a = list[1];
      list[1] = list[998];
      list[998] = a;
      $write(rows, list);
    },
    'Empty the table': () => $write(rows, []),
  };
  const remove = (/** @type {number} */ id) => $write(rows, $read(rows).filter(row => row.id !== id));
  // Rows from async data: the handler awaits a
  // simulated request, then writes; the timing runs to the rows on screen.
  const loading = $signal(R, false);
  const load = async () => {
    const start = env.now();
    $write(loading, true);
    await latency(env.later, 120 * env.pace);
    // After an await no handler batch is open: one $batch, so $after runs
    // once its flush has settled.
    $batch(R, () => {
      $write(rows, build(1000));
      $write(loading, false);
      $after(R, () => {
        env.settle();
        $write(timing, `Load 1,000 rows (async): ${(env.now() - start).toFixed(1)} ms from the click, ${(120 * env.pace).toFixed(0)} ms of it the request (${$read(rows).length} rows)`);
      });
    });
  };
  // Emptying 1,000 rows or more disposes them in the background:
  // the nodes go in the handler, the rows are freed in paced slices after.
  const drain = $signal(R, /** @type {import('../assets.js').Drain | null} */ (null));
  $cleanup(/** @type {any} */ ($owner(R)), env.drains.listen(report => $write(drain, report)));
  return (
    <div class="demo">
      <Block title="Keyed table" note="Each timing runs from the handler to a forced layout. Picking a row reruns only two rows' class bindings ($select). Removing a row moves nothing else. Emptying 1,000 rows or more removes the nodes at once and frees the rows in the background; the drain shows below.">
        <Layout layout="row" gap={8} wrap>
          {Object.entries(ops).map(([name, fn]) => (
            <Action text={name} onPress={run(name, fn)} />
          ))}
        </Layout>
        <Layout layout="row" gap={8}>
          <Action text={() => ($read(loading) ? 'Loading 1,000 rows…' : 'Load 1,000 rows (async)')} onPress={load} />
        </Layout>
        <Label text={timing} />
        <p class="values">
          <Value label="last background drain" value={() => {
            const d = $read(drain);
            return d === null ? 'none yet (empty 1,000 rows or more)' : `${d.slices} slices, longest ${d.longest.toFixed(2)} ms, freed after ${d.time.toFixed(1)} ms`;
          }} />
        </p>
        <table class="table">
          <tbody>
            <For each={rows} by={row => row.id}>
              {row => {
                const { id, label } = row();
                return (
                  <tr class={() => (is(id) ? 'chosen' : '')}>
                    <td class="id">{id}</td>
                    <td>
                      <a onClick={run('Pick a row', () => $write(selected, id))}>{label}</a>
                    </td>
                    <td>
                      <a class="remove" onClick={run('Remove a row', () => remove(id))}>
                        ×
                      </a>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </Block>
    </div>
  );
}

export default {
  id: 'table',
  group: 'ren-core',
  title: 'Keyed table',
  apis: ['For', '$select', '$signal', '$batch', 'async/await', 'retire', 'swept'],
  summary: 'A keyed table of generated rows: make, add, mark, trade, pick, remove and empty, plus rows loaded from async data and large removals freed in the background. Each operation is timed in the page, including layout.',
  View,
};
