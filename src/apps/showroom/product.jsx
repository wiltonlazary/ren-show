// The product: over-ear headphones built from three.js geometry in JSX, no
// loaded model. The ear cups are lathed from a profile, the headband and
// the cushions are tori, the stems and the crown cylinders. Each part reads
// the configuration from the store: the finish crossfades the aluminium and
// the knit (a damped approach per frame, `$animate`), the cushions swap
// their material between knit and leather (a Show over two material
// elements), the steel band replaces the strap, and the size rebuilds the
// band's torus in place (new `params`). The exploded view moves every part
// apart along its own axis.

import { $signal, $read, $write, $at, $batch, $untrack } from 'rrx-core';
import { $active, Show, Label } from 'ren-core';
import { $animate } from 'ren-three';
import { FINISHES, CUSHIONS, BANDS, SIZES, pick } from './materials.js';
import { approach, rgb, hex } from './orbit.js';

/** @typedef {import('./materials.js').Config} Config */
/** @typedef {import('./materials.js').Material} Material */

/** Where the band's ends sit, and the cups' centre height. */
export const BAND_Y = 0.2;
export const CUP_Y = -0.5;
/** Where the stems meet the yokes, over the cups. */
const STEM = CUP_Y + 0.5;
/** How far each part travels in the exploded view (at spread 1). */
export const TRAVEL = { cup: 0.55, cushion: 0.42, band: 0.5, strap: 0.26 };
/** The cups are ovals: taller than wide. */
const OVAL = 1.22;

/** The ear cup's profile, lathed about its axis: the outer face, a soft rim and the opening the cushion covers. */
export const PROFILE = [
  [0, 0.14],
  [0.18, 0.14],
  [0.29, 0.128],
  [0.355, 0.1],
  [0.39, 0.055],
  [0.4, 0],
  [0.398, -0.07],
  [0.385, -0.12],
  [0.35, -0.14],
  [0, -0.14],
].map(([x, y]) => ({ x, y }));

/**
 * The parts' places for a band radius and a spread (0 assembled, 1
 * exploded): each cup's centre, each cushion's, the band's and strap's
 * heights. Hotspots and cards are placed from the same numbers.
 * @param {number} radius @param {number} spread
 */
export function places(radius, spread) {
  const cup = radius + 0.02 + TRAVEL.cup * spread;
  return {
    cup,
    cushion: cup - 0.17 - TRAVEL.cushion * spread,
    band: BAND_Y + TRAVEL.band * spread,
    strap: BAND_Y + TRAVEL.strap * spread,
  };
}

/**
 * A value that follows `goal` with a damped approach each frame: the
 * crossfades and flights. Numbers in, numbers out, so it crosses to a worker.
 * @param {import('rrx-core').Graph} R @param {() => number[]} goal @param {number} rate per second
 * @returns {import('rrx-core').Writable<number[]>}
 */
export function follow(R, goal, rate) {
  const value = $signal(R, $untrack(R, goal));
  $animate(frame => {
    const g = goal();
    const v = $read(value);
    let moved = false;
    const next = v.map((x, i) => {
      const n = approach(x, g[i], frame.delta, rate);
      if (Math.abs(n - g[i]) > 1e-3) {
        moved = true;
        return n;
      }
      return g[i];
    });
    if (moved || next.some((n, i) => n !== v[i])) $batch(R, () => $write(value, next));
  });
  return value;
}

/** A material as the numbers `follow` moves: r, g, b, roughness, metalness. @param {Material} m */
const numbers = m => [...rgb(m.color), m.roughness, m.metalness];

/**
 * The headphones. `config` reads the store's configuration; `spread` is
 * the exploded view's progress.
 * @param {{ config: (key: keyof Config) => string, spread: () => number }} props
 */
