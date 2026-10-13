/**
 * Bare Girdle deck: the inner skin of the Dyson sphere where it is habitable.
 *
 * Material: dark glass-ceramic plates (albedo ≈ 0.07) with a polished, glazed top — a dielectric
 * clear coat that mirrors the sky — over recessed seams and fastener rows. Each plate lies with its
 * own few-milliradian set error, so the sky's reflection (the shell's mosaic, the receivers, the
 * horizon haze, the star near one's feet) breaks plate by plate, sharp nearby and smoothing into a
 * glossy sheen toward the horizon.
 *
 * Hierarchy (metres): 6 × 3 m plates in running bond along E–W → 96 m bays bounded by 0.6 m
 * expansion gratings → 768 m sectors bounded by 2.4 m service trenches on both axes. All detail
 * fades by pixel footprint; at grazing distance the deck converges to its mean BRDF, matching the
 * sky shader's distant deck (DECK_MEAN_ALBEDO).
 */
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { float, vec2, vec3, positionWorld, normalWorldGeometry, fwidth, length, max, min, abs, floor, fract, select, smoothstep, mix, normalize, transformNormalToView } from 'three/tsl';
import { hash33, valueNoise3, fbm3 } from '../render/tsl/noise';
import { band, runningBond, gridDistance, lodFade } from '../render/tsl/patterns';

const PLATE = vec3(0.07, 0.068, 0.066);
const DUST = vec3(0.34, 0.31, 0.27);
const PLATE_SIZE = vec2(6, 3);

export function createDeckMaterial(): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = 'Girdle.deck';
  const p = positionWorld.xz.toVar();
  const fp = max(length(fwidth(p)), 1e-5).toVar();

  // Sector trenches (every 768 m) and bay expansion gratings (every 96 m).
  const trench = band(gridDistance(p, 768), 1.2, fp).toVar();
  const strip = band(gridDistance(p, 96), 0.3, fp).mul(float(1).sub(trench)).toVar();
  const grating = band(abs(fract(p.x.add(p.y).mul(14)).sub(0.5)), 0.2, fp.mul(14)).mul(lodFade(fp, 0.06));

  // Plates and their sealed seams: a 10 mm recess with a dark elastomer bead.
  const plate = runningBond(p, PLATE_SIZE);
  const h = mix(vec3(0.5), hash33(vec3(plate.id, 4)), lodFade(fp, 2.0)).toVar();
  const bay = hash33(vec3(floor(p.div(96)), 8)).x;
  const seam = band(plate.dist, 0.005, fp).toVar();
  const lx = plate.local.x;
  const ly = plate.local.y;
  // Fasteners on the seam strips every 0.3 m.
  const alongSeam = select(min(lx, float(6).sub(lx)).lessThan(min(ly, float(3).sub(ly))), ly, lx);
  const boltD = length(vec2(abs(fract(alongSeam.div(0.3)).sub(0.5)).mul(0.3), plate.dist.sub(0.045)));
  const bolt = smoothstep(0.009, 0.005, boltD).mul(lodFade(fp, 0.008));

  // Plate surface: satin cermet with faint trowel-like swirl from manufacture, per-plate tone.
  const swirl = valueNoise3(vec3(p.mul(2.2), h.x.mul(13))).sub(0.5).mul(lodFade(fp, 0.12));
  const micro = valueNoise3(vec3(p.mul(55), h.y.mul(7))).sub(0.5).mul(lodFade(fp, 0.01));
  const tone = float(0.9).add(h.x.mul(0.2)).add(bay.sub(0.5).mul(0.1)).add(swirl.mul(0.06)).add(micro.mul(0.08));

  // Dust: a light film that settles in broad drifts and against the seam strips.
  const drifts = fbm3(vec3(p.mul(1 / 40), 2), 4, fp.mul(1 / 40));
  const dustAmount = smoothstep(0.45, 0.8, drifts.add(h.z.mul(0.15))).mul(0.55).add(float(1).sub(smoothstep(0.004, 0.03, plate.dist)).mul(0.12).mul(lodFade(fp, 0.02))).clamp(0, 0.8).toVar();

  const plateColor = mix(PLATE.mul(tone), DUST, dustAmount.mul(0.55));
  const seamColor = vec3(0.025, 0.025, 0.026);
  const gratingColor = vec3(0.07, 0.07, 0.072).mul(float(1).sub(grating.mul(0.6)));
  let color = mix(plateColor, seamColor, seam);
  color = mix(color, vec3(0.5, 0.49, 0.47), bolt);
  color = mix(color, gratingColor, strip);
  color = mix(color, gratingColor.mul(0.6), trench);
  mat.colorNode = color;

  // Fastener heads are bare titanium; gratings are galvanised steel.
  const metal = bolt.mul(0.9).add(strip.mul(0.6)).add(trench.mul(0.4)).clamp(0, 1);
  mat.metalnessNode = metal.mul(float(1).sub(dustAmount.mul(0.5)));
  mat.roughnessNode = mix(float(0.46).add(h.y.mul(0.12)).add(micro.mul(0.06)), float(0.85), seam)
    .add(dustAmount.mul(0.3))
    .add(strip.mul(0.15))
    .add(trench.mul(0.25))
    .clamp(0.12, 1);
  mat.specularIntensityNode = float(1).sub(dustAmount.mul(0.4));
  // Glazed top: a polished clear coat on the plates (worn under dust; none in seams or on metal).
  mat.clearcoatNode = float(1).sub(dustAmount.mul(0.8)).mul(float(1).sub(seam)).mul(float(1).sub(metal));
  mat.clearcoatRoughnessNode = float(0.035).add(h.x.mul(0.04)).add(dustAmount.mul(0.25)).add(micro.abs().mul(0.03));

  // Normal: seam strip crown, bolt domes, faint plate waviness (large plates are never flat).
  const towardEdge = select(
    min(lx, float(6).sub(lx)).lessThan(min(ly, float(3).sub(ly))),
    vec2(select(lx.lessThan(3), float(-1), float(1)), 0),
    vec2(0, select(ly.lessThan(1.5), float(-1), float(1))),
  );
  const crown = band(plate.dist.sub(0.008), 0.004, fp).mul(lodFade(fp, 0.01)).mul(0.3);
  const wave = vec2(valueNoise3(vec3(p.mul(0.35), h.x.mul(3))), valueNoise3(vec3(p.mul(0.35).add(9), h.y.mul(3)))).sub(0.5).mul(0.004);
  // Plate set error (a few milliradians), fading to the mean once plates are sub-pixel.
  const setError = h.xy.sub(0.5).mul(0.006).mul(lodFade(fp, 1.5));
  const tilt = towardEdge.mul(crown).add(wave).add(setError).add(towardEdge.mul(bolt).mul(-0.4));
  const nWorld = normalize(normalWorldGeometry.add(vec3(tilt.x, 0, tilt.y)));
  mat.normalNode = transformNormalToView(nWorld);
  mat.clearcoatNormalNode = mat.normalNode;
  return mat;
}
