/**
 * The car (docs/vehicles.md), ported exactly from refs/car.html: an ivory-and-gold electric car with
 * a smoked teardrop canopy, a tilted transverse halo, four enclosed annular wheels with sealed hub
 * motors, and a circular rear power core. Every dimension below is the ref's; only the assembly is
 * restructured for the engine:
 *
 *  - the body (with the rear core) is one geometry, a group per material slot;
 *  - the wheel is one geometry, shared by the four wheels, each an Object3D that spins and steers.
 *
 * The ref models in its own frame (metres, +Y up, +Z nose) and then stretches the assembly to the
 * reference's wide, low proportions: body parts by (1.20, 0.86, 1.10); wheel groups placed at
 * their stretched hub and scaled (1.20, 0.86, 0.86) so they stay round; the rear core group scaled
 * 0.94. That stretch is baked into the geometry here, so the car's own frame is the stretched one.
 */
import { CylinderGeometry, Euler, Matrix4, Quaternion, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry } from 'three/webgpu';
import { PartSink, TAU, V, curve, d, loft, seq, panel, rail, track, withDetail } from '../kit/loft';

/** The ref's design datums (refs/car.html `D`), in the ref's unstretched frame. */
const D = { radius: 0.8, wheelWidth: 0.47, track: 3.12, front: 1.97, rear: -1.96, nose: 3.03, tail: -2.79, shell: 0.026, archTop: 2.04 } as const;
/** The ref's final proportions (applied to the whole assembly). */
const STRETCH = new Vector3(1.2, 0.86, 1.1);
const WHEEL_SCALE = new Vector3(1.2, 0.86, 0.86);
const CORE_SCALE = 0.94;
/**
 * The wheels deploy (by the user's decision). Parked, they stand drawn in at the ref's own track,
 * the suspension's beams hidden in the body, exactly as authored. To drive they extend this much
 * per side (m, the car's frame): as authored the front wheels stand 2 cm off the shoulders and
 * could steer only ~2.5° before striking them; deployed, they steer a full lock cleanly. The
 * carriers and rear axle stubs are built at full deployment and telescope out of the body; drawn
 * in, they slide back into it.
 */
export const TRACK_WIDEN = 0.35;
/** Drawn in, the wheels stop this far (m) outside the ref's track: its 2 cm to the shoulders is too fine. */
export const DRAWN_IN_CLEAR = 0.03;
const REF_WIDEN = TRACK_WIDEN / STRETCH.x;

export const CAR_SLOT = {
  gold: 0,
  paleGold: 1,
  darkGold: 2,
  porcelain: 3,
  black: 4,
  titanium: 5,
  rubber: 6,
  glass: 7,
  glow: 8,
  whiteGlow: 9,
  /** The tail lamps' lenses (the ref's glow), their own slot so they brighten under braking. */
  tail: 10,
} as const;
export const CAR_SLOTS = 11;

/** The car's dimensions in its own (stretched) frame: wheel hubs, wheel radius and width. */
export const CAR = {
  wheelRadius: D.radius * WHEEL_SCALE.y,
  wheelWidth: D.wheelWidth * WHEEL_SCALE.x,
  /** Hub height over the ground: the wheels stand on y = 0. */
  hubY: D.radius * STRETCH.y,
  /** Half the track (hub to hub across), deployed, and the axles' z. */
  halfTrack: (D.track / 2) * STRETCH.x + TRACK_WIDEN,
  frontZ: D.front * STRETCH.z,
  rearZ: D.rear * STRETCH.z,
  wheelbase: (D.front - D.rear) * STRETCH.z,
} as const;

export interface CarModel {
  body: BufferGeometry;
  /**
   * A wheel in two parts: the annular rotor (the tread ring with its sidewalls, rims and emitters),
   * which spins, round the hub (the sealed motor, its faces and impeller blades), which carries the
   * suspension and steers but does not spin.
   */
  rotor: BufferGeometry;
  hub: BufferGeometry;
  /** Hub of each wheel in the car frame: front left, front right, rear left, rear right. */
  hubs: Vector3[];
  triangles: number;
  /**
   * The suspension's swing arms, one set per wheel (same order as `hubs`): the carriers (and the
   * rear axle stubs), pivoting on the body at `pivot` and reaching the hub. They are posed each
   * frame (`armMatrix`) so their ends stay on the hubs while the body rides its springs.
   */
  arms: CarArm[];
  /** The parts before merging, for audits (tests/). */
  bodyParts: PartSink;
  rotorParts: PartSink;
  hubParts: PartSink;
}

export interface CarArm {
  geometry: BufferGeometry;
  parts: PartSink;
  /** The arm's root on the body, in the car's frame (as built). */
  pivot: Vector3;
  /** The hub it reaches (as built: the body at rest). */
  hub: Vector3;
}

/** Height of the sprung body's pitch and roll axis over the ground (m). */
export const BODY_PIVOT = 0.35;

