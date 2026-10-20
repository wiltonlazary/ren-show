// The portable style: one component of primitives, styled once (a flexbox
// box model, paint, text, hover and press states), rendered by ren-dom,
// ren-skia and ren-three side by side, the same on each. Its text selects
// on every renderer (natively on the DOM; drawn by ren-canv on the canvases),
// its Arabic line is joined on each, as wide on the canvases as on the DOM,
// and the Gallery of every primitive runs on three.js alone. Where layout
// runs is a choice too: the DOM can take Taffy's boxes instead of the
// browser's, and Skia can lay out in a layout worker.

import { $signal, $read, $write, $lookup, $cleanup, $owner, $untrack } from 'rrx-core';
import { $active, $viewport, Root, Runtime, Pending, Recover, Label, Action, View as Box, Layout } from 'ren-core';
import { $dom } from 'ren-dom';
import { Flow } from 'ren-canv';
import { $skia } from 'ren-skia';
import { Assets } from '../assets.js';
import { Async } from '../async.js';
import { Block, Value, measure, follow } from '../kit.jsx';
import { Look, look, tone } from '../themes.js';
import { loadThree, stage } from './three.jsx';
import { Gallery, BADGE } from './primitives.jsx';

/** The card's right-to-left line: a sentence in Arabic, its letters joined by the shaper. */
export const ARABIC = 'بطاقة واحدة لكل عارض';

/**
 * The card: primitives and their portable style, nothing renderer-specific;
 * its text selects (`select: 'text'`), its buttons do not.
 * `line` hears the width of its Arabic line as its renderer lays it out.
 * @param {{ line?: (width: number) => void }} props
 */
export function Card(props) {
  const R = $active();
  const likes = $signal(R, 0);
  const c = look().colors;
  return (
    <Box style={{ width: 300, padding: 16, gap: 12, background: c.surface, radius: 14, border: 1, borderColor: c.rule, shadow: { y: 6, blur: 18, color: '#0000002e' }, select: 'text' }}>
      <Box style={{ direction: 'row', align: 'center', gap: 12 }}>
        <Box style={{ width: 40, height: 40, radius: 20, background: c.accent }} />
        <Box style={{ grow: 1, shrink: 1, gap: 2 }}>
          <Label text="Portable style" style={{ fontSize: 18, fontWeight: 'bold' }} />
          <Label text="one card, every renderer" style={{ color: c.muted, italic: true, fontSize: 14 }} />
        </Box>
      </Box>
      <Label wrap style={{ fontSize: 15, lineHeight: 1.45 }} text="Padding, a border, a shadow, rounded corners, a row that grows, wrapped text. Select it: drag, or double and triple click." />
      <Box style={{ direction: 'row', gap: 8 }}>
        <Action
          text={() => `Liked ${$read(likes)}`}
          style={{ grow: 1, radius: 20, background: c.accent, color: c.accentInk, hover: { background: `${c.accent}e0` }, press: { background: `${c.accent}c0` } }}
          onPress={() => $write(likes, $read(likes) + 1)}
        />
        <Action text="Reset" style={{ radius: 20, background: c.soft, color: c.ink, border: 1, borderColor: c.border }} onPress={() => $write(likes, 0)} />
      </Box>
      <Box style={{ display: 'grid', columns: 'repeat(3, 1fr)', gap: 6 }}>
        {['grid', 'of', 'three'].map((word, i) => (
          <Label text={word} style={{ padding: [4, 0], textAlign: 'center', radius: 6, background: c.soft, color: c.series[i], fontWeight: 'bold', fontSize: 14 }} />
        ))}
      </Box>
      <Label text="centered and underlined" style={{ textAlign: 'center', underline: true, color: c.accent }} />
      <Box style={{ direction: 'row' }}>
        <Label text={ARABIC} style={{ fontSize: 16 }} onResize={e => props.line?.(e.width)} />
      </Box>
    </Box>
  );
}

/**
 * The card's frame in the three.js overlay: 12 pixels around it, less where
 * the canvas is too narrow for them (a phone).
 * @param {{ children?: any }} props
 */