export function Headphones(props) {
  const R = $active();
  const { config, spread } = props;
  const finish = () => pick(FINISHES, config('finish'));
  const cushion = () => pick(CUSHIONS, config('cushion'));
  const band = () => pick(BANDS, config('band'));
  const radius = () => pick(SIZES, config('size')).radius;
  // The crossfades: the aluminium, the knit and the leather move to the new finish's numbers.
  const shell = follow(R, () => numbers(finish().shell), 5);
  const knit = follow(R, () => numbers(finish().knit), 5);
  const leather = follow(R, () => numbers(cushion().leather ?? finish().knit), 5);
  const color = (/** @type {import('rrx-core').Writable<number[]>} */ m) => () => hex($read(m).slice(0, 3));
  const at = () => places(radius(), spread());
  /** The shell's aluminium, shared look for cups and band. */
  const Aluminium = (/** @type {{ name: string }} */ p) => (
    <meshPhysicalMaterial name={p.name} color={color(shell)} roughness={() => $read(shell)[3]} metalness={() => $read(shell)[4]} clearcoat={0.3} clearcoatRoughness={0.25} />
  );
  const Knit = (/** @type {{ name: string }} */ p) => <meshPhysicalMaterial name={p.name} color={color(knit)} roughness={() => $read(knit)[3]} metalness={0} sheen={1} sheenRoughness={0.7} sheenColor={color(knit)} />;
  /** @param {{ side: 1 | -1 }} p */
  const Cup = p => (
    <group name={p.side > 0 ? 'right cup' : 'left cup'} position={() => [p.side * at().cup, CUP_Y, 0]}>
      <mesh name="shell" rotation-z={(-p.side * Math.PI) / 2} scale={[OVAL, 1, 1]} castShadow receiveShadow>
        <latheGeometry params={[PROFILE, 72]} />
        <Aluminium name="aluminium" />
      </mesh>
      {/* The yoke: a slim arc from the stem around the cup's top. */}
      <mesh name="yoke" rotation-y={Math.PI / 2} scale={[1, 1.14, 1]} castShadow>
        <torusGeometry params={[0.44, 0.022, 12, 48, Math.PI]} />
        <Aluminium name="aluminium" />
      </mesh>
    </group>
  );
  /** @param {{ side: 1 | -1 }} p */
  const Cushion = p => (
    <group name={p.side > 0 ? 'right cushion' : 'left cushion'} position={() => [p.side * at().cushion, CUP_Y, 0]}>
      <mesh name="pad" rotation-y={Math.PI / 2} scale={[1, OVAL, 1]} castShadow>
        <torusGeometry params={[0.285, 0.1, 24, 64]} />
        {/* Knit or leather: a different material, swapped in by the option. */}
        <Show when={() => cushion().leather === null} fallback={() => <meshPhysicalMaterial name="leather" color={color(leather)} roughness={() => $read(leather)[3]} metalness={0} clearcoat={0.18} clearcoatRoughness={0.6} />}>
          {() => <Knit name="knit" />}
        </Show>
      </mesh>
      <mesh name="fabric" rotation-y={(p.side * Math.PI) / 2} scale={[1, OVAL, 1]}>
        <circleGeometry params={[0.3, 48]} />
        <Knit name="knit" />
      </mesh>
    </group>
  );
  return (
    <group name="headphones">
      {/* The band: a half torus whose radius is the size; a new size rebuilds it in place. */}
      <mesh name="band" position={() => [0, at().band, 0]} castShadow>
        <torusGeometry params={() => [radius(), 0.045, 18, 96, Math.PI]} />
        <Show when={() => band().steel === null} fallback={() => <meshPhysicalMaterial name="steel" color={(band().steel ?? BANDS[1].steel)?.color} roughness={0.16} metalness={1} />}>
          {() => <Aluminium name="aluminium" />}
        </Show>
      </mesh>
      <Show when={() => band().steel === null}>
        {() => (
          <mesh name="strap" position={() => [0, at().strap, 0]} rotation-z={Math.PI * 0.16} castShadow>
            <torusGeometry params={() => [radius() - 0.085, 0.07, 18, 72, Math.PI * 0.68]} />
            <Knit name="knit" />
          </mesh>
        )}
      </Show>
      {[1, -1].map(side => (
        <mesh name="stem" position={() => [side * radius(), (at().band + STEM) / 2, 0]} scale={() => [1, (at().band - STEM) / (BAND_Y - STEM), 1]} castShadow>
          <cylinderGeometry params={[0.024, 0.024, BAND_Y - STEM, 20]} />
          <meshPhysicalMaterial name="steel" color={BANDS[1].steel?.color} roughness={0.2} metalness={1} />
        </mesh>
      ))}
      <Cup side={1} />
      <Cup side={-1} />
      <Cushion side={1} />
      <Cushion side={-1} />
      {/* The crown on the right cup, and the engraving on the left: a Label in a panel on the shell, etched in the finish's tone. */}
      <mesh name="crown" position={() => [at().cup + 0.06, CUP_Y + 0.43, 0.15]} castShadow>
        <cylinderGeometry params={[0.05, 0.05, 0.07, 32]} />
        <Aluminium name="aluminium" />
      </mesh>
      <group name="engraving" position={() => [-at().cup - 0.145, CUP_Y - 0.02, 0]} rotation-y={-Math.PI / 2}>
        <Show when={() => config('engraving') !== ''}>
          {() => <Label text={() => config('engraving')} style={() => ({ width: 64, fontSize: 9, lineHeight: 1.2, textAlign: 'center', color: finish().etch, select: 'none' })} />}
        </Show>
      </group>
    </group>
  );
}

/** Reads one key of the store's configuration. @param {import('rrx-core').Box<any>} S @returns {(key: keyof Config) => string} */
export const reader = S => key => $at(S, ['config', key]);
