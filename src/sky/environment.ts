/**
 * Image-based lighting from the rendered sky. In this world the star is a 90° area light, so the
 * prefiltered sky radiance *is* the key light: diffuse irradiance and glossy reflections both come
 * from it, with the same radiance scale as the visible sky.
 *
 * The star is fixed overhead, but the frame and the stars turn past the band (structure/spin.ts),
 * and the glazed deck mirrors them. So the capture is refreshed whenever the frame has turned
 * REFRESH_ANGLE since the last one, with its cost spread over frames (each well under 1.5 ms): one
 * cube face of the sky per frame, then the prefilter one face of one level at a time
 * (render/pmremSlices.ts), in place, so materials keep their environment binding. Consecutive
 * captures differ by far less than the lighting resolves, so a refresh never shows.
 */
import { CubeCamera, CubeRenderTarget, HalfFloatType, PMREMGenerator, Scene, type PerspectiveCamera, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { Sky } from './skyNode';
import { createSkyMesh } from './skyMesh';
import { frameAngle } from './structure/spin';
import { createPmremSlicer } from '../render/pmremSlices';

export const ENVIRONMENT_SIZE = 512;
/** Frame rotation between captures (rad): 0.1°, every 2 s at the band's spin. */
export const REFRESH_ANGLE = (0.1 * Math.PI) / 180;

export interface Environment {
  readonly target: RenderTarget;
  /** Advances an amortised refresh (call once per frame, before rendering). */
  update(gameTime: number): void;
  dispose(): void;
}

const FACES = 6;

export function createEnvironment(renderer: WebGPURenderer, sky: Sky, eyeHeight: number, gameTime: number): Environment {
  const scene = new Scene();
  const skyMesh = createSkyMesh(sky, { velocity: false });
  scene.add(skyMesh.mesh);
  const cube = new CubeRenderTarget(ENVIRONMENT_SIZE, { type: HalfFloatType, generateMipmaps: false, depthBuffer: false });
  cube.texture.name = 'environment.cube';
  const cubeCamera = new CubeCamera(0.05, 10, cube);
  cubeCamera.position.set(0, eyeHeight, 0);
  cubeCamera.updateMatrixWorld();
  const pmrem = new PMREMGenerator(renderer);

  // Boot capture: all faces and the prefilter at once (this also compiles both shaders).
  cubeCamera.update(renderer, scene);
  const target = pmrem.fromCubemap(cube.texture);
  target.texture.name = 'environment.sky';
  const prefilter = createPmremSlicer(renderer, pmrem, cube.texture, target);

  const faceCameras = cubeCamera.children as PerspectiveCamera[];
  let captured = frameAngle(gameTime);
  let pending = captured;
  /** Next step: faces 0–5, then the prefilter's steps; −1 = idle. */
  let step = -1;

  const renderFace = (i: number) => {
    const prev = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevLevel = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(cube, i);
    renderer.render(scene, faceCameras[i]);
    renderer.setRenderTarget(prev, prevFace, prevLevel);
  };

  return {
    target,
    update(t) {
      if (step < 0) {
        const angle = frameAngle(t);
        // Shortest angular distance (the angle wraps every turn).
        const turned = Math.abs(Math.atan2(Math.sin(angle - captured), Math.cos(angle - captured)));
        if (turned < REFRESH_ANGLE) return;
        pending = angle;
        step = 0;
      }
      if (step < FACES) renderFace(step);
      else prefilter.run(step - FACES);
      if (++step === FACES + prefilter.steps) {
        captured = pending;
        step = -1;
      }
    },
    dispose: () => {
      target.dispose();
      cube.dispose();
      pmrem.dispose();
      skyMesh.mesh.geometry.dispose();
      (skyMesh.mesh.material as { dispose(): void }).dispose();
    },
  };
}