function Framed(props) {
  const view = $viewport();
  const pad = () => {
    const width = $read(view.width);
    return width > 0 ? Math.max(0, Math.min(12, Math.floor((width - 300) / 2))) : 12;
  };
  return <Box style={() => ({ padding: pad() })}>{props.children}</Box>;
}

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const skia = Async(R, () => env.skia, async load => {
    if (load === null) throw new Error('this environment has no CanvasKit');
    return load();
  });
  const three = loadThree(R, env);
  const engine = Async(R, () => env.engine, async load => {
    if (load === null) throw new Error('this environment has no layout engine');
    return load();
  });
  const doc = /** @type {any} */ ($lookup(Runtime).element)?.ownerDocument ?? null;
  /** The canvases' renderers, for the selection they hold. @type {Record<string, any>} */
  const canvases = {};
  const copied = $signal(R, '-');
  /** The Arabic line's width as each renderer of the first row lays it out. @type {Record<string, number>} */
  const lines = {};
  const widths = $signal(R, '-');
  const failed = (/** @type {string} */ what) => (/** @type {Error} */ error) => <Label text={`${what} is unavailable: ${error.message}`} color={tone('danger')} />;
  // Each canvas is as wide as the row it sits in (less its root's border), up to its own width.
  const box = measure(R, 680);
  const fits = (/** @type {number} */ most, /** @type {number} */ height) => () => /** @type {[number, number]} */ ([Math.min(most, box.width() - 2), height]);
  const side = fits(340, 370);
  const whole = fits(680, 560);
  /**
   * A canvas renderer made at its size, then resized with it.
   * @template {{ resize: (width: number, height: number) => void }} T
   * @param {() => [number, number]} size @param {(size: { width: number, height: number }) => T} make
   */
  const sized = (size, make) => {
    const S = $active();
    const [width, height] = $untrack(S, size);
    return follow(S, make({ width, height }), size);
  };
  return (
    <div class="demo">
      <Block title="One card, three renderers" note="The same Card component on the DOM (ren-dom writes its style as CSS), on a Skia canvas and in a three.js overlay (ren-canv lays it out and paints it, its Arabic line joined by the shaper as the browser joins it). Hover and press the buttons; select the text; measure the Arabic line on each.">
        <div class="together" ref={box.ref}>
          <div class="pane" data-side="dom">
            <Card line={w => (lines.DOM = w)} />
          </div>
          <Recover fallback={failed('Skia')}>
            <Pending fallback={<p class="quiet">Loading CanvasKit…</p>}>
              {() => {
                const { kit, font, mono } = /** @type {any} */ ($read(skia));
                const theme = look();
                const renderer = (canvases.skia = sized(side, at => $skia(kit, { font, mono, ...at, scale: env.scale(), theme: { ...theme.ren, canvas: 0 } })));
                return (
                  <Root id="style-skia" renderer={renderer} provide={[[Look, theme]]}>
                    {() => <Card line={w => (lines.Skia = w)} />}
                  </Root>
                );
              }}
            </Pending>
          </Recover>
          <Recover fallback={failed('three.js')}>
            <Pending fallback={<p class="quiet">Loading three.js…</p>}>
              {() => {
                const theme = look();
                const renderer = (canvases.three = sized(side, at => stage(/** @type {any} */ ($read(three)), { ...at, background: theme.colors.canvas, theme: theme.ren, camera: { position: [0, 0, 5] } })));
                return (
                  <Root id="style-three" renderer={renderer} provide={[[Look, theme]]}>
                    {() => (
                      <>
                        <mesh rotation={[0.5, 0.6, 0]}>
                          <torusKnotGeometry params={[0.9, 0.28, 120, 16]} />
                          <meshStandardMaterial color={theme.colors.series[1]} roughness={0.4} />
                        </mesh>
                        <ambientLight intensity={0.8} />
                        <directionalLight position={[3, 4, 5]} intensity={1.6} />
                        <Framed>
                          <Card line={w => (lines['three.js'] = w)} />
                        </Framed>
                      </>
                    )}
                  </Root>
                );
              }}
            </Pending>
          </Recover>
        </div>
        <Layout layout="row" gap={8}>
          <Action text="Copy the Skia selection" onPress={() => $write(copied, canvases.skia?.copied() || '(nothing selected)')} />
          <Action text="Copy the three.js selection" onPress={() => $write(copied, canvases.three?.overlay?.copied() || '(nothing selected)')} />
          <Action text="Measure the Arabic line" onPress={() => $write(widths, ['DOM', 'Skia', 'three.js'].map(k => `${k} ${lines[k]?.toFixed(2) ?? '-'}`).join(', '))} />
        </Layout>
        <p class="values">
          <Value label="selected on the canvas" value={copied} />
          <Value label="Arabic line, px" value={widths} />
        </p>
      </Block>
      <Block title="Where layout runs" note="The same Card again. On the left the DOM draws it, but Taffy lays it out on this thread (ren-dom's layout option, ren-canv's Flow): each element sits at Taffy's box. On the right Skia draws it and Taffy lays it out in a layout worker: this thread measures the text, sends the changes and paints the boxes that come back.">
        <Recover fallback={failed('The layout engine')}>
          <Pending fallback={<p class="quiet">Loading the layout engine…</p>}>
            {() => {
              const { fonts, layout } = /** @type {any} */ ($read(engine));
              const theme = look();
              const flow = new Flow(fonts, { theme: theme.ren });
              const owner = $owner($active());
              if (owner !== null) $cleanup(owner, () => flow.close());
              return (
                <div class="together">
                  <div class="pane" data-side="dom-taffy" style={() => ({ width: `${side()[0]}px` })}>
                    <Root id="style-dom-taffy" renderer={$dom(doc, { layout: flow })} provide={[[Look, theme]]}>
                      {() => <Card />}
                    </Root>
                  </div>
                  <Recover fallback={failed('Skia')}>
                    <Pending fallback={<p class="quiet">Loading CanvasKit…</p>}>
                      {() => {
                        const { kit, font, mono } = /** @type {any} */ ($read(skia));
                        const renderer = sized(side, at => $skia(kit, { font, mono, ...at, scale: env.scale(), theme: { ...theme.ren, canvas: 0 }, layout }));
                        return (
                          <Root id="style-skia-worker" renderer={renderer} provide={[[Look, theme]]}>
                            {() => <Card />}
                          </Root>
                        );
                      }}
                    </Pending>
                  </Recover>
                </div>
              );
            }}
          </Pending>
        </Recover>
      </Block>
      <Block title="Every primitive on three.js" note="The Gallery of Portable primitives, alone in a three.js root: the overlay lays out, edits, scrolls and selects it as ren-skia does. Type in the fields, turn the hand, scroll the list.">
        <Recover fallback={failed('three.js')}>
          <Pending fallback={<p class="quiet">Loading three.js…</p>}>
            {() => {
              const theme = look();
              const renderer = sized(whole, at => stage(/** @type {any} */ ($read(three)), { ...at, background: theme.colors.surface, theme: theme.ren }));
              return (
                <Root id="gallery-three" renderer={renderer} provide={[[Look, theme]]}>
                  {() => <Gallery source={BADGE} />}
                </Root>
              );
            }}
          </Pending>
        </Recover>
      </Block>
    </div>
  );
}

export default {
  id: 'style',
  group: 'ren-core',
  title: 'Portable style',
  apis: ['style', 'display: grid', 'hover', 'press', 'ren-canv', 'Taffy', 'Flow', 'remoteLayout', 'loadShaper', 'text selection', 'ren-three primitives'],
  summary: 'A primitive’s style is one vocabulary: CSS flexbox and grid, paint, text and interaction states. The browser lays out the DOM; ren-canv lays out ren-skia and ren-three with Taffy, the same CSS algorithms, shapes their text with HarfBuzz as the browser does (Arabic joined) and paints them, so one component looks and behaves the same on each, text selection included. The DOM can take Taffy\u2019s boxes too, and layout can run in a worker.',
  View,
};
