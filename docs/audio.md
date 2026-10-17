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
- **Spaces, not presets.** Reverberation belongs to the space a source radiates into (`outside`, `chamber`, `city`, `house`). It is heard through the same paths as the direct sound, so the chamber's ring leaks out of an open gate and dies behind a shut one.
- **Levels are physical in proportion and compressed in range.** Real levels span 60 dB from a footstep to a landing leaf. `mix.ts` keeps their order and relative sense while fitting them on a game's scale. A limiter only protects the output; it is not a mixing tool.
- **Resynthesised, not sampled.** No recording ships. Where a reference recording exists, it is measured and a model is fitted to it (see below), and the game resynthesises from the model. Every playback has new fine structure. Where none exists, a sound is built from its mechanism (the valves, the jet).
- **The ear decides.** A clone that measures well but sounds wrong is wrong. Get new sounds into the game early and iterate on what the user hears, not on fit numbers. Hand-built modal synthesis of the first pass read as thin and cartoonish (footsteps like bamboo, a pump like an alarm, a leaf landing like a cup on a table); fitted models fixed that.
- **The game logic knows nothing of sound.** Systems expose state (the airlock's phases, the player's foot events). `src/audio` watches that state and makes the sound.

## Acoustics (`acoustics.ts`, `reverb.ts`)

- **Zones.**
  - The band: 0.55 bar, open to the horizon.
  - The chamber: a sealed vault whose pressure cycles.
  - The city: 1 bar, 1.3 × 10⁸ m³ under the Dome.
  - The house: its rooms. Which zone a point is in is plan geometry (`zoneAt`), except the house, whose room boxes the house itself knows. `AudioEngine.locate(x, y, z)` asks it first, so the listener and the feet (`'located'` emitters) are placed by height as well as plan.
- **Transmission.**
  - A shut leaf: −48 dB, low-passed at 160 Hz. That is the mass law for 80 mm of steel, plus some flanking through the piers.
  - The Dome's glass: −44 dB at 220 Hz.
  - An opening gate: the slot leaks a lot early (gain ∝ fraction^0.35), and its highs open up as the gap grows.
  - Band ↔ city: through the glass, or through both leaves (never both open).
  - House ↔ city: the shell shut is −29 dB, low-passed at 600 Hz (the sashes are the weak part). An outer door open lets the estate in like the gate's slot does: early leakage, highs opening with the gap, up to −6 dB wide open (`facadePath`; the listener carries the widest open outer leaf as `houseOpen`). House ↔ band or chamber is the shell in series with the city's path.
- **Medium.** Radiated pressure ∝ ρc, so everything in the band's air is 5.2 dB quieter, footsteps included. In the chamber the level follows the dial. Entering the pressurised chamber makes your own steps louder; that is deliberate.
- **Impulse responses** are synthesised at load. They hold only reflections, since the direct sound takes the dry path. Their level is the diffuse-field energy relative to the direct sound at 1 m, 16π/A (Sabine).
  - **Chamber.** Image-source early reflections in a 26 × 18 × 26 m box, then octave-band tails with T60 of ~4 s in the mids and 1.3 s at 8 kHz. The piers are 18 m apart, which gives a flutter echo every 52 ms. Wet: a footstep's reverberant energy is only ~6 dB under its direct sound.
  - **City.** The physical level is about −48 dB re 1 m: the volume is so large that its reverberation is faint. It is lifted 10 dB so the space is felt, with a slow build-up (mean free path ~260 m) and a T60 of ~7 s.
  - **Band.** Only faint scatter from the Dome's frame.
  - **House.** One response for every room (a zone's reverberation is diffuse): a furnished 6 × 5 × 3.8 m room, T60 ~0.5 s in the mids, image-source early reflections over the first 40 ms.
  - **But each room's reverb is its own.** A house sound (doors, clocks, the kettle, footsteps on the house's floors) feeds the house's reverb at its level at 1 m, and in full only while the listener is in the room it sounds in (`house/rooms.ts`, the rooms' boxes). From another room, or outdoors, it is −20 dB (`ROOM_LEAK`, first pass, by ear), and outdoors the shell's path applies on top. Before this the kettle's simmer, fed at its 0.3 m level into one reverb heard in every room, filled the whole house ~30 dB over its own direct sound and leaked out of the front door.
  - **The send is the level at 1 m.** An IR's level is relative to the direct sound at 1 m, but an emitter's input is its level at `refDistance`, so its send should be scaled by `refDistance`. Only the house's sounds do so (`EmitterOptions.sendScale`). Everywhere else the send is still the input as it is: the gate chamber's balance (footsteps ~10 dB wetter than physical, the leaf ~17 dB drier) was tuned by ear on it and is kept, by the user's decision.
