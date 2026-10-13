// Introspection: what a node is, what it read, who watches it, and ways to
// make it run again without a write.

import { $signal, $writable, $read, $write, $memo, $kind, $sources, $observers, $identity, $invalidate, $touch, $observer, $untrack } from 'rrx-core';
import { $active, Action, Label, Layout } from 'ren-core';
import { Block, Value } from '../kit.jsx';

function View() {
  const R = $active();
  const a = $signal(R, 1);
  const b = $signal(R, 10);
  const useB = $signal(R, true);
  let outside = 100;
  // A $writable counter: the memo may write it, and it shows runs that change nothing.
  const computed = $writable($signal(R, 0));
  // Dynamic dependencies: total reads b only while useB holds.
  const total = $memo(R, () => {
    $write(computed, $untrack(R, () => $read(computed)) + 1);
    return $read(a) + ($read(useB) ? $read(b) : 0) + outside;
  });
  const names = new Map(/** @type {[unknown, string][]} */ ([[a, 'a'], [b, 'b'], [useB, 'useB'], [total, 'total']]));
  const name = (/** @type {any} */ node) => names.get(node) ?? `#${$identity(node)[0]}`;
  /** $observer(R) inside a binding is that binding's own node. */
  const watcher = () => {
    const self = $observer(R);
    return self === null ? 'none' : `${$kind(self)} #${$identity(self)[0]}`;
  };
  return (
    <div class="demo">
      <Block title="Dependencies" note="total = a + (useB ? b : 0) + an untracked variable. Toggle useB and its sources change.">
        <Layout layout="row" gap={8} wrap>
          <Action text="a + 1" onPress={() => $write(a, $read(a) + 1)} />
          <Action text="b + 1" onPress={() => $write(b, $read(b) + 1)} />
          <Action text={() => ($read(useB) ? 'Stop using b' : 'Use b')} onPress={() => $write(useB, !$read(useB))} />
        </Layout>
        <p class="values">
          <Value label="total" value={total} />
          <Value label="computed" value={() => `${$read(computed)}×`} />
          <Value label="$sources(total)" value={() => ($read(total), $sources(total).map(name).join(', '))} />
          <Value label="$observers(b)" value={() => ($read(total), $untrack(R, () => $observers(b)))} />
          <Value label="Kind" value={[a, total].map(n => `${name(n)}: ${$kind(n)}`).join(', ')} />
          <Value label="this binding" value={watcher} />
        </p>
      </Block>
      <Block title="$invalidate and $touch" note="The variable is outside the graph. $invalidate makes total recompute and pick it up. $touch notifies a's observers as if a had changed.">
        <Layout layout="row" gap={8}>
          <Action
            text="Change the variable and Invalidate"
            onPress={() => {
              outside += 100;
              $invalidate(total);
            }}
          />
          <Action text="Touch a" onPress={() => $touch(R, () => $read(a))} />
        </Layout>
        <Label text={() => `the variable is ${($read(total), outside)}`} />
      </Block>
    </div>
  );
}

export default {
  id: 'introspection',
  group: 'rrx-core',
  title: 'Introspection',
  apis: ['$kind', '$sources', '$observers', '$identity', '$observer', '$invalidate', '$touch', '$writable'],
  summary: 'Each node can report its kind, the sources it read in its last run, and how many subscribers watch it. $invalidate and $touch make work rerun without a write.',
  View,
};
