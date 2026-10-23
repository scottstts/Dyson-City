import { describe, expect, it } from 'vitest';
import { auditMeshData } from '../tools/geometry-kit/mesh-topology-audit.js';
import { convexFaces, convexSolid, facetedShell, planeAt, withBevels, type HalfSpace } from '../src/geometry/convex';
import { signedVolume } from '../src/geometry/solids';

const box = (hx: number, hy: number, hz: number): HalfSpace[] => [
  planeAt([1, 0, 0], [hx, 0, 0]),
  planeAt([-1, 0, 0], [-hx, 0, 0]),
  planeAt([0, 1, 0], [0, hy, 0]),
  planeAt([0, -1, 0], [0, -hy, 0]),
  planeAt([0, 0, 1], [0, 0, hz]),
  planeAt([0, 0, -1], [0, 0, -hz]),
];

describe('faceted solids', () => {
  it('builds a closed polyhedron from planes, a redundant plane making no face', () => {
    const faces = convexFaces([...box(1, 2, 3), planeAt([1, 0, 0], [5, 0, 0])]);
    expect(faces.length).toBe(6);
    const solid = convexSolid(box(1, 2, 3), () => 0);
    expect(auditMeshData(solid, { closed: true, maxComponents: 1 }).ok).toBe(true);
    expect(signedVolume(solid)).toBeCloseTo(48, 6);
  });

  it('chamfers every edge, corners resolving themselves', () => {
    const planes = withBevels(box(1, 1, 1), () => 0.1);
    expect(planes.length).toBe(6 + 12);
    const solid = convexSolid(planes, () => 0);
    expect(auditMeshData(solid, { closed: true, maxComponents: 1 }).ok).toBe(true);
    // Each chamfer is 0.1 wide: it removes a prism of cross-section 0.05² / 2 · 2 per edge.
    expect(signedVolume(solid)).toBeLessThan(8);
    expect(signedVolume(solid)).toBeGreaterThan(8 - 12 * 2 * 0.0025);
  });

  it('pierces a shell with openings through both skins as one closed solid', () => {
    const planes = withBevels(box(3, 2, 2), () => 0.08);
    const shell = facetedShell(planes, 0.1, {
      slot: (_p, skin) => (skin === 'outer' ? 0 : 1),
      apertures: [
        { plane: 4, centre: [0, 0, 2], u: [1, 0, 0], hw: 1, hh: 0.8, r: 0.2, slot: 2 },
        { plane: 0, centre: [3, 0.5, 0], u: [0, 0, 1], hw: 0.6, hh: 0.4, r: 0.1, slot: 2 },
      ],
    });
    const report = auditMeshData(shell, { closed: true, maxComponents: 1 });
    expect(report.issues).toEqual([]);
    const solidVolume = 6 * 4 * 4 - 5.8 * 3.8 * 3.8;
    expect(signedVolume(shell)).toBeGreaterThan(0);
    expect(signedVolume(shell)).toBeLessThan(solidVolume);
  });

  it('refuses an opening that leaves its face', () => {
    expect(() => facetedShell(box(1, 1, 1), 0.1, { slot: () => 0, apertures: [{ plane: 4, centre: [0, 0, 1], u: [1, 0, 0], hw: 1.2, hh: 0.3, r: 0.1, slot: 0 }] })).toThrow();
  });
});
