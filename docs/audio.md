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
- **Resynthesised, not sampled.** No recording ships, except the spoken announcements (below). Where a reference recording exists, it is measured and a model is fitted to it (see below), and the game resynthesises from the model. Every playback has new fine structure. Where none exists, a sound is built from its mechanism (the valves, the jet).
- **The ear decides.** A clone that measures well but sounds wrong is wrong. Get new sounds into the game early and iterate on what the user hears, not on fit numbers. Hand-built modal synthesis of the first pass read as thin and cartoonish (footsteps like bamboo, a pump like an alarm, a leaf landing like a cup on a table); fitted models fixed that.
- **The game logic knows nothing of sound.** Systems expose state (the airlock's phases, the player's foot events). `src/audio` watches that state and makes the sound. The one exception is the airlock's announcements: the airlock waits them out, so it knows their lengths (below).

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
  - **But each room's reverb is its own.** A house sound (doors, clocks, footsteps on the house's floors) feeds the house's reverb at its level at 1 m, and in full only while the listener is in the room it sounds in (`house/rooms.ts`, the rooms' boxes). From another room, or outdoors, it is −20 dB (`ROOM_LEAK`, first pass, by ear), and outdoors the shell's path applies on top. Before this a steady sound in the kitchen, fed at its 0.3 m level into one reverb heard in every room, filled the whole house ~30 dB over its own direct sound and leaked out of the front door.
  - **The send is the level at 1 m.** An IR's level is relative to the direct sound at 1 m, but an emitter's input is its level at `refDistance`, so its send should be scaled by `refDistance`. Only the house's sounds do so (`EmitterOptions.sendScale`). Everywhere else the send is still the input as it is: the gate chamber's balance (footsteps ~10 dB wetter than physical, the leaf ~17 dB drier) was tuned by ear on it and is kept, by the user's decision.
- **Slap.** The nearest big face returns a moving echo, a delay of 2d/c with gain 0.8/(2d).
  - Each emitter feeds it on its own send, its share falling 1/r once the source is r farther away than the slap's path 2d (`slapShare`). A source at the listener (the footsteps) keeps it whole. *Rejected:* the slap fed from the zone's bus, the same for every source. Beside the drum's glass or the house's walls, the craft across the Dome slapped back as loud as one 50 m away, about 20 dB over its own direct sound: it stopped falling with distance at 100 m. Outside that face is the drum or the piers' west ends; in the city, the drum's glass, the piers' east ends or the house's walls (its foundation outline, so footsteps on the terrace slap off the facade). The chamber and the house have no slap: their rooms are in their responses.
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

  Check a fit against its recording by ear and by measure before shipping it: render the game's own synth path (the bank's variant, with its gait and floor shaping) and compare third-octave spectra of the steps, normalised to the 250 Hz–2 kHz mean. The grass fit failed that by 35 dB below 160 Hz.

  Use `texture` with `--from`/`--to` for steady sounds. Recordings are 16-bit WAV (convert with ffmpeg). Paths are arguments only; nothing in the code refers to a recording.
- **Bank** (`bank.ts`): everything is synthesised once in a worker during the atmosphere stage, ~3.4 s, ~47 MB. Sounds from one recording share one scale, so they keep the balance they were recorded with.
- **Texture loops are seconds long.** `synthTexture`'s length is log2 of the sample count, not seconds: the field's machines (2^18, ~5.5 s), the hydraulics, the car and the drone (2^18–2^19). Their tonal lines are ~3 Hz wide; a loop must resolve them and must not repeat audibly. The field's loops were once 2^10 samples, 21 ms: every machine buzzed at 47 Hz. The bank test now requires every texture loop to be over 4 s long.

## Footsteps (`synth/footstep.ts`, `sounds/footsteps.ts`)

