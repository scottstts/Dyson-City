/**
 * The Stand (docs/terminal.md): the car's raised round platform on the Gate Court's north-west
 * corner, where the car was parked, between the gate's passage and the estate's wall: its ramp east
 * down onto the court (toward the Axis Road), its stair toward the gate, its balustrade, and the West
 * Gate terminal on its north rim with the estate behind it. Sized for one car. Single source of truth, in world metres (+X east, +Z south): the geometry, the
 * walls, the car's ground, the star-shade's floor, the tests and the camera read these numbers.
 *
 * Plan angles are directions (cos a, sin a) in (x, z) about the platform's centre. A notch is where
 * a ramp or a stair meets the drum: the round outline is cut on a chord there, so the two solids
 * meet on one plane.
 */
import { FIELD_Y } from '../field/layout';

const deg = Math.PI / 180;

/** The platform: a drum of white ceramic under a dark basalt deck. */
export const STAND = {
  /** Plan centre. */
  cx: -455,
  cz: -26,
  /** Outer radius of the drum: one car, with a walk round it. */
  R: 6.5,
  /** Deck above the pad. */
  H: 0.6,
  /** The drum stands on a recessed black plinth: its height and set-back. */
  plinth: { h: 0.09, inset: 0.045 },
  /** Solids start this far below the pad (hidden), so nothing sits on it face to face. */
  sink: 0.02,
} as const;

/** World height of the deck. */
export const DECK_Y = FIELD_Y + STAND.H;

/** The ramp: east, onto the Gate Court. Width between its cheeks (the car is 5 m across its wheels); the cheeks' width and kerb. */
export const RAMP = {
  angle: 0,
  half: 3.2,
  cheek: 0.25,
  kerb: 0.15,
  /** Its length from the drum's chord to its foot. */
  length: 9,
  /** Parabolic transitions at the foot and the top (m along it): no crest a long car grounds on. */
  transition: 2.5,
  /** The 15 mm lip at the foot, bevelled down to the pad. */
  lip: 0.015,
} as const;

/** The stair: toward the West Gate's passage. Four risers to the deck. */
export const STAIR = {
  angle: 120 * deg,
  half: 1.1,
  cheek: 0.25,
  kerb: 0.15,
  risers: 4,
  rise: STAND.H / 4,
  going: 0.3,
} as const;

/** The balustrade: posts set back from the rim, rail heights over the deck. */
export const RAIL = {
  setback: 0.16,
  height: 1.05,
  /** The infill rods' heights over the deck (or the ramp's surface). */
  rods: [0.2, 0.41, 0.62, 0.83],
  pitch: 1.55,
  post: 0.045,
  newel: 0.07,
  rail: 0.025,
  rod: 0.0065,
} as const;

/** The terminal on the north rim, facing the deck; behind its screen, the estate's wall and trees. */
export const TERMINAL = {
  angle: -90 * deg,
  /** Its base's centre from the platform's centre. */
  r: STAND.R - 0.47,
  /** The balustrade stops this far either side of it (arc length at the rail). */
  gap: 0.86,
  /** The screen: visible size (16:10), its centre's height over the deck, and its tilt back. */
  screen: { w: 1.12, h: 0.7, y: 1.38, tilt: 15 * deg },
  /** Where a walker stands to use it: this far in front of its base, toward the centre. */
  stand: 0.95,
  /** Reach (m, plan) from that spot within which E uses it. */
  reach: 1.1,
} as const;

/** Where the car is parked at the start: on the deck, nose to the ramp, a little off the terminal. */
export const CAR_SPOT = { x: STAND.cx - 0.4, z: STAND.cz + 0.5, yaw: Math.PI / 2 } as const;

export type P2 = [number, number];

/** Unit direction of a plan angle. */
export function dir(a: number): P2 {
  return [Math.cos(a), Math.sin(a)];
}

/** A point at (forward, lateral) from the centre in a notch's frame (lateral is forward turned +90°). */
export function notchPoint(angle: number, forward: number, lateral: number): P2 {
  const [fx, fz] = dir(angle);
  return [STAND.cx + fx * forward - fz * lateral, STAND.cz + fz * forward + fx * lateral];
}

/** A plan point in a notch's frame: (forward, lateral). */
export function toNotch(angle: number, x: number, z: number): P2 {
  const [fx, fz] = dir(angle);
  const dx = x - STAND.cx;
  const dz = z - STAND.cz;
  return [dx * fx + dz * fz, -dx * fz + dz * fx];
}

