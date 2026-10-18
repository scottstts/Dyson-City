"""Interior light, baked in Cycles under the game's own light (city_plan.md §9 step 1).

The world is `bake/house_env.hdr`, captured from the game at the house site by `tools/house-env.mjs`
(linear game radiance, already in the house frame). Everything baked here is in that one radiance
scale, so the engine uses it with no conversion:

- **Lightmaps** (`bake/LM_<floor>.exr`, half float): the static interior architecture of each floor
  (walls, floors, ceilings, trims, stairs, chimney breasts and mantels, interior door frames) on a second
  UV map `Lightmap`. Each texel is the outgoing radiance of a white Lambertian surface there (Cycles
  DIFFUSE bake, direct + indirect, no colour): the engine shades `albedo × lightmap`.
- **Irradiance probes** (`bake/probes.bin` + `probes.json`): a grid through every room for whatever is
  not lightmapped (furniture, doors, windows, small parts): radiance projected onto SH L2 (9 × RGB).
- **Reflection captures** (`bake/refl_<room>.exr`): an equirect of each room from its middle, with
  the room's box for parallax correction (in `probes.json`).

Lamps are lit at their flux (lumens, `Lamp_*` empties) in this scale: the capture's white sunlit
radiance stands for ~31,800 cd/m² (a white surface under a 100,000 lux noon). The engine's glow of
each lamp's shade and glass comes from the same flux (`lamp_glow`), so what glows is what lit the
rooms. Fires are out (it is noon). Window glass is made a plain transparent filter for the bake (no
refraction, so no caustic noise); its materials are rebuilt afterwards.

Clean lightmaps (the first bake showed crackled blotches and dark combs):
- **Portals** in every exterior opening: the rooms are lit through small windows, and without them
  most paths missed the sky (noise the denoiser turned into blotches).
- **Daylight and lamps baked apart** and summed (`lighting`): baked together, the sky took nearly every
  light sample and the lamps' light stayed black or speckled.
- **Only large planar architecture is lightmapped** (walls, floors, ceilings, chimney breasts); trims,
  stairs, mantels and door frames are probe-lit like the furniture (`LM_PREFIX`). Their charts were
  a few texels across: one island per moulding face lit by a sub-texel sliver (dark combs), then,
  as strips, still too small to tell noise from light (camouflage blotches). Every chart is at
  least MIN_CHART wide.
- **Validity.** Faces pressed flat on another solid (a moulding's back on the wall, its top on the
  ceiling) are left out of the atlas (`buried`): their bake rays start a hair past the contact plane,
  inside the wall, and come back black. Texels partly covered (wall behind a skirting, floor under a
  rug) are marked by a 5 cm AO bake; they and the margins are filled from valid texels (push-pull)
  before the denoiser, which is guided by normals.
- **A QA gate** (`qa`): the bake is two half-sample bakes with independent seeds; the final is the
  denoised mean of both. Each half denoised alone differs from the other by its residual noise (over
  blotch-sized blocks): an upper bound on the final's, which has twice the samples.
"""
import json
import math
import os
import struct

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import core, geo
from . import plan as P

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bake")
ENV = os.path.join(BASE, "house_env.hdr")

# static interior architecture that carries a lightmap (everything else is probe-lit)
# Lightmapped: the large planar architecture (walls, floors, ceilings, chimney breasts). Everything
# else (trims, stairs, mantels, door frames) is lit from the probe grid like the furniture.
# *Rejected:* lightmapping the trims: hundreds of charts a few texels across, scattered among unrelated
# charts. Per-texel noise inside a chart that small cannot be told from its light, and the denoiser,
# the margin fill and any smoothing mix it with its atlas neighbours: camouflage blotches along every
# cornice, skirting and wainscot panel. Their light varies over metres; the probes carry that.
LM_PREFIX = ("Structure_",)
LM_FIRE = ("_Breast",)
# The stairs' plaster bodies (soffits and spandrels): large planes whose light depends on the stair
# over them. Probe-lit per vertex they took the open landing's light into the cul-de-sac under the
# flight and glowed.
LM_STAIR = ("MainStair_Body", "TopStair_Body")
# Chimney stacks rising through a room (Stack_*, build/details.py) are lightmapped like the breasts.
LM_SIZE = {0: 2048, 1: 2048, 2: 2048}   # the export's own size: the QA measures what ships
LM_MARGIN = 0.0025          # pack margin, UV units (5 texels)
# Daylight (the capture through the portals) and the lamps are baked apart and summed: together, the
# light tree spends almost every shadow ray on the sky (one huge light) and the lamps (~0.1 W on this
# scale) are almost never sampled, so lamp-lit texels came out black or speckled.
BAKE_SAMPLES = {"day": 3072, "lamps": 2048}
MIN_CHART = 0.30            # m of atlas: ~5 texels across (a narrow jamb or breast face)
VALID_AO = 0.02             # short-range AO below which a texel is under something (enclosed: ~0). At
                            # 0.15 the open hollows of a cornice and a wainscot panel's recesses (0.3–0.6
                            # under a 5 cm reach, but lower at their roots) were taken for hidden, refilled
                            # from the pyramid's coarse levels (mixing other charts): camouflage blotches
