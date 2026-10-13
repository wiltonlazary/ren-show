// The three.js renderer (ren-three): a scene written in JSX (scene.jsx), in
// a nested root on a WebGL canvas. three.js loads on demand, as its own
// chunk. The scene's objects are three.js objects: reactive properties set
// them, a For adds and removes meshes, `$animate` spins the knot, and pointer
// events are raycast. The scene's application runs on this thread or in a
// worker; three.js and the scene objects stay here either way. The DOM
// controls reach it only through the root's props, and picks come back as
// messages.

import { $signal, $read, $write, $lookup, $untrack } from 'rrx-core';
import { $active, Root, Pending, Recover, Label, Action, Layout, Show, Runtime } from 'ren-core';
import { $three } from 'ren-three';
import { Scene } from '../scene.jsx';
import { Assets } from '../assets.js';
import { Async } from '../async.js';
import { Block, Value, measure, follow } from '../kit.jsx';
import { look, tone } from '../themes.js';

/**
 * Loads three.js through the environment, as a task: the demos wait for it
 * under Pending and show Recover where there is none.
 * @param {import('rrx-core').Graph} R @param {import('../assets.js').Environment} env
 */
export const loadThree = (R, env) =>
  Async(R, () => env.three, async load => {
    if (load === null) throw new Error('this environment has no three.js');
    return load();
  });

/**
 * A renderer for a nested root, from what the environment loaded (tests add
 * a drawer stub; the browser draws with WebGL), with the fonts its
 * primitives are drawn in.
 * @param {{ THREE: Record<string, any>, renderer?: any, font?: ArrayBuffer | Uint8Array, mono?: ArrayBuffer | Uint8Array }} loaded @param {import('ren-three').Options} options
 */
export const stage = (loaded, options) => $three(loaded.THREE, { renderer: loaded.renderer, font: loaded.font, mono: loaded.mono, ...options });

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const three = loadThree(R, env);
  const count = $signal(R, 5);
  const spin = $signal(R, true);
  const speed = $signal(R, 1);
  const picked = $signal(R, '-');
  const frames = $signal(R, 0);
  const inWorker = $signal(R, false);
  const onMessage = (/** @type {any} */ data) => {
    if (data.picked !== undefined) $write(picked, data.picked);
    if (data.frames !== undefined) $write(frames, data.frames);
  };
  // The canvas is as wide as its block (less its root's border), up to 680, and keeps its 680 by 360 shape.
  const box = measure(R, 680);
  const size = () => {
    const width = Math.min(680, box.width() - 2);
    return /** @type {[number, number]} */ ([width, Math.round((width * 360) / 680)]);
  };
  const props = () => ({ count: $read(count), spin: $read(spin), speed: $read(speed), colors: look().colors.series, surface: look().colors.surface });
  return (
    <div class="demo">
      <Block title="A scene in JSX" note="Every lowercase element is the three.js class of that name. Hover and click the meshes. The buttons are in the DOM root; the scene gets them as props, and sends picks and frame counts back as messages. Its application can run in a worker: three.js and the scene objects stay on this thread, with the renderer.">
        <Layout layout="row" gap={8}>
          <Action text="Add a cube" onPress={() => $write(count, Math.min(8, $read(count) + 1))} />
          <Action text="Remove a cube" onPress={() => $write(count, Math.max(0, $read(count) - 1))} />
          <Action text={() => ($read(spin) ? 'Stop spinning' : 'Spin')} onPress={() => $write(spin, !$read(spin))} />
          <Action text="Faster" onPress={() => $write(speed, $read(speed) * 2)} />
          {env.worker === null ? null : <Action text={() => ($read(inWorker) ? 'Run the scene on this thread' : 'Run the scene in a worker')} onPress={() => $write(inWorker, !$read(inWorker))} />}
        </Layout>
        <p class="values">
          <Value label="cubes" value={count} />
          <Value label="speed" value={() => `${$read(speed)}×`} />
          <Value label="picked" value={picked} />
          <Value label="frames animated" value={frames} />
          <Value label="scene application" value={() => ($read(inWorker) ? 'in a worker' : 'on this thread')} />
        </p>
        <div ref={box.ref}>
          <Recover fallback={(/** @type {Error} */ error) => <Label text={`three.js is unavailable: ${error.message}`} color={tone('danger')} />}>
            <Pending fallback={<p class="quiet">Loading three.js…</p>}>
              {() => {
                const loaded = /** @type {any} */ ($read(three));
                // The background is the renderer's: a new theme makes a new root.
                const background = look().colors.surface;
                const theme = look().ren;
                // A function child: each switch makes a fresh renderer (one renderer serves one root).
                const renderer = () => {
                  const S = $active();
                  const [width, height] = $untrack(S, size);
                  return follow(S, stage(loaded, { width, height, background, theme, camera: { position: [0, 0.2, 5.2] } }), size);
                };
                return (
                  <Show
                    when={inWorker}
                    fallback={() => (
                      <Root id="three-scene" renderer={renderer()} props={props} onMessage={onMessage}>
                        {() => <Scene />}
                      </Root>
                    )}
                  >
                    {() => <Root id="three-worker" runtime="worker" worker={/** @type {any} */ (env.worker)} renderer={renderer()} props={props} onMessage={onMessage} />}
                  </Show>
                );
              }}
            </Pending>
          </Recover>
        </div>
        <p class="note">{() => `The parent renders with ${$lookup(Runtime).renderer}; the scene's root with ren-three.`}</p>
      </Block>
    </div>
  );
}

export default {
  id: 'three',
  group: 'ren-core',
  title: 'three.js renderer',
  apis: ['$three', '$animate', 'CONSTRUCT', 'serve', 'Root', 'Props', 'Send', 'For', '$task'],
  summary: 'ren-three renders JSX into a three.js scene: lowercase elements are three.js classes, properties bind reactively, lists add and remove meshes, $animate runs per frame, and pointer events are raycast. Frames render only when the scene changes or something animates. In worker mode only the application runs in the worker; three.js stays on the main thread.',
  View,
};
