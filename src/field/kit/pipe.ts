/**
 * Process piping as it is built: spools of straight pipe and bends, flanged together. A run is one
 * continuous solid whose section steps out to a flange pair (with a chamfered rim) at every joint,
 * so no flange is a separate ring floating on a pipe. Cryogenic lines are vacuum-jacketed and
 * wrapped in foil; their flanges are bare. Expansion bellows (a corrugated section) sit on long
 * straight runs.
 */
import { v3, type Vec3 } from '../../geometry/polyMesh';
import { arcLengths, filletPath, tube, type TubeRing } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';

export interface PipeOptions {
  /** Pipe (jacket) radius. */
  r: number;
  /** Bend centreline radius (default 3r). */
  bend?: number;
  /** Longest spool between flanges on a straight (default 12 m). */
  spool?: number;
  /** Body slot (default foil) and flange slot (default steel). */
  slot?: number;
  flangeSlot?: number;
  /** Arc lengths (from the start) of expansion bellows. */
  bellows?: number[];
  /** Sides of the section (default by radius). */
  segments?: number;
  /** No flange at the run's two ends (the run ends inside a nozzle or a header). */
  bareEnds?: boolean;
}

/** Sides of a circular section of radius r: enough for a clean silhouette, no more. */
export function sidesFor(r: number): number {
  if (r <= 0.05) return 8;
  if (r <= 0.15) return 12;
  if (r <= 0.4) return 16;
  if (r <= 1.2) return 24;
  return 32;
}

interface Feature {
  s: number;
  kind: 'flange' | 'bellows';
}

/** The run's centreline (filleted) and where its flanges and bellows sit. */
export function pipeLayout(points: Vec3[], o: PipeOptions): { path: Vec3[]; features: Feature[] } {
  const bend = o.bend ?? o.r * 3;
  const spool = o.spool ?? 12;
  // Coincident input points (a run that meets itself) are dropped before filleting.
  const pts = points.filter((p, i) => i === 0 || v3.dist(p, points[i - 1]) > 1e-3);
  // Straights need no rings between their ends (6 m keeps the straight-run detection fine); bends keep their arc samples.
  const path = filletPath(pts, bend, 6, 8);
  // Straight spans of the original polyline, trimmed by the fillet cut at each corner.
  const features: Feature[] = [];
  const s = arcLengths(path);
  const total = s[s.length - 1];
  // Detect straight runs on the sampled path (consecutive collinear samples).
  let runStart = 0;
  const straightRuns: [number, number][] = [];
  for (let i = 1; i < path.length; i++) {
    const last = i === path.length - 1;
    let bendHere = false;
    if (!last) {
      const a = v3.norm(v3.sub(path[i], path[i - 1]));
      const b = v3.norm(v3.sub(path[i + 1], path[i]));
      bendHere = v3.dot(a, b) < 0.99999;
    }
    if (bendHere || last) {
      if (s[i] - s[runStart] > 0.5) straightRuns.push([s[runStart], s[i]]);
      runStart = i;
    }
  }
  const flange = 0.12 + o.r * 0.18;
  for (const [a, b] of straightRuns) {
    const len = b - a;
    const ends = [a + flange, b - flange].filter((x) => x > flange * 1.5 || !o.bareEnds).filter((x) => x < total - flange * 1.5 || !o.bareEnds);
    const inner = Math.max(0, Math.ceil(len / spool) - 1);
    const xs = [...ends];
    for (let k = 1; k <= inner; k++) xs.push(a + (len * k) / (inner + 1));
    for (const x of xs) if (x > flange && x < total - flange) features.push({ s: x, kind: 'flange' });
  }
  for (const x of o.bellows ?? []) features.push({ s: x, kind: 'bellows' });
  features.sort((p, q) => p.s - q.s);
  // Drop features that crowd each other.
  const kept: Feature[] = [];
  for (const f of features) if (!kept.length || f.s - kept[kept.length - 1].s > flange * 4) kept.push(f);
  return { path, features: kept };
}

/** Builds a flanged run along a polyline. */
export function pipeRun(points: Vec3[], o: PipeOptions) {
  const { path, features } = pipeLayout(points, o);
  const slot = o.slot ?? FIELD_SLOT.foil;
  const flangeSlot = o.flangeSlot ?? FIELD_SLOT.steel;
  const r = o.r;
  const rf = r * 1.32 + 0.03;
  const half = 0.06 + r * 0.09;
  const ch = Math.min(0.02 + r * 0.04, half * 0.5);
  // Section profile around a flange joint: (offset along the run, radius, slot of the segment that follows).
  const flangeProfile: [number, number, number][] = [
    [-half - ch * 2, r, flangeSlot],
    [-half - ch, rf - ch, flangeSlot],
    [-half, rf, flangeSlot],
    [-0.004, rf, flangeSlot],
    [-0.004, rf - 0.012, flangeSlot],
    [0.004, rf - 0.012, flangeSlot],
    [0.004, rf, flangeSlot],
    [half, rf, flangeSlot],
    [half + ch, rf - ch, flangeSlot],
    [half + ch * 2, r, slot],
  ];
  const bellowsProfile: [number, number, number][] = [];
  {
    const n = 7;
    const pitch = r * 0.22 + 0.04;
    const len = n * pitch;
    bellowsProfile.push([-len / 2 - 0.05, r, flangeSlot], [-len / 2, r * 1.08, flangeSlot]);
    for (let k = 0; k < n; k++) {
      const x0 = -len / 2 + k * pitch;
      bellowsProfile.push([x0 + pitch * 0.25, r * 1.16, flangeSlot], [x0 + pitch * 0.5, r * 1.08, flangeSlot], [x0 + pitch * 0.75, r * 1.16, flangeSlot], [x0 + pitch, r * 1.08, flangeSlot]);
    }
    bellowsProfile.push([len / 2 + 0.05, r, slot]);
  }
  const s = arcLengths(path);
  const total = s[s.length - 1];
  const pointAt = (x: number): Vec3 => {
    let i = 1;
    while (i < s.length - 1 && s[i] < x) i++;
    const t = (x - s[i - 1]) / Math.max(s[i] - s[i - 1], 1e-9);
    return v3.lerp(path[i - 1], path[i], Math.min(Math.max(t, 0), 1));
  };
  const rings: TubeRing[] = [];
  const slots: number[] = [];
  let f = 0;
  let i = 0;
  const push = (p: Vec3, rr: number, sl: number) => {
    // A ring on top of the last one (same place, same radius) would only add zero-area faces.
    const last = rings[rings.length - 1];
    if (last && v3.dist(last.p, p) < 1e-3 && Math.abs(last.r - rr) < 1e-6) {
      slots[slots.length - 1] = sl;
      return;
    }
    rings.push({ p, r: rr });
    slots.push(sl);
  };
  while (i < path.length) {
    const next = features[f];
    if (next) {
      const prof = next.kind === 'flange' ? flangeProfile : bellowsProfile;
      const start = next.s + prof[0][0];
      if (s[i] >= start - 1e-6) {
        for (const [dx, rr, sl] of prof) push(pointAt(Math.min(Math.max(next.s + dx, 0), total)), rr, sl);
        const end = next.s + prof[prof.length - 1][0];
        while (i < path.length && s[i] <= end + 1e-6) i++;
        f++;
        continue;
      }
    }
    push(path[i], r, slot);
    i++;
  }
  return tube(rings, o.segments ?? sidesFor(r), (k) => slots[k], { capSlot: flangeSlot });
}
