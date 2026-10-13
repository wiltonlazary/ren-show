// Contexts: a context is a typed key and its own provider component.

import { $context, $provide, $lookup, $update, $entries, $current, $with, $signal, $read, $write } from 'rrx-core';
import { $active, Action, Label, Layout, View as Box } from 'ren-core';
import { Journal, Lines, Block, lab } from '../kit.jsx';
import { tone } from '../themes.js';

/** `$provide` is the provider without JSX, for code that builds eagerly (plain rrx-core). */
export const provided = () =>
  lab((root, note) => {
    note(`outside: ${$lookup(root, Tone)}`);
    $provide(root, Tone, 'lab', () => {
      note(`inside $provide: ${$lookup(root, Tone)}`);
      $update(root, Tone, (/** @type {string} */ tone) => `${tone}, updated`);
      note(`after $update: ${$lookup(root, Tone)}`);
    });
    note(`outside again: ${$lookup(root, Tone)}`);
  });

const Tone = $context('plain');
const Size = $context(14);

/**
 * Shows the tone and size it sees, and changes the nearest tone provider.
 * With no provider above it, `$update` throws; the card shows that instead.
 * @param {{ at: string }} props
 */
function Card(props) {
  const missing = $signal($active(), false);
  const update = () => {
    try {
      $update(Tone, (/** @type {string} */ tone) => `${tone}!`);
    } catch {
      $write(missing, true);
    }
  };
  return (
    <Box pad={8} gap={4} fill={tone('raised')}>
      <Label wrap text={() => `${props.at}: tone ${$lookup(Tone)}, size ${$lookup(Size)}${$read(missing) ? ' (nothing provides Tone here)' : ''}`} />
      <Action text="Update the nearest tone" onPress={update} />
    </Box>
  );
}

function View() {
  const R = $active();
  const journal = Journal(R);
  // A provider given a node follows it until an `$update` overrides it.
  const chosen = $signal(R, 'warm');
  /** @type {ReturnType<typeof import('rrx-core').$current> | null} */
  let captured = null;
  const Capture = () => {
    captured = $current(R);
    return null;
  };
  const ran = $signal(R, /** @type {string[]} */ ([]));
  return (
    <div class="demo">
      <Block title="Providers" note="Each card reads the nearest provider. $update writes only the provider nearest to the button, so cards under other providers do not change; the outside card has no provider to update.">
        <Card at="outside" />
        <Tone value="dark">
          <Card at="dark" />
          <Tone value={chosen}>
            <Card at="follows a signal" />
            <Capture />
          </Tone>
        </Tone>
        <Layout layout="row" gap={8}>
          <Action text="Set the signal to cool" onPress={() => $write(chosen, 'cool')} />
          <Action text="Set the signal to warm" onPress={() => $write(chosen, 'warm')} />
        </Layout>
      </Block>
      <Block title="$entries, $current and $with" note="$current captures a context layer. $with re-enters it later, from code built outside that provider.">
        <Layout layout="row" gap={8}>
          <Action
            wrap
            text="Read the tone here and in the captured layer"
            onPress={() => {
              journal.note(`here: ${$lookup(Tone)}`);
              journal.note(`$with(captured): ${$with(R, captured, () => $lookup(Tone))}`);
            }}
          />
          <Action
            wrap
            text="List the entries visible in the captured layer"
            onPress={() =>
              $with(R, captured, () =>
                journal.note(
                  $entries()
                    .map(([context, value]) => (context === Tone ? `Tone=${value}` : context === Size ? `Size=${value}` : null))
                    .filter(Boolean)
                    .join(', ') + ' (plus the root’s built-in contexts)',
                ),
              )
            }
          />
        </Layout>
        <Lines of={journal.lines} />
      </Block>
      <Block title="$provide without JSX" note="Plain rrx-core builds eagerly, so it provides with $provide. This runs on a lab graph.">
        <Action text="Run" onPress={() => $write(ran, provided())} />
        <Lines of={ran} />
      </Block>
    </div>
  );
}

export default {
  id: 'context',
  group: 'rrx-core',
  title: 'Contexts',
  apis: ['$context', '$provide', '$lookup', '$update', '$entries', '$current', '$with'],
  summary: 'A context is a typed key with a fallback value, and it is also its own provider component. $lookup reads the nearest provider. $update writes it, and only the consumers below that provider rerun.',
  View,
};
