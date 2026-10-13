/**
 * Image-based lighting from the rendered sky. In this world the star is a 90° area light, so the
 * prefiltered sky radiance *is* the key light: diffuse irradiance and glossy reflections both come
 * from it, with the same radiance scale as the visible sky. Captured once at boot (the star is
 * fixed overhead; its surface drift changes nothing perceptible in a prefiltered environment).
 */
import { PMREMGenerator, Scene, type RenderTarget, type WebGPURenderer, Vector3 } from 'three/webgpu';
import type { Sky } from './skyNode';
import { createSkyMesh } from './skyMesh';

export const ENVIRONMENT_SIZE = 512;

export interface Environment {
  readonly target: RenderTarget;
  dispose(): void;
}

export function captureEnvironment(renderer: WebGPURenderer, sky: Sky, eyeHeight: number): Environment {
  const scene = new Scene();
  const skyMesh = createSkyMesh(sky, { velocity: false });
  scene.add(skyMesh.mesh);
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 0.05, 10, { size: ENVIRONMENT_SIZE, position: new Vector3(0, eyeHeight, 0) });
  target.texture.name = 'environment.sky';
  pmrem.dispose();
  skyMesh.mesh.geometry.dispose();
  (skyMesh.mesh.material as { dispose(): void }).dispose();
  return {
    target,
    dispose: () => target.dispose(),
  };
}
