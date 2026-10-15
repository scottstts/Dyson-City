/**
 * The Dome's glass, composited analytically in the post pass before aerial perspective and TAA.
 *
 * The glass is one ellipsoid (S, surface.ts), so every view ray's crossings are closed-form: none,
 * one from inside, or two from outside. Each crossing in front of the opaque scene (or the sky)
 * applies a thin pane: transmission τ(θ) and a Fresnel reflection of whatever lies on the eye's side
 * of it: the sky outside where the ray enters the Dome, the interior capture where it leaves (from
 * inside, the panes mirror the platform and the frame, never the deck outside). Each pane (a whole
 * coffer, or a drum bay: there are no glazing bars) is set with its own milliradian error, so the
 * shoulders mirror the star broken pane by pane while the glass itself carries no pattern. Nothing
 * here is sorted, blended or written to depth: the sky behind keeps its depth-0 treatment (the
 * star's atmosphere, no aerial perspective on it) and opaque geometry behind is attenuated.
 *
 * Glass: transparent ceramic, anti-reflection coated on both faces (F0 ≈ 1 % for the pair), tinted
 * neutral grey (GLASS_TINT): from inside the sky stays clear but a stop darker (docs/dome.md).
 */
import { float, vec2, vec3, sqrt, abs, floor, dot, min, normalize, reflect, select, pow, texture, atan, If, Fn, pmremTexture } from 'three/tsl';
import type { DataTexture, Node, Texture } from 'three/webgpu';
import { hash33 } from '../../render/tsl/noise';
import { DOME, EAVE_Y, GATE_OPENING, INTERIOR_CAPTURE_Y } from './spec';
import { LOCK_OPENING } from '../eastLock/spec';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const GLASS_F0 = 0.01;
/**
 * The glass is tinted neutral grey, like sunglasses: it passes half the light in every channel
 * (no colour: a coloured tint would split the warm cast in two). From inside the city is a stop
 * darker and the star still clips; from outside the Dome reads dark (two passes, ~25 %).
 */
export const GLASS_TINT = 0.5;
/** Transmission at near-normal incidence (both faces' reflection and the tint). */
export const GLASS_TRANSMISSION = (1 - GLASS_F0) * GLASS_TINT;
/** Pane set error (rad, per axis). */
const SET_ERROR = 0.0015;

export interface DomeGlassOptions {
  /** Prefiltered sky outside the Dome (reflections where a ray enters the Dome). */
  outdoor: Texture;
  /** Prefiltered capture inside the Dome (reflections where a ray leaves it). */
  interior: Texture;
  /** Drum bay index by azimuth (glazing.ts bayTable). */
  bays: DataTexture;
}

export type GlassComposite = (origin: V3, dir: V3, dist: F, color: V3) => V3;