VALID_DISTANCE = 0.05       # m: deeper than a skirting or a rug's gap
BURIED = 0.75               # share of a face's sample points inside a solid for it to be left out
LUMENS_FROM_WATTS = {"pendant": 15.0, "table_lamp": 20.0, "lamp": 13.0, "lantern": 11.0}   # lm/W, for empties without `lumens`
LIGHT_COLOUR = (1.0, 0.78, 0.52)    # incandescent, ~2,700 K
# Glowing lamp materials: share of the light passing through (translucent mix × its colour, linear)
GLOW_MATERIALS = {"lampshade": (0.55, "#ffd9a0"), "lamp_glass": (0.6, "#f3e3c0")}
# Residual noise: the two half-sample bakes (independent seeds), each filled and denoised, differ by
# their noise; over 8 × 8 texel blocks (the blotches' size) of lit, valid texels.
QA_LIMITS = {"block_p99": 0.15, "block_mean": 0.04}
CD_PER_UNIT_REF = 31_800.0  # cd/m² of a white surface under the noon star, set against the capture

FINISHES = None


def _info():
    with open(ENV.replace(".hdr", ".json")) as f:
        return json.load(f)


# ---------------------------------------------------------------- world and render settings

def setup_world():
    """The game's light as the scene's world (kept in the .blend: it is the house's light condition)."""
    sc = bpy.context.scene
    w = bpy.data.worlds.get("GameLight") or bpy.data.worlds.new("GameLight")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    img = bpy.data.images.get("house_env.hdr") or bpy.data.images.load(ENV, check_existing=True)
    img.reload()
    tex = nt.nodes.new("ShaderNodeTexEnvironment")
    tex.image = img
    tex.interpolation = "Linear"
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(tex.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs[0])
    w["source"] = "tools/house-env.mjs (game HDR at the house site)"
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "METAL"
    sc.cycles.device = "GPU"
    sc.cycles.use_light_tree = True
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 6
    sc.cycles.glossy_bounces = 3
    sc.cycles.transparent_max_bounces = 16
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    # Indirect samples clamped at 1 (a sunlit floor or the sky through a window is 0.5–2; a room is
    # ~0.01): at 20, a bounce that found the star (5–10) through a window left a firefly hundreds of
    # times its neighbours, which the denoiser smeared into warm blotches on dark wood and cornices.
    sc.cycles.sample_clamp_indirect = 1.0
    # Every sample counts, at a fixed seed per pass: adaptive sampling stopped bakes at its noise
    # threshold whatever the sample count, and the light sampling threshold (0.01) culled the lamps,
    # whose light on this scale (~0.001–0.01) sits under it
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.light_sampling_threshold = 0.0
    sc.cycles.use_animated_seed = False
    sc.render.use_persistent_data = True
    sc.view_settings.view_transform = "AgX"


def _unit():
    """cd/m² per game radiance unit."""
    return CD_PER_UNIT_REF / _info()["whiteRadianceUp"]


def lamp_lumens(e):
    if "lumens" in e:
        return float(e["lumens"])
    return LUMENS_FROM_WATTS.get(e.get("kind", "lamp"), 13.0) * float(e.get("watts", 60))


def lit_lamps():
    return [e for e in bpy.data.objects if e.type == "EMPTY" and e.name.startswith("Lamp_") and e.get("kind") != "fire"]


def lamps():
    """Point lights at the Lamp_* empties, at their flux in the capture's radiance scale."""
    col = core.coll("House/Engine/BakeLights")
    # a bake leaves the collection excluded (hidden) and the file may be saved so: lamps and portals
    # in an excluded collection do not render, and the lamps' pass came out black
    core.hide(col, False)
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    unit = _unit()
    for e in lit_lamps():
        ld = bpy.data.lights.new("BL_" + e.name, "POINT")
        # Blender light watts are radiant (683 lm/W); radiance unit = `unit` cd/m² = unit/683 W/sr/m²
        ld.energy = lamp_lumens(e) / unit
        ld.color = LIGHT_COLOUR
        ld.shadow_soft_size = 0.03
        lo = bpy.data.objects.new("BL_" + e.name, ld)
        lo.location = e.matrix_world.translation
        col.objects.link(lo)
    return col


def portals():
    """A Cycles light portal over every exterior opening (windows, doors), facing into the house:
    the sky is sampled through the openings, where the rooms' daylight comes from."""
    from .windows import frame_matrix
    col = core.coll("House/Engine/BakeLights")
    for o in P.openings(ext=True):
        h = o["head"] - o["sill"]
        F = frame_matrix(o)
        t = F.col[0].xyz
        n = F.col[1].xyz
        c = F @ Vector((0.0, 0.03, h / 2)).to_4d()
        ld = bpy.data.lights.new("BLP_" + o["name"], "AREA")
        ld.shape = "RECTANGLE"
        ld.size = o["w"] + 0.1
        ld.size_y = h + 0.1
        ld.cycles.is_portal = True
        lo = bpy.data.objects.new("BLP_" + o["name"], ld)
        # light −Z into the house: columns X = −t, Y = up, Z = n (outward)
        lo.matrix_world = Matrix(((-t.x, 0, n.x, c.x), (-t.y, 0, n.y, c.y), (0, 1, 0, c.z), (0, 0, 0, 1)))
        col.objects.link(lo)
    return col


def lighting(mode):
    """'day': the capture through the portals, lamps off; 'lamps': the lamps alone (world black);
    'all': both (the viewport's look)."""
    w = bpy.context.scene.world
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Strength"].default_value = 0.0 if mode == "lamps" else 1.0
    for o in core.coll("House/Engine/BakeLights").objects:
        if o.name.startswith("BLP_"):
            o.hide_render = mode == "lamps"
        elif o.name.startswith("BL_"):
            o.hide_render = mode == "day"


