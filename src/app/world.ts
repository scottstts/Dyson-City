/**
 * Assembles the world scene: sky (star, structure, atmosphere), image-based lighting captured from
 * it, and the earmarked site (platform + deck).
 */
import { Mesh, Scene, type WebGPURenderer } from 'three/webgpu';
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

export interface World {
  readonly scene: Scene;
  readonly star: StarState;
  readonly sky: Sky;
  readonly skyMesh: SkyMesh;
  readonly environment: Environment;
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
  scene.environment = environment.target.texture;
  scene.environmentIntensity = 1;

  (sky.options.debug as unknown as { value: number }).value = debugMode;
  const skyMesh = createSkyMesh(sky, { velocity: true });
  scene.add(skyMesh.mesh);

  const platform = new Mesh(createPlatformGeometry(), createPadMaterial());
  platform.name = 'GardenDeck.platform';
  scene.add(platform);

  const deck = new Mesh(createDeckGeometry(), createDeckMaterial());
  deck.name = 'Girdle.deck';
  scene.add(deck);

  for (const m of [platform, deck]) {
    m.matrixAutoUpdate = false;
    m.updateMatrix();
  }

  return {
    scene,
    star,
    sky,
    skyMesh,
    environment,
    gas,
    starAtmosphere: createStarAtmosphere(star, atmo, sky.options.frame, gas),
    update: (t) => {
      star.update(t);
      gas.update(star.time.value);
      updateFrameSpin(t);
      environment.update(t);
      (sky.options.frame as unknown as { value: number }).value += 1;
    },
  };
}
