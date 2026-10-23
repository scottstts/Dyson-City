import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { buildTimeline, LINES, sceneAt, SPEAKER } from '../src/intro/timeline';
import { newShipPose, shipMatrix, shipPose } from '../src/intro/flight';
import { shipStateAt } from '../src/intro/shipState';
import type { ShipState } from '../src/intro/ship/ship';
import { doorOffset, DOOR_TIME } from '../src/intro/ship/door';
import { FOOT, STAIR_PITCH, STAIR_TIME, stairPose } from '../src/intro/ship/stair';
import { DOOR, STAIR } from '../src/intro/ship/spec';
import { COMPRESSION, LEGS, poseLeg } from '../src/intro/ship/gear';
import { DOOR_OPENING, openingHitCPU, WINDOWS } from '../src/intro/ship/glazing';
import { PANES } from '../src/intro/ship/hull';
import { hullPath, transmission } from '../src/audio/acoustics';
import { REVERBS, synthesizeImpulse } from '../src/audio/reverb';
import { synthChime, synthConfirm } from '../src/intro/audio/tones';
import { readDebugParams } from '../src/debug/params';
import { Eye, HOME } from '../src/intro/eye';
import { v3, type Vec3 } from '../src/geometry/polyMesh';

/** The recorded lines' lengths (s), as decoded from public/intro-audio/. */
const DURATIONS = [15.31, 13.56, 12.67, 4.24, 0.99, 10.19, 9.28, 10.37, 3.2];
const tl = buildTimeline(DURATIONS);

