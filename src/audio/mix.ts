/**
 * Every sound's level, in one place (docs/audio.md, "Levels"). Each is the amplitude at its
 * emitter's reference distance; distance, paths, the medium and direction do the rest. The scale is
 * compressed (a real landing leaf is 60 dB louder than a footstep): a walking step peaks near
 * −18 dBFS at the ears, the hoists run near −22 dBFS rms at 10 m, and a leaf landing 10 m away
 * peaks near −3 dBFS before the output limiter.
 */
export const LEVEL = {
  /** Output gain. */
  master: 0.9,
  /** A walking step on stone, peak, at 0.3 m (the foot). */
  footstep: 0.7,
  /** A gate's hydraulic power unit running, RMS, at 2.5 m from each hoist (its start on the same scale). */
  hydraulic: 0.1,
  /** A leaf's roll at its fastest, RMS, at 7 m. */
  leafRoll: 0.07,
  /**
   * A leaf on its open stop (the lift-stop, on the hydraulics' scale) and landing shut (the door's
   * shut, on the roll's scale), at 7 m: louder than the recordings' own balance would make them,
   * for a 180 t leaf.
   */
  openStop: 0.16,
  shut: 0.14,
  /** The floor bolts' throw (on the roll's scale), at 0.5 m. */
  bolt: 0.35,
  /** Equalising vent at 1 m: the jet at full flow, its low buffeting, and the valve. */
  jet: 0.25,
  buffet: 0.3,
  valve: 0.7,
  /**
   * The field's machines, RMS at each source's size (sources.ts): transformer hum at 8 m, the
   * cryogen plant at 10 m, a pump set at 3 m, the Loom's draw head at 5 m and its carriage's
   * drives at 6 m, a slewing drive at 3 m; a relief stack's roar at 1 m (full lift) and its valve.
   */
  field: { hum: 0.11, cryo: 0.12, pump: 0.14, furnace: 0.18, crane: 0.07, slew: 0.06, vent: 0.4 },
  ventValve: 0.55,
  /** A house door's shut, peak, at 1 m (its opening on the same scale, as recorded). */
  door: 0.8,
  /** A clock's beat, peak, at the movement (0.3 m); scaled by its marker's gain. */
  tick: 0.12,
  /**
   * The car at 1.5 m (its size): the drive's hum at full load, the tyres rolling at top speed, their
   * scrub at the limit, a hard knock on a wall (peak), the wheels' actuators running (RMS) and their
   * latch at the stop (on the hydraulics' and the latch's recorded scales).
   */
  car: { drive: 0.16, roll: 0.07, scrub: 0.05, impact: 0.7, deploy: 0.035, latch: 0.12 },
  /** The craft's engines at full burn, RMS, at 8 m (their size). */
  craft: 0.55,
  /**
   * The announcements, peak, at each loudspeaker's size (sounds/speech.ts): the gate's PA (2 m),
   * the chamber's speaker (1.5 m), the portal's (2 m), the car's cabin (1 m) and the speaker
   * beside the listener (0.5 m, 1.2 m off).
   */
  speech: { gate: 2.2, chamber: 2.0, portal: 2.4, car: 1.1, near: 0.55 },
  /**
   * The chime before an announcement, peak, relative to its speech's: a ringing tone carries ~15 dB
   * more energy per peak than speech, so it sits well under it.
   */
  chime: 0.3,
  /**
   * The West Gate terminal's speaker (sounds/terminal.ts), at 0.3 m (its grille): a recording's
   * peak, its interface tones' peak, and the star's song's RMS. First pass, to be tuned by ear.
   */
  terminal: { voice: 0.6, ui: 0.16, song: 0.22 },
  /**
   * The crew (sounds/crew.ts), each at its source's size there: a walking Hand's step and a
   * Rigger's pad (peak, at the foot, on the player's steps' scale); a Spotter's and a Ferry's rotors
   * at full thrust; a Dray's drive at full load and its tyres at top speed, its probe's actuator and
   * its latch (peak); a Linewalker's drive and rollers; a Rigger's boom actuators; the mower's motor
   * and reel, the trimmer's motor and blades (RMS). First pass, to be tuned by ear.
   */
  crew: { hand: 0.8, rigger: 1.0, spotter: 0.12, ferry: 0.2, dray: 0.07, drayRoll: 0.035, probe: 0.03, latch: 0.12, linewalker: 0.03, lineRoll: 0.02, boom: 0.035, mower: 0.05, reel: 0.04, trimmer: 0.06, blades: 0.05 },
  /**
   * The intro's ship (intro/audio/sounds.ts), each at its source's size: the cabin's machinery
   * (RMS, 1.5 m), the engines' rumble through its floor (RMS, 2 m), Aurelia's loudspeaker and the
   * Guardian's own voice (peak, at the grille 0.3 m and the mouth 0.12 m), the PA's chime (relative
   * to the speech, as `chime`), the avionics' tones (peak, 0.2 m); the main and lift engines at full
   * thrust and their turbines' whine (RMS, 3 m); the gear's and the stair's and door's actuators
   * (RMS, on the hydraulics' scale), their latches and the door's seal (peak); touchdown through
   * the floor and at the pads (peak). First pass, to be tuned by ear.
   */
  intro: { ambient: 0.004, rumble: 0.008, ai: 1.0, voice: 0.55, chime: 0.3, tone: 0.07, main: 0.6, lift: 0.7, whine: 0.04, actuator: 0.05, latch: 0.12, seal: 0.08, touchdown: 0.09, pads: 0.5 },
} as const;

/**
 * Reverb sends of the Dome-wide sources: the craft and the East Lock (docs/audio.md, "The craft").
 * The city's reverberation is lifted 10 dB so the space is felt; at that lift a source fed in full
 * holds the same level from 400 m to the far side, so these feed it without the lift.
 */
export const DOME_SEND = 0.3;