/** The sprung body's pose in the car's frame: pitched and rolled about BODY_PIVOT, heaved. */
export function bodyMatrix(pitch: number, roll: number, heave: number, out = new Matrix4()): Matrix4 {
  return out
    .makeTranslation(0, BODY_PIVOT + heave, 0)
    .multiply(new Matrix4().makeRotationFromEuler(new Euler(pitch, 0, roll, 'XZY')))
    .multiply(new Matrix4().makeTranslation(0, -BODY_PIVOT, 0));
}

/** The parts that tie a wheel to the body: they swing with the suspension. */
const ARM = /suspension carrier|axle stub/;

/**
 * An arm's pose in the car's frame, for the body's own pose `body` (its pitch, roll and heave in
 * the car's frame) and the hub where the wheel now is: the arm rides on the body and turns about its
 * root so its end stays on the hub (a ball joint on the steering axis, so steering does not move it).
 */
export function armMatrix(arm: CarArm, body: Matrix4, hub: Vector3, out = new Matrix4()): Matrix4 {
  // Drawn in, the arm slides along the axle into the body by as much as its wheel has come in.
  const slide = hub.x - arm.hub.x;
  const pivot = arm.pivot.clone();
  pivot.x += slide;
  const local = hub.clone().applyMatrix4(body.clone().invert());
  const reach = arm.hub.clone().sub(arm.pivot);
  const to = local.sub(pivot);
  // The arm telescopes along itself by the change in reach, so its end lands on the hub exactly.
  const extend = to.length() - reach.length();
  to.normalize();
  const q = new Quaternion().setFromUnitVectors(reach.normalize(), to);
  return out
    .copy(body)
    .multiply(new Matrix4().makeTranslation(pivot.x + to.x * extend, pivot.y + to.y * extend, pivot.z + to.z * extend))
    .multiply(new Matrix4().makeRotationFromQuaternion(q))
    .multiply(new Matrix4().makeTranslation(-arm.pivot.x, -arm.pivot.y, -arm.pivot.z));
}

/** A wheel's hub with the wheels deployed by `deploy` (0 drawn in … 1 out). */
export function hubAt(hub: Vector3, deploy: number, out = new Vector3()): Vector3 {
  out.copy(hub);
  out.x -= Math.sign(hub.x) * (TRACK_WIDEN - DRAWN_IN_CLEAR) * (1 - deploy);
  return out;
}

const S = CAR_SLOT;

/** Where a wheel part goes: the hub's (the motor and its blades) or the rotor's (everything else). */
function wheelSink(rotor: PartSink, hub: PartSink): Pick<PartSink, 'add'> {
  return { add: (name, slot, g, m) => (/motor|turbine/.test(name) ? hub : rotor).add(name, slot, g, m) };
}

