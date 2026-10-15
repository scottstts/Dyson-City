/**
 * The field's reflection probes (docs/field.md, "Reflections"). Gold is a mirror of the world, so
 * each zone is lit by a cube capture taken where it stands, looked up with parallax correction
 * (render/parallaxEnv.ts: a sphere about the capture point, closed below by the platform), so the
 * pale ground, the neighbouring machines, the Dome's frame and the house sit roughly where they are.
 *
 * Each capture renders the sky through the glass, the Dome's frame, the platform and the field's
 * static meshes (lit by the Dome's interior capture: one bounce). Moving parts are not in them.
 *
 * Cost: captured at boot; afterwards refreshed one probe at a time as the frame turns (the sky in
 * them moves), a face per frame, so the refresh never stacks up in one frame.
 */
import type { Node, Object3D, WebGPURenderer } from 'three/webgpu';
import { createEnvironment, type Environment } from '../sky/environment';
import type { Sky } from '../sky/skyNode';
import { parallaxEnvironment } from '../render/parallaxEnv';
import type { Field, FieldZone } from './field';
import { FIELD_Y } from './layout';

/** Probe face size, and the frame rotation between refreshes (1°: about every 20 s). */
export const PROBE = { size: 256, refreshAngle: Math.PI / 180 } as const;

export interface FieldProbes {
  /** Advances the round-robin refresh (call once per frame). */
  update(gameTime: number): void;
}

export function createFieldProbes(renderer: WebGPURenderer, sky: Sky, field: Field, startTime: number, scene: { extras: Object3D[]; interior: Environment; transmittance: number; shade?: () => Node<'float'> }): FieldProbes {
  // Zones that share a capture point share a probe.
  const byKey = new Map<string, { env: Environment; zone: FieldZone }>();
  const copies = field.captureCopies({});
  let first: Environment | undefined;
  for (const z of field.zones) {
    const key = z.probe.centre.join(',');
    if (byKey.has(key)) continue;
    const env = createEnvironment(renderer, sky, z.probe.centre[1], startTime, {
      position: z.probe.centre,
      extras: [...scene.extras.map((o) => o.clone()), ...copies.map((o) => o.clone())],
      extrasEnvironment: scene.interior.target.texture,
      transmittance: scene.transmittance,
      shareSky: scene.interior,
      // Probes refresh one at a time and are all one size: they share one prefilter.
      sharePmrem: first,
      size: PROBE.size,
      refreshAngle: PROBE.refreshAngle,
      name: `environment.probe.${z.name}`,
    });
    first ??= env;
    byKey.set(key, { env, zone: z });
  }
  field.setLook((z) => {
    const p = byKey.get(z.probe.centre.join(','))!;
    return { env: parallaxEnvironment(p.env.target.texture, { centre: z.probe.centre, radius: z.probe.radius, groundY: FIELD_Y }), shade: scene.shade };
  });
  const probes = [...byKey.values()].map((p) => p.env);
  let next = 0;
  return {
    update(t) {
      // One probe at a time: stay on it while it is mid-refresh.
      const env = probes[next];
      env.update(t);
      if (!env.busy) next = (next + 1) % probes.length;
    },
  };
}
