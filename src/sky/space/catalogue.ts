/**
 * The sky beyond the shell, in frame coordinates (structure/spin.ts: Z is the spin axis, −Z the
 * north celestial pole). Everything here keeps the frame's orientation; the observer, riding the
 * band, sees it turn about the north–south axis.
 *
 * What the city can see of it is set by the openings: through the open bands beside the band, from
 * declination ~15° (low in the east and west) up to the poles (low over the north and south
 * horizons); through the wide openings around |dec| ≈ 55°. The equator itself is always behind the
 * band. So the galactic plane is tilted to pass within ~12° of both poles, and the showpiece nebulae
 * sit at |dec| 20°–70°, spread in right ascension so the turning sky carries one past an opening
 * every few minutes.
 *
 * The system sits near the galactic plane in a star-forming complex: large, bright nebulae a few to
 * twenty degrees across. Their brightness is far above physical (a daylight exposure would show
 * nothing beyond the shell) so that the sky outside reads through the air and the openings.
 */

export type V3 = [number, number, number];

const DEG = Math.PI / 180;

/** Unit vector at right ascension α (about Z) and declination δ (north toward −Z). */
export function raDec(ra: number, dec: number): V3 {
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), -Math.sin(dec)];
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Orthonormal tangent frame at c, turned by angle a (radians) about c. */
export function tangentFrame(c: V3, a: number): { e1: V3; e2: V3 } {
  const ref: V3 = Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(ref, c));
  const v = cross(c, u);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return {
    e1: [u[0] * ca + v[0] * sa, u[1] * ca + v[1] * sa, u[2] * ca + v[2] * sa],
    e2: [v[0] * ca - u[0] * sa, v[1] * ca - u[1] * sa, v[2] * ca - u[2] * sa],
  };
}

/** The galaxy: its pole (dec 12°) and centre (on the plane, dec −55°, the bulge low in the south). */
export const GALACTIC_POLE: V3 = raDec(30 * DEG, 12 * DEG);
export const GALACTIC_CENTRE: V3 = (() => {
  // On the plane (⊥ pole) at declination −55°: solve for the right ascension.
  const z = Math.sin(55 * DEG);
  const r = Math.sqrt(1 - z * z);
  const [px, py, pz] = GALACTIC_POLE;
  const k = -(pz * z) / (r * Math.hypot(px, py));
  const phase = Math.atan2(py, px);
  const a = phase + Math.acos(Math.max(-1, Math.min(1, k)));
  return norm([r * Math.cos(a), r * Math.sin(a), z]);
})();

export const NEBULA_KIND = { emission: 0, reflection: 1, dark: 2, remnant: 3, galaxy: 4 } as const;
export type NebulaKind = (typeof NEBULA_KIND)[keyof typeof NEBULA_KIND];

export interface Nebula {
  kind: NebulaKind;
  centre: V3;
  /** Angular radius (rad) of the bounding cap. */
  radius: number;
  e1: V3;
  e2: V3;
  seed: number;
  /** Peak scene radiance of the brightest parts. */
  brightness: number;
}

function nebula(kind: NebulaKind, raDeg: number, decDeg: number, radiusDeg: number, turnDeg: number, seed: number, brightness: number): Nebula {
  const centre = raDec(raDeg * DEG, decDeg * DEG);
  return { kind, centre, radius: radiusDeg * DEG, ...tangentFrame(centre, turnDeg * DEG), seed, brightness };
}

const K = NEBULA_KIND;

/**
 * Showpieces. Dark clouds are taken as the nearest: whatever the order, they absorb the galaxy and
 * every emitting nebula behind them.
 */
export const NEBULAE: readonly Nebula[] = [
  // In the gap left of the band in the first-impression view.
  nebula(K.emission, 15, 48, 20, 20, 11, 0.26),
  // In the gap right of the band in the first-impression view (the first sits left of it).
  nebula(K.emission, 21, -29, 13, -35, 23, 0.24),
  nebula(K.emission, 250, 62, 13, 60, 37, 0.22),
  nebula(K.reflection, 75, 30, 9, 10, 41, 0.1),
  nebula(K.reflection, 205, -60, 11, 80, 53, 0.1),
  nebula(K.remnant, 310, -30, 14, 0, 67, 0.16),
  nebula(K.remnant, 100, 66, 10, 30, 71, 0.14),
  nebula(K.galaxy, 185, 42, 5.5, 38, 83, 0.32),
  nebula(K.dark, 150, -45, 14, 15, 97, 1.6),
  nebula(K.dark, 280, 40, 12, -20, 101, 1.4),
];

/** Angle (rad) between two unit vectors. */
export function angleBetween(a: V3, b: V3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}
