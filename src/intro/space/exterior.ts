/**
 * The sphere seen from outside (scene 1; docs/intro-space.md): one trace per pixel, in the sphere's
 * frame (shell radii, centre at the origin; the layout's axes and the frame's coordinates,
 * sky/structure/layout.ts). It holds to the game's own sky: past the outer skin every pixel is the
 * game's shader, met from outside.
 *
 * What a view ray meets:
 *  - the outer skin, where a part covers the shell. Black radiator plating, laid out by the same
 *    collection network as the collectors behind it (districts.ts: basins, districts, channels; no
 *    countable rhythm), its channels and the headers along every part's edge glowing with the heat
 *    they carry out (the logo's gold lines), the fields a faint ember. A distant second star
 *    (Alpha Centauri B, lifted like the starfield so the form reads) gives the faces turned to it a
 *    dim cast;
 *  - through an opening, the game's far structure from that point inward (trace.ts traces from any
 *    origin inside the shell): the opening's own walls, the far side's collectors and frame in
 *    their materials, lit by the enclosure solve (shadeStructure), or space beyond a far gap;
 *  - or the star: the game's photosphere (starSurface.ts), blinding, with its corona and
 *    chromosphere, its loop arcades and its prominences (generalised to any viewpoint: coronaAlong,
 *    magneticPlasmaFrom, activeLayer), and the thin cavity plasma, as from the city.
 *
 * Physics bent for the picture: the outside is not the white-hot radiator the flux would demand;
 * the second star is far brighter than its 4 × 10⁻⁸ of the first's light. The star's erupting gas is
 * a fluid in the city's plane of the sky (gas/): from out here it is not drawn.
 */
