/**
 * The cabin's light (docs/intro-ship.md, "Light"). Like every interior it gets light only through
 * its openings and from its lamps (docs/shadows.md: interiors are baked). Image-based light alone
 * would light it as if the hull were not there: in scene 1 the whole cockpit glowed white with the
 * star the hull hides.
 *
 *  - Baked per vertex at boot (ship frame; the cabin is rigid): the share of the cosine-weighted
 *    hemisphere that leaves through the panes, and the mean direction of those rays (a bent
 *    normal); the same through the door; and the irradiance from the lamps and the screens.
 *  - At runtime, diffuse light is what the environment sends along the bent normals, through the
 *    panes and, as it slides open, the door, plus a fill for the light the cabin passes round
 *    itself. A glossy surface sees the outside only along rays that leave through an opening
 *    (glazing.ts, per pixel); otherwise it reflects the cabin.
 *
 * The rays ignore what stands in the cabin (the seat, the consoles): contact occlusion (GTAO)
 * takes the small scale.
 */
import { BufferAttribute, Matrix3, Matrix4, Node, Vector3, type BufferGeometry, type NodeBuilder, type Texture } from 'three/webgpu';
import { attribute, clamp, float, max, normalWorld, normalize, pmremTexture, positionWorld, select, sqrt, uniform, vec4 } from 'three/tsl';
import { v3, type Vec3 } from '../../geometry/polyMesh';
import { DOOR_OPENING, WINDOWS, openingHit, openingHitCPU, type Opening } from './glazing';
import { shipInSpace } from './env';

type V3 = Node<'vec3'>;
type F = Node<'float'>;

/** A small emitter for the bake: a flat rectangle (centre, its two half-axes, facing ±normal). */
export interface CabinEmitter {
  centre: Vec3;
  a: Vec3;
  b: Vec3;
  /** Which way it shines: its face's normal. */
  n: Vec3;
  /** Radiance at full (scene units) and its group (0 lamps, 1 screens). */
  radiance: number;
  group: 0 | 1;
}

/** Hemisphere samples for the bake (cosine-weighted, Fibonacci). */
const SAMPLES = 64;
const HEMI: Vec3[] = Array.from({ length: SAMPLES }, (_, i) => {
  const u = (i + 0.5) / SAMPLES;
  const r = Math.sqrt(u);
  const phi = i * 2.399963229728653;
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)];
});

/** Visibility and bent direction through a set of openings from p over the hemisphere of n. */
function through(openings: readonly Opening[], p: Vec3, n: Vec3, spin: number): [number, number, number, number] {
  const t = Math.abs(n[1]) < 0.9 ? v3.norm(v3.cross(n, [0, 1, 0])) : v3.norm(v3.cross(n, [1, 0, 0]));
  const b = v3.cross(n, t);
  const c = Math.cos(spin);
  const s = Math.sin(spin);
  let hits = 0;
  let bent: Vec3 = [0, 0, 0];
  for (const h of HEMI) {
    const x = h[0] * c - h[1] * s;
    const y = h[0] * s + h[1] * c;
    const d = v3.add(v3.add(v3.scale(t, x), v3.scale(b, y)), v3.scale(n, h[2]));
    for (const op of openings) {
      if (openingHitCPU(op, p, d) > 0) {
        hits++;
        bent = v3.add(bent, d);
        break;
      }
    }
  }
  const vis = hits / SAMPLES;
  const dir = hits ? v3.norm(bent) : n;
  return [dir[0], dir[1], dir[2], vis];
}

/** Irradiance at p (normal n) from the emitters of one group, at full radiance. */
function emitted(emitters: readonly CabinEmitter[], group: 0 | 1, p: Vec3, n: Vec3): number {
  let e = 0;
  const K = 4;
  for (const em of emitters) {
    if (em.group !== group) continue;
    const area = 4 * v3.len(em.a) * v3.len(em.b);
    const dA = area / (K * K);
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < K; j++) {
        const q = v3.add(em.centre, v3.add(v3.scale(em.a, ((i + 0.5) / K) * 2 - 1), v3.scale(em.b, ((j + 0.5) / K) * 2 - 1)));
        const l = v3.sub(q, p);
        const r2 = Math.max(v3.dot(l, l), 0.01);
        const ld = v3.scale(l, 1 / Math.sqrt(r2));
        const cr = v3.dot(n, ld);
        const ce = -v3.dot(em.n, ld);
        if (cr > 0 && ce > 0) e += (em.radiance * dA * cr * ce) / r2;
      }
    }
  }
  return e;
}

/**
 * Bakes the cabin's light into a geometry (ship frame): `cabinSky` and `cabinDoor` (bent direction,
 * visibility) and `cabinLamp` (irradiance from the lamps, from the screens).
 */
