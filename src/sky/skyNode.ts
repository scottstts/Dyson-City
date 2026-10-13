/**
 * Sky composition: everything seen beyond local geometry, for a view direction in the local frame.
 *
 *   below the horizon → the deck/pad (used by the environment capture and the sub-pixel strip
 *                        beyond the deck mesh), lit by the attenuated star and skylight
 *   star disc          → white-light photosphere, then the local air
 *   elsewhere          → the far structure (traced, with one traced reflection) or open space,
 *                        then the local air
 *
 * The interior of the sphere is effectively vacuum (dust sublimates at ~3,600 K at 1.4 stellar
 * radii; any plasma is far too thin to see), so the only medium is the local air band.
 *
 * Units: shell radii for geometry, scene radiance for colour (see world/radiometry.ts).
 */
import { Fn, vec3, float, fract, If, normalize, sqrt, dot, length, fwidth, max, select, uniform } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { screenCoordinate } from 'three/tsl';
import { hash33 } from '../render/tsl/noise';
import { STAR_RADIUS_R } from '../world/constants';
import { DECK_MEAN_ALBEDO } from '../world/radiometry';
import { skyLutUV, sampleLut, type AtmosphereNodes } from '../atmosphere/luts';
import { createStarSurface } from './star/starSurface';
import type { StarState } from './star/starState';
import { traceStructure, shadeStructure, MAT, type ShellLight } from './structure/structure';
import { plasmaSegment } from './medium/plasmaNodes';
import { spaceRadiance } from './space';

type V3 = Node<'vec3'>;

/** Sky debug modes (?sky=...): isolate one signal of the composition. */
export const SKY_DEBUG = { off: 0, localS: 1, localT: 2, material: 3, noAtmosphere: 4 } as const;

export interface SkyOptions {
  debug: Node<'float'>;
  /** Albedo of the near ground under the observer (the pad) used below the horizon. */
  nearGroundAlbedo: Node<'vec3'>;
  /** Albedo of the deck beyond the pad. */
  deckAlbedo: Node<'vec3'>;
  /** sin of the depression angle where the pad edge sits (pad below, deck beyond). */
  padEdgeSinDepression: Node<'float'>;
  /** Frame counter: decorrelates per-frame stochastic sampling (temporal AA integrates it). */
  frame: Node<'float'>;
}

export interface Sky {
  /** Builds a fresh radiance graph (one per material that renders the sky). */
  radiance: (dir: V3) => V3;
  options: SkyOptions;
}

export function createSky(atmo: AtmosphereNodes, star: StarState): Sky {
  const s = STAR_RADIUS_R;
  const options: SkyOptions = {
    debug: uniform(0) as unknown as Node<'float'>,
    nearGroundAlbedo: uniform(vec3(0.42, 0.4, 0.37)) as unknown as Node<'vec3'>,
    deckAlbedo: uniform(vec3(...DECK_MEAN_ALBEDO)) as unknown as Node<'vec3'>,
    padEdgeSinDepression: uniform(0.0058) as unknown as Node<'float'>,
    frame: uniform(0) as unknown as Node<'float'>,
  };
  const { tex } = atmo;

  const build = () => {
    const surface = createStarSurface(star);
    return Fn(([dirIn]: [V3]) => {
      const d = normalize(dirIn).toVar();
      const pixelAngle = length(fwidth(d)).max(1e-6).toVar();
      const lutUV = skyLutUV(d).toVar();
      const localRaw = sampleLut(tex.skyLocalS, tex.skyLocalT, lutUV);
      // Scattered light scales with the source: the LUTs are integrated for the reference photosphere.
      const illuminant = star.illuminant as unknown as V3;
      const light: ShellLight = { illuminant, pre: tex.enclosurePre, preMirror: tex.enclosurePreMirror, irr: tex.enclosureIrr, plasma: tex.plasma };
      // The air's LUTs already carry the Veil-filtered sky that lights it (atmosphere/worker.ts).
      const local = { S: localRaw.S.mul(illuminant).toVar(), T: localRaw.T.toVar() };
      const out = vec3(0).toVar();
      const disc = d.y.mul(d.y).sub(1 - s * s);

      If(d.y.lessThanEqual(0.0), () => {
        // Ground below the eye: pad near, deck beyond the pad edge.
        const albedo = select(d.y.negate().greaterThan(options.padEdgeSinDepression), options.nearGroundAlbedo, options.deckAlbedo);
        const E = atmo.groundIrradiance.add(atmo.skyIrradiance).mul(illuminant);
        out.assign(albedo.mul(E).div(Math.PI).mul(local.T).add(local.S));
      }).Else(() => {
        const col = vec3(0).toVar();
        const mat = float(MAT.none).toVar();
        const tEnd = float(0).toVar();
        If(disc.greaterThan(0.0), () => {
          const t = d.y.sub(sqrt(disc)).toVar();
          const n = d.mul(t).sub(vec3(0, 1, 0)).div(s);
          const mu = dot(n, d.negate()).max(0.0);
          col.assign(surface(n, mu).rgb);
          tEnd.assign(t);
        }).Else(() => {
          const hit = traceStructure(vec3(0), d, pixelAngle);
          mat.assign(hit.mat);
          tEnd.assign(hit.t);
          If(hit.mat.equal(MAT.space).or(hit.mat.equal(MAT.none)), () => {
            col.assign(spaceRadiance(d, pixelAngle));
            // Through a gap: out of the shell.
            tEnd.assign(d.y.mul(2.0));
          }).Else(() => {
            const noise = hash33(vec3(screenCoordinate.xy, fract(options.frame.mul(0.618034)).mul(4096.0))).xy;
            col.assign(shadeStructure(hit, d, pixelAngle, light, noise));
          });
        });
        // The trapped plasma between the observer and what the ray meets (sky/medium/plasma.ts).
        const pl = plasmaSegment(tex.plasma, vec3(0, -1, 0), d, float(0), tEnd);
        const seen = col.mul(pl.T).add(pl.S.mul(illuminant)).toVar();
        out.assign(seen.mul(local.T).add(local.S));
        If(options.debug.equal(SKY_DEBUG.material), () => {
          // Layout view: panels grey, members orange, hubs red, band blue, space black, star yellow
          // (scaled to survive the camera), shaded by distance.
          const shade = float(1).sub(fract(tEnd.mul(4)).mul(0.25));
          const c = select(mat.equal(MAT.panel).or(mat.equal(MAT.panelEdge)), vec3(0.5), select(mat.equal(MAT.frame), vec3(1, 0.45, 0.05), select(mat.equal(MAT.hub), vec3(1, 0.05, 0.05), select(mat.equal(MAT.girdle), vec3(0.1, 0.3, 1), select(mat.equal(MAT.none).and(disc.greaterThan(0.0)), vec3(1, 1, 0.2), vec3(0))))));
          out.assign(c.mul(shade).mul(2.0));
        });
        If(options.debug.equal(SKY_DEBUG.noAtmosphere), () => {
          out.assign(seen);
        });
      });
      If(options.debug.equal(SKY_DEBUG.localS), () => {
        out.assign(local.S);
      });
      If(options.debug.equal(SKY_DEBUG.localT), () => {
        out.assign(local.T);
      });

      return max(out, vec3(0.0));
    });
  };

  return { radiance: (dir: V3) => build()(dir) as unknown as V3, options };
}
