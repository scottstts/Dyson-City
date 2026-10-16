/**
 * The estate's ground surfaces (docs/estate.md "Ground"): one flat (or, on the ramp, sloped) mesh
 * per ground class, triangulated from its region outlines (regions.ts), each region's edge dropped
 * as a short skirt so a step between neighbours (grass proud of gravel, tilth in its kerb) is a
 * face, never a crack. Kerbs and edgings are swept along the outlines:
 *
 *  - every bed (soil) has a limestone kerb round it (city memory: plants grow in kerbed beds);
 *  - gravel and flags are edged in limestone where they meet grass (not where they meet the house,
 *    a bed's kerb, or other paving).
 */
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Uint32BufferAttribute, Vector2 } from 'three/webgpu';
import type { PolyMesh } from '../geometry/polyMesh';
import { GROUND_ORDER, groundLevel, groundShapes, houseFootprint, TERRACE_Y, type GroundClass } from './layout';
import { area, inside, type V2 } from './sdf2';
import type { Region } from './regions';
import { runSweep, roundedProfile } from './kit';
import { ESTATE_SLOT } from './materials/materials';

/** Depth a region's edge drops below its surface. */
const SKIRT = 0.07;

export interface GroundMesh {
  cls: GroundClass;
  geometry: BufferGeometry;
  /** Plain triangles (world) for the walk mesh. */
  position: Float32Array;
  index: Uint32Array;
}

export function groundMeshes(regions: Record<GroundClass, Region[]>): GroundMesh[] {
  const out: GroundMesh[] = [];
  for (const cls of GROUND_ORDER) {
    if (cls === 'void' || cls === 'water') continue;
    const pos: number[] = [];
    const nrm: number[] = [];
    const idx: number[] = [];
    const wpos: number[] = [];
    const widx: number[] = [];
    for (const reg of regions[cls]) {
      const contour = reg.outer.map(([x, z]) => new Vector2(x, z));
      const holes = reg.holes.map((h) => h.map(([x, z]) => new Vector2(x, z)));
      const tris = ShapeUtils.triangulateShape(contour, holes);
      const all = [...reg.outer, ...reg.holes.flat()];
      const base = pos.length / 3;
      const n = cls === 'ramp' ? rampNormal() : [0, 1, 0];
      for (const [x, z] of all) {
        const y = groundLevel(cls, x, z);
        pos.push(x, y, z);
        nrm.push(n[0], n[1], n[2]);
      }
      const up: [number, number, number][] = tris.map(([a, b, c]) => {
        // Face up (+y): the plan cross product (x right, z down) must be negative.
        const [ax, az] = all[a];
        const [bx, bz] = all[b];
        const [cx, cz] = all[c];
        return (bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0 ? [a, c, b] : [a, b, c];
      });
      for (const [a, b, c] of up) idx.push(base + a, base + b, base + c);
      // Skirts: each loop's edge dropped, facing out of the region.
      for (const loop of [reg.outer, ...reg.holes]) {
        const outward = loopOutwardSign(reg, loop);
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i];
          const b = loop[(i + 1) % loop.length];
          const ya = groundLevel(cls, a[0], a[1]);
          const yb = groundLevel(cls, b[0], b[1]);
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const l = Math.hypot(dx, dz) || 1;
          // Left of travel is (−dz, dx); `outward` says whether that points out of the region.
          const nx = (-dz / l) * outward;
          const nz = (dx / l) * outward;
          const k = pos.length / 3;
          pos.push(a[0], ya, a[1], b[0], yb, b[1], b[0], yb - SKIRT, b[1], a[0], ya - SKIRT, a[1]);
          for (let j = 0; j < 4; j++) nrm.push(nx, 0, nz);
          // Wound so the quad faces (nx, nz).
          if (outward > 0) idx.push(k, k + 3, k + 2, k, k + 2, k + 1);
          else idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
        }
      }
      // Walkable copy: the surface only.
      const wb = wpos.length / 3;
      for (const [x, z] of all) wpos.push(x, groundLevel(cls, x, z), z);
      for (const [a, b, c] of up) widx.push(wb + a, wb + b, wb + c);
    }
    if (!idx.length) continue;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    g.setIndex(new Uint32BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    out.push({ cls, geometry: g, position: Float32Array.from(wpos), index: Uint32Array.from(widx) });
  }
  return out;
}

