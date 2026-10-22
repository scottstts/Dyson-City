/**
 * The wall plane of an exterior opening's mesh (a window, an outer door or its frame), from its own
 * geometry: which of its faces look into a room, and which way the opening faces.
 *
 * The plane's normal is the mesh's thinnest horizontal axis (a window, a frame or a leaf is thin
 * across its wall, canted bays and the round turret included) and the plane runs through the middle
 * of its depth, signed toward the room. One plane per mesh, over all its primitives.
 *
 * *Rejected:* a plane through each primitive's vertex centroid, square to the way to the nearest
 * room's capture point. The capture sits in the room's middle, up to 44° off the wall's normal, and a
 * casing's centroid lies outside the wall: the plane cut every casing and the front door's leaves in
 * half and lit their outer faces with the room's light (dark smudges across the façade).
 */

export interface OpeningPlane {
  /** A point on the mid-plane (glTF axes, house frame; only x and z matter). */
  cx: number;
  cz: number;
  /** Unit horizontal normal into the room (glTF x, z). */
  dx: number;
  dz: number;
}

/**
 * `hx`: positions (xyz, glTF axes, house frame) of every vertex of the mesh; `room`: a point inside
 * the room it opens into (glTF x, z), for the sign.
 */
export function openingPlane(hx: Float32Array, roomX: number, roomZ: number): OpeningPlane {
  const n = hx.length / 3;
  let mx = 0;
  let mz = 0;
  for (let v = 0; v < n; v++) {
    mx += hx[v * 3];
    mz += hx[v * 3 + 2];
  }
  mx /= n;
  mz /= n;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (let v = 0; v < n; v++) {
    const x = hx[v * 3] - mx;
    const z = hx[v * 3 + 2] - mz;
    sxx += x * x;
    sxz += x * z;
    szz += z * z;
  }
  // Eigenvector of the smaller eigenvalue of [[sxx, sxz], [sxz, szz]]: the thin axis.
  const tr = sxx + szz;
  const det = sxx * szz - sxz * sxz;
  const lmin = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let dx: number;
  let dz: number;
  if (Math.abs(sxz) > 1e-12) {
    dx = lmin - szz;
    dz = sxz;
  } else if (sxx < szz) {
    dx = 1;
    dz = 0;
  } else {
    dx = 0;
    dz = 1;
  }
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  if ((roomX - mx) * dx + (roomZ - mz) * dz < 0) {
    dx = -dx;
    dz = -dz;
  }
  // Through the middle of the depth (not the centroid: casings, hoods and sills weigh outdoors).
  let lo = Infinity;
  let hi = -Infinity;
  for (let v = 0; v < n; v++) {
    const s = (hx[v * 3] - mx) * dx + (hx[v * 3 + 2] - mz) * dz;
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  const mid = (lo + hi) / 2;
  return { cx: mx + dx * mid, cz: mz + dz * mid, dx, dz };
}

/** 1 for a vertex on the room's side of the plane (nudged 5 cm along its normal), else 0. */
export function isIndoor(p: OpeningPlane, x: number, z: number, nx: number, nz: number): number {
  return (x + nx * 0.05 - p.cx) * p.dx + (z + nz * 0.05 - p.cz) * p.dz > 0 ? 1 : 0;
}
