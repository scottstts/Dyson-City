"""Export the house for the game as one uncompressed bundle, `assets/house.pack` (city_plan.md §9 step 1).

Stages (each can be re-run alone; intermediates go to `blender/export/`, which git ignores):

1. `bake_materials()`: every procedural material becomes a texture set glTF can carry. Each channel
   (base colour, roughness, metallic, transmission, alpha, tangent normal) is baked from the node graph
   onto a flat tile in a scene of its own. Metric materials (UVs in metres) bake one tile whose size is a
   whole number of the pattern's periods (boards, bricks, tiles, wallpaper repeats) and is made seamless
   by cross-fading it with its half-period-shifted copy; materials mapped once across a part (rugs,
   pictures, stained glass, the clock dial) bake their 0..1 UV square. A channel with no variation
   becomes a constant factor and no texture.
2. `export_parts()`: four glTF parts (exterior, ground, first, top floor; .gltf + .bin, images apart), meshes uncompressed and shared
   between instances, materials swapped for their baked versions (tile size as KHR_texture_transform),
   custom properties as extras (door rigs, lamps, sounds, collision, lightmap tags).
3. `pack()`: the parts' JSON and binary buffers, each texture image once, the lightmaps and reflection captures as GPU-native RGB9E5 (WebGPU
   `rgb9e5ufloat`, filterable; uploaded as is), the SH probe grid as float32, and an index.

Pack layout (little-endian): magic `DCPK`, u32 version, u32 index byte length, the index (UTF-8 JSON),
then every entry 256-byte aligned at the absolute `offset` the index gives. Nothing in the pack is
compressed: an entry is uploaded or parsed straight from a byte range (R2 serves Range requests).
"""
import json
import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import plan as P

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # blender/
OUT = os.path.join(ROOT, "export")
TEX = os.path.join(OUT, "tex")
BAKE = os.path.join(ROOT, "bake")
ASSETS = os.path.join(os.path.dirname(ROOT), "assets")

UNIT_UV = {"rug_bed", "rug_dining", "rug_parlour", "stained_glass", "painting_landscape", "painting_portrait",
           "clock_dial"}
DOUBLE_SIDED = {"leaf", "petal_white", "sheer"}
PPM = 384                  # texels per metre for procedural tiles (~2.6 mm)
PPM_IMAGE = 1450           # for tiles built on an image texture (keeps the source's detail)
MAX_TILE = 2048
EXPORT_SUFFIX = "__gltf"


# ---------------------------------------------------------------- 1. material texture bake

def _tile_for(m):
    """(Rx, Ry) in UV units and pixels (w, h) for a material's bake tile."""
    if m.name in UNIT_UV:
        return (1.0, 1.0), (1024, 1024), False
    nodes = m.node_tree.nodes
    rx = ry = None
    image_based = False
    for n in nodes:
        if n.type == "TEX_BRICK":
            src = n.inputs["Vector"].links[0].from_node if n.inputs["Vector"].is_linked else None
            s = src.inputs["Scale"].default_value if src is not None and src.type == "MAPPING" else (1, 1, 1)
            S = n.inputs["Scale"].default_value
            w = n.inputs["Brick Width"].default_value / (S * s[0])
            rows = n.offset_frequency if n.offset > 0 else 1
            h = n.inputs["Row Height"].default_value * rows / (S * s[1])
            # an even number of periods, ~2 m (so the half-tile shift used for the seam lines up too)
            kx = max(2, 2 * round(2.0 / w / 2)) if w < 4 else None
            ky = max(2, 2 * round(2.0 / h / 2))
            rx = w * kx if kx else 2.0
            ry = h * ky
    for n in nodes:
        if n.type == "TEX_IMAGE" and n.inputs["Vector"].is_linked:
            src = n.inputs["Vector"].links[0].from_node
            if src.type == "MAPPING":
                s = src.inputs["Scale"].default_value
                if s[0] > 1.05:                          # a repeat in metres: tile = two periods
                    rx, ry = 2.0 / s[0], 2.0 / s[1]
                    image_based = True
    rx = rx or 2.0
    ry = ry or 2.0
    ppm = PPM_IMAGE if image_based else PPM
    w = int(min(MAX_TILE, max(64, round(rx * ppm))))
    h = int(min(MAX_TILE, max(64, round(ry * ppm))))
    return (rx, ry), (w, h), True


