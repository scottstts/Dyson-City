/**
 * Mist in the West Gate's chamber when it vents (airlock.ts): the humid garden air cools as it
 * expands to the band's pressure and condenses. Composited in post like the Dome's glass: the view
 * ray's segment through the chamber volume (in front of the opaque scene) takes a fog of density
 * proportional to the airlock's mist level, broken into slow drifting wisps, lit by the chamber's
 * ambient light (lamps, and daylight through an open gate).
 */
import { float, vec3, max, min, exp, Fn, If, uniform, time } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { fbm3 } from '../../render/tsl/noise';
import { GATE } from './spec';
import type { GlassComposite } from '../dome/glass';

type V3 = Node<'vec3'>;

/** Extinction (1/m) of the densest mist: ~4 m visibility. */
const SIGMA = 0.9;

export interface ChamberMist {
  composite: GlassComposite;
  /** 0..1 from the airlock. */
  readonly level: { value: number };
  /** Scene radiance the mist scatters (the chamber's ambient light), RGB. */
  readonly ambient: { value: { set(r: number, g: number, b: number): unknown } };
}

export function createChamberMist(): ChamberMist {
  const level = uniform(0);
  const ambient = uniform(vec3(0.01, 0.01, 0.01));
  const lo = vec3(GATE.outerLipX, GATE.floor, -GATE.passageHalf);
  const hi = vec3(GATE.innerLipX, GATE.crownY, GATE.passageHalf);
  const composite: GlassComposite = (origin, dir, dist, color) =>
    Fn(() => {
      const out = vec3(color).toVar();
      If(level.greaterThan(0.002), () => {
        // Ray–box slabs.
        const inv = vec3(1).div(dir.add(vec3(1e-6)));
        const t0 = lo.sub(origin).mul(inv);
        const t1 = hi.sub(origin).mul(inv);
        const tmin = min(t0, t1);
        const tmax = max(t0, t1);
        const near = max(max(max(tmin.x, tmin.y), tmin.z), 0);
        const far = min(min(min(tmax.x, tmax.y), tmax.z), dist);
        const len = max(far.sub(near), 0);
        If(len.greaterThan(0), () => {
          const mid = origin.add(dir.mul(near.add(far).mul(0.5)));
          const drift = vec3(time.mul(0.35), time.mul(0.12), time.mul(-0.2));
          const wisps = fbm3(mid.mul(0.18).add(drift), 3, float(0.02)).mul(1.4).add(0.3);
          const tau = len.mul(SIGMA).mul(level).mul(wisps);
          const T = exp(tau.negate());
          out.assign(out.mul(T).add((ambient as unknown as V3).mul(float(1).sub(T))));
        });
      });
      return out;
    })() as unknown as V3;
  return { composite, level: level as unknown as { value: number }, ambient: ambient as unknown as ChamberMist['ambient'] };
}

