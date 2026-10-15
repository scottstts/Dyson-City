/**
 * The Mast (city_plan.md §5.2): approach and landing control for craft, beside the Halo on the
 * craft corridor's north side. A slender gold spire standing on three white ceramic buttress fins
 * (its tripod), ringed by galleries; a band of phased-array panels; two dish heads on the upper
 * gallery that track each craft in and out, and scan slowly while none is near.
 */
import { Matrix4 } from 'three';
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { basisAlong, box, lathe, tube } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';
import { Parts, type Mover } from '../kit/parts';
import { buildSpire, coreRadius, type SpireSpec } from '../kit/spire';
import { rod } from '../kit/access';
import { FIELD_Y, MAST } from '../layout';

export const MAST_SPIRE: SpireSpec = {
  name: 'sp-mast',
  x: MAST.x,
  z: MAST.z,
  y0: FIELD_Y,
  height: MAST.top,
  r0: 3.4,
  r1: 0.9,
  entasis: 0.1,
  flutes: 9,
  fluteDepth: 0.06,
  fins: 3,
  finReach: MAST.legR,
  finHeight: 38,
  finThickness: 1.4,
  phase: Math.PI / 2,
  rings: [
    { h: 61, R: 7.5, hr: 0.45, ha: 0.55, slot: FIELD_SLOT.ceramic, spokes: 5, gallery: true },
    { h: 95.5, R: 8.2, hr: 0.5, ha: 0.6, slot: FIELD_SLOT.ceramic, spokes: 6, gallery: true },
    { h: 112, R: 3.6, hr: 0.22, ha: 0.28, slot: FIELD_SLOT.chrome, spokes: 4 },
    { h: 125, R: 4.6, hr: 0.35, ha: 0.42, slot: FIELD_SLOT.ceramic, spokes: 4, gallery: true },
    { h: 139, R: 2.4, hr: 0.16, ha: 0.2, slot: FIELD_SLOT.chrome, spokes: 3 },
  ],
};

/** The dish heads: on the 95.5 m gallery, at these angles, scanning about their azimuth. */
export const DISHES = [
  { a: 0.35, r: 3.0, scan: 0.9, period: 173 },
  { a: 0.35 + Math.PI, r: 2.2, scan: 1.2, period: 131 },
] as const;

function dish(R: number): PolyMesh {
  // A parabolic dish (focal length 0.42 D) with a thick rolled rim; front faces +h.
  const f = 0.84 * R;
  const front = (r: number) => (r * r) / (4 * f);
  const prof: Vec2[] = [[0, -0.18]];
  for (let k = 1; k <= 10; k++) {
    const r = (R * k) / 10;
    prof.push([r, front(r) - 0.18 - 0.05 * (k / 10)]);
  }
  prof.push([R + 0.08, front(R) - 0.06], [R + 0.08, front(R) + 0.05], [R, front(R) + 0.04]);
  for (let k = 9; k >= 1; k--) {
    const r = (R * k) / 10;
    prof.push([r, front(r)]);
  }
  prof.push([0, 0]);
  return lathe(prof, 48, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, [FIELD_SLOT.satin, FIELD_SLOT.satin, FIELD_SLOT.satin, FIELD_SLOT.satin, FIELD_SLOT.satin, FIELD_SLOT.satin, FIELD_SLOT.satin, FIELD_SLOT.satin, FIELD_SLOT.satin, FIELD_SLOT.satin, FIELD_SLOT.chrome, FIELD_SLOT.chrome, FIELD_SLOT.chrome, FIELD_SLOT.ceramic, FIELD_SLOT.ceramic, FIELD_SLOT.ceramic, FIELD_SLOT.ceramic, FIELD_SLOT.ceramic, FIELD_SLOT.ceramic, FIELD_SLOT.ceramic, FIELD_SLOT.ceramic, FIELD_SLOT.ceramic, FIELD_SLOT.ceramic], 34);
}

