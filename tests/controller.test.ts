import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three/webgpu';
import { PlayerController } from '../src/player/controller';
import type { Input } from '../src/player/input';

/** The walker's falls (player/controller.ts): landing is swept over each frame's drop. */
describe('falling', () => {
  it('lands on a thin deck after a long drop instead of tunnelling through it', () => {
    // A ledge (x < 0), then a deck at 0.9 m over the ground: walking off a 5 m ledge the feet reach
    // ~9 m/s, 15 cm a frame at 60 Hz, three times the old 5 cm landing window.
    const cases = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6].flatMap((ledge) => [30, 60, 120, 144].map((fps) => [ledge, fps]));
    for (const [ledge, fps] of cases) {
      const ground = (x: number, _z: number, yMax = Infinity) => (x < 0 ? ledge : yMax >= 0.9 ? 0.9 : 0);
      const held = new Set(['KeyW']);
      const input = { down: (c: string) => held.has(c), consumeLook: () => [0, 0] } as unknown as Input;
      const p = new PlayerController(new PerspectiveCamera(), input, { ground });
      // Facing +x.
      p.spawn({ position: [-0.5, 0], yaw: -Math.PI / 2, pitch: 0 });
      let landed = false;
      p.onFoot = (e) => {
        if (e.kind === 'land') landed = true;
      };
      for (let i = 0; i < fps * 3 && !landed; i++) p.update(1 / fps);
      expect(landed, `${ledge} m at ${fps} fps`).toBe(true);
      expect(p.feet.y, `${ledge} m at ${fps} fps`).toBeCloseTo(0.9, 5);
    }
  });
});
