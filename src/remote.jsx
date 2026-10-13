// The application the worker-runtime demo runs inside a Worker (src/worker.jsx
// serves it; the tests serve it over a MessageChannel). Only ren-core primitives
// and contexts: the graph, the components and ren-core run in the worker, and the
// main thread only applies what they publish.

import { $signal, $read, $write, $batch, $defer, $lookup, $cleanup, $owner } from 'rrx-core';
import { $active, Id, Storage, Props, Send, View as Box, Layout, Scroll, Label, Edit, Action, For } from 'ren-core';

/** The number of labels a background burst rewrites. */
export const ROWS = 200;

/** @param {{ later?: (ms: number, fn: () => void) => () => void }} [props] */
export function Remote(props = {}) {
  const R = $active();
  const later =
    props.later ??
    ((/** @type {number} */ ms, /** @type {() => void} */ fn) => {
      // timer: feature, the background bursts' pace (tests inject a manual clock)
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    });
  const shelf = $lookup(Storage);
  const text = $signal(R, shelf?.get('text') ?? '');
  const rows = Array.from({ length: ROWS }, (_, i) => ({ i, label: $signal(R, `row ${i}`) }));
  const bursts = $signal(R, 0);
  let running = false;
  let cancel = () => {};
  // A background burst: every row relabelled inside $defer, in the low lane,
  // so input stays urgent and the renderer applies it in frame-sized slices.
  const tick = () => {
    if (!running) return;
    const n = $read(bursts) + 1;
    $batch(R, () => {
      $write(bursts, n);
      $defer(R, () => {
        for (const row of rows) $write(row.label, `row ${row.i} · burst ${n}`);
      });
    });
    cancel = later(16, tick); // timer: feature, the background bursts' pace
  };
  // The burst ends with the application (its root disposed, or the worker closed).
  $cleanup(/** @type {any} */ ($owner(R)), () => {
    running = false;
    cancel();
  });
  return (
    <Box gap={8} pad={10}>
      <Label wrap text={() => `worker root "${$lookup(Id)}", props: ${$lookup(Props) ?? '-'}`} />
      <Layout layout="row" gap={8}>
        <Edit label="Typed in the main thread, handled in the worker" value={text} onChange={e => $write(text, e.value)} style={{ width: 320, maxWidth: '100%' }} />
        <Action text="Save and tell the parent" onPress={() => (shelf?.set('text', $read(text)), $lookup(Send)({ saved: $read(text) }))} />
      </Layout>
      <Label text={() => `echo: ${$read(text)}`} />
      <Layout layout="row" gap={8}>
        <Action
          text="Start a background burst"
          onPress={() => {
            if (running) return;
            running = true;
            tick();
          }}
        />
        <Action
          text="Stop the burst"
          onPress={() => {
            running = false;
            cancel();
          }}
        />
        <Label text={() => `bursts: ${$read(bursts)}`} />
      </Layout>
      {/* The rows scroll inside their 160-high region; the page does not grow. */}
      <Scroll style={{ height: 160, gap: 2 }}>
        <For each={rows}>{row => <Label text={row().label} size={12} />}</For>
      </Scroll>
    </Box>
  );
}
