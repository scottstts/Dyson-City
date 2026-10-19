/**
 * The Stand's materials, by slot (docs/terminal.md). The drum, cheeks and the terminal's body are
 * the Dome's honed ceramic with glazed black and satin bronze fittings (city/materials/ceramic.ts),
 * so the Stand reads as the gate's and the frame's own hand. What is its own:
 *
 *  - the deck: dark polished basalt laid in rings round the centre (slabs ~1.2 m along each ring,
 *    joints staggered ring to ring), a honed border course at the rim, bronze inlays: the parking
 *    circle, a rosette at the centre, and the drive line out to the ramp. Polished like the roads, so
 *    it mirrors the sky and the gold; each slab's lippage breaks the mirror;
 *  - the ramp: the same basalt, honed and grooved across its fall for grip;
 *  - the stair's treads: honed basalt (their risers are ceramic, their nosings bronze);
 *  - the speaker grille: bronze perforated on a hexagonal pitch.
 *
 * The terminal's screen and lamp are in screenMaterial.ts.
 */
import { MeshPhysicalNodeMaterial, type Material, type Node } from 'three/webgpu';
import { float, vec2, vec3, positionWorld, normalWorldGeometry, normalViewGeometry, fwidth, length, max, min, abs, fract, floor, atan, select, smoothstep, mix, normalize, transformNormalToView, PI, round, uv } from 'three/tsl';
import { createBlackGlazeMaterial, createBronzeMaterial, createCeramicMaterial } from '../city/materials/ceramic';
import { STEEL } from '../field/materials/materials';
import { hash33, fbm3, valueNoise3 } from '../render/tsl/noise';
import { band, lodFade } from '../render/tsl/patterns';
import { RAMP, STAND } from './layout';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

export const STAND_SLOT = {
  ceramic: 0,
  black: 1,
  bronze: 2,
  steel: 3,
  deck: 4,
  ramp: 5,
  tread: 6,
  grille: 7,
  /** The hood's inside and the bezel: in the hood's shade (most of the sky hidden). */
  hood: 8,
  bezel: 9,
} as const;
export const STAND_SLOTS = 10;

/** Share of the sky the hood's inside, the bezel and the screen see past the hood. */
export const HOOD_VIEW = 0.3;

const BASALT = vec3(0.045, 0.043, 0.041);
const BASALT_HONED = vec3(0.07, 0.066, 0.062);
const BRONZE = vec3(0.86, 0.69, 0.47);

/** Ring width of the deck's paving and the slabs' length along each ring (m). */
export const DECK_RING = 0.9;
export const DECK_SLAB = 1.2;
/** The bronze inlays: the rim's border course inner edge, the parking circle, the rosette. */
export const DECK_INLAY = { border: STAND.R - 0.55, park: 4.6, parkInner: 4.42, rosette: [0.62, 0.46] as const } as const;

export interface StandLook {
  /** Environment for every material (the Stand's probe, parallax-corrected). */
  env?: Node;
  /** The star-shade's ambient-occlusion term. */
  shade?: () => F;
  /** The vehicles' shade (vehicles/shade.ts): on what they stand on, the deck, the ramp, the treads. */
  vehicleShade?: () => F;
}

/**
 * The deck: polar paving about the Stand's centre. Ring k spans [k, k + 1)·DECK_RING; its slabs
 * are 2πr/n long with n chosen per ring, and each ring starts at its own phase so no joint runs
 * radially across two rings.
 */
function createDeckMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const p = positionWorld.xz.sub(vec2(STAND.cx, STAND.cz)).toVar();
  const r = length(p).toVar();
  const a = atan(p.y, p.x).toVar();
  const fp = max(length(fwidth(positionWorld.xz)), 1e-5).toVar() as unknown as F;
  const ring = floor(r.div(DECK_RING));
  const rMid = ring.add(0.5).mul(DECK_RING);
  const n = max(round(rMid.mul(2 * Math.PI).div(DECK_SLAB)), 6);
  const phase = fract(ring.mul(0.618));
  const u = a.div(2 * Math.PI).add(0.5).mul(n).add(phase);
  const slabId = floor(u);
  const along = fract(u).toVar();
  const arc = rMid.mul(2 * Math.PI).div(n);
  const dAlong = min(along, float(1).sub(along)).mul(arc);
  const radial = fract(r.div(DECK_RING)).mul(DECK_RING);
  const dRadial = min(radial, float(DECK_RING).sub(radial));
  const inBorder = smoothstep(DECK_INLAY.border - 0.01, DECK_INLAY.border + 0.01, r);
  // The border course: honed slabs 0.6 m along the rim, one course wide.
  const bu = a.div(2 * Math.PI).add(0.5).mul(Math.round((2 * Math.PI * (STAND.R - 0.27)) / 0.6));
  const bAlong = fract(bu);
  const dBorder = min(bAlong, float(1).sub(bAlong)).mul((2 * Math.PI * (STAND.R - 0.27)) / Math.round((2 * Math.PI * (STAND.R - 0.27)) / 0.6));
  const centre = smoothstep(DECK_RING - 0.01, DECK_RING + 0.01, r);
  const dist = select(inBorder.greaterThan(0.5), min(dBorder, abs(r.sub(DECK_INLAY.border))), select(centre.greaterThan(0.5), min(dAlong, dRadial), float(1)));
  const id = select(inBorder.greaterThan(0.5), vec3(floor(bu), 99, 3), vec3(slabId, ring, 1));
  const h = mix(vec3(0.5), hash33(id), lodFade(fp, 0.5)).toVar();
  const joint = band(dist, 0.002, fp).toVar();
  const grain = valueNoise3(vec3(positionWorld.xz.mul(90), 2)).sub(0.5).mul(lodFade(fp, 0.008));
  const cloud = fbm3(vec3(positionWorld.xz.mul(0.6), 4), 3, fp.mul(0.6)).sub(0.5);
  const polished = BASALT.mul(float(0.88).add(h.x.mul(0.24)).add(cloud.mul(0.12)).add(grain.mul(0.1)));
  const honed = BASALT_HONED.mul(float(0.9).add(h.y.mul(0.2)).add(grain.mul(0.12)));
  let color: V3 = mix(polished, honed, inBorder).mul(float(1).sub(joint.mul(0.5)));
  // Inlays: the border's inner line, the parking circle (two rings), the rosette, the drive line.
  const lines = max(
    max(band(r.sub(DECK_INLAY.border), 0.016, fp), max(band(r.sub(DECK_INLAY.park), 0.03, fp), band(r.sub(DECK_INLAY.parkInner), 0.008, fp))),
    max(band(r.sub(DECK_INLAY.rosette[0]), 0.022, fp), band(r.sub(DECK_INLAY.rosette[1]), 0.008, fp)),
  );
  // Eight rays of the rosette and a datum disc.
  const sector = abs(fract(a.div(PI.div(4)).add(0.5)).sub(0.5)).mul(PI.div(4)).mul(r);
  const rays = band(sector, 0.01, fp).mul(smoothstep(0.1, 0.16, r)).mul(smoothstep(DECK_INLAY.rosette[0], DECK_INLAY.rosette[0] - 0.04, r));
  const datum = smoothstep(0.075, 0.065, r);
  // The drive line: from the parking circle out along the ramp's axis to the rim.
  const rampDir = vec2(Math.cos(RAMP.angle), Math.sin(RAMP.angle));
  const along2 = p.x.mul(rampDir.x).add(p.y.mul(rampDir.y));
  const across2 = p.x.mul(rampDir.y.negate()).add(p.y.mul(rampDir.x));
  const drive = band(across2, 0.02, fp).mul(smoothstep(DECK_INLAY.park - 0.02, DECK_INLAY.park + 0.02, along2)).mul(smoothstep(DECK_INLAY.border + 0.02, DECK_INLAY.border - 0.02, along2));
  const inlay = max(max(lines, rays), max(datum, drive)).mul(smoothstep(0.6, 0.8, normalWorldGeometry.y)).min(1).toVar();
  color = mix(color, BRONZE.mul(float(0.92).add(h.z.mul(0.08))), inlay);
  mat.colorNode = color;
  mat.metalnessNode = inlay;
  mat.roughnessNode = mix(mix(float(0.32).add(h.y.mul(0.08)), float(0.62), inBorder).add(joint.mul(0.5)), float(0.42), inlay);
  // The polish: a clear coat on the polished field, none in the joints, on the border or on bronze.
  mat.clearcoatNode = float(0.45).sub(h.z.mul(0.2)).mul(float(1).sub(joint)).mul(float(1).sub(inBorder)).mul(float(1).sub(inlay));
  mat.clearcoatRoughnessNode = float(0.12).add(h.x.mul(0.08)).add(grain.abs().mul(0.05));
  // Each slab's lippage (a sub-millimetre tilt) breaks the mirror slab by slab.
  const tilt = vec3(h.x.sub(0.5), 0, h.z.sub(0.5)).mul(0.006).mul(smoothstep(0.6, 0.8, normalWorldGeometry.y));
  const nWorld = normalize(normalWorldGeometry.add(tilt));
  mat.normalNode = select(normalWorldGeometry.y.greaterThan(0.6), transformNormalToView(nWorld), normalViewGeometry);
  mat.clearcoatNormalNode = mat.normalNode;
  return mat;
}

