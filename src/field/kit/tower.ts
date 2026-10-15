/**
 * Mega-towers (docs/field.md, "Design language"): the field's tallest buildings, as tall as the
 * Dome allows where they stand. A cluster is a bundle of towers of different heights converging
 * slightly on its centre, on one podium, ringed by great halo rings.
 *
 * A tower:
 *  - its plan is a bundle of lobes (several shafts grown together), cut by vertical ribs; between
 *    the ribs run continuous black glazed slit windows, so the tower reads as inhabited structure
 *    at its true size rather than as a scaled-up ornament;
 *  - it flares at its foot, tapers in a long straight body and draws out into a needle;
 *  - clad in brushed gold (a polished face this tall would only mirror the dark sky; brushing
 *    spreads its lobe up into the star's cap), with white ceramic buttress arches rising from the podium's rim into its flanks.
 * A cluster's halo rings (ceramic or gold) are carried on spokes to the towers, one with a gallery
 * walk and rails: the human-scale cue that tells you how big all of it is.
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { framesFrom, sweep } from '../../geometry/sweep';
import { extrudeBevel, lathe, orientOutward, tube, type Basis } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';
import { ringBody } from './rings';
import { guardRail } from './access';
import type { Parts } from './parts';

export interface TowerSpec {
  name: string;
  /** Foot centre (on the podium top) and lean: the tip's offset from above the foot. */
  x: number;
  z: number;
  y0: number;
  height: number;
  lean: [number, number];
  /** Radius at the foot (above the flare). */
  r0: number;
  lobes: number;
  /** Depth of the lobe valleys (fraction of radius). */
  lobeDepth: number;
  /** Ribs per lobe (each rib bounds a window slit). */
  ribs: number;
  phase: number;
}

export interface ClusterRing {
  h: number;
  R: number;
  hr: number;
  ha: number;
  slot: number;
  gallery?: boolean;
}

export interface ClusterSpec {
  name: string;
  x: number;
  z: number;
  podiumR: number;
  podiumTop: number;
  towers: TowerSpec[];
  rings: ClusterRing[];
  /** Buttress arches per tower (each from the podium's rim into the tower's flank). */
  buttresses: number;
}

/** Radius envelope of a tower at fraction t of its height. */
export function towerRadius(s: TowerSpec, t: number): number {
  const tt = Math.min(1, Math.max(0, t));
  const flare = 1 + 0.22 * Math.exp(-tt * 14);
  const body = 1 - 0.78 * Math.pow(tt, 1.25);
  const needle = tt > 0.8 ? Math.pow(1 - (tt - 0.8) / 0.2, 0.75) : 1;
  return Math.max(s.r0 * 0.012, s.r0 * flare * body * needle);
}

/** Axis point of a tower at fraction t (it leans along a straight line). */
export function towerAxis(s: TowerSpec, t: number): Vec3 {
  return [s.x + s.lean[0] * t, s.y0 + s.height * t, s.z + s.lean[1] * t];
}

