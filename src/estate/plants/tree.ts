/**
 * Procedural trees (docs/estate.md "Planting"; the procedural-vegetation skill's growth model, in
 * metres). A tree grows from a queue of branch jobs:
 *
 *  - each branch is a run of sections: a ring at each, then a step along the section's axis, the
 *    axis perturbed by gnarliness (stronger on thin wood), twisted, and turned toward the level's
 *    tropism (light: up; a cedar's tiers: out to the horizontal);
 *  - children emerge at stratified heights along the parent with independently permuted azimuth
 *    slots (never all at one height, never a visible helix); every level but the last continues
 *    from its tip (the continuation is what makes an irregular crown, not a candelabra);
 *  - child radius follows the parent's radius where it emerges; length follows the species' crown
 *    shape (a dome's mid-height limbs are longest, a cone's lowest);
 *  - leaves are sprig cards (crossed pairs) along the final level, after the wood is done.
 *
 * Leaf cards carry a rounded normal (their own normal blended with the direction from the crown's
 * centre, so the crown shades as a volume lit from above), a crown-depth shade (inner and lower
 * leaves see less of the star) and their root (for rooted wind).
 */
import { Euler, Quaternion, Vector3 } from 'three';
import { tileUV, type LeafKind } from './atlas';

export interface Level {
  /** Branch length (m) and radius (level 0: m; others: × the parent's radius where they emerge). */
  length: number;
  radius: number;
  sections: number;
  segments: number;
  /** Lateral children this level makes (on its own branches), where they start along it (0–1), their emergence angle. */
  children: number;
  start: number;
  angle: number;
  gnarl: number;
  twist: number;
  taper: number;
  /** Tropism direction and strength (rad per metre of radius⁻¹, as the skill's force). */
  force: [number, number, number];
  strength: number;
  /** Children's length along the parent: 'dome' (longest mid-way), 'cone' (longest low), 'even'. */
  shape?: 'dome' | 'cone' | 'even';
  /** Children turned toward the horizontal plane (0–1): a cedar's flat tiers. */
  planar?: number;
}

export interface Species {
  name: string;
  levels: Level[];
  leaves: { kind: LeafKind; count: number; size: number; variance: number; angle: number; start: number; flat?: boolean };
  /** Bark colour (linear) and its fissure depth (0 smooth – 1 deep). */
  bark: { colour: [number, number, number]; fissure: number };
}

export interface TreeGeometry {
  wood: { position: number[]; normal: number[]; uv: number[]; index: number[] };
  leaves: { position: number[]; normal: number[]; uv: number[]; root: number[]; shade: number[]; index: number[] };
  /** Crown bounds (for placement clearances and culling). */
  crown: { centre: [number, number, number]; radius: [number, number, number]; top: number };
  /** Trunk base radius (collision). */
  trunk: number;
}

