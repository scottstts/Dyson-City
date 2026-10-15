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
} as const;
