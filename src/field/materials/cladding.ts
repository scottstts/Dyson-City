/**
 * The secondary plant's cladding (docs/field.md, "Secondary plant"): rainscreen panels in each
 * zone's own colour, so every precinct reads as one works with its own palette (city_plan.md §5.1;
 * never one white city).
 *
 * Geometry UVs are metres (u along a sweep, v round its section), so the panels are real size:
 * 1.5 m wide, 3 m tall, on 10 mm open reveals. Each panel has its own slight tone and sheen (a
 * batch of fired ceramic). The colour is a uniform: every zone's material compiles to one program.
 * All detail fades to the mean by pixel footprint.
 */
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { float, vec3, uv, fwidth, length, max, floor, fract, abs, mix, positionWorld, uniform } from 'three/tsl';
import { Color } from 'three/webgpu';
import { hash33, fbm3, valueNoise3 } from '../../render/tsl/noise';
import { band, lodFade } from '../../render/tsl/patterns';
import type { Zone } from '../layout';

/** Each zone's cladding (linear albedo): one warm cast, each precinct its own colour. */
export const ZONE_CLADDING: Record<Zone, [number, number, number]> = {
  craft: [0.15, 0.15, 0.155],
  instruments: [0.66, 0.64, 0.6],
  power: [0.5, 0.33, 0.2],
  cryo: [0.34, 0.39, 0.43],
  science: [0.62, 0.56, 0.45],
  works: [0.2, 0.165, 0.14],
  heat: [0.44, 0.21, 0.14],
};

const PANEL = { w: 1.5, h: 3.0 } as const;

export function createCladdingMaterial(name: string, albedo: [number, number, number]): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const colour = uniform(new Color(...albedo));
  const st = uv();
  const fp = max(length(fwidth(st)), 1e-5);
  const pu = st.x.div(PANEL.w);
  const pv = st.y.div(PANEL.h);
  const du = abs(fract(pu).sub(0.5)).negate().add(0.5).mul(PANEL.w);
  const dv = abs(fract(pv).sub(0.5)).negate().add(0.5).mul(PANEL.h);
  const reveal = max(band(du, 0.005, fp), band(dv, 0.005, fp));
  const h = mix(vec3(0.5), hash33(vec3(floor(pu), floor(pv), 13)), lodFade(fp, 0.4));
  const wp = positionWorld;
  const cloud = fbm3(wp.mul(0.25), 3, fp.mul(0.25)).sub(0.5);
  const grain = valueNoise3(wp.mul(70)).sub(0.5).mul(lodFade(fp, 0.01));
  const tone = float(0.96).add(h.x.sub(0.5).mul(0.07)).add(cloud.mul(0.05)).add(grain.mul(0.03));
  mat.colorNode = colour.mul(tone).mul(float(1).sub(reveal.mul(0.6)));
  mat.roughnessNode = float(0.46).add(h.y.sub(0.5).mul(0.1)).add(grain.mul(0.05)).add(reveal.mul(0.4));
  mat.metalnessNode = float(0);
  return mat;
}
