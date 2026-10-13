/**
 * Ground meshes: the revolved Garden Deck platform (top, rounded nosings, treads, risers) and the
 * concave Girdle deck annulus around it.
 *
 * The platform profile is a set of smooth strips; strips meet only at concave (hard) corners, so
 * every convex arris is a real 15 mm radius with continuous normals and every concave corner is a
 * crisp seam. The bottom riser sinks below the deck and the deck's inner edge tucks under the
 * bottom step: no gaps, no coplanar faces.
 */
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three/webgpu';
import { SHELL_RADIUS_M } from '../world/constants';
import { SITE, PAD_HEIGHT, PAD_OUTER_RADIUS, deckHeight } from './site';

export interface ProfileVertex {
  r: number;
  y: number;
  nr: number;
  ny: number;
}

/** A convex quarter-round from horizontal (top, normal +y) to vertical (riser, normal +r). */
function nosing(rEdge: number, yTop: number, radius: number, segments = 6): ProfileVertex[] {
  const out: ProfileVertex[] = [];
  const cr = rEdge - radius;
  const cy = yTop - radius;
  for (let i = 0; i <= segments; i++) {
    const a = (Math.PI / 2) * (1 - i / segments);
    out.push({ r: cr + radius * Math.cos(a), y: cy + radius * Math.sin(a), nr: Math.cos(a), ny: Math.sin(a) });
  }
  return out;
}

/** Smooth strips of the platform cross-section, from the centre outward. */
export function platformProfile(): ProfileVertex[][] {
  const strips: ProfileVertex[][] = [];
  const rho = SITE.nosingRadius;
  for (let k = 0; k < SITE.stepCount; k++) {
    const yTop = PAD_HEIGHT - k * SITE.stepRise;
    const rStart = k === 0 ? 0 : SITE.padRadius + (k - 1) * SITE.stepTread;
    const rEdge = SITE.padRadius + k * SITE.stepTread;
    const yBottom = k === SITE.stepCount - 1 ? -SITE.riserSink : yTop - SITE.stepRise;
    const strip: ProfileVertex[] = [];
    if (k === 0) {
      for (const r of [0, 2, 8, 24, 60, 120, 200, 290, 380, 450, 490]) strip.push({ r, y: yTop, nr: 0, ny: 1 });
    } else {
      strip.push({ r: rStart, y: yTop, nr: 0, ny: 1 });
    }
    strip.push(...nosing(rEdge, yTop, rho));
    strip.push({ r: rEdge, y: yBottom, nr: 1, ny: 0 });
    strips.push(strip);
  }
  return strips;
}

/** Revolves profile strips about +Y. Vertex at r = 0 becomes a fan apex. */
export function revolve(strips: ProfileVertex[][], segments: number): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const strip of strips) {
    const base = positions.length / 3;
    const cols = segments + 1;
    for (const v of strip) {
      for (let s = 0; s <= segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        positions.push(v.r * c, v.y, -v.r * sn);
        normals.push(v.nr * c, v.ny, -v.nr * sn);
      }
    }
    for (let i = 0; i < strip.length - 1; i++) {
      const apex = strip[i].r === 0;
      for (let s = 0; s < segments; s++) {
        const a = base + i * cols + s;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        // Counter-clockwise seen from the outward/upward side.
        if (apex) indices.push(a, c, d);
        else indices.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setIndex(new Uint32BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  return g;
}

export function createPlatformGeometry(segments = 2048): BufferGeometry {
  const g = revolve(platformProfile(), segments);
  g.name = 'garden-deck-platform';
  return g;
}

/**
 * Concave deck annulus from just under the bottom step to the outer radius. Rings are spaced
 * geometrically (constant relative resolution); normals point at the sphere centre; a tangent
 * along +X (east) carries the plating's anisotropy frame.
 */
export function createDeckGeometry(rings = 170, segments = 1024): BufferGeometry {
  const r0 = PAD_OUTER_RADIUS - 0.02;
  const r1 = SITE.deckOuterRadius;
  const positions: number[] = [];
  const normals: number[] = [];
  const tangents: number[] = [];
  const indices: number[] = [];
  const R = SHELL_RADIUS_M;
  for (let i = 0; i <= rings; i++) {
    const r = r0 * Math.pow(r1 / r0, i / rings);
    const y = deckHeight(r);
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const x = r * Math.cos(a);
      const z = -r * Math.sin(a);
      positions.push(x, y, z);
      // Toward the sphere centre (0, R, 0).
      const nx = -x;
      const ny = R - y;
      const nz = -z;
      const len = Math.hypot(nx, ny, nz);
      normals.push(nx / len, ny / len, nz / len);
      tangents.push(1, 0, 0, 1);
    }
  }
  const cols = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * cols + s;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('tangent', new Float32BufferAttribute(tangents, 4));
  g.setIndex(new Uint32BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  g.name = 'girdle-deck';
  return g;
}