describe("the intro film", () => {
  it("lays the lines in order, never overlapping, each in its scene", () => {
    expect(tl.lines.length).toBe(LINES);
    for (let i = 1; i < LINES; i++) expect(tl.lines[i]).toBeGreaterThanOrEqual(tl.lines[i - 1] + DURATIONS[i - 1]);
    expect(sceneAt(tl, tl.lines[0])).toBe(1);
    expect(sceneAt(tl, tl.lines[1] + DURATIONS[1])).toBe(1);
    for (let i = 2; i < LINES; i++) {
      expect(sceneAt(tl, tl.lines[i])).toBe(2);
      expect(sceneAt(tl, tl.lines[i] + DURATIONS[i] - 0.01)).toBe(2);
    }
    // Aurelia lands the ship mid-dialogue: the landing lines come after touchdown.
    expect(tl.lines[5]).toBeGreaterThan(tl.scene2.touchdown);
    expect(SPEAKER.filter((s) => s === 'ai').length).toBe(5);
  });

  it("runs scene 3 in its order: door, stair, walk off, stair in, door shut, lift-off", () => {
    const s3 = tl.scene3;
    const order = [s3.start, s3.doorOpen, s3.stairOut, s3.stepOut, s3.descend, s3.ground, s3.stop, s3.turnBack, s3.back, s3.stairIn, s3.doorClose, s3.spool, s3.liftoff, s3.depart, s3.backEnd, s3.turnHome, s3.end];
    // Out of the cabin only once the door is fully open and the stair is down on the deck.
    expect(s3.stepOut).toBeGreaterThanOrEqual(s3.doorOpen + DOOR_TIME);
    expect(s3.stepOut).toBeGreaterThanOrEqual(s3.stairOut + STAIR_TIME);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
    expect(tl.end).toBe(s3.end);
    // Whenever the stair is out of its slot the leaf has slid clear of its width (and its rails).
    const state: ShipState = { door: 0, stair: 0, gear: 0, compression: 0, main: 0, lift: 0 };
    const pose = newShipPose();
    for (let t = s3.start; t < s3.liftoff; t += 0.05) {
      shipStateAt(tl, t, false, shipPose(tl, t, pose), state);
      if (state.stair > 0) expect(DOOR.x + DOOR.halfWidth + doorOffset(state.door).offset[0], `t ${t}`).toBeLessThan(DOOR.x - STAIR.width / 2 - 0.05);
    }
    shipStateAt(tl, s3.liftoff, false, shipPose(tl, s3.liftoff, pose), state);
    expect(state.door).toBe(0);
    expect(state.stair).toBe(0);
  });

  it("lands the ship on its feet: at rest every foot's sole is on the deck", () => {
    const pose = newShipPose();
    const ship = new Matrix4();
    for (const t of [tl.scene2.touchdown + 3, tl.scene3.ground]) {
      shipPose(tl, t, pose);
      expect(pose.compression, `t ${t}`).toBeCloseTo(COMPRESSION, 3);
      expect(pose.gear).toBe(1);
      shipMatrix(pose, ship);
      for (const l of LEGS) {
        const sole = new Vector3(0, -0.14, 0).applyMatrix4(poseLeg(l, 1, pose.compression).foot).applyMatrix4(ship);
        expect(sole.y, `${l.name} at ${t}`).toBeCloseTo(l.ground, 3);
      }
    }
  });

  it("flies without a snap: the ship's pose changes smoothly from frame to frame", () => {
    // A snap is a jump in the frame-to-frame change (the second difference): a 0.2 m hop at the
    // hover once lifted the cockpit in one frame. Contact (0.8 m/s stopped dead) is the largest
    // honest one: 0.013 m.
    const p = [newShipPose(), newShipPose(), newShipPose()];
    const dt = 1 / 60;
    const bad: string[] = [];
    for (let t = tl.scene2.start + dt; t < tl.end - dt; t += dt) {
      shipPose(tl, t - dt, p[0]);
      shipPose(tl, t, p[1]);
      shipPose(tl, t + dt, p[2]);
      const jump = p[2].position.clone().sub(p[1].position).sub(p[1].position.clone().sub(p[0].position)).length();
      const turn = Math.max(...(['yaw', 'pitch', 'roll'] as const).map((k) => Math.abs(p[2][k] - 2 * p[1][k] + p[0][k])));
      if (jump > 0.03 || turn > 0.002) bad.push(`${t.toFixed(2)}: ${jump.toFixed(3)} m, ${turn.toFixed(4)} rad`);
    }
    expect(bad).toEqual([]);
  });

  it("stands the stair's feet on the deck when it is down", () => {
    // The pads' outer edge on the deck, the rest of the sole just above it (the flight is pitched).
    const edge = new Vector3(0, FOOT.along + FOOT.half, -FOOT.drop).applyMatrix4(stairPose(1, STAIR_PITCH));
    const heel = new Vector3(0, FOOT.along - FOOT.half, -FOOT.drop).applyMatrix4(stairPose(1, STAIR_PITCH));
    expect(edge.y).toBeCloseTo(0, 4);
    expect(heel.y).toBeGreaterThan(0);
    expect(heel.y).toBeLessThan(0.12);
    expect(STAIR_TIME).toBeGreaterThan(1);
  });

  it("sees out through every pane and the door (the glazing's analytic openings)", () => {
    const eye: Vec3 = [8.3, 3.55, 0];
    for (const [i, w] of WINDOWS.entries()) {
      const centre = PANES[i].core.reduce((a, p) => v3.add(a, v3.scale(p, 1 / PANES[i].core.length)), [0, 0, 0] as Vec3);
      expect(openingHitCPU(w, eye, v3.norm(v3.sub(centre, eye))), w.name).toBeGreaterThan(0);
      // Straight up through the roof there is no glass.
      expect(openingHitCPU(w, eye, [0, 1, 0])).toBeLessThan(0);
    }
    const doorCentre: Vec3 = [3.55, 3.2, -3];
    const inside: Vec3 = [3.55, 3.2, 0];
    expect(openingHitCPU(DOOR_OPENING, inside, v3.norm(v3.sub(doorCentre, inside)))).toBeGreaterThan(0);
  });
});