def _bake_scene():
    sc = bpy.data.scenes.get("_TexBake") or bpy.data.scenes.new("_TexBake")
    sc.render.engine = "CYCLES"
    sc.cycles.device = "GPU"
    sc.cycles.samples = 4
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 0
    return sc


def _plane(sc, rx, ry):
    me = bpy.data.meshes.get("_TexPlane") or bpy.data.meshes.new("_TexPlane")
    me.clear_geometry()
    me.from_pydata([(0, 0, 0), (rx, 0, 0), (rx, ry, 0), (0, ry, 0)], [], [[0, 1, 2, 3]])
    uv = me.uv_layers.new(name="UVMap")              # what the material reads (metres)
    for li, c in zip(range(4), [(0, 0), (rx, 0), (rx, ry), (0, ry)]):
        uv.data[li].uv = c
    bk = me.uv_layers.new(name="BakeUV")             # where the bake writes: the whole image, once
    for li, c in zip(range(4), [(0, 0), (1, 0), (1, 1), (0, 1)]):
        bk.data[li].uv = c
    me.uv_layers.active = bk
    o = bpy.data.objects.get("_TexPlane")
    if o is None:
        o = bpy.data.objects.new("_TexPlane", me)
        sc.collection.objects.link(o)
    return o


def _principled(m):
    return next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def _bake_channel(sc, plane, m, channel, size):
    """Bake one Principled input (or the tangent normal) of material m over the tile, as float RGB."""
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output)
    surf_link = out.inputs["Surface"].links[0] if out.inputs["Surface"].is_linked else None
    prev_from = surf_link.from_socket if surf_link else None
    p = _principled(m)
    img = bpy.data.images.new("_bake_" + channel, size[0], size[1], alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    em = None
    try:
        if channel == "normal":
            if prev_from is not None and prev_from.node != p and p is not None:
                nt.links.new(p.outputs[0], out.inputs["Surface"])      # bake the Principled's own normal
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=0, use_clear=True)
        else:
            em = nt.nodes.new("ShaderNodeEmission")
            src = p.inputs[channel]
            if src.is_linked:
                nt.links.new(src.links[0].from_socket, em.inputs["Color"])
            else:
                v = src.default_value
                em.inputs["Color"].default_value = tuple(v) if hasattr(v, "__len__") else (v, v, v, 1.0)
            nt.links.new(em.outputs[0], out.inputs["Surface"])
            bpy.ops.object.bake(type="EMIT", margin=0, use_clear=True)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(size[1], size[0], 4)[..., :3].copy()
    finally:
        if em is not None:
            nt.nodes.remove(em)
        if prev_from is not None:
            nt.links.new(prev_from, out.inputs["Surface"])
        nt.nodes.remove(tex)
        bpy.data.images.remove(img)
    return px


