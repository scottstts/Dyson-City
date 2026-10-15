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

Lamps are lit at their real output in this scale: the capture's white sunlit radiance stands for
~31,800 cd/m² (a white surface under a 100,000 lux noon), and a lamp's flux is converted with it.
Fires are out (it is noon). Window glass is made a plain transparent filter for the bake (no
refraction, so no caustic noise); its materials are rebuilt afterwards.
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
LM_PREFIX = ("Structure_", "Skirting_", "Cornice_G", "Cornice_L1", "PictureRail_", "DadoRail_", "Wainscot_",
             "CeilingRoses_", "Gallery_")
LM_STAIR = ("_Body", "_Strg", "_Sp", "_Treads", "_Risers", "_Run")
LM_FIRE = ("_Breast", "_Mantel", "_Hearth", "_Tiles", "_Lining", "_Shelf", "_Range")
LM_SIZE = {0: 4096, 1: 4096, 2: 2048}
LM_MARGIN = 0.003           # pack margin, UV units (12 texels at 4k)
BAKE_SAMPLES = 768
LUMENS = {"pendant": 1500.0, "table_lamp": 800.0, "lamp": 800.0, "lantern": 600.0}
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
    sc.cycles.sample_clamp_indirect = 20.0
    sc.render.use_persistent_data = True
    sc.view_settings.view_transform = "AgX"


def lamps():
    """Point lights at the Lamp_* empties, at their real flux in the capture's radiance scale."""
    col = core.coll("House/Engine/BakeLights")
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    unit = CD_PER_UNIT_REF / _info()["whiteRadianceUp"]       # cd/m² per game radiance unit
    for e in bpy.data.objects:
        if e.type != "EMPTY" or not e.name.startswith("Lamp_"):
            continue
        kind = e.get("kind", "lamp")
        if kind == "fire":
            continue
        lm = LUMENS.get(kind, 800.0) * float(e.get("watts", 60)) / (100.0 if kind == "pendant" else 60.0)
        ld = bpy.data.lights.new("BL_" + e.name, "POINT")
        # Blender light watts are radiant (683 lm/W); radiance unit = `unit` cd/m² = unit/683 W/sr/m²
        ld.energy = lm / unit
        ld.color = (1.0, 0.78, 0.52)              # incandescent, ~2,700 K
        ld.shadow_soft_size = 0.03
        lo = bpy.data.objects.new("BL_" + e.name, ld)
        lo.location = e.matrix_world.translation
        col.objects.link(lo)
    return col


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
        ok = n.startswith(LM_PREFIX) or (n.startswith(("MainStair", "TopStair")) and n.endswith(LM_STAIR)) \
            or (n.startswith("Fireplace_") and n.endswith(LM_FIRE)) \
            or (n.startswith("Door_") and n.endswith("_Frame") and any(c.get("path") == "House/Interior/Doors" for c in o.users_collection))
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


def lightmap_uvs(level, objs):
    """Second UV map `Lightmap`: one atlas per floor, uniform texel density, islands packed with margin."""
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        me = o.data
        if "Lightmap" not in me.uv_layers:
            me.uv_layers.new(name="Lightmap")
        me.uv_layers["UVMap"].active_render = True
        me.uv_layers.active = me.uv_layers["Lightmap"]
        sel = _room_facing(o) if o.name.startswith("Structure_") else [True] * len(me.polygons)
        me.polygons.foreach_set("select", sel)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, margin=LM_MARGIN)
    bpy.ops.object.mode_set(mode="OBJECT")
    # faces left out (hidden exterior backs, wall cores) collapse onto one texel in the corner
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

def bake_lightmaps(levels=(0, 1, 2), samples=BAKE_SAMPLES):
    os.makedirs(BASE, exist_ok=True)
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.render.bake.margin = 16
    sc.render.bake.margin_type = "EXTEND"
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False
    sc.render.bake.target = "IMAGE_TEXTURES"
    sc.render.bake.use_clear = True
    g = groups()
    done = []
    for lv in levels:
        objs = g[lv]
        tag = ["G", "L1", "L2"][lv]
        name = f"LM_{tag}"
        img = bpy.data.images.get(name)
        if img is not None:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(name, LM_SIZE[lv], LM_SIZE[lv], alpha=False, float_buffer=True)
        img.colorspace_settings.name = "Non-Color"
        # every material on the group gets an (unlinked) image node, made active, for the bake target
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
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=16, use_clear=True,
                            target="IMAGE_TEXTURES")
        for o in objs:
            o.data.uv_layers.active = o.data.uv_layers["UVMap"]
        for m, n in nodes:
            m.node_tree.nodes.remove(n)
        path = os.path.join(BASE, f"{name}.exr")
        denoise(img, path)
        done.append(path)
    return done