/** The wheel as the ref's `wheel()` builds it, in the wheel's own frame (axle along x). */
function buildWheel(sink: Pick<PartSink, 'add'>): void {
  const revolve = (label: string, profile: readonly (readonly [number, number])[], slot: number) => {
    const rings: Vector3[][] = [];
    const nr = d(160, 32);
    for (let i = 0; i < nr; i++) {
      const a = (i / nr) * TAU;
      rings.push(profile.map(([xx, rr]) => V(xx, Math.cos(a) * rr, Math.sin(a) * rr)));
    }
    sink.add(`wheel ${label}`, slot, loft(rings, { closed: true }));
  };
  const w = D.wheelWidth / 2;
  revolve('porcelain tread', [[-w + 0.012, 0.71], [-w - 0.002, 0.748], [-w + 0.018, 0.782], [-w + 0.055, 0.798], [-w + 0.12, 0.803], [w - 0.12, 0.803], [w - 0.055, 0.798], [w - 0.018, 0.782], [w + 0.002, 0.748], [w - 0.012, 0.71], [w - 0.05, 0.699], [-w + 0.05, 0.699]], S.porcelain);
  revolve('inner graphite barrel', [[-w + 0.014, 0.686], [w - 0.014, 0.686], [w - 0.014, 0.706], [-w + 0.014, 0.706]], S.black);
  for (const q of [-1, 1]) {
    const xx = q * (w + 0.008);
    revolve(`broad gold sidewall ${q}`, [[xx - q * 0.02, 0.681], [xx + q * 0.013, 0.686], [xx + q * 0.027, 0.71], [xx + q * 0.029, 0.748], [xx + q * 0.018, 0.773], [xx - q * 0.006, 0.783], [xx - q * 0.022, 0.766], [xx - q * 0.026, 0.71]], S.gold);
    revolve(`inner rim lip ${q}`, [[xx + q * 0.034, 0.65], [xx + q * 0.041, 0.657], [xx + q * 0.04, 0.677], [xx + q * 0.03, 0.687], [xx + q * 0.017, 0.679], [xx + q * 0.018, 0.657]], S.paleGold);
    revolve(`luminous rim ${q}`, [[xx + q * 0.032, 0.741], [xx + q * 0.038, 0.745], [xx + q * 0.038, 0.755], [xx + q * 0.032, 0.76], [xx + q * 0.025, 0.755], [xx + q * 0.025, 0.745]], S.glow);
    revolve(`dark rim reveal ${q}`, [[xx + q * 0.01, 0.786], [xx + q * 0.013, 0.791], [xx - q * 0.008, 0.796], [xx - q * 0.014, 0.789]], S.rubber);
  }
  // Sealed electromagnetic motor faces: concentric ceramic/titanium surfaces, swept impeller blades.
  revolve('sealed motor housing', [[-0.13, 0.025], [-0.13, 0.6], [-0.11, 0.65], [0.11, 0.65], [0.13, 0.6], [0.13, 0.025]], S.black);
  for (const q of [-1, 1]) {
    revolve(`motor face bezel ${q}`, [[q * 0.151, 0.225], [q * 0.165, 0.23], [q * 0.167, 0.26], [q * 0.152, 0.27], [q * 0.14, 0.26], [q * 0.14, 0.23]], S.paleGold);
    revolve(`satin motor face ${q}`, [[q * 0.133, 0.003], [q * 0.163, 0.003], [q * 0.18, 0.08], [q * 0.178, 0.19], [q * 0.16, 0.221], [q * 0.139, 0.221]], S.titanium);
    revolve(`motor light annulus ${q}`, [[q * 0.168, 0.204], [q * 0.174, 0.206], [q * 0.174, 0.213], [q * 0.168, 0.215]], S.glow);
    revolve(`outer turbine seat ${q}`, [[q * 0.135, 0.61], [q * 0.16, 0.62], [q * 0.17, 0.64], [q * 0.155, 0.654], [q * 0.135, 0.65]], S.titanium);
    for (let j = 0; j < 7; j++) {
      const a = (j / 7) * TAU;
      const rings: Vector3[][] = [];
      const nb = d(45, 10);
      const nk = d(16, 8);
      for (let i = 0; i <= nb; i++) {
        const t = i / nb;
        const r = 0.266 + t * 0.365;
        const b = a + 0.56 * t;
        const width = 0.18 + 0.105 * Math.sin(Math.PI * t);
        const ring: Vector3[] = [];
        for (let k = 0; k < nk; k++) {
          const u = (k / nk) * TAU;
          const theta = b + Math.cos(u) * width;
          ring.push(V(q * (0.148 + 0.028 * Math.sin(Math.PI * t) + 0.018 * Math.sin(u)), r * Math.cos(theta), r * Math.sin(theta)));
        }
        rings.push(ring);
      }
      sink.add(`sculpted turbine blade ${q} ${j}`, S.titanium, loft(rings));
      sink.add(
        `turbine gold edge ${q} ${j}`,
        S.paleGold,
        rail(
          (t) => {
            const r = 0.28 + t * 0.34;
            const b = a + 0.56 * t - 0.18 - 0.105 * Math.sin(Math.PI * t);
            return V(q * (0.171 + 0.028 * Math.sin(Math.PI * t)), r * Math.cos(b), r * Math.sin(b));
          },
          0.006,
          0.006,
          { steps: 36, sides: 6 },
        ),
      );
      sink.add(
        `segmented rim emitter ${q} ${j}`,
        S.whiteGlow,
        rail(
          (t) => {
            const b = a + 0.12 + t * 0.43;
            return V(q * 0.205, 0.647 * Math.cos(b), 0.647 * Math.sin(b));
          },
          0.007,
          0.007,
          { steps: 25, sides: 8 },
        ),
      );
    }
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * TAU;
      const m = new Matrix4().compose(V(q * 0.18, 0.151 * Math.cos(a), 0.151 * Math.sin(a)), new Quaternion(), V(0.28, 1, 1));
      sink.add(`motor fastener ${q} ${j}`, S.paleGold, new SphereGeometry(0.013, d(12, 6), d(8, 4)), m);
    }
  }
  // Fine diagonal seams in each broad white wheel cover.
  for (let j = 0; j < 8; j++) {
    const a = (j / 8) * TAU;
    sink.add(
      `crown seam ${j}`,
      S.darkGold,
      rail(
        (t) => {
          const xx = -w + 0.04 + t * (D.wheelWidth - 0.08);
          const r = 0.804 - 0.015 * Math.pow(Math.abs(xx) / w, 6);
          const b = a + 0.11 * (t - 0.5);
          return V(xx, r * Math.cos(b), r * Math.sin(b));
        },
        0.0018,
        0.0018,
        { steps: 20, sides: 6 },
      ),
    );
  }
}

