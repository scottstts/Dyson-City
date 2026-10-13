/**
 * The star's atmosphere as seen from the city: the corona and chromosphere (coronaNodes.ts), the
 * loop arcades of its active layer (activeLayer.ts), the prominences (magneticNodes.ts) and the
 * erupting gas (gas/), attenuated by the habitat air.
 *
 * It is composited onto sky pixels in its own post pass (render/pipeline.ts) rather than inside
 * the sky shader: folded into the sky's structure trace, the combined shader's register pressure
 * slowed the whole sky by several milliseconds. It needs nothing from that trace: every sight line
 * ends at the photosphere or at the shell, and the star's atmosphere lies inside the shell, so it is
 * always in front of whatever the ray meets (the structure is on the shell; through a gap there is
 * only space). The thin interior plasma in front of it transmits ~99 % and is neglected.
 */
import { vec3, vec4, If, max, select, sqrt, fract, screenCoordinate } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33 } from '../../render/tsl/noise';
import { STAR_RADIUS_R } from '../../world/constants';
import { sampleLut, skyLutUV, type AtmosphereNodes } from '../../atmosphere/luts';
import { coronaEmission } from './coronaNodes';
import { magneticPlasma } from './magneticNodes';
import { activeLayer } from './activeLayer';
import { gasEmission } from './gas/gasNodes';
import type { CoronalGas } from './gas/solver';
import type { StarState } from './starState';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/**
 * The star's atmosphere along world view direction `d` (local frame), behind the habitat air:
 * rgb = emission, a = optical depth (cool prominence material dims what lies behind it).
 */
export type StarAtmosphere = (d: V3, pixelAngle: F) => Node<'vec4'>;

export function createStarAtmosphere(star: StarState, atmo: AtmosphereNodes, frame: Node<'float'>, gas: CoronalGas): StarAtmosphere {
  const s = STAR_RADIUS_R;
  return (d, pixelAngle) => {
    const out = vec4(0).toVar();
    If(d.y.greaterThan(0.0), () => {
      // Where the ray ends (shell units, observer at the origin, star centre at (0, 1, 0)): the
      // photosphere, or the far shell.
      const disc = d.y.mul(d.y).sub(1 - s * s);
      const tEnd = select(disc.greaterThan(0.0), d.y.sub(sqrt(max(disc, 0.0))), d.y.mul(2.0));
      // Per pixel and frame: decorrelates the raymarch (temporal AA integrates it).
      const jitter = hash33(vec3(screenCoordinate.xy, fract(frame.mul(0.618034)).mul(4096.0).add(7.0))).z;
      const plasma = magneticPlasma(star, star.magnetic, d, tEnd, pixelAngle, s, jitter);
      // The active layer in the star's frame (star radii): observer at (0, −1/s, 0) from the centre.
      const o = star.rotation.mul(vec3(0, -1 / s, 0));
      const dirStar = star.rotation.mul(d);
      const loops = activeLayer(star, o, dirStar, tEnd.div(s), pixelAngle);
      const emission = coronaEmission(star, atmo.tex.corona, d, pixelAngle).add(plasma.rgb).add(loops).add(gasEmission(gas, d, pixelAngle, jitter));
      const air = sampleLut(atmo.tex.skyLocalS, atmo.tex.skyLocalT, skyLutUV(d)).T;
      out.assign(vec4(emission.mul(star.illuminant as unknown as V3).mul(air), plasma.a));
    });
    return out as unknown as Node<'vec4'>;
  };
}
