# Vehicles: the car and the craft

Code: `src/vehicles/`; the driving switch is `src/app/driving.ts`. Intent: `docs/city_plan.md` §6–7. Sound: `docs/audio.md`, "The car", "The craft".

## The models

Both are ported from `refs/car.html` and `refs/spacecraft.html`. Every number is the refs' own; the modelling kit (`kit/loft.ts`) is their loft, rail and panel.

- **Merged by material.** Each model is one geometry with a group per material slot (`PartSink`). The refs' hundreds of meshes would be hundreds of draws.
- **Levels of detail** rebuild the same model with its authored tessellation counts scaled (`withDetail`):
  - the car: 1 and 0.3, switching at 40 m (510k and 105k triangles);
  - the craft: 1, 0.3 and 0.1, at 0, 160 and 700 m (1.03M, 131k and 84k).
- **What the audit changed.** It found geometry defects the refs carried, all fixed without changing a shape:
  - a fan cap across the car's concave aft section folded over itself (coplanar overlap): non-star-shaped caps are ear-clipped;
  - profiles shrinking to a point left zero-area triangles with no normals: coincident vertices are welded;
  - the craft's tubes were open-ended: they are capped;
  - the halo band's two coincident end caps sat back to back: a loop that closes on itself is welded, not capped;
  - one gilded edge ran coincident with the lip above it: its root drops 1.5 cm.

  `tests/vehicles.test.ts` keeps both models at zero coplanar overlap, zero defects and consistent winding.
- **Studio tricks dropped.** The refs tint the porcelain and the glazing by the normal, a painted light gradient. Here they take the tint's mean; the light does the rest.

### The car's one change: the wheels deploy

As authored, the front wheels stand 2 cm off the shoulders and strike them past ~2.5° of lock. By the user's decisions:

- **Parked,** the wheels stand drawn in at the ref's own track (3 cm out of it, `DRAWN_IN_CLEAR`: the ref's 2 cm is too fine to keep clear), the suspension's beams hidden in the body. The body is exactly as authored, its front fairings' tips meeting the wheels.
- **Driving,** they deploy 0.35 m per side (`TRACK_WIDEN`). Getting in, they extend over 1.3 s (eased) and the car answers its controls only once they are out. Getting out, they draw in again. A small actuator runs while they travel, and they latch at each stop (`docs/audio.md`).
- **The ties telescope.** The suspension carriers and rear axle stubs are built at full deployment and slide along the axle into the body as the wheels come in. The carriers' last stretch runs along the axle through the rotor's aperture onto the hub, so they meet a steered hub on its steering axis.
- **Drawn in, the suspension rests on its stops.** The body's sway scales with deployment, so the drawn-in wheels never meet the shoulders.
- **The lock** is 28° at the front, 11° at the rear, the most that clears deployed at the suspension's extremes with 1 cm to spare (`tests/vehicles.test.ts`, against the wheel's real solids, drawn in and deployed).

### Wheels: rotor round a hub

Carriers cannot bolt onto a spinning part, so each wheel is split:

- the annular tread ring with its sidewalls, rims and emitters spins;
- the hub motor (housing, faces, impeller blades) steers with the knuckle but does not spin.

### Swing arms

The carriers and stubs are not part of the body's mesh. Each is its own swing arm, riding on the body and turned about its root (the point farthest from its hub) each frame, so its end stays on the hub while the body pitches, rolls and heaves and the wheels stay on the ground (`armMatrix`). It telescopes by the change in reach, so the end lands on the hub exactly (`tests/vehicles.test.ts`). *Rejected:* the arms rigid with the body. The user saw their ends drift off the hub centres as the body rode its springs.

## Driving

- **The car** stands on the Gate Court beside the estate's gateway, facing the field (`CAR_PARKING`). It cannot fit the carriage house's doors, so it is parked outside.
- **Where it can go:** anywhere at pad level under the Dome. It is kept out of the estate by its own wall (`carWalls`: the terrace outline) and out of the West Gate's chamber by a line across the passage. The West Gate's airlock never sees a driver.
- **Getting in and out.** E within 1.6 m gets in. E below 1.2 m/s gets out, on the first clear side (left, right, behind, ahead). Either way the view moves on an eased, raised arc over 1.1 s.
- **Controls.** W accelerates; S brakes, and held at rest for 0.25 s selects reverse. A and D steer, Space is the handbrake, and the mouse orbits the camera. The pedals ramp (0.22 s press, 0.12 s release).
- **Feel** (`car/dynamics.ts`): a planar rigid body on two magic-formula axles, integrated at a fixed 240 Hz, tuned as a light, agile electric GT. `tests/carDynamics.test.ts` holds the numbers:
  - 1.35 t (the first tune, at 2.35 t, felt too heavy);
  - 0–100 km/h in 3.2 s, governed at 139 km/h;
  - ~33 m to stop from 100;
  - ~1.17 g steady cornering on performance tyres (μ 1.2): the first tune's μ 1.0 turned too wide at speed;
  - a turning radius of ~6 m at walking pace: the rears counter-steer up to 40 % of the front's angle, fading out between 8 and 24 m/s;
  - steering lock halves by 18 m/s; the steering slews at 3.6 rad/s;
  - gentle regeneration on lift-off.
