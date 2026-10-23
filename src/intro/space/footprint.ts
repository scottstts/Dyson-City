/**
 * Which part of the sphere covers a direction from its centre, seen from outside (docs/intro-space.md).
 * The far structure is the logo modelled as drawn (sky/structure/layout.ts); from outside every
 * part's outer face lies on the shell, so what the eye meets there is decided by the parts'
 * footprints in latitude and longitude alone. The parts and their sizes are the layout's own.
 *
 * Returns the part and the angular distance (rad) to its edge: the coolant headers run inside
 * the edges, and the openings' walls show beside them. The CPU twin (`footprintCPU`) is the
 * shader's reference in tests.
 */
import { Fn, abs, asin, atan, clamp, cos, float, If, max, min, mod, round, select, sin, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { NEAR_MERIDIAN_LONGITUDE, MERIDIAN_SPACING, STRUCTURE as S } from '../../sky/structure/layout';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** Part ids (the footprint's x). */
export const PART = {
  open: 0,
  band: 1,
  hub: 2,
  spine: 3,
  collar: 4,
  pole: 5,
  panel: 6,
  member: 7,
  strut: 8,
} as const;

const HUB_IN = S.hubInner;
const HUB_OUT = S.hubOuter;
const SPINE_HALF = S.spineWidth / 2;
const COLLAR_HALF = S.collarWidth / 2;
const MEMBER_HALF = S.memberWidth / 2;
const POST_HALF = S.postWidth / 2;
const BRACE_HALF = S.braceWidth / 2;
const BAND = S.girdleHalfLatitude;
const POLE = Math.PI / 2 - S.poleRadius;
const WIDE = S.wideHalf;
const SLOT = S.slotHalf;

/** Longitude from the nearest meridian, and whether that meridian has a wide opening. */
function meridianFrame(lon: number): { dl: number; wide: boolean } {
  const rel = lon - NEAR_MERIDIAN_LONGITUDE;
  const k = Math.round(rel / MERIDIAN_SPACING);
  const dl = rel - k * MERIDIAN_SPACING;
  const kk = ((k % 6) + 6) % 6;
  return { dl, wide: kk % 2 === 0 };
}

/** CPU twin: [part, distance to its edge (rad)] at a latitude and longitude (sphere frame, layout.ts). */
export function footprintCPU(lat: number, lon: number): [number, number] {
  const a = Math.abs(lat);
  const { dl, wide } = meridianFrame(lon);
  if (a < BAND) return [PART.band, BAND - a];
  const hub = Math.acos(Math.min(1, Math.cos(lat) * Math.cos(dl)));
  if (hub >= HUB_IN && hub <= HUB_OUT) return [PART.hub, Math.min(hub - HUB_IN, HUB_OUT - hub)];
  const off = Math.abs(Math.cos(lat) * Math.sin(dl));
  if (off < SPINE_HALF && a > S.spineEnd) return [PART.spine, SPINE_HALF - off];
  if (Math.abs(a - S.collarLatitude) < COLLAR_HALF) return [PART.collar, COLLAR_HALF - Math.abs(a - S.collarLatitude)];
  if (a > POLE) return [PART.pole, a - POLE];
  const gap = wide ? WIDE : SLOT;
  const adl = Math.abs(dl);
  if (a >= S.panelLow && a <= S.panelHigh && adl > gap) return [PART.panel, Math.min(a - S.panelLow, S.panelHigh - a, (adl - gap) * Math.cos(lat))];
  if (wide && a > S.panelLow && a < S.panelHigh) {
    for (const m of S.memberLatitudes) if (Math.abs(a - m) < MEMBER_HALF) return [PART.member, MEMBER_HALF - Math.abs(a - m)];
  }
  if (wide && a >= BAND && a <= S.panelLow) {
    const post = Math.abs((adl - WIDE) * Math.cos(lat));
    if (post < POST_HALF) return [PART.strut, POST_HALF - post];
    const line = S.braceFoot + ((WIDE - S.braceFoot) * (a - BAND)) / (S.panelLow - BAND);
    const brace = Math.abs((adl - line) * Math.cos(lat)) * BRACE_SLOPE;
    if (brace < BRACE_HALF) return [PART.strut, BRACE_HALF - brace];
  }
  return [PART.open, 0];
}

/** The braces run diagonally: their width across is the longitude offset times this. */
const BRACE_SLOPE = (() => {
  const dLat = S.panelLow - BAND;
  const dLon = WIDE - S.braceFoot;
  return dLat / Math.hypot(dLat, dLon);
})();

/** Shader: the part covering unit direction q (sphere frame) and the distance to its edge. */
export const footprint = Fn(([q]: [V3]) => {
  const lat = asin(clamp(q.z.negate(), -1, 1));
  const lon = atan(q.x, q.y.negate());
  const a = abs(lat);
  const rel = lon.sub(NEAR_MERIDIAN_LONGITUDE);
  const k = round(rel.div(MERIDIAN_SPACING));
  const dl = rel.sub(k.mul(MERIDIAN_SPACING));
  const kk = mod(mod(k, 6.0).add(6.0), 6.0);
  const wide = mod(kk, 2.0).lessThan(0.5);
  const adl = abs(dl);
  const cl = cos(lat);
  const part = float(PART.open).toVar();
  const edge = float(0).toVar();
  If(a.lessThan(BAND), () => {
    part.assign(PART.band);
    edge.assign(float(BAND).sub(a));
  }).Else(() => {
    const hub = asin(clamp(sinOfAngle(cl.mul(cos(dl))), 0, 1));
    const off = abs(cl.mul(sin(dl)));
    const gap = select(wide, float(WIDE), float(SLOT));
    If(hub.greaterThanEqual(HUB_IN).and(hub.lessThanEqual(HUB_OUT)), () => {
      part.assign(PART.hub);
      edge.assign(min(hub.sub(HUB_IN), float(HUB_OUT).sub(hub)));
    })
      .ElseIf(off.lessThan(SPINE_HALF).and(a.greaterThan(S.spineEnd)), () => {
        part.assign(PART.spine);
        edge.assign(float(SPINE_HALF).sub(off));
      })
      .ElseIf(abs(a.sub(S.collarLatitude)).lessThan(COLLAR_HALF), () => {
        part.assign(PART.collar);
        edge.assign(float(COLLAR_HALF).sub(abs(a.sub(S.collarLatitude))));
      })
      .ElseIf(a.greaterThan(POLE), () => {
        part.assign(PART.pole);
        edge.assign(a.sub(POLE));
      })
      .ElseIf(a.greaterThanEqual(S.panelLow).and(a.lessThanEqual(S.panelHigh)).and(adl.greaterThan(gap)), () => {
        part.assign(PART.panel);
        edge.assign(min(min(a.sub(S.panelLow), float(S.panelHigh).sub(a)), adl.sub(gap).mul(cl)));
      })
      .ElseIf(wide.and(a.greaterThan(S.panelLow)).and(a.lessThan(S.panelHigh)), () => {
        const m = min(abs(a.sub(S.memberLatitudes[0])), abs(a.sub(S.memberLatitudes[1])));
        If(m.lessThan(MEMBER_HALF), () => {
          part.assign(PART.member);
          edge.assign(float(MEMBER_HALF).sub(m));
        });
      })
      .ElseIf(wide.and(a.lessThanEqual(S.panelLow)), () => {
        const post = abs(adl.sub(WIDE).mul(cl));
        const line = float(S.braceFoot).add(a.sub(BAND).mul((WIDE - S.braceFoot) / (S.panelLow - BAND)));
        const brace = abs(adl.sub(line).mul(cl)).mul(BRACE_SLOPE);
        If(post.lessThan(POST_HALF), () => {
          part.assign(PART.strut);
          edge.assign(float(POST_HALF).sub(post));
        }).ElseIf(brace.lessThan(BRACE_HALF), () => {
          part.assign(PART.strut);
          edge.assign(float(BRACE_HALF).sub(brace));
        });
      });
  });
  return vec2(part, edge);
}).setLayout({ name: 'introFootprint', type: 'vec2', inputs: [{ name: 'q', type: 'vec3' }] }) as unknown as (q: V3) => V2;

/** sin of the angle whose cosine is c (the hub's angular radius from cos δ). */
function sinOfAngle(c: F): F {
  return max(float(1).sub(c.mul(c)), 0).sqrt() as unknown as F;
}
