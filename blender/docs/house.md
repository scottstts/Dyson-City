# The house (step 1 of the estate)

Built procedurally in Blender from `blender/build/*`; `blender/house.blend` is the output, never edited by hand.
Rebuild everything with `run.build_all()` (see *Workflow*). Everything lives under the `House` collection tree.

## Frame and scale

- Metres, true human scale. Blender Z-up; +X right, +Y back, the front (porch, field side) faces −Y.
- Origin: grade level, centre of the front door. Finished floors: ground 1.05, first 5.25, top 9.15;
  porch deck 0.90; ceilings 4.85 / 8.75 / 12.15. Exterior walls 0.30, partitions 0.15.
- `build/plan.py` is the single source of truth (masses, rooms, openings, stairs). Builders never
  hard-code positions that the plan owns.

## Plan, read from the exterior reference

- Main block with a mansard (break at 13.5, widow's-walk deck at 15.0 with cresting); front cross gable
  with a canted two-storey bay; corner turret on the right (round to the top storey, bell-cast cone);
  wraparound porch: pedimented portico on the door axis, quarter-round around the turret, straight east run.
  Left wing (library / dressing + bath) with its own porch; right wing (morning room / chart room).
- Ground: vestibule → hall (main stair rising toward the front), parlour (front bay), dining (back bay),
  library, music room (turret), morning room, kitchen + pantry, rear hall, WC.
  First: landing, master + dressing + master bath, bedroom, study (turret), chart room, guest, bath.
  Top: top hall, gable room, turret room (open to the cone), maid's room, box room.
- The cross-gable ridge (14.45) dies into the mansard's side slope; dormers sit flush with the wall plane.

## Engine contract

- Doors: every leaf `Door_<opening>[_L|_R]` is the child of a static empty `DoorRig_<…>` placed at the
  leaf's shut pose. The engine drives only the leaf's local transform; props on the leaf:
  - `kind` `hinge`: origin on the hinge pin (5 mm proud of the face it opens towards, so the leaf rolls
    clear of the jamb); open = rotation about local Z (glTF +Y) by an angle in `[0, open_max]` (signed;
    `swing` is its sign). `open_angle` is the rest pose. `open_max` comes from sweeping the leaf against
    walls, furniture, fireplaces, windows and frames (`build/doorswing.py`; `stopped_by` names the obstacle).
  - `kind` `slide` (pocket doors): origin on the lead edge; open = translation along local X by
    `travel` (signed metres) into a real cavity in the wall, through a slot in the jamb. `open_offset` is
    the rest pose.
  - `handle`: leaf-local position of the knob or cup pull (for the interaction prompt).
  Interior leaves hang flush with the face they open towards; exterior leaves clear the sill by 30 mm and
  open inwards. Every leaf is checked shut and through its travel by the audit (DOORS section).
- Lights: `Lamp_*` empties in `House/Engine/Lamps` (`kind`, `lumens`). Sounds: `Sound_*` empties in
  `House/Engine/Sounds` (`clip`, `loop`, `gain`) — positions only; the game's audio rules apply.
- Collision: `House/Engine/Collision`, objects `COL_<source>` with prop `collision`:
  `trimesh` (the source's own triangles: structure, decks, steps, rails, roofs...; a mesh over 6,000
  faces gets a remeshed, decimated copy), `box` (furniture and curtains, window openings, door
  leaves — parented to the leaf), `ramp` (wedge under each stair's nosing line up to the arriving
  floor). Hidden in the viewport, kept in the view layer so exports see them.
  - **Every house mesh collides unless geometry proves it need not** (`build/collision.py`); the
    reason is its prop `collision_none` (exported as extras): `low` (≤ 5 cm over the floor: rugs),
    `skin` (every vertex within 6 cm of a collider: siding, skirtings, pictures), `opening` (inside
    a window's box), `hung` (≥ 2.6 m over the first surface under it, nothing wide enough to stand
    on: brackets, cornices), `pocket` (a pocket door's leaf). Classified lowest first, against the
    colliders built so far; whatever stands on furniture collides too (the walker can jump onto a
    table). The audit's COLLISION section lists anything unclassified.
- Furniture is instanced from prototypes in `House/Furniture/_Prototypes` (hidden): one mesh per kit,
  shared by every instance. Export should keep instancing (glTF mesh reuse).
- `_Review` (sun, sky, lamp point lights) exists only after review renders and is not part of the house;
  `House/Engine/BakeLights` holds the bake's lamp lights (hidden; not exported).

## Light: the game's light, baked (`build/bake.py`, `tools/house-env.mjs`)

- `node tools/house-env.mjs --dist <vite build>` boots the game headless on its HDR view, stands a 90°
  camera 6 m above the ground at `HOUSE_SITE`, brackets five exposures per cube face and writes
  `bake/house_env.hdr` (+ `.json`): linear game radiance, resampled into the house frame (front toward
  the datum). The house is hidden for the capture and the eye held outdoors: the capture is the
  approved estate and everything round it.
- Lamps are lit at a warm, generous domestic level (`rooms.py LUMENS`: about twice a real lamp, 2,400 lm
  pendants in the windowless hall, landing and top hall). The shades' and bowls' glow is computed from
  the same flux (`bake.lamp_glow`: area-mean τ·I·cosθ/(πd²) over each glowing material, into
  `bake.json` and the pack index's `lamps`).
- That map is the .blend's world (`GameLight`): Cycles in the viewport shows the house in the game's light.
- Everything baked is in the game's one radiance scale. Lightmaps are a white Lambertian surface's
  outgoing radiance (the engine shades `albedo × lightmap`); the capture's white sunlit radiance (~2.0)
  stands for 31,800 cd/m², and lamps are lit at their real flux on that scale (so they barely register
  against daylight, as indoors at noon). Fires are out.
- Lightmapped (UV map `Lightmap`, one atlas per floor `bake/LM_G|L1|L2.exr`, half float): the large
  planar architecture only, walls, floors, ceilings and chimney breasts. Hidden faces (exterior backs
  of the walls, wall cores) are left out of the atlas. Objects carry `lightmap` / `lightmap_uv` props.
  - **Trims, stairs, mantels and interior door frames are probe-lit**, like the furniture. *Rejected:*
    lightmapping them. Smart-projected, each moulding face was a sub-texel sliver (dark combs);
    charted as strips, they were still a few texels across, scattered among unrelated charts, and the
    denoiser and the margin fill mixed their noise with their neighbours (camouflage blotches along
    every cornice, skirting and wainscot panel). Their light varies over metres: the probes carry it.
  - **Portals** in every exterior opening (the rooms' daylight comes through them).
  - **Daylight and lamps baked apart** and summed (3,072 and 2,048 samples): together, the sky took
    nearly every light sample and the lamps' light came out black or speckled.
  - **Every sample counts:** adaptive sampling off (it stopped bakes at its threshold whatever the
    sample count) and the light sampling threshold 0 (at 0.01 it culled the lamps, whose light on
    this scale is ~0.001–0.01).
  - Baked at 2048², the export's size, so the QA measures what ships.
  - Indirect samples clamped at 1 (rooms are ~0.01 on this scale; sunlit floors and the sky through a
    window 0.5–2): no firefly from a bounce that found the star.
  - The bake lights (`House/Engine/BakeLights`) must not be excluded from the view layer: a bake leaves
    the collection excluded, and lamps and portals in it do not render. A pass that comes back black
    fails the bake.
  - **Validity:** faces pressed flat on another solid are left out of the atlas; a 5 cm AO bake marks
    texels enclosed by something (AO under 0.02: a wall behind a skirting, a floor under a rug); they and
    the margins are filled from valid texels (push-pull) before OIDN, which is guided by baked normals.
    *Rejected:* 768 samples, no portals, OIDN unguided over Cycles' extended margins: crackled blotches.
  - **QA:** `bake/qa.json`: the bake is two half-sample bakes with independent seeds; the final is the
    denoised mean of both, and each half denoised alone bounds its residual noise (8 × 8 texel blocks).
- Everything else (furniture, doors, windows, small parts) is lit from the probe grid: `bake/probes.bin`,
  SH L2 radiance at 1 m spacing and three heights per floor inside rooms (256 samples); positions in `bake/bake.json`.
- Reflection captures: `bake/refl_<room>.exr` from each room's middle at 1.6 m, with the room box for
  parallax correction (`bake.json`).
- Window glass is a thin pane for light: shadow and diffuse rays pass through it as a transparent filter
  of its tint (camera and glossy rays see real glass). Cycles only carries light through refracting glass
  as caustics, so without this every window-lit room renders black. The glTF export maps glass to the
  transmission extension instead of this node graph.
- 146 of the 2,196 probes sit inside furniture; `bake.json` marks them `valid: false` (skip them and
  renormalise the interpolation weights).
- Sheers are drawn back in the day rooms and the rooms that look out over the field (parlour, dining,
  library, music, morning, study, chart room, landing, gable room, turret room); bedrooms, the dressing
  room, attic service rooms and the kitchen valance keep them drawn. The bake follows the curtains.

## Materials

Procedural PBR node graphs (`build/mat.py`) on a single `UVMap` in metres; textures in `blender/textures`
are generated by `build/textures.py` (wallpapers, rugs, tiles, parquet, stained glass) so the look can be
baked later. Walls and chimney breasts are re-projected (metre box projection) in `finalize`, because
booleans hand the cutters' UVs to the faces they create and wallpaper scale would vary wall to wall.
Structure walls carry area-weighted custom normals (long boolean slivers otherwise shade unevenly).

## Export: `assets/house.pack` (`build/export.py`, `run.export_all()`)

One bundle, nothing compressed: every entry is uploaded or parsed straight from its byte range (the
host serves Range requests), so there is no decode step beyond the browser's own image decoding.

- **Layout:** `DCPK`, u32 version (1), u32 index length, the index (UTF-8 JSON), then each entry at the
  256-byte-aligned absolute `offset` the index gives. `tests/housePack.test.ts` checks the structure.
- **Geometry:** four glTF parts, `house_exterior`, `house_G`, `house_L1`, `house_L2` (`.gltf` JSON +
  `.bin`), glTF axes (+Y up; the house front faces +Z). Meshes are shared between instances. Textures
  are separate `image` entries named by the uri the parts use, stored once and shared by all parts: a
  loader maps each uri to its slice (e.g. a LoadingManager URL modifier returning a blob URL).
- **Materials:** the node graphs are baked into tileable texture sets (`blender/export/tex/`): base colour
  (sRGB JPEG), packed ORM (G roughness, B metal), normal (tangent, OpenGL), transmission/alpha where they
  vary. A metric material bakes one tile a whole even number of its pattern's periods across (boards,
  bricks, tiles, wallpaper repeats), made seamless by cross-fading with its half-period-shifted copy; the
  tile size is the material's KHR_texture_transform scale on UV0 (metres). Rugs, pictures, stained glass
  and the dial bake their 0..1 square. A channel without variation is a constant factor. Glass is
  KHR_materials_transmission (+ IOR); the lace sheer is alpha 0.45; leaves, petals and lace are
  double-sided, everything else single-sided.
- **Light:** `LM_G|L1|L2` and `refl_<room>` are `rgb9e5ufloat` textures (WebGPU, filterable), rows top
  first, lightmaps on UV1 (TEXCOORD_1) at 2048² (~5 cm texels; the light indoors is
  soft); `probes` is float32 SH L2 radiance with point positions, levels, rooms and validity in the index.
  Probe positions, reflection positions and room boxes are in Blender's house frame (glTF = (x, z, −y)).
- **Placement:** the index records the site and facing: the house origin goes at `HOUSE_SITE` on the
  terrace, rotated about +Y so its +Z points along `face` (toward the datum).
- `blender/export/` holds the intermediates and is ignored by git.

## Integration: using the bundle in the game

How the engine side (city_plan.md §9 step 2) consumes `assets/house.pack`: the contract the export was
made to. The engine side is built (`docs/house.md`); where it departs from this contract it says so
there (its own glTF reader in a worker rather than GLTFLoader; steps without a COL_ twin, like the west
porch's, walk as their visible mesh).

**1. Read the index.**
- Fetch bytes 0–11: the magic `DCPK`, the version (1) and the index length L, as u32 little-endian.
- Fetch bytes 12 to 12 + L and parse the JSON.
- `entries[]` gives each entry's `name`, `type`, absolute `offset` and `length`, plus per-type metadata.
- Fetch any entry with an HTTP Range request (`offset` … `offset + length − 1`).
- Entries are 256-byte aligned, so a slice can back a typed array or a GPU upload with no copy.

**2. Load a part** (`house_exterior`, `house_G`, `house_L1`, `house_L2`). Each part is a `.gltf` entry
(type `gltf`) plus the `.bin` entry its `buffers[].uri` names, and the image entries its
`images[].uri` name.
- With three's `GLTFLoader`: fetch the `.gltf` JSON, then give the loader a `LoadingManager` whose
  `setURLModifier` maps each uri to a blob or object URL of that entry's slice.
- Images are shared by all four parts: cache them by uri so a texture loads once.
- The loader must support `KHR_texture_transform`, `KHR_materials_transmission` and `KHR_materials_ior`
  (three's GLTFLoader does).
- Stream by portal: the exterior always, then the floor the player is on and the floors next to it.

**3. Place the house.**
- Put one root group at `HOUSE_SITE` (game x = −372, z = −112). Its y is the terrace top: the house
  origin is grade, under the front door's centre. The game ground at the site is 1.2 m today; the
  terrace comes in step 2.
- Rotate the root about +Y by `atan2(face.x, face.z)` (`placement.face` in the index; ≈ 73.3°), so the
  house front (glTF +Z) faces the datum.
- All four parts share this one root transform.

**4. Separate what is not drawn.**
- Nodes whose extras carry `collision` are physics proxies; hide them from rendering:
  - `trimesh` shares its mesh with the visible walls, floors and decks;
  - `box` covers furniture, window openings and door leaves;
  - `ramp` is a wedge under each stair's nosing line, so stairs walk as slopes.
- Door-leaf boxes are children of their leaf, so they move with it.
- Use the proxies for multi-storey walking: per-floor floors from the trimeshes, the stairs from the
  ramps.

**5. Doors.**
- Every leaf node (`Door_*`) is the child of a static `DoorRig_*` node at its shut pose. Drive only
  the leaf's local transform; never move the rig.
- `kind: "hinge"`: set the leaf's local rotation about +Y to an angle between 0 (shut) and
  `open_max` (radians, signed; `swing` is its sign). `open_angle` is the pose it was exported in.
  `open_max` is already clear of walls, furniture and frames; `stopped_by` names what the leaf would
  hit beyond it.
- `kind: "slide"` (pocket doors): set the leaf's local translation along +X to an offset between 0
  (shut) and `travel` (metres, signed). `open_offset` is the exported pose.
- `handle` is the knob or pull in leaf-local metres: put the interaction prompt there.
- Moving a door does not change the baked light (§6).
- Leaves are probe-lit (§6), so an open leaf lights correctly wherever it ends up.

**6. Interior light.** Everything is in the game's one radiance scale (docs/world.md), so no
conversion factors are needed.
- **Lightmaps:**
  - Nodes with extras `lightmap: "LM_G" | "LM_L1" | "LM_L2"` (and `lightmap_uv: 1`) take that texture
    on TEXCOORD_1.
  - Each texel is the outgoing radiance of a white Lambertian surface, so the surface's diffuse
    radiance is `albedo × lightmap`, with no direct star light added indoors.
  - In three's `lightMap` convention (the map read as irradiance), set `lightMapIntensity = π`.
  - Upload the entry as an `rgb9e5ufloat` texture (`width` × `height`, rows top first, glTF V
    convention; no flip). In three: a `DataTexture` with `RGBFormat` + `UnsignedInt5999Type`, which
    the WebGPU backend maps to rgb9e5ufloat (check against the pinned three version). Linear
    filtering and mipmaps are fine: islands are padded.
- **Probes** (entry `probes`, type `sh9`), for everything without a lightmap: furniture, doors,
  windows, curtains, small parts.
  - `count` probes × 9 SH L2 coefficients × RGB, float32: radiance projected on the real SH basis in
    the order Y00, Y1−1 (y), Y10 (z), Y11 (x), Y2−2, Y2−1, Y20, Y21, Y22. That is three's
    `SphericalHarmonics3` order, so `getIrradianceAt` applies the cosine convolution.
  - The coefficients and `points` (x, y, z, level, valid) are in **Blender's house frame** (Z up).
    Convert a glTF-frame normal n before evaluating: n_house = (n.x, −n.z, n.y).
  - The points lie on a lattice:
    - x = −12.5 … 9.5 and y = −2.5 … 13.5, 1 m apart;
    - z = floor + 0.5, 1.4 and 2.4 (floors 1.05, 5.25, 9.15; heights above a room's ceiling are
      omitted);
    - only points inside rooms exist.
  - Build a 3D grid from them and interpolate trilinearly. Weight only probes with `valid = 1` that
    belong to the same level (and preferably the same room), then renormalise the weights. The 146
    invalid probes sit inside furniture and read black.
- **Reflections** (entries `refl_<room>`, rgb9e5, 512 × 256):
  - Each is an equirectangular radiance capture from the room's middle at 1.6 m, mapped as Cycles
    maps it: u = −atan2(y, x)/2π + 0.5, v = elevation/π + 0.5, with +X (house frame) at the
    centre column.
  - `position` and `box` (x0, y0, z0, x1, y1, z1) are in the house frame.
  - Prefilter each into a roughness mip chain at load. Use the current room's capture with a
    box-projected (parallax-corrected) lookup.
- **Exterior:** the exterior part has no bake. The star and the game's real-time lighting light it
  like everything else outdoors.
- **Exposure:** the day rooms sit ~7–8 stops below a sunlit white wall. The eye's partial
  adaptation decides how they read (`docs/render-pipeline.md`); the bake must not be scaled to
  compensate.

**7. Materials.**
- Use the glTF materials as exported. Texture tiles repeat in metres via `KHR_texture_transform`
  on UV0.
- Window glass is `KHR_materials_transmission`; the Dome's analytic glass pass does not cover it,
  so it needs a thin-pane treatment in the engine: no refraction offset, tinted transmission of what
  is behind.
- The lace sheers are alpha-blended at 0.45.
- `doubleSided` is set only on leaves, petals and lace.

**8. Lamps and sounds.**
- `Lamp_*` empties carry `kind` (pendant, table_lamp, lantern, fire) and `lumens`. The bake includes
  the lamps' light but not the fires' (out at noon). The index's `lamps` gives each glowing material's
  radiance (by material-name prefix), from the same flux.
- `Sound_*` empties carry `clip`, `loop` and `gain`; they are positioned emitters under the game's
  audio rules (`docs/audio.md`).

**9. Re-generating.** After the house or its surroundings change:
1. Run `node tools/house-env.mjs --dist <vite build>` (the light at the site; needed once the
   estate exists).
2. Run `run.build_all()`, then `run.bake_all()`, then `run.export_all()`.
3. Upload the new `assets/house.pack` and run `tests/housePack.test.ts`.

## Audit (the gate — run after every build)

`build/audit.py` writes `blender/audit/report.txt`; a build is only done when every section is empty:

- Coplanar same-facing overlaps across and within objects (z-fight). Faces pressed flat against an
  opposite-facing surface (trim backs on a wall) are hidden and ignored.
- Clearance corridors (0.6 m) in front of and behind every door, the front steps and stairs.
- Mesh health: loose verts, zero-area faces, inside-out closed parts.
- Interpenetration between objects (> 4 mm), with an explicit list of seated joints
  (`INTENDED`: finials in decks, balusters in rails, rails in walls...).
- Part interpenetration inside one kit, tested on the raw pieces before the union merges them; thin
  shells (plates, quilts) use a thickness-relative depth. Allowed material joints are listed in
  `KIT_JOINTS` (hardware let into timber, upholstery over frames, contents inside glass).
- Materials: links from disabled sockets (a Mix node's float output feeding a colour renders white),
  placeholder materials, meshes without UVs, room-facing floors/ceilings with a reveal finish.

Workbench renders (`snap.render`) show form; EEVEE renders (`snap.render_eevee`) are needed to judge
materials — several material bugs were invisible in solid view.

## Placement rules learned the hard way

- Columns never stand in a door or step opening; porch brackets take the local edge direction, never
  across corners, columns or gaps.
- Curtains: the pole and drape stack need ~0.25 m clear beside the glass (walls *and* furniture, found by
  ray casts); otherwise the window gets a sheer on a short pole. Holdbacks sit at 1.15 m, above dado rails,
  with the arm round the outside of the gathered drape. Lace over the kitchen sink is a valance.
- Rugs stay out of door swings; casework doesn't stand on rug edges.
- Quilts tuck in at the foot (a hanging fold would pass through the footboard); scatter cushions lean on
  the back at its rake.
- Under the gable's side slopes only low furniture fits; lamps go on the ridge side.

## Workflow

```
blender/tools/bl.py -c "import sys; sys.path.insert(0,'<repo>/blender'); import run; run.build_all()"
blender/tools/bl.py -b rooms.build            # one builder (module.fn:args)
```

`bl.py` talks to the blender-mcp add-on socket (127.0.0.1:9876). The bake (hours) runs headless instead,
where a long call cannot stall or take down the UI session:

```
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup blender/house.blend --python <script calling run.bake_all()>
```

The build code works in both (`core.in_scene` switches scenes with or without a window).
`--factory-startup` keeps user add-ons out of it: one (a texture library's background thread)
crashed a headless start. `run.build_all()` wipes the scene,
runs every builder in order, rebuilds all material graphs, audits and saves. `run.bake_all()` then bakes
the light (about 3–4 hours, headless: see below), and `run.export_all()` writes the bundle.
