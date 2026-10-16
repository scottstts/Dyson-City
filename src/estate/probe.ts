/**
 * The estate's reflection probe (docs/estate.md "Light"): one cube capture 5 m over the forecourt's
 * island (open air on every side: a capture inside anything sees only that from within, and lights
 * the whole estate ~10× too dark), holding the sky through the glass, the Dome's frame, the platform, the field, the house
 * and the estate's walls and buildings (lit by the Dome's interior capture: one bounce). The
 * estate's materials, the house's exterior, the pool and the glass look it up with parallax
 * correction (a sphere about the capture point, closed below by the terrace), so the house sits in
 * the pool where the house stands, and the field's gold shows in the glasshouse.
 *
 * It refreshes as the field's probes do (a face per frame, every 1° of the frame's turn), never
 * while the eye is indoors (nothing outdoors is lit for it then but what the windows frame).
 */
import type { Node, Object3D, WebGPURenderer } from 'three/webgpu';
import { createEnvironment, type Environment } from '../sky/environment';
import type { Sky } from '../sky/skyNode';
import { parallaxEnvironment } from '../render/parallaxEnv';
import { PROBE } from '../field/probes';
import { FORECOURT, TERRACE_Y } from './layout';

export const ESTATE_PROBE = { centre: [FORECOURT.centre[0], TERRACE_Y + 5, FORECOURT.centre[1]] as [number, number, number], radius: 115 } as const;

export interface EstateProbe {
  readonly environment: Environment;
  /** The env node for materials (parallax-corrected). */
  readonly env: Node;
  update(gameTime: number): void;
}

export function createEstateProbe(renderer: WebGPURenderer, sky: Sky, startTime: number, scene: { extras: Object3D[]; interior: Environment; transmittance: number }): EstateProbe {
  const environment = createEnvironment(renderer, sky, ESTATE_PROBE.centre[1], startTime, {
    position: ESTATE_PROBE.centre,
    extras: scene.extras,
    extrasEnvironment: scene.interior.target.texture,
    transmittance: scene.transmittance,
    shareSky: scene.interior,
    size: PROBE.size,
    refreshAngle: PROBE.refreshAngle,
    name: 'environment.probe.estate',
  });
  const env = parallaxEnvironment(environment.target.texture, { centre: ESTATE_PROBE.centre, radius: ESTATE_PROBE.radius, groundY: TERRACE_Y });
  return { environment, env, update: (t) => environment.update(t) };
}
