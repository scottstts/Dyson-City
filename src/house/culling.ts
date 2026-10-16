/**
 * The outdoors seen from inside the house (docs/house.md "Integration"): when the eye is indoors,
 * only what a window (or an outer doorway) in view can show is drawn. Each opening facing the eye
 * and in the camera's frustum makes a frustum of its own (the eye through the opening's rectangle,
 * near plane on the opening); an outdoor mesh is drawn if its bounding sphere meets any of them.
 * Outdoors everything is restored.
 */
import { Frustum, Matrix4, Plane, Sphere, Vector3, type Camera, type Mesh, type Object3D } from 'three/webgpu';
import type { Aperture } from './compile';

interface Opening {
  centre: Vector3;
  outward: Vector3;
  corners: Vector3[];
  box: { min: Vector3; max: Vector3 };
}

const sphere = new Sphere();
const toEye = new Vector3();
const projView = new Matrix4();

export class IndoorCulling {
  private readonly openings: Opening[] = [];
  private readonly outdoor: Mesh[] = [];
  private readonly frustum = new Frustum();
  private readonly planes: Plane[][] = [];
  private active = false;

  add(apertures: Aperture[], houseMatrix: Matrix4): void {
    for (const a of apertures) {
      const min = new Vector3(...a.min);
      const max = new Vector3(...a.max);
      const centre = min.clone().add(max).multiplyScalar(0.5);
      const out = new Vector3(a.outward[0], 0, a.outward[1]);
      const across = new Vector3(-out.z, 0, out.x);
      const half = Math.abs(across.x) * (max.x - min.x) * 0.5 + Math.abs(across.z) * (max.z - min.z) * 0.5;
      const corners = [
        [-1, min.y],
        [1, min.y],
        [1, max.y],
        [-1, max.y],
      ].map(([s, y]) => new Vector3(centre.x + across.x * half * s, y, centre.z + across.z * half * s).applyMatrix4(houseMatrix));
      const worldMin = new Vector3(Infinity, Infinity, Infinity);
      const worldMax = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const c of corners) {
        worldMin.min(c);
        worldMax.max(c);
      }
      this.openings.push({
        centre: centre.applyMatrix4(houseMatrix),
        outward: out.transformDirection(houseMatrix),
        corners,
        box: { min: worldMin, max: worldMax },
      });
    }
  }

  /** Meshes outdoors (the field, the estate) that may be culled indoors. */
  track(objects: Object3D[]): void {
    for (const o of objects) {
      o.traverse((c) => {
        const m = c as Mesh;
        if (m.isMesh && m.geometry) {
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          this.outdoor.push(m);
        }
      });
    }
  }

  update(camera: Camera, indoors: boolean): void {
    if (!indoors) {
      if (this.active) for (const m of this.outdoor) m.visible = true;
      this.active = false;
      return;
    }
    this.active = true;
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(projView);
    const eye = camera.position;
    this.planes.length = 0;
    for (const o of this.openings) {
      // Facing the eye from outside it (the eye is on the room's side), and in view.
      if (toEye.copy(eye).sub(o.centre).dot(o.outward) > -0.05) continue;
      if (!this.frustum.intersectsBox(o.box as unknown as import('three/webgpu').Box3)) continue;
      const planes: Plane[] = [];
      for (let i = 0; i < 4; i++) {
        const a = o.corners[i];
        const b = o.corners[(i + 1) % 4];
        const p = new Plane().setFromCoplanarPoints(eye, a, b);
        // Keep the plane's positive side toward the opening's middle.
        if (p.distanceToPoint(o.centre.clone().addScaledVector(o.outward, 1)) < 0) p.negate();
        planes.push(p);
      }
      planes.push(new Plane().setFromNormalAndCoplanarPoint(o.outward, o.centre));
      this.planes.push(planes);
    }
    for (const m of this.outdoor) {
      sphere.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld);
      m.visible = this.planes.some((planes) => planes.every((p) => p.distanceToPoint(sphere.center) > -sphere.radius));
    }
  }
}
