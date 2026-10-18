/**
 * Assembles the world scene: sky (star, structure, atmosphere), image-based lighting captured from
 * it, the earmarked site (platform + deck) and the city's structure (the Dome).
 *
 * Two environment captures light the local scene: the open sky (outside the Dome: the deck) and the
 * view from inside the Dome (the sky through its glass, with its frame): everything under the Dome.
 * The frame itself blends the two by which way each face looks (city/materials/ceramic.ts).
 */
import { Mesh, Scene, type Node, type WebGPURenderer } from 'three/webgpu';
import { pmremTexture } from 'three/tsl';
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
import { bakeSpace } from '../sky/space/bake';
import { CoronalGas } from '../sky/star/gas/solver';
import { buildCity, type City } from '../city/city';
import { GLASS_TRANSMISSION, type GlassComposite } from '../city/dome/glass';
import { INTERIOR_CAPTURE_Y } from '../city/dome/spec';
import { buildField, type Field } from '../field/field';
import { fieldPaving } from '../field/paving';
import { createFieldProbes } from '../field/probes';
import { addFieldWalls } from '../field/walk';
import { createStarShade, floorMap, rasterOccluders } from '../lighting/starShade';
import { estateFloor } from '../estate/layout';
import { createEstateProbe } from '../estate/probe';
import { FIELD_Y } from '../field/layout';
import { House } from '../house/house';
import { buildEstate, type Estate } from '../estate/estate';
import type { HouseAssets } from '../house/assets';
import { buildVehicles, type Vehicles } from '../vehicles/vehicles';

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
  /** The eye is inside the house (Game sets it): outdoor captures do not refresh. */
  indoors: boolean;
  /** The star's atmosphere, composited onto sky pixels by the pipeline. */
  readonly starAtmosphere: StarAtmosphere;
  /** The star's erupting gas: a fluid stepped on the GPU each frame. */
  readonly gas: CoronalGas;
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
  const illuminant = await measureStarIlluminant(renderer, star);
  console.info(`[Dyson] star illuminant ${illuminant.toArray().map((v) => v.toFixed(3)).join(', ')}`);

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
  const house = await House.create(houseAssets, { renderer, scene, look: { envTexture: environment.target.texture } });
  scene.add(house.root);
  city.walk.walls.meshes.push(house.walk);
  const estate = buildEstate();
  scene.add(estate.group);
  city.walk.walls.meshes.push(estate.walk);
  const houseCopies = [...house.captureCopies(), ...estate.captureCopies()];
  const tVehicles = performance.now();
  const vehicles = buildVehicles(city.walk.walls, city.lock);
  scene.add(vehicles.group);
  console.info(`[Dyson] vehicles: ${(performance.now() - tVehicles).toFixed(0)} ms`);
  house.culling.track([...field.statics, ...field.moving, ...estate.outdoorMeshes]);
  const tWalls = performance.now();
  const fieldWalls = addFieldWalls(city.walk.walls, [...field.statics, ...field.moving]);
  console.info(`[Dyson] field walls: ${fieldWalls} segments, ${(performance.now() - tWalls).toFixed(0)} ms`);

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
  const tShade = performance.now();
  const occluders = rasterOccluders([...field.statics, ...field.moving, ...house.exteriorMeshes, ...estate.occluders]);
  const tRaster = performance.now();
  const shade = await createStarShade(renderer, occluders, FIELD_Y, floorMap(FIELD_Y, estateFloor));
  console.info(`[Dyson] star-shade: raster ${(tRaster - tShade).toFixed(0)} ms, visibility ${(performance.now() - tRaster).toFixed(0)} ms`);
  // The vehicles' shade as they move (vehicles/shade.ts) takes the pad's light, its sealer's
  // reflection of the zenith included (AO does not reach the clear coat): under a body the view up
  // is the body.
  const vehicleShade = vehicles.shade.node();
  platformMaterial.aoNode = shade.ao().mul(vehicleShade);
  platformMaterial.clearcoatNode = (platformMaterial.clearcoatNode as Node<'float'>).mul(vehicleShade);
  platformMaterial.needsUpdate = true;
  house.setLook({ shade: shade.ao, envTexture: interior.target.texture });
  estate.setLook({ shade: shade.ao, envTexture: interior.target.texture });
  // The field's reflection probes, each captured where its zone stands (field/probes.ts).
  const tProbes = performance.now();
  const probes = createFieldProbes(renderer, sky, field, startTime, { extras: [...city.captureExtras(), ...captureSite, ...houseCopies], interior, transmittance: GLASS_TRANSMISSION, shade: shade.ao });
  console.info(`[Dyson] field probes: ${(performance.now() - tProbes).toFixed(0)} ms`);
  vehicles.setLook({ central: probes.central, outdoor: environment.target.texture, ao: shade.ao });
  // The estate's own probe: the house, its garden's walls and buildings, the field beyond.
  const estateProbe = createEstateProbe(renderer, sky, startTime, { extras: [...city.captureExtras(), ...captureSite.map((m) => m.clone()), ...house.captureCopies(), ...estate.captureCopies(), ...field.captureCopies({})], interior, transmittance: GLASS_TRANSMISSION });
  house.setLook({ env: estateProbe.env, envTexture: estateProbe.environment.target.texture });
  estate.setLook({ shade: shade.ao, env: estateProbe.env, envTexture: interior.target.texture });

  const world: World = {
    scene,
    star,
    sky,
    skyMesh,
    environment,
    interior,
    composites,
    city,
    field,
    house,
    estate,
    vehicles,
    indoors: false,
    gas,
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
      }
      (sky.options.frame as unknown as { value: number }).value += 1;
    },
  };
  return world;
}
