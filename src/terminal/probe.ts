/**
 * The Stand's reflection probe (docs/terminal.md): one cube capture 4 m over the deck's middle, in
 * open air, holding the sky through the glass, the Dome's frame, the gatehouse, the platform, the
 * field, the house and the estate, and the Stand itself (lit by the Dome's interior capture: one
 * bounce). The Stand's materials look it up with parallax correction (a sphere about the capture
 * point, closed below by the deck), so the bronze rails and the polished deck mirror the gate, the
 * Cordon and the towers where they stand. It refreshes as the field's probes do, never indoors.
 */
import type { Node, Object3D, WebGPURenderer } from 'three/webgpu';
import { createEnvironment, type Environment } from '../sky/environment';
import type { Sky } from '../sky/skyNode';
import { parallaxEnvironment } from '../render/parallaxEnv';
import { PROBE } from '../field/probes';
import { DECK_Y, STAND } from './layout';

export const STAND_PROBE = { centre: [STAND.cx, DECK_Y + 4, STAND.cz] as [number, number, number], radius: 70 } as const;

export interface StandProbe {
  readonly environment: Environment;
  readonly env: Node;
  update(gameTime: number): void;
}

export function createStandProbe(renderer: WebGPURenderer, sky: Sky, startTime: number, scene: { extras: Object3D[]; interior: Environment; transmittance: number }): StandProbe {
  const environment = createEnvironment(renderer, sky, STAND_PROBE.centre[1], startTime, {
    position: STAND_PROBE.centre,
    extras: scene.extras,
    extrasEnvironment: scene.interior.target.texture,
    transmittance: scene.transmittance,
    shareSky: scene.interior,
    size: PROBE.size,
    refreshAngle: PROBE.refreshAngle,
    name: 'environment.probe.stand',
  });
  const env = parallaxEnvironment(environment.target.texture, { centre: STAND_PROBE.centre, radius: STAND_PROBE.radius, groundY: DECK_Y });
  return { environment, env, update: (t) => environment.update(t) };
}
