# Intro: sound

Code: `src/intro/audio/`, through the game's engine and its rules (`docs/audio.md`). Every sound is radiated from where it is made, carried by its path and reverberated by its space.

## The cabin is a space (`audio/acoustics.ts`, `reverb.ts`)

- **A fifth zone, `cabin`.** About 11 × 5.2 × 2.6 m of panels and padded liners, T60 ~0.33 s in the mids, image-source early reflections. Which points are aboard, the intro tells the engine (`AudioEngine.cabin`, from the ship's pose).
- **Coupling.**
  - The hull, door shut: −32 dB, low-passed at 280 Hz.
  - The door: leaks early, as the gate's slot does, and wide open is a doorway (`hullPath`).
  - The ship stands on the band, so to or from anywhere else the hull is in series with the band's path.
  - **In vacuum nothing crosses at all.** In scene 1 the world's direct sound (the dry bus) is shut off too: only the ship is heard.
- **Structure-borne sound is heard in vacuum.** The engines' low rumble and the gear's blows reach the cabin through the floor. They are emitters in the cabin, not the outside sources heard through the hull.
- **Sounds that ride with the listener are placed exactly.** The engine smooths the listener's and each emitter's position over a few hundredths of a second, and a smoothed position lags its target by speed × time constant. At the ship's 60 m/s the Guardian's voice, 12 cm from the ears, sat 0.55 m behind them (−13 dB: line 4 all but vanished; held still, the same line played normally). Equal time constants did not match the lags in the browser either. While the intro runs the listener is placed exactly each frame (`AudioEngine.listenerGlide` 0) and so is every intro emitter (`glide: 0`); the game's smoothing is restored when it ends.
- **A far source scatters little back.** The band's reverberation is the open deck's faint scatter about the listener, fed per emitter at a fixed send: the ship climbing away held ~−19 dBFS from 100 m to 1.7 km, all of it that scatter (its direct sound had fallen to −58). Beyond 15 m from the listener an intro source now feeds it falling as 1/d with its direct sound (`BAND_SCATTER`): the departure fades from −17 dBFS at lift-off to −57 at 1.7 km.
- **Through the floor, only the lows.** The nose gear's actuators and latches and the touchdown's blow reach the sealed, lined cabin through its structure: a low-pass (320 Hz, 200 Hz) and a loss before their emitters. The user's verdict on the first pass: the landing gear drowned the Guardian's line and the touchdown was far too loud for a sealed cabin.
- **The voices carry the scene.** The ship's machines (every intro emitter but the two voices) dip 6 dB while a line is spoken.
- **Small and hard means wet.** The cabin's critical distance is ~1.2 m, so its reverberation is as loud as the direct sound a step away. Sends are the level at 1 m (`sendScale` = refDistance, as the house's). The cabin hum's first level (0.05) put the sleeping cabin at −13 dBFS RMS; it is 0.004.

## Sounds (`sounds.ts`)

- **The cabin's machinery:** the user's recording (`refs/audio/intro/ambient.mp3`, 4–58 s), resynthesised as a texture (`models/introCabin.ts`), from an air grille aft and the avionics bay under the dash. It runs while the ship has power.
- **Voices** (`lines.ts`): the user's nine recordings, played as they are, like the announcements.
  - **Aurelia** comes from the overhead panel's loudspeaker, coloured as one (no deep bass, rolled-off top, a presence lift).
  - **The Guardian** comes from the mouth, below and ahead of the ears, with a low shelf for bone conduction.
  - The PA's chime opens each exchange Aurelia starts (lines 1, 3 and 6): two struck bars falling a fourth (`tones.ts`).
- **Avionics:** a piezo confirm on its haptic thump, played:
  - at the monitor as the eye comes to it;
  - twice on the dash as the descent begins;
  - once, lower, after touchdown.
- **Engines:**
  - The craft's roar clone sounds at the nozzles (beamed aft) and the lift vents (beamed down).
  - Pitch, level and brightness follow each engine's spool, which lags the thrust: up in ~1 s, down over ~3.4 s. That run-down is the shutdown's pitch drop.
  - The lift fans add a narrowband whine at blade-pass and harmonics: noise through narrow bands, not oscillators.
- **Gear:**
  - The gate's hydraulic power unit clone, pitched up: the nose leg's under the cockpit floor, the mains' in the nacelles.
  - Latches when down and locked or up.
  - **Touchdown:** the car's knock and the vault's shut through the floor, the pads on the deck.
- **Door:**
  - unlatch;
  - the seal breaking: a falling hiss (1 bar inside, 0.55 outside);
  - its actuator, the leaf's roll on its track, its stop and its shut.
- **Stair:** its actuator, and the pads meeting the deck.
- **Footsteps** are the player's, on `deck` aboard and on the treads (`TransientSounds.surface`).
- **Waking:** the listener's hearing (`AudioEngine.hearing`, transparent otherwise) is muffled and faint until the eyes open, clearing over ~3 s. It is on the whole output, reverberation included.
- No existing sound was altered. The clones are reused through new emitters at new pitches and levels (`LEVEL.intro`).

## Lifetime

`GameAudio.setTransient` gives the intro's sound its turn each frame. On the intro's end or skip it stops every voice, takes its emitters out of the engine (`Emitter.dispose`) and resets the dry bus, the hearing and the cabin hook.

## Review

- `node tools/intro-audio.mjs [--from s] [--to s] [--level key=value,…]` renders the soundtrack offline over the real flight, ship state and eye to `tools/out/audio/intro.wav`. It prints the timeline, the listener's zone, per-second peak and RMS, and clipped samples.
- `--level` overrides `LEVEL.intro` to hear one source alone.
- Levels are first pass, to be tuned by ear:
  - the sleeping cabin ~−40 dBFS RMS;
  - the descent ~−31 dBFS RMS, the touchdown peaking ~−9 dBFS;
  - speech peaks −3 to −10 dBFS;
  - lift-off ~−19 dBFS RMS from the deck;
  - no clipping.
