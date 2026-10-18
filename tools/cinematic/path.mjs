/**
 * Camera paths for the cinematic shots. A shot is a move between two key poses over its clip;
 * evaluated at u ∈ [0, 1] (and beyond, for the pre-roll that runs the move into the first frame).
 *
 *   { from: Key, to: Key }       Key = { pos: [x, y, z], look: [x, y, z], fov }
 *   { orbit: { centre: [x, z], radius: [r0, r1], angle: [deg0, deg1], height: [y0, y1] },
 *     look: [[x, y, z], [x, y, z]], fov: [f0, f1] }
 *
 * A shot may add `craft: { phase, at }`: the craft's visit is run forward so that it is `at` s into
 * that leg (src/vehicles/craft/flight.ts) at the clip's first frame, then flies in real time.
 *
 * Orbit angles are degrees about +Y from +X toward +Z (0° = east, 90° = south). Motion is linear in
 * time: each clip is a slice of a continuous move, cut in the middle of it, so it neither starts
 * nor stops on screen.
 */
const lerp = (a, b, u) => a + (b - a) * u;
const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
/** Zoom is linear in the image's scale (tan of the half-angle), not in degrees. */
const fovAt = (f0, f1, u) => {
  const t = (f) => Math.tan((f * Math.PI) / 360);
  return (Math.atan(lerp(t(f0), t(f1), u)) * 360) / Math.PI;
};

export function poseAt(shot, u) {
  if (shot.orbit) {
    const o = shot.orbit;
    const a = (lerp(o.angle[0], o.angle[1], u) * Math.PI) / 180;
    const r = lerp(o.radius[0], o.radius[1], u);
    return {
      pos: [o.centre[0] + r * Math.cos(a), lerp(o.height[0], o.height[1], u), o.centre[1] + r * Math.sin(a)],
      look: lerp3(shot.look[0], shot.look[1], u),
      fov: fovAt(shot.fov[0], shot.fov[1], u),
    };
  }
  return { pos: lerp3(shot.from.pos, shot.to.pos, u), look: lerp3(shot.from.look, shot.to.look, u), fov: fovAt(shot.from.fov, shot.to.fov, u) };
}
