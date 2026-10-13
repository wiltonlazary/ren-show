// Stores: nested data whose reads are tracked by path, so a write notifies
// only the paths whose values changed. For plain data kept in a signal,
// rrx-core/store's deepEqual and preserve give the same economy: an equal
// refetch notifies nothing, and a changed one keeps every unchanged part.

import { $signal, $read, $write, $watch, $equals, $store, $at, $put, $raw, $update, $reuse, $mirror, $overlay } from 'rrx-core';
import { deepEqual, preserve } from 'rrx-core/store';
import { $active, Action, Label, Layout, For } from 'ren-core';
import { Journal, Lines, Block, Value } from '../kit.jsx';

function View() {
  const R = $active();
  const journal = Journal(R, 16);
  const note = journal.note;

  const store = $store(R, { user: { name: 'Nora', age: 36 }, tags: ['math', 'engines'] });
  // One $watch per path: each notes only when its own path changes.
  for (const path of [['user', 'name'], ['user', 'age'], ['user'], ['tags']])
    $watch(R, () => $at(store, path), value => note(`${path.join('.')} → ${JSON.stringify(value)}`));
  const raw = $signal(R, JSON.stringify($raw(store)));
  const show = () => $write(raw, JSON.stringify($raw(store)));

  // $mirror: a derived store; only the parts whose value changed notify.
  const scores = $signal(R, [3, 5, 8]);
  const stats = $mirror(R, () => {
    const list = $read(scores);
    return { count: list.length, total: list.reduce((t, x) => t + x, 0), max: Math.max(...list) };
  });
  $watch(R, () => $at(stats, ['max']), max => note(`mirror: max → ${max}`));

  // $reuse keeps the previous object of every row that did not change.
  const rows = $signal(R, [{ id: 1, v: 'one' }, { id: 2, v: 'two' }, { id: 3, v: 'three' }]);
  const kept = $signal(R, '');
  const refetch = () => {
    const old = $read(rows);
    // A refetch returns new objects, only one of them different.
    const fresh = [{ id: 3, v: 'three' }, { id: 1, v: 'ONE' }, { id: 2, v: 'two' }];
    const next = $reuse(old, fresh, row => row.id);
    $write(kept, `${next.filter(row => old.includes(row)).length} of ${next.length} row objects kept`);
    $write(rows, next);
  };

  // $overlay: optimistic layers over a store path.
  const counter = $store(R, { likes: 10 });
  const overlay = $overlay(R, counter);
  /** @type {number[]} */
  const tickets = [];

  // A settings document polled from a server: every poll is a new object.
  const polled = Journal(R, 8);
  /** The server's answer: a new object each time, with the SMS alert as given. @param {boolean} sms */
  const answer = sms => ({ profile: { name: 'Nora', city: 'Lisbon' }, alerts: { email: true, sms } });
  // deepEqual as the signal's equality: an equal document notifies nobody.
  const settings = $equals($signal(R, answer(false)), deepEqual);
  for (const part of /** @type {const} */ (['profile', 'alerts'])) $watch(R, () => $read(settings)[part], value => polled.note(`${part} → ${JSON.stringify(value)}`));
  /** Polls: writes the answer as it came, or kept by preserve. @param {boolean} flip @param {boolean} keep */
  const poll = (flip, keep) => {
    const was = $read(settings);
    const fresh = answer(flip ? !was.alerts.sms : was.alerts.sms);
    polled.note(`polled${flip ? ', the SMS alert changed' : ', nothing changed'}${keep ? ' (preserve)' : ''}`);
    // The sections' watches run after this handler, with what changed.
    $write(settings, keep ? preserve(was, fresh) : fresh);
  };

  return (
    <div class="demo">
      <Block title="$store, $at, $put, $update" note="Each path has its own $watch. Putting an equal user notifies the user path, which holds a new object, but not name or age, which are equal.">
        <Layout layout="row" gap={8} wrap>
          <Action
            text="Put age + 1"
            onPress={() => {
              $put(store, ['user', 'age'], (/** @type {number} */ age) => age + 1);
              show();
            }}
          />
          <Action
            text="Update user.name"
            onPress={() => {
              $update(store, ['user'], { name: $at(store, ['user', 'name']) === 'Nora' ? 'Tamsin' : 'Nora' });
              show();
            }}
          />
          <Action
            text="Put an equal user"
            onPress={() => {
              $put(store, ['user'], { ...$raw(store).user });
              note('put an equal user: a new object at user, equal name and age');
              show();
            }}
          />
          <Action
            text="Add a tag"
            onPress={() => {
              $put(store, ['tags'], (/** @type {string[]} */ tags) => [...tags, `tag${tags.length}`]);
              show();
            }}
          />
        </Layout>
        <pre class="raw">{raw}</pre>
      </Block>
      <Block title="$mirror">
        <Layout layout="row" gap={8}>
          <Action text="Add a low score" onPress={() => $write(scores, [...$read(scores), 1])} />
          <Action text="Add a high score" onPress={() => $write(scores, [...$read(scores), Math.max(...$read(scores)) + 1])} />
        </Layout>
        <p class="values">
          <Value label="count" value={() => $at(stats, ['count'])} />
          <Value label="total" value={() => $at(stats, ['total'])} />
          <Value label="max" value={() => $at(stats, ['max'])} />
        </p>
      </Block>
      <Block title="$reuse">
        <Action text="Refetch the rows" onPress={refetch} />
        <ul class="words">
          <For each={rows}>{row => <li>{row().v}</li>}</For>
        </ul>
        <Label text={kept} />
      </Block>
      <Block title="$overlay" note="Layers show at once. Its commit writes a layer into the store; its settle drops it.">
        <Layout layout="row" gap={8}>
          <Action text="Like (layer)" onPress={() => void tickets.push(overlay.apply(['likes'], (/** @type {number} */ n) => n + 1))} />
          <Action text="Commit the oldest" onPress={() => tickets.length && overlay.commit(/** @type {number} */ (tickets.shift()))} />
          <Action text="Settle (drop) the oldest" onPress={() => tickets.length && overlay.settle(/** @type {number} */ (tickets.shift()))} />
        </Layout>
        <p class="values">
          <Value label="shown" value={() => overlay.read(['likes'])} />
          <Value label="stored" value={() => $at(counter, ['likes'])} />
          <Value label="pending" value={() => String($read(overlay.pending))} />
        </p>
      </Block>
      <Block title="Journal">
        <Lines of={journal.lines} />
      </Block>
      <Block title="Refetched documents: deepEqual and preserve" note="A settings document in a signal, polled from a server: each poll is a new object. With deepEqual as its equality, an equal poll notifies nobody. A changed poll written as it came replaces every section, so each section's watch runs; written through preserve(old, fresh), the unchanged profile keeps its object and only the alerts notify.">
        <Layout layout="row" gap={8} wrap>
          <Action text="Poll, nothing changed" onPress={() => poll(false, false)} />
          <Action text="Poll, alerts changed" onPress={() => poll(true, false)} />
          <Action text="Poll, alerts changed (preserve)" onPress={() => poll(true, true)} />
        </Layout>
        <Lines of={polled.lines} />
      </Block>
    </div>
  );
}

export default {
  id: 'stores',
  group: 'rrx-core',
  title: 'Stores',
  apis: ['$store', '$at', '$put', '$raw', '$update', '$reuse', '$mirror', '$overlay', 'deepEqual', 'preserve'],
  summary: 'A store tracks reads by path, so a write notifies only the paths whose values changed. $mirror keeps a store equal to a computation. $reuse keeps row identity. $overlay layers optimistic writes over a store. deepEqual and preserve keep plain data in a signal as quiet.',
  View,
};