/**
 * Honed basalt for the ramp and the treads, in slabs along an axis, optionally grooved across it
 * (the ramp: 8 mm grooves at 80 mm, a grip a tyre and a sole can feel).
 */
function createBasaltMaterial(name: string, axis: number, grooves: boolean): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const p = positionWorld.xz.sub(vec2(STAND.cx, STAND.cz));
  const d = vec2(Math.cos(axis), Math.sin(axis));
  const along = p.x.mul(d.x).add(p.y.mul(d.y));
  const across = p.x.mul(d.y.negate()).add(p.y.mul(d.x));
  const fp = max(length(fwidth(positionWorld.xz)), 1e-5) as unknown as F;
  const sx = 0.9;
  const sy = 1.6;
  const row = floor(along.div(sx));
  const shifted = across.add(fract(row.mul(0.5)).mul(sy));
  const lx = fract(shifted.div(sy)).mul(sy);
  const ly = fract(along.div(sx)).mul(sx);
  const dist = min(min(lx, float(sy).sub(lx)), min(ly, float(sx).sub(ly)));
  const h = mix(vec3(0.5), hash33(vec3(floor(shifted.div(sy)), row, 13)), lodFade(fp, 0.5));
  const joint = band(dist, 0.002, fp);
  const grain = valueNoise3(vec3(positionWorld.xz.mul(90), 5)).sub(0.5).mul(lodFade(fp, 0.008));
  let color: V3 = BASALT_HONED.mul(float(0.88).add(h.x.mul(0.24)).add(grain.mul(0.12))).mul(float(1).sub(joint.mul(0.5)));
  let rough: F = float(0.6).add(h.y.mul(0.1)).add(joint.mul(0.3));
  const top = smoothstep(0.6, 0.8, normalWorldGeometry.y);
  if (grooves) {
    const g = abs(fract(along.div(0.08)).sub(0.5)).mul(0.08);
    const groove = band(g, 0.004, fp).mul(top);
    color = color.mul(float(1).sub(groove.mul(0.55)));
    rough = rough.add(groove.mul(0.25));
    // The groove's walls: a normal ramp across each one, faded with footprint.
    const slope = select(fract(along.div(0.08)).lessThan(0.5), float(-1), float(1)).mul(groove).mul(lodFade(fp, 0.02)).mul(0.5);
    const n = normalize(normalWorldGeometry.add(vec3(d.x, 0, d.y).mul(slope)));
    mat.normalNode = select(normalWorldGeometry.y.greaterThan(0.6), transformNormalToView(n), normalViewGeometry);
  }
  mat.colorNode = color;
  mat.roughnessNode = rough;
  mat.metalnessNode = float(0);
  return mat;
}

