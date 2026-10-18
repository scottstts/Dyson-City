/**
 * The vehicles' shade on the pad (docs/vehicles.md, "Light"). The star-shade (lighting/starShade.ts)
 * is baked once for what stands still; a moving car or a hovering craft darkens the ground under it
 * by the light it hides there: the star's 45° cap (its share of the light, STAR_SHARE) and the rest
 * of the sky (the remainder).
 *
 *  - The cap: seen from a ground point, a horizontal box of half-sizes (a, b) at height h covers, on
 *    the plane one unit above the point, the rectangle [(−a − u)/h, (a − u)/h] × [(−b − v)/h, (b − v)/h]
 *    ((u, v): the point in the box's frame). The cap is the disc of radius tan 45° = 1 there; its
 *    share covered is taken separably, against the square of the disc's area (side √π), which keeps
 *    the penumbra's width (∝ h) and the full shade under a wide body.
 *  - The sky: the box's exact view factor from the point (a parallel rectangle: the corner formula,
 *    by superposition). Under a car the body hides nearly the whole sky too, so its shade is deep,
 *    as a car's at noon is; under the hovering craft, high over the pad, it is a soft pool.
 *
 * Several boxes combine as independent occluders (1 − Π(1 − fᵢ)). Pixels far from every vehicle
 * skip the box (an early out), so the pad pays little for it.
 */
import { Vector4 } from 'three/webgpu';
import { Fn, If, Loop, atan, float, int, max, min, positionWorld, sqrt, uniformArray, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;

/** Boxes in the shade: the car's body, and the craft's fuselage, wings and halo. */
export const SHADE_BOXES = 4;
/** The star's share of the light on up-facing ground (lighting/starShade.ts's share at n·y = 1). */
export const STAR_SHARE = 0.82;
const HALF_SIDE = Math.sqrt(Math.PI) / 2;

export interface ShadeBox {
  x: number;
  z: number;
  /** Heading of the box's b axis (yaw: the axis along (sin ψ, cos ψ)). */
  yaw: number;
  /** Half-sizes across (a) and along (b) the heading. */
  a: number;
  b: number;
  /** Height of the occluding body over the ground (its effective underside). */
  h: number;
  /** 0 (none) … 1 (opaque). */
  opacity: number;
}

/** View factor from a point to the rectangle [0, X] × [0, Y] above it at unit height (signed: odd in X and Y). */
function corner(X: number, Y: number): number {
  const sx = Math.sqrt(1 + X * X);
  const sy = Math.sqrt(1 + Y * Y);
  return ((X / sx) * Math.atan(Y / sx) + (Y / sy) * Math.atan(X / sy)) / (2 * Math.PI);
}

/** Share of the light a box hides from a point on the ground (CPU twin of the shader, for tests). */
export function boxShade(box: ShadeBox, px: number, pz: number): number {
  if (box.opacity <= 0 || box.h <= 0) return 0;
  const dx = px - box.x;
  const dz = pz - box.z;
  const s = Math.sin(box.yaw);
  const c = Math.cos(box.yaw);
  const v = dx * s + dz * c;
  const u = dx * c - dz * s;
  const h = box.h;
  const X0 = (-box.a - u) / h, X1 = (box.a - u) / h, Y0 = (-box.b - v) / h, Y1 = (box.b - v) / h;
  const cover = (lo: number, hi: number) => Math.max(0, Math.min(hi, HALF_SIDE) - Math.max(lo, -HALF_SIDE)) / (2 * HALF_SIDE);
  const cap = cover(X0, X1) * cover(Y0, Y1);
  const sky = corner(X1, Y1) - corner(X0, Y1) - corner(X1, Y0) + corner(X0, Y0);
  return box.opacity * (STAR_SHARE * cap + (1 - STAR_SHARE) * sky);
}

export interface VehicleShade {
  /** Per frame: the boxes (missing ones are cleared). */
  set(boxes: readonly ShadeBox[]): void;
  /** A factor on the ground's light: 1 in the open, less under a vehicle. */
  node(): F;
}

export function createVehicleShade(): VehicleShade {
  // Per box: (x, z, sin ψ, cos ψ) and (a, b, h, opacity).
  const pose = uniformArray(Array.from({ length: SHADE_BOXES }, () => new Vector4()), 'vec4');
  const size = uniformArray(Array.from({ length: SHADE_BOXES }, () => new Vector4(1, 1, 1, 0)), 'vec4');
  const P = pose.array as Vector4[];
  const S = size.array as Vector4[];
  const at = (arr: unknown, i: Node<'int'>) => (arr as { element(i: Node<'int'>): Node<'vec4'> }).element(i);
  const cover = (lo: F, hi: F) => max(float(0), min(hi, HALF_SIDE).sub(max(lo, -HALF_SIDE))).div(2 * HALF_SIDE);
  const cornerNode = (X: F, Y: F) => {
    const sx = sqrt(X.mul(X).add(1));
    const sy = sqrt(Y.mul(Y).add(1));
    return X.div(sx).mul(atan(Y.div(sx))).add(Y.div(sy).mul(atan(X.div(sy)))).div(2 * Math.PI);
  };
  const shade = Fn(() => {
    const open = float(1).toVar();
    Loop(SHADE_BOXES, ({ i }: { i: Node<'int'> }) => {
      const p = at(pose, int(i));
      const z = at(size, int(i));
      const d = positionWorld.xz.sub(vec2(p.x, p.y));
      // Beyond ~4 heights past its far corner a box hides under 1 % of the sky.
      const reach = max(z.x, z.y).add(z.z.mul(4));
      If(z.w.greaterThan(0).and(d.dot(d).lessThan(reach.mul(reach))), () => {
        const v = d.x.mul(p.z).add(d.y.mul(p.w));
        const u = d.x.mul(p.w).sub(d.y.mul(p.z));
        const h = max(z.z, 1e-3);
        const X0 = z.x.negate().sub(u).div(h);
        const X1 = z.x.sub(u).div(h);
        const Y0 = z.y.negate().sub(v).div(h);
        const Y1 = z.y.sub(v).div(h);
        const cap = cover(X0, X1).mul(cover(Y0, Y1));
        const sky = cornerNode(X1, Y1).sub(cornerNode(X0, Y1)).sub(cornerNode(X1, Y0)).add(cornerNode(X0, Y0));
        const f = cap.mul(STAR_SHARE).add(sky.mul(1 - STAR_SHARE)).mul(z.w).clamp(0, 1);
        open.mulAssign(float(1).sub(f));
      });
    });
    return open;
  });
  return {
    set(boxes) {
      for (let i = 0; i < SHADE_BOXES; i++) {
        const b = boxes[i];
        if (!b) {
          S[i].w = 0;
          continue;
        }
        P[i].set(b.x, b.z, Math.sin(b.yaw), Math.cos(b.yaw));
        S[i].set(b.a, b.b, b.h, b.opacity);
      }
    },
    node: () => shade() as unknown as F,
  };
}
