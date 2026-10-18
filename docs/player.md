# Player: movement and the moving eye

Code: `src/player/`. The controller (`controller.ts`) owns the walk (2 m/s), run (Shift, 5.6 m/s), crouch, jump and the step-up ease. The head's motion on top of it is `headMotion.ts`.

- **The walkable world is injected** (`Walkable`): a surface height (the site, plus the city's raised floors) and walls (`collision.ts`): plan segments in a grid, resolved against a 0.3 m body in sub-steps of half its radius, so it slides along walls and cannot tunnel. Dynamic walls (the gate's leaves) switch by tag.
- **Storeys walk on 3D meshes** (`walkMesh.ts`: the house, the estate). Triangles split by slope into floors and walls. Walls count only within the body's band (feet + 0.42 to + 1.75 m), so a riser under 0.42 m is a step. `ground(x, z, yMax)` is the highest floor at or below `yMax`, so the floor under the feet is found on any storey. Ceilings block like walls inside the band: a slope that comes down below the head (the gable room's) stops the body; one overhead is clipped away. Door leaves are dynamic triangle sets that stop against the body (`docs/house.md`).
  - **A sole, not a point:** a floor within 3 cm in plan holds the feet (at its nearest point, never extrapolated). Without it a 2 cm crack between two proxies read as no floor: the walker started to fall and dropped through the porch deck.
  - **Landing is swept** over each frame's drop: any floor between last frame's feet and this frame's catches them. Testing only 5 cm above the new feet let a fall faster than 3 m/s at 60 Hz tunnel through a thin deck (`tests/controller.test.ts`).
- **E uses** what the eye aims at (the house's doors), or gets in and out of the car within reach (`docs/vehicles.md`; the car takes the press first); `Input.consumePress` reports a key press once.

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

## Foot events

`PlayerController.onFoot` reports what the feet do, for sound (`docs/audio.md`):
- a `step` when `HeadMotion` strikes a foot (`stepped`), so sound and head jolt coincide;
- a `takeoff` and a `land` (with impact speed);
- a `stop` when the body comes to rest from above 0.9 m/s.

No foot event follows another within 0.15 s.
