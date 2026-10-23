/**
 * Scene 1's sky and light (docs/intro-space.md): the sphere seen from outside as the sky (a
 * fullscreen sky mesh, like the band's), and one prefiltered capture of it from the ship, which
 * lights the ship inside and out (ship/env.ts). Nothing moves out there in the scene's 45 s that
 * the eye could see (the ship closes 2,500 km of 2,100,000), so the capture is taken once at boot.
 */
import { type Texture, type WebGPURenderer } from 'three/webgpu';
import { float, fwidth, length, uniform, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Sky, SkyOptions } from '../../sky/skyNode';
import { createSkyMesh, type SkyMesh } from '../../sky/skyMesh';
import { createEnvironment, type Environment } from '../../sky/environment';
import { createExterior, exteriorView, type Exterior, type ExteriorDeps } from './exterior';

type V3 = Node<'vec3'>;

/**
 * Scene 1's framing: 2.35 radii out, 30° above the band, between a wide opening and a slot. The
 * dark gores fill the view, the band arcs across them under a hub collar, and the star blazes
 * through the slot's seam. Facing a wide opening instead, the star filled its middle and its
 * blaze swallowed the sphere.
 */
export const SCENE1_VIEW = {
  distance: 2.35,
  lat: (30 * Math.PI) / 180,
  lon: (50 * Math.PI) / 180,
  /** Where the centre lies from the cockpit (ship frame: x forward, y up, z starboard). */
  centreDir: [1, 0.035, 0.07] as [number, number, number],
  roll: (-7 * Math.PI) / 180,
} as const;

export interface SpaceView {
  readonly exterior: Exterior;
  /** The sky drawn behind everything in scene 1 (velocity: the eye turning only). */
  readonly sky: SkyMesh;
  /** Its prefiltered capture from the ship: the ship's light out here, inside and out. */
  readonly environment: Environment;
  readonly texture: Texture;
  dispose(): void;
}

export function createSpaceView(renderer: WebGPURenderer, deps: ExteriorDeps, from?: [number, number, number]): SpaceView {
  const exterior = createExterior(deps);
  const deg = Math.PI / 180;
  exterior.setView(exteriorView(from ? { ...SCENE1_VIEW, lat: from[0] * deg, lon: from[1] * deg, distance: from[2] } : SCENE1_VIEW));
  const radiance = (dir: V3) => exterior.radiance(dir, length(fwidth(dir)).max(1e-6) as unknown as Node<'float'>);
  // A Sky for the game's own sky mesh and capture: nothing out here moves with the band's frame.
  const options: SkyOptions = {
    debug: uniform(0) as unknown as Node<'float'>,
    nearGroundAlbedo: vec3(0) as unknown as Node<'vec3'>,
    deckAlbedo: vec3(0) as unknown as Node<'vec3'>,
    padEdgeSinDepression: float(0) as unknown as Node<'float'>,
    frame: uniform(0) as unknown as Node<'float'>,
  };
  const sky: Sky = {
    radiance,
    // Motion 0: fixed in the view's frame (the eye's turning alone moves it on screen).
    radianceMotion: (dir) => vec4(radiance(dir), 0) as unknown as Node<'vec4'>,
    options,
  };
  const skyMesh = createSkyMesh(sky, { velocity: true });
  skyMesh.mesh.name = 'IntroSpace.sky';
  skyMesh.mesh.visible = false;
  // One capture at the cockpit, never refreshed.
  const environment = createEnvironment(renderer, sky, 0, 0, { size: 256, refreshAngle: Infinity, name: 'environment.introSpace' });
  return {
    exterior,
    sky: skyMesh,
    environment,
    texture: environment.target.texture,
    dispose() {
      skyMesh.mesh.removeFromParent();
      skyMesh.mesh.geometry.dispose();
      environment.dispose();
    },
  };
}
