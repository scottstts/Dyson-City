/**
 * The terminal's screen glass and its lamp (docs/terminal.md).
 *
 * The screen reads as a screen whatever the eye is doing, as the user decided: everything round it
 * may blow out as the eye opens to the dark panel, the panel itself does not.
 *  - Auto-brightness: its emission is divided by the eye's adaptation (render/adaptation.ts), as a
 *    panel's ambient sensor would, so it always shows as it does to an eye keyed on the sunlit
 *    world. Its white, SCREEN_WHITE, is set for that eye.
 *  - An advanced anti-reflective cover: a fiftieth of bare glass's reflectance, its black is black.
 *    (At 0.35 white with a plain cover the eye opened ~3 stops and lifted the glass's reflection
 *    of the sky to a muddy grey.)
 */
import { MeshPhysicalNodeMaterial, type Texture } from 'three/webgpu';
import { float, texture, uv, uniform, vec3, clamp, positionLocal, attribute, uniformArray } from 'three/tsl';
import type { Node } from 'three/webgpu';

/** Radiance of the screen's white (scene units) to an unadapted eye. */
export const SCREEN_WHITE = 0.8;
/** What the cover glass's reflection sees of the sky past the hood. */
export const GLASS_SKY = 0.3;
/** The lamp's radiance, awake. */
export const LAMP_RADIANCE = 2.4;

export function createScreenMaterial(map: Texture): { material: MeshPhysicalNodeMaterial; power: { value: number } } {
  const power = uniform(0.4);
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = 'Terminal.screen';
  const st = clamp(uv(), 0.0005, 0.9995);
  mat.colorNode = vec3(0.01, 0.0095, 0.009);
  mat.roughnessNode = float(0.05);
  mat.metalnessNode = float(0);
  // An advanced anti-reflective cover: ~0.08 % reflectance.
  mat.specularIntensityNode = float(0.02);
  mat.emissiveNode = texture(map, st).rgb.mul(float(SCREEN_WHITE)).mul(power);
  mat.aoNode = float(GLASS_SKY);
  return { material: mat, power: power as unknown as { value: number } };
}

export function createLampMaterial(): { material: MeshPhysicalNodeMaterial; power: { value: number } } {
  const power = uniform(0);
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = 'Terminal.lamp';
  mat.colorNode = vec3(0.08, 0.05, 0.02);
  mat.roughnessNode = float(0.15);
  mat.metalnessNode = float(0);
  mat.emissiveNode = vec3(1.0, 0.62, 0.3).mul(float(LAMP_RADIANCE)).mul(float(0.03).add(power.mul(0.97)));
  return { material: mat, power: power as unknown as { value: number } };
}

/**
 * The keys go down as the player presses theirs: a vertex attribute names each key, and its
 * travel (0..1, set per frame) moves it along `down` by up to 2.5 mm.
 */
export function keyTravel(down: [number, number, number], keys: number): { position: Node<'vec3'>; travel: { array: number[] } } {
  const travel = uniformArray(new Array(keys).fill(0), 'float');
  const id = attribute('keyId', 'float');
  const t = (travel as unknown as { element(i: Node<'int'>): Node<'float'> }).element(id.toInt());
  const position = positionLocal.add(vec3(...down).mul(t.mul(0.0025))) as unknown as Node<'vec3'>;
  return { position, travel: travel as unknown as { array: number[] } };
}
