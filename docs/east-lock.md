# The East Lock

Code: `src/city/eastLock/`. `spec.ts` holds every dimension. Intent is `docs/city_plan.md` §6; the West Gate it is modelled on is `docs/gate.md`.

## The airlock

The craft drives it (`airlock.ts`, `docs/vehicles.md`). Nothing responds to the walker; there are no lamps or vents yet.

- **Driven by request.** The craft asks for a side, and the airlock sequences it:
  - `outer`: shut the inner gate, vent the chamber to 0.55 bar, open the outer;
  - `inner`: shut the outer, fill to 1 bar, open the inner;
  - `closed`: shut both.
- **The West Gate's actuators at craft speed:** bolts 0.5 s, leaf travel 3.2 s, pressure 2.5 s.
- **Never open both ways,** and a gate opens only onto equal pressure. The craft asks a gate to shut only once it is clear of the sweep (`tests/craftFlight.test.ts`).
- **The craft sits inside the leaves' sweep.** Each leaf turns about a trunnion above its own half of the chamber, so a craft waiting there is inside the circle the leaf sweeps; its open pose clears the craft by 8 m.
- **Sound:** the West Gate's hydraulics, roll, stops and shuts from its own hoists and leaves, +4 dB (`docs/audio.md`).
- **Review:** `?lock=closed|outer|inner|open` holds a pose and ignores the craft.
- **Walls:** walkers never pass it; its piers and both lips are walls.

## Construction

- **The West Gate at craft size, mirrored.** Modelled in the West Gate's frame (city toward +x) and mirrored onto the east cardinal (`toWorld`, `mirrorMesh`; faces re-wound). A rotation by +a in that frame is −a in the world.
- **Size:** a 52 m clear passage (craft up to ~50 m), 30 m clear height, leaves of radius 34 m, a 60 m chamber, 10 m piers, roof at 59.5 m.
  - It fits inside the East Collar (whose inner face is at |z| 45) with 9 m to spare.
  - The outer trunnions stand ~70 m out on the deck under a hood.
- **The Spinward rails land on its roof** (`LOCK.railY`, inside the roof slab) instead of on feet at the sill (`dome/frame.ts`).
- **The Dome opens round it:**
  - the glass is masked over |z| < 36.6 m, y < 60.1 m on the east side (`dome/glass.ts`);
  - the bronze sill runs in two lengths, north and south (`dome/glazing.ts`);
  - a bronze trim frames the glass, in three runs across the top between the rails.
- **Leaves:**
  - three girders, T-ribs in runs between them, and three struts and two braces per side converging into cast hubs;
  - lip and side seals; top seals under the heads.
- **Hoist geometry:**
  - fixed pivots 0.5 m outside the skin's radius at 100°, so the barrels clear the hood;
  - lugs at 15 m on the upper struts, so the open stroke keeps the barrel clear of the lug.

## Tests

`tests/eastLock.test.ts`:

- topology of every part;
- hoist travel over the whole stroke;
- the assembly closed, part-open and open;
- its fit with the Dome's frame and sill.
