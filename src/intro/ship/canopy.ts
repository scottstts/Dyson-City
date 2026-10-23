/**
 * The cockpit's glass (docs/intro-ship.md, "Canopy"), composited analytically in post like the
 * Dome's (city/dome/glass.ts): a transparent mesh would overwrite the scene pass's velocity under
 * blending, and the world seen through a moving ship's windshield would smear under TAA.
 *
 * Per pixel, each pane the view ray crosses before the opaque scene: smoked glass (a little
 * neutral absorption) with two coated faces' Fresnel reflection. Seen from inside, the reflection
 * is of the cabin; from outside, of the sky.
 */
import { Fn, If, abs, dot, float, normalize, pmremTexture, pow, reflect, select, uniform, vec3, vec4 } from 'three/tsl';
import type { Node, Texture } from 'three/webgpu';
import type { TransparencyComposite } from '../../render/pipeline';
import { WINDOWS, openingHit } from './glazing';
import { cabinState } from './cabinLight';
import { shipInSpace } from './env';

type V3 = Node<'vec3'>;

/** Reflectance of each coated face at normal incidence, and the glass's neutral transmission. */
export const GLASS = { f0: 0.015, transmission: 0.86 } as const;
export interface Canopy {
  readonly composite: TransparencyComposite;
  /** 1 while the ship is in the scene. */
  readonly enabled: { value: number };
}

export function createCanopy(band: Texture, space: Texture): Canopy {
  const enabled = uniform(0);
  const S = cabinState;
  const composite: TransparencyComposite = (origin, dir, dist, color) => {
    return Fn(() => {
      const out = color.toVar();
      If(enabled.greaterThan(0.5), () => {
        const o = (S.toShip as unknown as Node<'mat4'>).mul(vec4(origin, 1)).xyz as unknown as V3;
        const rotT = (S.rotation as unknown as Node<'mat3'>).transpose();
        const d = normalize(rotT.mul(dir)) as unknown as V3;
        for (const w of WINDOWS) {
          const t = openingHit(w, o, d);
          If(t.greaterThan(0.0).and(t.lessThan(dist)), () => {
            const nShip = vec3(...w.n);
            const outward = dot(nShip, d).greaterThan(0.0);
            const cosT = abs(dot(nShip, d));
            const f1 = float(GLASS.f0).add(float(1 - GLASS.f0).mul(pow(float(1).sub(cosT), 5)));
            const R = f1.mul(2).min(1.0);
            // Off it: the cabin from inside; the sky (or space) from outside.
            const nWorld = normalize((S.rotation as unknown as Node<'mat3'>).mul(nShip));
            const r = reflect(dir, nWorld);
            const sky = select(shipInSpace.greaterThan(0.5), pmremTexture(space, r, float(0.04)), pmremTexture(band, r, float(0.04))) as unknown as V3;
            const refl = select(outward, S.fill as unknown as V3, sky);
            out.assign(out.mul(float(1).sub(R)).mul(GLASS.transmission).add(refl.mul(R)));
          });
        }
      });
      return out;
    })() as unknown as V3;
  };
  return { composite, enabled: enabled as unknown as { value: number } };
}

