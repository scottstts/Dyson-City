/**
 * Where the field's machines make their sound (audio/sounds/field.ts plays them; docs/audio.md):
 * each source is a point on the machine that makes it, with its size (spreading begins beyond it)
 * and how hard it is working now. The field knows nothing of how they sound.
 */
import type { Vec3 } from '../geometry/polyMesh';
import { CONVERTER, COLD_HOLD, FIELD_Y, GYRE, LOOM, PAVILIONS, RECKONER, STILLS } from './layout';
import { CARRIAGE, carriageX } from './heroes/loom';
import { YOKE } from './heroes/gyre';
import { DISHES, MAST_SPIRE } from './heroes/mast';
import { coreRadius } from './kit/spire';
import { plantLots } from './plant/lots';

export type FieldSoundKind = 'hum' | 'cryo' | 'pump' | 'furnace' | 'crane' | 'slew';

export interface FieldSoundSource {
  name: string;
  kind: FieldSoundKind;
  /** Source size (m). */
  size: number;
  /** Position at game time t. */
  at(t: number, out: Vec3): Vec3;
  /** Working level at t (0..1): how hard it runs now. */
  level(t: number): number;
}

const fixed = (name: string, kind: FieldSoundKind, p: Vec3, size: number, level = 1): FieldSoundSource => ({
  name,
  kind,
  size,
  at: (_t, out) => ((out[0] = p[0]), (out[1] = p[1]), (out[2] = p[2]), out),
  level: () => level,
});

/** Points round a podium's rim (its plant rooms), at a few metres up. */
function rim(c: { x: number; z: number; podiumR: number }, n: number, phase: number): Vec3[] {
  return Array.from({ length: n }, (_, k) => {
    const a = phase + (2 * Math.PI * k) / n;
    return [c.x + Math.cos(a) * (c.podiumR - 4), FIELD_Y + 3, c.z + Math.sin(a) * (c.podiumR - 4)] as Vec3;
  });
}

export function fieldSoundSources(): FieldSoundSource[] {
  const out: FieldSoundSource[] = [];
  // The Converter's transformers hum; the Reckoner's chillers and power hum lower.
  rim(CONVERTER, 3, 0.4).forEach((p, k) => out.push(fixed(`converter${k}`, 'hum', p, 8)));
  rim(RECKONER, 2, 1.1).forEach((p, k) => out.push(fixed(`reckoner${k}`, 'hum', p, 6, 0.6)));
  // The cryogen plant: the Stills' columns, and the Cold Hold's boil-off compressors.
  rim(STILLS, 3, 0.9).forEach((p, k) => out.push(fixed(`stills${k}`, 'cryo', p, 10)));
  for (const [k, d] of [-28, 26].entries()) out.push(fixed(`hold${k}`, 'cryo', [COLD_HOLD.x + d, FIELD_Y + 2, COLD_HOLD.z + d * 0.4], 8, 0.7));
  // A pump set in every valve pavilion.
  PAVILIONS.forEach((p, k) => out.push(fixed(`pump:${k}`, 'pump', [p.x, FIELD_Y + 1.6, p.z], 3)));
  // The secondary plant: compressor houses run (a cryogen compressor each), switchyards' transformers hum.
  for (const l of plantLots()) {
    if (l.kind === 'drum') out.push(fixed(`plant:`, 'cryo', [l.x, FIELD_Y + 3, l.z], 6, 0.5));
    if (l.kind === 'switchyard') out.push(fixed(`plant:`, 'hum', [l.x, FIELD_Y + 2.5, l.z], 5, 0.55));
  }
  // The Loom: the draw head roars at the slit; the carriage's drives whine on its bogies.
  const zc = (LOOM.zA + LOOM.zB) / 2;
  out.push({ name: 'loom:furnace', kind: 'furnace', size: 5, at: (t, o) => ((o[0] = carriageX(t) + CARRIAGE.len / 2), (o[1] = FIELD_Y + CARRIAGE.slitY), (o[2] = zc), o), level: () => 1 });
  out.push({ name: 'loom:crane', kind: 'crane', size: 6, at: (t, o) => ((o[0] = carriageX(t)), (o[1] = FIELD_Y + LOOM.railTop + 1), (o[2] = zc), o), level: () => 0.8 });
  // The Gyre's torque motors (a steady slow turn) and the Mast's dish heads (as fast as they slew).
  for (const s of [-1, 1]) out.push(fixed(`gyre:motor${s}`, 'slew', [GYRE.x, FIELD_Y + GYRE.centreY, GYRE.z + s * (YOKE.towerOut + 1.6)], 3, 0.35));
  const ring = MAST_SPIRE.rings[1];
  DISHES.forEach((d, k) => {
    const rr = coreRadius(MAST_SPIRE, ring.h) + (ring.R - ring.hr - coreRadius(MAST_SPIRE, ring.h)) * 0.55;
    const p: Vec3 = [MAST_SPIRE.x + Math.cos(d.a) * rr, FIELD_Y + ring.h + 2, MAST_SPIRE.z + Math.sin(d.a) * rr];
    out.push({
      name: `mast:dish${k}`,
      kind: 'slew',
      size: 2,
      at: (_t, o) => ((o[0] = p[0]), (o[1] = p[1]), (o[2] = p[2]), o),
      // The dish's slew rate (mast.ts: scan · sin(2πt/period + k)), normalised.
      level: (t) => Math.abs(Math.cos((2 * Math.PI * t) / d.period + k)),
    });
  });
  return out;
}