- **Timed by the gait.** The controller emits a `step` when `HeadMotion` strikes a foot, so sound and head jolt coincide. It also emits `takeoff`, `land` (with impact speed) and `stop` (after moving faster than 0.9 m/s). Within 0.15 s of one foot event, no other fires.
- **Sources:** four recordings, each step a print:
  - six steps on polished marble;
  - three through lawn grass, cut at each step's onset (0.45 s). The steady rumble between steps is taken off as the gaps' floor, but the low thud each footfall makes in the turf is kept. *Rejected:* the first grass fit. Its windows straddled two steps (0.7 s of swish each), and it dropped every band below 160 Hz as rumble, which took the foot's thud with it: a long, hissy step 8–15 dB too bright above 4 kHz;
  - six on fine gravel over sand;
  - twenty on a timber floor (heel then toe tapping the boards, and the boards' low body), cut at each step (0.5 s), the room's tone taken off as the floor. Each strike's band-pass leaks 6 dB/octave, which band gains cannot take back: real filters (high-pass 62 Hz, low-pass 6.5 kHz) set the clone's mean step within ±2 dB of the recording's from 31 Hz to 1.3 kHz and ±4 dB above.
  - The recording passes its microphone: its steps span 17 dB, mostly distance, which the emitter already gives. In the bank each step keeps a quarter of its departure from the walk's mean.
  - Stone, grass, gravel and the house's hard floors are the recordings themselves; the porches' boards and the rugs and runners are built on the timber, the outdoor hard floors on the marble.
- **No cycle.** A walk has every step its recording holds (twenty on the timber), a run up to six, the rarer gaits three. Each floor and gait has its own picker, which keeps the last half of its variants out. *Rejected:* three variants per floor with one picker, which only avoided an immediate repeat: walking across a room the steps fell into an audible cycle (the user's complaint: the sampled sound procedural synthesis should avoid).
- **Memory.** Each step is cut where it has decayed 70 dB under its peak. The fixed lengths (room for the slowest gait's ring) were 40 % silence, kept twice (the bank and its AudioBuffers). The bank's footsteps are ~17 MB.
- **Gaits reshape it:**
  - run: the roll compressed to 0.68, +5 dB;
  - land: 0.55, +7 dB, +5 dB more below 250 Hz, with a second foot ~25 ms later;
  - stop: −7 dB;
  - takeoff: little heel.
- **Floors:**
  - basalt is a little brighter; the deck has a hollow 200 Hz body, glassy ring and grit; bronze rings;
  - the porches' `boards` span a void: the timber recording hollower and lower, with a few low modes ringing longer;
  - `rug` (rugs, runners, mats, on the hard floors) keeps the thud and loses the tap through a real low-pass. Band gains alone cannot darken a print by more than ~10 dB: each strike's band-pass leaks 6 dB/octave, so the strong low bands fill the highs.
- **The house has two floors to the ear** (the user's decision): hard and soft. Boards, parquet, encaustic tiles, flags, hearths and brick are all `wood`, the timber recording; rugs, runners and mats are `rug`. Within the rooms' boxes anything hard is the hard floor (`indoorSurface`): the foundation's sandstone top shows in the inner doorways. Outside, the sandstone steps stay stone and the porches' decks `boards`.
- **Levels.** The bank is scaled so a walking step on stone peaks at `LEVEL.footstep`. The grass and gravel recordings have their own scales: a step there is set against one on stone by loudness above ~250 Hz, not by peak (a low thud carries energy the ear barely weighs; a crunch is many peaks). Turf is 8 dB under stone, gravel and timber 2 dB under. Each foot is its own emitter, 0.11 m either side of the body's line, with a `'located'` zone.
- **What is underfoot** is asked at the feet with their height (the house has storeys): the house's floors first (`house/floors.ts`: the up-facing faces of the floor materials rasterised per 0.1 m cell in the house worker, every height a cell holds kept, so a rug over boards and three storeys share a cell), then the estate's class grid (`estate/surface.ts`: lawn and meadow grass, drive, walks and ramp gravel, flags, brick and the walls' tops stone), then the field's roads and the site (`app/audioWorld.ts`). Walking in from the gateway the feet meet steps, porch boards, the coir mat, the oak threshold, the vestibule's mat, its tiles and the hall's boards (both hard), and the runner (`tests/houseWalk.test.ts`).

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

## The East Lock (`sounds/gate.ts`, `LOCK_GATE_SOUND`)

- **The West Gate's sounds from the lock's own machinery:**
  - its hoists' middles;
  - its leaves' skin centres, mirrored onto the east;
  - no floor bolts.
- **Gate geometry is data** (`GateSoundSpec`), so both gatehouses share one implementation.
- **+4 dB** for leaves twice the radius.
- **Heard across the Dome by distance,** like the craft: its emitters feed the city's reverberation at `DOME_SEND`. The West Gate keeps its full send (the chamber's balance, tuned by ear).
- **Placed by position** (`'located'`): its chamber straddles the glass's line.
- **Only under the Dome,** like the craft (`domeOnly`, `acoustics.ts domeAudible`): its outer machinery stands on the band, but a listener outside the Dome, or in the West Gate's chamber with the inner gate shut, hears none of it. It is cut at its emitters' inputs, so its reverberation goes too, and fades back in over 0.1 s. Before this, a listener on the band heard the lock's outer gate at full, through its `'located'` emitters' outside zone.

## The car (`sounds/vehicles.ts`, `synth/vehicle.ts`)

- **The drive** is the user's recording, cloned as a texture (`models/vehicleCar.ts`): the motors' low hum near 180 Hz and the inverter's tonal line near 790 Hz.
  - The recording is one steady speed, so how it responds is from the mechanism: pitch follows rotor speed, from an inverter idle (0.55) at rest to 1.45 at the top speed; level and brightness follow the load, power or regeneration.
  - It spins up as the driver gets in and down after they leave.
- **From its mechanism:**
  - rolling on stone: band noise near 400 Hz rising with speed;
  - scrub at the tyres' limit: a narrow band near 1.3 kHz;
  - a scrape while it slides along a wall;
  - a knock on a hit, scaled by the contact's impulse: a crack, a thump and the shell's damped panel modes.
  - the wheels deploying and drawing in: the hub actuators' run, the hydraulic power unit's clone pitched up (a small unit) and quiet, in proportion to their speed; a light latch (the vault latch's clone, pitched up) at each stop.
- **One emitter** at the car, reverb send physical.
- **Levels** `LEVEL.car`: first pass, to be tuned by ear.

## The craft

- **The engines' roar** is the user's recording, cloned (`models/vehicleCraft.ts`, broadband, no tones). It comes from the main nozzle, beamed aft (rear gain 0.4, dull ahead), its level, pitch and brightness following the burn.
- **It feeds the city's reverberation,** so an arrival fills the Dome. It is not behind the estate's silencer: the plan wants the craft heard through the whole Dome.
- **It falls with distance across the whole Dome** (the user's rule): loud close by, very quiet from the far side. Two things held it level:
  - the slap (see Acoustics), ~−16 dB re its level at 8 m wherever the listener stood by a wall;
  - the city's reverberation. It is lifted 10 dB, and at full send it held the level from 400 m to the far side. The craft feeds it without the lift (`DOME_SEND` 0.3 in `mix.ts`).

  Now, by a wall, the roar falls steadily from 20 m to 1 km. At 1 km it is ~31 dB under its level at 30 m (`tests/vehicleSound.test.ts`).
- **Only under the Dome** (the user's decision, over the physical leak through the glass and a shut leaf; `acoustics.ts domeAudible`, shared with the East Lock). A listener outside the Dome, or in the West Gate's chamber with the inner gate shut, hears nothing of it: the roar is cut at its source, so its reverberation goes too. Once the inner gate starts to open, the chamber hears it through the gap, the path opening with the leaf.
- **Level** `LEVEL.craft`: first pass.

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
- **The estate's silencer** (`estate/silencer.ts`): a device in the estate takes every machine and relief stack away for a listener within its walls (the terrace's outer wall face in plan, the gateway's ramp and the house included). It fades with the listener's place, not in a step: full 4 m outside the wall face, gone 10 m inside, eased (smoothstep), and smoothed over 0.3 s. *Rejected:* a hard cut at the wall face, which switched the field off between two footsteps. The field's emitters all feed one bus after their paths, so the fade acts at the ears, not after each machine's propagation delay. Behind it the voices, levels, spreading and wander run unchanged.
- **The Stand's silencer** (`terminal/silencer.ts`): the same device on the Stand by the West Gate (`docs/terminal.md`), for the player up on it, on foot or in the car (by the car's ground, not the chase camera). The Stand is too small for a fade across a wall in plan, so it fades with height: full at the foot of the ramp or the stair, gone at the deck, eased, then followed over 0.45 s so the short stair never cuts it between footsteps. Its gain multiplies the estate's.

## The crew (`sounds/crew.ts`, `docs/crew.md`)

- **Every voice is a clone or the bank's own synthesis**, by the user's sources:
  - **Drones:** the user's drone recording, cloned as a texture (`models/droneRotor.ts`, fitted to its steady hover at 78–94 s). The clone matches within ±1 dB per third-octave from 25 Hz to 13 kHz, −3 dB at 100 Hz. Its blade-pass lines near 215–230 Hz are a few hertz wide, so the loop is 2^19 samples (~11 s), like the car's.
    - Rotor speed follows thrust: pitch with its square root, level and brightness with the thrust.
    - A Ferry's bigger rotors run lower (0.52–0.70 of the recording) and louder than a Spotter's (0.80–1.08).
    - Resting on a cradle or pad, a drone is silent.
  - **Wheeled machines** reuse the car's drive clone (the user's choice):
    - a Dray's hub motors (smaller than the car's, so higher: 0.9–1.65), energised and idling while it stands, over its tyres' roll on the stone;
    - a Linewalker's drive, smaller still, with a hollow roll from its rollers on the pipe;
    - the estate's mower, with its reel's chatter (band noise at 2.8 kHz, modulated at 22 Hz);
    - the hedge trimmer, with its blades' strokes (modulated at 45 Hz).
  - **Actuators:**
    - a Rigger's boom and a Dray's probe reuse the hydraulic power unit's clone, pitched up, as the car's wheel actuators do;
    - the probe seats with the vault latch's clone.
  - **Walkers' feet** are the player's recorded steps made metal (`synth/footstep.ts` `synthRobotStep`); the user wanted them "a bit more metallic".
    - The boot's heel-to-ball roll is compressed, its scuff taken off, its weight raised.
    - As the foot lands its cast shell rings: a few inharmonic modes, 1.4–5.2 kHz for a Hand and 0.65–3.2 kHz for a Rigger's pad, short because the sole damps them. Under it is a low knock from the ankle actuator's gear lash.
    - Turf and gravel take most of the ring.
    - Voiced on what is underfoot as the player's are: stone, the decks, grass and gravel for the Hands; stone for the Riggers.
    - **Metal is tonality.** The boot recording's roll already puts plenty of energy above 1 kHz after the strike; what makes metal is that the tail rings in a few narrow lines. The tests measure the tail's spectral flatness, not its high-band energy.
- **As the field's machines:**
  - A pool of HRTF voices goes to the loudest loops where the listener stands, with hysteresis: 4 voices for the field's crew, 2 for the estate's.
  - Loops feed no reverb (two dozen robots in the city's diffuse field would be a hum without a source).
  - Steps are short-lived: 3 + 2 one-shot emitters, voiced within 40 m. They feed the space's reverb as the player's steps do.
- **The estate's silencer** takes the field's crew away for a listener within the estate's walls, with the field's machines. The estate's three Hands, the mower and the trimmer are on its side and are not silenced.
- **Levels** `LEVEL.crew`: first pass, to be tuned by ear.

## The estate

- **No tree sound.** The estate's quiet is the Dome's still air, the clock through the open door and the footsteps. *Rejected* (by ear): leaves rustling from the nearest crowns, cloned from a recording of a broadleaf crown in a breeze.

## The house (`sounds/house.ts`, `synth/house.ts`)

- **Doors** are cloned from one recording of a door opening and closing, split into separate sounds:
  - the opening (latch drawn, leaf freed, tongue home) plays from the handle when a shut leaf starts to open; opening further from ajar makes no latch sound;
  - the close is cut at 0.43 s, before the latch first touches the keep. The swing part (handle, quiet) plays as the leaf starts closing. The shut part is scheduled so its strike (the close's strongest onset, 0.29 s into it) lands when the leaf reaches rest;
  - the leaf's time to rest is its own motion run ahead (`HouseDoor.timeToTarget`, the same step the doors use, at 1/240 s). A closed form ignoring the rate's lag was 0.2 s late. If the leaf is stopped short (the walker in the way, or reopened) before the strike, the pending shut is cancelled;
  - voices are a pool: two inside the house, one for the outer doors (radiating into both the hall and the estate); pocket doors play the same at −4.4 dB.
- **Clocks** are voiced at the export's `Sound_` markers (their `clip` and `gain`), as each floor is built:
  - clocks beat an anchor escapement built from its mechanism: the unlocking click, the drop a few ms later (the strong blow), the movement's plates ringing bright and short and the case low and longer. The modes are fixed per clock; the blow varies per beat, and the exit pallet strikes softer at the top (tick, tock). The longcase beats seconds with a deep trunk; the mantel clock 11,520 an hour in a small case. No clock is perfectly in beat: the tock comes 1.5 % late;
  - within 45 m of the house's middle only: beyond it no beat is scheduled.
- **No kettle.** *Rejected* (by ear): a kettle simmering on the range.
- **Levels** (`LEVEL.door`, `tick`): first-pass values, to be tuned by ear.

## Announcements (`loadSpeech.ts`, `speechCues.ts`, `sounds/speech.ts`, `synth/chime.ts`)

- **The user's recordings, played as they are** (`public/speeches/`, fetched and decoded at boot, each scaled to a peak of 1). They are the one exception to resynthesis. Everything else is as for any sound: each is a loudspeaker in the world, played through an emitter, with delay, spreading, air, paths, medium, reverb and HRTF.
- **Where each sounds from:**
  - `enter-dome`, `exit`: the gate's PA, just west of the outer lip over the opening, facing the band (dull behind);
  - `pressurization`, `depressurization`: the chamber's speaker, high on its middle (its reverb is the chamber's);
  - `enter-compound`: the main portal's arch, at its spring height;
  - `drive`: the car's cabin, moving with it;
  - `enter-estate`, `aircraft-perimeter`: beside the listener and moving with them, 1.2 m off ahead and to the right where it began. It is not head-locked, so turning still places it.
- **The chime.** Every announcement except `pressurization` and `depressurization` opens with a brief two-tone chime from the same loudspeaker, so it is placed, carried and reverberated exactly as its speech is. The speech starts 0.75 s after the first strike (`CHIME.lead`).
  - It is built from the mechanism: two tuned tone bars, rising a fourth (E5, then A5 0.24 s later). Each rings its fundamental and a tone bar's tuned overtones (4×, 10×), the higher ones dying sooner. A soft mallet gives a ~1.5 ms rise, not a click; a faint second harmonic is the horn's; the fundamental's two bending modes 1.5 Hz apart give a slow shimmer. The second bar rings on under the first word, then fades by 1.5 s.
  - It is synthesised once when the sound starts, and it is the same every time, as a chime unit is.
  - Level: `LEVEL.chime`, peak relative to its speech's (a ringing tone carries far more energy per peak than speech). First pass.
- **The airlock waits for its announcements** (`city/gate/airlock.ts`, lengths set at boot from the clips and their chimes, plus a 0.5 s pause):
  - a shut outer gate opens to a player arriving from the band only after `enter-dome` (venting first, silently, if the chamber was left at the city's pressure);
  - a player sealed in the chamber is filled only after `pressurization`, vented only after `depressurization`;
  - `exit` follows the outer gate shutting and bolting behind a player who went out through the chamber. Nothing waits for it.
  - An announcement already made holds for the rest of its approach or cycle; one waits for another still playing.
- **The others** are crossings (`speechCues.ts`), each re-armed only once the listener is 3 m back out:
  - `enter-estate`: crossing the terrace's outer wall face inward (the silencer's line);
  - `enter-compound`: crossing the main portal's line eastward, between its pylons;
  - `drive`: taking the car;
  - `aircraft-perimeter`: only while both the craft and the listener are over the pad's circle in plan (the dark pad and its white apron, out to the ring road, r 100 m): at once, then every 5.5 s (the chime and the speech take 4 s). When either leaves it, the one playing plays out and no other begins. *Rejected:* announcing on stepping onto the pad alone, and through the craft's whole settle–turn–lift window wherever the listener stood in the compound.
- **Voices.** Two pooled emitters. A recording already playing is not restarted; a third announcement takes the voice that finishes first.
- **Levels** `LEVEL.speech`: first pass, to be tuned by ear.

## The terminal (`sounds/terminal.ts`, `synth/terminal.ts`, `loadNarration.ts`)

- **One speaker:** the grille in the terminal's pedestal (`docs/terminal.md`), an emitter like any other (0.3 m, facing the deck, quieter and duller behind). Everything the terminal says comes from it.
- **The narration** (T1–T6) is the user's recordings, the second kind of sound that ships as a recording. It is fetched and decoded after boot, in the background (boot does not wait), each scaled to a peak of 1, and its loudness envelope is kept for the screen. A recording starts at the OS's game time; if it was still loading, it starts late, from where it should be. It fades out in 60 ms when stopped or replaced.
- **Interface tones**, built once: a key's tick (a haptic actuator's click on the panel's thump), a rising pair on opening, the pair falling going back, a low note on stopping, a dull knock where there is nowhere to go, a three-note swell on waking and its fall on sleeping.
- **The star's song** (Observatory): Alpha Centauri A's p modes (degrees 0–2, orders 16–28, νmax 2400 µHz, Δν 105.5 µHz), sped up 10⁵ times (to 170–310 Hz). It is made as the star makes them: each mode is a damped resonator (a bandpass ~0.12 Hz wide, the 1.2 µHz linewidths sped up) driven by noise, the convection that excites them, on a low rumble of granulation. The comb's l = 0 and l = 2 pairs, 0.56 Hz apart, beat slowly. It is built when it starts and released when it stops.
- **Levels** `LEVEL.terminal`: first pass, to be tuned by ear.

## Runtime

- **Boot.** The `AudioContext` is created at the atmosphere stage; its rate sets the bank's, built in `bankWorker.ts` in parallel. The context stays suspended until the pointer-lock click; pause fades and suspends it; fatal errors close it. The player's volume and mute (`docs/ui.md`) scale `LEVEL.master` through `GameAudio.setUserGain`.
- **Per frame** (`Game.frame`, after the camera's matrix): the ears move to the camera, airlock events and queued foot events sound at time `t`, and every emitter's path is re-derived.
  - `glide` skips unchanged targets, so steady parameters add no automation.
  - Each zone's path to the listener (`transmission`) depends only on the listener's zone and the gates' and house doors' openness, so the engine derives it once per zone per frame (`AudioEngine.path`) and every emitter reads it; distance, directivity, delay and filtering stay per emitter.
- **Cost.** 31 HRTF panners (two for the announcements, eleven for the crew), four convolvers (5.5 s, 7.5 s, 1.6 s and 1.4 s stereo) and short-lived sources (the vehicles' loops besides).

## Review

- `node tools/audio-preview.mjs [walk-in walk-out chamber-stand turn deck]` runs the real controller, walls, airlock and `GameAudio` frame by frame in an `OfflineAudioContext` in headless Chrome.
  - It writes WAVs to `tools/out/audio/` and prints events, per-second peak/RMS and clipped samples.
  - `direction` prints the left/right balance of one source while the listener turns (±9–10 dB at 10 m).
- `tests/audio.test.ts`:
  - zones, transmission and the slap distance's continuity;
  - IR decay times (±20 %) and levels;
  - clones resynthesising at their models' levels, texture loops and the bank's scaling;
  - gaits ordered by force on every floor; gravel louder than turf (at the bank's scale), rugs dark, boards hollower than timber;
  - the house's two floors (hard, soft), every recorded timber step in the bank at even levels, and the picker never returning to a step within half its variants;
  - the house's shell and open doors, the slap off its walls, the clocks' tick and tock;
  - the door's split, the loops' seams, the lawn's level against stone;
  - the airlock's event order;
- `tests/airlock.test.ts`: the announcements' order on a walk in and out, and nothing moving while a held one plays; `tests/speechCues.test.ts`: the crossings and the pad's rule; `tests/chime.test.ts`: the chime's two bars, its clickless start and decay, which announcements it opens and the airlock's wait including it.
  - the controller's foot events.
- `tests/crewSound.test.ts`: the walkers' steps ring as metal, deeper for the Rigger and damped on turf; the drone's loop is seamless with its blade-pass line.
