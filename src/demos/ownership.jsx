// Ownership: scopes own the nodes, child scopes and cleanups created inside
// them, and stopping a scope frees all of it. The scopes live on a graph of
// their own (`pool`), so its $stats count only what this demo made.

import { $root, $signal, $read, $write, $memo, $effect, $flush, $dispose, $closed, $cancel, $whenUnwatched, $sweeper, $retire, $sweep, $scope, $enter, $stop, $cleanup, $release, $cleanups, $alive, $owner, $unowned, $discard, $stats, $mount, $mounts } from 'rrx-core';
import { $active, Action, Label, Layout, For } from 'ren-core';
import { Lines, Block, Value, lab } from '../kit.jsx';

/**
 * A graph's life on a lab: an effect cancelled, a signal told when its last
 * observer leaves, a scope retired at once and swept later on the host's
 * schedule, and the root disposed.
 */
export const lifecycle = () =>
  lab((_, note) => {
    const root = $root('life');
    const count = $signal(root, 0);
    $whenUnwatched(count, () => note('count lost its last observer ($whenUnwatched)'));
    const effect = $effect(root, () => note(`effect sees ${$read(count)}`));
    $write(count, 1);
    $flush(root);
    $cancel(effect);
    note('effect cancelled ($cancel)');
    $write(count, 2);
    $flush(root);
    let asked = 0;
    $sweeper(root, () => asked++);
    const scope = $scope(root, null);
    $enter(scope, () => {
      for (let i = 0; i < 100; i++) $memo(root, () => i);
    });
    $retire(scope);
    note(`a scope of 100 memos retired at once; the sweeper was asked ${asked} time(s)`);
    note(`$sweep freed it: ${$sweep(root)} left to sweep`);
    note(`$closed before $dispose: ${$closed(root)}`);
    $dispose(root);
    note(`$closed after: ${$closed(root)}`);
  });

function View() {
  const R = $active();
  // The pool graph ends with this view.
  const pool = $root('pool');
  $cleanup(/** @type {any} */ ($owner(R)), () => $dispose(pool));
  const tick = $signal(pool, 0);
  /** @type {string[]} */
  const noted = [];
  const note = (/** @type {string} */ text) => noted.push(text);

  // The view's state: the journal and the pool's counts, refreshed after each action.
  const lines = $signal(R, /** @type {string[]} */ ([]));
  const stats = $signal(R, $stats(pool));
  const refresh = () => {
    $flush(pool);
    $write(lines, noted.slice(-10));
    $write(stats, $stats(pool));
  };

  const life = $signal(R, /** @type {string[]} */ ([]));
  const scopes = $signal(R, /** @type {{ n: number, scope: any, key: number | null }[]} */ ([]));
  let made = 0;
  const spawn = () => {
    const n = ++made;
    const scope = $scope(pool, null);
    /** @type {number | null} */
    let key = null;
    $enter(scope, () => {
      const label = $memo(pool, () => `scope ${n} sees tick ${$read(tick)}`);
      $effect(pool, () => note($read(label)));
      const inner = $scope(pool, scope);
      $cleanup(inner, () => note(`scope ${n}: child scope stopped`));
      key = $cleanup(scope, () => note(`scope ${n}: cleanup ran`));
      // $mount callbacks wait until the host drains them with $mounts.
      $mount(scope, () => note(`scope ${n}: mounted`));
    });
    $mounts(scope);
    $write(scopes, [...$read(scopes), { n, scope, key }]);
    refresh();
  };
  const stop = (/** @type {{ n: number, scope: any }} */ entry) => {
    $stop(entry.scope);
    note(`scope ${entry.n} alive: ${$alive(entry.scope)}`);
    $write(scopes, $read(scopes).filter(e => e !== entry));
    refresh();
  };
  const release = (/** @type {{ n: number, scope: any, key: number | null }} */ entry) => {
    $release(entry.scope, entry.key);
    note(`scope ${entry.n}: cleanup released, ${$cleanups(entry.scope)} left`);
    refresh();
  };

  // An unowned node lives until it is discarded, whatever owner is current.
  /** @type {any} */
  let loose = null;
  const adopt = () => {
    if (loose !== null) return;
    loose = $unowned(pool, () => $signal(pool, 'unowned'));
    note(`made an unowned signal: ${$read(loose)}`);
    refresh();
  };
  const discard = () => {
    if (loose === null) return;
    $discard(loose);
    note(`discarded it; its handle still reads "${$read(loose)}"`);
    loose = null;
    refresh();
  };

  return (
    <div class="demo">
      <Block title="Scopes" note="Each scope owns a memo, an effect, a child scope and a cleanup. Stopping a scope frees its nodes newest first, then runs its cleanups.">
        <Layout layout="row" gap={8}>
          <Action text="Spawn a scope" onPress={spawn} />
          <Action
            text="Tick"
            onPress={() => {
              $write(tick, $read(tick) + 1);
              refresh();
            }}
          />
          <Action text="Make unowned" onPress={adopt} />
          <Action text="Discard it" onPress={discard} />
        </Layout>
        <ul class="rows">
          <For each={scopes} by={e => e.n} fallback={<li class="quiet">no scopes</li>}>
            {entry => (
              <li>
                <Label text={`scope ${entry().n}`} />
                <Action text="Stop" onPress={() => stop(entry())} />
                <Action text="Release cleanup" onPress={() => release(entry())} />
              </li>
            )}
          </For>
        </ul>
        <p class="values">
          <Value label="nodes" value={() => $read(stats).nodes} />
          <Value label="scopes" value={() => $read(stats).scopes} />
          <Value label="effects" value={() => $read(stats).effects} />
          <Value label="links" value={() => $read(stats).links} />
        </p>
      </Block>
      <Block title="Journal">
        <Lines of={lines} />
      </Block>
      <Block title="A graph's life" note="On a lab graph: an effect cancelled, a signal's $whenUnwatched hook, a scope retired at once and swept on the host's schedule ($sweeper), and the root disposed ($closed).">
        <Action text="Run" onPress={() => $write(life, lifecycle())} />
        <Lines of={life} />
      </Block>
    </div>
  );
}

export default {
  id: 'ownership',
  group: 'rrx-core',
  title: 'Scopes and ownership',
  apis: ['$scope', '$enter', '$stop', '$cleanup', '$release', '$cleanups', '$alive', '$owner', '$unowned', '$discard', '$mount', '$mounts', '$stats', '$root', '$dispose', '$closed', '$cancel', '$whenUnwatched', '$retire', '$sweep', '$sweeper'],
  summary: 'Everything created inside a scope belongs to it. Stopping the scope frees its nodes and child scopes and runs its cleanups. $stats counts what is live by walking the owner tree.',
  View,
};