/** The chord where a notch of outer half-width hw meets the drum: its distance from the centre. */
export function chord(hw: number): number {
  return Math.sqrt(STAND.R * STAND.R - hw * hw);
}

export const RAMP_OUTER = RAMP.half + RAMP.cheek;
export const STAIR_OUTER = STAIR.half + STAIR.cheek;
/** The ramp's chord, its foot (both as distances from the centre along it) and its length. */
export const RAMP_TOP = chord(RAMP_OUTER);
export const RAMP_LENGTH = RAMP.length;
export const RAMP_FOOT = RAMP_TOP + RAMP_LENGTH;
export const STAIR_TOP = chord(STAIR_OUTER);
export const STAIR_FOOT = STAIR_TOP + (STAIR.risers - 1) * STAIR.going;

/** The ramp's grade over its straight run (the transitions ease into and out of it). */
export const RAMP_GRADE = (STAND.H - RAMP.lip) / (RAMP_LENGTH - RAMP.transition);

/**
 * Height of the ramp's running surface over the pad at s metres up it from the foot: the lip, a
 * parabolic transition, the straight grade, a parabolic transition onto the deck.
 */
export function rampRise(s: number): number {
  const L = RAMP_LENGTH;
  const t = RAMP.transition;
  const g = RAMP_GRADE;
  const c = Math.min(Math.max(s, 0), L);
  let h: number;
  if (c < t) h = (g * c * c) / (2 * t);
  else if (c <= L - t) h = g * (c - t / 2);
  else h = STAND.H - RAMP.lip - (g * (L - c) * (L - c)) / (2 * t);
  return RAMP.lip + h;
}

/** Slope of the ramp's surface (rise per metre) at s. */
export function rampSlope(s: number): number {
  const L = RAMP_LENGTH;
  const t = RAMP.transition;
  const g = RAMP_GRADE;
  if (s <= 0 || s >= L) return 0;
  if (s < t) return (g * s) / t;
  if (s <= L - t) return g;
  return (g * (L - s)) / t;
}

/** Height of stair tread k (1 = lowest) over the pad, and the distance of its nosing from the centre. */
export function stairTread(k: number): { y: number; front: number } {
  return { y: k * STAIR.rise, front: STAIR_TOP + (STAIR.risers - k) * STAIR.going };
}

/** The drum's plan outline (counter-clockwise in x, z), cut on the ramp's and the stair's chords. */
export function standOutline(segments = 240): P2[] {
  const R = STAND.R;
  const notches = [
    { a: RAMP.angle, hw: RAMP_OUTER },
    { a: STAIR.angle, hw: STAIR_OUTER },
  ].map((n) => ({ ...n, beta: Math.asin(n.hw / R) }));
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Uniform samples off the notches, plus each notch's two chord ends: consecutive in angle, so
  // the edge between them is the chord.
  const angles: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    // Clear of each notch by half a step, so no sample crowds a chord's end.
    if (notches.some((n) => Math.abs(wrap(a - n.a)) < n.beta + Math.PI / segments)) continue;
    angles.push(a);
  }
  for (const n of notches) angles.push(norm(n.a - n.beta), norm(n.a + n.beta));
  angles.sort((p, q) => p - q);
  return angles.map((a) => [STAND.cx + R * Math.cos(a), STAND.cz + R * Math.sin(a)] as P2);
}

