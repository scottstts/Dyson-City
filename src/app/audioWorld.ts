/**
 * What the sound hears of the world (audio/gameAudio.ts AudioWorld): the airlock, the field's
 * machines (silenced within the estate's walls), the house and the estate's trees, and what is
 * underfoot (and the East Lock, the car, the craft and the announcements): the house's floors and porches first, then the estate's terrace, then the field's
 * roads and the site.
 */
import type { AudioWorld } from '../audio/gameAudio';
import type { SpeechClips } from '../audio/loadSpeech';
import { fieldSurface } from '../field/walk';
import { fieldSoundSources } from '../field/sources';
import { fieldGain } from '../estate/silencer';
import type { World } from './world';

export function audioWorld(world: World, speech?: SpeechClips): AudioWorld {
  const walk = world.city.walk;
  const { house, estate } = world;
  return {
    airlock: world.city.gate.airlock,
    surface: (x, z, y) => house.surfaceAt(x, y, z) ?? estate.surfaceAt(x, z, y) ?? fieldSurface(walk.surface, x, z),
    field: { sources: fieldSoundSources(), vents: world.field.vents, time: () => world.field.time, gain: fieldGain },
    house,
    lock: world.city.lock.airlock,
    car: world.vehicles.car,
    craft: world.vehicles.craft.audio,
    speech,
  };
}