def lamp_glow():
    """Radiance (game units, linear RGB) of each glowing lamp material as the bake lights it: the
    area-weighted mean over its faces of τ·I·cosθ/(π d²) from the lamp it belongs to, I the lamp's
    intensity (flux/4π) and τ the share the shade or glass passes (diffusely). The engine glows these
    materials at it, so a lamp's shade is exactly as bright as the light it gave the room."""
    from .mat import srgb
    unit = _unit()
    lamps_ = [(e.matrix_world.translation.copy(), lamp_lumens(e) / unit) for e in lit_lamps()]
    out = {}
    for mname, (mix, hexcol) in GLOW_MATERIALS.items():
        col = srgb(hexcol)[:3]
        num = 0.0
        den = 0.0
        for o in bpy.data.objects:
            if o.type != "MESH" or not _is_house(o):
                continue
            mats = [m.name if m else "" for m in o.data.materials]
            if mname not in mats:
                continue
            mw = o.matrix_world
            nm = mw.to_3x3().inverted_safe().transposed()
            for poly in o.data.polygons:
                if mats[poly.material_index] != mname:
                    continue
                pc = mw @ poly.center
                pn = (nm @ poly.normal).normalized()
                a = poly.area * abs(mw.determinant()) ** (2 / 3)
                lp, P_ = min(lamps_, key=lambda q: (q[0] - pc).length)
                d = pc - lp
                dist = max(d.length, 0.03)
                if dist > 0.6:
                    continue               # not part of a lit lamp (another use of the material)
                cos = abs(pn.dot(d.normalized()))
                L = mix * (P_ / (4 * math.pi)) * cos / (dist * dist) / math.pi
                num += L * a
                den += a
        if den > 0:
            Lm = num / den
            out[mname] = [Lm * col[i] * LIGHT_COLOUR[i] for i in range(3)]
    return out


# ---------------------------------------------------------------- glass made transparent for the bake

GLASS = ("glass", "stained_glass", "lamp_glass")


def glass_for_bake(on=True):
    from . import mat
    for name in GLASS:
        m = bpy.data.materials.get(name)
        if m is None:
            continue
        if not on:
            if "_built" in m:
                del m["_built"]
            mat.get(name)
            continue
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        col = bsdf.inputs["Base Color"]
        if col.is_linked:
            nt.links.new(col.links[0].from_socket, tr.inputs["Color"])
        else:
            c = col.default_value
            tr.inputs["Color"].default_value = (0.9, 0.92, 0.92, 1.0) if name == "glass" else tuple(c)
        nt.links.new(tr.outputs[0], out.inputs["Surface"])


# ---------------------------------------------------------------- lightmap groups and UVs

def _level_of(o):
    zs = [(o.matrix_world @ Vector(c)).z for c in o.bound_box]
    z = min(zs)
    return max((k for k, v in P.LEVELS.items() if v <= z + 0.35), default=0)


def _is_house(o):
    return o.type == "MESH" and any(c.get("path", "").startswith("House") for c in o.users_collection) and \
        not any("_Prototypes" in c.get("path", "") or c.get("path", "").startswith("House/Engine") for c in o.users_collection)


def groups():
    g = {0: [], 1: [], 2: []}
    for o in bpy.data.objects:
        if not _is_house(o):
            continue
        n = o.name
        ok = n.startswith(LM_PREFIX) or (n.startswith("Fireplace_") and n.endswith(LM_FIRE)) or n in LM_STAIR or n.startswith("Stack_")
        if not ok:
            # lit from the probes: no lightmap left over from an earlier bake
            for k in ("lightmap", "lightmap_uv"):
                if k in o:
                    del o[k]
            if "Lightmap" in o.data.uv_layers:
                o.data.uv_layers.remove(o.data.uv_layers["Lightmap"])
            continue
        if ok:
            lv = int(n[-1]) if n.startswith("Structure_L") else (0 if n == "Structure_G" else _level_of(o))
            g[lv].append(o)
    return g


def _room_facing(o):
    """Structure faces that can be seen from inside: room finishes and opening reveals."""
    from .shell import in_opening, room_at
    me = o.data
    keep = []
    names = [m.name if m else "" for m in me.materials]
    for p in me.polygons:
        mn = names[p.material_index]
        if mn.startswith(("wall_", "floor_", "ceiling")):
            keep.append(True)
            continue
        if mn == "jamb":
            q = np.array(p.center + p.normal * 0.04)
            lv = max((k for k, v in P.LEVELS.items() if v <= q[2] + 0.06), default=None)
            keep.append(lv is not None and (in_opening(q, lv) or room_at(q, lv) is not None))
            continue
        keep.append(False)
    return keep


def _islands(bm, uvl):
    """Faces grouped into UV islands (connected through edges whose two loops share UVs on both sides)."""
    faces = [f for f in bm.faces if f.select]
    seen = set()
    out = []
    for f0 in faces:
        if f0.index in seen:
            continue
        stack = [f0]
        seen.add(f0.index)
        isl = []
        while stack:
            f = stack.pop()
            isl.append(f)
            for l in f.loops:
                e = l.edge
                for lo in e.link_loops:
                    g = lo.face
                    if g.index in seen or not g.select:
                        continue
                    # shared edge: same UVs at both ends on both faces
                    a1, b1 = l[uvl].uv, l.link_loop_next[uvl].uv
                    if lo.vert == l.vert:
                        a2, b2 = lo[uvl].uv, lo.link_loop_next[uvl].uv
                    else:
                        a2, b2 = lo.link_loop_next[uvl].uv, lo[uvl].uv
                    if (a1 - a2).length < 1e-5 and (b1 - b2).length < 1e-5:
                        seen.add(g.index)
                        stack.append(g)
        out.append(isl)
    return out


