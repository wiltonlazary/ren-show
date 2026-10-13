// Showroom's camera and motion, as plain math: the orbit (yaw, pitch and
// distance about a target), where a point of the scene shows on the canvas
// under it, the rotation that faces a card to the camera, and the damped
// approach every animation uses. The scene builds its camera rig from the
// same numbers (a yaw group, a pitch group, the camera at the distance), so
// this module and three.js agree; the test checks that they do.

/**
 * The orbit: `yaw` about the vertical axis, `pitch` above the horizon, both
 * in radians, and the camera's `distance` from the target.
 * @typedef {{ yaw: number, pitch: number, distance: number }} Orbit
 */

/** The point the camera turns about (the product sits above it, clear of the configurator bar). */
export const TARGET = /** @type {const} */ ([0, -0.42, 0]);
/** The camera's vertical field of view, in degrees. */
export const FOV = 38;
/** The orbit a visit starts from, and "Reset view" returns to. @type {Orbit} */
export const HOME = { yaw: 0.55, pitch: 0.18, distance: 7.4 };
/** The limits a drag and the wheel keep to. */
export const LIMITS = { pitch: [-0.08, 1.15], distance: [4.2, 11] };
/** Radians of turn per pixel of drag. */
export const DRAG = 0.008;
/** How fast auto-rotate turns, in radians a second. */
export const SPIN = 0.22;

/** @param {number} v @param {number} lo @param {number} hi */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** An orbit within the limits. @param {Orbit} o @returns {Orbit} */
export const bound = o => ({ yaw: o.yaw, pitch: clamp(o.pitch, LIMITS.pitch[0], LIMITS.pitch[1]), distance: clamp(o.distance, LIMITS.distance[0], LIMITS.distance[1]) });

/** `to`, moved by whole turns to lie within half a turn of `from`, so a flight takes the short way. @param {number} from @param {number} to */
export const nearest = (from, to) => to + Math.round((from - to) / (2 * Math.PI)) * 2 * Math.PI;

/**
 * One step of a damped approach from `value` to `goal`: frame-rate
 * independent (the same path at 30 or 120 frames a second), a fraction
 * `1 - e^(-rate·delta)` of the way each frame.
 * @param {number} value @param {number} goal @param {number} delta seconds @param {number} rate per second
 */
export const approach = (value, goal, delta, rate) => value + (goal - value) * (1 - Math.exp(-rate * delta));

/** The camera's axes and position for an orbit about `target`: right, up, back (unit vectors) and the eye. @param {Orbit} o @param {readonly number[]} [target] */
export function basis(o, target = TARGET) {
  const cy = Math.cos(o.yaw);
  const sy = Math.sin(o.yaw);
  const cp = Math.cos(o.pitch);
  const sp = Math.sin(o.pitch);
  const right = [cy, 0, -sy];
  const up = [-sp * sy, cp, -sp * cy];
  const back = [cp * sy, sp, cp * cy];
  const eye = [target[0] + back[0] * o.distance, target[1] + back[1] * o.distance, target[2] + back[2] * o.distance];
  return { right, up, back, eye };
}

/**
 * Where a scene point shows on a canvas of `width` × `height` CSS pixels,
 * seen from the orbit's camera (about `target`); null behind the camera.
 * @param {readonly number[]} point @param {Orbit} o @param {number} width @param {number} height @param {readonly number[]} [target]
 * @returns {[number, number] | null}
 */
export function screen(point, o, width, height, target = TARGET) {
  const { right, up, back, eye } = basis(o, target);
  const v = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const x = v[0] * right[0] + v[1] * right[1] + v[2] * right[2];
  const y = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
  const z = v[0] * back[0] + v[1] * back[1] + v[2] * back[2];
  if (z >= 0) return null;
  const f = Math.tan((FOV * Math.PI) / 360);
  const nx = x / (-z * f * (width / height));
  const ny = y / (-z * f);
  return [((nx + 1) / 2) * width, ((1 - ny) / 2) * height];
}

/**
 * A point in an object placed at `origin` and turned by `turn` radians
 * about the vertical, from the object's own coordinates.
 * @param {readonly number[]} origin @param {number} turn @param {readonly number[]} local
 */
export const placed = (origin, turn, local) => [origin[0] + local[0] * Math.cos(turn) + local[2] * Math.sin(turn), origin[1] + local[1], origin[2] - local[0] * Math.sin(turn) + local[2] * Math.cos(turn)];

/** The Euler angles (x, y, z, order) that face a card to the orbit's camera. @param {Orbit} o */
export const facing = o => /** @type {[number, number, number, string]} */ ([-o.pitch, o.yaw, 0, 'YXZ']);

/** `#rrggbb` as [r, g, b], 0..255. @param {string} hex */
export const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** [r, g, b] as `#rrggbb`. @param {readonly number[]} c */
export const hex = c => `#${c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
