/**
 * Vapour over the Cold Hold's relief stacks (docs/field.md): when a stack lifts (vents.ts), cold
 * gas rushes out and the Dome's humid air condenses round it into a white plume that rises,
 * spreads and thins, and lingers a few seconds after the valve reseats.
 *
 * Composited in post like the gate chamber's mist: no transparent geometry. Up to three plumes at
 * once (the strongest), each a bounded raymarch (12 steps) through a rising, spreading cone of
 * drifting noise along the part of the view ray inside its bounding cylinder. The vapour scatters
 * the star's light: lit like white diffuse matter under the Dome.
 */
import { Vector4 } from 'three/webgpu';
import { Fn, If, float, vec3, max, min, sqrt, exp, smoothstep, time, uniform, uniformArray, clamp, dot } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { fbm3 } from '../render/tsl/noise';
import { loop } from '../render/tsl/helpers';
import type { GlassComposite } from '../city/dome/glass';
import type { ReliefVents } from './vents';

type F = Node<'float'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

const SLOTS = 3;
/** Extinction (1/m) at the plume's dense core, full lift. */
const SIGMA = 1.1;
/** Radiance of the lit vapour (scene units): white matter under the star through the Dome's glass. */
const LIGHT = vec3(1.35, 1.32, 1.27);

export interface VentVapour {
  composite: GlassComposite;
  update(dt: number): void;
}

export function createVentVapour(vents: ReliefVents): VentVapour {
  const plume = new Float32Array(vents.stacks.length);
  const slotData = Array.from({ length: SLOTS }, () => new Vector4(0, -1000, 0, 0));
  const sizeData = Array.from({ length: SLOTS }, () => new Vector4(1, 0, 0, 0));
  const slots = uniformArray(slotData, 'vec4');
  const sizes = uniformArray(sizeData, 'vec4');
  const any = uniform(0);
  const el = (a: unknown, i: Node<'int'>) => (a as { element(i: Node<'int'>): V4 }).element(i);

  const composite: GlassComposite = (origin, dir, dist, color) =>
    Fn(() => {
      const out = vec3(color).toVar();
      If(any.greaterThan(0.002), () => {
        loop('kPlume', SLOTS, (k) => {
          const s = el(slots, k);
          const level = s.w;
          If(level.greaterThan(0.002), () => {
            const size = el(sizes, k).x;
            const H = float(7).add(size.mul(12));
            const Rmax = float(0.8).add(H.mul(0.48));
            // The ray against the plume's bounding cylinder (vertical axis through the tip).
            const o = origin.sub(s.xyz);
            const a = dir.x.mul(dir.x).add(dir.z.mul(dir.z)).max(1e-6);
            const b = o.x.mul(dir.x).add(o.z.mul(dir.z));
            const c = o.x.mul(o.x).add(o.z.mul(o.z)).sub(Rmax.mul(Rmax));
            const disc = b.mul(b).sub(a.mul(c));
            If(disc.greaterThan(0), () => {
              const sq = sqrt(disc);
              let t0: F = b.negate().sub(sq).div(a);
              let t1: F = b.negate().add(sq).div(a);
              // Clip to the plume's height span [0, H] above the tip.
              const ty0 = float(0).sub(o.y).div(dir.y.add(1e-6));
              const ty1 = H.sub(o.y).div(dir.y.add(1e-6));
              t0 = max(t0, min(ty0, ty1));
              t1 = min(t1, max(ty0, ty1));
              t0 = max(t0, 0);
              t1 = min(t1, dist);
              If(t1.greaterThan(t0), () => {
                const dt = t1.sub(t0).div(12);
                const tau = float(0).toVar();
                loop('kMarch', 12, (j) => {
                  const p = o.add(dir.mul(t0.add(dt.mul(float(j).add(0.5)))));
                  const h = clamp(p.y.div(H), 0, 1);
                  // It rises and drifts; the cone widens with height.
                  const rr = float(0.45).add(p.y.max(0).mul(0.42));
                  const drift = vec3(p.y.mul(0.12), 0, p.y.mul(0.05));
                  const q = p.sub(drift);
                  const radial = sqrt(dot(q.xz, q.xz)).div(rr);
                  const core = smoothstep(1.0, 0.2, radial).mul(float(1).sub(h).mul(float(1).sub(h)));
                  const n = fbm3(q.mul(0.55).sub(vec3(0, time.mul(2.4), 0)), 3, float(0.05)).mul(1.6).sub(0.2).max(0);
                  tau.addAssign(core.mul(n).mul(dt));
                });
                const T = exp(tau.mul(SIGMA).mul(level).negate());
                out.assign(out.mul(T).add(LIGHT.mul(float(1).sub(T))));
              });
            });
          });
        });
      });
      return out;
    })() as unknown as V3;

  return {
    composite,
    update(dt) {
      // The plume follows the flow up fast and lingers after it stops.
      for (let i = 0; i < plume.length; i++) {
        const f = vents.flow[i];
        const tau = f > plume[i] ? 0.4 : 2.8;
        plume[i] += (f - plume[i]) * (1 - Math.exp(-dt / tau));
      }
      const order = [...plume.keys()].sort((p, q) => plume[q] - plume[p]).slice(0, SLOTS);
      let total = 0;
      order.forEach((i, k) => {
        const s = vents.stacks[i];
        slotData[k].set(s.p[0], s.p[1], s.p[2], plume[i]);
        sizeData[k].set(s.size, 0, 0, 0);
        total += plume[i];
      });
      any.value = total;
    },
  };
}