export function createDomeGlass(opts: DomeGlassOptions): GlassComposite {
  const { a, c, centreY } = DOME;
  const inv = vec3(1 / a, 1 / c, 1 / a);
  const centre = vec3(0, centreY, 0);
  const holeW = GATE_OPENING.halfWidth + GATE_OPENING.trim;
  const holeTop = GATE_OPENING.top + GATE_OPENING.trim;
  // The East Lock's gatehouse (city/eastLock) passes through the skin at the east cardinal.
  const lockW = LOCK_OPENING.halfWidth + LOCK_OPENING.trim;
  const lockTop = LOCK_OPENING.top + LOCK_OPENING.trim;
  const M = DOME.module;
  const capture = vec3(0, INTERIOR_CAPTURE_Y, 0);
  const roughness = float(0.02);

  /**
   * The interior capture seen along r from p on S, parallax-corrected on the Dome's own enclosure:
   * the capture sits at the platform centre, so r is traced to the platform top or to S's far side
   * and the capture is read toward that point (read along r alone, the drum would mirror the floor
   * as seen from the centre).
   */
  const interiorAt = (p: V3, r: V3): V3 => {
    const o = p.sub(centre).mul(inv);
    const d = r.mul(inv);
    // p lies on S, so the far root of |o + t d| = 1 is −2 (o·d) / (d·d).
    const tShell = dot(o, d).mul(-2).div(dot(d, d)).max(0);
    const tFloor = select(r.y.lessThan(-1e-4), p.y.sub(centreY).div(r.y.negate()), float(1e9));
    const hit = p.add(r.mul(min(tShell, tFloor)));
    return pmremTexture(opts.interior, normalize(hit.sub(capture)), roughness).rgb as unknown as V3;
  };

  /** One pane crossing at point p. */
  const pane = (L: V3, p: V3, dir: V3): V3 => {
    const n = normalize(p.sub(centre).mul(inv).mul(inv)).toVar();
    const outside = dot(dir, n).lessThan(0);
    // Pane identity: the coffer (plan cells between ribs) above the eave, the drum bay below.
    const phi = atan(p.z, p.x);
    const bay = texture(opts.bays, vec2(phi.div(2 * Math.PI).add(0.5), 0.5)).r;
    const cell = select(p.y.greaterThanEqual(EAVE_Y), vec3(floor(p.x.div(M)), floor(p.z.div(M)), 1), vec3(bay, 0, 2));
    const h = hash33(cell).sub(0.5).mul(2 * SET_ERROR);
    const tA = normalize(vec3(n.z.negate(), 0, n.x).add(vec3(1e-4, 0, 0)));
    const tB = normalize(vec3(n.y.negate().mul(n.x), n.x.mul(n.x).add(n.z.mul(n.z)), n.y.negate().mul(n.z)));
    const nPane = normalize(n.add(tA.mul(h.x)).add(tB.mul(h.y)));
    const cosI = abs(dot(dir, nPane)).clamp(1e-3, 1);
    const R = float(GLASS_F0).add(float(1 - GLASS_F0).mul(pow(float(1).sub(cosI), 5)));
    const tau = float(1).sub(R).mul(GLASS_TINT);
    const reflDir = reflect(dir, select(outside, nPane, nPane.negate())).toVar();
    const reflected = vec3(0).toVar();
    If(outside, () => {
      reflected.assign(pmremTexture(opts.outdoor, reflDir, roughness).rgb);
    }).Else(() => {
      reflected.assign(interiorAt(p, reflDir));
    });
    return L.mul(tau).add(reflected.mul(R)) as unknown as V3;
  };

  const valid = (p: V3, t: F, dist: F): Node<'bool'> => {
    const hole = p.x.lessThan(-400).and(abs(p.z).lessThan(holeW)).and(p.y.lessThan(holeTop)).or(p.x.greaterThan(400).and(abs(p.z).lessThan(lockW)).and(p.y.lessThan(lockTop)));
    return t.greaterThan(1e-3).and(t.lessThan(dist)).and(p.y.greaterThanEqual(centreY)).and(hole.not()) as unknown as Node<'bool'>;
  };

  return (origin, dir, dist, color) =>
    Fn(() => {
      const out = vec3(color).toVar();
      const o = origin.sub(centre).mul(inv);
      const d = dir.mul(inv);
      const A = dot(d, d);
      const B = dot(o, d);
      const C = dot(o, o).sub(1);
      const disc = B.mul(B).sub(A.mul(C));
      If(disc.greaterThan(0), () => {
        const s = sqrt(disc);
        const t1 = B.negate().sub(s).div(A);
        const t2 = B.negate().add(s).div(A);
        // Far crossing first, then the near one in front of it.
        const p2 = origin.add(dir.mul(t2));
        If(valid(p2, t2, dist), () => {
          out.assign(pane(out, p2, dir));
        });
        const p1 = origin.add(dir.mul(t1));
        If(valid(p1, t1, dist), () => {
          out.assign(pane(out, p1, dir));
        });
      });
      return out;
    })() as unknown as V3;
}
