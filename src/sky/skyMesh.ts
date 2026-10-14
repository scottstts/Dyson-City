/**
 * The sky as a fullscreen triangle drawn first in the scene pass. The view ray is rebuilt per pixel
 * from the (jittered) inverse projection, so it is exact for any camera, including environment
 * cube faces. It writes no depth (the cleared reversed-depth 0 marks sky for AO, aerial perspective
 * and TAA) and overrides the velocity MRT with a rotation-only reprojection: the sky is at infinity,
 * so walking does not move it and turning moves it exactly. What the pixel shows may move on its
 * own: the frame turns about the spin axis (through the sphere's centre, not the observer), carrying
 * its structure and the stars beyond it, so their previous direction is the frame's last step
 * undone (skyNode.ts radianceMotion). The band, the ground and the star stay put.
 */
import { BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, NodeMaterial, Vector2, type PerspectiveCamera } from 'three/webgpu';
import { vec2, vec3, vec4, screenUV, cameraProjectionMatrixInverse, cameraWorldMatrix, normalize, uniform, mrt, attribute, select } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { SKY_MOTION_INFINITY, type Sky } from './skyNode';
import { frameSpin, rotateZ } from './structure/spin';

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

/**
 * `transmittance` scales the sky for captures taken behind glass (the Dome's interior
 * environment); the main view composites the glass in post instead.
 */
export function createSkyMesh(sky: Sky, opts: { velocity: boolean; transmittance?: number }): SkyMesh {
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
  const currViewProj = uniform(new Matrix4());
  const prevViewProj = uniform(new Matrix4());
  /** (cos, sin) of the frame's turn since the previous frame. */
  const frameStep = uniform(new Vector2(1, 0));
  if (opts.velocity) {
    const res = sky.radianceMotion(dir);
    material.colorNode = vec4(res.xyz, 1.0);
    const motion = res.w;
    const c = frameStep.x as unknown as Node<'float'>;
    const s = frameStep.y as unknown as Node<'float'>;
    const centre = vec3(0, 1, 0);
    const turned = normalize(rotateZ(dir.mul(motion).sub(centre) as unknown as Node<'vec3'>, c, s).add(centre));
    const prevDir = select(motion.lessThan(SKY_MOTION_INFINITY + 0.5), rotateZ(dir, c, s), select(motion.greaterThan(0.0), turned, dir));
    const cur = currViewProj.mul(vec4(dir, 0.0));
    const prev = prevViewProj.mul(vec4(prevDir, 0.0));
    const vel = cur.xy.div(cur.w).sub(prev.xy.div(prev.w));
    material.mrtNode = mrt({ velocity: vec4(vel, 0.0, 1.0) });
  } else {
    material.colorNode = vec4(sky.radiance(dir).mul(opts.transmittance ?? 1), 1.0);
  }

  const mesh = new Mesh(geometry, material);
  mesh.name = 'Sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1e9;

  const rot = new Matrix4();
  const next = new Matrix4();
  const lastSpin = new Vector2();
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
      // The frame's step: R(θ − θ_prev) = R(θ)·R(−θ_prev).
      const spin = frameSpin.value as Vector2;
      if (!primed) lastSpin.copy(spin);
      (frameStep.value as Vector2).set(spin.x * lastSpin.x + spin.y * lastSpin.y, spin.y * lastSpin.x - spin.x * lastSpin.y);
      lastSpin.copy(spin);
      primed = true;
    },
  };
}


