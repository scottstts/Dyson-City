/**
 * Lighting validation probes (?probe): a mirror sphere, a white Lambertian sphere and an 18% grey
 * sphere placed in front of the spawn. They make the environment's orientation, the key-light
 * direction and the absolute irradiance visible at a glance.
 */
import { Mesh, MeshStandardNodeMaterial, SphereGeometry, type Scene } from 'three/webgpu';
import { groundHeight } from '../ground/site';

export function addLightingProbes(scene: Scene, at: [number, number], yaw: number): void {
  const geo = new SphereGeometry(0.35, 64, 32);
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const specs: Array<[number, number, number]> = [
    // [offset right, metalness, roughness (metal) or albedo (dielectric)]
    [-2.0, 1, 0],
    [-1.0, 1, 0.25],
    [0, 0, 1],
    [1.0, 0, 0.18],
  ];
  for (const [off, metal, v] of specs) {
    const m = new MeshStandardNodeMaterial();
    if (metal) {
      if (v > 0) m.color.setRGB(0.74, 0.52, 0.33);
      else m.color.setRGB(1, 1, 1);
      m.metalness = 1;
      m.roughness = v;
    } else {
      m.color.setRGB(v, v, v);
      m.metalness = 0;
      m.roughness = 1;
    }
    const mesh = new Mesh(geo, m);
    const x = at[0] + fx * 3 + rx * off;
    const z = at[1] + fz * 3 + rz * off;
    mesh.position.set(x, groundHeight(x, z) + 1.4, z);
    mesh.name = 'probe';
    scene.add(mesh);
  }
}