/** Angle wrapped to (−π, π]. */
export function wrap(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Is a plan point on the drum's deck (inside its cut outline)? */
export function onDeck(x: number, z: number): boolean {
  const dx = x - STAND.cx;
  const dz = z - STAND.cz;
  if (dx * dx + dz * dz > STAND.R * STAND.R) return false;
  const [fr] = toNotch(RAMP.angle, x, z);
  if (fr > RAMP_TOP) return false;
  const [fs] = toNotch(STAIR.angle, x, z);
  return fs <= STAIR_TOP;
}

/**
 * The surface a wheel or a foot meets at a plan point, as a height over the world (the deck, the
 * ramp's running surface, a stair's tread), or null off the Stand. The ramp's cheeks and kerbs are
 * not in it: the car is kept between them by its walls, the walker by the walk mesh.
 */
export function standHeight(x: number, z: number): number | null {
  if (onDeck(x, z)) return DECK_Y;
  const [f, l] = toNotch(RAMP.angle, x, z);
  if (f > RAMP_TOP - 1e-6 && f <= RAMP_FOOT && Math.abs(l) <= RAMP_OUTER) return FIELD_Y + rampRise(RAMP_FOOT - f);
  const [fs, ls] = toNotch(STAIR.angle, x, z);
  if (fs > STAIR_TOP - 1e-6 && fs <= STAIR_FOOT && Math.abs(ls) <= STAIR_OUTER) {
    const k = STAIR.risers - 1 - Math.floor((fs - STAIR_TOP) / STAIR.going);
    return FIELD_Y + Math.max(1, Math.min(STAIR.risers - 1, k)) * STAIR.rise;
  }
  return null;
}

/** The ground a car's wheel meets: the Stand where it is, else the pad. */
export function carGround(x: number, z: number): number {
  const [f, l] = toNotch(RAMP.angle, x, z);
  if (f > RAMP_TOP - 1e-6 && f <= RAMP_FOOT && Math.abs(l) <= RAMP.half + 0.02) return FIELD_Y + rampRise(RAMP_FOOT - f);
  return onDeck(x, z) ? DECK_Y : FIELD_Y;
}

/** The rail's radius (post centres) round the deck. */
export const RAIL_R = STAND.R - RAIL.setback;

/** A newel's plan angle where the rail meets a notch's side at lateral offset q. */
export function newelAngle(notch: number, q: number): number {
  return notch + Math.asin(q / RAIL_R);
}

/** The ramp's and the stair's side rails stand on their cheeks' centre lines. */
export const RAMP_RAIL_Q = RAMP.half + RAMP.cheek / 2;
export const STAIR_RAIL_Q = STAIR.half + STAIR.cheek / 2;

export type RailEnd = 'ramp' | 'stair' | 'terminal';

/**
 * The balustrade's runs round the deck as plan-angle intervals [from, to] (increasing), each ending
 * on a newel at a gap: the ramp's, the stair's, the terminal's. Each run says what its ends meet.
 */
export function railRuns(): { a0: number; a1: number; from: RailEnd; to: RailEnd }[] {
  const tHalf = TERMINAL.gap / RAIL_R;
  const gaps: { kind: RailEnd; a0: number; a1: number }[] = [
    { kind: 'ramp', a0: newelAngle(RAMP.angle, -RAMP_RAIL_Q), a1: newelAngle(RAMP.angle, RAMP_RAIL_Q) },
    { kind: 'stair', a0: newelAngle(STAIR.angle, -STAIR_RAIL_Q), a1: newelAngle(STAIR.angle, STAIR_RAIL_Q) },
    { kind: 'terminal', a0: TERMINAL.angle - tHalf, a1: TERMINAL.angle + tHalf },
  ];
  // Unwrap every gap to start after the ramp's, then walk them in order.
  const base = gaps[0].a1;
  const up = (x: number) => {
    let v = x;
    while (v < base) v += 2 * Math.PI;
    while (v >= base + 2 * Math.PI) v -= 2 * Math.PI;
    return v;
  };
  const rest = gaps.slice(1).map((g) => ({ ...g, a0: up(g.a0), a1: up(g.a0) + (g.a1 - g.a0) })).sort((p, q) => p.a0 - q.a0);
  const order = [{ ...gaps[0], a0: gaps[0].a0, a1: base }, ...rest, { ...gaps[0], a0: gaps[0].a0 + 2 * Math.PI, a1: base + 2 * Math.PI }];
  const runs: { a0: number; a1: number; from: RailEnd; to: RailEnd }[] = [];
  for (let i = 0; i + 1 < order.length; i++) runs.push({ a0: order[i].a1, a1: order[i + 1].a0, from: order[i].kind, to: order[i + 1].kind });
  return runs;
}

/** The terminal's frame: its base centre on the deck, `inward` toward the centre, `right` as a user facing it sees it. */
export function terminalFrame(): { base: [number, number, number]; inward: P2; right: P2 } {
  const [ox, oz] = dir(TERMINAL.angle);
  const base: [number, number, number] = [STAND.cx + ox * TERMINAL.r, DECK_Y, STAND.cz + oz * TERMINAL.r];
  const inward: P2 = [-ox, -oz];
  // Facing the terminal (looking outward along −inward), right is outward turned −90° in plan.
  const right: P2 = [-oz, ox];
  return { base, inward, right };
}
