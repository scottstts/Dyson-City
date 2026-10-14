/**
 * Assembles the world scene: sky (star, structure, atmosphere), image-based lighting captured from
 * it, the earmarked site (platform + deck) and the city's structure (the Dome).
 *
 * Two environment captures light the local scene: the open sky (outside the Dome: the deck) and the
 * view from inside the Dome (the sky through its glass, with its frame): everything under the Dome.
 * The frame itself blends the two by which way each face looks (city/materials/ceramic.ts).
 */
import { Mesh, Scene, type WebGPURenderer } from 'three/webgpu';
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
  /** The star's atmosphere, composited onto sky pixels by the pipeline. */
  readonly starAtmosphere: StarAtmosphere;
  /** The star's erupting gas: a fluid stepped on the GPU each frame. */
  readonly gas: CoronalGas;
  update(gameTime: number): void;
}

export async function buildWorld(renderer: WebGPURenderer, atmoTextures: AtmosphereTextures, startTime: number, skyDebug: string | null = null): Promise<World> {
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

  const platform = new Mesh(createPlatformGeometry(), createPadMaterial());
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

  // Inside the Dome: the sky through the glass, the frame, the platform.
  const captureSite = [platform, deck].map((m) => {
    const c = new Mesh(m.geometry, m.material);
    c.matrixAutoUpdate = false;
    return c;
  });
  const interior = createEnvironment(renderer, sky, INTERIOR_CAPTURE_Y, startTime, {
    extras: [...city.captureExtras(), ...captureSite],
    extrasEnvironment: environment.target.texture,
    transmittance: GLASS_TRANSMISSION,
    name: 'environment.interior',
  });
  scene.environment = interior.target.texture;
  deckMaterial.envNode = pmremTexture(environment.target.texture);
  deckMaterial.needsUpdate = true;
  const composites = city.bindEnvironments(environment.target.texture, interior.target.texture);

  return {
    scene,
    star,
    sky,
    skyMesh,
    environment,
    interior,
    composites,
    city,
    gas,
    starAtmosphere: createStarAtmosphere(star, atmo, sky.options.frame, gas),
    update: (t) => {
      star.update(t);
      gas.update(star.time.value);
      updateFrameSpin(t);
      environment.update(t);
      interior.update(t);
      (sky.options.frame as unknown as { value: number }).value += 1;
    },
  };
}
