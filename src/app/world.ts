/**
 * Assembles the world scene: sky (star, structure, atmosphere), image-based lighting captured from
 * it, the earmarked site (platform + deck) and the city's structure (the Dome).
 *
 * Two environment captures light the local scene: the open sky (outside the Dome: the deck) and the
 * view from inside the Dome (the sky through its glass, with its frame): everything under the Dome.
 * The frame itself blends the two by which way each face looks (city/materials/ceramic.ts).
 */
import { Mesh, Scene, type Node, type Vector3, type WebGPURenderer } from 'three/webgpu';
import { float, pmremTexture, positionWorld, smoothstep } from 'three/tsl';
import { createAtmosphereNodes, type AtmosphereTextures } from '../atmosphere/luts';
import { StarState } from '../sky/star/starState';
import { measureStarIlluminant } from '../sky/star/starIlluminant';
import { createSky, SKY_DEBUG, type Sky } from '../sky/skyNode';
import { createStarAtmosphere, type StarAtmosphere } from '../sky/star/atmosphere';
import { createSkyMesh, type SkyMesh } from '../sky/skyMesh';
import { createEnvironment, type Environment } from '../sky/environment';
import { createPlatformGeometry, createDeckGeometry } from '../ground/geometry';
import { createPadMaterial } from '../ground/padMaterial';
import { createDeckMaterial } from '../ground/deckMaterial';
import { PAD_HEIGHT } from '../ground/site';
import { EYE_HEIGHT } from '../world/constants';
import { updateFrameSpin } from '../sky/structure/spin';
import { bakeSpace, type SpaceBackdrop } from '../sky/space/bake';
import { CoronalGas } from '../sky/star/gas/solver';
import { buildCity, type City } from '../city/city';
import { GLASS_TRANSMISSION, type GlassComposite } from '../city/dome/glass';
import { INTERIOR_CAPTURE_Y } from '../city/dome/spec';
import { buildField, type Field } from '../field/field';
import { fieldPaving } from '../field/paving';
import { createFieldProbes } from '../field/probes';
import { addFieldWalls, occupancy } from '../field/walk';
import { createStarShade, floorMap, rasterOccluders, SHADE, type OccluderGrid } from '../lighting/starShade';
import { Crew } from '../crew/crew';
import { blendEnv } from '../crew/materials';
import { parallaxEnvironment } from '../render/parallaxEnv';
import type { OccluderMap } from '../city/visibility';
import { HOUSE_GRADE } from '../estate/levels';
import { estateFloor } from '../estate/layout';
import { createEstateProbe } from '../estate/probe';
import { FIELD_Y } from '../field/layout';
import { House } from '../house/house';
import { buildEstate, type Estate } from '../estate/estate';
import type { HouseAssets } from '../house/assets';
import { buildVehicles, type Vehicles } from '../vehicles/vehicles';
import { buildStand, type Stand } from '../terminal/stand';
import { standFloor } from '../terminal/walk';
import { createStandProbe } from '../terminal/probe';

export interface World {
  readonly scene: Scene;
  readonly star: StarState;
  readonly sky: Sky;
  readonly skyMesh: SkyMesh;
  readonly environment: Environment;
  /** The environment captured inside the Dome. */
  readonly interior: Environment;
  /** Thin layers composited in post (render/pipeline.ts): the Dome's glass, the chamber's mist. */
  readonly composites: GlassComposite[];
  /** Thin layers of the eye's own surroundings, wherever it is (the intro's ship's canopy). */
  readonly localComposites: GlassComposite[];
  /** The city's structure: the gate's airlock, walls and walkable surfaces. */
  readonly city: City;
  /** The Field: the Halo, the heroes and the network (docs/field.md). */
  readonly field: Field;
  /** The house on the estate's terrace (docs/house.md). */
  readonly house: House;
  /** The estate round it (docs/estate.md). */
  readonly estate: Estate;
  /** The car and the craft (docs/vehicles.md). */
  readonly vehicles: Vehicles;
  /** The Stand by the West Gate and its terminal (docs/terminal.md). */
  readonly stand: Stand;
  /** The robots that run the compound and keep the garden (docs/crew.md). */
  readonly crew: Crew;
  /** The eye is inside the house (Game sets it): outdoor captures do not refresh. */
  indoors: boolean;
  /** The star's atmosphere, composited onto sky pixels by the pipeline. */
  readonly starAtmosphere: StarAtmosphere;
  /** The star's erupting gas: a fluid stepped on the GPU each frame. */
  readonly gas: CoronalGas;
  /** The sky beyond the shell, baked (the intro's view from outside shows it too). */
  readonly backdrop: SpaceBackdrop;
  update(gameTime: number): void;
}

