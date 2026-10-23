/**
 * The ship's materials by slot (slots.ts; docs/intro-ship.md, "Materials"). Outside it is black,
 * told apart by finish rather than colour: a satin black ceramic-composite skin under a clear coat,
 * matte black reveals, dark titanium machinery, nozzles heat-tinted by their burns. Inside,
 * charcoal liners, a graphite floor, black consoles, satin aluminium trim, dark leather.
 *
 * Outside, every material is lit by image-based light (env.ts). Inside, by the cabin's bake
 * (cabinLight.ts): the cabin's and the door leaf's cabin slots are the same finishes with each its
 * own baked light, so the leaf's are copies.
 */
import { DoubleSide, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, type Material, type Node, type Texture } from 'three/webgpu';
import { clamp, color, float, mix, mrt, normalView, normalViewGeometry, packNormalToRGB, positionLocal, round, texture, uv, vec2, vec3, vec4, velocity } from 'three/tsl';
import { SHIP_SLOT, SHIP_SLOTS, isCabinSlot } from './slots';
import { CabinLight, cabinState } from './cabinLight';
import { CONSOLE_PANELS, HULL_PANELS, PLATE_PANELS, panelSkin, perforation, treadSkin, type PanelSpec } from './skin';

type V3 = Node<'vec3'>;

export interface ShipLook {
  /** Environment outside (env.ts), and the cabin's and the door leaf's inside (cabinLight.ts). */
  env: Node;
  cabinEnv: Node;
  leafEnv: Node;
}

export interface ShipMaterials {
  readonly list: Material[];
  /** The leaf's own copies of the cabin slots, by slot. */
  readonly leafCabin: ReadonlyMap<number, Material>;
  /** The list as it stands, with the leaf's own cabin slots (the door leaf's mesh). */
  leafList(): Material[];
  setLook(look: ShipLook): void;
}

/** The cabin lamps' and the screens' radiance at full (scene units): a lamp at noon is a few units. */
export const LAMP_RADIANCE = 3.0;
/** The cockpit's map lights: small bright lenses (a LED spot's radiance is far above a diffuser's). */
export const SPOT_RADIANCE = 60;
export const SCREEN_RADIANCE = 0.55;

/** The emitters' glow colours (sRGB hex; × their radiance), shared with the cabin's bake. */
export const LAMP_GLOW = '#ffe9cc';
export const SPOT_GLOW = '#fff1dc';
/** A blank screen's dim panel (linear), and the share of SCREEN_RADIANCE the dash's displays and
 *  the monitor show on average (for the bake: their images change, their mean light does not). */
export const SCREEN_PANEL: readonly [number, number, number] = [0.05, 0.065, 0.08];
export const SCREEN_MEAN = { display: 0.2, monitor: 0.5 } as const;

export interface Finish {
  name: string;
  hex: string;
  metalness: number;
  roughness: number;
  coat?: number;
  coatRoughness?: number;
  /** Dielectric specular intensity (1: F0 4 %). */
  specular?: number;
}

