# The Stand and the West Gate terminal

Code: `src/terminal/` (`layout.ts` holds every dimension; `build/` the geometry; `os/` the terminal's OS and screen; `use.ts` using it). Sound: `docs/audio.md`, "The terminal". Script and recordings: `docs/terminal-narration.md`, `public/speeches/T1–T8.mp3`, portraits in `public/profiles/`.

## The Stand

- **Where:** the Gate Court's north-west corner, where the car used to stand, between the gate's passage and the estate's wall. Round, 13 m across and 0.6 m high: sized for one car with a walk round it.
  - *Rejected:* a 26 m, 0.9 m platform on the court's south side (by the user: the platform belongs where the car was; one car is all it needs).
- **Access:** the ramp runs east onto the court, toward the Axis Road. The stair (four risers) faces the gate's passage. The terminal is on the north rim, the estate behind it.
- **The car parks nose to the ramp.** It cannot turn on the deck: it reverses up and drives straight off.
- **Form:**
  - a white ceramic drum on a recessed black plinth, so it floats on a shadow line;
  - a polished basalt deck laid in rings round the centre, with bronze inlays (the parking circle, a rosette, the drive line to the ramp) and a honed border course;
  - a bronze coping over the rim's arris;
  - the ramp between ceramic cheeks with 15 cm kerbs;
  - bronze joint strips and nosings;
  - a balustrade of bronze posts and rail with steel infill rods, ending on newels at the ramp, the stair and the terminal.
- **The ramp:** 9 m long, 6.4 m between cheeks (the car is 5 m across its deployed wheels), with parabolic transitions at the foot and the top, so no crest grounds the car (`rampRise`).
- **Where solids meet a plane:**
  - the ramp and the stair meet the drum on a chord (the outline is cut there; `standOutline`);
  - every hidden bottom sits at its own depth under the pad, so no two share a plane;
  - outline samples keep clear of chord ends, so nothing slivers.
  - `tests/terminal.test.ts` holds topology, coplanar overlap and clashes, with declared seats only.
- **Light:**
  - its own reflection probe, 4 m over the deck (`probe.ts`);
  - the star-shade, with the deck, the ramp and the treads as the shade's floor;
  - the vehicles' shade on the deck, ramp and treads (under the parked car, noon shade).
- **Quiet:** like the estate, the Stand has a silencer for the field's machines: they fade out as the player climbs its ramp or stair, on foot or in the car, and back as they come down (`silencer.ts`, `docs/audio.md`).
- **Walking** (`walk.ts`):
  - one walk mesh from the Stand's own surfaces;
  - invisible fences on the balustrade's lines (its rails are too fine to walk against);
  - a block round the terminal.
- **The car** (`docs/vehicles.md`) meets its own walls: the drum (open across the ramp's chord), the cheeks, the rails set in by its clearance, and the terminal. They are kept out of the chase camera's walls, since the camera looks over them. It drives the ramp on `carGround`.

## The terminal

- **Form** (`build/console.ts`):
  - a bronze base plate;
  - a tapered ceramic pedestal with the speaker's perforated grille in its face;
  - a bronze cradle (two arms to trunnion bosses) holding the head, tilted 15° back;
  - the head: a ceramic housing, a bronze bezel and a hood, deepest at the top (25 cm), where the star is;
  - five keys on a ledge, which go down when the player presses theirs;
  - a lamp in the hood's lip, lit while awake.
- **The hood is black:** matte inside (a light trap), glazed outside.
  - *Rejected:* a white hood. Sunlit, it was the brightest thing framing the screen, and its glare veiled the screen.
- **The screen:**
  - 1.12 × 0.70 m (16:10);
  - its OS drawn into a 1920 × 1200 canvas, uploaded as the glass's emission;
  - redrawn only when the OS changes, or as fast as what moves needs (24 Hz for a briefing, 2 Hz idle);
  - never redrawn beyond 45 m.

## Using it (`use.ts`)

- **E** on the deck, at the spot in front of it and looking at the screen, wakes it. The view moves (1.3 s, smootherstep) to a shot square on the screen, at the distance where the screen fills 80 % of the view's limiting side (recomputed every frame, so a resize keeps it). The pointer stays locked.
- **There**, the arrows, Enter and Backspace go to the OS, and the mouse does nothing. E leaves: the OS sleeps and the view returns to the eye.
- **The eye and the screen** (by the user):
  - everything round the screen may blow out as the eye opens into the hood's shade; the screen itself reads normally;
  - so the eye is held at ×6 (`READING_ADAPTATION`) while reading, and the screen divides the eye's adaptation out (auto-brightness);
  - its cover is an advanced anti-reflective glass (~0.08 %).
  - *Rejected:*
    - the free eye at 0.35 white: it opened ~3 stops for a mostly black panel and lifted the glass's reflection to a muddy grey;
    - auto-brightness with a free eye: the dimmer panel opened the eye further, and the loop ran to the eye's maximum, veiling the screen.
- **Review:**
  - `?terminal=<keys>` (u d l r e b) starts at the screen and presses the keys after the boot;
  - `?tat=<s>` holds the playing recording s seconds in, for stills;
  - viewpoints `stand`, `standrim`, `terminal`, `car`;
  - `tools/terminal-screens/shots.mjs` draws the screen alone, for its pages and briefing beats.
- **Cost:** at the screen, 130 fps at 1600 × 1000 on the review Mac with a briefing redrawing and uploading at 24 Hz, the same as a still page.

## The OS (`os/`)

- **Pure state** (`os.ts`): the screen draws it and the sound watches it. A recording "playing since t" is state, as the airlock's phases are.
- **Navigation:**
  - level 0, sections: ↑↓ choose (each one's contents show beside it), → or Enter goes in;
  - level 1, entries;
  - level 2, an open entry or a one-page section: Enter stops or replays, ↑↓ move a page's rows, ← closes.
- **Sections:**
  - Archive: Origin (T2), The Shell (particulars, and a to-scale section of the sphere about the eye), The Compound (the plan);
  - Comms: Clara Hayes (T4), Sam (T5), General Daniel Ward (T7), Maya (T8), with portraits, the recording's real loudness envelope and the transcript appearing as it is spoken;
  - Control (T3): the live plan and status rows;
  - Observatory (T6, then the star's song): the p-mode spectrum, the signal and the readouts.
- **Boot:** a full boot with T1 on the session's first wake; a half-second wake after.
- **Live** (`live.ts`): the craft's leg and place, the East Lock's and the West Gate's gates. The recordings never say a number that changes.
- **Every figure is the world's own** (`content.ts`): the Shell's particulars; Alpha Centauri A's modes (νmax 2400 µHz, Δν 105.5 µHz, δν₀₂ 5.6 µHz, linewidth ~1.2 µHz).
- **Subtitles** (`cues.ts`) are generated by `tools/terminal-cues.mjs` from the user's timestamped transcripts (`tools/terminal-transcripts.json`). Lines too long for the screen are split at the pause nearest their clause break. Without a transcript the tool aligns the script's sentences to detected pauses, which is approximate. Re-run it after re-recording.
- **Briefings** (`briefing.ts`): T3 and T6 have a diagram per line, drawn at the line's progress and crossfading as each starts; the Origin page's diagram follows T2's words. Beats are found by the words said, not line numbers, so a re-cut transcript keeps them in step. Each is listed in the module.
- **Look** (`theme.ts`): warm white and the frame's coolant amber on warm black, hairline rules, a sans for the interface, a mono for figures, a serif for what people said.
