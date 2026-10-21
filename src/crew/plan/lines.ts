/**
 * The Linewalkers' line and the Hands' high walks (docs/crew.md, "Lines and decks").
 *
 *  - The square main's cryogen supply line (network.ts) is a smooth closed tube on the viaduct's
 *    back, with nothing on its top: the Linewalkers ride it. Each has a stretch of its own (they
 *    never meet), clear of the manifolds where the Meridian trunks join (which enclose the line)
 *    and of where the main crosses the craft corridor.
 *  - Two Hands walk the Cordon's deck, each on one run of the wall between its pylons; two walk
 *    the gallery rings of the Stills and the Reckoner.
 */
import { CORDON, CORDON_PLAN, CORRIDOR, FIELD_Y, rackLines } from '../../field/layout';
import { CORDON_SECTION } from '../../field/cordon';
import { lineLift, route, VIADUCT_LINES, type ViaductPath } from '../../field/network';
import { clusterPlans } from '../../field/heroes/towers';
import type { Vec3 } from '../../geometry/polyMesh';

/** The supply line's centreline on the square main: a point and tangent at arc length s. */
export interface Line {
  length: number;
  at(s: number, out: Vec3): Vec3;
  tangent(s: number, out: Vec3): Vec3;
}

export function supplyLine(): Line {
  const pa: ViaductPath = route(rackLines().find((l) => l.name === 'main')!);
  const vl = VIADUCT_LINES.find((l) => l.from === 'supply')!;
  const lift = lineLift(vl.r);
  const n = pa.p.length;
  // Arc lengths of the offset line (the main's samples, moved across by the line's offset).
  const pts = pa.p.map((p, i) => [p[0] + pa.n[i][0] * vl.off, p[1] + pa.n[i][1] * vl.off] as [number, number]);
  const s: number[] = [0];
  for (let i = 1; i <= n; i++) s.push(s[i - 1] + Math.hypot(pts[i % n][0] - pts[i - 1][0], pts[i % n][1] - pts[i - 1][1]));
  const L = s[n];
  const y = FIELD_Y + pa.y(0) + lift;
  const seg = (sv: number): [number, number] => {
    const u = ((sv % L) + L) % L;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid] <= u) lo = mid;
      else hi = mid;
    }
    return [lo, (u - s[lo]) / Math.max(1e-9, s[lo + 1] - s[lo])];
  };
  return {
    length: L,
    at(sv, out) {
      const [i, f] = seg(sv);
      const a = pts[i];
      const b = pts[(i + 1) % n];
      out[0] = a[0] + (b[0] - a[0]) * f;
      out[1] = y;
      out[2] = a[1] + (b[1] - a[1]) * f;
      return out;
    },
    tangent(sv, out) {
      const [i] = seg(sv);
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      out[0] = (b[0] - a[0]) / d;
      out[1] = 0;
      out[2] = (b[1] - a[1]) / d;
      return out;
    },
  };
}

/** Where on the supply line no crawler may be: the manifolds and the corridor's crossing. */
export function lineKeepouts(): [number, number][] {
  const out: [number, number][] = [];
  for (const l of rackLines()) {
    if (l.name !== 'trunk-n' && l.name !== 'trunk-s') continue;
    const e = l.pts[l.pts.length - 1];
    out.push([e[0], e[1]]);
  }
  return out;
}

export interface Stretch {
  s0: number;
  s1: number;
}

