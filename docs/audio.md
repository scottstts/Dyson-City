# Audio: sound in the world

Code: `src/audio/`. Levels are in `mix.ts`; the spaces and what couples them are in `acoustics.ts`.

## Rules for every sound

These rules apply to all future sounds, not just the current ones.

- **Every sound is radiated from a place.** It plays through an `Emitter` (`emitter.ts`) positioned at its physical source. There is no "2D" or UI-style playback. Footsteps come from the feet, below the ears. The gate's whine comes from its hoists. The hiss comes from the vent louvres.
- **The path does the work, not the sample.** Per frame, an emitter derives all of these for the listener:
  - propagation delay d/c (a leaf landing 80 m away is heard after you see it; moving sources Doppler);
  - spreading loss (1/d beyond the source's own size, `refDistance`);
  - air absorption (a low-pass over d, stronger in the band's thin air);
  - the path between spaces (a shut leaf passes only a low rumble);
  - the medium it radiates into;
  - its directivity (off its axis a source is quieter and duller);
  - HRTF direction at the ears.

  A synthesised buffer is the sound at its source, never pre-baked distance, reverb or panning.
- **Spaces, not presets.** Reverberation belongs to the space a source radiates into (`outside`, `chamber`, `city`). It is heard through the same paths as the direct sound, so the chamber's ring leaks out of an open gate and dies behind a shut one.
- **Levels are physical in proportion and compressed in range.** Real levels span 60 dB from a footstep to a landing leaf. `mix.ts` keeps their order and relative sense while fitting them on a game's scale. A limiter only protects the output; it is not a mixing tool.
- **Resynthesised, not sampled.** No recording ships. Where a reference recording exists, it is measured and a model is fitted to it (see below), and the game resynthesises from the model. Every playback has new fine structure. Where none exists, a sound is built from its mechanism (the valves, the jet).
- **The ear decides.** A clone that measures well but sounds wrong is wrong. Get new sounds into the game early and iterate on what the user hears, not on fit numbers. Hand-built modal synthesis of the first pass read as thin and cartoonish (footsteps like bamboo, a pump like an alarm, a leaf landing like a cup on a table); fitted models fixed that.
- **The game logic knows nothing of sound.** Systems expose state (the airlock's phases, the player's foot events). `src/audio` watches that state and makes the sound.

## Acoustics (`acoustics.ts`, `reverb.ts`)

- **Zones.**
  - The band: 0.55 bar, open to the horizon.
  - The chamber: a sealed vault whose pressure cycles.
  - The city: 1 bar, 1.3 × 10⁸ m³ under the Dome.
- **Transmission.**
  - A shut leaf: −48 dB, low-passed at 160 Hz. That is the mass law for 80 mm of steel, plus some flanking through the piers.
  - The Dome's glass: −44 dB at 220 Hz.
  - An opening gate: the slot leaks a lot early (gain ∝ fraction^0.35), and its highs open up as the gap grows.
  - Band ↔ city: through the glass, or through both leaves (never both open).
- **Medium.** Radiated pressure ∝ ρc, so everything in the band's air is 5.2 dB quieter, footsteps included. In the chamber the level follows the dial. Entering the pressurised chamber makes your own steps louder; that is deliberate.
- **Impulse responses** are synthesised at load. They hold only reflections, since the direct sound takes the dry path. Their level is the diffuse-field energy relative to the direct sound at 1 m, 16π/A (Sabine).
  - **Chamber.** Image-source early reflections in a 26 × 18 × 26 m box, then octave-band tails with T60 of ~4 s in the mids and 1.3 s at 8 kHz. The piers are 18 m apart, which gives a flutter echo every 52 ms. Wet: a footstep's reverberant energy is only ~6 dB under its direct sound.
  - **City.** The physical level is about −48 dB re 1 m: the volume is so large that its reverberation is faint. It is lifted 10 dB so the space is felt, with a slow build-up (mean free path ~260 m) and a T60 of ~7 s.
  - **Band.** Only faint scatter from the Dome's frame.
- **Slap.** The nearest big face returns a moving echo, a delay of 2d/c with gain 0.8/(2d). Outside that face is the drum or the piers' west ends; in the city, the drum's glass or the piers' east ends.
  - It is a continuous distance to the real faces. The passage between the piers is open, not a wall.
  - The distance is held at 2.5 m or more. An earlier version measured to a "gatehouse face" across the passage opening; near zero distance the gain diverged and blew up the output.

## Cloning a recording (`synth/spectral.ts`, `tools/sound-model.mjs`)

- **Two model kinds**, stored as data in `src/audio/models/` (generated; regenerate rather than edit):
  - **Prints** (events): third-octave band levels at knot times, plus onsets. Resynthesis is band noise under those envelopes, and at each onset every band is struck by one shared contact pulse, so a blow is one coherent wavefront rather than a rustle.
  - **Textures** (steady sounds): a PSD floor plus tonal lines with their measured widths, and optionally clusters of clicks (a ratchet). Resynthesis is a random-phase inverse FFT, which gives a seamless loop.
- **The fit iterates synthesise → measure → correct**, measuring the clone exactly as the recording was measured. What surfaced while fitting:
  - **Smear.** Band analysis smears a blow both ways by half its window. Onsets are refined to the sample on the waveform. Near onsets, bands at 250 Hz and up are steered by octave-group envelopes with windows of at least two periods; lower bands get no fine steering.
  - **Strike levels.** A strike's level follows the fine envelope just after its onset, not the smeared band energy: a low band cannot tell a 5 ms thud from a 40 ms body.
  - **Masks.** Each onset strikes only the bands that jump at it, resolvable at that band's window. Otherwise a tick re-strikes the lows mid-thud.
  - **Keep the best iteration.** Strikes and bands can trade off, and the fit can oscillate.
  - **Rejected:** tracked partials and fitted dispersion. Both were unstable, and the strike filter's own ringing already disperses the lows later.
- **Usage:**

  ```bash
  node tools/sound-model.mjs print --in rec.wav --at t0,… --length d --transients
  ```

  Use `texture` with `--from`/`--to` for steady sounds. Recordings are 16-bit WAV (convert with ffmpeg). Paths are arguments only; nothing in the code refers to a recording.
- **Bank** (`bank.ts`): everything is synthesised once in a worker during the atmosphere stage, ~1 s. Sounds from one recording share one scale, so they keep the balance they were recorded with.

## Footsteps (`synth/footstep.ts`, `sounds/footsteps.ts`)

- **Timed by the gait.** The controller emits a `step` when `HeadMotion` strikes a foot, so sound and head jolt coincide. It also emits `takeoff`, `land` (with impact speed) and `stop` (after moving faster than 0.9 m/s). Within 0.15 s of one foot event, no other fires.
- **Source:** six steps recorded on polished marble, each a print. Walking on stone is the recording itself.
- **Gaits reshape it:**
  - run: the roll compressed to 0.68, +5 dB;
  - land: 0.55, +7 dB, +5 dB more below 250 Hz, with a second foot ~25 ms later;
  - stop: −7 dB;
  - takeoff: little heel.
- **Floors:** basalt is a little brighter; the deck has a hollow 200 Hz body, glassy ring and grit; bronze rings.
- **Levels.** The bank is scaled so a walking step on stone peaks at `LEVEL.footstep`. Each foot is its own emitter, 0.11 m either side of the body's line, with a `'located'` zone.

## The West Gate (`sounds/gate.ts`)

- **Events.** `airlockEvents.ts` turns phase changes into: `unbolt`/`bolt`, `unbolted`/`bolted`, `opened`/`closed`, and `reverse`. Valves open when the pressure starts to move and shut the moment it arrives.
- **Hydraulics** sound at the two hoists of each gate. The outer gate's are outside, so from the chamber they are muffled until the leaf lifts.
  - A fitted texture of a hydraulic power unit: the 448 Hz pump line only ~20 dB over a dark floor, its harmonics far weaker. The first build's bright harmonic stack read as an alarm.
  - It spins up from 62 % pitch with a 0.75 s time constant, as measured. It runs 1.5 % slower and 1.5 dB louder when lifting, and spins down when the gate stops.
  - The measured start (contactor, valve onto the load) opens each run and each reversal.
- **The leaf** is a dipole at the skin's centre, radiating into both spaces.
  - While it moves: a massive door's roll (texture with ratchet clicks), ∝ speed, with a ±2.5 dB swell at 0.5–6 Hz like the recorded door.
  - Open stop: the lift-stop print (pump cut-out, heavy clanks, boom), and the hydraulics cut out with it.
  - Closed: the vault door's shut print.
- **Bolts:** a heavy lock's throw (print) at each end stop.
- **Walking straight in, the outer gate never reaches its open stop.** The airlock closes it as soon as you clear the sweep, so you hear the reversal knock, not the open bang. That is gameplay logic.

## Pressurisation (`sounds/vents.ts`)

- Two emitters at the vent louvres (y 2.6 m, both piers). Their directivity points into the chamber.
- **The jet.**
  - Spectrum: double high-pass at 1 kHz plus a +12 dB peak, rising ~8 dB/octave to ~7.5 kHz like the reference.
  - The peak and the top fall with √Δp as the pressures equalise, so the jet darkens.
  - Level: half from the dial's rate, half from the remaining Δp^0.7. It is audible from the valve's first pop, where the dial alone would start silent.
- **Buffeting** under 90 Hz.
- **Valves.** The open valve thunks with a broadband pop and a ~40 Hz thump; the close valve thunks and cuts the flow.
- The same voice vents and fills.

## Runtime

- **Boot.** The `AudioContext` is created at the atmosphere stage; its rate sets the bank's, built in `bankWorker.ts` in parallel. The context stays suspended until the pointer-lock click; pause fades and suspends it; fatal errors close it.
- **Per frame** (`Game.frame`, after the camera's matrix): the ears move to the camera, airlock events and queued foot events sound at time `t`, and every emitter's path is re-derived.
  - `glide` skips unchanged targets, so steady parameters add no automation.
- **Cost.** 12 HRTF/equal-power panners, three convolvers (5.5 s, 7.5 s and 1.6 s stereo) and short-lived sources.

## Review

- `node tools/audio-preview.mjs [walk-in walk-out chamber-stand turn deck]` runs the real controller, walls, airlock and `GameAudio` frame by frame in an `OfflineAudioContext` in headless Chrome.
  - It writes WAVs to `tools/out/audio/` and prints events, per-second peak/RMS and clipped samples.
  - `direction` prints the left/right balance of one source while the listener turns (±9–10 dB at 10 m).
- `tests/audio.test.ts`:
  - zones, transmission and the slap distance's continuity;
  - IR decay times (±20 %) and levels;
  - clones resynthesising at their models' levels, texture loops and the bank's scaling;
  - gaits ordered by force;
  - the airlock's event order;
  - the controller's foot events.