function random(seed: number): (max?: number, min?: number) => number {
  let s = seed >>> 0;
  return (max = 1, min = 0) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return min + (max - min) * (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

interface Section {
  origin: Vector3;
  q: Quaternion;
  radius: number;
}

interface Job {
  origin: Vector3;
  q: Quaternion;
  length: number;
  radius: number;
  level: number;
  sections: number;
  segments: number;
}

const UP = new Vector3(0, 1, 0);

function lengthShape(shape: Level['shape'], along: number): number {
  if (shape === 'cone') return 1 - along * 0.8;
  if (shape === 'dome') return 0.45 + 0.55 * Math.sin(Math.PI * (0.25 + along * 0.65));
  return 1;
}

export function growTree(sp: Species, seed: number): TreeGeometry {
  const rnd = random(seed);
  const L = sp.levels;
  const last = L.length - 1;
  const wood = { position: [] as number[], normal: [] as number[], uv: [] as number[], index: [] as number[] };
  const leafOrigins: { p: Vector3; q: Quaternion; size: number }[] = [];
  const jobs: Job[] = [{ origin: new Vector3(), q: new Quaternion().setFromEuler(new Euler(rnd(0.04, -0.04), rnd(Math.PI * 2), rnd(0.04, -0.04))), length: L[0].length, radius: L[0].radius, level: 0, sections: L[0].sections, segments: L[0].segments }];
  const v = new Vector3();
  const tq = new Quaternion();
  while (jobs.length) {
    const job = jobs.shift()!;
    const lv = L[job.level];
    const sections: Section[] = [];
    const q = job.q.clone();
    const origin = job.origin.clone();
    const step = job.length / job.sections;
    const base = wood.position.length / 3;
    const wraps = Math.max(1, Math.round(job.radius * 2 * Math.PI / 0.35));
    for (let s = 0; s <= job.sections; s++) {
      let r = job.radius * (1 - lv.taper * (s / job.sections));
      if (s === job.sections && job.level === last) r = 0.002;
      // A ring (the seam duplicated for the UV wrap).
      for (let k = 0; k <= job.segments; k++) {
        const a = (k / job.segments) * Math.PI * 2;
        v.set(Math.cos(a), 0, Math.sin(a)).applyQuaternion(q);
        wood.position.push(origin.x + v.x * r, origin.y + v.y * r, origin.z + v.z * r);
        wood.normal.push(v.x, v.y, v.z);
        wood.uv.push((k / job.segments) * wraps, (s * step) / 0.6);
      }
      sections.push({ origin: origin.clone(), q: q.clone(), radius: r });
      origin.add(v.set(0, step, 0).applyQuaternion(q));
      // Gnarl (stronger on thin wood), twist, tropism.
      const g = Math.max(1, 1 / Math.sqrt(Math.max(r, 0.004) * 10)) * lv.gnarl;
      tq.setFromEuler(new Euler(rnd(g, -g), 0, rnd(g, -g)));
      q.multiply(tq);
      q.multiply(tq.setFromAxisAngle(UP, lv.twist));
      const up = v.set(0, 1, 0).applyQuaternion(q).clone();
      const f = new Vector3(...lv.force).normalize();
      const axis = new Vector3().crossVectors(up, f);
      const sin = axis.length();
      if (sin > 1e-6) {
        axis.divideScalar(sin);
        const full = Math.atan2(sin, up.dot(f));
        const turn = Math.min(lv.strength / Math.max(r * 10, 0.05), full);
        q.premultiply(tq.setFromAxisAngle(axis, turn));
      }
    }
    const ring = job.segments + 1;
    for (let s = 0; s < job.sections; s++) {
      for (let k = 0; k < job.segments; k++) {
        const a = base + s * ring + k;
        wood.index.push(a, a + ring, a + 1, a + 1, a + ring, a + ring + 1);
      }
    }
    const tip = sections[sections.length - 1];
    if (job.level < last) {
      const nl = L[job.level + 1];
      // Continuation from the tip.
      jobs.push({ origin: tip.origin, q: tip.q, length: nl.length * (0.8 + rnd(0.4)), radius: tip.radius, level: job.level + 1, sections: job.sections, segments: Math.max(3, job.segments - 2) });
      // Laterals at stratified slots with permuted azimuths.
      const n = lv.children;
      const offset = rnd();
      const slots = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      for (let i = 0; i < n; i++) {
        const along = nl.start + (i + rnd()) * ((1 - nl.start) / n);
        const at = interpolate(sections, along);
        const az = Math.PI * 2 * (offset + (slots[i] + rnd(0.5, -0.5)) / n);
        const cq = at.q.clone().multiply(tq.setFromAxisAngle(UP, az)).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (nl.angle * Math.PI) / 180 * (0.85 + rnd(0.3))));
        if (nl.planar) {
          // Turn the child's axis toward the horizontal.
          const d = new Vector3(0, 1, 0).applyQuaternion(cq);
          const h = new Vector3(d.x, 0, d.z);
          if (h.lengthSq() > 1e-6) {
            h.normalize();
            const target = d.clone().lerp(h, nl.planar).normalize();
            cq.premultiply(new Quaternion().setFromUnitVectors(d, target));
          }
        }
        jobs.push({ origin: at.origin, q: cq, length: nl.length * lengthShape(lv.shape, along) * (0.8 + rnd(0.4)), radius: nl.radius * at.radius, level: job.level + 1, sections: nl.sections, segments: nl.segments });
      }
    } else {
      // Leaves along the final branch, and one at its tip.
      const n = sp.leaves.count;
      for (let i = 0; i < n; i++) {
        const along = sp.leaves.start + (i + rnd()) * ((1 - sp.leaves.start) / n);
        const at = interpolate(sections, along);
        const lq = at.q.clone().multiply(tq.setFromAxisAngle(UP, rnd(Math.PI * 2))).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (sp.leaves.angle * Math.PI) / 180));
        leafOrigins.push({ p: at.origin, q: lq, size: sp.leaves.size * (1 + rnd(sp.leaves.variance, -sp.leaves.variance)) });
      }
      leafOrigins.push({ p: tip.origin, q: tip.q.clone(), size: sp.leaves.size });
    }
  }
  return { wood, ...leafCards(sp, leafOrigins, rnd), trunk: L[0].radius };
}

