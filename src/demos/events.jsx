// Events on the DOM renderer: delegated handlers, stopPropagation, `prevent`,
// refs, and one flush per handler. Then a touch on every renderer: the
// portable `touchAction` style says which pans and zoom the browser may
// take, and `onPointerCancel` ends a press the browser took back.

import { $signal, $read, $write, $memo, $lookup, $untrack } from 'rrx-core';
import { $active, Root, Pending, Recover, Action, Label, Layout, View as Box } from 'ren-core';
import { $skia } from 'ren-skia';
import { Assets } from '../assets.js';
import { Async } from '../async.js';
import { Journal, Lines, Block, Value, measure, follow } from '../kit.jsx';
import { Look, look, tone } from '../themes.js';
import { loadThree, stage } from './three.jsx';

/** A touch pad's height, in pixels. */
export const PAD = 150;

/**
 * One pad: a press, its moves and how it ended. `touchAction` 'none' keeps
 * every touch for the pad (the drag stays); 'pan-y' leaves a vertical
 * swipe to the browser, which scrolls the page and takes the pointer back:
 * the press ends with onPointerCancel, and no onPointerUp follows.
 * @param {{ name: string, touch: 'none' | 'pan-y', width: number }} props
 */
function Pad(props) {
  const R = $active();
  const c = look().colors;
  const state = $signal(R, 'idle');
  /** @type {{ x: number, y: number, far: number } | null} */
  let press = null;
  const far = () => Math.round(press?.far ?? 0);
  return (
    <Box
      data-pad={props.name}
      style={{ width: props.width, height: PAD, padding: 10, gap: 4, radius: 10, background: c.soft, border: 1, borderColor: c.border, touchAction: props.touch, select: 'none', cursor: 'grab' }}
      onPointerDown={e => {
        press = { x: e.x, y: e.y, far: 0 };
        /** @type {any} */ (e.currentTarget)?.setPointerCapture?.(e.pointerId);
        $write(state, 'pressed');
      }}
      onPointerMove={e => {
        if (press === null) return;
        press.far = Math.max(press.far, Math.hypot(e.x - press.x, e.y - press.y));
        $write(state, `dragging ${far()} px`);
      }}
      onPointerUp={() => {
        if (press === null) return;
        $write(state, `released after ${far()} px`);
        press = null;
      }}
      onPointerCancel={() => {
        if (press === null) return;
        $write(state, `cancelled after ${far()} px`);
        press = null;
      }}
    >
      <Label text={`touchAction: '${props.touch}'`} style={{ fontWeight: 'bold', fontSize: 14 }} />
      <Label wrap text={props.touch === 'none' ? 'Swipe here: the pad keeps the drag.' : 'Swipe up or down: the page scrolls, the press is cancelled.'} style={{ fontSize: 12, color: c.muted }} />
      <Label data-state={props.name} text={state} style={{ fontSize: 13, color: c.accent, fontWeight: 'bold' }} />
    </Box>
  );
}

/** The two pads, side by side, `width` wide in all. @param {{ width: number }} props */
export function Pads(props) {
  const half = Math.floor((props.width - 8) / 2);
  return (
    <Box style={{ direction: 'row', gap: 8, width: props.width }}>
      <Pad name="none" touch="none" width={half} />
      <Pad name="pan-y" touch="pan-y" width={half} />
    </Box>
  );
}

