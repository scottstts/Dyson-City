/**
 * The crew's models alone, for modelling review (tools/crew-shots/shots.mjs): a robot posed by its
 * real rig and FK, in its real materials, under a plain studio environment and a key light from
 * overhead (the star is always overhead), on a grey floor. Not the game's light: this is for form,
 * seams and joints.
 */
import { ACESFilmicToneMapping, AmbientLight, DirectionalLight, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, PMREMGenerator, Scene, CircleGeometry, Vector3, WebGPURenderer } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { emitParts } from '../../src/geometry/polyMesh';
import { createCrewMaterials, CREW_SLOTS } from '../../src/crew/materials';
import { Pose, solveFK, type RigDef } from '../../src/crew/rig';
import { moved } from '../../src/crew/kit/shapes';
import { REVIEW_MODELS, reviewContext, reviewPose } from './models';

const W = 1100;
const H = 1100;
const renderer = new WebGPURenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const ready = renderer.init();

const scene = new Scene();
const camera = new PerspectiveCamera(30, W / H, 0.01, 200);
const mats = createCrewMaterials();
const floor = new Mesh(new CircleGeometry(30, 64).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x8a8782, roughness: 0.9 }));
scene.add(floor);
const sun = new DirectionalLight(0xffffff, 2.4);
sun.position.set(0.6, 6, 1.4);
scene.add(sun);
scene.add(new AmbientLight(0xffffff, 0.15));
let envDone = false;

const built = new Map<string, RigDef>();
let current: Mesh[] = [];

function show(rig: RigDef, pose: Pose): { min: Vector3; max: Vector3 } {
  for (const m of current) scene.remove(m);
  current = [];
  const world = rig.segments.map(() => new Matrix4());
  solveFK(rig, new Matrix4(), pose, world);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  rig.segments.forEach((s, i) => {
    if (!s.parts.length) return;
    const local = s.parts.map((p) => moved(p.mesh, [-s.pivot[0], -s.pivot[1], -s.pivot[2]]));
    const g = emitParts(local, { slots: CREW_SLOTS });
    const m = new Mesh(g, mats);
    m.matrixAutoUpdate = false;
    m.matrix.copy(world[i]);
    scene.add(m);
    current.push(m);
    g.computeBoundingBox();
    const b = g.boundingBox!.clone().applyMatrix4(world[i]);
    min.min(b.min);
    max.max(b.max);
  });
  return { min, max };
}

/**
 * Renders `model` in `pose` (a name the review models know, with time t) from `view`: an azimuth
 * in degrees (0: from the front), an elevation, and a zoom on a point ('full', or a segment name).
 */
async function shot(model: string, pose: string, t: number, az: number, el: number, focus: string, span: number): Promise<void> {
  await ready;
  if (!envDone) {
    const pm = new PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.6;
    envDone = true;
  }
  let rig = built.get(model);
  if (!rig) {
    rig = REVIEW_MODELS[model]();
    built.set(model, rig);
  }
  const p = reviewPose(model, rig, pose, t);
  const box = show(rig, p.pose);
  // The floor under the model's lowest point.
  floor.position.y = box.min.y - 0.001;
  for (const m of reviewContext(model)) {
    scene.add(m);
    current.push(m);
  }
  let c = box.min.clone().add(box.max).multiplyScalar(0.5);
  let size = box.max.clone().sub(box.min).length();
  if (focus !== 'full') {
    const i = rig.segments.findIndex((s) => s.name === focus);
    if (i >= 0) {
      const world = rig.segments.map(() => new Matrix4());
      solveFK(rig, new Matrix4(), p.pose, world);
      c = new Vector3().setFromMatrixPosition(world[i]);
    }
    size = span;
  }
  const d = (size * 0.62) / Math.tan((camera.fov * Math.PI) / 360);
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  camera.position.set(c.x + Math.sin(a) * Math.cos(e) * d, c.y + Math.sin(e) * d, c.z + Math.cos(a) * Math.cos(e) * d);
  camera.lookAt(c);
  camera.near = d * 0.05;
  camera.updateProjectionMatrix();
  // The page's screenshot takes the presented frame (a WebGPU canvas reads back only in its own task).
  await renderer.renderAsync(scene, camera);
}

(window as unknown as { shot: typeof shot }).shot = shot;