/** The tower's shell: lobed, ribbed, slit-windowed; one sweep up its leaning axis. */
export function towerShell(s: TowerSpec): PolyMesh {
  const per = 8;
  const nEdge = s.lobes * s.ribs * per;
  const ts: number[] = [];
  const n = Math.max(48, Math.round(s.height / 2.5));
  for (let i = 0; i <= n; i++) ts.push(Math.pow(i / n, 1.08));
  ts[0] = -0.05 / s.height;
  const pts = ts.map((t) => towerAxis(s, Math.max(t, ts[0])));
  const frames = framesFrom(pts, pts.map(() => [1, 0, 0] as Vec3));
  const slots: number[] = [];
  for (let k = 0; k < nEdge; k++) {
    // Each rib bay: six edges of brushed gold rib, then the two walls of a recessed black slit.
    const j = k % per;
    slots.push(j === 3 || j === 4 ? FIELD_SLOT.black : FIELD_SLOT.satin);
  }
  const prof = (_f: unknown, i: number) => {
    const t = Math.max(0, ts[i]);
    const R = towerRadius(s, t);
    const loop: Vec2[] = [];
    for (let k = 0; k < nEdge; k++) {
      const a = s.phase + (2 * Math.PI * k) / nEdge;
      const lobe = 0.5 * (1 - Math.cos(s.lobes * (a - s.phase)));
      const j = k % per;
      // The slit is recessed a little behind the ribs.
      const slit = j === 4 ? 0.012 : 0;
      const rr = R * (1 - s.lobeDepth * lobe - slit);
      loop.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    return { pts: loop, slots };
  };
  return orientOutward(sweep(frames, prof, { crease: 40, capSlot: FIELD_SLOT.gold }));
}

/**
 * A buttress arch from the podium's rim into a tower's flank: a blade of white ceramic whose
 * underside is a quarter-ellipse (an arch you could walk under), seated 0.5 m into the shell.
 */
export function buttress(c: ClusterSpec, s: TowerSpec, a: number): PolyMesh {
  const out: Vec3 = [Math.cos(a), 0, Math.sin(a)];
  const side: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
  // The blade's foot stays 2.5 m inside the podium's rim along this direction.
  const px = s.x - c.x;
  const pz = s.z - c.z;
  const po = px * out[0] + pz * out[2];
  const Rp = c.podiumR - 2.5;
  const toRim = -po + Math.sqrt(Math.max(0, po * po - (px * px + pz * pz) + Rp * Rp));
  const rBase0 = towerRadius(s, 0.02) * (1 - s.lobeDepth);
  const reach = Math.max(rBase0 + 3, Math.min(toRim, s.r0 * 2.4));
  const H = s.height * 0.24;
  // The axis leans: at the head it has moved this far along the blade.
  const shift = (s.lean[0] * out[0] + s.lean[1] * out[2]) * (H / s.height);
  const rTop = towerRadius(s, H / s.height) * (1 - s.lobeDepth) - 0.5 + shift;
  const rBase = rBase0 - 0.5;
  const b: Basis = { o: [s.x, s.y0, s.z], u: out, v: [0, 1, 0], w: side };
  const outline: Vec2[] = [];
  // Inside the tower, up from the foot to the arch's head.
  outline.push([rTop, H + 1.5], [rBase, -0.02]);
  // The foot of the blade on the podium, then up its outer edge (a long concave sweep) to the head.
  outline.push([reach, -0.02]);
  // The outer edge sweeps up to a blunt head 2 m out from the shell (the bevel needs body there).
  const n = 18;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const h = H * Math.pow(t, 1.6);
    const r = reach + (rTop + 2.5 - reach) * (1 - Math.pow(1 - t, 2.4));
    outline.push([r, h]);
  }
  outline.push([rTop + 1.2, H + 1.5]);
  const w = 0.7 + s.r0 * 0.05;
  return extrudeBevel(outline, b, -w, w, 0.14, FIELD_SLOT.ceramic);
}

function needleTip(s: TowerSpec): PolyMesh {
  const top = towerAxis(s, 1);
  const r = towerRadius(s, 0.995) + 0.15;
  const len = Math.max(6, s.height * 0.04);
  const dir = v3.norm(v3.sub(towerAxis(s, 1), towerAxis(s, 0)));
  const b: Basis = { o: v3.add(top, v3.scale(dir, -1.2)), u: [1, 0, 0], v: [0, 0, 1], w: dir };
  return lathe([[0, 0], [r * 1.4, 0], [r * 1.6, 0.6], [r * 0.9, 1.4], [r * 0.25, len * 0.75], [0, len]], 24, b, FIELD_SLOT.chrome);
}

/** Top of a tower including its needle tip (for the glass clearance). */
export function towerTop(s: TowerSpec): number {
  return s.height + Math.max(6, s.height * 0.04) - 1.2;
}

