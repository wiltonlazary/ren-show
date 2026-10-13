// Server renders, without hydration: the same component rendered live here
// (ren-dom), as HTML (ren-html's $html) and as data (ren-json's $json).
// Both server renders wait for the component's task, then stop; they run in
// plain JavaScript, so this page runs them too. A data root can also stay
// alive ($tree): its JSON follows the view, as a server would push it, and
// $settle says when its tasks are done: the first push a new client gets.

import { $signal, $read, $write, $task, $cleanup, $owner, $dispose } from 'rrx-core';
import { $active, $settle, Root, Action, Layout, Label, View as Box, For, Pending } from 'ren-core';
import { $html } from 'ren-html';
import { $json, $tree } from 'ren-json';
import { Block } from '../kit.jsx';

/** A card that loads its items: the same code for every render. @param {{ title: string }} props */
export function Card(props) {
  // timer: feature, the simulated request a server render waits for
  const items = $task($active(), () => props.title, (title, complete) => void setTimeout(() => complete({ ok: true, value: [`${title} one`, `${title} two`] }), 20));
  return (
    // What it means, for $json: an item list (microdata) named by its heading.
    <Box gap={6} pad={10} role="article" itemscope itemtype="ItemList">
      <Label role="heading" aria-level={3} itemprop="name" text={props.title} />
      <Pending fallback={<p class="quiet">loading…</p>}>
        <ul class="items" style={{ margin: 0 }}>
          <For each={() => $read(items)}>{item => <li data-item={item} itemprop="itemListElement">{item}</li>}</For>
        </ul>
      </Pending>
      <Action text="Open" onPress={() => {}} />
    </Box>
  );
}

function View() {
  const R = $active();
  const html = $signal(R, '(press Render)');
  const json = $signal(R, '(press Render)');
  // The live data root: a graph of its own; its list is its own signal,
  // which the buttons here write.
  const live = $signal(R, '');
  // Its data once settled: what a server sends a client that joins.
  const settled = $signal(R, '(settling…)');
  /** @type {import('rrx-core').Writable<string[]>} */
  let tasks = /** @type {any} */ (null);
  const host = $tree({ changed: nodes => $write(live, JSON.stringify(nodes, null, 2)) });
  const data = Root({
    id: 'live-data',
    target: null,
    renderer: host,
    storage: null,
    locks: null,
    children: () => {
      tasks = $signal($active(), ['write the docs', 'ship it']);
      // timer: feature, the simulated request for the list's owner, which the first push waits for
      const lead = $task($active(), () => 'owner', (_, complete) => void setTimeout(() => complete({ ok: true, value: 'Ada' }), 20));
      return (
        <Box>
          <Label role="status" text={() => `${$read(tasks).length} open`} />
          <Box role="list">
            <For each={() => $read(tasks)}>{task => <Label role="listitem" text={task} />}</For>
          </Box>
          <Pending fallback={<Label text="loading the owner…" />}>
            <Label role="note" text={() => `owner: ${$read(lead)}`} />
          </Pending>
        </Box>
      );
    },
  });
  const owner = $owner(R);
  if (owner !== null) $cleanup(owner, () => $dispose(data));
  // changed(nodes) got the loading data already; $settle resolves once the owner loaded. A rejection is the
  // page leaving first (the root disposed): nothing to push then.
  $settle(data).then(
    () => $write(settled, JSON.stringify(host.json(), null, 2)),
    () => {},
  );
  const render = async () => {
    const [h, j] = await Promise.all([$html(() => <Card title="Server" />, { id: 'card', styles: false }), $json(() => <Card title="Server" />)]);
    $write(html, h);
    $write(json, JSON.stringify(j, null, 2));
  };
  return (
    <div class="demo">
      <Block title="Live, here" note="The card rendered in this page by ren-dom: it loads its items, then shows them.">
        <Card title="Live" />
      </Block>
      <Block title="Static HTML and data, for the server" note="No hydration: the server sends markup ($html, ren-dom's exact markup) or data ($json, what the card means: its roles and microdata item, no styles, classes, layout, wrappers or handlers). Each waits for the card's items, then stops.">
        <Layout layout="row" gap={8}>
          <Action text="Render" onPress={render} />
        </Layout>
        <pre class="code">{html}</pre>
        <pre class="code">{json}</pre>
      </Block>
      <Block title="A live data root" note="A root rendered by ren-json's $tree stays alive: each change of its view reaches changed(nodes) with the new data, as a server would push a live view to native clients, the loading owner too. $settle(root) resolves once its tasks are done: the first push, below, has the owner. Press the buttons; the JSON follows.">
        <Layout layout="row" gap={8}>
          <Action text="Add a task" onPress={() => $write(tasks, [...$read(tasks), `task ${$read(tasks).length + 1}`])} />
          <Action text="Complete the first" onPress={() => $write(tasks, $read(tasks).slice(1))} />
        </Layout>
        <pre class="code" data-live-json="">{live}</pre>
        <pre class="code" data-settled-json="">{settled}</pre>
      </Block>
    </div>
  );
}

export default {
  id: 'server',
  group: 'ren-core',
  title: 'Server renders',
  apis: ['$html', '$json', '$settle', '$tree', 'changed(nodes)'],
  summary: 'ren-html renders a view once to HTML with ren-dom\'s markup; ren-json renders it once to its data alone. Both wait for the view\'s tasks. There is no hydration: a client renders fresh.',
  View,
};