function interpolate(sections: Section[], along: number): Section {
  const s = along * (sections.length - 1);
  const i = Math.min(Math.floor(s), sections.length - 2);
  const t = s - i;
  const a = sections[i];
  const b = sections[i + 1];
  return { origin: a.origin.clone().lerp(b.origin, t), q: a.q.clone().slerp(b.q, t), radius: a.radius + (b.radius - a.radius) * t };
}

function leafCards(sp: Species, origins: { p: Vector3; q: Quaternion; size: number }[], rnd: () => number): Pick<TreeGeometry, 'leaves' | 'crown'> {
  const leaves = { position: [] as number[], normal: [] as number[], uv: [] as number[], root: [] as number[], shade: [] as number[], index: [] as number[] };
  // The crown: centroid and per-axis spread of the leaf origins.
  const c = new Vector3();
  for (const o of origins) c.add(o.p);
  c.divideScalar(Math.max(origins.length, 1));
  const rad = new Vector3();
  let top = -Infinity;
  let bottom = Infinity;
  for (const o of origins) {
    rad.x = Math.max(rad.x, Math.abs(o.p.x - c.x));
    rad.y = Math.max(rad.y, Math.abs(o.p.y - c.y));
    rad.z = Math.max(rad.z, Math.abs(o.p.z - c.z));
    top = Math.max(top, o.p.y);
    bottom = Math.min(bottom, o.p.y);
  }
  const [u0, v0, u1, v1] = tileUV(sp.leaves.kind);
  const d = new Vector3();
  const corner = new Vector3();
  const n = new Vector3();
  for (const o of origins) {
    // Crown depth: 0 at the crown's surface, 1 at its middle; lower leaves see less of the sky.
    d.copy(o.p).sub(c);
    const ex = d.x / Math.max(rad.x, 0.1), ey = d.y / Math.max(rad.y, 0.1), ez = d.z / Math.max(rad.z, 0.1);
    const depth = Math.max(0, 1 - Math.sqrt(ex * ex + ey * ey + ez * ez));
    const height = (o.p.y - bottom) / Math.max(top - bottom, 0.1);
    const shade = (1 - 0.55 * Math.pow(depth, 0.8)) * (0.65 + 0.35 * Math.sqrt(height));
    const out = d.lengthSq() > 1e-6 ? d.clone().normalize() : UP.clone();
    const cards = sp.leaves.flat ? [0] : [0, Math.PI / 2];
    // Flat (cedar) sprays lie in the horizontal plane, turned at random about the vertical.
    const q = sp.leaves.flat ? new Quaternion().setFromAxisAngle(UP, rnd() * Math.PI * 2).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2 + (rnd() - 0.5) * 0.3)) : o.q;
    for (const rot of cards) {
      const base = leaves.position.length / 3;
      const s = o.size;
      const local: [number, number][] = [[-0.5, 1], [-0.5, 0], [0.5, 0], [0.5, 1]];
      const uvs: [number, number][] = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
      n.set(0, 0, 1).applyAxisAngle(UP, rot).applyQuaternion(q);
      // Rounded normal: the card's own blended with the crown's outward direction (and a lift toward the sky).
      const rn = n.clone().multiplyScalar(n.dot(out) < 0 ? -0.35 : 0.35).add(out).add(new Vector3(0, 0.25, 0)).normalize();
      for (let k = 0; k < 4; k++) {
        corner.set(local[k][0] * s, local[k][1] * s, 0).applyAxisAngle(UP, rot).applyQuaternion(q).add(o.p);
        leaves.position.push(corner.x, corner.y, corner.z);
        leaves.normal.push(rn.x, rn.y, rn.z);
        leaves.uv.push(uvs[k][0], uvs[k][1]);
        leaves.root.push(o.p.x, o.p.y, o.p.z);
        leaves.shade.push(shade * (0.92 + rnd() * 0.16));
      }
      leaves.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { leaves, crown: { centre: [c.x, c.y, c.z], radius: [rad.x, rad.y, rad.z], top } };
}
