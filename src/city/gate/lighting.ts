/**
 * Light in the West Gate's airlock chamber (docs/gate.md, design §7.8): a sealed vault lit by two
 * long luminaires under its crown, so dim that stepping in is a real change of light, and flooded
 * through whichever gate stands open.
 *
 *  - Lamps: two RectAreaLights the size of the luminaires' diffusers, applied only to the gate's
 *    own materials. Their radiance is set so the floor sees ~1/200 of the outdoor illuminance
 *    (≈500 lx against ≈100 klx): readable once the eye has opened up its +4 stops, still dim.
 *  - Daylight through an opening: the chamber's surfaces take the environment (outdoor through the
 *    outer gate, the city's through the inner) scaled by the solid angle of the opening as each
 *    point sees it (closed form for a rectangle) and by how squarely the surface faces it. The
 *    opening grows with the leaf's lip as it rises.
 *  - Outside the chamber the gatehouse takes the outdoor or the interior environment by which side
 *    of the glass it is on.
 */
import { RectAreaLight, type Texture } from 'three/webgpu';
import { float, vec3, abs, atan, sqrt, max, clamp, dot, normalize, select, uniform, positionWorld, normalWorldGeometry, length, pmremTexture } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { DOME } from '../dome/spec';
import { GATE } from './spec';
import { LUMINAIRE, WALL_LAMP } from './gatehouse';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/**
 * Diffuser radiances (scene units; the star's disc centre is 10). Together they put ~1/35 of the
 * outdoor illuminance on the chamber's floor and walls: dim, but readable once the eye opens up.
 */
export const LAMP_RADIANCE = 6;
export const UPLIGHT_RADIANCE = 3;
export const WALL_LAMP_RADIANCE = 5;
/** Lamp colour: close to the star's (~5,000 K) so interiors keep the single warm cast. */
export const LAMP_COLOUR: [number, number, number] = [1.0, 0.95, 0.88];

/** Uniforms driven by the airlock each frame: lip heights of the two openings (m above the sill). */
export interface ChamberUniforms {
  outerOpening: { value: number };
  innerOpening: { value: number };
}

export function createChamberUniforms(): ChamberUniforms {
  return { outerOpening: uniform(0) as unknown as { value: number }, innerOpening: uniform(0) as unknown as { value: number } };
}

/** Height of a leaf's lip above the sill at openness s (the clear opening under it). */
export function openingHeight(s: number): number {
  const lip = GATE.trunnionY + GATE.R * Math.sin(GATE.thetaBottom + GATE.openAngle * s);
  return Math.min(Math.max(lip - GATE.seal, 0), GATE.clearTop - GATE.seal);
}

/**
 * The chamber's area lights, one per diffuser. Three's RectAreaLight shading lights the side its
 * local +Z faces (the LTC evaluation culls points behind cross(−halfWidth, halfHeight)), with the
 * width on local X; orientations are set by rotation about x.
 */
export function createLamps(): RectAreaLight[] {
  const L = LUMINAIRE;
  const W = WALL_LAMP;
  const lamps: RectAreaLight[] = [];
  const make = (radiance: number, width: number, height: number, pos: [number, number, number], rotX: number) => {
    const lamp = new RectAreaLight(0xffffff, radiance, width, height);
    lamp.color.setRGB(...LAMP_COLOUR);
    lamp.position.set(...pos);
    lamp.rotation.set(rotX, 0, 0);
    lamp.updateMatrixWorld(true);
    lamps.push(lamp);
  };
  const len = L.x1 - L.x0;
  const cx = (L.x0 + L.x1) / 2;
  const tilt = (20 * Math.PI) / 180;
  for (const side of [-1, 1]) {
    // Downlight (faces −y) and uplight (faces +y) of each pendant.
    make(LAMP_RADIANCE, len - 0.1, L.half * 2 - 0.08, [cx, L.bottom - 0.005, side * L.z], Math.PI / 2);
    make(UPLIGHT_RADIANCE, len - 0.1, L.half * 2 - 0.08, [cx, L.top + 0.005, side * L.z], -Math.PI / 2);
    // Wall line, facing into the chamber and tilted 20° down.
    const z = side * (GATE.passageHalf - W.proud - 0.005);
    make(WALL_LAMP_RADIANCE, W.x1 - W.x0 - 0.1, W.y1 - W.y0 - 0.06, [(W.x0 + W.x1) / 2, (W.y0 + W.y1) / 2, z], side > 0 ? Math.PI - tilt : tilt);
  }
  return lamps;
}

