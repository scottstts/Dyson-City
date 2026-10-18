import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { HouseDoor, HouseDoors } from '../src/house/doors';
import { WalkMesh } from '../src/player/walkMesh';

/**
 * The doors' kinematics the sound times itself by (docs/audio.md "The house"): a closing leaf's
 * predicted time to rest must match when it actually arrives, so the recorded shut's strike lands
 * as the stile meets its stop.
 */
function door(kind: 'hinge' | 'slide', limit: number): HouseDoor {
  return new HouseDoor({ name: `Door_Test_${kind}`, kind, rest: limit, limit, translation: [0, 0, 0], handle: [0.8, 1, 0], box: [0, 0, -0.02, 0.9, 2.1, 0.02], exterior: false }, new Group());
}

describe('house doors', () => {
  for (const [kind, limit] of [['hinge', 1.6], ['hinge', -1.2], ['slide', 0.85]] as const) {
    it(`predict when a ${kind} leaf (travel ${limit}) comes to rest`, () => {
      const doors = new HouseDoors(new WalkMesh());
      const d = door(kind, limit);
      doors.add(d);
      const camera = new PerspectiveCamera();
      camera.position.set(50, 1.6, 50);
      camera.updateMatrixWorld();
      const feet = new Vector3(50, 0, 50);
      d.target = 0;
      const dt = 1 / 120;
      const predictions: [number, number][] = [];
      let t = 0;
      while (d.amount !== 0 && t < 10) {
        predictions.push([t, d.timeToTarget()]);
        doors.update(dt, camera, feet, false);
        t += dt;
      }
      expect(d.amount).toBe(0);
      // Within the shut's lead (≈ 0.3 s) the prediction is good to a frame or two.
      for (const [at, eta] of predictions) {
        const actual = t - at;
        if (actual < 0.45) expect(Math.abs(eta - actual), `at ${at.toFixed(3)}`).toBeLessThan(0.02);
      }
    });
  }

  it('offers the door the whole time the player stands near it facing it, at any pitch', () => {
    const doors = new HouseDoors(new WalkMesh());
    // A shut leaf in the plane z = 0, its handle at (0.8, 1, 0).
    const d = door('hinge', 1.6);
    d.amount = 0;
    d.target = 0;
    d.pose(0);
    doors.add(d);
    const camera = new PerspectiveCamera();
    const feet = new Vector3();
    const look = (x: number, z: number, pitch: number) => {
      feet.set(x, 0, z);
      camera.position.set(x, 1.7, z);
      camera.rotation.set(pitch, Math.PI, 0, 'YXZ');      // facing +z, toward the leaf from z < 0
      camera.updateMatrixWorld();
      doors.update(1 / 60, camera, feet, false);
      return doors.aimed === d;
    };
    // Walking up to it from 1.7 m to 0.3 m, looking ahead, down at the handle or up: always offered.
    for (let z = -1.7; z <= -0.3; z += 0.05) for (const pitch of [-0.6, 0, 0.3]) expect(look(0.8, z, pitch), `at ${z.toFixed(2)} m, pitch ${pitch}`).toBe(true);
    // A step to the side keeps it.
    expect(look(1.6, -0.8, 0)).toBe(true);
    // Walking away (3 m off), or turned round, it is not.
    expect(look(0.8, -3, 0)).toBe(false);
    camera.rotation.set(0, 0, 0);
    feet.set(0.8, 0, -1);
    camera.position.set(0.8, 1.7, -1);
    camera.updateMatrixWorld();
    doors.update(1 / 60, camera, feet, false);
    expect(doors.aimed).toBe(null);
  });
});