def _normalise_islands(o, density):
    """Each selected island of `Lightmap` rescaled to metres × density (uniform texel density across the
    floor), and stretched across its narrow axis to at least MIN_CHART: a chart thinner than a few
    texels cannot hold its light (it is lit by one line of texels)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv["Lightmap"]
    sel = [p.select for p in o.data.polygons]
    for f in bm.faces:
        f.select = sel[f.index]
    M = o.matrix_world
    for isl in _islands(bm, uvl):
        a3 = sum(f.calc_area() for f in isl) * abs(M.determinant()) ** (2 / 3)
        loops = [l for f in isl for l in f.loops]
        uvs = np.array([tuple(l[uvl].uv) for l in loops])
        a2 = 0.0
        for f in isl:
            q = np.array([tuple(l[uvl].uv) for l in f.loops])
            a2 += 0.5 * abs(np.dot(q[:, 0], np.roll(q[:, 1], -1)) - np.dot(q[:, 1], np.roll(q[:, 0], -1)))
        if a2 < 1e-12 or a3 < 1e-9:
            continue
        k = math.sqrt(a3 / a2) * density
        c = uvs.mean(0)
        q = (uvs - c) * k
        # principal axes; stretch the narrow one up to the minimum width
        cov = np.cov(q.T) if len(q) > 2 else np.eye(2)
        w, V = np.linalg.eigh(cov)
        r = q @ V
        ext = r.max(0) - r.min(0)
        need = MIN_CHART
        if ext[0] < need:
            r[:, 0] *= need / max(ext[0], 1e-4)
        q = r @ V.T
        for l, (x, y) in zip(loops, q):
            l[uvl].uv = (float(x), float(y))
    bm.to_mesh(o.data)
    bm.free()


def buried(objs):
    """Faces of `objs` pressed into another solid, by name: from sample points across each face (its
    centre and points toward its corners), a ray along the normal that first meets a back face starts
    inside a solid. A face is buried when BURIED of its points are."""
    from mathutils.bvhtree import BVHTree
    g = groups()
    pool = g[0] + g[1] + g[2]
    V, F = [], []
    for o in pool:
        M = o.matrix_world
        base = len(V)
        V.extend(M @ v.co for v in o.data.vertices)
        F.extend([base + i for i in p.vertices] for p in o.data.polygons)
    tree = BVHTree.FromPolygons(V, F, epsilon=0.0)
    out = {}
    for o in objs:
        M = o.matrix_world
        nm = M.to_3x3().inverted_safe().transposed()
        me = o.data
        res = []
        for p in me.polygons:
            n = (nm @ p.normal).normalized()
            c = M @ p.center
            pts = [c] + [c.lerp(M @ me.vertices[v].co, 0.6) for v in p.vertices[:6]]
            inside = 0
            for q in pts:
                loc, nrm, idx, d = tree.ray_cast(q + n * 1e-4, n, 0.6)
                if loc is not None and nrm.dot(n) > 0.2:
                    inside += 1
            res.append(inside >= BURIED * len(pts))
        out[o.name] = res
    return out


def lightmap_uvs(level, objs):
    """Second UV map `Lightmap`: one atlas per floor.

    - All smart-projected (large planar charts): of walls, floors and ceilings (Structure_*) the
      room-facing faces; of the breasts and stair bodies every face not pressed into another solid.
    - Every chart at uniform texel density, at least MIN_CHART wide.
    Faces never seen (exterior backs, wall cores) collapse onto one texel in the corner."""
    for o in bpy.context.selected_objects:
        o.select_set(False)
    structure = [o for o in objs if o.name.startswith("Structure_")]
    trims = [o for o in objs if not o.name.startswith("Structure_")]
    hidden = buried(trims)

    def charted(o):
        if o in structure:
            return _room_facing(o)
        return [not b for b in hidden[o.name]]
    for o in objs:
        me = o.data
        if "Lightmap" not in me.uv_layers:
            me.uv_layers.new(name="Lightmap")
        me.uv_layers["UVMap"].active_render = True
        me.uv_layers.active = me.uv_layers["Lightmap"]
        me.polygons.foreach_set("select", charted(o))
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        o.select_set(False)
    for o in objs:
        o.data.polygons.foreach_set("select", charted(o))
        _normalise_islands(o, 1.0)
    # pack every chart of the floor together (no rescaling between them: their density is set)
    for o in objs:
        o.select_set(True)
        o.data.polygons.foreach_set("select", charted(o))
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, margin=LM_MARGIN, scale=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        me = o.data
        uv = me.uv_layers["Lightmap"].data
        sel = [p.select for p in me.polygons]
        for p in me.polygons:
            if not sel[p.index]:
                for li in p.loop_indices:
                    uv[li].uv = (0.0005, 0.0005)
        me.uv_layers.active = me.uv_layers["UVMap"]
        o["lightmap"] = f"LM_{['G', 'L1', 'L2'][level]}"
        o["lightmap_uv"] = 1


# ---------------------------------------------------------------- lightmap bake

def _bake_into(objs, img, kind, **kw):
    """Bake one pass of the floor's objects into `img` (no margin: the fill below replaces it)."""
    mats = {m for o in objs for m in o.data.materials if m}
    nodes = []
    for m in mats:
        n = m.node_tree.nodes.new("ShaderNodeTexImage")
        n.name = "_bake_target"
        n.image = img
        m.node_tree.nodes.active = n
        nodes.append((m, n))
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["Lightmap"]
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    try:
        bpy.ops.object.bake(type=kind, margin=0, use_clear=True, target="IMAGE_TEXTURES", **kw)
    finally:
        for o in objs:
            o.data.uv_layers.active = o.data.uv_layers["UVMap"]
        for m, n in nodes:
            m.node_tree.nodes.remove(n)