export function bakeCabinLight(g: BufferGeometry, emitters: readonly CabinEmitter[]): void {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const n = pos.count;
  const sky = new Float32Array(n * 4);
  const door = new Float32Array(n * 4);
  const lamp = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const nn: Vec3 = [nrm.getX(i), nrm.getY(i), nrm.getZ(i)];
    const p: Vec3 = v3.add([pos.getX(i), pos.getY(i), pos.getZ(i)], v3.scale(nn, 0.01));
    // A different turn of the samples per vertex: no banding where neighbours share a pattern.
    const spin = ((i * 0.6180339887) % 1) * 2 * Math.PI;
    sky.set(through(WINDOWS, p, nn, spin), i * 4);
    door.set(through([DOOR_OPENING], p, nn, spin), i * 4);
    lamp[i * 2] = emitted(emitters, 0, p, nn);
    lamp[i * 2 + 1] = emitted(emitters, 1, p, nn);
  }
  g.setAttribute('cabinSky', new BufferAttribute(sky, 4));
  g.setAttribute('cabinDoor', new BufferAttribute(door, 4));
  g.setAttribute('cabinLamp', new BufferAttribute(lamp, 2));
}

/** What the cabin's lighting needs each frame. */
export const cabinState = {
  /** World → ship (the ship's inverse world matrix), and the ship's rotation (ship → world). */
  toShip: uniform(new Matrix4()),
  rotation: uniform(new Matrix3()),
  /** How far the door is open (0..1: the share of its opening uncovered). */
  door: uniform(0),
  /** The light the cabin passes round itself, as a radiance (set from what comes in and the lamps). */
  fill: uniform(new Vector3(0.01, 0.01, 0.01)),
  /** The lamps and the screens, 0..1. */
  lamps: uniform(1),
  screens: uniform(1),
};

interface EnvContext {
  getUV?: (node: Node, builder: NodeBuilder) => V3;
  getTextureLevel?: (node: Node) => F;
}

class CabinEnvironmentNode extends Node {
  static get type(): string {
    return 'CabinEnvironmentNode';
  }

  private readonly band: Texture;
  private readonly space: Texture;

  constructor(band: Texture, space: Texture) {
    super('vec3');
    this.band = band;
    this.space = space;
  }

  private env(dir: V3, level: F): V3 {
    const a = pmremTexture(this.band, dir, level) as unknown as V3;
    const b = pmremTexture(this.space, dir, level) as unknown as V3;
    return select(shipInSpace.greaterThan(0.5), b, a) as unknown as V3;
  }

  setup(builder: NodeBuilder): Node {
    const ctx = builder.context as EnvContext;
    const raw = ctx.getUV ? ctx.getUV(this, builder) : (normalWorld as unknown as V3);
    const level = ctx.getTextureLevel ? ctx.getTextureLevel(this) : float(1);
    const S = cabinState;
    const fill = S.fill as unknown as V3;
    const door = S.door as unknown as F;
    // Diffuse: the irradiance context asks along the normal itself.
    if ((raw as unknown) === (normalWorld as unknown)) {
      const sky = attribute('cabinSky', 'vec4');
      const dr = attribute('cabinDoor', 'vec4');
      const rot = S.rotation as unknown as Node<'mat3'>;
      const bentSky = normalize(rot.mul(sky.xyz)) as unknown as V3;
      const bentDoor = normalize(rot.mul(dr.xyz)) as unknown as V3;
      // The visible patch is a cone about the bent normal: sample the environment that blurred.
      const wide = (v: F) => clamp(sqrt(v).mul(1.1), 0.35, 1.0) as unknown as F;
      const throughDoor = dr.w.mul(door);
      const outside = this.env(bentSky, wide(sky.w)).mul(sky.w).add(this.env(bentDoor, wide(dr.w)).mul(throughDoor));
      return outside.add(fill.mul(max(float(1).sub(sky.w).sub(throughDoor), 0.0))) as unknown as Node;
    }
    // Glossy: the outside only along a ray that leaves through an opening.
    const dir = normalize(raw);
    const p = (S.toShip as unknown as Node<'mat4'>).mul(vec4(positionWorld, 1)).xyz as unknown as V3;
    const rotT = (S.rotation as unknown as Node<'mat3'>).transpose();
    const d = normalize(rotT.mul(dir)) as unknown as V3;
    let out: F = float(0);
    for (const w of WINDOWS) out = max(out, openingHit(w, p, d).greaterThan(0).select(float(1), float(0))) as unknown as F;
    out = max(out, openingHit(DOOR_OPENING, p, d).greaterThan(0).select(door, float(0))) as unknown as F;
    return this.env(dir, level).mul(out).add(fill.mul(float(1).sub(out))) as unknown as Node;
  }
}

/** The env node for the cabin's materials. */
export function cabinEnvironment(band: Texture, space: Texture): Node {
  return new CabinEnvironmentNode(band, space);
}

/** The lamps' and screens' baked light on a surface of diffuse albedo `albedo`, as emission. */
export function cabinLampLight(albedo: V3): V3 {
  const l = attribute('cabinLamp', 'vec2');
  const S = cabinState;
  return albedo.mul(l.x.mul(S.lamps).add(l.y.mul(S.screens))).div(Math.PI) as unknown as V3;
}
