import { describe, expect, it } from 'vitest';
import { buildShipParts } from '../src/intro/ship/ship';
import { SHIP_SLOTS } from '../src/intro/ship/slots';
import { convexFaces } from '../src/geometry/convex';
import { v3, type Vec3 } from '../src/geometry/polyMesh';
import { HULL_BEVELLED } from '../src/intro/ship/hull';
import { NACELLE_PLANES } from '../src/intro/ship/nacelle';
import { Matrix4, Vector3 } from 'three/webgpu';
import { actuatorLengths, buildLeg, COMPRESSION, LEGS, poseLeg, shockLengths, WELL_DEPTH } from '../src/intro/ship/gear';
import { assemblyAudit, describeTopology, topologyFailures } from './geometryGate';

/**
 * The intro's ship: every fixed part closed and outward, and in the assembly no coplanar overlap
 * and no clash beyond the declared seats (parts buried in what carries them).
 */
const ALLOW: [string, string][] = [
  // The pods' wings and fins are buried in the body and the pods; the pods in the body's sides.
  ['ship:wing-s', 'ship:hull'],
  ['ship:wing-p', 'ship:hull'],
  ['ship:wing-s', 'ship:nacelle-s'],
  ['ship:wing-p', 'ship:nacelle-p'],
  ['ship:fin-s', 'ship:nacelle-s'],
  ['ship:fin-p', 'ship:nacelle-p'],
  // The bells sit in the pods' throats; the cores in the bells.
  ['ship:bell-s', 'ship:nacelle-s'],
  ['ship:bell-p', 'ship:nacelle-p'],
  ['ship:core-s', 'ship:bell-s'],
  ['ship:core-p', 'ship:bell-p'],
  // The door's track fairing is set into the hull's side.
  ['ship:door-fairing', 'ship:hull'],
  // The threshold runs through the door's opening into the hull's skin.
  ['ship:threshold', 'ship:hull'],
  // Fittings seated in what carries them: switches, keys, levers, displays, handles, posts.
  ['ship:overhead', 'ship:set:overhead-switches'],
  ['ship:overhead', 'ship:overhead-display'],
  ['ship:dash', 'ship:set:dash-keys'],
  ['ship:dash', 'ship:display-bezel-0'],
  ['ship:dash', 'ship:display-bezel-1'],
  ['ship:dash', 'ship:display-bezel-2'],
  ['ship:display-bezel-0', 'ship:display-0'],
  ['ship:display-bezel-1', 'ship:display-1'],
  ['ship:display-bezel-2', 'ship:display-2'],
  ['ship:throttle-quadrant', 'ship:set:throttle-levers'],
  ['ship:hatch-leaf', 'ship:hatch-handle'],
  ['ship:footrest', 'ship:footrest-bracket-s'],
  ['ship:footrest', 'ship:footrest-bracket-p'],
  ['ship:seat-back-shell', 'ship:seat-post-s'],
  ['ship:seat-back-shell', 'ship:seat-post-p'],
  ['ship:seat-headrest', 'ship:seat-post-s'],
  ['ship:seat-headrest', 'ship:seat-post-p'],
  ['ship:monitor-housing', 'ship:monitor-glass'],
];

