/**
 * The site plan's data, computed from the source of truth (src/field/layout.ts and the builders'
 * own layouts), bundled for tools/site-plan/sitePlan.mjs so the drawing can never disagree with the
 * build.
 */
import { CORDON, CORDON_PLAN, COMPOUND_R, PAVILIONS, PERIMETER, PRECINCTS, CORRIDOR, COLD_HOLD, CONVERTER, ESTATE, ESTATE_GATEWAY, GATE_COURT, GYRE, HALO, HOUSE_SITE, LANDING_PAD, LOOM, MAST, PLANT, RECKONER, RESONATOR, RING_ROAD, ROAD, ROADS, RING_TRENCH_R, STILLS, rackLines, trenchLines, glassHeightAt } from '../../src/field/layout';
import { portalAngles, ARCH } from '../../src/field/halo';
import { tankLayout } from '../../src/field/heroes/coldHold';
import { radiatorLayout } from '../../src/field/heroes/spires';
import { clusterPlans } from '../../src/field/heroes/towers';
import { towerTop } from '../../src/field/kit/tower';
import { resonatorFrame, PYLON } from '../../src/field/heroes/resonator';
import { YOKE } from '../../src/field/heroes/gyre';
import { CARRIAGE, carriageX } from '../../src/field/heroes/loom';
import { LOCK } from '../../src/city/eastLock/spec';
import { plantLots } from '../../src/field/plant/lots';
import { servicePlan } from '../../src/field/plant/services';
import { PORTAL_ARCH } from '../../src/field/cordon';

export function planData() {
  const { T, N } = resonatorFrame();
  return {
    halo: { r: HALO.r, arches: portalAngles(), archHalf: ARCH.half },
    ringRoad: RING_ROAD,
    road: ROAD,
    roads: ROADS,
    racks: rackLines(),
    pavilions: PAVILIONS,
    precincts: PRECINCTS,
    perimeter: PERIMETER,
    compoundR: COMPOUND_R,
    cordon: { ...CORDON, plan: CORDON_PLAN, portalCrown: PORTAL_ARCH.crown },
    services: (() => {
      const { racks, feeders } = servicePlan();
      return [
        ...racks.map((r) => [[r.hit[0], r.hit[2]], [r.hit[0] + r.d[0] * r.length, r.hit[2] + r.d[2] * r.length]]),
        ...racks.flatMap((r) => r.branches.map((b) => [[b.start[0], b.start[2]], [b.end[0], b.end[2]]])),
        ...feeders.map((f) => [f.start, ...(f.corner ? [f.corner] : []), f.hit].map((p) => [p[0], p[2]])),
      ];
    })(),
    plant: plantLots().map((l) => ({ kind: l.kind, zone: l.zone, x: l.x, z: l.z, sx: l.axis === 0 ? l.L : l.W, sz: l.axis === 0 ? l.W : l.L, H: l.H })),
    trenches: trenchLines(),
    ringTrench: RING_TRENCH_R,
    pad: LANDING_PAD,
    court: GATE_COURT,
    gateway: ESTATE_GATEWAY,
    estate: ESTATE,
    house: HOUSE_SITE,
    corridor: CORRIDOR,
    gyre: { ...GYRE, towerIn: YOKE.towerIn, towerOut: YOKE.towerOut, top: GYRE.centreY + 46 },
    resonator: { ...RESONATOR, T, N, pylonHalf: PYLON.baseHalf },
    loom: { ...LOOM, carriageX: carriageX(0), carriageLen: CARRIAGE.len, carriageTop: CARRIAGE.top },
    hold: { ...COLD_HOLD, tanks: tankLayout().map((t) => ({ x: t.x, z: t.z, R: t.R, top: t.eq + t.R })) },
    mast: MAST,
    plantRegions: PLANT,
    radiators: radiatorLayout().map((s) => ({ x: s.x, z: s.z, r: s.r0, ring: Math.max(...s.rings.map((r) => r.R)), top: s.height * 1.06 })),
    clusters: clusterPlans().map((c) => ({
      name: c.name,
      x: c.x,
      z: c.z,
      podiumR: c.podiumR,
      rings: c.rings.map((r) => ({ R: r.R, h: r.h })),
      towers: c.towers.map((t) => ({ x: t.x, z: t.z, r0: t.r0, lean: t.lean, top: towerTop(t) + c.podiumTop })),
    })),
    lock: { x0: -LOCK.eastX, x1: -LOCK.westX, passageHalf: LOCK.passageHalf, outerHalf: LOCK.outerHalf, top: LOCK.topY, outerLip: -LOCK.outerLipX, innerLip: -LOCK.innerLipX },
    stills: STILLS,
    converter: CONVERTER,
    reckoner: RECKONER,
    glassAt: Array.from({ length: 101 }, (_, i) => glassHeightAt(i * 5)),
  };
}