/** n stretches round the line, each ending 10 m short of a keep-out or its neighbour. */
export function lineStretches(line: Line, n: number): Stretch[] {
  const bad = (p: Vec3) => {
    if (lineKeepouts().some(([x, z]) => Math.hypot(p[0] - x, p[2] - z) < 12)) return true;
    if (p[0] > CORRIDOR.x0 - 10 && Math.abs(p[2]) < CORRIDOR.half + 8) return true;
    return false;
  };
  // Free intervals round the loop, sampled every metre.
  const free: boolean[] = [];
  const p: Vec3 = [0, 0, 0];
  const L = Math.floor(line.length);
  for (let s = 0; s < L; s++) free.push(!bad(line.at(s, p)));
  const runs: [number, number][] = [];
  let start = -1;
  for (let k = 0; k <= L; k++) {
    const f = k < L && free[k];
    if (f && start < 0) start = k;
    if (!f && start >= 0) {
      runs.push([start, k - 1]);
      start = -1;
    }
  }
  // Split the runs into n stretches in proportion to their lengths, a 10 m gap between each.
  const total = runs.reduce((t, r) => t + (r[1] - r[0]), 0);
  const out: Stretch[] = [];
  for (const r of runs) {
    const k = Math.max(1, Math.round((n * (r[1] - r[0])) / total));
    const each = (r[1] - r[0]) / k;
    for (let i = 0; i < k && out.length < n; i++) out.push({ s0: r[0] + each * i + 5, s1: r[0] + each * (i + 1) - 5 });
  }
  return out;
}

/** A walk on a deck: points along it (closed or not), and the deck's height. */
export interface Deck {
  name: string;
  y: number;
  pts: [number, number][];
  closed: boolean;
  /** Where a Hand stops on it to look out, and at what. */
  stops: { at: number; look: Vec3 }[];
}

/** The Cordon's deck: a run's walkway (on the compound's side of the header lines). */
export function cordonDeck(name: string, preferAngle: number): Deck {
  const R = CORDON.r;
  const runs = CORDON_PLAN.runs.filter((r) => r.arc && !r.bridge);
  const mid = (r: (typeof runs)[number]) => (r.arc![0] + r.arc![1]) / 2;
  const run = runs.reduce((a, b) => (Math.abs(mid(a) - preferAngle) < Math.abs(mid(b) - preferAngle) ? a : b));
  const [a0, a1] = run.arc!;
  const from = CORDON_PLAN.pylons[run.from];
  const to = CORDON_PLAN.pylons[run.to];
  // Clear of the pylons' faces (embedded run ends) by 2 m.
  const m0 = a0 + (from.ht * 0.45 + 2) / R;
  const m1 = a1 - (to.ht * 0.45 + 2) / R;
  const b = -1.6;
  const n = Math.max(2, Math.ceil(((m1 - m0) * R) / 3));
  const pts = Array.from({ length: n + 1 }, (_, k) => {
    const a = m0 + ((m1 - m0) * k) / n;
    return [Math.cos(a) * (R + b), Math.sin(a) * (R + b)] as [number, number];
  });
  const y = FIELD_Y + CORDON_SECTION.slab.deck;
  // Stops: at the parapet over the compound, looking in.
  const stops = [0.25, 0.6, 0.85].map((f) => {
    const a = m0 + (m1 - m0) * f;
    return { at: f, look: [Math.cos(a) * (R - 120), FIELD_Y + 20, Math.sin(a) * (R - 120)] as Vec3 };
  });
  return { name, y, pts, closed: false, stops };
}

/** A tower cluster's gallery ring: its walkway's circle and deck height. */
export function galleryDeck(cluster: string): Deck {
  const c = clusterPlans().find((q) => q.name === cluster)!;
  const r = c.rings.find((q) => q.gallery)!;
  const r1 = r.R - r.hr + 0.1;
  const r0 = r1 - 3.2;
  const R = (r0 + r1) / 2;
  const y = c.towers[0].y0 + r.h + r.ha + 0.02;
  const n = Math.ceil((2 * Math.PI * R) / 3);
  const pts = Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    return [c.x + Math.cos(a) * R, c.z + Math.sin(a) * R] as [number, number];
  });
  const stops = [0.1, 0.45, 0.75].map((f) => {
    const a = 2 * Math.PI * f;
    return { at: f, look: [c.x + Math.cos(a) * (R + 200), FIELD_Y + 10, c.z + Math.sin(a) * (R + 200)] as Vec3 };
  });
  return { name: `gallery-${cluster}`, y, pts, closed: true, stops };
}
