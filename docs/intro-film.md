# Intro: the film

Code: `src/intro/`. The script is `docs/intro.md`; the ship is `docs/intro-ship.md` (its cabin's light `docs/intro-cabin-bake.md`), the view from outside the sphere `docs/intro-space.md`, the sound `docs/intro-audio.md`.

## Shape

- **Staged and rendered live**, first person, about 2 min 40 s. The user accepted a film longer than the script's 30–60 s so the recorded lines are never cut: the timeline (`timeline.ts`) is laid out from the nine lines' decoded lengths. The picture waits for the voices; each answer follows a fixed beat (`ANSWER`).
- **Entry.** When loading finishes the Enter screen shows over the still-rotating key art (not black). The first Enter click starts the intro, every visit. Enter (or NumpadEnter) skips straight to its end; Space pauses and resumes it (the film, the world and the sound hold together). The keys stay hinted in the corner, quietly, for the whole intro (the review mode shows its own readout instead).
- **The end is the game's first frame, without a step onto it.** Over the last 1.6 s the gait's sway and what is left of the head's turn ease out onto the spawn view, and the walk ends on the game's own ground there (the apron's slab is 1.5 cm over the deck). *Rejected:* cutting the sway on the last frame (a 0.6° jump) and ending the walk at deck height (the player's first frame rose 1.5 cm). `tests/intro.test.ts` checks the last frames settle.
- **The end is the game's first frame.** Scene 3 ends looking at the West Gate from exactly the `gate` spawn viewpoint, so the handoff to play is a cut that does not show. The intro then removes and disposes everything it made and resets every switch it set (world visibility, the ground's albedo for the sky, the band uniform, its sounds).
- **The world only advances on the band.** In scene 1 the world is hidden and held; scenes 2 and 3 run it as in play, around the ship.

## Scenes

1. **Deep space.** Waking in the pilot's seat (`overlay.ts`: heavy lids that lift, fall and lift again, out of focus, then a blink and focus; ordinary blinks are not shown, nobody sees their own). The sphere fills the windshield; the star blazes through a slot in it. Aurelia speaks, the Guardian answers, then the head turns down and right to the side monitor (diagrams of the star and the shell, every stat nominal).
2. **Over the band.** The ship comes in from 1.9 km out and 440 m up, slows to a hover beside the Dome (`flight.ts`, a cubic approach so it is not front-loaded), descends and lands just outside the West Gate. The touchdown is a sprung settle into the gear's compression, with a jolt of the seat.
3. **Off the ship.** The Guardian walks toward the door, which unlatches, moves out and slides aft as they come. They wait a pace back inside it until it is open and the stair has run out and swung down to the deck; out, down the treads, a couple of steps toward the gate. Then they turn round to the ship and back slowly toward the gate, watching it the whole time: the stair stowing, the door shutting, the engines spooling, the lift, the turn and the climb until it is gone. Last, round to the gate (the game's first view).
   - *Rejected:* walking most of the way to the gate before looking back; stepping into the doorway while the door was still sliding.

## The eye (`eye.ts`, `gaze.ts`)

- No body is in the scene; the camera is the head and its eyes. Seated, the head turns about a neck pivot behind and below the eyes, so a turn swings the eye as a person's does. On foot it follows a route (a pure function of time) through the cabin, onto each tread (`treadCentre`) and across the deck, with the player's head motion and foot events (the steps' sound).
- **A person's head, turning smoothly** (the user's direction: someone arriving at a wonder for the first time, who looks about a great deal, but as a head moves, not as eyes dart). Attention goes from one thing to the next: authored fixations on what is there (the sphere's parts, the speaker as Aurelia starts, the dash's readouts, the monitor, the Dome, the door as it slides, the stair, the ship). The target is eased and the head is a critically damped spring toward it: every turn starts gently, flows through a change of mind and settles without overshoot in about a second and a half; slower when groggy. Moving targets (the door's leaf, the stair, the ship) are tracked with a head's lag. While a fixation is held the head drifts slowly, a degree or so every few seconds. Integrated at 120 Hz from the film's start, carried forward frame to frame and replayed after a jump back (seekable).
  - *Rejected:*
    - minimum-jerk moves between held poses, which read stiff: a glance left and right, then a long frozen hold;
    - eye-like shifts (a fraction of a second, with small fast secondary looks), which read abrupt; the quick "reading" glances at the monitor read as a camera rig's jitter;
    - summing every shift's step over the whole list (past targets stayed live; one walked over spun round and snapped the view), and replaying past shifts from the eye's current position (the same snap).
  - Targets are seen from where the eye was at each moment, and a look at the ground is at a point ahead of where the feet go: a point the eye passes over spins the view round (it did, 180° at the stair's head).
  - `tests/intro.test.ts` checks the whole camera's rotation (not only where it points: looking straight down, a flip of heading barely moves the direction but spins the picture) never exceeds a head's 220°/s within a scene, the view never stays within half a degree for 2.5 s while the eyes are open, the eye keeps inside the door until it may go out, watches the ship while backing away, and ends exactly on the spawn view. The ship's flight is checked for snaps frame to frame: its hover sway once started at full and lifted the cockpit 0.2 m in one frame, and its touchdown rock started off zero.

## Exposure

- **Waking:** the lids overlap past the middle and reach beyond the screen's edges; shut eyes are black (the veil), whatever the lids' soft edges let through.
- **Scene 1:** the eye's adaptation is capped (`SPACE_ADAPTATION`). An average meter would open up to the nearly black sphere and the blaze would flood the frame; an eye squints at the blaze.
- **Aboard on the band:** capped lower (`CABIN_ADAPTATION`), so the cockpit is not lifted until the windows blow out.
- **Rejected:** a white-flooded first scene from image-based light inside the hull (the cabin's light is baked; `docs/intro-ship.md`), and an electrochromic tint on the windshield to tame the star. The fix was the game's real star and structure shaders with its glare and black point.

## Review

- `?introReview` (local hosts only): the intro alone, over and over, to inspect it without reloading (`review.ts`). Enter starts it as in play, but it never hands over to the game: at its end, and on Enter or R, it starts again. Space holds and runs it; ←/→ scrub 5 s (1 s while held); `,`/`.` step a frame and hold; 1/2/3 jump to the scenes; O takes the lids, fades and waking blur off. A readout shows the film's time, scene and state. A jump stops the lines sounding and picks up any line under way from where the film lands; nothing speaks while held.
- `?intro=<s>[:hold]` plays the intro from s seconds in without the Enter click; `:hold` holds that moment (combine with `?introReview` to start the review there). `?introView=lat,lon,dist` frames scene 1 from elsewhere.
- `node tools/intro-shots.mjs --dist <vite build> t…` writes stills at film times.
- `node tools/ship-shots/shots.mjs [--real] [--t s] ext/… in/…` renders the ship alone in seconds (`docs/intro-ship.md`).
- `node tools/intro-audio.mjs` renders the soundtrack (`docs/intro-audio.md`).
- `tests/intro.test.ts`: the lines' order and scenes, scene 3's order (the door's leaf clear of the stair whenever it moves), the ship standing on its feet at rest, the stair's pads on the deck, the glazing's analytic openings, the cabin's acoustic coupling, the tones, the review parameters.