export const FINISH: Record<number, Finish> = {
  // A low-reflectance matte black (F0 ~2.4 %): under a star 90° across, a glossier black mirrors
  // the blaze off every upward facet and reads grey.
  [SHIP_SLOT.hull]: { name: 'hull', hex: '#2c2d30', metalness: 0, roughness: 0.58, specular: 0.6 },
  // The chamfers: paint worn through to the grey composite by handling and the weather.
  [SHIP_SLOT.hullEdge]: { name: 'hullEdge', hex: '#414347', metalness: 0, roughness: 0.52, specular: 0.65 },
  // Under the chine the hull is darker: its thermal coat.
  [SHIP_SLOT.hullLow]: { name: 'hullLow', hex: '#121214', metalness: 0, roughness: 0.66, specular: 0.55 },
  [SHIP_SLOT.hullPlate]: { name: 'hullPlate', hex: '#323337', metalness: 0, roughness: 0.55, specular: 0.6 },
  [SHIP_SLOT.reveal]: { name: 'reveal', hex: '#0a0a0b', metalness: 0, roughness: 0.72 },
  [SHIP_SLOT.titanium]: { name: 'titanium', hex: '#6a6d72', metalness: 1, roughness: 0.36 },
  [SHIP_SLOT.nozzle]: { name: 'nozzle', hex: '#4b3d33', metalness: 1, roughness: 0.42 },
  [SHIP_SLOT.rubber]: { name: 'rubber', hex: '#0d0d0d', metalness: 0, roughness: 0.88 },
  [SHIP_SLOT.matte]: { name: 'matte', hex: '#151516', metalness: 0, roughness: 0.9 },
  [SHIP_SLOT.trim]: { name: 'trim', hex: '#8c9096', metalness: 1, roughness: 0.32 },
  [SHIP_SLOT.lens]: { name: 'lens', hex: '#1a1a1a', metalness: 0, roughness: 0.15 },
  [SHIP_SLOT.hullInner]: { name: 'hullInner', hex: '#1c1d20', metalness: 0, roughness: 0.62, coat: 0.2, coatRoughness: 0.35 },
  [SHIP_SLOT.liner]: { name: 'liner', hex: '#4a4b4e', metalness: 0, roughness: 0.88 },
  [SHIP_SLOT.linerDark]: { name: 'linerDark', hex: '#2c2d30', metalness: 0, roughness: 0.84 },
  [SHIP_SLOT.floor]: { name: 'floor', hex: '#2d2e31', metalness: 0.3, roughness: 0.52 },
  [SHIP_SLOT.console]: { name: 'console', hex: '#141517', metalness: 0, roughness: 0.38, coat: 0.3, coatRoughness: 0.3 },
  [SHIP_SLOT.cabinTrim]: { name: 'cabinTrim', hex: '#a6aab0', metalness: 1, roughness: 0.3 },
  [SHIP_SLOT.leather]: { name: 'leather', hex: '#2e211a', metalness: 0, roughness: 0.55, coat: 0.15, coatRoughness: 0.4 },
  [SHIP_SLOT.cabinMatte]: { name: 'cabinMatte', hex: '#18181a', metalness: 0, roughness: 0.9 },
  [SHIP_SLOT.cabinRubber]: { name: 'cabinRubber', hex: '#101011', metalness: 0, roughness: 0.82 },
  [SHIP_SLOT.paneReveal]: { name: 'paneReveal', hex: '#0d0d0e', metalness: 0, roughness: 0.75 },
};

/**
 * The scene pass's normal for contact AO (render/sceneMrt.ts): the surface's own, not its shaded
 * relief. GTAO fed the seams' and the tread's millimetre normals sampled them at half resolution
 * with its temporal noise: a crawling dark grain over the cockpit's floor.
 */
function smoothContact() {
  return mrt({ normal: vec4(packNormalToRGB(normalViewGeometry), 1), velocity });
}

/**
 * Inside: no contact AO over a lightmap (its bake holds the occlusion, render/sceneMrt.ts); a
 * fitting lit at its corners keeps it for contact. `geometric`: the surface's own normal (above).
 */
function cabinContact(geometric: boolean) {
  const n = geometric ? normalViewGeometry : normalView;
  return mrt({ normal: vec4(packNormalToRGB(n), float(1).sub(CabinLight.lightmapped())), velocity });
}

function physical(f: Finish): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial({ metalness: f.metalness, roughness: f.roughness, clearcoat: f.coat ?? 0, clearcoatRoughness: f.coatRoughness ?? 0.2 });
  m.name = `Ship.${f.name}`;
  m.colorNode = color(f.hex);
  m.roughnessNode = float(f.roughness);
  if (f.specular !== undefined) m.specularIntensityNode = float(f.specular);
  return m;
}

/**
 * A screen's glass: black under an anti-reflective cover, glowing with what it shows (`image`, or a
 * dim procedural display: a soft panel with a few lit fields).
 */
function screen(name: string, image: Node<'vec3'> | null): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial({ metalness: 0, roughness: 0.06 });
  m.name = `Ship.${name}`;
  m.colorNode = vec3(0.01, 0.0095, 0.009);
  m.specularIntensityNode = float(0.05);
  const glow: V3 = image ?? (vec3(...SCREEN_PANEL) as unknown as V3);
  m.emissiveNode = glow.mul(SCREEN_RADIANCE).mul(cabinState.screens);
  return m;
}

/**
 * The screens' images: the monitor's canvas over its glass, and the dash's atlas, its three
 * displays side by side, each display picking its third by where it stands across the dash
 * (cockpit.ts DASH.displays). Glass UVs are the outline's metric (u, v) about its centre.
 */
export interface ScreenImages {
  monitor: Texture;
  dash: Texture;
  monitorHalf: [number, number];
  displayHalf: [number, number];
  displayPitch: number;
}