- **Assistance a GT has, not arcade grip.** Steering is speed-sensitive and held within the front tyres' useful slip, so keyboard steering cannot overdrive the front. Stability control trims yaw and drive past ~7° of body slip, off while the handbrake is held. A locked rear slides on kinetic friction along its slip velocity, so the handbrake swings the tail.
- **Walls.** The footprint is an oriented box against the plan wall segments, resolved per physics step with an impulse (restitution 0.18, friction 0.35). The box's width follows the wheels' deployment. The parked car is a wall to the walker (`CollisionWorld.setDynamic`).
- **The body** is a sprung mass (1.5 Hz, ζ 0.5) about an axis 0.35 m up: it pitches under braking and power and rolls in corners, the arms following it. The lamps wake when the car is driven, and the tail lamps brighten under braking.

### Camera

`car/chaseCamera.ts`:

- Its heading is a critically damped spring on the car's (4.2 rad/s), so it swings a little wide into turns.
- It is drawn back with speed (+2.4 m at the top) and by acceleration.
- Mouse movement orbits it. After 0.25 s of stillness it eases back behind the car (τ 0.45 s), whatever the car is doing.
- Walls between the car and the camera pull it in fast and let it out slowly.

## The craft

`craft/flight.ts`, pure logic driving the East Lock's airlock (`city/eastLock/airlock.ts`):

- **Scale ×4** (~31 m long, halo ~32 m across), applied to the object.
- **A visit:**
  1. in from 7 km out on the deck, level at the lock's mid-height;
  2. a hold outside the outer hood;
  3. into the chamber; the lock cycles: shut, fill, open;
  4. over the Cordon's craft-gate bridge and along the corridor, its ventral foil ~10 m over the corridor's 20 m ceiling;
  5. down over the Halo to the pad;
  6. a 6 s hover with a 180° turn;
  7. back the same way, cycling out;
  8. away across the deck, then an 8 s gap.

  About 30 s of each visit is under the Dome (the user's figure). The whole cycle is ~2 min, because the lock cycles fast but really (bolts 0.5 s, travel 3.2 s, pressure 2.5 s).
- **Levitation, not landing.** The model has no flat underside, so it hovers with its ventral foil's tip 1.5 m over the pad. If the car or a walker is under it, it rises to 3.2 m over them.
- **Motion** is jerk-limited along smooth paths (quintic legs; the far legs launch and arrive with no jerk).
- **The burn** follows thrust: acceleration along the nose plus holding speed against drag. Slowing is the levitation's work, so the engines idle then.
- **Safety, tested** (`tests/craftFlight.test.ts`):
  - the lock never stands open both ways and opens a gate only onto equal pressure;
  - the craft never meets a gate that is not fully open;
  - the whole visit clears the field and the lock, voxelised at 1 m, the moving leaves at their actual openness included.

  The test is known to bite: a cruise height 19 m lower hits the Halo and the square main's viaduct.
- **The engine burn** (`craft/plume.ts`): one analytic jet per nozzle, a hot gas that emits and absorbs.
  - Radiance B(T)(1 − e^−τ), with the optical depth of a widening Gaussian column integrated in closed form along the view ray: no marching.
  - Planck on the star's radiance scale; 5200 K at the exit at full burn, below the photosphere's temperature; cooling downstream.
  - Shock diamonds as small temperature rises.
  - Turbulence advected at 90 m/s.
  - *Rejected:* an optically thin emission (linear in τ). It read as a faint haze, not a burn.

## Light

- **Image-based light.** The vehicles reflect the probe over the pad (`FieldProbes.central`), its parallax proxy widened to the compound. Outside the glass the craft takes the open sky.
- **The car takes the star-shade** where it stands.
- **Shade on the pad** (`vehicles/shade.ts`): each vehicle hides
  - the star's 45° cap (the separable cap cover, 82 % of the light), and
  - the rest of the sky (a parallel rectangle's exact view factor).

  Under the car this is nearly all the light, as a noon shadow under a car is. Under the hovering craft it is a soft pool.
  - It scales the pad's AO term and its sealer's clear coat. AO does not reach the clear coat, and the coat's reflection of the zenith is what a body overhead hides.
  - *Rejected:* the star's share alone (a pale smudge under the car), and the shade on the pad's environment node. The pad is drawn into the interior capture, so that would sample the cube it writes.

## Review

- `?craft=<leg>[:s]` runs a visit forward to a leg, s seconds into it.
- `?drive` starts in the car.
- Viewpoints `car` and `pad`.
- With `?time=` the craft holds still. Headless frames run at real time, so without it a review shot lands at an arbitrary moment of the flight.