def _image(name, size, alpha=False):
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    if alpha:
        img.generated_color = (0, 0, 0, 0)
    return img


def _pixels(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def push_pull(c, w):
    """Fill texels of weight 0 from their valid neighbours: average down a pyramid by weight, then
    fill each level's holes from the coarser one on the way up. Valid texels are kept as they are."""
    levels = [(c, w)]
    while min(levels[-1][0].shape[:2]) > 1:
        cc, ww = levels[-1]
        h, wd = cc.shape[:2]
        h2, w2 = h // 2, wd // 2
        cw = (cc * ww[..., None])[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2, -1).sum((1, 3))
        ws = ww[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2).sum((1, 3))
        levels.append((cw / np.maximum(ws, 1e-8)[..., None], np.minimum(ws, 1.0)))
    out = levels[-1][0]
    for cc, ww in reversed(levels[:-1]):
        h, wd = cc.shape[:2]
        up = np.repeat(np.repeat(out, 2, 0), 2, 1)
        up = np.pad(up, ((0, h - up.shape[0]), (0, wd - up.shape[1]), (0, 0)), mode="edge")
        out = cc * ww[..., None] + up * (1 - ww[..., None])
    return out


def _blur3(a):
    p = np.pad(a, ((1, 1), (1, 1)) + ((0, 0),) * (a.ndim - 2), mode="edge")
    return sum(p[i:i + a.shape[0], j:j + a.shape[1]] for i in range(3) for j in range(3)) / 9.0


# ±8 texels (~50 cm of a trim): light along a moulding changes over a metre or more (a window, a lamp's
# pool); at ±2–3 the denoiser's blotches survived as streaks along the cornices
def _coverage(objs, size):
    """Texels whose centre lies in a chart (the faces with lightmap UVs), rasterised from the UVs
    themselves. The AO bake's alpha is not trusted for it: on the top floor it came back 1 over the
    whole atlas, and the fill then smeared half the floor's light over its charts."""
    cov = np.zeros((size, size), bool)
    for o in objs:
        me = o.data
        uv = me.uv_layers["Lightmap"].data
        for p in me.polygons:
            q = np.array([tuple(uv[i].uv) for i in p.loop_indices]) * size
            if q.max() < 2.0:
                continue                      # a face left out (collapsed to the corner)
            x0, y0 = np.maximum(np.floor(q.min(0)).astype(int), 0)
            x1, y1 = np.minimum(np.ceil(q.max(0)).astype(int), size)
            if x1 <= x0 or y1 <= y0:
                continue
            ys, xs = np.mgrid[y0:y1, x0:x1]
            px, py = xs + 0.5, ys + 0.5
            inside = np.zeros(px.shape, bool)
            for k in range(1, len(q) - 1):
                a, b, c = q[0], q[k], q[k + 1]
                d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1])
                d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1])
                d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])
                inside |= ~(((d1 < 0) | (d2 < 0) | (d3 < 0)) & ((d1 > 0) | (d2 > 0) | (d3 > 0)))
            cov[y0:y1, x0:x1] |= inside
    return cov


def _masks(objs, size):
    """Coverage, validity and guide normals of a floor's atlas."""
    sc = bpy.context.scene
    ao = _image("_m_ao", size, alpha=True)
    sc.world.light_settings.distance = VALID_DISTANCE
    sc.cycles.samples = 64
    _bake_into(objs, ao, "AO")
    nrm = _image("_m_n", size)
    sc.cycles.samples = 1
    _bake_into(objs, nrm, "NORMAL", normal_space="OBJECT")
    A = _pixels(ao)
    N = _pixels(nrm)[..., :3] * 2 - 1
    covered = _coverage(objs, size)
    valid = covered & (A[..., 0] > VALID_AO)
    for im in (ao, nrm):
        bpy.data.images.remove(im)
    Nf = push_pull(N, covered.astype(np.float32))
    Nf /= np.maximum(np.linalg.norm(Nf, axis=-1, keepdims=True), 1e-6)
    return covered, valid, Nf


