// Showroom's scene application: everything inside the three.js root. It
// knows nothing of where it runs: on the page's thread, or served from a
// worker (worker.jsx) while three.js and the renderer stay on the page. It
// reads the theme and the configuration to start from in its props, keeps
// its state in one `$store`, and reports the configuration, the bag, its
// frame rate and where its hotspots show as messages.
//
// The camera is a rig of two groups (yaw, pitch) and a `main`
// camera at the distance, all driven by signals, so the orbit works the
// same in a worker, where `$animate` has no camera. The pointer orbits and
// zooms through raycast events on a backdrop that draws nothing, around the
// scene; the hotspots take their own clicks first.

import { $signal, $read, $write, $memo, $store, $at, $put, $batch, $watch, $untrack, $lookup } from 'rrx-core';
import { $active, Props, Send, Show } from 'ren-core';
import { $animate } from 'ren-three';
import { look } from '../../themes.js';
import { DEFAULTS, CUSHIONS, BANDS, SIZES, LIGHTS, pick, etched, price } from './materials.js';
import { TARGET, FOV, HOME, SPIN, DRAG, LIMITS, clamp, approach, nearest, screen, placed, facing, basis } from './orbit.js';
import { WIDTH, HEIGHT, COMPACT, EDGE, widen, regions } from './layout.js';
import { Headphones, places, CUP_Y, reader } from './product.jsx';
import { Overlay, Compact, SpecCard, EngraveCard, DetailCard, ENGRAVE } from './ui.jsx';

/** @typedef {import('./materials.js').Config} Config */
/** @typedef {import('./orbit.js').Orbit} Orbit */

/**
 * The colors of a theme that may change: each read goes to the current
 * theme, so a binding or a style function that reads one follows it.
 * @param {() => import('../../themes.js').Theme} theme
 * @returns {import('../../themes.js').Palette}
 */
const palette = theme => /** @type {any} */ (new Proxy({}, { get: (_, key) => /** @type {any} */ (theme().colors)[key] }));

/**
 * On a compact (phone) canvas the camera stands further back, so the
 * product fits the narrow view, and turns about a point below the
 * product's, so the product shows above the configurator stacked under it.
 */
export const LENS = 1.55;
export const LOW = [TARGET[0], TARGET[1] - 0.45, TARGET[2]];

/** three.js's side constants, as numbers (the worker has no three.js): the backdrop is seen from inside. */
const BACK_SIDE = 1;

/**
 * Where the side panels stand, in the frame of the camera's yaw: beside the
 * product on screen whichever way the camera has turned, so they never hide
 * it, each turned a little towards it (so they read as cards in 3D).
 */
/** The floor's height, and how far above it a side panel's lower edge stands (world units). */
export const FLOOR = -1.19;
const LIFT = 0.15;
/** A panel's centre height for a panel `high` pixels high (0.01 world units a pixel): its lower edge above the floor. @param {number} high */
export const standing = high => FLOOR + LIFT + (high * 0.01) / 2;
/** The spec card's height (px) before it reports its own: it grows with the options it lists. */
const SPEC_HIGH = 280;
export const SPEC_AT = { at: [2.45, standing(SPEC_HIGH), -0.35], turn: -0.5 };
export const ENGRAVE_AT = { at: [-2.55, standing(ENGRAVE.height), 0.6], turn: 0.5 };
/** The engraving field's centre in its panel's plane (world units, from the panel's centre). */
const FIELD = [0, (ENGRAVE.height / 2 - (ENGRAVE.padding + ENGRAVE.title + ENGRAVE.gap + ENGRAVE.field / 2)) * 0.01, 0];

/**
 * A hotspot: a point on the product that opens a detail card, and the
 * orbit the camera flies to when it opens.
 * @typedef {object} Spot
 * @property {string} id
 * @property {(c: Config) => string} title
 * @property {(c: Config) => string} body
 * @property {(radius: number, spread: number) => number[]} at
 * @property {number[]} normal the way its surface faces: from behind the part it is hidden
 * @property {Orbit} view
 */

