import { describe, expect, it } from 'vitest';
import { auditMeshData } from '../tools/geometry-kit/mesh-topology-audit.js';
import { box, boxBetween, extrudeBevel, filletPath, lathe, signedVolume, tube, WORLD, basisAlong } from '../src/geometry/solids';

const ok = (m: Parameters<typeof auditMeshData>[0]) => {
  const r = auditMeshData(m);
  return r.ok ? 'ok' : r.issues.map((i) => i.code).join(',');
};

describe('solid operations', () => {
  it('bevelled extrusions and boxes are closed outward solids', () => {
    const m = extrudeBevel([[0, 0], [4, 0], [4, 1], [2, 3], [0, 1]], WORLD, 0, 2, 0.1);
    expect(ok(m)).toBe('ok');
    expect(signedVolume(m)).toBeGreaterThan(0);
    expect(ok(box(basisAlong([1, 2, 3], [0.3, 1, 0.2]), 1, 2, 3, 0.05))).toBe('ok');
    const b = boxBetween([0, 0, 0], [2, 1, 3], 0.04);
    expect(ok(b)).toBe('ok');
    expect(signedVolume(b)).toBeCloseTo(6, 1);
  });

  it('lathes close at the axis, as loops and as partial sweeps', () => {
    expect(ok(lathe([[0, 0], [1, 0], [1, 2], [0, 2]], 24, WORLD))).toBe('ok');
    const ring = lathe([[2, 0], [3, 0], [3, 1], [2, 1]], 32, WORLD);
    expect(ok(ring)).toBe('ok');
    expect(signedVolume(ring)).toBeGreaterThan(0);
    const part = lathe([[2, 0], [3, 0], [3, 1], [2, 1]], 16, WORLD, 0, 38, 0, Math.PI / 2);
    expect(ok(part)).toBe('ok');
    expect(signedVolume(part)).toBeGreaterThan(0);
  });

  it('tubes along filleted paths (open and closed) are closed outward solids', () => {
    const path = filletPath([[0, 0, 0], [10, 0, 0], [10, 5, 0], [10, 5, 8]], 1.5, 0.5);
    const t = tube(path.map((p, i) => ({ p, r: i % 7 === 0 ? 0.4 : 0.3 })), 16, (i) => i % 2);
    expect(ok(t)).toBe('ok');
    const loop = Array.from({ length: 64 }, (_, i) => ({ p: [Math.cos((i / 64) * 6.283) * 20, Math.sin((i / 64) * 12.566) * 2, Math.sin((i / 64) * 6.283) * 20] as [number, number, number], r: 0.5 }));
    const c = tube(loop, 12, 0, { closed: true });
    expect(ok(c)).toBe('ok');
    expect(signedVolume(c)).toBeGreaterThan(0);
  });
});