describe('the eye', () => {
  /** The film at 60 Hz: the view's direction and the feet, with the ship flown as in the intro. */
  function film(): { t: number; dir: Vector3; q: Quaternion; pos: Vector3; feet: Vector3; ship: Vector3 }[] {
    const eye = new Eye(tl);
    const pose = newShipPose();
    const ship = new Matrix4();
    const out: { t: number; dir: Vector3; q: Quaternion; pos: Vector3; feet: Vector3; ship: Vector3 }[] = [];
    const dt = 1 / 60;
    for (let t = 0; t <= tl.end + 1e-9; t += dt) {
      if (sceneAt(tl, t) === 1) ship.identity();
      else shipMatrix(shipPose(tl, t, pose), ship);
      const m = eye.update(t, dt, ship).matrix;
      out.push({ t, dir: new Vector3(0, 0, -1).transformDirection(m), q: new Quaternion().setFromRotationMatrix(m), pos: new Vector3().setFromMatrixPosition(m), feet: eye.frame.feet.clone(), ship: new Vector3(1, 3, 0).applyMatrix4(ship) });
    }
    return out;
  }
  const frames = film();
  const cut = (t: number) => [tl.scene1.end, tl.scene2.start, tl.scene2.end, tl.scene3.start].some((c) => Math.abs(t - c) < 0.05);

  it("never jumps: the view turns at a person's speeds within a scene", () => {
    let fastest = 0;
    let worst = 0;
    for (let i = 1; i < frames.length; i++) {
      if (cut(frames[i].t)) continue;
      // The whole camera's turn, not only where it points: looking straight down, a flip of heading
      // barely moves the direction but spins the picture.
      const v = frames[i].q.angleTo(frames[i - 1].q) * 60;
      if (v > fastest) {
        fastest = v;
        worst = frames[i].t;
      }
    }
    // A head turning round to look behind peaks near 200°/s; nothing snaps.
    expect((fastest * 180) / Math.PI, `at ${worst.toFixed(2)} s`).toBeLessThan(220);
  });

  it("never freezes: the gaze moves within every few seconds while the eyes are open", () => {
    const still: string[] = [];
    const open = (t: number) => (t > tl.scene1.wake + 1 && t < tl.scene1.fadeOut) || (t > tl.scene2.fadeIn + 1 && t < tl.scene2.fadeOut) || (t > tl.scene3.fadeIn + 1 && t < tl.scene3.end - 3);
    for (let i = 0; i + 150 < frames.length; i += 30) {
      if (!open(frames[i].t) || !open(frames[i + 150].t)) continue;
      // Over 2.5 s the direction wanders by more than half a degree from where it was.
      let most = 0;
      for (let j = i; j <= i + 150; j++) most = Math.max(most, frames[j].dir.angleTo(frames[i].dir));
      if ((most * 180) / Math.PI < 0.5) still.push(frames[i].t.toFixed(1));
    }
    expect(still).toEqual([]);
  });

  it("waits inside the door until it is open and the stair down, then goes out", () => {
    const s3 = tl.scene3;
    for (const fr of frames) {
      if (fr.t < s3.start || fr.t >= s3.stepOut) continue;
      // Ship frame at rest (landed at z 4): the feet keep a pace back from the door (its inner face at z ~−2.8).
      expect(fr.feet.z - 4.0, `t ${fr.t}`).toBeGreaterThan(-2.0);
    }
  });

  it("settles into the handoff: no step onto the spawn view", () => {
    // The last frames ease onto the spawn: each turns and moves less than the one before it, the
    // very last by a hair (cut on the last frame, the head's sway once jumped the view 0.6°).
    const tail = frames.filter((fr) => fr.t > tl.end - 0.5);
    const turns = tail.slice(1).map((fr, i) => (fr.q.angleTo(tail[i].q) * 180) / Math.PI);
    const moves = tail.slice(1).map((fr, i) => fr.pos.distanceTo(tail[i].pos));
    expect(turns[turns.length - 1]).toBeLessThan(0.01);
    expect(moves[moves.length - 1]).toBeLessThan(1e-4);
    expect(Math.max(...turns.slice(-10))).toBeLessThan(0.05);
  });

  it("backs away from the ship watching it, then turns to the gate: the last frame is the game's first", () => {
    const s3 = tl.scene3;
    for (const fr of frames) {
      if (fr.t < s3.turnBack + 1.6 || fr.t > s3.backEnd - 1) continue;
      const toShip = fr.ship.clone().sub(fr.pos).normalize();
      // On the ship (its middle, its door, its stair, its engines): within its 12 m half-length of its middle, and a little more.
      const d = fr.ship.distanceTo(fr.pos);
      expect(fr.dir.angleTo(toShip), `t ${fr.t}`).toBeLessThan(Math.asin(Math.min(1, 12 / d)) + (10 * Math.PI) / 180);
    }
    const last = frames[frames.length - 1];
    expect(last.feet.x).toBeCloseTo(HOME.position[0], 6);
    expect(last.feet.z).toBeCloseTo(HOME.position[1], 6);
    const home = new Vector3(-Math.sin(HOME.yaw) * Math.cos(HOME.pitch), Math.sin(HOME.pitch), -Math.cos(HOME.yaw) * Math.cos(HOME.pitch));
    expect(last.dir.angleTo(home)).toBeLessThan(1e-6);
  });
});

