// The Skia renderer: the primitives Gallery, unchanged, in a nested root that
// lays out and paints on a canvas with CanvasKit. CanvasKit loads on demand,
// through an rrx-core Task, so this demo also shows Pending and Recover at work.

import { $read, $lookup, $task, $untrack } from 'rrx-core';
import { $active, Root, Pending, Recover, Label } from 'ren-core';
import { $skia } from 'ren-skia';
import { Assets } from '../assets.js';
import { Block, measure, follow } from '../kit.jsx';
import { Gallery, BADGE } from './primitives.jsx';
import { Look, look, tone } from '../themes.js';

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const loader = env.skia;
  // Loading CanvasKit is an async value like any other.
  const kit = $task(R, () => loader, (/** @type {typeof loader} */ load, complete) => {
    if (load === null) return complete({ ok: false, error: new Error('this environment has no CanvasKit') });
    load().then(
      value => complete({ ok: true, value }),
      error => complete({ ok: false, error }),
    );
  });
  // The canvas is as wide as its block, up to 680.
  const box = measure(R, 680);
  const size = () => /** @type {[number, number]} */ ([Math.min(680, box.width()), 560]);
  return (
    <div class="demo">
      <Block title="The Gallery on a canvas" note="This is the same component as in Portable primitives. The Skia renderer measures text with CanvasKit, lays out, paints and routes pointer and key input to the primitives. Click and type on the canvas.">
        <div ref={box.ref}>
          <Recover fallback={(/** @type {Error} */ error) => <Label text={`Skia is unavailable: ${error.message}`} color={tone('danger')} />}>
            <Pending fallback={<p class="quiet">Loading CanvasKit…</p>}>
              {() => {
                const { kit: canvaskit, font, mono, image } = /** @type {any} */ ($read(kit));
                const scale = env.scale();
                // A renderer's theme is fixed: a new theme makes a new canvas root.
                const theme = look();
                const S = $active();
                const [width, height] = $untrack(S, size);
                const renderer = follow(S, $skia(canvaskit, { font, mono, width, height, scale, image: image ?? undefined, theme: theme.ren }), size);
                return (
                  <Root id="gallery-skia" renderer={renderer} provide={[[Look, theme]]}>
                    {() => <Gallery source={BADGE} />}
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
  id: 'skia',
  group: 'ren-core',
  title: 'Skia renderer',
  apis: ['$skia', 'Root', '$task', 'Pending', 'Recover'],
  summary: 'The same components render on a CanvasKit canvas. The renderer keeps a retained scene, does its own layout and text measurement, replays flat paint commands, and routes input through hit regions.',
  View,
};
