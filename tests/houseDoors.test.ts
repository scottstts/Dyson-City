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
});