describe("the intro's sound", () => {
  it("couples the ship's cabin through its hull, its open door, and not at all in vacuum", () => {
    const shut = transmission('outside', 'cabin', 0, 0, 0, { open: 0, vacuum: false });
    const open = transmission('outside', 'cabin', 0, 0, 0, { open: 1, vacuum: false });
    const space = transmission('cabin', 'outside', 0, 0, 0, { open: 1, vacuum: true });
    expect(shut.gain).toBeLessThan(0.03);
    expect(shut.cutoff).toBeLessThan(400);
    expect(open.gain).toBeGreaterThan(0.4);
    expect(open.cutoff).toBeGreaterThan(10000);
    expect(space.gain).toBe(0);
    // A crack of the door already leaks more than the hull.
    expect(hullPath(0.05).gain).toBeGreaterThan(hullPath(0).gain * 4);
    // Into the city from the cabin: the hull, then the band's path in.
    expect(transmission('cabin', 'city', 0, 0, 0, { open: 1, vacuum: false }).gain).toBeLessThan(0.01);
    // The other zones are as they were.
    expect(transmission('outside', 'chamber', 0, 0)).toEqual(transmission('outside', 'chamber', 0, 0, 0, { open: 1, vacuum: true }));
  });

  it("rings the cabin briefly: a small hard room", () => {
    const [l] = synthesizeImpulse(REVERBS.cabin, 48000, 3);
    const energy = (a: number, b: number) => {
      let e = 0;
      for (let i = Math.round(a * 48000); i < Math.min(l.length, Math.round(b * 48000)); i++) e += l[i] * l[i];
      return e;
    };
    // 30 dB down within half a second (T60 ~0.33 s in the mids).
    expect(10 * Math.log10(energy(0.45, 0.5) / energy(0.05, 0.1))).toBeLessThan(-25);
    expect(REVERBS.cabin.length).toBeLessThan(1.5);
  });

  it("chimes two bars and confirms with a short tone, without clicks", () => {
    const sr = 48000;
    const chime = synthChime(sr);
    expect(chime.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeCloseTo(1, 5);
    expect(Math.abs(chime[0])).toBeLessThan(0.01);
    // The second bar strikes 0.42 s in: energy rises again there.
    const rms = (a: number, b: number) => Math.sqrt(chime.slice(a * sr, b * sr).reduce((s, v) => s + v * v, 0) / ((b - a) * sr));
    expect(rms(0.43, 0.5)).toBeGreaterThan(rms(0.35, 0.41));
    const tone = synthConfirm(sr);
    expect(tone.length / sr).toBeLessThan(0.1);
    expect(Math.abs(tone[tone.length - 1])).toBeLessThan(0.02);
  });
});

describe("the intro's review parameters", () => {
  it("reads ?intro, ?introView and ?introReview", () => {
    const p = readDebugParams('?intro=42.5:hold&introView=30,50,2.35', 'localhost');
    expect(p.intro).toEqual({ at: 42.5, hold: true });
    expect(p.introView).toEqual([30, 50, 2.35]);
    expect(readDebugParams('?intro=12', 'localhost').intro).toEqual({ at: 12, hold: false });
    expect(readDebugParams('', 'localhost').intro).toBeNull();
    // The review mode: local hosts only, like every review parameter.
    expect(readDebugParams('?introReview', 'localhost').introReview).toBe(true);
    expect(readDebugParams('', 'localhost').introReview).toBe(false);
    expect(readDebugParams('?introReview', 'dyson.example.com').introReview).toBe(false);
  });
});