/** Perforated bronze: 3 mm holes on a 6 mm hexagonal pitch (uv in metres), dark behind. */
function createGrilleMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const st = uv().mul(1 / 0.006) as unknown as V2;
  const fp = max(length(fwidth(st)), 1e-5) as unknown as F;
  const row = floor(st.y.div(0.866));
  const q = vec2(st.x.add(fract(row.mul(0.5))), st.y.div(0.866));
  const c = fract(q).sub(0.5);
  const d = length(vec2(c.x, c.y.mul(0.866)));
  const hole = float(1).sub(smoothstep(float(0.25).sub(fp), float(0.25).add(fp), d)).mul(lodFade(fp, 0.8));
  const mean = 0.23;
  const open = mix(float(mean), hole, lodFade(fp, 0.5));
  mat.colorNode = mix(BRONZE.mul(0.95), vec3(0.01), open);
  mat.metalnessNode = float(1).sub(open);
  mat.roughnessNode = mix(float(0.32), float(0.9), open);
  return mat;
}

/**
 * The hood's inside: a matte black (a light trap round the screen, as a lens hood's flocking is),
 * not the glazed black outside: a glaze there would mirror the sky onto the glass.
 */
function createHoodMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  mat.colorNode = vec3(0.018, 0.017, 0.016);
  mat.roughnessNode = float(0.7);
  mat.metalnessNode = float(0);
  mat.specularIntensityNode = float(0.4);
  return mat;
}

/** Graphite steel (the rail's infill rods, the keys' stems). */
function createSteel(name: string): MeshPhysicalNodeMaterial {
  return createBronzeMaterial(name, STEEL.f0, 0.24);
}

/** One material per slot. */
export function createStandMaterials(look: StandLook = {}): Material[] {
  const mats: MeshPhysicalNodeMaterial[] = [];
  mats[STAND_SLOT.ceramic] = createCeramicMaterial('Stand.ceramic');
  mats[STAND_SLOT.black] = createBlackGlazeMaterial('Stand.black');
  mats[STAND_SLOT.bronze] = createBronzeMaterial('Stand.bronze');
  mats[STAND_SLOT.steel] = createSteel('Stand.steel');
  mats[STAND_SLOT.deck] = createDeckMaterial('Stand.deck');
  mats[STAND_SLOT.ramp] = createBasaltMaterial('Stand.ramp', RAMP.angle, true);
  mats[STAND_SLOT.tread] = createBasaltMaterial('Stand.tread', 0, false);
  mats[STAND_SLOT.grille] = createGrilleMaterial('Stand.grille');
  mats[STAND_SLOT.hood] = createHoodMaterial('Stand.hood');
  mats[STAND_SLOT.bezel] = createBronzeMaterial('Stand.bezel');
  for (const m of mats) {
    if (look.env) m.envNode = look.env;
    if (look.shade) m.aoNode = look.shade();
  }
  for (const slot of [STAND_SLOT.hood, STAND_SLOT.bezel]) {
    const m = mats[slot];
    m.aoNode = look.shade ? look.shade().mul(HOOD_VIEW) : float(HOOD_VIEW);
  }
  if (look.vehicleShade) {
    for (const slot of [STAND_SLOT.deck, STAND_SLOT.ramp, STAND_SLOT.tread]) {
      const m = mats[slot];
      const v = look.vehicleShade();
      m.aoNode = look.shade ? look.shade().mul(v) : v;
      // Under a body the view up is the body: the polish's reflection of the zenith goes too.
      if (m.clearcoatNode) m.clearcoatNode = (m.clearcoatNode as F).mul(v);
    }
  }
  return mats;
}