/** Solid angle of the rectangle [a1,a2]×[b1,b2] in a plane at distance d (closed form). */
function rectSolidAngle(a1: F, a2: F, b1: F, b2: F, d: F): F {
  const f = (a: F, b: F) => atan(a.mul(b).div(d.mul(sqrt(d.mul(d).add(a.mul(a)).add(b.mul(b))))));
  return f(a2, b2).sub(f(a1, b2)).sub(f(a2, b1)).add(f(a1, b1)) as F;
}

/** Is a world point inside the chamber (between the two leaves' skins, under the vault)? */
export function insideChamber(p: V3): Node<'bool'> {
  const yt = GATE.trunnionY;
  const rOut = length(p.xy.sub(vec3(GATE.outerTrunnionX, yt, 0).xy));
  const rIn = length(p.xy.sub(vec3(GATE.innerTrunnionX, yt, 0).xy));
  const mid = GATE.R - GATE.skin / 2;
  const low = p.y.lessThan(GATE.clearTop);
  const eastOfOuter = select(low, rOut.greaterThan(mid).and(p.x.greaterThan(GATE.outerTrunnionX)), p.x.greaterThan(GATE.headWestX + 0.05));
  const westOfInner = select(low, p.x.lessThan(GATE.innerTrunnionX).or(rIn.lessThan(mid)), p.x.lessThan(GATE.eastX - 0.05));
  return abs(p.z).lessThan(GATE.passageHalf + 0.05).and(p.y.lessThan(GATE.topY - 0.5)).and(eastOfOuter).and(westOfInner) as unknown as Node<'bool'>;
}

/**
 * The gate's environment node: chamber daylight inside the chamber, otherwise the outdoor sky or
 * the Dome's interior capture by which side of the glass the point is on.
 */
export function gateEnvironment(outdoor: Texture, interior: Texture, u: ChamberUniforms): V3 {
  const p = positionWorld;
  const n = normalWorldGeometry;
  const q = p.sub(vec3(0, DOME.centreY, 0));
  const inDome = q.x.mul(q.x).add(q.z.mul(q.z)).div(DOME.a ** 2).add(max(q.y, 0).mul(q.y).div(DOME.c ** 2)).lessThan(1);
  const outside = pmremTexture(outdoor) as unknown as V3;
  const inside = pmremTexture(interior) as unknown as V3;
  const open = (planeX: number, height: Node<'float'>, env: V3): V3 => {
    const d = abs(p.x.sub(planeX)).max(0.05);
    const h = GATE.passageHalf;
    const y0 = float(GATE.seal).sub(p.y);
    const y1 = float(GATE.seal).add(height).sub(p.y);
    const omega = rectSolidAngle(float(-h).sub(p.z), float(h).sub(p.z), y0, y1, d);
    const centre = vec3(planeX, float(GATE.seal).add(height.mul(0.5)), 0);
    const facing = clamp(dot(n, normalize(centre.sub(p))).mul(0.75).add(0.25), 0, 1);
    return env.mul(omega.div(Math.PI)).mul(facing) as unknown as V3;
  };
  const daylight = open((GATE.outerLipX + GATE.headWestX) / 2, u.outerOpening as unknown as F, outside).add(open(GATE.innerLipX + 0.5, u.innerOpening as unknown as F, inside));
  const open3 = select(inDome, inside, outside);
  return select(insideChamber(p), daylight, open3) as unknown as V3;
}
