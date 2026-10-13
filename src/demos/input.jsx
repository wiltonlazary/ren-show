// Around a component: what it hears beyond its own handlers. One notes
// board of portable primitives, on the DOM, on Skia and in a three.js
// overlay, each in its own root: `$keys` hears every key of the root (N adds
// a note, / goes to the composer, which `$focus` focuses); `$moves` and
// `$scrolls` tell where the pinned note is against the list it scrolls in
// (a "pinned note below" marker, as a chat shows); `$resizes` follows its
// size as it grows; `$surface` names the renderer, so the hint fits it.

import { $signal, $read, $write, $lookup, $untrack } from 'rrx-core';
import { $active, $surface, $keys, $moves, $scrolls, $resizes, $focus, Root, Pending, Recover, Label, Action, Edit, Layout, Scroll, View as Box, For, Runtime } from 'ren-core';
import { $dom } from 'ren-dom';
import { $skia } from 'ren-skia';
import { Assets } from '../assets.js';
import { Async } from '../async.js';
import { Block } from '../kit.jsx';
import { loadThree, stage } from './three.jsx';
import { Look, look, tone } from '../themes.js';

/** The notes above and below the pinned one. */
const ABOVE = ['Water the ferns', 'Call the tuner', 'Book the hall', 'Print the flyers', 'Mend the banner', 'Fold the programmes'];
const BELOW = ['Pack the stands', 'Count the chairs', 'Tune the timpani', 'Sweep the stage', 'Lock the side door', 'Post the photos'];
const PINNED = 'Pinned: rehearsal moved to Thursday';
const MORE = 'Pinned: rehearsal moved to Thursday, seven o’clock, in Hall B; bring the new parts and a pencil.';

/** Where the pinned note is against the list's view. @param {any} list @param {number} top @param {number} height */
const against = (list, top, height) => {
  const view = list.getBoundingClientRect();
  if (top + height <= view.top + 1) return 'above';
  if (top >= view.top + view.height - 1) return 'below';
  return 'in view';
};

