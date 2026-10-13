/**
 * The sky as a fullscreen triangle drawn first in the scene pass. The view ray is rebuilt per pixel
 * from the (jittered) inverse projection, so it is exact for any camera, including environment
 * cube faces. It writes no depth (the cleared reversed-depth 0 marks sky for AO, aerial perspective
 * and TAA) and overrides the velocity MRT with a rotation-only reprojection: the sky is at infinity,
 * so walking does not move it and turning moves it exactly.
 */
import { BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, NodeMaterial, type PerspectiveCamera } from 'three/webgpu';
import { vec2, vec4, screenUV, cameraProjectionMatrixInverse, cameraWorldMatrix, normalize, uniform, mrt, attribute } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Sky } from './skyNode';

export interface SkyMesh {
  readonly mesh: Mesh;
  /** Call once per frame before rendering with the unjittered camera. */
  updateHistory(camera: PerspectiveCamera): void;
}

export function viewDirectionNode(): Node<'vec3'> {
  const ndc = vec2(screenUV.x.mul(2).sub(1), screenUV.y.mul(-2).add(1));
  const view = cameraProjectionMatrixInverse.mul(vec4(ndc, 0.5, 1.0));
  const dirView = normalize(view.xyz.div(view.w));
  return normalize(cameraWorldMatrix.mul(vec4(dirView, 0.0)).xyz) as unknown as Node<'vec3'>;
}

export function createSkyMesh(sky: Sky, opts: { velocity: boolean }): SkyMesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new NodeMaterial();
  material.name = 'Sky';
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  material.lights = false;
  material.vertexNode = vec4(attribute('position', 'vec3').xy, 0.0, 1.0);
  const dir = viewDirectionNode();
  material.colorNode = vec4(sky.radiance(dir), 1.0);

  const currViewProj = uniform(new Matrix4());
  const prevViewProj = uniform(new Matrix4());
  if (opts.velocity) {
    const cur = currViewProj.mul(vec4(dir, 0.0));
    const prev = prevViewProj.mul(vec4(dir, 0.0));
    const vel = cur.xy.div(cur.w).sub(prev.xy.div(prev.w));
    material.mrtNode = mrt({ velocity: vec4(vel, 0.0, 1.0) });
  }

  const mesh = new Mesh(geometry, material);
  mesh.name = 'Sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1e9;

  const rot = new Matrix4();
  const next = new Matrix4();
  let primed = false;
  return {
    mesh,
    updateHistory(camera) {
      rot.copy(camera.matrixWorldInverse).setPosition(0, 0, 0);
      next.multiplyMatrices(camera.projectionMatrix, rot);
      const prevM = prevViewProj.value as Matrix4;
      const curM = currViewProj.value as Matrix4;
      prevM.copy(primed ? curM : next);
      curM.copy(next);
      primed = true;
    },
  };
}