/** @type {Spot[]} */
export const SPOTS = [
  {
    id: 'crown',
    title: () => 'Digital crown',
    body: () => 'Turn it for volume; press to play, pause or answer. The same anodized aluminium as the cup, knurled for grip.',
    at: (r, s) => [places(r, s).cup + 0.06, CUP_Y + 0.5, 0.15],
    normal: [0.2, 1, 0.3],
    view: { yaw: 1.0, pitch: 0.38, distance: 5.4 },
  },
  {
    id: 'band',
    title: c => `Headband · ${pick(BANDS, c.band).name}`,
    body: c => `${pick(BANDS, c.band).note[0].toUpperCase()}${pick(BANDS, c.band).note.slice(1)}. Size ${pick(SIZES, c.size).name} sets its radius; the stems extend to fit.`,
    at: (r, s) => [-0.707 * r, places(r, s).band + 0.707 * r, 0.07],
    normal: [-0.6, 0.6, 0.55],
    view: { yaw: -0.3, pitch: 0.55, distance: 5.6 },
  },
  {
    id: 'cushion',
    title: c => `Ear cushions · ${pick(CUSHIONS, c.cushion).name}`,
    body: c => `${pick(CUSHIONS, c.cushion).note[0].toUpperCase()}${pick(CUSHIONS, c.cushion).note.slice(1)}, magnetically attached: swap them in a second.`,
    at: (r, s) => [-places(r, s).cushion, CUP_Y - 0.1, 0.4],
    normal: [-0.25, 0, 1],
    view: { yaw: -0.85, pitch: 0.12, distance: 5.2 },
  },
  {
    id: 'shell',
    title: () => 'Aluminium ear cups',
    body: () => 'Each cup is turned from one block of aluminium, anodized, then bead-blasted to a soft satin.',
    at: (r, s) => [places(r, s).cup + 0.15, CUP_Y - 0.12, 0.12],
    normal: [1, 0, 0.25],
    view: { yaw: 1.4, pitch: 0.08, distance: 5.3 },
  },
];

/**
 * The scene's props: the theme (the page's; a worker cannot read the Look
 * context), the configuration to start from, the bag, whether the
 * turntable starts on, and the canvas's size (1000 by 640 without one).
 * @typedef {{ theme: import('../../themes.js').Theme, initial?: Partial<Config>, bag?: number, rotate?: boolean, width?: number, height?: number }} Settings
 */

/** The scene once its props are here (a worker receives them after it starts). */
export function Showroom() {
  return <Show when={() => $lookup(Props) != null}>{() => <Stage />}</Show>;
}

