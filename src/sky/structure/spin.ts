/**
 * The band spins; the frame does not.
 *
 * The habitable band (the Girdle, its edge rails, the city) is a ring turning about the spin axis
 * inside a static frame: spines, hub collars, gore panels, collars, braces — and the stars beyond,
 * which keep the frame's (inertial) orientation. The band runs through the hub collars and the
 * frame's struts bear on its rails, so nothing of the frame crosses it (layout.ts).
 *
 * The observer rides the band, so the sky shader works in band coordinates and rotates rays into
 * frame coordinates to trace the frame and look up space. A frame feature at longitude λ_f is seen
 * at band longitude λ_f − θ: frame and stars drift east → west, sinking toward the eastern horizon
 * and rising out of the western one.
 *
 * The rate is a game choice (one turn every two hours: a star crosses about a pixel per second at
 * a 60° field), not the 1 g spin rate, which would move the sky too slowly to notice. The star's
 * surface keeps its physical drift (world/constants.ts).
 */
import { Vector2 } from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

type V3 = Node<'vec3'>;

/** One turn of the band relative to the frame and the stars (s). */
export const BAND_SPIN_PERIOD = 7200;
export const BAND_SPIN_RATE = (2 * Math.PI) / BAND_SPIN_PERIOD;

/** Frame angle θ (rad) at game time t (s): zero at spawn, so the first-impression layout holds. */
export function frameAngle(gameTime: number): number {
  return (BAND_SPIN_RATE * gameTime) % (2 * Math.PI);
}

/** (cos θ, sin θ) of the frame angle, shared by every shader that traces the frame or space. */
export const frameSpin = uniform(new Vector2(1, 0));

export function updateFrameSpin(gameTime: number): void {
  const a = frameAngle(gameTime);
  (frameSpin.value as Vector2).set(Math.cos(a), Math.sin(a));
}

/** Rotation about the spin axis (Z) by the angle whose cosine and sine are c, s. */
export function rotateZ(v: V3, c: Node<'float'>, s: Node<'float'>): V3 {
  return vec3(c.mul(v.x).sub(s.mul(v.y)), s.mul(v.x).add(c.mul(v.y)), v.z) as unknown as V3;
}

/** Band → frame coordinates (directions or centre-relative points). */
export function toFrame(v: V3): V3 {
  return rotateZ(v, frameSpin.x as unknown as Node<'float'>, frameSpin.y as unknown as Node<'float'>);
}

/** Frame → band coordinates. */
export function toBand(v: V3): V3 {
  return rotateZ(v, frameSpin.x as unknown as Node<'float'>, (frameSpin.y as unknown as Node<'float'>).negate());
}
