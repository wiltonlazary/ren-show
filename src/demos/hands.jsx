// Under the user's hands: how a root behaves as text is pressed, selected
// and edited. One desk of portable primitives, on the DOM, on Skia and in a
// three.js overlay, each in its own root that behaves as an application
// (`behavior: 'app'`, the default: loose text does not select) or as a page.
// `$presses` hears every press in the root and `textAt` names the text under
// it; the desk's own buttons then act as an application's menus would:
// `editOf` gives the field's undo, redo, select all and replace, and
// `selectText` and `selectedText` select the pressed text and read it.

import { $signal, $read, $write, $lookup } from 'rrx-core';
import { $active, $surface, $presses, editOf, textAt, selectText, selectedText, Root, Pending, Recover, Label, Action, Edit, View as Box, Runtime } from 'ren-core';
import { $dom } from 'ren-dom';
import { $skia } from 'ren-skia';
import { Assets } from '../assets.js';
import { Async } from '../async.js';
import { Block } from '../kit.jsx';
import { loadThree, stage } from './three.jsx';
import { Look, look, tone } from '../themes.js';

/** The loose line: an application's text does not select; a page's does. */
export const LOOSE = 'Loose text: selects in a page, not in an app';
/** The opted-in line (`select: 'text'`): it selects in either. */
export const OPTED = 'Hall B, Thursday 19:00, bring a pencil';

/** The desk: two lines of text, a field, and buttons acting as an application's own menus. */
export function Desk() {
  const R = $active();
  const kind = $surface().kind;
  const c = look().colors;
  const draft = $signal(R, 'rehearsal moved to thursday');
  const heard = $signal(R, '-');
  const pressed = $signal(R, /** @type {{ node: any, text: string } | null} */ (null));
  const chosen = $signal(R, '');
  const steps = $signal(R, { undo: false, redo: false });
  /** @type {any} */
  let field = null;
  // The field's actions: null on a renderer without them (a worker's Handle).
  const edit = () => editOf(field);
  const sync = () => {
    const e = edit();
    $write(steps, { undo: e?.canUndo() ?? false, redo: e?.canRedo() ?? false });
  };
  // Every press in this root, after the pressed item heard it: the text under it, if any (none over a field or a button).
  $presses(e => {
    $write(heard, `${e.pointerType || 'pointer'} button ${e.button}`);
    const hit = textAt(e);
    if (hit !== null) $write(pressed, hit);
  });
  const upper = () => {
    const e = edit();
    if (e === null) return;
    if (e.selection().start === e.selection().end) e.selectAll();
    const { start, end } = e.selection();
    e.replace(e.value().slice(start, end).toUpperCase());
    sync();
  };
  const step = (/** @type {'undo' | 'redo'} */ way) => {
    edit()?.[way]();
    sync();
  };
  const choose = () => {
    const hit = $read(pressed);
    if (hit === null) return;
    selectText(hit.node);
    $write(chosen, selectedText(hit.node));
  };
  const small = { fontSize: 12, color: c.muted };
  return (
    <Box style={{ width: 280, padding: 12, gap: 8, background: c.surface, radius: 12, border: 1, borderColor: c.rule }}>
      <Label wrap text={`On ${kind}: press a line, then a button`} style={{ fontSize: 13, color: c.muted }} />
      <Label wrap text={LOOSE} style={{ color: c.ink }} />
      <Label wrap text={OPTED} style={{ select: 'text', padding: [4, 8], radius: 6, background: c.soft, color: c.ink, fontWeight: 'bold' }} />
      <Edit ref={(/** @type {any} */ el) => (field = el)} label="Note" value={draft} onChange={e => ($write(draft, e.value), sync())} width={256} />
      <Box style={{ direction: 'row', wrap: true, gap: 6 }}>
        <Action text="Undo" onPress={() => step('undo')} />
        <Action text="Redo" onPress={() => step('redo')} />
        <Action text="Select all" onPress={() => (edit()?.selectAll(), edit()?.focus())} />
        <Action text="UPPER CASE" onPress={upper} />
        <Action text="Select the pressed text" onPress={choose} />
      </Box>
      <Label data-pressed="" wrap text={() => `heard ${$read(heard)} · pressed “${$read(pressed)?.text ?? '-'}”`} style={small} />
      <Label data-chosen="" wrap text={() => `selected “${$read(chosen) || '-'}”`} style={small} />
      <Label data-history="" text={() => `undo ${$read(steps).undo ? 'ready' : 'empty'} · redo ${$read(steps).redo ? 'ready' : 'empty'}`} style={small} />
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
  // How the three roots behave: as an application (the default) or as a web page; each is made again on a change.
  const behavior = $signal(R, /** @type {'app' | 'page'} */ ('app'));
  const failed = (/** @type {string} */ what) => (/** @type {Error} */ error) => <Label text={`${what} is unavailable: ${error.message}`} color={tone('danger')} />;
  return (
    <div class="demo">
      <Block title="One desk, every renderer" note="Each desk is its own root. As an application (behavior 'app'), its loose line does not select, while the highlighted line opts in (select: 'text'); as a page, both do. A press anywhere in a root reaches $presses, and textAt names the text under it. The buttons act as an application's own menus: editOf gives the field's undo, redo, select all and replace (UPPER CASE), and selectText and selectedText select the pressed line and read it.">
        <p>
          <button type="button" aria-pressed={() => String($read(behavior) === 'app')} onClick={() => $write(behavior, 'app')}>
            Behave as an app
          </button>{' '}
          <button type="button" aria-pressed={() => String($read(behavior) === 'page')} onClick={() => $write(behavior, 'page')}>
            Behave as a page
          </button>
        </p>
        <div class="together">
          {() => (
            <Root id="desk-dom" renderer={$dom(doc, { behavior: $read(behavior) })} provide={[[Look, look()]]}>
              {() => <Desk />}
            </Root>
          )}
          <Recover fallback={failed('Skia')}>
            <Pending fallback={<p class="quiet">Loading CanvasKit…</p>}>
              {() => {
                const { kit, font, mono } = /** @type {any} */ ($read(skia));
                const theme = look();
                return (
                  <Root id="desk-skia" renderer={$skia(kit, { font, mono, width: 290, height: 400, scale: env.scale(), theme: theme.ren, behavior: $read(behavior) })} provide={[[Look, theme]]}>
                    {() => <Desk />}
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
                  <Root id="desk-three" renderer={stage(/** @type {any} */ ($read(three)), { width: 290, height: 400, background: theme.colors.canvas, theme: theme.ren, behavior: $read(behavior) })} provide={[[Look, theme]]}>
                    {() => <Desk />}
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
  id: 'hands',
  group: 'ren-core',
  title: 'Under the user’s hands',
  apis: ["behavior: 'app' | 'page'", "select: 'text'", '$presses', 'textAt', 'selectText', 'selectedText', 'editOf'],
  summary: 'How a root behaves as text is pressed, selected and edited: as an application by default (loose text does not select) or as a page, with text opted in to selection; every press in the root heard, the text under it named, and a field and text acted on as an application’s own menus would, the same on the DOM, on Skia and in three.js.',
  View,
};