function View() {
  const R = $active();
  const journal = Journal(R);
  const note = journal.note;
  const stop = $signal(R, false);
  /** @param {any} e */
  const who = e => e.currentTarget.getAttribute('data-name');

  // One handler, two writes, one recompute: each handler runs as a $batch.
  const a = $signal(R, 0);
  const b = $signal(R, 0);
  let sums = 0;
  const sum = $memo(R, () => (sums++, $read(a) + $read(b)));

  // The pads on every renderer: the DOM here, a Skia canvas and a three.js overlay.
  const env = $lookup(Assets);
  const skia = Async(R, () => env.skia, async load => {
    if (load === null) throw new Error('this environment has no CanvasKit');
    return load();
  });
  const three = loadThree(R, env);
  const box = measure(R, 360);
  const size = () => /** @type {[number, number]} */ ([Math.min(360, box.width() - 2), PAD]);
  const failed = (/** @type {string} */ what) => (/** @type {Error} */ error) => <Label text={`${what} is unavailable: ${error.message}`} color={tone('danger')} />;
  /**
   * A canvas renderer made at its size, then resized with it.
   * @template {{ resize: (width: number, height: number) => void }} T
   * @param {(size: { width: number, height: number }) => T} make
   */
  const sized = make => {
    const S = $active();
    const [width, height] = $untrack(S, size);
    return follow(S, make({ width, height }), size);
  };

  /** @type {any} */
  let field = null;
  const pointer = $signal(R, 'move over the pad');
  const submitted = $signal(R, 'nothing submitted');

  return (
    <div class="demo">
      <Block title="Delegation and stopPropagation" note="One listener per event type at the root dispatches to handlers along the path, from the target up. currentTarget is the element the handler is on.">
        <Action text={() => ($read(stop) ? 'Inner stops propagation' : 'Inner lets it bubble')} selected={stop} onPress={() => $write(stop, !$read(stop))} />
        <div class="nest" data-name="outer" onClick={e => note(`outer handler, currentTarget ${who(e)}`)}>
          outer
          <div class="nest" data-name="middle" onClick={e => note(`middle handler, currentTarget ${who(e)}`)}>
            middle
            <button
              data-name="inner"
              onClick={e => {
                note(`inner handler, currentTarget ${who(e)}`);
                if ($read(stop)) e.stopPropagation();
              }}
            >
              Click the inner button
            </button>
          </div>
        </div>
      </Block>
      <Block title="One flush per handler">
        <button
          onClick={() => {
            $write(a, $read(a) + 1);
            $write(b, $read(b) + 1);
          }}
        >
          Write a and b in one handler
        </button>
        <p class="values">
          <Value label="a + b" value={sum} />
          <Value label="sum computed" value={() => ($read(sum), `${sums}×`)} />
        </p>
      </Block>
      <Block title="prevent, refs and direct events" note="prevent cancels a default action on the main thread, in direct and worker mode. A ref receives the element (here a function ref).">
        <form prevent="submit" onSubmit={() => $write(submitted, `submitted "${field.value}" without reloading`)}>
          <input ref={el => (field = el)} name="word" placeholder="type, then press Submit" onFocus={() => note('focus (a direct listener)')} onBlur={() => note('blur (a direct listener)')} />
          <button type="submit">Submit</button>
          <button type="button" onClick={() => field.focus()}>
            Focus through the ref
          </button>
        </form>
        <Label text={submitted} />
        <div class="pad" onPointerMove={e => $write(pointer, `pointer at ${Math.round(e.offsetX)}, ${Math.round(e.offsetY)}`)} onDblClick={() => note('double click on the pad')}>
          {pointer}
        </div>
        <Layout layout="row" gap={8}>
          <Action text="Clear the journal" onPress={journal.clear} />
        </Layout>
      </Block>
      <Block title="Touch: touchAction and onPointerCancel" note="Two pads on each renderer. touchAction 'none' keeps every touch for the pad, so a swipe stays a drag and ends with onPointerUp. 'pan-y' leaves a vertical swipe to the browser: the page scrolls, and the press ends with onPointerCancel, no onPointerUp after it. ren-dom sets CSS's touch-action; the canvases find it under the touch and cancel the press as the browser does.">
        <div class="roots touch" ref={box.ref}>
          <div class="pane" data-side="dom" data-touch="dom">
            {() => <Pads width={size()[0]} />}
          </div>
          <Recover fallback={failed('Skia')}>
            <Pending fallback={<p class="quiet">Loading CanvasKit…</p>}>
              {() => {
                const { kit, font, mono } = /** @type {any} */ ($read(skia));
                const theme = look();
                const renderer = sized(at => $skia(kit, { font, mono, ...at, scale: env.scale(), theme: { ...theme.ren, canvas: 0 } }));
                return (
                  <Root id="events-touch-skia" renderer={renderer} provide={[[Look, theme]]}>
                    {() => <Pads width={size()[0]} />}
                  </Root>
                );
              }}
            </Pending>
          </Recover>
          <Recover fallback={failed('three.js')}>
            <Pending fallback={<p class="quiet">Loading three.js…</p>}>
              {() => {
                const theme = look();
                const renderer = sized(at => stage(/** @type {any} */ ($read(three)), { ...at, scale: env.scale(), background: theme.colors.canvas, theme: theme.ren }));
                return (
                  <Root id="events-touch-three" renderer={renderer} provide={[[Look, theme]]}>
                    {() => <Pads width={size()[0]} />}
                  </Root>
                );
              }}
            </Pending>
          </Recover>
        </div>
      </Block>
      <Block title="Journal">
        <Lines of={journal.lines} />
      </Block>
    </div>
  );
}

export default {
  id: 'events',
  group: 'ren-core',
  title: 'Events',
  apis: ['on<Event>', 'prevent', 'ref', 'currentTarget', 'stopPropagation', '$batch', 'touchAction', 'onPointerCancel', 'setPointerCapture', '$skia', '$three'],
  summary: 'Bubbling events are delegated: one listener per type at the root. Each handler runs as one $batch, so it flushes once. prevent cancels default actions synchronously, and it works in worker mode as well. On every renderer, touchAction says which pans the browser may take from a touch, and onPointerCancel ends a press it took back.',
  View,
};
