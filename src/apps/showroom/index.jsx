// Showroom: a product configurator where the whole experience lives
// in one three.js root (ren-three): the product built from three.js
// geometry in JSX, the studio lighting and its shadow, the orbit camera,
// the animated flights, crossfades and exploded view, and the interface
// itself as ren-core's portable primitives inside the scene (the overlay over
// the canvas, and panels in 3D with an Edit and selectable text). The page
// around it is one line of DOM: where the scene application runs (this
// thread, or a worker with three.js staying here), its frame rate, and the
// configuration it reports.

import { $signal, $read, $write, $batch, $watch, $untrack, $lookup } from 'rrx-core';
import { $active, Root, Show, Pending, Recover, Label } from 'ren-core';
import { Assets } from '../../assets.js';
import { look, tone } from '../../themes.js';
import { loadThree, stage } from '../../demos/three.jsx';
import { DEFAULTS, summary, dollars, price } from './materials.js';
import { WIDTH, canvasFor, controls } from './layout.js';
import { measure, follow } from '../../kit.jsx';
import { Showroom } from './scene.jsx';

/** @typedef {import('./materials.js').Config} Config */

/**
 * What draws in a browser: WebGL with filmic tone mapping and soft shadows
 * (tests bring a drawer stub instead).
 * @param {{ THREE: Record<string, any>, renderer?: any }} loaded
 */
const drawer = loaded =>
  loaded.renderer ??
  ((/** @type {any} */ canvas) => {
    const { THREE } = loaded;
    const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    return gl;
  });

/**
 * The application. `probe` receives each renderer as it is made (tests
 * drive its frames and input); `options` adds to the renderer's options
 * (tests pass `schedule: false`); `rotate` starts the turntable on or off.
 * @param {{ probe?: (renderer: any) => void, options?: Record<string, any>, rotate?: boolean }} props
 */