describe('the intro ship', () => {
  const built = buildShipParts();
  const parts = built.list;

  it('every part is a closed outward solid (sets: one per component)', () => {
    const single = topologyFailures(parts.filter((p) => !p.name.includes(':set:')));
    const sets = topologyFailures(parts.filter((p) => p.name.includes(':set:')), { maxComponents: 2000 });
    expect([...single, ...sets], describeTopology([...single, ...sets])).toEqual([]);
  });

  it('no coplanar overlap and no clash beyond declared seats', { timeout: 300_000 }, () => {
    const report = assemblyAudit(parts, SHIP_SLOTS, [...ALLOW, ...built.seats]);
    expect(report.defects, JSON.stringify(report.defects.slice(0, 5))).toEqual([]);
    expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
    expect(report.clash, JSON.stringify(report.clash.map((c) => `${c.a} × ${c.b}`))).toEqual([]);
  });

  it('every fitting on a facet stands wholly on it', () => {
    const faces = { hull: convexFaces(HULL_BEVELLED), nacelle: convexFaces(NACELLE_PLANES) };
    const off: string[] = [];
    for (const fp of built.footprints) {
      const face = faces[fp.body].find((f) => f.plane === fp.plane);
      if (!face) {
        off.push(`${fp.name}: no facet ${fp.plane}`);
        continue;
      }
      const n = (fp.body === 'hull' ? HULL_BEVELLED : NACELLE_PLANES)[fp.plane].n;
      // Inside the facet's loop: on the inner side of every edge (counter-clockwise about n).
      const inside = (p: Vec3) => face.loop.every((a, i) => v3.dot(v3.cross(v3.sub(face.loop[(i + 1) % face.loop.length], a), v3.sub(p, a)), n) >= 0);
      const sign = face.loop.length > 2 && v3.dot(v3.cross(v3.sub(face.loop[1], face.loop[0]), v3.sub(face.loop[2], face.loop[1])), n) > 0;
      const ok = (p: Vec3) => (sign ? inside(p) : face.loop.every((a, i) => v3.dot(v3.cross(v3.sub(face.loop[(i + 1) % face.loop.length], a), v3.sub(p, a)), n) <= 0));
      fp.corners.forEach((c, k) => {
        if (!ok(c)) off.push(`${fp.name} corner ${k} [${c.map((x) => x.toFixed(2))}]`);
      });
    }
    expect(off).toEqual([]);
  });

  it('each leg folds wholly into its well, and stands on its foot', () => {
    const out: string[] = [];
    for (const l of LEGS) {
      const p = buildLeg(l);
      const q = poseLeg(l, 0, 0);
      const posed: [string, { verts: Vec3[] }[], Matrix4][] = [
        ['strut', p.strut, q.strut],
        ['arm', p.arm, q.arm],
        ['foot', p.foot, q.foot],
        ['shock', [p.shockBody], q.shockBody],
        ['shock rod', [p.shockRod], q.shockRod],
        ['actuator', [p.actuatorBody], q.actuatorBody],
        ['actuator rod', [p.actuatorRod], q.actuatorRod],
      ];
      const x0 = l.pivot[0] - l.aft;
      const x1 = l.pivot[0] + l.fore;
      const hz = l.bayHalf + 0.04 + 0.005;
      const y0 = l.skinY + 0.005;
      const y1 = l.skinY + l.wall + WELL_DEPTH;
      for (const [name, meshes, m] of posed) {
        for (const mesh of meshes) for (const v of mesh.verts) {
          const q = new Vector3(...v).applyMatrix4(m);
          if (q.x < x0 || q.x > x1 || Math.abs(q.z - l.pivot[2]) > hz || q.y < y0 || q.y > y1) {
            out.push(`${l.name} ${name} [${q.toArray().map((c) => c.toFixed(3))}]`);
            break;
          }
        }
      }
      // The actuator and the shock span their strokes: body and rod overlap at the longest reach, the rod fits the shortest.
      for (const [name, st] of [['actuator', actuatorLengths(l)], ['shock', shockLengths(l)]] as const) {
        if (st.body + st.rod < Math.max(...st.reach) + 0.04 || st.rod > Math.min(...st.reach)) out.push(`${l.name} ${name} stroke`);
      }
      // On the ground at rest, the foot's sole is on it.
      const sole = new Vector3(0, -0.14, 0).applyMatrix4(poseLeg(l, 1, COMPRESSION).foot);
      if (Math.abs(sole.y - l.ground) > 1e-6) out.push(`${l.name} foot off the ground: ${sole.y}`);
    }
    expect(out).toEqual([]);
  });
});
