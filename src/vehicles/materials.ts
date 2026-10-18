/**
 * Materials shared by the vehicles (docs/vehicles.md). Their finishes are the refs' own (colour,
 * metalness, roughness, clearcoat) on the game's physical lighting:
 *
 *  - The refs' studio tricks are dropped: the car's porcelain tinted by its normal (a painted light
 *    gradient) takes the tint's mean; the light here comes from the environment and the star.
 *  - Lighting is image-based, as everywhere in the Dome: `env` is the probe the vehicle reflects,
 *    `ao` the star-shade where it stands.
 *  - Lamps glow on the game's radiance scale (`world/radiometry.ts`: the star's disc is ~10, the
 *    camera blooms what exceeds ~15 % of it). At noon a lamp is not much brighter than sunlit white
 *    paint, so the refs' studio multipliers map to trim at a few units, running and brake lamps a
 *    little above.
 */
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import { color, float, mrt, normalView, packNormalToRGB, uniform, vec4, velocity } from 'three/tsl';

type F = Node<'float'>;

export interface VehicleLook {
  /** Environment for every material (a probe's parallax node). */
  env?: Node;
  /** The star-shade where the vehicle stands (an AO term on image-based light). */
  ao?: () => F;
}

/** The refs' clearcoated metal (`metal(hex, roughness)`). */
export function vehicleMetal(name: string, hex: string, roughness: number, { metalness = 1, clearcoat = 0.35, clearcoatRoughness = 0.16 } = {}): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial({ metalness, roughness, clearcoat, clearcoatRoughness });
  m.name = name;
  m.colorNode = color(hex);
  m.roughnessNode = float(roughness);
  return m;
}

/** A plain standard finish (the refs' black, rubber). */
export function vehicleStandard(name: string, hex: string, metalness: number, roughness: number): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ metalness, roughness });
  m.name = name;
  m.colorNode = color(hex);
  return m;
}

/** A lamp: its surface colour, glowing `radiance` × colour, scaled by a live level (0 off, 1 lit). */
export function vehicleLamp(name: string, surface: string, glow: string, radiance: number, level = uniform(1)): { material: MeshStandardNodeMaterial; level: { value: number } } {
  const m = new MeshStandardNodeMaterial({ metalness: 0.15, roughness: 0.25 });
  m.name = name;
  m.colorNode = color(surface);
  m.emissiveNode = color(glow).mul(radiance).mul(level);
  return { material: m, level: level as unknown as { value: number } };
}

/** Binds the look to every material of a set. */
export function applyLook(mats: readonly (MeshStandardNodeMaterial | MeshPhysicalNodeMaterial)[], look: VehicleLook): void {
  for (const m of mats) {
    if (look.env) m.envNode = look.env;
    if (look.ao) m.aoNode = look.ao();
    m.needsUpdate = true;
  }
}

/**
 * The scene pass's normal attachment for a see-through or additive surface: its own packed view
 * normal, and 0 in alpha, the contact-AO weight (no contact AO for what is behind it).
 */
export function noContactNormal() {
  return vec4(packNormalToRGB(normalView), 0);
}

/** A see-through pane writes its own normal (no contact AO for what is behind it) and velocity. */
export function paneTargets(m: MeshPhysicalNodeMaterial): void {
  m.mrtNode = mrt({ normal: noContactNormal(), velocity });
}