function rampNormal(): [number, number, number] {
  // The ramp rises 1.6 m over its length toward −z.
  const a = groundLevel('ramp', 0, -40);
  const b = groundLevel('ramp', 0, -60);
  const slope = (b - a) / 20;
  const l = Math.hypot(slope, 1);
  return [0, 1 / l, slope / l];
}

/** +1 if the left of a loop's travel points out of its region, else −1. */
function loopOutwardSign(reg: Region, loop: V2[]): number {
  // Probe a little to the left of the longest edge.
  let best = 0;
  let bi = 0;
  for (let i = 0; i < loop.length; i++) {
    const b = loop[(i + 1) % loop.length];
    const l = Math.hypot(b[0] - loop[i][0], b[1] - loop[i][1]);
    if (l > best) {
      best = l;
      bi = i;
    }
  }
  const a = loop[bi];
  const b = loop[(bi + 1) % loop.length];
  const mx = (a[0] + b[0]) / 2 + (-(b[1] - a[1]) / best) * 0.01;
  const mz = (a[1] + b[1]) / 2 + ((b[0] - a[0]) / best) * 0.01;
  const inRegion = inside(reg.outer, mx, mz) && !reg.holes.some((h) => inside(h, mx, mz));
  return inRegion ? -1 : 1;
}

/**
 * Kerb section (centred on the outline), its top 7 cm above the terrace. Path edgings are a
 * shallower, narrower stone (they meet kerbs end-on, so their faces never coincide).
 */
export const KERB = { half: 0.055, top: 0.072, bottom: -0.16 } as const;
export const EDGING = { half: 0.045, top: 0.058, bottom: -0.13 } as const;

function kerbProfile() {
  return { pts: roundedProfile(-KERB.half, KERB.half, TERRACE_Y + KERB.bottom, TERRACE_Y + KERB.top, 0.014, 3) };
}

function edgingProfile() {
  return { pts: roundedProfile(-EDGING.half, EDGING.half, TERRACE_Y + EDGING.bottom, TERRACE_Y + EDGING.top, 0.012, 3) };
}

/**
 * Drops vertices closer than `min` to the previous kept one, and spikes (turns sharper than ~150°,
 * where two regions' contours pinch): either would fold a mitre.
 */
function clean(loop: V2[], min: number, closed: boolean): V2[] {
  let out: V2[] = [loop[0]];
  for (let i = 1; i < loop.length; i++) {
    const a = out[out.length - 1];
    if (Math.hypot(loop[i][0] - a[0], loop[i][1] - a[1]) >= min || (!closed && i === loop.length - 1)) out.push(loop[i]);
  }
  if (closed && out.length > 3) {
    const a = out[out.length - 1];
    if (Math.hypot(out[0][0] - a[0], out[0][1] - a[1]) < min) out.pop();
  }
  for (let pass = 0; pass < 8 && out.length > 3; pass++) {
    const n = out.length;
    const keep = out.filter((b, i) => {
      if (!closed && (i === 0 || i === n - 1)) return true;
      const a = out[(i - 1 + n) % n];
      const c = out[(i + 1) % n];
      const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
      const cos = (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) || 1);
      return cos > -0.87;
    });
    if (keep.length === n) break;
    out = keep;
  }
  return out;
}

/**
 * Kerbs round every bed, edgings along gravel and flags where they meet grass. Returns named
 * parts (sweeps of the kerb section).
 */
