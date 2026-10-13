/**
 * Bakes the diffuse sky beyond the shell (field.ts) into a mipmapped cube texture once at boot. The
 * field is many octaves of noise per nebula; per pixel in the sky shader it would cost more than
 * the rest of a space pixel and add register pressure to the structure trace, while the cube costs
 * one filtered fetch. The cube is indexed by frame direction (structure/spin.ts).
 *
 * At 1024² a texel is ~0.09°, finer than any nebula structure seen through the air; the point stars
 * that need to stay sharp are analytic (stars.ts).
 */
import { CubeCamera, CubeRenderTarget, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, Mesh, Scene, BufferGeometry, Float32BufferAttribute, NodeMaterial, type CubeTexture, type WebGPURenderer } from 'three/webgpu';
import { vec4, attribute } from 'three/tsl';
import { viewDirectionNode } from '../skyMesh';
import { spaceField } from './field';

export const SPACE_CUBE_SIZE = 1024;
/** Angle subtended by one texel at a face centre (rad). */
export const SPACE_TEXEL = Math.PI / 2 / SPACE_CUBE_SIZE;

export interface SpaceBackdrop {
  readonly texture: CubeTexture;
  dispose(): void;
}

export function bakeSpace(renderer: WebGPURenderer): SpaceBackdrop {
  const target = new CubeRenderTarget(SPACE_CUBE_SIZE, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, depthBuffer: false });
  target.texture.name = 'space.backdrop';

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new NodeMaterial();
  material.name = 'SpaceBake';
  material.depthTest = false;
  material.depthWrite = false;
  material.lights = false;
  material.vertexNode = vec4(attribute('position', 'vec3').xy, 0.0, 1.0);
  material.colorNode = vec4(spaceField(SPACE_TEXEL)(viewDirectionNode()), 1.0);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);

  const camera = new CubeCamera(0.1, 10, target);
  camera.update(renderer, scene);

  geometry.dispose();
  material.dispose();
  return {
    texture: target.texture,
    dispose: () => target.dispose(),
  };
}
