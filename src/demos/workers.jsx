// The worker runtime: a nested root whose graph and components run in a
// Worker, while this thread applies the flat op buffers they publish.

import { $signal, $read, $write, $lookup } from 'rrx-core';
import { $active, Root, Action, Edit, Layout, Show } from 'ren-core';
import { Assets } from '../assets.js';
import { Journal, Lines, Block, Value } from '../kit.jsx';

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const journal = Journal(R);
  const greeting = $signal(R, 'from the main thread');
  const running = $signal(R, true);
  // What the connection reports for each applied message.
  const totals = $signal(R, { messages: 0, records: 0, deferred: 0, ms: 0 });
  /** @param {import('ren-core/remote').Applied} info */
  const applied = info => {
    const t = $read(totals);
    $write(totals, { messages: t.messages + 1, records: t.records + info.records, deferred: t.deferred + info.deferred, ms: t.ms + info.ms });
  };
  const worker = env.worker;
  return (
    <div class="demo">
      <Block title="A root in a Worker" note="The application below runs in a Worker. Typing reaches it as input events, and it answers with one message per flush. The burst rewrites 200 labels every 16 ms in the low lane, and the page keeps responding. Where the page is cross-origin isolated (ren-show server sends COOP/COEP), answers to input come through a shared mailbox read in the next frame, instead of waiting for a message.">
        <Layout layout="row" gap={8}>
          <Edit label="Props sent to the worker" value={greeting} onChange={e => $write(greeting, e.value)} />
          <Action text={() => ($read(running) ? 'Terminate the worker' : 'Start it again')} onPress={() => $write(running, !$read(running))} />
        </Layout>
        <p class="values">
          <Value label="messages applied" value={() => $read(totals).messages} />
          <Value label="records" value={() => $read(totals).records} />
          <Value label="from the low lane" value={() => $read(totals).deferred} />
          <Value label="apply time" value={() => `${$read(totals).ms.toFixed(1)} ms`} />
          <Value label="shared mailbox" value={env.isolated ? 'on: the page is cross-origin isolated' : 'off: messages only (no COOP/COEP headers)'} />
        </p>
        {worker === null ? (
          <p class="quiet">This environment has no worker.</p>
        ) : (
          <Show when={running} fallback={<p class="quiet">The worker is terminated along with its root.</p>}>
            <Root
              id="worker-app"
              runtime="worker"
              worker={worker}
              props={() => $read(greeting)}
              onMessage={(/** @type {any} */ data) => journal.note(`the worker saved "${data.saved}"`)}
              connect={{ applied }}
            />
          </Show>
        )}
      </Block>
      <Block title="Messages from the worker">
        <Lines of={journal.lines} />
      </Block>
    </div>
  );
}

export default {
  id: 'workers',
  group: 'ren-core',
  title: 'Worker runtime',
  apis: ['Root runtime="worker"', 'serve', 'connect', 'mailbox', '$defer', 'Props', 'Send', 'Storage'],
  summary: 'The same components can run in a Worker. Only the renderer stays on the main thread. The wire carries Int32 op buffers and a string table, with lanes, coalescing and backpressure, and it sends no JSON.',
  View,
};
