/**
 * The ship's lights (docs/intro-ship.md, "Lights"): lenses whose glass glows, by slot (slots.ts).
 *
 *  - Navigation lights, steady while the ship has power: red to port, green to starboard on the
 *    nacelles' outboard faces, white at the tail.
 *  - Anti-collision lights: white strobes on the fins' tips, a double flash every 1.4 s; red
 *    beacons over the spine and under the belly, a pulse every second, out of phase.
 *  - Landing lights in the chin and on the nose leg, while the gear is down and the engines run.
 *
 * Off, each lens is its tinted glass. The radiances are scene units against the cabin's diffusers
 * (materials.ts LAMP_RADIANCE): a LED lens is far brighter than a diffuser, a strobe's flash brighter
 * still.
 */
import { MeshStandardNodeMaterial, type Material } from 'three/webgpu';
import { color, exp, float, fract, max, uniform } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { SHIP_SLOT as S } from './slots';

type F = Node<'float'>;

const RADIANCE = { nav: 30, strobe: 600, beacon: 160, landing: 220 } as const;

export interface ShipLights {
  readonly materials: Record<number, Material>;
  /** Per frame: seconds (the flashes' clock), power (0/1), landing lights (0/1). */
  set(time: number, power: number, landing: number): void;
}

export function createShipLights(): ShipLights {
  const time = uniform(0);
  const power = uniform(0);
  const landing = uniform(0);
  const t = time as unknown as F;
  // Strobe: a double flash (60 ms apart) every 1.4 s. Beacon: a 1 s pulse, decaying.
  const s = fract(t.div(1.4));
  const strobe = exp(s.mul(-90)).add(exp(max(s.sub(0.09), 0).mul(-90)).mul(s.greaterThan(0.09).select(float(1), float(0))));
  const beacon = exp(fract(t.add(0.5)).mul(-7));
  const lens = (name: string, glass: string, glow: string, level: F): MeshStandardNodeMaterial => {
    const m = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.08 });
    m.name = `Ship.light.${name}`;
    m.colorNode = color(glass);
    m.emissiveNode = color(glow).mul(level);
    return m;
  };
  const p = power as unknown as F;
  const materials: Record<number, Material> = {
    [S.navRed]: lens('navRed', '#2a0505', '#ff2a14', p.mul(RADIANCE.nav)),
    [S.navGreen]: lens('navGreen', '#05230d', '#22ff7a', p.mul(RADIANCE.nav)),
    [S.navWhite]: lens('navWhite', '#1c1d1f', '#fff4e6', p.mul(RADIANCE.nav)),
    [S.strobe]: lens('strobe', '#1c1d1f', '#f4f6ff', p.mul(strobe).mul(RADIANCE.strobe)),
    [S.beacon]: lens('beacon', '#2a0505', '#ff2210', p.mul(beacon).mul(RADIANCE.beacon)),
    [S.landing]: lens('landing', '#1c1d1f', '#fff6ea', (landing as unknown as F).mul(RADIANCE.landing)),
  };
  return {
    materials,
    set(seconds, on, land) {
      (time as unknown as { value: number }).value = seconds;
      (power as unknown as { value: number }).value = on;
      (landing as unknown as { value: number }).value = land;
    },
  };
}