import { Fn, If, abs, dot, exp, float, fract, log2, max, min, normalize, select, sqrt, uniform, vec3, screenCoordinate } from 'three/tsl';
import { Matrix3, Vector3 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { footprint, PART } from './footprint';
import { glowNode } from '../../sky/structure/thermal';
import { STAR_RADIUS_R } from '../../world/constants';
import { spaceBackdropRadiance } from '../../sky/space/space';
import { starRadiance } from '../../sky/space/stars';
import { SPACE_TEXEL } from '../../sky/space/bake';
import type { SpaceBackdrop } from '../../sky/space/bake';
import type { AtmosphereNodes } from '../../atmosphere/luts';
import type { StarState } from '../../sky/star/starState';
import { createStarSurface } from '../../sky/star/starSurface';
import { coronaAlong } from '../../sky/star/coronaNodes';
import { magneticPlasmaFrom } from '../../sky/star/magneticNodes';
import { activeLayer } from '../../sky/star/activeLayer';
import { plasmaSegment } from '../../sky/medium/plasmaNodes';
import { MAT, shadeStructure, traceStructure, type ShellLight } from '../../sky/structure/structure';
import { latLon, panelField } from '../../sky/structure/trace';
import { basinCharacter, district, panelCoords, panelSeed } from '../../sky/structure/districts';
import { toBand } from '../../sky/structure/spin';
import { hash33 } from '../../render/tsl/noise';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Coolant temperatures outside (K): the headers along the parts' edges, the network's channels, the fields. */
/**
 * The point stars out here, relative to the game's. The game lifts them far above physical so they
 * read through the band's air at a daylight exposure; out here, with a blazing star in view, an eye
 * squinting at it sees only the brightest few (the rest fall under the black point), while the
 * nebulae keep their lift.
 */
export const OUTSIDE_STARS = 0.1;

/** The sky beyond the sphere: the game's nebulae as they are, its stars dimmed (OUTSIDE_STARS). */
function outerSky(space: SpaceBackdrop, d: V3, px: F): V3 {
  const lod = max(log2(px.div(SPACE_TEXEL)), 0.0);
  return spaceBackdropRadiance(space, d, lod).add(starRadiance(d, px).mul(OUTSIDE_STARS)) as unknown as V3;
}

export const OUTSIDE_HEAT = { header: 3350, channel: 2900, channelRise: 0.12, field: 1880, spread: 0.035 } as const;

/** Look of the outside: albedos, the second star's direction (sphere frame) and irradiance. */
export const EXTERIOR_LOOK = {
  albedo: { panel: 0.045, frame: 0.075 },
  companion: { dir: [-0.55, -0.62, -0.56] as [number, number, number], irradiance: 2.2 },
} as const;

export interface ExteriorView {
  /** World → sphere frame rotation, and the eye's position in the sphere frame (shell units). */
  toSphere: Matrix3;
  eye: Vector3;
}

/**
 * The view for scene 1: the eye `distance` shell radii from the centre, looking from latitude
 * `lat` above the band at the hub at longitude `lon`; the centre appears in world direction
 * `centreDir` from the eye, the sphere's north rolled `roll` from the world's up.
 */
export function exteriorView(opts: { distance: number; lat: number; lon: number; centreDir: [number, number, number]; roll: number }): ExteriorView {
  const { distance, lat, lon, roll } = opts;
  // The eye's direction from the centre (sphere frame): q = (cos φ sin λ, −cos φ cos λ, −sin φ).
  const v = new Vector3(Math.cos(lat) * Math.sin(lon), -Math.cos(lat) * Math.cos(lon), -Math.sin(lat));
  const north = new Vector3(0, 0, -1);
  const a2 = north.clone().sub(v.clone().multiplyScalar(north.dot(v))).normalize();
  const a3 = new Vector3().crossVectors(v, a2);
  // World: from the centre to the eye is −centreDir; up is the world's up, rolled about that axis.
  const b1 = new Vector3(...opts.centreDir).normalize().negate();
  const up = new Vector3(0, 1, 0);
  let b2 = up.sub(b1.clone().multiplyScalar(up.dot(b1))).normalize();
  b2 = b2.applyAxisAngle(b1, roll);
  const b3 = new Vector3().crossVectors(b1, b2);
  // toSphere maps world b_i to sphere a_i: A·Bᵀ.
  const A = new Matrix3().set(v.x, a2.x, a3.x, v.y, a2.y, a3.y, v.z, a2.z, a3.z);
  const B = new Matrix3().set(b1.x, b2.x, b3.x, b1.y, b2.y, b3.y, b1.z, b2.z, b3.z);
  const toSphere = A.multiply(B.transpose());
  return { toSphere, eye: v.multiplyScalar(distance) };
}

/**
 * Share of a pixel `px` wide (rad) covered by a line `w` wide centred `c` in from an edge, at
 * distance e from the edge: the box filter of the line, so a line narrower than a pixel keeps its
 * energy (it dims, it does not thicken: never a constant-width neon stroke).
 */
function line(e: F, c: number, w: number, px: F): F {
  const d = e.sub(c);
  const p = px.max(1e-7);
  return min(float(w / 2), d.add(p.mul(0.5))).sub(max(float(-w / 2), d.sub(p.mul(0.5)))).div(p).clamp(0, 1) as unknown as F;
}

export interface Exterior {
  /** Radiance toward a world direction, for a pixel `pixelAngle` wide (rad). */
  radiance(dirWorld: V3, pixelAngle: F): V3;
  /** Sets the view (scene 1's framing). */
  setView(view: ExteriorView): void;
  /** Per frame: decorrelates the stochastic sampling (TAA integrates it). */
  readonly frame: { value: number };
}

export interface ExteriorDeps {
  star: StarState;
  atmo: AtmosphereNodes;
  space: SpaceBackdrop;
}

export function createExterior(deps: ExteriorDeps): Exterior {
  const { star, atmo, space } = deps;
  const toSphere = uniform(new Matrix3());
  const eye = uniform(new Vector3(0, -2, 0));
  const frame = uniform(0);
  const L = EXTERIOR_LOOK;
  const illuminant = star.illuminant as unknown as V3;
  const companion = normalize(vec3(...L.companion.dir));
  const R = STAR_RADIUS_R;
  const tex = atmo.tex;
  const light: ShellLight = { illuminant, pre: tex.enclosurePre, preMirror: tex.enclosurePreMirror, irr: tex.enclosureIrr, plasma: tex.plasma, star, space };
  const surface = createStarSurface(star);

  /** The outer skin at q (unit, sphere frame) of a part, for a footprint `fp` (arc units). */
  const skin = Fn(([q, part, edge, fp]: [V3, F, F, F]) => {
    const cast = vec3(1.0, 0.86, 0.68).mul(L.companion.irradiance / Math.PI).mul(max(dot(q, companion), 0.0));
    const out = vec3(0).toVar();
    If(part.equal(PART.panel), () => {
      // The collectors' network, seen from behind: its basins' loads, its districts' finishes.
      const pf = panelField(q);
      const ll = latLon(q);
      const c = panelCoords(ll.lon, abs(ll.lat), pf.lon0, pf.lonSpan, panelSeed(pf.cell));
      const dist = district(c, fp, fp);
      const basin = basinCharacter(dist.cell.basin);
      const tone = dist.cell.hash.x.mul(0.45).add(0.75);
      const lit = cast.mul(L.albedo.panel).mul(tone).mul(float(1).sub(dist.channel.mul(0.5)));
      const fieldT = float(OUTSIDE_HEAT.field).mul(float(1).add(basin.heat).add(dist.cell.hash.y.sub(0.5).mul(OUTSIDE_HEAT.spread)));
      const ember = glowNode(fieldT).mul(dist.flowPos.mul(0.6).add(0.7));
      // Channels: hotter by what they collect. Headers round the panel's outline.
      const rise = dist.channelHeat.div(max(dist.channel, 1e-4)).mul(OUTSIDE_HEAT.channelRise / 0.07);
      const channels = glowNode(float(OUTSIDE_HEAT.channel).mul(float(1).add(rise))).mul(dist.channel);
      const header = glowNode(float(OUTSIDE_HEAT.header)).mul(line(pf.dist, 0.0048, 0.0042, fp));
      out.assign(lit.add(ember).add(channels).add(header));
    }).Else(() => {
      // Frame: two headers along each edge.
      const header = max(line(edge, 0.0048, 0.0042, fp), line(edge, 0.0135, 0.0022, fp));
      out.assign(cast.mul(L.albedo.frame).add(glowNode(float(OUTSIDE_HEAT.field * 0.97)).mul(0.35)).add(glowNode(float(OUTSIDE_HEAT.header)).mul(header)));
    });
    return out;
  });

  const radiance = Fn(([dirWorld, px]: [V3, F]) => {
    const d = normalize(toSphere.mul(dirWorld)).toVar();
    const o = eye;
    const out = vec3(0).toVar();
    const b = dot(o, d);
    const c = dot(o, o).sub(1);
    const disc = b.mul(b).sub(c);
    If(disc.lessThan(0.0).or(b.greaterThan(0.0)), () => {
      out.assign(outerSky(space, d, px));
    }).Else(() => {
      const t0 = b.negate().sub(sqrt(disc));
      const q0 = normalize(o.add(d.mul(t0)));
      // The part covering the shell there; panels by the trace's own rounded outline.
      const f0 = footprint(q0).toVar();
      If(f0.x.equal(PART.panel).or(f0.x.equal(PART.open).and(abs(latLon(q0).lat).greaterThan(0.2))), () => {
        const pf = panelField(q0);
        f0.x.assign(select(pf.dist.greaterThan(0.0), float(PART.panel), float(PART.open)));
        f0.y.assign(pf.dist);
      });
      // The pixel's footprint on the shell, wider toward the limb where the view grazes it.
      const fp = px.mul(t0).div(max(abs(dot(q0, d)), 0.15));
      If(f0.x.greaterThan(0.5), () => {
        out.assign(skin(q0, f0.x, f0.y, fp));
      }).Else(() => {
        // Through an opening: the game's sky from just inside the shell, in its band frame.
        const p = o.add(d.mul(t0.add(1e-5)));
        const oBand = toBand(p).add(vec3(0, 1, 0));
        const dBand = toBand(d).toVar();
        const hit = traceStructure(oBand, dBand, px.mul(t0), true);
        const ocBand = oBand.sub(vec3(0, 1, 0));
        const bs = dot(ocBand, dBand);
        const ds = bs.mul(bs).sub(dot(ocBand, ocBand).sub(R * R));
        const tStar = select(ds.greaterThan(0.0), bs.negate().sub(sqrt(max(ds, 0.0))), float(1e9));
        const col = vec3(0).toVar();
        const tEnd = float(0).toVar();
        If(tStar.lessThan(hit.t).and(tStar.greaterThan(0.0)), () => {
          const n = normalize(ocBand.add(dBand.mul(tStar)));
          col.assign(surface(n, max(dot(n, dBand.negate()), 0.0)).rgb);
          tEnd.assign(tStar);
        })
          .ElseIf(hit.mat.equal(MAT.space).or(hit.mat.equal(MAT.none)), () => {
            col.assign(outerSky(space, d, px));
            // Out through a far gap: the cavity's far side.
            tEnd.assign(bs.negate().add(sqrt(max(bs.mul(bs).sub(dot(ocBand, ocBand).sub(1)), 0.0))));
          })
          .Else(() => {
            const noise = hash33(vec3(screenCoordinate.xy, fract(frame.mul(0.618034)).mul(4096.0))).xy;
            col.assign(shadeStructure(hit, dBand, px, light, noise));
            tEnd.assign(hit.t);
          });
        // The cavity's plasma along the way; the star's atmosphere in front (lines from the eye).
        const pl = plasmaSegment(tex.plasma, ocBand, dBand, float(0), tEnd);
        const seen = col.mul(pl.T).add(pl.S.mul(illuminant));
        const eyeBand = toBand(o);
        const jitter = hash33(vec3(screenCoordinate.xy, fract(frame.mul(0.618034)).mul(4096.0).add(7.0))).z;
        const tFromEye = tEnd.add(t0);
        const prom = magneticPlasmaFrom(star, star.magnetic, eyeBand, dBand, tFromEye, px, R, jitter);
        const loops = activeLayer(star, star.rotation.mul(eyeBand.div(R)), star.rotation.mul(dBand), tFromEye.div(R), px);
        const corona = coronaAlong(star, tex.corona, eyeBand.div(R), dBand, normalize(eyeBand), px);
        out.assign(seen.mul(exp(prom.a.negate())).add(corona.add(prom.rgb).add(loops).mul(illuminant)));
      });
    });
    return max(out, vec3(0));
  });

  return {
    radiance: (dirWorld, pixelAngle) => radiance(dirWorld, pixelAngle) as unknown as V3,
    setView(view) {
      (toSphere.value as Matrix3).copy(view.toSphere);
      (eye.value as Vector3).copy(view.eye);
    },
    frame: frame as unknown as { value: number },
  };
}