/** A dish head in its own frame: turntable on the deck at the origin, dish looking along +x. */
function dishHead(parts: Parts, name: string, R: number): void {
  const pedestal = 1.1 + R * 0.35;
  const axisY = pedestal + R * 0.55;
  parts.add(`${name}:table`, lathe([[0, -0.03], [1.1, -0.03], [1.1, 0.25], [0.8, 0.4], [0.55, 0.45], [0.5, pedestal], [0, pedestal]], 32, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, FIELD_SLOT.steel));
  // Yoke: two arms from the pedestal head up to the elevation axis either side of the dish.
  const hw = R * 0.55;
  for (const s of [-1, 1]) {
    parts.add(`${name}:arm${s}`, tube([{ p: [0, pedestal - 0.15, s * 0.3], r: 0.22 }, { p: [0, pedestal + 0.4, s * hw * 0.7], r: 0.2 }, { p: [0, axisY, s * (hw + 0.1)], r: 0.17 }], 12, FIELD_SLOT.ceramic));
    parts.add(`${name}:hub${s}`, lathe([[0, -0.2], [0.28, -0.2], [0.28, 0.2], [0, 0.2]], 20, basisAlong([0, axisY, s * (hw + 0.1)], [0, 0, s]), FIELD_SLOT.bronze));
  }
  // Dish (looking along +x, tilted up 8°), its back structure on the elevation axle, the feed.
  const tilt = (8 * Math.PI) / 180;
  const look: Vec3 = [Math.cos(tilt), Math.sin(tilt), 0];
  const o: Vec3 = [0.35, axisY, 0];
  const d = dish(R);
  const b = basisAlong(o, look, [0, 1, 0]);
  d.verts = d.verts.map((p) => v3.add(b.o, v3.add(v3.add(v3.scale(b.u, p[0]), v3.scale(b.v, p[1])), v3.scale(b.w, p[2]))));
  parts.add(`${name}:dish`, d);
  parts.add(`${name}:axle`, tube([{ p: [0.2, axisY, -hw - 0.05], r: 0.12 }, { p: [0.2, axisY, hw + 0.05], r: 0.12 }], 12, FIELD_SLOT.chrome));
  const focus = v3.add(o, v3.scale(look, 0.84 * R));
  parts.add(`${name}:feed`, lathe([[0, -0.25], [0.22, -0.25], [0.3, 0.1], [0.12, 0.35], [0, 0.35]], 16, basisAlong(focus, v3.scale(look, -1)), FIELD_SLOT.chrome));
  for (let k = 0; k < 3; k++) {
    const a = (2 * Math.PI * k) / 3 + 0.4;
    const rim = v3.add(v3.add(o, v3.scale(look, (R * R) / (4 * 0.84 * R) - 0.02)), v3.add(v3.scale(b.u, Math.cos(a) * R * 0.92), v3.scale(b.v, Math.sin(a) * R * 0.92)));
    parts.add(`${name}:strut${k}`, rod(rim, v3.add(focus, v3.scale(look, -0.1)), 0.04, FIELD_SLOT.steel, 6));
  }
}

export interface MastBuild {
  parts: Parts;
  movers: Mover[];
}

export function buildMast(): MastBuild {
  const parts = new Parts('mast');
  buildSpire(parts, MAST_SPIRE);
  const s = MAST_SPIRE;
  // Phased-array band: six flat panels round the core at 80–86 m, each on two brackets.
  const h0 = 80;
  const h1 = 86.5;
  for (let k = 0; k < 6; k++) {
    const a = (2 * Math.PI * k) / 6 + 0.2;
    const d: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    const side: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
    const rc = coreRadius(s, (h0 + h1) / 2) + 0.9;
    const c: Vec3 = [s.x + d[0] * rc, FIELD_Y + (h0 + h1) / 2, s.z + d[2] * rc];
    const lean = 0.17;
    const up: Vec3 = v3.norm([d[0] * -lean, 1, d[2] * -lean]);
    // The panel's back: toward the core.
    const face = v3.cross(side, up);
    parts.add(`array${k}`, box({ o: c, u: side, v: up, w: face }, 1.25, (h1 - h0) / 2, 0.18, 0.04, FIELD_SLOT.black, FIELD_SLOT.black));
    parts.add(`frame${k}`, box({ o: v3.add(c, v3.scale(face, 0.22)), u: side, v: up, w: face }, 1.38, (h1 - h0) / 2 + 0.13, 0.06, 0.02, FIELD_SLOT.gold));
    for (const e of [-1, 1]) {
      const bp = v3.add(c, v3.scale(up, e * (h1 - h0) * 0.3));
      const hb = bp[1] - FIELD_Y;
      const coreP: Vec3 = [s.x + d[0] * (coreRadius(s, hb) - 0.3), bp[1], s.z + d[2] * (coreRadius(s, hb) - 0.3)];
      parts.add(`bracket${k}:${e}`, rod(coreP, v3.add(bp, v3.scale(face, 0.265)), 0.09, FIELD_SLOT.steel, 8));
    }
  }
  // Dish heads on the 95.5 m gallery (movers: they slew in azimuth about their pedestal).
  const ring = s.rings[1];
  const deckY = FIELD_Y + ring.h + ring.ha + 0.04;
  const movers: Mover[] = DISHES.map((dh, k) => {
    const p = new Parts(`mast:dish${k}`);
    dishHead(p, 'head', dh.r);
    const rr = coreRadius(s, ring.h) + (ring.R - ring.hr - coreRadius(s, ring.h)) * 0.55;
    const at: Vec3 = [s.x + Math.cos(dh.a) * rr, deckY - 0.02, s.z + Math.sin(dh.a) * rr];
    const m = new Matrix4();
    const rot = new Matrix4();
    return {
      name: `dish${k}`,
      parts: p.list,
      pose: (t: number, out: Matrix4) => {
        // Looking outward from the mast, slewing ± scan about that.
        const az = -dh.a + dh.scan * Math.sin((2 * Math.PI * t) / dh.period + k);
        m.makeTranslation(at[0], at[1], at[2]).multiply(rot.makeRotationY(az));
        return out.copy(m);
      },
    };
  });
  return { parts, movers };
}