export function buildCluster(parts: Parts, c: ClusterSpec): void {
  // Podium: two round tiers of dressed ceramic, a black bed band between them.
  const b: Basis = { o: [c.x, c.towers[0].y0 - c.podiumTop, c.z], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] };
  const disc = (r: number, n = 128): Vec2[] => Array.from({ length: n }, (_, k) => [Math.cos((2 * Math.PI * k) / n) * r, Math.sin((2 * Math.PI * k) / n) * r] as Vec2);
  parts.add(`${c.name}:podium:0`, extrudeBevel(disc(c.podiumR), b, -0.02, c.podiumTop * 0.5, 0.08, FIELD_SLOT.ceramic));
  parts.add(`${c.name}:podium:bed`, extrudeBevel(disc(c.podiumR - 1.6), b, c.podiumTop * 0.5 - 0.02, c.podiumTop * 0.5 + 0.16, 0.03, FIELD_SLOT.black));
  parts.add(`${c.name}:podium:1`, extrudeBevel(disc(c.podiumR - 1.8), b, c.podiumTop * 0.5 + 0.14, c.podiumTop, 0.08, FIELD_SLOT.ceramic));
  for (const s of c.towers) {
    parts.add(`${c.name}:${s.name}:shell`, towerShell(s));
    parts.add(`${c.name}:${s.name}:tip`, needleTip(s));
    // Buttresses: a satellite's on its outward side and flanks; the centre's through the gaps between satellites.
    const centre = s === c.towers[0];
    const sats = c.towers.slice(1).map((t) => Math.atan2(t.z - c.z, t.x - c.x)).sort((p, q) => p - q);
    const angles = centre
      ? sats.map((a, k) => (k + 1 < sats.length ? (a + sats[k + 1]) / 2 : (a + sats[0] + 2 * Math.PI) / 2))
      : [-0.9, 0, 0.9].map((d) => Math.atan2(s.z - c.z, s.x - c.x) + d);
    for (const [k, a] of angles.entries()) {
      parts.add(`${c.name}:${s.name}:buttress${k}`, buttress(c, s, a));
    }
  }
  // Halo rings round the cluster, each carried on spokes to every tower it passes.
  c.rings.forEach((r, k) => {
    const y = c.towers[0].y0 + r.h;
    const rb: Basis = { o: [c.x, y, c.z], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] };
    parts.add(`${c.name}:ring${k}`, ringBody({ R: r.R, hr: r.hr, ha: r.ha, b: rb, slot: r.slot, ds: 2 }));
    for (const s of c.towers) {
      const t = r.h / s.height;
      if (t > 0.85) continue;
      const ax = towerAxis(s, t);
      const d = v3.norm([ax[0] - c.x, 0, ax[2] - c.z]);
      const dist = Math.hypot(ax[0] - c.x, ax[2] - c.z);
      const rr = towerRadius(s, t) * (1 - s.lobeDepth) - 0.4;
      if (dist + rr + 2 > r.R) continue;
      // Two spokes per tower, splayed, from inside its shell out to inside the ring.
      for (const e of [-1, 1]) {
        const a = Math.atan2(d[2], d[0]) + e * Math.min(0.5, (towerRadius(s, t) * 0.7) / Math.max(dist, 1) + 0.12);
        const dir: Vec3 = [Math.cos(a), 0, Math.sin(a)];
        const from: Vec3 = [ax[0] + dir[0] * rr, y, ax[2] + dir[2] * rr];
        const to: Vec3 = [c.x + dir[0] * (r.R - r.hr * 0.5), y, c.z + dir[2] * (r.R - r.hr * 0.5)];
        if (v3.dist(from, to) < 1) continue;
        parts.add(`${c.name}:ring${k}:spoke:${s.name}:${e}`, tube([{ p: from, r: r.ha * 0.9 }, { p: v3.lerp(from, to, 0.5), r: r.ha * 0.6 }, { p: to, r: r.ha * 0.5 }], 14, FIELD_SLOT.ceramic));
      }
    }
    if (r.gallery) {
      const r1 = r.R - r.hr + 0.1;
      const r0 = r1 - 3.2;
      const segs = Math.round(r.R * 2.2);
      parts.add(`${c.name}:ring${k}:deck`, lathe([[r0, -0.16], [r1, -0.16], [r1, 0.02], [r0, 0.02]], segs, { o: [c.x, y + r.ha + 0.02, c.z], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, [FIELD_SLOT.steel, FIELD_SLOT.steel, FIELD_SLOT.grating, FIELD_SLOT.steel]));
      for (const rr of [r0 + 0.25, r1 - 0.4]) {
        const rail: Vec3[] = Array.from({ length: segs }, (_, j) => [c.x + Math.cos((2 * Math.PI * j) / segs) * rr, y + r.ha + 0.03, c.z + Math.sin((2 * Math.PI * j) / segs) * rr] as Vec3);
        parts.addSet(`${c.name}:ring${k}:rail${rr === r1 - 0.4 ? 'o' : 'i'}`, guardRail(rail, true));
      }
    }
  });
}

/** Seats a cluster declares: everything of one tower into its shell, spokes into rings, decks on rings. */
export function clusterAllow(zone: string, c: ClusterSpec): [string, string][] {
  const p = `${zone}:${c.name}`;
  return [
    [`${p}:podium:`, `${p}:podium:`],
    [`${p}:t`, `${p}:podium:`],
    ...c.towers.flatMap((s) => [[`${p}:${s.name}:`, `${p}:${s.name}:`] as [string, string]]),
    [`${p}:ring`, `${p}:t`],
    [`${p}:ring`, `${p}:ring`],
  ];
}