- **Slap.** The nearest big face returns a moving echo, a delay of 2d/c with gain 0.8/(2d). Outside that face is the drum or the piers' west ends; in the city, the drum's glass, the piers' east ends or the house's walls (its foundation outline, so footsteps on the terrace slap off the facade). The chamber and the house have no slap: their rooms are in their responses.
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
- **Sources:** three recordings, each step a print: six steps on polished marble, three through lawn grass (the recording's steady low rumble, unrelated to the steps, is left out: bands below 160 Hz and the floor of the gaps between steps), six on fine gravel over sand. Walking on stone, grass and gravel are the recordings themselves; every other floor is built on the marble's.
- **Gaits reshape it:**
  - run: the roll compressed to 0.68, +5 dB;
  - land: 0.55, +7 dB, +5 dB more below 250 Hz, with a second foot ~25 ms later;
  - stop: −7 dB;
  - takeoff: little heel.
- **Floors:**
  - basalt is a little brighter; the deck has a hollow 200 Hz body, glassy ring and grit; bronze rings;
  - timber (`wood`) is boards on joists: a low-mid body and the boards' short ring; the porches' `boards` span a void, hollower and longer;
  - `rug` (rugs, runners, mats) keeps the thud and loses the click through a real low-pass. Band gains alone cannot darken a print by more than ~10 dB: each strike's band-pass leaks 6 dB/octave, so the strong low bands fill the highs.
- **Levels.** The bank is scaled so a walking step on stone peaks at `LEVEL.footstep`. The grass and gravel recordings have their own scales: a step there is set against one on stone by loudness above ~250 Hz, not by peak (a low thud carries energy the ear barely weighs; a crunch is many peaks). Turf is 8 dB under stone, gravel 2 dB under. Each foot is its own emitter, 0.11 m either side of the body's line, with a `'located'` zone.
- **What is underfoot** is asked at the feet with their height (the house has storeys): the house's floors first (`house/floors.ts`: the up-facing faces of the floor materials rasterised per 0.1 m cell in the house worker, every height a cell holds kept, so a rug over boards and three storeys share a cell), then the estate's class grid (`estate/surface.ts`: lawn and meadow grass, drive, walks and ramp gravel, flags, brick and the walls' tops stone), then the field's roads and the site (`app/audioWorld.ts`). Walking in from the gateway the feet meet steps, porch boards, the coir mat, the oak threshold, the vestibule's mat and tiles, the hall's boards and runner (`tests/houseWalk.test.ts`).

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

## The field (`sounds/field.ts`)

- **Seven clones** of the user's recordings (textures in `models/field*.ts`): transformer hum, a cryogenic plant, a pump set, a furnace, an overhead crane, a slewing drive, a relief valve's roar.
  - The relief recording was one steady blow-off, not bursts. The roar is its texture, and each burst's lift and reseat use the existing valve pop and thunk.
  - The slew sample came as MP3: convert it to WAV first.
- **Sources are game state** (`field/sources.ts`). Each is a point on the machine that makes the sound, with its size and how hard it works now:
  - the Converter's and the Reckoner's plant rooms hum;
  - the Stills and the Cold Hold run the cryogen plant;
  - every valve pavilion has a pump;
  - the secondary plant's compressor houses run a cryogen compressor each, and its switchyards' transformers hum;
  - the Loom's draw head roars and its carriage's drives whine as it creeps;
  - the Gyre's torque motors turn slowly;
  - the Mast's dish heads slew in proportion to their scan rate.
- **Loops start at random points** and each machine wanders in speed on its own, so two of a kind never phase-lock into one louder source.
- **Every sound comes from its machine; there is no bed.** The user rejected a hum heard everywhere under the Dome. It was the drones' reverb send: the city's reverb is diffuse and the same everywhere, so two dozen machines feeding it became a hum without a source.
  - Field emitters have no reverb send. What reaches you is each machine's direct sound: delayed, spread 1/d beyond its size, dulled by the air and placed by HRTF.
  - A pool of six HRTF voices goes to the machines loudest where you stand, nearest first. A voice keeps its machine while that machine stays in the top eight, and fades out before it is reassigned. A machine below audibility makes no sound at all.
  - Each machine's level wanders with its load, by a dB or two and a fraction of a percent in speed. Each has its own wander, so no two of a kind move together.
  - `tests/fieldSound.test.ts`: by the house and at the drum nothing is loud; next to a pump the pump dominates by 12 dB or more, and only the machines of the precinct you stand in are audible.
- The three vent voices are HRTF-panned too, also with no send.
- **Relief stacks** (`field/vents.ts`, a seeded schedule): a voice from the pool takes a lifting stack. It pops, its roar follows the stack's flow (brighter at full lift), and it thunks on reseat.
- **Levels** are `LEVEL.field` and `LEVEL.ventValve` in `mix.ts`: first-pass values, to be tuned by ear.
- **The estate's silencer** (`estate/silencer.ts`): a device in the estate cuts every machine and relief stack off for a listener within its walls (the terrace's outer wall face in plan, the gateway's ramp and the house included). The field's emitters all feed one bus after their paths, so the cut acts at the ears at once, not after each machine's propagation delay. Behind it the voices, levels, spreading and wander run unchanged, so stepping out finds them as they were. It switches with a 50 ms time constant.

## The estate (`sounds/estate.ts`, `synth/rustle.ts`)

- **Leaves in the breeze.** Two voices go to the crowns nearest the listener (within 60 m of a crown's edge), each spreading 1/d beyond its crown's radius, equal-power panned (a crown is broad). A voice whose tree drops out of the nearest fades before it moves. No estate-wide bed.
- The rustle is cloned from a recording of a broadleaf crown in a breeze: a fitted texture (`models/estateRustle.ts`: the bright hush and the leaves' ticking as clicks). A random-phase texture is stationary at every time scale, but the recorded leaf band swells and drops by ~5 dB over tens of milliseconds as clusters of leaves catch the air together. That flutter is a log-normal envelope (4.4 dB, ~9 Hz wide) on the band above 1.2 kHz, fitted so the clone's spread of level in 5–100 ms windows matches the recording's in each band. The breeze rises and settles ±3 dB over the ~11 s loop. Narrow tonal lines the fit found in the 1.3 s sample were rejected: in a loop they whistle.
- Each voice loops from its own point, a few percent off speed, so two trees never move in step.
- The first pass was synthesised from its mechanism for a near-still Dome (sparse clicks, a faint hush); the user replaced it with the recording's breeze.

## The house (`sounds/house.ts`, `synth/house.ts`)

- **Doors** are cloned from one recording of a door opening and closing, split into separate sounds:
  - the opening (latch drawn, leaf freed, tongue home) plays from the handle when a shut leaf starts to open; opening further from ajar makes no latch sound;
  - the close is cut at 0.43 s, before the latch first touches the keep. The swing part (handle, quiet) plays as the leaf starts closing. The shut part is scheduled so its strike (the close's strongest onset, 0.29 s into it) lands when the leaf reaches rest;
  - the leaf's time to rest is its own motion run ahead (`HouseDoor.timeToTarget`, the same step the doors use, at 1/240 s). A closed form ignoring the rate's lag was 0.2 s late. If the leaf is stopped short (the walker in the way, or reopened) before the strike, the pending shut is cancelled;
  - voices are a pool: two inside the house, one for the outer doors (radiating into both the hall and the estate); pocket doors play the same at −4.4 dB.
- **Clocks and the kettle** are voiced at the export's `Sound_` markers (their `clip` and `gain`), as each floor streams in:
  - clocks beat an anchor escapement built from its mechanism: the unlocking click, the drop a few ms later (the strong blow), the movement's plates ringing bright and short and the case low and longer. The modes are fixed per clock; the blow varies per beat, and the exit pallet strikes softer at the top (tick, tock). The longcase beats seconds with a deep trunk; the mantel clock 11,520 an hour in a small case. No clock is perfectly in beat: the tock comes 1.5 % late;
  - the kettle simmers: a dense fizz of collapsing vapour bubbles (1.5–7 kHz), the odd larger bubble ringing at its Minnaert frequency, and the body's hum, all following a slow wander of the heat;
  - within 45 m of the house's middle only: beyond it no beat is scheduled and the kettle's loop is stopped.
- **Levels** (`LEVEL.door`, `tick`, `kettle`, `rustle`): first-pass values, to be tuned by ear.

## Runtime

- **Boot.** The `AudioContext` is created at the atmosphere stage; its rate sets the bank's, built in `bankWorker.ts` in parallel. The context stays suspended until the pointer-lock click; pause fades and suspends it; fatal errors close it. The player's volume and mute (`docs/ui.md`) scale `LEVEL.master` through `GameAudio.setUserGain`.
- **Per frame** (`Game.frame`, after the camera's matrix): the ears move to the camera, airlock events and queued foot events sound at time `t`, and every emitter's path is re-derived.
  - `glide` skips unchanged targets, so steady parameters add no automation.
- **Cost.** 18 HRTF and 2 equal-power panners, four convolvers (5.5 s, 7.5 s, 1.6 s and 1.4 s stereo), three steady loops (the kettle within earshot, two rustles) and short-lived sources.

## Review

- `node tools/audio-preview.mjs [walk-in walk-out chamber-stand turn deck]` runs the real controller, walls, airlock and `GameAudio` frame by frame in an `OfflineAudioContext` in headless Chrome.
  - It writes WAVs to `tools/out/audio/` and prints events, per-second peak/RMS and clipped samples.
  - `direction` prints the left/right balance of one source while the listener turns (±9–10 dB at 10 m).
- `tests/audio.test.ts`:
  - zones, transmission and the slap distance's continuity;
  - IR decay times (±20 %) and levels;
  - clones resynthesising at their models' levels, texture loops and the bank's scaling;
  - gaits ordered by force on every floor; gravel louder than turf (at the bank's scale), rugs dark, boards hollower than timber, timber than stone;
  - the house's shell and open doors, the slap off its walls, the clocks' tick and tock;
  - the door's split, the loops' seams, the lawn's level against stone;
  - the airlock's event order;
  - the controller's foot events.