export function createShipMaterials(screens: ScreenImages): ShipMaterials {
  const S = SHIP_SLOT;
  const list: Material[] = new Array(SHIP_SLOTS);
  for (const [slot, f] of Object.entries(FINISH)) list[Number(slot)] = physical(f);
  const lamp = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.3 });
  lamp.name = 'Ship.lamp';
  lamp.colorNode = color('#f2e6d2');
  lamp.emissiveNode = color(LAMP_GLOW).mul(float(LAMP_RADIANCE)).mul(cabinState.lamps);
  list[S.lamp] = lamp;
  const spot = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.2 });
  spot.name = 'Ship.spot';
  spot.colorNode = color('#f6efe4');
  spot.emissiveNode = color(SPOT_GLOW).mul(float(SPOT_RADIANCE)).mul(cabinState.lamps);
  list[S.spot] = spot;
  list[S.screen] = screen('screen', null);
  const mon = uv().div(vec2(screens.monitorHalf[0] * 2, screens.monitorHalf[1] * 2)).add(0.5);
  list[S.monitor] = screen('monitor', texture(screens.monitor, mon).rgb as unknown as Node<'vec3'>);
  const which = clamp(round(positionLocal.z.div(screens.displayPitch)).add(1), 0, 2);
  const local = uv().div(vec2(screens.displayHalf[0] * 2, screens.displayHalf[1] * 2)).add(0.5);
  const atlas = vec2(local.x.add(which).div(3), local.y);
  list[S.display] = screen('display', texture(screens.dash, atlas).rgb as unknown as Node<'vec3'>);
  (list[S.reveal] as MeshPhysicalNodeMaterial).side = DoubleSide;
  // The skin: panelled (skin.ts), its fasteners bare titanium, its stencils painted on.
  const panelled = (slot: number, spec: PanelSpec) => {
    const m = list[slot] as MeshPhysicalNodeMaterial;
    const skin = panelSkin(spec);
    const f = FINISH[slot];
    m.colorNode = mix(mix(color(f.hex).mul(skin.albedo), color('#3a3c40'), skin.metal), skin.stencilColor, skin.stencil);
    m.roughnessNode = float(f.roughness).add(skin.roughness);
    m.metalnessNode = skin.metal.mul(0.8);
    m.normalNode = skin.normal;
    m.mrtNode = smoothContact();
  };
  panelled(S.hull, HULL_PANELS);
  panelled(S.hullEdge, { ...HULL_PANELS, stencils: 0, grime: 0.6 });
  panelled(S.hullLow, { ...HULL_PANELS, stencils: 0.15 });
  panelled(S.hullPlate, PLATE_PANELS);
  panelled(S.console, CONSOLE_PANELS);
  // The floor's tread; the liners' perforated facings.
  const floor = list[S.floor] as MeshPhysicalNodeMaterial;
  const tread = treadSkin();
  floor.normalNode = tread.normal;
  floor.mrtNode = smoothContact();
  floor.roughnessNode = float(FINISH[S.floor].roughness).add(tread.roughness);
  for (const slot of [S.liner, S.linerDark]) {
    const m = list[slot] as MeshPhysicalNodeMaterial;
    m.colorNode = color(FINISH[slot].hex).mul(perforation(0.018, 0.0028));
  }
  list.forEach((m, slot) => {
    if (isCabinSlot(slot)) (m as MeshStandardNodeMaterial).mrtNode = cabinContact(slot === S.console || slot === S.floor);
  });
  // The slots the ship fills itself (the engines' glow, the lights) are not in the list yet: the
  // leaf's list is read from it when the leaf's mesh is made.
  const leafCabin = new Map<number, Material>();
  list.forEach((m, slot) => {
    if (!isCabinSlot(slot)) return;
    const c = m.clone();
    c.name = `${m.name}.leaf`;
    leafCabin.set(slot, c);
  });
  return {
    list,
    leafCabin,
    leafList: () => Array.from({ length: SHIP_SLOTS }, (_, slot) => leafCabin.get(slot) ?? list[slot]),
    setLook(look) {
      list.forEach((m, slot) => {
        const mm = m as MeshStandardNodeMaterial;
        mm.envNode = isCabinSlot(slot) ? look.cabinEnv : look.env;
        mm.needsUpdate = true;
      });
      leafCabin.forEach((m) => {
        const mm = m as MeshStandardNodeMaterial;
        mm.envNode = look.leafEnv;
        mm.needsUpdate = true;
      });
    },
  };
}
