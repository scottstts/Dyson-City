# Player: movement and the moving eye

Code: `src/player/`. The controller (`controller.ts`) owns the walk (2 m/s), run (Shift, 5.6 m/s), crouch, jump and the step-up ease. The head's motion on top of it is `headMotion.ts`.

- **The walkable world is injected** (`Walkable`): a surface height (the site, plus the city's raised floors) and walls (`collision.ts`): plan segments in a grid, resolved against a 0.3 m body in sub-steps of half its radius, so it slides along walls and cannot tunnel. Dynamic walls (the gate's leaves) switch by tag.

## Head motion

The eye moves as a walking or running person's head does: real gait, kept small. The eyes stabilise the gaze, so a person barely perceives their own head turning. Exaggerated game bob reads as a camera on a stick.

- **Driven by the gait, not by time.** The step phase advances at the cadence for the current speed (`cadence(v)`: ~2.1 steps/s walking, ~2.9 running). Accelerating, slowing and stopping stay in step. Amplitudes follow speed through a short lag, so the head settles as the body stops instead of snapping still. In the air the gait fades out.
- **Walk vs run are different mechanics**, blended by speed:

  | | Walk | Run |
  |---|---|---|
  | Vertical | Inverted pendulum: lowest at heel strike, highest at mid-stance, ~4.5 cm peak to peak | Spring-mass: lowest at mid-stance, highest in flight, ~9 cm |
  | Lateral shift over the stance foot (once per stride) | ±1.4 cm | ±1 cm |
  | Roll with the shift | ~0.25° | ~0.45° |
  | Foot-strike jolt (damped spring, 7 Hz) | slight | clear |

- **Leans into acceleration**: pitch for forward, roll for sideways, at most ~1.1°, smoothed over ~0.12 s.
- **Landings** sink through the knees: a soft 2.6 Hz spring kicked by the impact speed (a jump lands ~5 cm deep).
- **Frame-rate independence.** Springs integrate in substeps of at most 1/240 s, and a foot strike lands at its own moment within the frame (`tests/headMotion.test.ts` compares 60 and 240 Hz).
- **No FOV kick when sprinting.** It is a game convention, not something a person sees.