/** The body, canopy, shoulders, halo, aft casting and cabin (refs/car.html), in the ref's frame. */
function buildBody(sink: PartSink): void {
  const add = (name: string, slot: number, g: BufferGeometry, m?: Matrix4) => sink.add(name, slot, g, m);
  /** A wheel tie's x stretched from its inboard root to its tip out by the track's widening. */
  const reach = (x: number, root: number, tip: number) => x + (REF_WIDEN * (x - root)) / (tip - root);

  // Central belly: narrow pointed forward keel, broad rear engine tray.
  const hullW = track([[-2.45, 0.45], [-2.4, 0.63], [-1.4, 0.86], [0, 0.71], [1.5, 0.47], [2.4, 0.27], [2.65, 0.16]]);
  const hullY = track([[-2.7, 0.66], [-2.0, 0.67], [0, 0.56], [1.6, 0.4], [3.03, 0.25]]);
  const hullH = track([[-2.7, 0.06], [-1.8, 0.25], [0, 0.25], [1.7, 0.18], [3.03, 0.025]]);
  add(
    'sculpted central keel',
    S.black,
    loft(
      seq(d(125, 30), (i, count) => {
        const z = -2.43 + (i / (count - 1)) * 5.0;
        const na = d(48, 16);
        return Array.from({ length: na }, (_, j) => {
          const a = (j / na) * TAU;
          return V(hullW(z) * Math.cos(a), hullY(z) + hullH(z) * Math.sin(a), z);
        });
      }),
    ),
  );

  // The canopy has a long sharp leading end and a low teardrop roof.
  const cabW = track([[-2.12, 0.018], [-1.6, 0.42], [-0.65, 0.66], [0.25, 0.63], [1.2, 0.43], [2.3, 0.12], [2.46, 0.075]]);
  const cabBase = track([[-2.12, 1.04], [-1, 1.12], [0, 1.02], [1, 0.77], [2, 0.43], [2.7, 0.28]]);
  const cabRise = track([[-2.12, 0.015], [-1.6, 0.28], [-0.7, 0.54], [0.25, 0.57], [1.2, 0.44], [2.3, 0.14], [2.7, 0.015]]);
  const cab = (z: number, a: number) => V(cabW(z) * Math.cos(a), cabBase(z) + cabRise(z) * Math.sin(a), z);
  const canopyRings: Vector3[][] = [];
  const nc = d(132, 30);
  const nw = d(48, 16);
  for (let i = 0; i <= nc; i++) {
    const z = -2.12 + (i / nc) * 4.58;
    const r: Vector3[] = [];
    for (let j = 0; j <= nw; j++) r.push(cab(z, (j / nw) * Math.PI));
    r.push(V(-cabW(z), cabBase(z) - 0.018, z), V(cabW(z), cabBase(z) - 0.018, z));
    canopyRings.push(r);
  }
  add('smoked teardrop canopy', S.glass, loft(canopyRings));
  for (const s of [-1, 1]) {
    add(
      `canopy gold sill ${s}`,
      S.paleGold,
      rail(
        (t) => {
          const z = -2.12 + t * 4.55;
          return V(s * cabW(z), cabBase(z) + 0.006, z);
        },
        0.012,
        0.012,
        { steps: 130 },
      ),
    );
  }
  add(
    'canopy centre inlay',
    S.paleGold,
    rail(
      (t) => {
        const z = -0.1 + t * 2.5;
        return V(0, cabBase(z) + cabRise(z) + 0.011, z);
      },
      0.014,
      0.008,
      { steps: 110 },
    ),
  );
  for (const z of [-1.22, -0.24]) add(`canopy transverse seal ${z}`, S.paleGold, rail((t) => cab(z, t * Math.PI).add(V(0, 0.008, 0)), 0.01, 0.013, { steps: 64 }));
  for (const s of [-1, 1])
    add(
      `canopy longitudinal fine mullion ${s}`,
      S.gold,
      rail(
        (t) => {
          const z = -1.75 + t * 3.95;
          return cab(z, s > 0 ? 0.72 : Math.PI - 0.72).add(V(0, 0.008, 0));
        },
        0.005,
        0.006,
        { steps: 95 },
      ),
    );

  // Ivory shoulder skins fan out toward the wheel roots, leaving genuine side apertures.
  const bodyW = track([[-2.5, 0.65], [-2.25, 1.15], [-1.5, 1.18], [-0.35, 0.93], [0.65, 1.02], [1.65, 1.24], [2.25, 0.91], [2.58, 0.27]]);
  const bodyY = track([[-2.5, 1.12], [-2.15, 1.35], [-1.2, 1.3], [-0.2, 1.12], [0.9, 1.06], [1.65, 1.27], [2.3, 0.85], [2.58, 0.43]]);
  const BODY_START = -1.63;
  const BODY_LENGTH = 4.21;
  for (const s of [-1, 1]) {
    const inside = (t: number) => {
      const z = BODY_START + t * BODY_LENGTH;
      const w = z < -2.12 ? Math.max(0.025, bodyW(z) * 0.25) : cabW(z) + 0.02;
      return V(s * w, z < -2.12 ? bodyY(z) - 0.05 : cabBase(z) - 0.012, z);
    };
    const outside = (t: number) => {
      const z = BODY_START + t * BODY_LENGTH;
      return V(s * bodyW(z), bodyY(z), z);
    };
    // The shoulder is split round a true swept aperture; both lips share the parent surface.
    const surf = (t: number, u: number) => {
      const p = inside(t).lerp(outside(t), u);
      p.y += Math.sin(Math.PI * u) * 0.065;
      return p;
    };
    const h0 = 0.62;
    const h1 = 0.907;
    const lip = (t: number, side: number) => 0.64 + side * 0.235 * Math.pow(Math.max(0, Math.sin((Math.PI * (t - h0)) / (h1 - h0))), 0.75);
    for (const [label, a, b] of [['rear', 0, h0], ['nose', h1, 1]] as const)
      add(`ivory shoulder ${label} ${s}`, S.porcelain, panel((t) => surf(a + t * (b - a), 0), (t) => surf(a + t * (b - a), 1), { crown: 0.065, thickness: 0.048, steps: Math.round((b - a) * 145) }));
    for (const band of [-1, 1]) {
      const edgeA = (t: number) => {
        const v = h0 + t * (h1 - h0);
        return surf(v, band < 0 ? 0 : lip(v, 1));
      };
      const edgeB = (t: number) => {
        const v = h0 + t * (h1 - h0);
        return surf(v, band < 0 ? lip(v, -1) : 1);
      };
      add(`front aperture ivory surround ${s} ${band}`, S.porcelain, panel(edgeA, edgeB, { crown: 0.007, thickness: 0.048, steps: 55 }));
      add(
        `front aperture gold lip ${s} ${band}`,
        S.gold,
        rail(
          (t) => {
            const v = h0 + t * (h1 - h0);
            return surf(v, lip(v, band)).add(V(0, 0.017, 0));
          },
          0.018,
          0.018,
          { steps: 70 },
        ),
      );
    }
    // Continuous sidewall panels carry the canopy shoulder into a recessed intake.
    const sideTop = (t: number) => {
      const z = -1.63 + t * 3.23;
      return V(s * bodyW(z), bodyY(z) - 0.015, z);
    };
    const slotUpper = (t: number) => {
      const z = -1.63 + t * 3.23;
      return V(s * (bodyW(z) + 0.025), bodyY(z) - (0.1 + 0.17 * Math.sin(t * Math.PI)), z);
    };
    const slotLower = (t: number) => {
      const z = -1.63 + t * 3.23;
      return V(s * (bodyW(z) - 0.015), bodyY(z) - (0.16 + 0.34 * Math.sin(t * Math.PI)), z);
    };
    const sideBottom = (t: number) => {
      const z = -1.63 + t * 3.23;
      return V(s * (bodyW(z) - 0.09), 0.39 + 0.2 * Math.pow(2 * t - 1, 2), z);
    };
    add(`continuous upper sidewall ${s}`, S.porcelain, panel(sideTop, slotUpper, { crown: 0.008, thickness: 0.047, steps: 110 }));
    add(`continuous lower sidewall ${s}`, S.porcelain, panel(slotLower, sideBottom, { crown: 0.015, thickness: 0.055, steps: 110 }));
    add(`intake recessed throat ${s}`, S.black, panel((t) => slotUpper(t).add(V(-s * 0.085, -0.012, 0)), (t) => slotLower(t).add(V(-s * 0.085, 0.012, 0)), { crown: 0, thickness: 0.025, steps: 110 }));
    add(`machined intake upper lip ${s}`, S.paleGold, rail(slotUpper, 0.012, 0.01, { steps: 110 }));
    add(`machined intake lower lip ${s}`, S.paleGold, rail(slotLower, 0.012, 0.01, { steps: 110 }));
    for (let j = 0; j < 13; j++) {
      const t = 0.13 + j * 0.057;
      const a = slotUpper(t).add(V(-s * 0.061, -0.015, 0));
      const b = slotLower(t).add(V(-s * 0.061, 0.016, -0.04));
      add(`recessed cooling vane ${s} ${j}`, S.titanium, rail([a, b], 0.01, 0.016, { steps: 5, sides: 8 }));
    }
    // One closed swept fairing at the nose.
    // The fairings are the ref's own: their tips meet the wheels when they are drawn in (parked).
    const fl = (x: number) => s * x;
    const ft = (x: number) => s * x;
    const leading = curve([[fl(0.22), 0.32, 2.57], [fl(0.46), 0.45, 2.52], [fl(0.98), 0.68, 2.3], [fl(1.31), 0.83, 2.12]]);
    const trailing = curve([[ft(0.25), 0.43, 2.51], [ft(0.48), 0.73, 2.38], [ft(1.0), 0.94, 2.13], [ft(1.31), 0.94, 1.87]]);
    add(`front monocoque aero fairing ${s}`, S.porcelain, panel((t) => leading.getPoint(t), (t) => trailing.getPoint(t), { crown: 0.055, thickness: 0.085, steps: 100, across: 24 }));
    add(
      `front inset lamp surround ${s}`,
      S.black,
      rail(
        (t) => {
          const u = 0.3 + t * 0.58;
          return leading.getPoint(u).lerp(trailing.getPoint(u), 0.28).add(V(0, 0.047, 0));
        },
        0.025,
        0.016,
        { steps: 65, taper: 0.35 },
      ),
    );
    add(
      `front integrated running lamp ${s}`,
      S.whiteGlow,
      rail(
        (t) => {
          const u = 0.32 + t * 0.54;
          return leading.getPoint(u).lerp(trailing.getPoint(u), 0.28).add(V(0, 0.063, 0));
        },
        0.011,
        0.009,
        { steps: 65, taper: 0.55 },
      ),
    );
    // Suspension carriers end on the wheels' motor casings; their inboard ends start inside the keel.
    const fa = (x: number) => s * reach(x, 0.28, 1.4);
    // Widened, each carrier's last stretch runs along the axle through the rotor's aperture onto the
    // hub (a tie meets a steered hub on the steering axis), from just inboard of the rotor's face.
    const inboard = s * (1.4 + REF_WIDEN - 0.42);
    const armA = curve([[fa(0.28), 0.47, 1.5], [fa(0.66), 0.56, 1.62], [fa(1.05), 0.65, 1.78], [inboard, 0.76, 1.97], [fa(1.4), 0.76, 1.97]]);
    const armB = curve([[fa(0.28), 0.55, 1.22], [fa(0.69), 0.66, 1.34], [fa(1.08), 0.79, 1.63], [inboard, 0.85, 1.97], [fa(1.4), 0.85, 1.97]]);
    add(`front enclosed suspension carrier ${s}`, S.titanium, panel((t) => armA.getPoint(t), (t) => armB.getPoint(t), { crown: 0.02, thickness: 0.11, steps: 55 }));
    const ra = (x: number) => s * reach(x, 0.66, 1.4);
    const rArmA = curve([[ra(0.66), 0.58, -1.48], [ra(1.05), 0.65, -1.76], [inboard, 0.76, -1.96], [ra(1.4), 0.76, -1.96]]);
    const rArmB = curve([[ra(0.69), 0.67, -1.2], [ra(1.08), 0.79, -1.61], [inboard, 0.85, -1.96], [ra(1.4), 0.85, -1.96]]);
    add(`rear enclosed suspension carrier ${s}`, S.titanium, panel((t) => rArmA.getPoint(t), (t) => rArmB.getPoint(t), { crown: 0.02, thickness: 0.11, steps: 55 }));
    add(`rear axle stub ${s}`, S.titanium, rail([[s * 0.85, D.radius, D.rear], [s * (1.42 + REF_WIDEN), D.radius, D.rear]], 0.075, 0.075, { steps: 8, sides: 16 }));
    // Fine etched panel seams (inlay, 1.2 mm proud of the skin).
    for (const z of [-1.37, 0.78]) {
      const t = (z - BODY_START) / BODY_LENGTH;
      const a = inside(t);
      const b = outside(t);
      add(
        `shoulder panel joint ${s} ${z}`,
        S.darkGold,
        rail(
          (u) => {
            const p = a.clone().lerp(b, u);
            p.y += Math.sin(Math.PI * u) * 0.065 + 0.025;
            return p;
          },
          0.0026,
          0.0026,
          { steps: 20, sides: 6 },
        ),
      );
    }
  }

  // One rounded nose casting closes all longitudinal skins.
  const noseWidth = track([[2.26, 0.43], [2.45, 0.36], [2.61, 0.29], [2.84, 0.16], [2.96, 0.055], [2.985, 0.012]]);
  const noseTop = track([[2.26, 0.59], [2.45, 0.515], [2.61, 0.44], [2.84, 0.345], [2.96, 0.302], [2.985, 0.285]]);
  const noseBottom = track([[2.26, 0.255], [2.61, 0.245], [2.84, 0.255], [2.96, 0.267], [2.985, 0.278]]);
  add(
    'single continuous rounded nose casting',
    S.porcelain,
    loft(
      seq(d(100, 24), (i, count) => {
        const z = 2.26 + (i / (count - 1)) * 0.725;
        const top = noseTop(z);
        const bottom = noseBottom(z);
        const nn = d(64, 20);
        return Array.from({ length: nn }, (_, j) => {
          const a = (j / nn) * TAU;
          return V(noseWidth(z) * Math.cos(a), (top + bottom) / 2 + ((top - bottom) / 2) * Math.sin(a), z);
        });
      }),
    ),
  );

  // Signature tilted transverse halo, its roots bolted into the rocker between the axles.
  const arch = (t: number) => {
    const a = Math.PI * t;
    return V(0.94 * Math.cos(a), 1.1 + 0.92 * Math.sin(a), -0.6 - 0.68 * Math.sin(a));
  };
  add('halo sculpted gold structure', S.gold, rail(arch, 0.065, 0.052, { steps: 160, sides: 20 }));
  add('halo porcelain ribbon', S.porcelain, panel((t) => arch(t).add(V(0, 0.014, -0.065)), (t) => arch(t).add(V(0, 0.014, 0.065)), { crown: 0.028, thickness: 0.025, steps: 150, across: 16 }));
  for (const side of [-1, 1]) add(`halo gold pinstripe ${side}`, S.paleGold, rail((t) => arch(t).add(V(0, 0.028, side * 0.075)), 0.014, 0.015, { steps: 160 }));
  add(
    'halo inner light strip',
    S.glow,
    rail(
      (t) => {
        const p = arch(t);
        p.y -= 0.048;
        return p;
      },
      0.007,
      0.008,
      { steps: 150 },
    ),
  );
  // Dorsal flying buttresses join the halo and the rear deck.
  for (const s of [-1, 1]) {
    const buttA = curve([[s * 0.23, 1.61, -0.48], [s * 0.41, 1.82, -1.12], [s * 0.63, 1.49, -1.86], [s * 0.72, 1.04, -2.21]]);
    const buttB = curve([[s * 0.31, 1.57, -0.48], [s * 0.5, 1.76, -1.12], [s * 0.74, 1.44, -1.86], [s * 0.82, 1.04, -2.21]]);
    add(`sculpted dorsal buttress ${s}`, S.porcelain, panel((t) => buttA.getPoint(t), (t) => buttB.getPoint(t), { crown: 0.018, thickness: 0.034, steps: 90 }));
    add(`dorsal buttress fine edge ${s}`, S.paleGold, rail((t) => buttA.getPoint(t * 0.91), 0.007, 0.007, { steps: 90 }));
  }

  // One continuous closed aft casting owns the rear deck, fascia and corners.
  const aftWidth = track([[-2.72, 0.37], [-2.6, 0.63], [-2.38, 1.04], [-2.08, 1.18], [-1.63, bodyW(-1.63)]]);
  const aftHeight = track([[-2.72, 1.02], [-2.6, 1.09], [-2.38, 1.23], [-2.08, 1.32], [-1.63, bodyY(-1.63)]]);
  const aftSection = (z: number) => {
    const w = aftWidth(z);
    const h = aftHeight(z);
    const bottom = 0.48;
    const pts: [number, number][] = [[0, 1.04], [w * 0.42, 1.08], [w * 0.82, h], [w * 0.98, h - 0.025], [w, h - 0.12], [w * 0.99, 0.72], [w * 0.9, bottom + 0.025], [w * 0.58, bottom], [0, bottom - 0.015], [-w * 0.58, bottom], [-w * 0.9, bottom + 0.025], [-w * 0.99, 0.72], [-w, h - 0.12], [-w * 0.98, h - 0.025], [-w * 0.82, h], [-w * 0.42, 1.08]];
    return curve(pts.map(([x, y]) => V(x, y, z)), true);
  };
  add(
    'unified rear body casting',
    S.porcelain,
    loft(
      seq(d(120, 24), (i, count) => {
        const c = aftSection(-2.72 + (i / (count - 1)) * 1.09);
        const na = d(112, 32);
        return Array.from({ length: na }, (_, j) => c.getPoint(j / na));
      }),
    ),
  );
  for (const s of [-1, 1]) {
    const lamp = curve([[s * 0.43, 0.9, -2.7], [s * 0.61, 0.94, -2.61], [s * 0.79, 0.98, -2.51], [s * 0.96, 1.0, -2.39]]);
    add(`tail lamp pocket ${s}`, S.black, rail((t) => lamp.getPoint(t), 0.024, 0.018, { steps: 60, taper: 0.6 }));
    add(`tail lamp lens ${s}`, S.tail, rail((t) => lamp.getPoint(0.04 + t * 0.92).add(V(0, 0, -0.016)), 0.01, 0.007, { steps: 60, taper: 0.65 }));
  }

  // Interior glimpsed through smoked glass: gold-framed seats and instruments.
  for (const s of [-1, 1]) {
    add(`seat frame ${s}`, S.darkGold, rail([[s * 0.26, 0.79, 0.4], [s * 0.34, 0.91, -0.25], [s * 0.34, 1.29, -0.66], [s * 0.25, 1.39, -0.74]], 0.047, 0.038, { steps: 42 }));
    add(`cockpit console ${s}`, S.gold, rail([[s * 0.11, 0.7, 1.18], [s * 0.18, 0.93, 0.72], [s * 0.21, 1.09, 0.28]], 0.013, 0.013, { steps: 28 }));
    for (let i = 0; i < 4; i++) add(`instrument tick ${s} ${i}`, S.gold, rail([[s * 0.18, 0.93 + i * 0.028, 0.7 - i * 0.05], [s * 0.25, 0.93 + i * 0.028, 0.7 - i * 0.05]], 0.004, 0.004, { steps: 2, sides: 6 }));
  }
}

