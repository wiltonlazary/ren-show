// The three.js demo's application: a scene of three.js elements that knows
// nothing of where it runs. The three.js demo renders it in a nested root on
// this thread, or serves it from a worker (three-worker.jsx); either way
// three.js and the scene objects stay on the main thread, with the renderer.
// It animates through signals (`$animate` writes the angle), reads its settings
// (and its colors) from the root's props and reports picks and frames as
// messages.

import { $signal, $read, $write, $lookup, $watch } from 'rrx-core';
import { $active, For, Props, Send, read, View, Label, Action } from 'ren-core';
import { $animate } from 'ren-three';
import { THEMES } from './themes.js';

/** The scene's colors when its props name none: the first theme's series. */
export const COLORS = THEMES[0].colors.series;

/** The colors the props name, or the defaults. @returns {string[]} */
const colors = () => $lookup(Props)?.colors ?? COLORS;
/** The panel's background: the theme's surface the props name, a little translucent. */
const surface = () => `${$lookup(Props)?.surface ?? THEMES[0].colors.surface}e6`;

/** The scene: a spinning knot and a row of cubes to hover (a cube lifts and glows) and click. */
export function Scene() {
  const R = $active();
  const send = $lookup(Send);
  /** The latest props, for the frame callback (which runs outside the view). */
  const settings = { spin: true, speed: 1, count: 0 };
  $watch(R, () => $lookup(Props), props => void Object.assign(settings, props));
  const hovered = $signal(R, -1);
  const angle = $signal(R, 0);
  let frames = 0;
  $animate(frame => {
    if (settings.spin) $write(angle, $read(angle) + frame.delta * settings.speed);
    // Every 30 frames, tell the parent how many ran.
    if (++frames % 30 === 0) send({ frames });
  });
  const cubes = () => Array.from({ length: $lookup(Props)?.count ?? 0 }, (_, i) => i);
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 5]} intensity={1.8} />
      <mesh name="knot" position={[0, 0.45, 0]} rotation-x={() => $read(angle) * 0.6} rotation-y={angle} onClick={() => send({ picked: 'knot' })}>
        <torusKnotGeometry params={[0.75, 0.24, 160, 20]} />
        <meshStandardMaterial color={() => colors()[0]} roughness={0.35} metalness={0.25} />
      </mesh>
      {/* A panel of primitives in the scene: a plane in this group, facing the camera, pressed through the raycast. */}
      <group position={[2.1, 0.55, 0]} rotation-y={-0.35}>
        <View style={{ width: 200, padding: 12, gap: 8, radius: 12, background: surface(), border: 1, borderColor: '#80808040' }}>
          <Label text="A panel in the scene" style={{ fontWeight: 'bold', fontSize: 15 }} />
          <Label text={() => `${$lookup(Props)?.count ?? 0} cubes`} style={{ fontSize: 14 }} />
          <Action text="Pick the panel" style={{ radius: 8 }} onPress={() => send({ picked: 'panel' })} />
        </View>
      </group>
      <group position={[0, -1.45, 0]}>
        <For each={cubes}>
          {i => (
            <mesh
              name={() => `cube ${read(i)}`}
              position-x={() => (read(i) - (($lookup(Props)?.count ?? 1) - 1) / 2) * 0.85}
              position-y={() => ($read(hovered) === read(i) ? 0.18 : 0)}
              onPointerOver={() => $write(hovered, read(i))}
              onPointerOut={() => $write(hovered, -1)}
              onClick={() => send({ picked: `cube ${read(i)}` })}
            >
              <boxGeometry params={[0.55, 0.55, 0.55]} />
              <meshStandardMaterial
                color={() => colors()[(read(i) % 5) + 1]}
                emissive={() => ($read(hovered) === read(i) ? colors()[(read(i) % 5) + 1] : '#000000')}
                emissiveIntensity={0.45}
                roughness={0.5}
              />
            </mesh>
          )}
        </For>
      </group>
    </>
  );
}
