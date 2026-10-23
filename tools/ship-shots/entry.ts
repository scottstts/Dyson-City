/**
 * The intro's ship alone, for modelling review (tools/ship-shots/shots.mjs): its parts in plain
 * studio materials (one tone per slot), under a studio environment and an overhead key, on a grey
 * floor. Not the game's light: this is for form, facets, seams and joints.
 */
import { ACESFilmicToneMapping, AmbientLight, CircleGeometry, DirectionalLight, DoubleSide, Mesh, MeshStandardMaterial, PerspectiveCamera, PMREMGenerator, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { emitParts } from '../../src/geometry/polyMesh';
import { SHIP_SLOTS, isCabinSlot } from '../../src/intro/ship/slots';
import { createShipMaterials } from '../../src/intro/ship/materials';
import { createShipLights } from '../../src/intro/ship/lights';
import { DataTexture, type Material } from 'three/webgpu';
import { reviewShip } from './model';

const W = 1400;
const H = 900;
const renderer = new WebGPURenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.toneMapping = ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const ready = renderer.init();

const scene = new Scene();
const camera = new PerspectiveCamera(30, W / H, 0.01, 400);
const floor = new Mesh(new CircleGeometry(60, 96).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x8a8782, roughness: 0.9 }));
scene.add(floor);
const sun = new DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 10, 4);
scene.add(sun);
scene.add(new AmbientLight(0xffffff, 0.25));

/** One tone per slot: blacks told apart by value so facets and joints read. */
const TONES = [
  // Outside: hull, reveal, titanium, nozzle, rubber, matte, trim, lens.
  0x3a3c40, 0x2a2b2e, 0x6b6f75, 0x5a4a3a, 0x151515, 0x1d1e20, 0x8d8a85, 0x101820,
  // Cabin: hullInner, liner, linerDark, floor, console, cabinTrim, leather, lamp, screen, cabinMatte,
  // cabinRubber, monitor, display, paneReveal, spot.
  0x2a2b2e, 0x55575b, 0x3a3b3e, 0x45464a, 0x203040, 0xb8bcc2, 0x5c3b2a, 0xffe2a0, 0x0a1a2a, 0x26272a,
  0x18181a, 0x0a1a2a, 0x0a1a2a, 0x1d1e20, 0xfff0d0,
  // Engine glow; lights: red, green, white, strobe, beacon, landing.
  0xff8040, 0xff2020, 0x20ff60, 0xffffff, 0xe0e8ff, 0xff3020, 0xfff4e0,
  // Hull edge, lower hull, doubler plates.
  0x6a6c70, 0x26272a, 0x44464a,
];
const GLOW = new Set([15, 22, 23, 24, 25, 26, 27, 28, 29]);
const METAL = new Set([2, 3, 6, 13]);
const mats = TONES.map((c, i) => new MeshStandardMaterial({ color: c, roughness: METAL.has(i) ? 0.3 : 0.55, metalness: METAL.has(i) ? 0.6 : 0.05, side: DoubleSide, emissive: GLOW.has(i) ? c : 0x000000, emissiveIntensity: GLOW.has(i) ? 0.8 : 0 }));
/**
 * The ship's own exterior materials (skin, lights) under the studio light, for surface review;
 * the cabin keeps its studio tones (its light is baked per vertex in the game).
 */
function realMaterials(): Material[] {
  const blank = new DataTexture(new Uint8Array([8, 8, 8, 255]), 1, 1);
  blank.needsUpdate = true;
  const ship = createShipMaterials({ monitor: blank, dash: blank, monitorHalf: [0.2, 0.125], displayHalf: [0.2, 0.1], displayPitch: 0.53 });
  const lights = createShipLights();
  lights.set(0.02, 1, 1);
  return mats.map((m, i) => (isCabinSlot(i) ? m : (lights.materials[i] ?? ship.list[i] ?? m)));
}
let real: Material[] | null = null;
let built: Mesh | null = null;
let envDone = false;

/**
 * Renders the ship (state at time t: door, stair, gear) from outside (`ext`: azimuth and elevation
 * in degrees about the ship, the framed span and the focus point) or inside (`in`: the eye's
 * position, yaw and pitch in degrees, and the field of view).
 */
async function shot(kind: string, args: number[], t: number, useReal = false): Promise<void> {
  await ready;
  if (!envDone) {
    const pm = new PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.7;
    envDone = true;
  }
  if (built) scene.remove(built);
  const parts = reviewShip(t);
  if (useReal && !real) real = realMaterials();
  built = new Mesh(emitParts(parts, { slots: SHIP_SLOTS }), useReal && real ? real : mats);
  scene.add(built);
  if (kind === 'in') {
    const [x, y, z, yaw, pitch, fov = 70] = args;
    camera.fov = fov;
    camera.position.set(x, y, z);
    const a = (yaw * Math.PI) / 180;
    const e = (pitch * Math.PI) / 180;
    // Yaw 0 looks forward (+x); positive turns to port (left).
    camera.lookAt(new Vector3(x + Math.cos(a) * Math.cos(e), y + Math.sin(e), z - Math.sin(a) * Math.cos(e)));
    camera.near = 0.02;
  } else {
    const [az, el, span = 30, cx = 0, cy = 3, cz = 0] = args;
    camera.fov = 30;
    const c = new Vector3(cx, cy, cz);
    const d = (span * 0.62) / Math.tan((camera.fov * Math.PI) / 360);
    const a = (az * Math.PI) / 180;
    const e = (el * Math.PI) / 180;
    // Azimuth 0 looks from the nose; 90 from starboard.
    camera.position.set(c.x + Math.cos(a) * Math.cos(e) * d, c.y + Math.sin(e) * d, c.z + Math.sin(a) * Math.cos(e) * d);
    camera.lookAt(c);
    camera.near = d * 0.02;
  }
  camera.updateProjectionMatrix();
  await renderer.renderAsync(scene, camera);
}

(window as unknown as { shot: typeof shot }).shot = shot;
