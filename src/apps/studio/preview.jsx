// Studio's 3D preview: the same document, extruded into three.js meshes
// (ren-three), in a root of its own fed by props. Frames are thin plates,
// rectangles slabs, ellipses discs, arrows a shaft and a cone, and text is
// a panel of portable primitives (a Label ren-canv lays out and draws into
// a texture). The model sways slowly with $animate; each shape's mesh
// reads its own store path, so an edit moves one mesh.

import { $signal, $read, $write, $at, $raw, $memo, $mirror } from 'rrx-core';
import { $active, $lookup, For, Props, Label } from 'ren-core';
import { $animate } from 'ren-three';
import { THEMES, Look, look } from '../../themes.js';
import { paint, extent } from './document.js';

/** @typedef {import('./document.js').Shape} Shape */
/** @typedef {import('./document.js').Doc} Doc */

/** World units per document pixel (a panel's pixel is 0.01 too, so text matches). */
const UNIT = 0.01;
/** How thick each kind stands. @type {Record<string, number>} */
const DEPTH = { frame: 0.04, rect: 0.14, ellipse: 0.18, text: 0, arrow: 0.05 };

/** @typedef {{ doc: Doc, orbit: boolean, theme: import('../../themes.js').Theme | null }} Model */

/** The scene before its props arrive. @type {Model} */
const NONE = { doc: { order: [], shapes: {} }, orbit: false, theme: null };

/**
 * The preview scene. Props: `{ doc, orbit, theme }`, the shown shapes,
 * whether the model sways, and the theme its colors come from (a new one
 * recolors the model in place, as the renderer's `setTheme` restyles its panels).
 */
export function Preview() {
  const R = $active();
  const S = /** @type {import('rrx-core').Box<Model>} */ ($mirror(R, () => $lookup(Props) ?? NONE));
  const theme = $memo(R, () => /** @type {import('../../themes.js').Theme | null} */ ($at(S, ['theme'])) ?? THEMES[0]);
  return (
    <Look value={theme}>
      <Model S={S} />
    </Look>
  );
}

/** The lights, the background and the model. @param {{ S: import('rrx-core').Box<Model> }} props */
function Model(props) {
  const { S } = props;
  const R = $active();
  const c = () => look().colors;
  const sway = $signal(R, 0);
  let time = 0;
  $animate(frame => {
    if (!$raw(S).orbit) return;
    time += frame.delta;
    $write(sway, Math.sin(time * 0.45) * 0.55);
  });
  // The model turns about the design's centre.
  const centre = $memo(R, () => {
    const box = extent(/** @type {Doc} */ ($at(S, ['doc'])));
    return box === null ? { x: 0, y: 0 } : { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  });
  /** @param {string} id */
  const shape = id => /** @type {Shape} */ ($at(S, ['doc', 'shapes', id]));
  /** Each shape stands a little above the ones below it. @param {string} id */
  const layer = id => /** @type {string[]} */ ($at(S, ['doc', 'order'])).indexOf(id) * 0.025;
  /** A document point in the model. @param {number} x @param {number} y */
  const at = (x, y) => {
    const o = $read(centre);
    return [(x - o.x) * UNIT, -(y - o.y) * UNIT];
  };
  return (
    <>
      <ambientLight intensity={0.75} />
      {/* The background is the theme's canvas: a Color attached to the scene, made again when it changes. */}
      <For each={() => [/** @type {import('../../themes.js').Theme | null} */ ($at(S, ['theme']))?.colors.canvas ?? c().canvas]}>{hex => <color slot="background" params={[hex()]} />}</For>
      <hemisphereLight color={() => c().surface} groundColor={() => c().canvas} intensity={0.6} />
      <directionalLight position={[3, 5, 6]} intensity={1.7} />
      <group rotation-x={-0.62} rotation-y={sway}>
        <For each={() => $at(S, ['doc', 'order'])}>
          {id => <Prism id={id()} shape={shape} layer={layer} at={at} />}
        </For>
      </group>
    </>
  );
}

/**
 * One shape as meshes.
 * @param {{ id: string, shape: (id: string) => Shape, layer: (id: string) => number, at: (x: number, y: number) => number[] }} props
 */
function Prism(props) {
  const { id, shape, layer, at } = props;
  const c = () => look().colors;
  // A removed shape's meshes may read once more before its row goes: they keep the last shape.
  let last = shape(id);
  const get = () => (last = shape(id) ?? last);
  const kind = last.kind;
  const color = (/** @type {'fill' | 'stroke'} */ which) => () => paint(c(), get()[which]) ?? c().soft;
  const depth = DEPTH[kind];
  /** The centre of the shape's box, raised by its layer. */
  const middle = () => {
    const s = get();
    const [x, y] = at(s.x + s.w / 2, s.y + s.h / 2);
    return [x, y, layer(id) + depth / 2];
  };
  const turn = () => (-get().rotation * Math.PI) / 180;
  if (kind === 'text')
    return (
      <group name={`text ${id}`} position={() => [...middle().slice(0, 2), layer(id) + 0.02]}>
        <Label text={() => get().text} style={() => ({ width: get().w, fontSize: get().size, lineHeight: 1.3, color: paint(c(), get().fill) ?? c().ink })} />
      </group>
    );
  if (kind === 'arrow') {
    const length = () => Math.hypot(get().w, get().h) * UNIT;
    return (
      <group
        name={`arrow ${id}`}
        position={() => {
          const s = get();
          return [...at(s.x, s.y), layer(id) + 0.04];
        }}
        rotation-z={() => Math.atan2(-get().h, get().w)}
      >
        <mesh position-x={() => length() / 2 - 0.06} scale={() => [Math.max(0.01, length() - 0.12), Math.max(0.02, get().line * UNIT * 1.5), 0.03]}>
          <boxGeometry params={[1, 1, 1]} />
          <meshStandardMaterial color={color('stroke')} roughness={0.5} />
        </mesh>
        <mesh position-x={() => length() - 0.09} rotation-z={-Math.PI / 2}>
          <coneGeometry params={[0.07, 0.18, 20]} />
          <meshStandardMaterial color={color('stroke')} roughness={0.5} />
        </mesh>
      </group>
    );
  }
  if (kind === 'ellipse')
    return (
      <group name={`ellipse ${id}`} position={middle} rotation-z={turn}>
        <mesh rotation-x={Math.PI / 2} scale={() => [get().w * UNIT, depth, get().h * UNIT]}>
          <cylinderGeometry params={[0.5, 0.5, 1, 48]} />
          <meshStandardMaterial color={color('fill')} roughness={0.45} metalness={0.05} />
        </mesh>
      </group>
    );
  return (
    <mesh name={`${kind} ${id}`} position={middle} rotation-z={turn} scale={() => [get().w * UNIT, get().h * UNIT, depth]}>
      <boxGeometry params={[1, 1, 1]} />
      <meshStandardMaterial color={color('fill')} roughness={kind === 'frame' ? 0.9 : 0.5} />
    </mesh>
  );
}