def denoise(img, path):
    """OIDN (the compositor's Denoise node, HDR) over a baked lightmap, written as half-float EXR and
    reloaded in place of the noisy bake. Islands sit 12 texels apart with 16-texel extended margins,
    so the filter does not carry light from one surface onto another."""
    main = bpy.context.window.scene
    w, h = img.size
    sc = bpy.data.scenes.get("_Denoise") or bpy.data.scenes.new("_Denoise")
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    ng = bpy.data.node_groups.new("_denoise", "CompositorNodeTree")
    sc.compositing_node_group = ng
    im = ng.nodes.new("CompositorNodeImage")
    im.image = img
    dn = ng.nodes.new("CompositorNodeDenoise")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    go = ng.nodes.new("NodeGroupOutput")
    ng.links.new(im.outputs["Image"], dn.inputs["Image"])
    ng.links.new(dn.outputs[0], go.inputs[0])
    try:
        bpy.ops.render.render(scene=sc.name)
        st = sc.render.image_settings
        st.file_format, st.color_depth, st.exr_codec, st.color_mode = "OPEN_EXR", "16", "ZIP", "RGB"
        bpy.data.images["Render Result"].save_render(path, scene=sc)
    finally:
        bpy.data.node_groups.remove(ng)
        bpy.data.scenes.remove(sc)
        bpy.context.window.scene = main
    img.source = "FILE"
    img.filepath = path
    img.reload()


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


def bake_probes(spacing=1.0, res=(64, 32), samples=96):
    cam = _pano_camera(res)
    d, dw = _equirect_dirs(*res)
    Y = _sh_basis(d)                                   # h, w, 9
    tmp = os.path.join(BASE, "_probe.exr")
    pts = probe_points(spacing)
    coeffs = np.zeros((len(pts), 9, 3), dtype=np.float32)
    for i, (lv, room, x, y, z) in enumerate(pts):
        L = _render_equirect(cam, (x, y, z), samples, False, tmp)
        coeffs[i] = np.einsum("hwk,hwc,hw->kc", Y, L, dw)
    os.remove(tmp)
    with open(os.path.join(BASE, "probes.bin"), "wb") as f:
        f.write(coeffs.astype("<f4").tobytes())
    return pts


def bake_reflections(res=(512, 256), samples=256):
    cam = _pano_camera(res)
    out = []
    for r in P.ROOMS:
        pc = max(r["pieces"], key=lambda q: abs(geo.area(q)))
        c = np.array(pc).mean(0)
        z = P.LEVELS[r["level"]] + 1.6
        lo = np.min([np.min(np.array(q), 0) for q in r["pieces"]], 0)
        hi = np.max([np.max(np.array(q), 0) for q in r["pieces"]], 0)
        path = os.path.join(BASE, f"refl_{r['name']}.exr")
        _render_equirect(cam, (float(c[0]), float(c[1]), z), samples, True, path)
        out.append({"room": r["name"], "level": r["level"], "file": os.path.basename(path), "position": [float(c[0]), float(c[1]), z],
                    "box": [float(lo[0]), float(lo[1]), P.LEVELS[r["level"]], float(hi[0]), float(hi[1]), float(r["ceil"])]})
    return out


def write_manifest(pts, refl, spacing):
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
    }
    with open(os.path.join(BASE, "bake.json"), "w") as f:
        json.dump(man, f, indent=1)


# ---------------------------------------------------------------- the whole bake

def run(levels=(0, 1, 2), probes=True, reflections=True, spacing=1.0):
    setup_world()
    col = lamps()
    glass_for_bake(True)
    try:
        g = groups()
        for lv in levels:
            lightmap_uvs(lv, g[lv])
        bake_lightmaps(levels)
        pts = bake_probes(spacing) if probes else []
        refl = bake_reflections() if reflections else []
        write_manifest(pts, refl, spacing)
    finally:
        glass_for_bake(False)
        core.hide(col, True)
        cam = bpy.data.objects.get("_BakeCam")
        if cam:
            bpy.data.objects.remove(cam, do_unlink=True)