export async function buildWorld(renderer: WebGPURenderer, atmoTextures: AtmosphereTextures, houseAssets: HouseAssets, startTime: number, skyDebug: string | null = null): Promise<World> {
  const atmo = createAtmosphereNodes(atmoTextures);
  const star = new StarState();
  star.update(startTime);
  updateFrameSpin(startTime);
  // The sky beyond the shell, baked before anything that renders the sky is built.
  const space = bakeSpace(renderer);
  const sky = createSky(atmo, star, space);
  const debugMode = skyDebug && skyDebug in SKY_DEBUG ? SKY_DEBUG[skyDebug as keyof typeof SKY_DEBUG] : 0;

  // The illuminant must be known before anything the star lights is captured.
  await measureStarIlluminant(renderer, star);

  const environment = createEnvironment(renderer, sky, PAD_HEIGHT + EYE_HEIGHT, startTime);

  const gas = new CoronalGas(renderer);
  await gas.preroll(star.time.value);

  const scene = new Scene();
  scene.name = 'World';
  scene.environmentIntensity = 1;

  (sky.options.debug as unknown as { value: number }).value = debugMode;
  const skyMesh = createSkyMesh(sky, { velocity: true });
  scene.add(skyMesh.mesh);

  const platformMaterial = createPadMaterial({ paving: fieldPaving() });
  const platform = new Mesh(createPlatformGeometry(), platformMaterial);
  platform.name = 'GardenDeck.platform';
  scene.add(platform);

  const deckMaterial = createDeckMaterial();
  const deck = new Mesh(createDeckGeometry(), deckMaterial);
  deck.name = 'Girdle.deck';
  scene.add(deck);

  for (const m of [platform, deck]) {
    m.matrixAutoUpdate = false;
    m.updateMatrix();
  }

  const city = buildCity();
  scene.add(city.group);
  const field = buildField();
  scene.add(field.group);
  // The house: its exterior now, the floors streamed in once the game runs.
  const house = await House.create(houseAssets, { look: { envTexture: environment.target.texture } });
  scene.add(house.root);
  city.walk.walls.meshes.push(house.walk);
  const estate = buildEstate();
  scene.add(estate.group);
  city.walk.walls.meshes.push(estate.walk);
  const stand = buildStand();
  scene.add(stand.group);
  city.walk.walls.meshes.push(stand.walk);
  const houseCopies = [...house.captureCopies(), ...estate.captureCopies()];
  const vehicles = buildVehicles(city.walk.walls, city.lock, (w) => stand.addCarWalls(w));
  scene.add(vehicles.group);
  house.culling.track([...field.statics, ...field.moving, ...estate.outdoorMeshes, ...stand.outdoorMeshes]);
  const fieldOcc = occupancy([...field.statics, ...field.moving]);
  addFieldWalls(city.walk.walls, fieldOcc);

  // Inside the Dome: the sky through the glass, the frame, the platform.
  const captureSite = [platform, deck].map((m) => {
    const c = new Mesh(m.geometry, m.material);
    c.matrixAutoUpdate = false;
    return c;
  });
  const interior = createEnvironment(renderer, sky, INTERIOR_CAPTURE_Y, startTime, {
    extras: [...city.captureExtras(), ...captureSite, ...houseCopies],
    extrasEnvironment: environment.target.texture,
    transmittance: GLASS_TRANSMISSION,
    name: 'environment.interior',
  });
  scene.environment = interior.target.texture;
  deckMaterial.envNode = pmremTexture(environment.target.texture);
  deckMaterial.needsUpdate = true;
  const composites = [...city.bindEnvironments(environment.target.texture, interior.target.texture), field.vapour.composite];
  // The star-shade under the field (lighting/starShade.ts), baked once: the platform and the field take it.
  const occluders = rasterOccluders([...field.statics, ...field.moving, ...house.exteriorMeshes, ...estate.occluders, ...stand.occluders]);
  // The crew: planned on the field's occupancy and this height map; its fixtures join the raster.
  const crew = new Crew({ occupancy: fieldOcc, heights: { N: SHADE.N, origin: SHADE.origin, cell: SHADE.extent / SHADE.N, lohi: occluders }, estateWalk: estate.walk, walls: city.walk.walls });
  scene.add(crew.group);
  house.culling.track(crew.meshes);
  const fixtures = rasterOccluders(crew.fixtureMeshes);
  for (let i = 0; i < occluders.length; i += 2) {
    occluders[i] = Math.min(occluders[i], fixtures[i]);
    occluders[i + 1] = Math.max(occluders[i + 1], fixtures[i + 1]);
  }
  // The house's roofs over the eye (city/visibility.ts): its exterior on a fine local map, so the
  // star's glare fades as the eye walks under the porch and in, as under the gate's vault.
  city.addStarOccluders(houseOccluders(house.exteriorMeshes, house.centre));
  const shade = await createStarShade(renderer, occluders, FIELD_Y, floorMap(FIELD_Y, (x, z) => estateFloor(x, z) ?? standFloor(x, z)));
  // The vehicles' shade as they move (vehicles/shade.ts) takes the pad's light, its sealer's
  // reflection of the zenith included (AO does not reach the clear coat): under a body the view up
  // is the body.
  // The crew's robots shade it too, the nearest of them (crew/crew.ts).
  const vehicleShade = vehicles.shade.node().mul(crew.shade.node());
  platformMaterial.aoNode = shade.ao().mul(vehicleShade);
  platformMaterial.clearcoatNode = (platformMaterial.clearcoatNode as Node<'float'>).mul(vehicleShade);
  const estateShade = () => shade.ao().mul(crew.shade.node());
  platformMaterial.needsUpdate = true;
  house.setLook({ shade: shade.ao, envTexture: interior.target.texture });
  estate.setLook({ shade: estateShade, envTexture: interior.target.texture });
  // The field's reflection probes, each captured where its zone stands (field/probes.ts).
  const probes = createFieldProbes(renderer, sky, field, startTime, { extras: [...city.captureExtras(), ...captureSite, ...houseCopies], interior, transmittance: GLASS_TRANSMISSION, shade: shade.ao });
  vehicles.setLook({ central: probes.central, outdoor: environment.target.texture, ao: shade.ao });
  // The estate's own probe: the house, its garden's walls and buildings, the field beyond.
  const estateProbe = createEstateProbe(renderer, sky, startTime, { extras: [...city.captureExtras(), ...captureSite.map((m) => m.clone()), ...house.captureCopies(), ...estate.captureCopies(), ...field.captureCopies({})], interior, transmittance: GLASS_TRANSMISSION });
  house.setLook({ env: estateProbe.env, envTexture: estateProbe.environment.target.texture });
  estate.setLook({ shade: estateShade, env: estateProbe.env, envTexture: interior.target.texture });
  // The crew: the field's probe over the compound (parallax), the estate's on its terrace.
  const fieldEnv = parallaxEnvironment(probes.central.texture, { centre: probes.central.centre, radius: probes.central.radius, groundY: FIELD_Y });
  const onTerrace = smoothstep(float(-282), float(-296), positionWorld.x).mul(smoothstep(float(-34), float(-44), positionWorld.z)).mul(smoothstep(float(-178), float(-168), positionWorld.z));
  crew.setLook({ env: blendEnv(fieldEnv, estateProbe.env, onTerrace), ao: shade.ao });
  // The Stand's own probe: the gatehouse, the court, the Cordon and the towers, the Stand itself.
  const standProbe = createStandProbe(renderer, sky, startTime, { extras: [...city.captureExtras(), ...captureSite.map((m) => m.clone()), ...house.captureCopies(), ...estate.captureCopies(), ...field.captureCopies({}), ...stand.captureCopies()], interior, transmittance: GLASS_TRANSMISSION });
  stand.setLook({ shade: shade.ao, env: standProbe.env, vehicleShade: () => vehicles.shade.node() });

  const world: World = {
    scene,
    star,
    sky,
    skyMesh,
    environment,
    interior,
    composites,
    localComposites: [],
    city,
    field,
    house,
    estate,
    vehicles,
    stand,
    crew,
    indoors: false,
    gas,
    backdrop: space,
    starAtmosphere: createStarAtmosphere(star, atmo, sky.options.frame, gas),
    update: (t) => {
      star.update(t);
      gas.update(star.time.value);
      updateFrameSpin(t);
      field.update(t);
      estate.update(t);
      environment.update(t);
      interior.update(t);
      // Indoors the outdoors is only what the windows frame: its local captures wait.
      if (!world.indoors) {
        probes.update(t);
        estateProbe.update(t);
        standProbe.update(t);
      }
      (sky.options.frame as unknown as { value: number }).value += 1;
    },
  };
  return world;
}

/**
 * The house's exterior on a 0.25 m occluder map 64 m square about its middle, clipped to what stands
 * over a standing head (HOUSE_OVERHEAD above grade). A texel holds one interval, from the porch's
 * deck to its roof: unclipped, an eye standing on the porch was inside it and the star vanished at
 * the steps. Upper floors' eyes are within the house's walls and roofs either way.
 */
function houseOccluders(meshes: readonly Mesh[], centre: Vector3): OccluderMap {
  const grid: OccluderGrid = { N: 256, originX: centre.x - 32, originZ: centre.z - 32, cell: 0.25 };
  const map = rasterOccluders(meshes, grid);
  const cut = HOUSE_GRADE + HOUSE_OVERHEAD;
  let top = -Infinity;
  for (let i = 0; i < map.length; i += 2) {
    if (map[i + 1] < cut) {
      map[i] = 1e9;
      map[i + 1] = -1e9;
      continue;
    }
    map[i] = Math.max(map[i], cut);
    if (map[i + 1] > top) top = map[i + 1];
  }
  return { grid, map, top };
}

/** Height above grade (m) below which the house does not hide the star: over the eye on the porch and the ground floor. */
const HOUSE_OVERHEAD = 2.9;