/** The notes board: portable primitives, and what it hears around itself. */
export function Board() {
  const R = $active();
  const kind = $surface().kind;
  const c = look().colors;
  const added = $signal(R, /** @type {string[]} */ ([]));
  const draft = $signal(R, '');
  const key = $signal(R, '-');
  const scrolls = $signal(R, 0);
  const where = $signal(R, 'below');
  const size = $signal(R, '-');
  const long = $signal(R, false);
  /** @type {any} */
  let list = null;
  /** @type {any} */
  let pinned = null;
  /** @type {any} */
  let composer = null;
  const add = () => {
    const text = $read(draft).trim() || `Note ${ABOVE.length + BELOW.length + $read(added).length + 2}`;
    $write(added, [...$read(added), text]);
    $write(draft, '');
  };
  // Every key of this root: N adds a note, / goes to the composer; a key typed in a field is the field's.
  $keys(e => {
    if (e.editable) return;
    $write(key, e.key);
    if (e.key === 'n') add();
    if (e.key === '/' && $focus(composer)) e.preventDefault?.();
  });
  /** Hears the pinned note once its node and the list's exist (their refs are set as they are made, before this). */
  const Watch = () => {
    const place = (/** @type {number} */ top, /** @type {number} */ height) => $write(where, against(list, top, height));
    let height = 0;
    $resizes(pinned, e => {
      height = e.height;
      $write(size, `${Math.round(e.width)} × ${Math.round(e.height)}`);
    });
    $moves(pinned, e => place(e.y, height || pinned.getBoundingClientRect().height));
    $scrolls(() => {
      $write(scrolls, $untrack(R, () => $read(scrolls)) + 1);
      const box = pinned.getBoundingClientRect();
      place(box.top, box.height);
    });
    return null;
  };
  const hint = kind === 'dom' ? 'press N with nothing focused, or / to write' : 'click it, then press N, or / to write';
  return (
    <Box style={{ width: 280, padding: 12, gap: 8, background: c.surface, radius: 12, border: 1, borderColor: c.rule }}>
      <Label wrap text={`On ${kind}: ${hint}`} style={{ fontSize: 13, color: c.muted }} />
      <Scroll ref={(/** @type {any} */ el) => (list = el)} height={120} gap={4}>
        {ABOVE.map(text => <Label text={text} />)}
        <Label ref={(/** @type {any} */ el) => (pinned = el)} wrap text={() => ($read(long) ? MORE : PINNED)} style={{ padding: [4, 8], radius: 6, background: c.soft, color: c.ink, fontWeight: 'bold' }} />
        {BELOW.map(text => <Label text={text} />)}
        <For each={added}>{text => <Label text={text} />}</For>
      </Scroll>
      <Watch />
      <Label data-where="" text={() => ($read(where) === 'in view' ? 'The pinned note is in view' : $read(where) === 'above' ? '↑ The pinned note is above' : '↓ The pinned note is below')} style={{ fontSize: 13, color: c.accent }} />
      <Box ref={(/** @type {any} */ el) => (composer = el)} style={{ direction: 'row', gap: 6 }}>
        <Edit label="New note" value={draft} onChange={e => $write(draft, e.value)} onSubmit={add} width={160} />
        <Action text="Add" onPress={add} />
      </Box>
      <Layout layout="row" gap={6}>
        <Action text={() => ($read(long) ? 'Shorten the pin' : 'Lengthen the pin')} onPress={() => $write(long, !$read(long))} />
      </Layout>
      <Label data-heard="" text={() => `key ${$read(key)} · scrolls ${$read(scrolls)} · pin ${$read(size)}`} style={{ fontSize: 12, color: c.muted }} />
    </Box>
  );
}

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const skia = Async(R, () => env.skia, async load => {
    if (load === null) throw new Error('this environment has no CanvasKit');
    return load();
  });
  const three = loadThree(R, env);
  const doc = /** @type {any} */ ($lookup(Runtime).element)?.ownerDocument;
  const failed = (/** @type {string} */ what) => (/** @type {Error} */ error) => <Label text={`${what} is unavailable: ${error.message}`} color={tone('danger')} />;
  return (
    <div class="demo">
      <Block title="One board, every renderer" note="Each board is its own root. Its keys come from anywhere in that root ($keys), not only a focused field; / focuses the composer's field ($focus). Scroll a list: the marker says where the pinned note went, from its moves ($moves) and the root's scrolls ($scrolls). Lengthen the pin: its size follows ($resizes). The hint names the renderer ($surface).">
        <div class="together">
          {() => (
            <Root id="board-dom" renderer={$dom(doc)} provide={[[Look, look()]]}>
              {() => <Board />}
            </Root>
          )}
          <Recover fallback={failed('Skia')}>
            <Pending fallback={<p class="quiet">Loading CanvasKit…</p>}>
              {() => {
                const { kit, font, mono } = /** @type {any} */ ($read(skia));
                const theme = look();
                return (
                  <Root id="board-skia" renderer={$skia(kit, { font, mono, width: 290, height: 360, scale: env.scale(), theme: theme.ren })} provide={[[Look, theme]]}>
                    {() => <Board />}
                  </Root>
                );
              }}
            </Pending>
          </Recover>
          <Recover fallback={failed('three.js')}>
            <Pending fallback={<p class="quiet">Loading three.js…</p>}>
              {() => {
                const theme = look();
                return (
                  <Root id="board-three" renderer={stage(/** @type {any} */ ($read(three)), { width: 290, height: 360, background: theme.colors.canvas, theme: theme.ren })} provide={[[Look, theme]]}>
                    {() => <Board />}
                  </Root>
                );
              }}
            </Pending>
          </Recover>
        </div>
      </Block>
    </div>
  );
}

export default {
  id: 'input',
  group: 'ren-core',
  title: 'Around a component',
  apis: ['$keys', '$focus', '$moves', '$scrolls', '$resizes', '$surface'],
  summary: 'A component hears more than its own handlers: every key of its root, every scroll that can move it, the moves and size changes of a node it holds, and which renderer draws it. The same board does so on the DOM, on Skia and in three.js.',
  View,
};