def qa(D0, D1, valid):
    """Residual noise of the mean of two independently seeded, denoised bakes: their relative
    difference (luminance), averaged over 8 × 8 texel blocks of lit, valid texels (the size of the
    blotches noise turns into). Returns the blocks' mean and 99th percentile."""
    Y0 = D0 @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    Y1 = D1 @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    m = (Y0 + Y1) / 2
    lit = valid & (m > 2e-4)
    rel = np.where(lit, np.abs(Y0 - Y1) / np.maximum(Y0 + Y1, 1e-9), 0.0)
    h, w = rel.shape
    B = 8
    rs = rel[:h // B * B, :w // B * B].reshape(h // B, B, w // B, B).sum((1, 3))
    ws = lit[:h // B * B, :w // B * B].reshape(h // B, B, w // B, B).sum((1, 3))
    blocks = rs[ws >= B * B // 2] / ws[ws >= B * B // 2]
    if not blocks.size:
        return {"lit": 0, "block_mean": 0.0, "block_p99": 0.0}
    return {"lit": int(lit.sum()), "block_mean": float(blocks.mean()), "block_p99": float(np.percentile(blocks, 99))}


def bake_lightmaps(levels=(0, 1, 2), samples=BAKE_SAMPLES):
    """Per floor: the light (daylight and lamps apart, each in two halves with independent seeds), a
    short-range AO for validity and the normals (the denoiser's guide); invalid texels and margins
    filled; each half denoised; the mean written; the halves' difference QA'd."""
    os.makedirs(BASE, exist_ok=True)
    sc = bpy.context.scene
    sc.render.bake.target = "IMAGE_TEXTURES"
    g = groups()
    done = []
    report = {}
    for lv in levels:
        objs = g[lv]
        tag = ["G", "L1", "L2"][lv]
        name = f"LM_{tag}"
        size = LM_SIZE[lv]
        light = _image(name, size)
        halves = []
        for seed in (1, 2):
            L = np.zeros((size, size, 3), np.float32)
            sc.cycles.seed = seed
            for mode in ("day", "lamps"):
                lighting(mode)
                sc.cycles.samples = max(1, samples[mode] // 2)
                _bake_into(objs, light, "DIFFUSE", pass_filter={"DIRECT", "INDIRECT"})
                P_ = _pixels(light)[..., :3]
                if float(P_.max()) <= 0.0:
                    raise RuntimeError(f"{name}: the {mode} pass is black (lights excluded from the render?)")
                L += P_
            halves.append(L)
        lighting("all")
        sc.cycles.seed = 0
        covered, valid, Nf = _masks(objs, size)
        wv = valid.astype(np.float32)
        # The final is the denoised mean of both halves (all the samples: the denoiser does far
        # better on the less noisy input); each half is denoised alone only to measure the noise.
        path = os.path.join(BASE, f"{name}.exr")
        denoise(push_pull((halves[0] + halves[1]) / 2, wv), Nf, path)
        D = []
        for i, L in enumerate(halves):
            tmp = os.path.join(BASE, f"_{name}_half{i}.exr")
            denoise(push_pull(L, wv), Nf, tmp)
            D.append(_load_exr_rgb(tmp))
            os.remove(tmp)
        report[name] = {**qa(D[0], D[1], valid), "covered": int(covered.sum()), "invalid": int((covered & ~valid).sum())}
        bpy.data.images.remove(light)
        done.append(path)
    with open(os.path.join(BASE, "qa.json"), "w") as f:
        json.dump({"limits": QA_LIMITS, "lightmaps": report}, f, indent=1)
    print("lightmap QA:", json.dumps(report))
    return report


def qa_failures(report):
    return {k: v for k, v in report.items() if v["block_p99"] > QA_LIMITS["block_p99"] or v["block_mean"] > QA_LIMITS["block_mean"]}


def _load_exr_rgb(path):
    img = bpy.data.images.load(path, check_existing=False)
    px = _pixels(img)[..., :3].copy()
    bpy.data.images.remove(img)
    return px


def _float_image(name, arr):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    rgba = np.concatenate([arr.astype(np.float32), np.ones((h, w, 1), np.float32)], -1)
    img.pixels.foreach_set(rgba.ravel())
    return img


def denoise(L, N, path):
    """OIDN (the compositor's Denoise node, HDR, accurate prefilter) over a filled lightmap, guided by
    its normals so it does not smear light across folds, written as half-float EXR."""
    win = bpy.context.window
    main = win.scene if win else bpy.context.scene
    h, w = L.shape[:2]
    li = _float_image("_dn_light", L)
    ni = _float_image("_dn_normal", N)
    sc = bpy.data.scenes.get("_Denoise") or bpy.data.scenes.new("_Denoise")
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    ng = bpy.data.node_groups.new("_denoise", "CompositorNodeTree")
    sc.compositing_node_group = ng
    im = ng.nodes.new("CompositorNodeImage")
    im.image = li
    imn = ng.nodes.new("CompositorNodeImage")
    imn.image = ni
    dn = ng.nodes.new("CompositorNodeDenoise")
    for prop, val in (("prefilter", "ACCURATE"), ("use_hdr", True), ("quality", "HIGH")):
        if hasattr(dn, prop):
            setattr(dn, prop, val)
        elif prop in dn.inputs:
            dn.inputs[prop].default_value = val
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    go = ng.nodes.new("NodeGroupOutput")
    ng.links.new(im.outputs["Image"], dn.inputs["Image"])
    ng.links.new(imn.outputs["Image"], dn.inputs["Normal"])
    ng.links.new(dn.outputs[0], go.inputs[0])
    try:
        bpy.ops.render.render(scene=sc.name)
        st = sc.render.image_settings
        st.file_format, st.color_depth, st.exr_codec, st.color_mode = "OPEN_EXR", "16", "ZIP", "RGB"
        bpy.data.images["Render Result"].save_render(path, scene=sc)
    finally:
        bpy.data.node_groups.remove(ng)
        bpy.data.scenes.remove(sc)
        if win:
            win.scene = main
        bpy.data.images.remove(li)
        bpy.data.images.remove(ni)


# ---------------------------------------------------------------- probes (SH L2) and reflections

def _pano_camera(res):
    sc = bpy.context.scene
    cam = bpy.data.objects.get("_BakeCam")
    if cam is None:
        cd = bpy.data.cameras.new("_BakeCam")
        cam = bpy.data.objects.new("_BakeCam", cd)
        sc.collection.objects.link(cam)
    cam.data.type = "PANO"
    cam.data.panorama_type = "EQUIRECTANGULAR"
    cam.data.clip_start = 0.02
    cam.rotation_euler = (math.pi / 2, 0.0, -math.pi / 2)    # looking +X, Z up: equirect matches the world map
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    return cam


def _render_equirect(cam, loc, samples, denoise, path):
    sc = bpy.context.scene
    cam.location = loc
    sc.cycles.samples = samples
    sc.cycles.use_denoising = denoise
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "16"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    bpy.data.images.remove(img)
    return px


def _sh_basis(d):
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    return np.stack([
        0.282095 * np.ones_like(x),
        0.488603 * y, 0.488603 * z, 0.488603 * x,
        1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y),
    ], -1)


def _equirect_dirs(w, h):
    """Direction and solid angle of each pixel of a Cycles equirect render seen from a camera looking +X
    (u = −atan2(y, x)/2π + 0.5 on the image, row 0 at the bottom)."""
    u = (np.arange(w) + 0.5) / w
    v = (np.arange(h) + 0.5) / h
    az = -(u - 0.5) * 2 * math.pi
    el = (v - 0.5) * math.pi
    AZ, EL = np.meshgrid(az, el)
    d = np.stack([np.cos(EL) * np.cos(AZ), np.cos(EL) * np.sin(AZ), np.sin(EL)], -1)
    dw = np.cos(EL) * (math.pi / h) * (2 * math.pi / w)
    return d, dw


def probe_points(spacing=1.0):
    """Grid points inside rooms: 1 m apart in plan, at 0.5, 1.4 and 2.4 m above each floor (lower
    rooms under the roof get fewer)."""
    from .shell import room_at
    xs = np.arange(-13.0, 10.0, spacing) + spacing / 2
    ys = np.arange(-3.0, 14.5, spacing) + spacing / 2
    pts = []
    for lv, fl in P.LEVELS.items():
        for hz in (0.5, 1.4, 2.4):
            z = fl + hz
            if z > P.CEIL[lv] - 0.15:
                continue
            for x in xs:
                for y in ys:
                    r = room_at(np.array([x, y, z]), lv)
                    if r is not None:
                        pts.append((lv, r["name"], float(x), float(y), float(z)))
    return pts


def probe_inside(p):
    """A probe is unusable when it sits inside something (a wardrobe, a bed): most of the rays from it
    first meet a surface from behind."""
    dg = bpy.context.evaluated_depsgraph_get()
    sc = bpy.context.scene
    dirs = [Vector(d) for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
                                (0.577, 0.577, 0.577), (-0.577, -0.577, 0.577))]
    back = 0
    for d in dirs:
        ok, loc, nrm, idx, ob, mw = sc.ray_cast(dg, Vector(p), d)
        if ok and nrm.dot(d) > 0:
            back += 1
    return back >= 3


def bake_probes(spacing=1.0, res=(64, 32), samples=None):
    samples = samples or {"day": 192, "lamps": 96}
    cam = _pano_camera(res)
    d, dw = _equirect_dirs(*res)
    Y = _sh_basis(d)                                   # h, w, 9
    tmp = os.path.join(BASE, "_probe.exr")
    pts = probe_points(spacing)
    coeffs = np.zeros((len(pts), 9, 3), dtype=np.float32)
    for mode in ("day", "lamps"):
        lighting(mode)
        before = float(np.abs(coeffs[:25, 0]).sum())
        for i, (lv, room, x, y, z) in enumerate(pts):
            L = _render_equirect(cam, (x, y, z), samples[mode], False, tmp)
            coeffs[i] += np.einsum("hwk,hwc,hw->kc", Y, L, dw)
            if i == 24 and float(np.abs(coeffs[:25, 0]).sum()) <= before * 1.0001:
                raise RuntimeError(f"probes: the {mode} pass is black (lights excluded from the render?)")
    lighting("all")
    os.remove(tmp)
    with open(os.path.join(BASE, "probes.bin"), "wb") as f:
        f.write(coeffs.astype("<f4").tobytes())
    return pts


def bake_reflections(res=(512, 256), samples=None):
    samples = samples or {"day": 256, "lamps": 128}
    cam = _pano_camera(res)
    out = []
    for r in P.ROOMS:
        pc = max(r["pieces"], key=lambda q: abs(geo.area(q)))
        c = np.array(pc).mean(0)
        z = P.LEVELS[r["level"]] + 1.6
        lo = np.min([np.min(np.array(q), 0) for q in r["pieces"]], 0)
        hi = np.max([np.max(np.array(q), 0) for q in r["pieces"]], 0)
        path = os.path.join(BASE, f"refl_{r['name']}.exr")
        total = None
        for mode in ("day", "lamps"):
            lighting(mode)
            px = _render_equirect(cam, (float(c[0]), float(c[1]), z), samples[mode], True, path)
            total = px if total is None else total + px
        lighting("all")
        _write_exr(total, path)
        out.append({"room": r["name"], "level": r["level"], "file": os.path.basename(path), "position": [float(c[0]), float(c[1]), z],
                    "box": [float(lo[0]), float(lo[1]), P.LEVELS[r["level"]], float(hi[0]), float(hi[1]), float(r["ceil"])]})
    return out


def _write_exr(px, path):
    """Linear RGB (rows bottom first, as Blender's pixels) as a half-float EXR, written raw."""
    h, w = px.shape[:2]
    img = bpy.data.images.new("_exr", w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(np.concatenate([px.astype(np.float32), np.ones((h, w, 1), np.float32)], -1).ravel())
    img.filepath_raw = path
    img.file_format = "OPEN_EXR"
    img.use_half_precision = True
    img.save()
    bpy.data.images.remove(img)


def write_manifest(pts, refl, spacing, glow):
    info = _info()
    man = {
        "units": "game radiance (docs/world.md); lightmaps = white Lambertian outgoing radiance (shade albedo × lightmap)",
        "frame": "Blender house frame, metres: +Z up, front faces -Y, origin at grade under the front door's centre",
        "environment": {"file": "house_env.hdr", **info},
        "lightmaps": {f"LM_{t}": {"file": f"LM_{t}.exr", "uv": 1, "size": LM_SIZE[i]} for i, t in enumerate(["G", "L1", "L2"])},
        "probes": {
            "file": "probes.bin",
            "layout": "float32 little-endian, [probe][9 SH L2 coefficients (Y00, Y1-1, Y10, Y11, Y2-2, Y2-1, Y20, Y21, Y22)][RGB], radiance",
            "spacing": spacing,
            "points": [{"level": lv, "room": rm, "p": [x, y, z], "valid": not probe_inside((x, y, z))}
                       for lv, rm, x, y, z in pts],
            "valid": "false where the probe sits inside furniture: skip it and renormalise the interpolation weights",
        },
        "reflections": refl,
        "lamps": {k: {"radiance": v} for k, v in glow.items()},
    }
    with open(os.path.join(BASE, "bake.json"), "w") as f:
        json.dump(man, f, indent=1)


# ---------------------------------------------------------------- the whole bake

def trial(levels=(0, 1, 2), size=512, fraction=8):
    """A quick run of the whole lightmap pipeline (charts, portals, lamps, masks, denoise, QA) at a
    small atlas and a fraction of the samples, written to bake/trial/: minutes, not an hour. Run it
    before every full bake; it fails on what a full bake would (a black pass, a bad mask)."""
    global BASE
    base, sizes = BASE, dict(LM_SIZE)
    BASE = os.path.join(base, "trial")
    os.makedirs(BASE, exist_ok=True)
    for lv in levels:
        LM_SIZE[lv] = size
    setup_world()
    col = lamps()
    portals()
    glass_for_bake(True)
    try:
        g = groups()
        for lv in levels:
            lightmap_uvs(lv, g[lv])
        report = bake_lightmaps(levels, samples={k: max(8, v // fraction) for k, v in BAKE_SAMPLES.items()})
        for name, r in report.items():
            share = r["covered"] / (size * size)
            if not 0.3 < share < 0.95:
                raise RuntimeError(f"trial {name}: charts cover {share:.0%} of the atlas")
        return report
    finally:
        glass_for_bake(False)
        core.hide(col, True)
        BASE = base
        LM_SIZE.update(sizes)


def rebake_lightmaps(levels=(0, 1, 2)):
    """The lightmaps alone (their charts and the bake), keeping the probes, reflections and manifest."""
    setup_world()
    col = lamps()
    portals()
    glass_for_bake(True)
    try:
        g = groups()
        for lv in levels:
            lightmap_uvs(lv, g[lv])
        report = bake_lightmaps(levels)
    finally:
        glass_for_bake(False)
        core.hide(col, True)
    bad = qa_failures(report)
    if bad:
        raise RuntimeError(f"lightmap QA failed (written): {bad}")


def rebake_probes_reflections(spacing=1.0):
    """The probe grid and the rooms' reflections alone (the lightmaps kept), and the manifest."""
    setup_world()
    col = lamps()
    portals()
    glass_for_bake(True)
    try:
        pts = bake_probes(spacing)
        refl = bake_reflections()
        write_manifest(pts, refl, spacing, lamp_glow())
    finally:
        glass_for_bake(False)
        core.hide(col, True)
        cam = bpy.data.objects.get("_BakeCam")
        if cam:
            bpy.data.objects.remove(cam, do_unlink=True)


def run(levels=(0, 1, 2), probes=True, reflections=True, spacing=1.0):
    setup_world()
    col = lamps()
    portals()
    glass_for_bake(True)
    try:
        g = groups()
        for lv in levels:
            lightmap_uvs(lv, g[lv])
        report = bake_lightmaps(levels)
        pts = bake_probes(spacing) if probes else []
        refl = bake_reflections() if reflections else []
        write_manifest(pts, refl, spacing, lamp_glow())
        bad = qa_failures(report)
        if bad:
            raise RuntimeError(f"lightmap QA failed (everything else baked and written): {bad}")
    finally:
        glass_for_bake(False)
        core.hide(col, True)
        cam = bpy.data.objects.get("_BakeCam")
        if cam:
            bpy.data.objects.remove(cam, do_unlink=True)