/** The rear circular power core (its own group in the ref: placed, then scaled 0.94). */
function buildCore(sink: PartSink): void {
  const ring = (name: string, R: number, r: number, z: number, slot: number) => sink.add(name, slot, new TorusGeometry(R, r, d(16, 8), d(100, 32)), new Matrix4().makeTranslation(0, 0, z));
  const nozzleProfile: [number, number][] = [[-0.025, 0.365], [-0.065, 0.38], [-0.13, 0.37], [-0.17, 0.345], [-0.18, 0.31], [-0.165, 0.285], [-0.1, 0.27], [0.08, 0.235], [0.25, 0.24], [0.25, 0.29], [0.04, 0.345]];
  sink.add(
    'propulsion nozzle machined shell',
    S.titanium,
    loft(
      seq(d(128, 32), (i, count) => {
        const a = (i / count) * TAU;
        return nozzleProfile.map(([z, r]) => V(r * Math.cos(a), r * Math.sin(a), z));
      }),
      { closed: true },
    ),
  );
  ring('rear core outer bezel', 0.352, 0.018, -0.153, S.paleGold);
  ring('rear core inner bezel', 0.286, 0.01, -0.153, S.gold);
  ring('rear core light annulus', 0.248, 0.012, -0.07, S.glow);
  sink.add('rear core recessed emitter', S.glow, new CylinderGeometry(0.215, 0.215, 0.025, d(64, 24)), new Matrix4().makeRotationX(Math.PI / 2).premultiply(new Matrix4().makeTranslation(0, 0, -0.055)));
  for (let j = 0; j < 16; j++) {
    const a = (j / 16) * TAU;
    sink.add(`rear nozzle radial key ${j}`, S.paleGold, rail([[0.292 * Math.cos(a), 0.292 * Math.sin(a), -0.16], [0.333 * Math.cos(a), 0.333 * Math.sin(a), -0.17]], 0.006, 0.006, { steps: 3, sides: 8 }));
  }
}