export function kerbs(regions: Record<GroundClass, Region[]>): { name: string; mesh: PolyMesh }[] {
  const shapes = groundShapes();
  const classAt = (x: number, z: number): GroundClass => {
    for (const c of GROUND_ORDER) if (shapes[c].sdf(x, z) < 0) return c;
    return 'void';
  };
  const out: { name: string; mesh: PolyMesh }[] = [];
  const kerb = kerbProfile();
  const edging = edgingProfile();
  let n = 0;
  const groups: [GroundClass, (c: GroundClass) => boolean][] = [
    // Beds are kerbed against everything but the house and the walls they meet.
    ['soil', (c) => c !== 'void'],
    // Gravel and flags are edged where they meet grass.
    ['gravel', (c) => c === 'lawn' || c === 'meadow'],
    ['flag', (c) => c === 'lawn' || c === 'meadow'],
  ];
  for (const [cls, wants] of groups) {
    regions[cls].forEach((reg, r) => {
      for (const [j, raw] of [reg.outer, ...reg.holes].entries()) {
        if (Math.abs(area(raw)) < 0.05) continue;
        const loop = clean(raw, 0.04, true);
        const outward = loopOutwardSign(reg, loop);
        // Runs of edge where the outside is what this class is edged against, and not the house.
        const flags = loop.map((a, i) => {
          const b = loop[(i + 1) % loop.length];
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const l = Math.hypot(dx, dz) || 1;
          const mx = (a[0] + b[0]) / 2 + (-dz / l) * outward * 0.15;
          const mz = (a[1] + b[1]) / 2 + (dx / l) * outward * 0.15;
          return wants(classAt(mx, mz)) && houseFootprint.sdf(mx, mz) > 0.3;
        });
        // A gap shorter than a stone is no gap: bridge it.
        bridgeGaps(loop, flags, 0.35);
        const soil = cls === 'soil';
        for (const run of edgeRuns(loop, flags)) {
          if (run.length < 2) continue;
          // Open runs stop a little short at their ends, so two meeting at a junction never overlap.
          if (!run.closed) trimEnds(run.pts, 0.06);
          out.push({ name: `${soil ? 'kerb' : 'edging'}:${cls}:${r}:${j}:${n++}`, mesh: runSweep(run.pts, soil ? kerb : edging, { closed: run.closed, slot: ESTATE_SLOT.limestone }) });
        }
      }
    });
  }
  return out;
}

function bridgeGaps(loop: V2[], flags: boolean[], max: number): void {
  const n = loop.length;
  if (flags.every(Boolean) || !flags.some(Boolean)) return;
  const i = flags.findIndex(Boolean);
  for (let k = 0; k < n; k++) {
    const s = (i + k) % n;
    if (flags[s] || !flags[(s - 1 + n) % n]) continue;
    // A gap starts at s: measure it.
    let len = 0;
    let e = s;
    while (!flags[e] && len <= max) {
      const b = loop[(e + 1) % n];
      len += Math.hypot(b[0] - loop[e][0], b[1] - loop[e][1]);
      e = (e + 1) % n;
    }
    if (len <= max) for (let t = s; t !== e; t = (t + 1) % n) flags[t] = true;
  }
}

function trimEnds(pts: V2[], d: number): void {
  const cut = (a: V2, b: V2): V2 => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = Math.min(d / Math.max(l, 1e-6), 0.45);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  pts[0] = cut(pts[0], pts[1]);
  pts[pts.length - 1] = cut(pts[pts.length - 1], pts[pts.length - 2]);
}

/** Splits a closed loop into runs of consecutive flagged edges (a fully flagged loop stays closed). */
function edgeRuns(loop: V2[], flags: boolean[]): { pts: V2[]; closed: boolean; length: number }[] {
  const n = loop.length;
  if (flags.every(Boolean)) return [{ pts: loop, closed: true, length: n }];
  const start = flags.findIndex((f) => !f);
  const runs: { pts: V2[]; closed: boolean; length: number }[] = [];
  let cur: V2[] | null = null;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (flags[i]) {
      if (!cur) cur = [loop[i]];
      cur.push(loop[(i + 1) % n]);
    } else if (cur) {
      runs.push({ pts: cur, closed: false, length: cur.length });
      cur = null;
    }
  }
  if (cur) runs.push({ pts: cur, closed: false, length: cur.length });
  return runs;
}

