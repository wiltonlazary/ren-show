// Application roots: nested roots with their own graph, renderer, theme,
// storage, locks and contexts, joined to the parent only by props (in) and
// messages (out).

import { $context, $signal, $read, $write, $lookup, $update } from 'rrx-core';
import { $active, Root, $roots, Id, Storage, Locks, Runtime, Props, Send, $name, Memory, Action, Edit, Label, Layout, View as Box, Show } from 'ren-core';
import { $dom, $shadow } from 'ren-dom';
import { Journal, Lines, Block, Value } from '../kit.jsx';
import { look, argb } from '../themes.js';

/** The page's sheet stops at a shadow root: its plain input is styled by the root's own tokens. */
const FIELD = 'input { font: inherit; color: var(--ren-ink); background: var(--ren-paper); border: 1px solid var(--ren-border); border-radius: var(--ren-radius); padding: 4px 8px; }';

/**
 * A nested root's own theme: the page's, with another accent and canvas. A
 * renderer's theme is fixed, so a new page theme makes the root again.
 * @param {number} accent a series index @param {'soft' | 'raised'} canvas
 */
const own = (accent, canvas) => {
  const t = look();
  return { ...t.ren, accent: argb(t.colors.series[accent]), canvas: /** @type {number} */ (t.ren[canvas]) };
};

/** A context the parent passes into a nested root explicitly. */
export const Tone = $context('none');

/** The application inside each nested root: it sees only its own root's contexts. */
export function Note() {
  const R = $active();
  const id = $lookup(Id);
  const shelf = $lookup(Storage);
  const locks = $lookup(Locks);
  const draft = $signal(R, shelf?.get('text') ?? '');
  const lock = $signal(R, 'no lock taken');
  return (
    <Box gap={8} pad={10}>
      <Label text={() => `root "${id}" (${$lookup(Runtime).renderer}), props: ${$lookup(Props) ?? '-'}, tone: ${$lookup(Tone)}`} />
      <label for={$name('text')}>Note kept in this root’s storage</label>
      <Layout layout="row" gap={8}>
        <input id={$name('text')} value={draft} onInput={(/** @type {any} */ e) => $write(draft, e.target.value)} />
        <Action text="Save" onPress={() => shelf?.set('text', $read(draft))} />
        <Action text="Send to parent" onPress={() => $lookup(Send)({ from: id, text: $read(draft) })} />
        <Action text="Tone +" onPress={() => $update(Tone, (/** @type {string} */ t) => `${t}+`)} />
      </Layout>
      <Label text={() => `stored: ${shelf?.get('text') ?? '(nothing)'}`} />
      <Layout layout="row" gap={8}>
        <Action
          text="Take the save lock"
          onPress={() => {
            if (locks === null) return;
            locks.request('save', () => $write(lock, `held ren:${id}:save`));
          }}
        />
        <Label text={lock} />
      </Layout>
    </Box>
  );
}

function View() {
  const R = $active();
  const journal = Journal(R);
  const greeting = $signal(R, 'hello');
  const open = $signal(R, true);
  const live = $signal(R, /** @type {string[]} */ ([]));
  const doc = /** @type {any} */ ($lookup(Runtime).element)?.ownerDocument ?? null;
  const list = () => $write(live, doc === null ? [] : $roots(doc).sort());
  // A private store: the third root keeps its notes in memory, never in localStorage.
  const memory = new Memory();

  return (
    <div class="demo">
      <Block title="Nested roots" note="Three roots render the same Note component: one in a shadow root, two in the light DOM, each with a theme of its own. Each has its own storage keys (ren:<id>:*), lock names and element ids; the third keeps its storage in memory (Memory), so nothing it saves reaches localStorage.">
        <Layout layout="row" gap={8}>
          <Edit label="Props for both" value={greeting} onChange={e => $write(greeting, e.value)} />
          <Action text={() => ($read(open) ? 'Dispose the shadow root' : 'Start it again')} onPress={() => $write(open, !$read(open))} />
          <Action text="List live roots" onPress={list} />
        </Layout>
        <p class="values">
          <Value label="$roots(document)" value={() => $read(live).join(', ') || '(press List)'} />
          <Value label="this root" value={$lookup(Id)} />
        </p>
        <div class="roots">
          <Show when={open} fallback={<p class="quiet">The shadow root is disposed: its id, storage listener and nodes are gone.</p>}>
            {/* A function child: each start makes a fresh renderer (one renderer serves one root); inside it, a region makes the root again when the theme changes. */}
            {() => (
              <>
                {() => (
                  <Root
                    id="note-shadow"
                    renderer={$shadow({ mode: 'open', theme: own(1, 'soft'), styles: FIELD })}
                    props={() => $read(greeting)}
                    provide={[[Tone, 'cool']]}
                    onMessage={(/** @type {any} */ data) => journal.note(`message from ${data.from}: "${data.text}"`)}
                  >
                    {() => <Note />}
                  </Root>
                )}
              </>
            )}
          </Show>
          {() => (
            <Root
              id="note-light"
              renderer={$dom(doc, { theme: own(4, 'raised') })}
              props={() => $read(greeting).toUpperCase()}
              onMessage={(/** @type {any} */ data) => journal.note(`message from ${data.from}: "${data.text}"`)}
            >
              {() => <Note />}
            </Root>
          )}
          {() => (
            <Root
              id="note-private"
              renderer={$dom(doc, { theme: own(2, 'raised') })}
              storage={memory}
              props={() => `${$read(greeting)} (kept in memory)`}
              onMessage={(/** @type {any} */ data) => journal.note(`message from ${data.from}: "${data.text}"`)}
            >
              {() => <Note />}
            </Root>
          )}
        </div>
      </Block>
      <Block title="Messages from the roots">
        <Lines of={journal.lines} />
      </Block>
    </div>
  );
}

export default {
  id: 'roots',
  group: 'ren-core',
  title: 'Application roots',
  apis: ['Root', '$roots', '$dom', '$shadow', 'Id', 'Storage', 'Memory', 'Locks', 'Runtime', 'Props', 'Send', '$name', 'provide'],
  summary: 'Each root is its own graph with its own renderer, theme, contexts, storage namespace and locks. Only props (in) and messages (out) cross between a parent and a nested root, and disposing a root releases everything it made.',
  View,
};