function View(props) {
  const R = $active();
  const env = $lookup(Assets);
  const three = loadThree(R, env);
  const inWorker = $signal(R, false);
  const config = $signal(R, /** @type {Config} */ ({ ...DEFAULTS }));
  const bag = $signal(R, 0);
  const fps = $signal(R, 0);
  const frames = $signal(R, 0);
  const spots = $signal(R, /** @type {Record<string, number[] | null>} */ ({}));
  const opened = $signal(R, '');
  const still = $signal(R, false);
  const hover = $signal(R, '');
  const layout = $signal(R, /** @type {any} */ (null));
  // What a new root starts from (a move to or from the worker makes one): the last reported state.
  const kept = { initial: /** @type {Config} */ ({ ...DEFAULTS }), bag: 0 };
  const onMessage = (/** @type {any} */ data) => {
    if (data.config !== undefined) {
      kept.initial = data.config;
      $write(config, data.config);
    }
    if (data.bag !== undefined) $write(bag, (kept.bag = data.bag));
    if (data.fps !== undefined) $write(fps, data.fps);
    if (data.frames !== undefined) $write(frames, data.frames);
    if (data.spots !== undefined) $write(spots, data.spots);
    if (data.open !== undefined) $write(opened, data.open);
    if (data.still !== undefined) $write(still, data.still);
    if (data.hover !== undefined) $write(hover, data.hover);
    if (data.layout !== undefined) $write(layout, data.layout);
  };
  /** The renderer of the current root, which takes each new theme. @type {any} */
  let live = null;
  $watch(R, () => look().ren, tokens => {
    if (live !== null && live.options.theme !== tokens) live.setTheme(tokens);
  });
  const failed = (/** @type {Error} */ error) => <Label text={`three.js is unavailable: ${error.message}`} color={tone('danger')} />;
  // The scene's size: the full 1000 by 640, or on a tablet or a phone the
  // page's width (less the frame): on a tablet a little taller, the bar in two
  // rows; on a phone taller still, the overlay stacked (layout.js, canvasFor).
  const box = measure(R, WIDTH + 2);
  const size = () => canvasFor(box.width() - 2).size;
  const compact = () => canvasFor(box.width() - 2).layout === 'compact';
  return (
    // For tools outside: data-layout, the canvas's (full, tablet or compact); data-boxes, where the overlay's parts and the side panels show; data-controls, where each control of the overlay shows on the canvas; data-spots, where each hotspot and the engraving field show now; data-open and data-hover, the open and the hovered hotspot; data-still, whether the camera and parts hold still.
    <div class="app-showroom" ref={box.ref} data-layout={() => canvasFor(box.width() - 2).layout} data-controls={() => (compact() ? '' : JSON.stringify(controls(...size())))} data-boxes={() => JSON.stringify($read(layout))} data-spots={() => JSON.stringify($read(spots))} data-frames={() => String($read(frames))} data-bag={() => String($read(bag))} data-open={opened} data-still={() => String($read(still))} data-hover={hover}>
      <div class="strip">
        <span class="badge">ren-three</span>
        <span class="where">{() => `Scene application ${$read(inWorker) ? 'in a worker · three.js on this thread' : 'on this thread'}`}</span>
        <span class="config">{() => `${summary($read(config))} · ${dollars(price($read(config)))}`}</span>
        <span class="fps">{() => `${$read(fps)} fps`}</span>
        <span class="bag">{() => `bag ${$read(bag)}`}</span>
        {env.worker === null ? null : (
          <button type="button" aria-pressed={() => String($read(inWorker))} onClick={() => $batch(R, () => ($write(frames, 0), $write(inWorker, !$read(inWorker))))}>
            {() => ($read(inWorker) ? 'Run on this thread' : 'Run in a worker')}
          </button>
        )}
      </div>
      <div class={() => (compact() ? 'scene compact' : 'scene')} style={() => ({ width: `${size()[0]}px`, height: `${size()[1]}px` })}>
        <Recover fallback={failed}>
          <Pending fallback={<p class="quiet">Loading three.js…</p>}>
            {() => {
              const loaded = /** @type {any} */ ($read(three));
              // The renderer starts in the current theme and takes each new one in place (setTheme);
              // the scene reads it from its props, so nothing is remade and no state is lost.
              const renderer = () => {
                const S = $active();
                const [width, height] = $untrack(S, size);
                const made = follow(S, stage(loaded, { width, height, theme: $untrack(R, look).ren, renderer: drawer(loaded), ...props.options }), size);
                live = made;
                props.probe?.(made);
                return made;
              };
              const settings = () => ({ theme: look(), initial: kept.initial, bag: kept.bag, rotate: props.rotate ?? true, width: size()[0], height: size()[1] });
              return (
                <Show
                  when={inWorker}
                  fallback={() => (
                    <Root id="showroom-scene" renderer={renderer()} props={settings} onMessage={onMessage}>
                      {() => <Showroom />}
                    </Root>
                  )}
                >
                  {() => <Root id="showroom-worker" runtime="worker" worker={/** @type {any} */ (env.worker)} renderer={renderer()} props={settings} onMessage={onMessage} />}
                </Show>
              );
            }}
          </Pending>
        </Recover>
      </div>
    </div>
  );
}

export default {
  id: 'showroom',
  title: 'Showroom',
  tagline: 'A product configurator living entirely in one three.js root: the product, the camera and the interface',
  apis: [
    '$three',
    'setTheme',
    'slot',
    '$animate',
    'main',
    'params',
    'raycast events',
    'onPointerDown',
    'onPointerMove',
    'onPointerUp',
    'onPointerCancel',
    'onWheel',
    'onPointerOver',
    'onPointerOut',
    'stopPropagation',
    'ren-three primitives',
    'overlay',
    'panels',
    'text selection',
    'View',
    'Label',
    'Action',
    'Edit',
    'style',
    'Root',
    'Props',
    'Send',
    'Root runtime="worker"',
    'serve',
    'CONSTRUCT',
    '$store',
    '$at',
    '$put',
    '$watch',
    '$batch',
    '$untrack',
    'Show',
    'Pending',
    'Recover',
  ],
  summary:
    'Over-ear headphones built from three.js geometry in JSX (lathed aluminium cups, tori, cylinders), lit like a studio with a soft shadow and filmic tone mapping. Drag to orbit, zoom with the wheel, press the dots for detail cards that turn to face you. The configurator is ren-core primitives in the scene: finishes crossfade, cushions swap material, the size rebuilds the band in place, and the exploded view pulls every part apart. A spec card and an engraving Edit float beside the product as panels in 3D, typed and selected through the raycast. The scene application runs on this thread or in a worker.',
  View,
};