function Stage() {
  const R = $active();
  const send = $lookup(Send);
  const settings = /** @type {Settings} */ ($untrack(R, () => $lookup(Props)));
  // The theme follows the props: a new one restyles the scene and the interface in place.
  const theme = () => /** @type {Settings | undefined} */ ($lookup(Props))?.theme ?? look();
  const c = palette(theme);
  // The canvas's size, and on a narrower one a camera further back: on a
  // tablet's so the product and its side panels span the full canvas's share
  // of the width, on a phone's further still with a stacked overlay.
  // Held in a signal the props write: the frame callback (hotspots, layout) reads it
  // where no component's context is (a context is looked up while building).
  const sizeOf = () => {
    const p = /** @type {Settings | undefined} */ ($lookup(Props));
    return [p?.width ?? WIDTH, p?.height ?? HEIGHT].join(' ');
  };
  const dims = $signal(R, $untrack(R, sizeOf));
  $watch(R, sizeOf, text => $write(dims, text));
  const size = () => /** @type {[number, number]} */ ($read(dims).split(' ').map(Number));
  const compact = () => size()[0] < COMPACT;
  /** A tablet's canvas: narrower than the full one, wider than a phone's (the overlay's bar takes two rows). */
  const tablet = $memo(R, () => !compact() && size()[0] < WIDTH);
  const lens = () => (compact() ? LENS : widen(size()[0], size()[1]));
  /** The camera's own orbit: the orbit's, further back on a compact canvas. @param {Orbit} o */
  const lensed = o => ({ ...o, distance: o.distance * lens() });
  const aim = () => (compact() ? LOW : TARGET);
  /** Where a scene point shows on the canvas under the orbit. @param {readonly number[]} point @param {Orbit} o */
  const onCanvas = (point, o) => screen(point, lensed(o), size()[0], size()[1], aim());
  const S = $store(R, {
    config: /** @type {Config} */ ({ ...DEFAULTS, ...settings.initial }),
    view: { exploded: false, rotate: settings.rotate ?? true, spot: /** @type {string | null} */ (null), hover: /** @type {string | null} */ (null) },
    bag: settings.bag ?? 0,
  });
  const config = reader(S);
  const view = (/** @type {string} */ key) => $at(S, ['view', key]);

  // The orbit: the goal moves with the pointer, the turntable and flights;
  // the camera follows it with a damped approach every frame.
  /** @type {Orbit} */
  const goal = { ...HOME };
  const orbit = $signal(R, /** @type {Orbit} */ ({ ...HOME }));
  // The spec card's height as it reports it, which stands it on the floor.
  const specHigh = $signal(R, SPEC_HIGH);
  const spread = $signal(R, 0);
  const pulse = $signal(R, 0);
  const drag = { on: false, x: 0, y: 0, yaw: 0, pitch: 0, moved: false };
  /** @param {Orbit} to */
  const fly = to => Object.assign(goal, { yaw: nearest(goal.yaw, to.yaw), pitch: to.pitch, distance: to.distance });

  /** @type {import('./ui.jsx').Actions} */
  const act = {
    choose: (key, id) => $put(S, ['config', key], id),
    engrave: text => $put(S, ['config', 'engraving'], etched(text)),
    explode: () => $put(S, ['view', 'exploded'], (/** @type {boolean} */ on) => !on),
    rotate: () => $put(S, ['view', 'rotate'], (/** @type {boolean} */ on) => !on),
    reset: () => {
      $put(S, ['view', 'spot'], null);
      fly(HOME);
    },
    zoom: factor => void (goal.distance = clamp(goal.distance * factor, LIMITS.distance[0], LIMITS.distance[1])),
    add: () => $put(S, ['bag'], (/** @type {number} */ n) => n + 1),
    close: () => $put(S, ['view', 'spot'], null),
  };
  /** @param {Spot} spot */
  const open = spot => {
    $put(S, ['view', 'spot'], spot.id);
    fly(spot.view);
  };

  // Every frame: the turntable, the camera's approach, the exploded view, the hotspots' pulse.
  let frames = 0;
  let clock = 0;
  let counted = 0;
  let sent = '';
  let still = false;
  $animate(frame => {
    const dt = frame.delta;
    clock += dt;
    if ($untrack(R, () => view('rotate') && view('spot') === null) && !drag.on) goal.yaw += SPIN * dt;
    const o = $read(orbit);
    const next = { yaw: approach(o.yaw, goal.yaw, dt, 7), pitch: approach(o.pitch, goal.pitch, dt, 7), distance: approach(o.distance, goal.distance, dt, 6) };
    const s = $read(spread);
    const target = $untrack(R, () => view('exploded')) ? 1 : 0;
    const spreading = Math.abs(s - target) > 1e-3 ? approach(s, target, dt, 4.5) : target;
    const turning = Math.abs(next.yaw - o.yaw) + Math.abs(next.pitch - o.pitch) + Math.abs(next.distance - o.distance) > 1e-5;
    $batch(R, () => {
      if (turning) $write(orbit, next);
      if (spreading !== s) $write(spread, spreading);
      $write(pulse, (Math.sin(clock * 3) + 1) / 2);
    });
    frames++;
    // The frame rate, every 30 frames; the hotspots' places on the canvas as they change; whether the view holds still.
    if (frames % 30 === 0) {
      send({ frames, fps: Math.round(30 / Math.max(1e-3, clock - counted)) });
      counted = clock;
    }
    const spots = $untrack(R, where);
    const text = JSON.stringify(spots);
    if (text !== sent) {
      sent = text;
      send({ spots });
    }
    const now = !turning && spreading === s;
    if (now !== still) send({ still: (still = now) });
  });

  const radius = () => pick(SIZES, config('size')).radius;
  /** A hotspot shows while its surface faces the camera: behind its part, it hides (and takes no clicks). @param {Spot} spot */
  const shown = spot => {
    const p = spot.at(radius(), $read(spread));
    const eye = basis(lensed($read(orbit)), aim()).eye;
    const d = [eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]];
    const n = spot.normal;
    return (d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) / (Math.hypot(...d) * Math.hypot(...n)) > 0.2;
  };
  /** Where each hotspot and the engraving field show on the canvas now, in whole pixels. */
  const where = () => {
    const o = $read(orbit);
    /** @type {Record<string, number[] | null>} */
    const out = {};
    const round = (/** @type {number[] | null} */ p) => (p === null ? null : p.map(Math.round));
    for (const spot of SPOTS) out[spot.id] = shown(spot) ? round(onCanvas(spot.at(radius(), $read(spread)), o)) : null;
    out.engrave = compact() ? null : round(onCanvas(placed([0, 0, 0], o.yaw, placed(ENGRAVE_AT.at, ENGRAVE_AT.turn, FIELD)), o));
    return out;
  };

  // Where the overlay's parts and the side panels show (full and tablet
  // canvases), as [x, y, width, height]: tools check that none overlaps
  // another or leaves the canvas. The panels' boxes enclose their corners.
  const head = $signal(R, /** @type {number[]} */ ([0, 0]));
  const onHead = (/** @type {any} */ e) => $write(head, [e.width, e.height]);
  /** A panel's box on the canvas: at `at` (in the yaw's frame), turned by `turn`, `w` × `h` pixels. @param {number[]} at @param {number} turn @param {number} w @param {number} h */
  const panelBox = (at, turn, w, h) => {
    const o = $read(orbit);
    const centre = placed([0, 0, 0], o.yaw, at);
    const points = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = onCanvas(placed(centre, o.yaw + turn, [(sx * w * 0.01) / 2, (sy * h * 0.01) / 2, 0]), o);
      if (p === null) return null;
      points.push(p);
    }
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    return box.map(Math.round);
  };
  const layout = () => {
    if (compact()) return null;
    const [w, h] = size();
    const { bar, corner } = regions(w, h);
    const [hw, hh] = $read(head);
    return {
      canvas: [0, 0, w, h],
      head: [EDGE, EDGE, Math.round(hw), Math.round(hh)],
      corner,
      bar,
      spec: panelBox([SPEC_AT.at[0], standing($read(specHigh)), SPEC_AT.at[2]], SPEC_AT.turn, 230, $read(specHigh)),
      engrave: panelBox(ENGRAVE_AT.at, ENGRAVE_AT.turn, ENGRAVE.width, ENGRAVE.height),
    };
  };
  $watch(R, () => JSON.stringify(layout()), text => send({ layout: JSON.parse(text) }));

  // The page hears of every change of the configuration, the bag and the open hotspot.
  $watch(R, () => $at(S, ['config']), value => send({ config: value, price: price(value) }));
  $watch(R, () => $at(S, ['bag']), n => send({ bag: n }));
  $watch(R, () => view('spot'), id => send({ open: id ?? '' }));
  $watch(R, () => view('hover'), id => send({ hover: id ?? '' }));

  const hint = () => {
    const id = view('hover');
    const spot = SPOTS.find(s => s.id === id);
    return spot === undefined ? 'Drag to turn · wheel or − + to zoom · press a dot to learn more' : `Press to open: ${spot.title($at(S, ['config']))}`;
  };
  const shared = { S, act, c };
  /** The open hotspot, or null. */
  const opened = () => SPOTS.find(s => s.id === view('spot')) ?? null;

  return (
    <>
      {/* The camera rig: yaw, then pitch, then the camera at the distance, looking at the target. */}
      <group name="rig" position={aim} rotation-y={() => $read(orbit).yaw}>
        <group rotation-x={() => -$read(orbit).pitch}>
          <perspectiveCamera main params={[FOV, $untrack(R, size)[0] / $untrack(R, size)[1], 0.1, 200]} position={() => [0, 0, $read(orbit).distance * lens()]} />
        </group>
      </group>
      {/* A soft studio: sky and ground fill, a warm key casting the shadow, a cool fill and a rim. */}
      <color slot="background" params={() => [c.canvas]} />
      <hemisphereLight color={LIGHTS.fill} groundColor={() => c.canvas} intensity={0.55} />
      <ambientLight color={LIGHTS.rim} intensity={0.15} />
      <directionalLight
        name="key"
        color={LIGHTS.key}
        position={[3.2, 5.5, 4]}
        intensity={2.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-radius={5}
        shadow-bias={-0.0004}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
      />
      <directionalLight name="fill" color={LIGHTS.fill} position={[-4.5, 2, 2.5]} intensity={0.9} />
      <directionalLight name="rim" color={LIGHTS.rim} position={[0.5, 3, -5]} intensity={1.4} />
      <group
        name="stage"
        cursor="grab"
        onPointerDown={(/** @type {any} */ e) => {
          if (typeof e.button === 'number' && e.button > 0) return;
          Object.assign(drag, { on: true, x: e.x, y: e.y, yaw: goal.yaw, pitch: goal.pitch, moved: false });
        }}
        onPointerMove={(/** @type {any} */ e) => {
          if (!drag.on) return;
          const dx = e.x - drag.x;
          const dy = e.y - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
          goal.yaw = drag.yaw - dx * DRAG;
          goal.pitch = clamp(drag.pitch + dy * DRAG, LIMITS.pitch[0], LIMITS.pitch[1]);
        }}
        onPointerUp={() => void (drag.on = false)}
        onPointerCancel={() => void (drag.on = false)}
        onClick={() => {
          // A click that was not a drag, on nothing that took it: the open card closes.
          if (!drag.moved && view('spot') !== null) act.close();
        }}
        onWheel={(/** @type {any} */ e) => {
          goal.distance = clamp(goal.distance * Math.exp(e.deltaY * 0.0015), LIMITS.distance[0], LIMITS.distance[1]);
        }}
      >
        {/* The backdrop: a sphere around everything that writes no pixel, so a drag anywhere orbits (an object not visible takes no pointer). */}
        <mesh name="backdrop">
          <sphereGeometry params={[60, 16, 12]} />
          <meshBasicMaterial side={BACK_SIDE} colorWrite={false} depthWrite={false} />
        </mesh>
        <mesh name="floor" rotation-x={-Math.PI / 2} position={[0, FLOOR, 0]} receiveShadow>
          <circleGeometry params={[9, 64]} />
          <meshStandardMaterial color={() => c.canvas} roughness={0.9} metalness={0} />
        </mesh>
        <mesh name="plinth" position={[0, -1.16, 0]} receiveShadow castShadow>
          <cylinderGeometry params={[1.95, 2.05, 0.06, 96]} />
          <meshPhysicalMaterial color={() => c.raised} roughness={0.22} metalness={0} clearcoat={0.6} clearcoatRoughness={0.15} />
        </mesh>
        <Headphones config={config} spread={() => $read(spread)} />
        {SPOTS.map(s => {
          const hovered = () => view('hover') === s.id;
          return (
            <group name={`spot ${s.id}`} position={() => s.at(radius(), $read(spread))}>
              <Show when={() => shown(s)}>
                {() => (
                  <>
                    <mesh
                      name={`dot ${s.id}`}
                      scale={() => (hovered() || view('spot') === s.id ? 1.6 : 1)}
                      onPointerOver={() => $put(S, ['view', 'hover'], s.id)}
                      onPointerOut={() => $put(S, ['view', 'hover'], null)}
                      onClick={(/** @type {any} */ e) => {
                        e.stopPropagation();
                        if (!drag.moved) open(s);
                      }}
                    >
                      <sphereGeometry params={[0.055, 24, 16]} />
                      <meshBasicMaterial color={() => c.accent} toneMapped={false} />
                    </mesh>
                    <mesh name={`halo ${s.id}`} rotation={() => facing($read(orbit))} scale={() => 1 + $read(pulse) * 0.5}>
                      <ringGeometry params={[0.075, 0.095, 40]} />
                      <meshBasicMaterial color={() => c.accent} transparent opacity={() => 0.85 - $read(pulse) * 0.6} toneMapped={false} depthWrite={false} />
                    </mesh>
                  </>
                )}
              </Show>
            </group>
          );
        })}
        {/* The detail card: a panel at the open hotspot, turned to the camera, beside the dot on the side with room. */}
        <Show when={opened}>
          {() => (
            <group name="detail" position={() => /** @type {Spot} */ (opened() ?? SPOTS[0]).at(radius(), $read(spread))} rotation={() => facing($read(orbit))}>
              <group
                position={() => {
                  // Above the dot on a narrow canvas; beside it, on the side with room, on a wide one.
                  if (compact()) return [0, 1.1, 0.3];
                  const spot = /** @type {Spot} */ (opened() ?? SPOTS[0]);
                  const p = onCanvas(spot.at(radius(), $read(spread)), $read(orbit));
                  return [p !== null && p[0] > size()[0] * 0.55 ? -1.4 : 1.4, 0.55, 0.3];
                }}
              >
                <DetailCard {...shared} title={() => (opened() ?? SPOTS[0]).title($at(S, ['config']))} body={() => (opened() ?? SPOTS[0]).body($at(S, ['config']))} />
              </group>
            </group>
          )}
        </Show>
        {/* The side panels stand beside the product: a compact canvas has no room for them. */}
        <Show when={() => !compact()}>
          <group name="spec" position={() => placed([0, 0, 0], $read(orbit).yaw, [SPEC_AT.at[0], standing($read(specHigh)), SPEC_AT.at[2]])} rotation-y={() => $read(orbit).yaw + SPEC_AT.turn}>
            <SpecCard {...shared} onResize={(/** @type {any} */ e) => e.height > 0 && $write(specHigh, e.height)} />
          </group>
          <group name="engrave" position={() => placed([0, 0, 0], $read(orbit).yaw, ENGRAVE_AT.at)} rotation-y={() => $read(orbit).yaw + ENGRAVE_AT.turn}>
            <EngraveCard {...shared} />
          </group>
        </Show>
      </group>
      {() =>
        $read(tablet) ? <Overlay {...shared} hint={hint} size={size} onHead={onHead} /> : (
          <Show when={compact} fallback={<Overlay {...shared} hint={hint} size={size} onHead={onHead} />}>
            <Compact {...shared} size={size} />
          </Show>
        )
      }
    </>
  );
}
