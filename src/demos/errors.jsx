// Failures: memos keep a failure as their result, owners catch what their
// computations throw, and ren-core's Recover turns a failure into a fallback.

import { $signal, $read, $write, $memo, $effect, $flush, $scope, $enter, $catch, $throw, $deliver, $outcome } from 'rrx-core';
import { $active, Action, Edit, Label, Layout, Recover } from 'ren-core';
import { lab, Lines, Block } from '../kit.jsx';
import { tone } from '../themes.js';

/** The rrx-core side, scripted on a lab graph. */
export const script = () =>
  lab((root, note) => {
    const divisor = $signal(root, 2);
    const ratio = $memo(root, () => {
      if ($read(divisor) === 0) throw new Error('division by zero');
      return 10 / $read(divisor);
    });
    note(`ratio: ${$read(ratio)}`);
    $write(divisor, 0);
    // A failed memo keeps its failure as its result; $outcome turns it into data.
    const outcome = $outcome(() => $read(ratio));
    note(`$outcome: ${outcome.status} (${outcome.error.message})`);
    $write(divisor, 5);
    note(`a source change recomputes it: ${$read(ratio)}`);

    // An owner's $catch handles what its computations throw.
    const scope = $scope(root, null);
    $catch(scope, error => note(`scope caught: ${error.message}`));
    const trouble = $signal(root, false);
    $enter(scope, () =>
      $effect(root, () => {
        if ($read(trouble)) throw new Error('effect failed');
      }),
    );
    $write(trouble, true);
    $flush(root);
    // $throw delivers to the current owner's boundary.
    $enter(scope, () => $throw(root, new Error('thrown by hand')));
    // $deliver offers an error to an owner and returns what nobody handled.
    const unhandled = $deliver(root, null, new Error('no boundary at the root'));
    note(`$deliver without a boundary returns: ${unhandled === null ? 'null' : unhandled.message}`);
    $catch(root, error => note(`root caught: ${error.message}`));
    note(`$deliver with a root boundary returns: ${$deliver(root, null, new Error('now handled'))}`);
  });

function View() {
  const R = $active();
  const divisor = $signal(R, '4');
  const ran = $signal(R, /** @type {string[]} */ ([]));
  /** A component whose binding throws for a zero divisor. */
  const Ratio = () => (
    <Label
      text={() => {
        const d = Number($read(divisor));
        if (d === 0) throw new Error('cannot divide 100 by zero');
        return `100 / ${d} = ${100 / d}`;
      }}
    />
  );
  return (
    <div class="demo">
      <Block title="Recover" note="Set the divisor to 0. The boundary shows its fallback, and reset renders the children again.">
        <Edit label="Divisor" value={divisor} onChange={e => $write(divisor, e.value)} />
        <Recover
          fallback={(/** @type {Error} */ error, /** @type {() => void} */ reset) => (
            <Layout layout="row" gap={8}>
              <Label text={`failed: ${error.message}`} color={tone('danger')} />
              <Action
                text="Set 1 and reset"
                onPress={() => {
                  $write(divisor, '1');
                  reset();
                }}
              />
            </Layout>
          )}
        >
          <Ratio />
        </Recover>
      </Block>
      <Block title="$catch, $throw, $deliver" note="The same machinery in plain rrx-core, run on a lab graph.">
        <Action text="Run" onPress={() => $write(ran, script())} />
        <Lines of={ran} />
      </Block>
    </div>
  );
}

export default {
  id: 'errors',
  group: 'rrx-core',
  title: 'Failures',
  apis: ['$catch', '$throw', '$deliver', '$outcome', 'Recover'],
  summary: 'A memo that throws keeps the failure as its value until a source changes. Owners catch what their computations throw. The Recover boundary renders a fallback that can reset.',
  View,
};