def _seamless(a, normal=False):
    """Cross-fade a tile with its half-shifted copy: the copy covers the tile's edges, the tile covers
    the copy's (now central) seams, so the result repeats without a visible joint."""
    h, w = a.shape[:2]
    b = np.roll(a, (h // 2, w // 2), (0, 1))
    y = np.minimum(np.arange(h), h - 1 - np.arange(h)) / (h / 2)
    x = np.minimum(np.arange(w), w - 1 - np.arange(w)) / (w / 2)
    mask = np.clip(np.minimum.outer(y, x) / 0.35, 0, 1)
    mask = mask * mask * (3 - 2 * mask)
    c = a * mask[..., None] + b * (1 - mask[..., None])
    if normal:
        n = c * 2 - 1
        n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-8
        c = n * 0.5 + 0.5
    return c


def _to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _save(px, path, fmt, srgb):
    h, w = px.shape[:2]
    img = bpy.data.images.new("_save", w, h, alpha=False)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    rgba = np.concatenate([np.clip(px, 0, 1), np.ones((h, w, 1), np.float32)], -1)
    img.pixels[:] = rgba.ravel()
    img.filepath_raw = path
    img.file_format = fmt
    sc = bpy.context.scene
    if fmt == "JPEG":
        sc.render.image_settings.quality = 92
    img.save()
    bpy.data.images.remove(img)


def used_materials():
    names = set()
    for o in bpy.data.objects:
        if o.type == "MESH" and _part_of(o) is not None:
            for m in o.data.materials:
                if m and not m.name.endswith(EXPORT_SUFFIX):
                    names.add(m.name)
    return sorted(names)


def bake_materials(names=None):
    os.makedirs(TEX, exist_ok=True)
    main = bpy.context.window.scene
    sc = _bake_scene()
    bpy.context.window.scene = sc
    table = {}
    try:
        for name in names or used_materials():
            m = bpy.data.materials[name]
            p = _principled(m)
            if p is None:
                continue
            (rx, ry), size, metric = _tile_for(m)
            plane = _plane(sc, rx, ry)
            plane.data.materials.clear()
            plane.data.materials.append(m)
            for o in sc.objects:
                o.select_set(o == plane)
            bpy.context.view_layer.objects.active = plane
            rec = {"tile": [rx, ry], "metric": metric}
            ch = {}
            for key, sock in (("base", "Base Color"), ("rough", "Roughness"), ("metal", "Metallic"),
                              ("trans", "Transmission Weight"), ("alpha", "Alpha")):
                s = p.inputs[sock]
                if not s.is_linked:
                    v = s.default_value
                    rec[key] = list(v)[:3] if hasattr(v, "__len__") else float(v)
                    continue
                a = _bake_channel(sc, plane, m, sock, size)
                if metric:
                    a = _seamless(a)
                if key == "base":
                    s_rgb = _to_srgb(a)
                    if s_rgb.reshape(-1, 3).std(0).max() < 0.004:
                        rec[key] = [float(v) for v in a.reshape(-1, 3).mean(0)]
                    else:
                        ch[key] = s_rgb
                else:
                    g = a[..., 0]
                    if g.std() < 0.01:
                        rec[key] = float(g.mean())
                    else:
                        ch[key] = g
            nrm = _bake_channel(sc, plane, m, "normal", size)
            if metric:
                nrm = _seamless(nrm, normal=True)
            if np.abs(nrm - np.array([0.5, 0.5, 1.0])).mean() > 0.004:
                ch["normal"] = nrm
            # files: base colour (sRGB JPEG), packed ORM (glTF: G roughness, B metal), normal (PNG)
            if "base" in ch:
                f = f"{name}_base.jpg"
                _save(ch["base"], os.path.join(TEX, f), "JPEG", True)
                rec["base_tex"] = f
            if "rough" in ch or "metal" in ch:
                shp = (ch.get("rough", ch.get("metal"))).shape
                orm = np.stack([np.ones(shp, np.float32),
                                ch.get("rough", np.full(shp, rec.get("rough", 0.5), np.float32)),
                                ch.get("metal", np.full(shp, rec.get("metal", 0.0), np.float32))], -1)
                f = f"{name}_orm.png"
                _save(orm, os.path.join(TEX, f), "PNG", False)
                rec["orm_tex"] = f
            for key in ("trans", "alpha"):
                if key in ch:
                    f = f"{name}_{key}.png"
                    _save(np.repeat(ch[key][..., None], 3, -1), os.path.join(TEX, f), "PNG", False)
                    rec[f"{key}_tex"] = f
            if "normal" in ch:
                f = f"{name}_normal.png"
                _save(ch["normal"], os.path.join(TEX, f), "PNG", False)
                rec["normal_tex"] = f
            rec["ior"] = float(p.inputs["IOR"].default_value)
            table[name] = rec
    finally:
        bpy.context.window.scene = main
        o = bpy.data.objects.get("_TexPlane")
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)
        me = bpy.data.meshes.get("_TexPlane")
        if me is not None:
            bpy.data.meshes.remove(me)
        bpy.data.scenes.remove(sc)
    path = os.path.join(OUT, "materials.json")
    old = json.load(open(path)) if os.path.exists(path) and names else {}
    old.update(table)
    with open(path, "w") as f:
        json.dump(old, f, indent=1)
    return table


# ---------------------------------------------------------------- export materials

def _img(path, srgb):
    name = os.path.basename(path)
    img = bpy.data.images.get(name)
    if img is None:
        img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    return img


def make_export_materials():
    table = json.load(open(os.path.join(OUT, "materials.json")))
    made = {}
    for name, rec in table.items():
        mname = name + EXPORT_SUFFIX
        m = bpy.data.materials.get(mname) or bpy.data.materials.new(mname)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        p = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(p.outputs[0], out.inputs[0])
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        mp = nt.nodes.new("ShaderNodeMapping")
        rx, ry = rec["tile"]
        mp.inputs["Scale"].default_value = (1.0 / rx, 1.0 / ry, 1.0)
        nt.links.new(uv.outputs[0], mp.inputs["Vector"])

        def tex(f, srgb):
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = _img(os.path.join(TEX, f), srgb)
            t.interpolation = "Linear"
            t.extension = "REPEAT"
            nt.links.new(mp.outputs[0], t.inputs["Vector"])
            return t

        if "base_tex" in rec:
            nt.links.new(tex(rec["base_tex"], True).outputs["Color"], p.inputs["Base Color"])
        else:
            b = rec["base"]
            p.inputs["Base Color"].default_value = (b[0], b[1], b[2], 1.0)
        if "orm_tex" in rec:
            t = tex(rec["orm_tex"], False)
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            nt.links.new(t.outputs["Color"], sep.inputs[0])
            nt.links.new(sep.outputs[1], p.inputs["Roughness"])
            nt.links.new(sep.outputs[2], p.inputs["Metallic"])
        else:
            p.inputs["Roughness"].default_value = float(rec.get("rough", 0.5))
            p.inputs["Metallic"].default_value = float(rec.get("metal", 0.0))
        if "trans_tex" in rec:
            nt.links.new(tex(rec["trans_tex"], False).outputs["Color"], p.inputs["Transmission Weight"])
        elif "trans" in rec and not isinstance(rec["trans"], list):
            p.inputs["Transmission Weight"].default_value = rec["trans"]
        if "alpha_tex" in rec:
            nt.links.new(tex(rec["alpha_tex"], False).outputs["Color"], p.inputs["Alpha"])
        elif "alpha" in rec and not isinstance(rec["alpha"], list):
            p.inputs["Alpha"].default_value = rec["alpha"]
        if name == "sheer":
            p.inputs["Alpha"].default_value = 0.45          # lace: the translucency becomes coverage
        p.inputs["IOR"].default_value = rec.get("ior", 1.5)
        if "normal_tex" in rec:
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.uv_map = "UVMap"
            nt.links.new(tex(rec["normal_tex"], False).outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs[0], p.inputs["Normal"])
        m.use_backface_culling = name not in DOUBLE_SIDED
        made[name] = m
    return made


# ---------------------------------------------------------------- parts

EXT_DOORS = None


def _ext_doors():
    global EXT_DOORS
    if EXT_DOORS is None:
        EXT_DOORS = {o["name"] for o in P.openings(ext=True) if o["kind"] in ("door", "french")}
    return EXT_DOORS


def _paths(o):
    return [c.get("path", "") for c in o.users_collection]


def _level_tag(z):
    lv = max((k for k, v in P.LEVELS.items() if v <= z + 0.35), default=0)
    return ["G", "L1", "L2"][lv]


def _point_part(p):
    from .shell import room_at
    for lv, fl in P.LEVELS.items():
        r = room_at(np.array(p), lv)
        if r is not None:
            return ["G", "L1", "L2"][lv]
    return "exterior"


def _part_of(o):
    """'exterior' | 'G' | 'L1' | 'L2' | None (not exported)."""
    paths = _paths(o)
    if not any(p.startswith("House") for p in paths):
        return None
    if any("_Prototypes" in p or p.startswith(("House/Engine/BakeLights", "House/_")) for p in paths):
        return None
    n = o.name
    if n.startswith(("Door_", "DoorRig_")) and not n.endswith("_Frame"):
        base = n.split("_", 1)[1]
        for suf in ("_L", "_R"):
            if base.endswith(suf):
                base = base[: -len(suf)]
        if base in _ext_doors():
            return "exterior"
        return base.split("_")[0]
    if n.startswith("COL_"):
        src = bpy.data.objects.get(n[4:])
        if src is not None and src is not o:
            return _part_of(src)
        if n.startswith("COL_Win_"):
            return "exterior"
        if n == "COL_MainStair":
            return "G"
        if n == "COL_TopStair":
            return "L1"
    if n.startswith(("Lamp_", "Sound_")):
        return _point_part(o.matrix_world.translation)
    if any(p.startswith(("House/Exterior", "House/Structure/Foundation")) for p in paths):
        return "exterior"
    if n.startswith("Structure_"):
        return n.split("_")[1]
    for p in paths:
        if p.startswith("House/Furniture/"):
            room = p.split("/")[2]
            if room == "Porch":
                return "exterior"
            r = next((rr for rr in P.ROOMS if rr["name"] == room), None)
            if r is not None:
                return ["G", "L1", "L2"][r["level"]]
    if o.type == "MESH":
        z = min((o.matrix_world @ Vector(c)).z for c in o.bound_box)
        return _level_tag(z)
    return _level_tag(o.matrix_world.translation.z)


def parts():
    out = {"exterior": [], "G": [], "L1": [], "L2": []}
    for o in bpy.data.objects:
        if o.type not in ("MESH", "EMPTY"):
            continue
        k = _part_of(o)
        if k in out:
            out[k].append(o)
    return out


def export_parts():
    os.makedirs(OUT, exist_ok=True)
    made = make_export_materials()
    # swap every exported mesh's slots for the baked versions (mesh data is shared by instances)
    swaps = []
    seen = set()
    for o in bpy.data.objects:
        if o.type != "MESH" or _part_of(o) is None or o.data.name in seen:
            continue
        seen.add(o.data.name)
        for i, m in enumerate(o.data.materials):
            if m is not None and m.name in made:
                swaps.append((o.data, i, m))
                o.data.materials[i] = made[m.name]
    files = {}
    # the collision proxies sit in a viewport-hidden collection: show it while selecting
    from . import core
    lc = core._layer_coll(bpy.context.view_layer.layer_collection, core.coll("House/Engine/Collision").name)
    was_hidden = lc.hide_viewport if lc else False
    if lc:
        lc.hide_viewport = False
    try:
        groups = parts()
        vl = bpy.context.view_layer
        hidden = []
        for k, objs in groups.items():
            for o in bpy.context.selected_objects:
                o.select_set(False)
            for o in objs:
                if o.name not in vl.objects:
                    continue
                if o.hide_get():
                    o.hide_set(False)
                    hidden.append(o)
                o.select_set(True)
            path = os.path.join(OUT, f"house_{k}.gltf")
            bpy.ops.export_scene.gltf(
                filepath=path, export_format="GLTF_SEPARATE", export_texture_dir="", use_selection=True, export_extras=True, export_yup=True,
                export_apply=False, export_texcoords=True, export_normals=True, export_tangents=False,
                export_materials="EXPORT", export_image_format="AUTO", export_cameras=False, export_lights=False,
                export_animations=False, export_skins=False, export_morph=False)
            files[k] = path
        for o in hidden:
            o.hide_set(True)
    finally:
        for me, i, m in swaps:
            me.materials[i] = m
        if lc:
            lc.hide_viewport = was_hidden
    return files


# ---------------------------------------------------------------- 3. pack

def rgb9e5(rgb):
    """Pack linear RGB (h, w, 3) float into RGB9E5 uint32 (WebGPU rgb9e5ufloat)."""
    N, B, EMAX = 9, 15, 31
    maxv = ((1 << N) - 1) / (1 << N) * 2.0 ** (EMAX - B)
    c = np.clip(np.nan_to_num(rgb), 0, maxv).astype(np.float64)
    m = c.max(-1)
    e = np.maximum(-B - 1, np.floor(np.log2(np.maximum(m, 1e-30)))) + 1 + B
    d = np.power(2.0, e - B - N)
    mm = np.floor(m / d + 0.5)
    e = np.where(mm == (1 << N), e + 1, e)
    d = np.power(2.0, e - B - N)
    q = np.clip(np.floor(c / d[..., None] + 0.5), 0, (1 << N) - 1).astype(np.uint32)
    return (q[..., 0] | (q[..., 1] << 9) | (q[..., 2] << 18) | (e.astype(np.uint32) << 27)).astype("<u4")


def _load_exr(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    bpy.data.images.remove(img)
    return px


def _half(px):
    h, w = px.shape[:2]
    return px.reshape(h // 2, 2, w // 2, 2, 3).mean((1, 3))


def pack(lm_max=2048):
    os.makedirs(ASSETS, exist_ok=True)
    man = json.load(open(os.path.join(BAKE, "bake.json")))
    entries = []
    blobs = []

    def add(name, kind, data, **meta):
        entries.append({"name": name, "type": kind, "length": len(data), **meta})
        blobs.append(data)

    # each part is a .gltf (JSON) + .bin; its images are pack entries named by their uri, stored once
    # and shared between parts (a loader maps a uri to its byte range)
    images = []
    for k in ("exterior", "G", "L1", "L2"):
        with open(os.path.join(OUT, f"house_{k}.gltf"), "rb") as f:
            gl = f.read()
        doc = json.loads(gl)
        add(f"house_{k}.gltf", "gltf", gl, part=k)
        for b in doc.get("buffers", []):
            with open(os.path.join(OUT, b["uri"]), "rb") as f:
                add(b["uri"], "bin", f.read(), part=k)
        for im in doc.get("images", []):
            if im["uri"] not in images:
                images.append(im["uri"])
    for uri in images:
        with open(os.path.join(OUT, uri), "rb") as f:
            add(uri, "image", f.read(), mime="image/jpeg" if uri.lower().endswith((".jpg", ".jpeg")) else "image/png")
    for tag, info in man["lightmaps"].items():
        px = _load_exr(os.path.join(BAKE, info["file"]))
        while px.shape[0] > lm_max:
            px = _half(px)
        # Blender images run bottom row first; the pack stores rows top first (as GPU uploads expect),
        # with V flipped the same way as glTF's UVs (v_gltf = 1 - v_blender)
        px = px[::-1]
        add(tag, "texture", rgb9e5(px).tobytes(), format="rgb9e5ufloat", width=px.shape[1], height=px.shape[0],
            uv=1, encoding="linear radiance of a white Lambertian surface (shade albedo x lightmap)")
    with open(os.path.join(BAKE, "probes.bin"), "rb") as f:
        pr = man["probes"]
        add("probes", "sh9", f.read(), count=len(pr["points"]), layout=pr["layout"], spacing=pr["spacing"],
            points=[[*q["p"], q["level"], int(q["valid"])] for q in pr["points"]],
            point_fields="x, y, z (house frame), level, valid", rooms=[q["room"] for q in pr["points"]])
    for r in man["reflections"]:
        px = _load_exr(os.path.join(BAKE, r["file"]))[::-1]
        add(f"refl_{r['room']}", "texture", rgb9e5(px).tobytes(), format="rgb9e5ufloat", width=px.shape[1],
            height=px.shape[0], projection="equirect (Cycles: u = -atan2(y, x)/2pi + 0.5, top row up)",
            room=r["room"], level=r["level"], position=r["position"], box=r["box"])
    index = {
        "version": 1,
        "asset": "Dyson City house (city_plan.md step 1)",
        "units": man["units"],
        "frame": "house frame in metres, glTF axes (+Y up); Blender's house frame +X right, +Y back, +Z up "
                 "maps to glTF (x, z, -y): the front faces glTF +Z. Bake data (probe points, reflection "
                 "positions and boxes) is in Blender's house frame.",
        "placement": {"site": man["environment"]["site"], "face": man["environment"]["face"],
                      "note": "place the house origin at HOUSE_SITE on the terrace; rotate about +Y so glTF +Z "
                              "points along `face` (game x, z)"},
        "environment": man["environment"],
        "entries": entries,
    }
    head = json.dumps(index, separators=(",", ":")).encode()
    ALIGN = 256
    pos = 12 + len(head)
    pos = (pos + ALIGN - 1) // ALIGN * ALIGN
    # offsets depend on the index length, which depends on the offsets: fix the index size first
    for e in entries:
        e["offset"] = 0
    for _ in range(3):
        head = json.dumps(index, separators=(",", ":")).encode()
        pos = (12 + len(head) + 64 + ALIGN - 1) // ALIGN * ALIGN
        for e in entries:
            e["offset"] = pos
            pos = (pos + e["length"] + ALIGN - 1) // ALIGN * ALIGN
    head = json.dumps(index, separators=(",", ":")).encode()
    head = head + b" " * ((entries[0]["offset"] - 12) - len(head))
    path = os.path.join(ASSETS, "house.pack")
    with open(path, "wb") as f:
        f.write(b"DCPK")
        f.write((1).to_bytes(4, "little"))
        f.write(len(head).to_bytes(4, "little"))
        f.write(head)
        for e, b in zip(entries, blobs):
            f.seek(e["offset"])
            f.write(b)
        f.truncate(max(e["offset"] + e["length"] for e in entries))
    return path


def run():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, ".gitignore"), "w") as f:
        f.write("*\n")
    bake_materials()
    export_parts()
    return pack()