/** Builds the car's geometry (deterministic) at a tessellation level (1: the ref's). */
export function buildCarModel(level = 1): CarModel {
  return withDetail(level, buildAtLevel);
}

function buildAtLevel(): CarModel {
  const stretch = new Matrix4().makeScale(STRETCH.x, STRETCH.y, STRETCH.z);
  const bodyParts = new PartSink(stretch);
  buildBody(bodyParts);
  const corePos = V(0, 0.775, -2.905).multiply(STRETCH);
  const core = new PartSink(new Matrix4().compose(corePos, new Quaternion(), V(CORE_SCALE, CORE_SCALE, CORE_SCALE)));
  buildCore(core);
  bodyParts.parts.push(...core.parts);
  const wheelScale = new Matrix4().makeScale(WHEEL_SCALE.x, WHEEL_SCALE.y, WHEEL_SCALE.z);
  const rotorParts = new PartSink(wheelScale);
  const hubParts = new PartSink(wheelScale);
  buildWheel(wheelSink(rotorParts, hubParts));
  const hubs = [
    V(-CAR.halfTrack, CAR.hubY, CAR.frontZ),
    V(CAR.halfTrack, CAR.hubY, CAR.frontZ),
    V(-CAR.halfTrack, CAR.hubY, CAR.rearZ),
    V(CAR.halfTrack, CAR.hubY, CAR.rearZ),
  ];
  // The swing arms leave the body: per wheel by side (the name's sign) and axle.
  const armSinks = hubs.map(() => new PartSink());
  bodyParts.parts.splice(0, bodyParts.parts.length, ...bodyParts.parts.filter((part) => {
    if (!ARM.test(part.name)) return true;
    const left = /-1$/.test(part.name);
    const front = part.name.startsWith('front');
    armSinks[(front ? 0 : 2) + (left ? 0 : 1)].parts.push(part);
    return false;
  }));
  const arms: CarArm[] = armSinks.map((sink, i) => {
    // The root: the arm's point farthest from its hub.
    const hub = hubs[i];
    const pivot = new Vector3();
    let far = -1;
    const v = new Vector3();
    for (const part of sink.parts) {
      const pos = part.geometry.getAttribute('position');
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k);
        const d = v.distanceToSquared(hub);
        if (d > far) {
          far = d;
          pivot.copy(v);
        }
      }
    }
    return { geometry: sink.merge(), parts: sink, pivot, hub: hub.clone() };
  });
  const armTris = armSinks.reduce((n, a) => n + a.triangles, 0);
  return { body: bodyParts.merge(), rotor: rotorParts.merge(), hub: hubParts.merge(), hubs, arms, triangles: bodyParts.triangles + armTris + 4 * (rotorParts.triangles + hubParts.triangles), bodyParts, rotorParts, hubParts };
}
