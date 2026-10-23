"""The intro ship's cabin light, baked in Cycles under the game's own light (docs/intro-ship.md, "Light").

Run headless (it builds its own scene; no .blend):

    Blender -b --factory-startup --python blender/ship/bake.py -- [all | uvs | trial] [--samples N]

Inputs (blender/bake/ship/, from tools/ship-bake/): `scene.json` + `scene.bin` (the cabin, the door
leaf and the outside as polygons in the ship frame, materials, openings, capture boxes) and
`env_space.hdr`, `env_band.hdr` (the outside light at the ship in scene 1 and on the band, in this
frame). Blender's frame is the ship's (x, −z, y): x forward, −z to port... z up.

Everything is in the game's one radiance scale (docs/world.md): a texel is the outgoing radiance of a
white Lambertian surface there (Cycles DIFFUSE bake, direct + indirect, no colour); the game shades
`albedo × light`. Light adds, so each light set is its own bake and the game sums them:

- interior: the lamps and the screens, the world black;
- space / band: the outside light through the panes, the door shut, the emitters off;
- door: the band's light through the open door alone (the panes black), the leaf slid open.

The door leaf keeps its shut light: slid open, its inner face lies in the fairing's track, out of sight.

What is baked where:
- **Lightmaps** for every chart big enough to hold its light: charts grow over neighbouring faces by
  exact unfolding (a chamfer joins the panels either side, so it is neither a sliver nor a seam),
  within 50° of their seed, never overlapping; packed into one square atlas for the cabin and one for
  the door leaf, at CABIN_BAKE.texel.
- **Corners** for the rest (fittings, knobs, the trim's slivers): the light baked at each face corner
  (a float colour attribute), with the corner's own normal.
- Faces nothing can see (pressed against the hull or another part) are left out of the atlas.
- **Reflection captures**: an equirect of each set from each capture point, the outside black (the
  game reads the live outside along rays that leave through an opening).

Clean lightmaps (blender/build/bake.py, the house, found how): two half-sample bakes with independent
seeds, filled (push-pull) over invalid texels and margins, denoised (OIDN guided by normals) and
QA'd by their difference. Portals in every opening sample the sky where the light comes in.
Checkpoints: each pass bakes in CHUNK-sample chunks into bake/ship/raw/; create bake/ship/STOP to stop
after the current chunk; the same call resumes.
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from build.bake import _image, _masks, _pixels, denoise, push_pull, qa  # noqa: E402

ROOT = os.path.join(os.path.dirname(HERE), "bake", "ship")
OUT = os.path.join(ROOT, "out")
RAW = os.path.join(ROOT, "raw")
STOP = os.path.join(ROOT, "STOP")

CABIN_SETS = ("interior", "space", "band", "door")
LEAF_SETS = ("interior", "space", "band")
# Samples per half (two halves with independent seeds per lightmap set). The cabin is small: every
# texel can afford what the house's worst floor had.
SAMPLES = {"interior": 8192, "space": 8192, "band": 8192, "door": 8192}
CORNER_SAMPLES = 8192
CAPTURE_SAMPLES = 1024
CAPTURE_RES = (512, 256)
CHUNK = 1024
QA_LIMITS = {"block_p99": 0.10, "block_mean": 0.03}
# Charting.
CHART_ANGLE = math.radians(50)
HIDDEN_REACH = 0.03        # m: a face whose rays all meet a surface this close is pressed against it
HIDDEN_SHARE = 0.95
SEEN_SPACING = 0.35        # m: the cabin's air sampled for what can be seen from it
SEEN_RAYS = 3000


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


# ---------------------------------------------------------------- the scene

def read_scene():
    with open(os.path.join(ROOT, "scene.json")) as f:
        sc = json.load(f)
    raw = open(os.path.join(ROOT, "scene.bin"), "rb").read()
    types = {"Float32Array": np.float32, "Uint32Array": np.uint32, "Uint8Array": np.uint8}

    def arr(name):
        e = sc["entries"][name]
        return np.frombuffer(raw, dtype=types[e["type"]], count=e["length"], offset=e["offset"])
    return sc, arr


def to_b(a):
    """Ship frame (x, y, z) → Blender (x, −z, y), for an (..., 3) array."""
    a = np.asarray(a, np.float64)
    return np.stack([a[..., 0], -a[..., 2], a[..., 1]], -1)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def materials(sc):
    """One material per slot: its finish, and its glow on an Emission strength the sets switch.

    While baking, the surface being baked shades as white diffuse (its camera ray, which in a bake
    starts on it): a DIFFUSE bake measures light through the diffuse response, and a metal has none
    (the rib frames baked black). Every bounce and every light sees the real finish."""
    out = []
    for s in sc["slots"]:
        m = bpy.data.materials.new(f"S{s['slot']:02d}_{s['name']}")
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*s["albedo"], 1.0)
        bsdf.inputs["Roughness"].default_value = s["roughness"]
        bsdf.inputs["Metallic"].default_value = s["metalness"]
        if s["glow"]:
            bsdf.inputs["Emission Color"].default_value = (*s["glow"], 1.0)
            bsdf.inputs["Emission Strength"].default_value = 1.0
            m["glow"] = 1
        lp = nt.nodes.new("ShaderNodeLightPath")
        on = nt.nodes.new("ShaderNodeValue")
        on.name = "baking"
        on.outputs[0].default_value = 0.0
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        white = nt.nodes.new("ShaderNodeBsdfDiffuse")
        white.inputs["Color"].default_value = (1, 1, 1, 1)
        mix = nt.nodes.new("ShaderNodeMixShader")
        out_node = nt.nodes["Material Output"]
        nt.links.new(lp.outputs["Is Camera Ray"], mul.inputs[0])
        nt.links.new(on.outputs[0], mul.inputs[1])
        nt.links.new(mul.outputs[0], mix.inputs["Fac"])
        nt.links.new(bsdf.outputs[0], mix.inputs[1])
        nt.links.new(white.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out_node.inputs["Surface"])
        out.append(m)
    return out


def build_object(sc, arr, name, mats):
    verts = to_b(arr(f"{name}.verts").reshape(-1, 3))
    starts = arr(f"{name}.starts").astype(np.int64)
    corners = arr(f"{name}.corners").astype(np.int64)
    slots = arr(f"{name}.slots").astype(np.int64)
    nrm = to_b(arr(f"{name}.normals").reshape(-1, 3))
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.astype(np.float32).ravel())
    me.loops.add(len(corners))
    me.loops.foreach_set("vertex_index", corners.astype(np.int32))
    me.polygons.add(len(slots))
    me.polygons.foreach_set("loop_start", starts[:-1].astype(np.int32))
    for m in mats:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", slots.astype(np.int32))
    me.update(calc_edges=True)
    if len(me.polygons) != len(slots) or len(me.loops) != len(corners):
        raise RuntimeError(f"{name}: Blender changed the mesh ({len(me.polygons)} faces, {len(me.loops)} corners)")
    me.normals_split_custom_set(nrm.astype(np.float32).tolist())
    me.uv_layers.new(name="UVMap")
    me.uv_layers.new(name="Lightmap")
    me.uv_layers.active = me.uv_layers["UVMap"]
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def opening_mesh(name, outline, mat):
    pts = to_b(np.array(outline))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in pts], [], [list(range(len(pts)))])
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def portal(o):
    """A portal over an opening, facing in: the sky is sampled through it."""
    pts = to_b(np.array(o["outline"]))
    n = to_b(np.array(o["n"]))
    c = pts.mean(0)
    u = pts[1] - pts[0]
    u = u - n * np.dot(u, n)
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    su = np.ptp(pts @ u) + 0.1
    sv = np.ptp(pts @ v) + 0.1
    ld = bpy.data.lights.new("P_" + o["name"], "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = su, sv
    ld.cycles.is_portal = True
    lo = bpy.data.objects.new("P_" + o["name"], ld)
    # The light shines along its −Z: −Z is into the cabin (−n), so Z = n.
    from mathutils import Matrix
    lo.matrix_world = Matrix(((u[0], v[0], n[0], c[0]), (u[1], v[1], n[1], c[1]), (u[2], v[2], n[2], c[2]), (0, 0, 0, 1)))
    bpy.context.scene.collection.objects.link(lo)
    return lo


def world():
    w = bpy.data.worlds.new("Outside")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexEnvironment")
    tex.name = "env"
    tex.interpolation = "Linear"
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.name = "bg"
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.name = "camera"
    mix.inputs["Color2"].default_value = (0, 0, 0, 1)
    mix.inputs["Fac"].default_value = 0.0
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(tex.outputs["Color"], mix.inputs["Color1"])
    nt.links.new(mix.outputs[0], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs[0])
    w["lightpath"] = lp.name
    return w


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    backend = "METAL" if sys.platform == "darwin" else "OPTIX"
    prefs.compute_device_type = backend
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == backend
    if not any(d.use for d in prefs.devices):
        raise RuntimeError(f"no {backend} device to bake on")
    sc.cycles.device = "GPU"
    sc.cycles.use_light_tree = True
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 6
    sc.cycles.glossy_bounces = 3
    sc.cycles.transparent_max_bounces = 16
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    # The star through a pane is ~10 on this scale; a cabin wall ~0.01–0.5. A bounce off the star
    # itself is out of reach (it is behind the glass), so the clamp only bounds fireflies.
    sc.cycles.sample_clamp_indirect = 2.0
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.light_sampling_threshold = 0.0
    sc.cycles.use_animated_seed = False
    sc.render.use_persistent_data = True
    sc.render.bake.target = "IMAGE_TEXTURES"
    sc.view_settings.view_transform = "Standard"


class Scene:
    def __init__(self):
        reset()
        setup_render()
        sc, arr = read_scene()
        self.sc = sc
        self.mats = materials(sc)
        self.cabin = build_object(sc, arr, "cabin", self.mats)
        self.leaf = build_object(sc, arr, "leaf", self.mats)
        self.outside = build_object(sc, arr, "outside", self.mats)
        self.leaf_slots = arr("leaf.slots").astype(np.int64)
        self.cabin_slot = np.array([s["cabin"] for s in sc["slots"]], bool)
        self.leaf_open = Vector(to_b(np.array(sc["leafOpen"])))
        glass = bpy.data.materials.new("glass")
        glass.use_nodes = True
        nt = glass.node_tree
        nt.nodes.remove(nt.nodes["Principled BSDF"])
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        t = sc["glass"]["transmission"]
        tr.inputs["Color"].default_value = (t, t, t, 1)
        nt.links.new(tr.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
        black = bpy.data.materials.new("blocked")
        black.use_nodes = True
        black.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0, 0, 0, 1)
        black.node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.0
        self.glass, self.blocked = glass, black
        self.panes = [opening_mesh("G_" + o["name"], o["outline"], glass) for o in sc["openings"] if o["kind"] == "pane"]
        self.portals = {o["name"]: (o["kind"], portal(o)) for o in sc["openings"]}
        self.world = world()
        self.env = {}
        for name in ("space", "band"):
            img = bpy.data.images.load(os.path.join(ROOT, f"env_{name}.hdr"), check_existing=True)
            img.colorspace_settings.name = "Non-Color"
            self.env[name] = img

    def baking(self, on):
        """The baked surfaces as white diffuse (materials()); off for renders and captures."""
        for m in self.mats:
            m.node_tree.nodes["baking"].outputs[0].default_value = 1.0 if on else 0.0

    def lighting(self, which, camera_black=False):
        """Configures one light set (module doc)."""
        nt = self.world.node_tree
        env = {"interior": None, "space": "space", "band": "band", "door": "band"}[which]
        nt.nodes["bg"].inputs["Strength"].default_value = 0.0 if env is None else 1.0
        if env:
            nt.nodes["env"].image = self.env[env]
        # Camera rays see the outside black (captures: the game reads the live outside there).
        mix = nt.nodes["camera"]
        lp = nt.nodes[self.world["lightpath"]]
        for link in list(mix.inputs["Fac"].links):
            nt.links.remove(link)
        if camera_black:
            nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
        glow = which == "interior"
        for m in self.mats:
            if m.get("glow"):
                m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.0 if glow else 0.0
        for p in self.panes:
            p.data.materials[0] = self.blocked if which == "door" else self.glass
        self.leaf.location = self.leaf_open if which == "door" else Vector((0, 0, 0))
        for name, (kind, lo) in self.portals.items():
            if env is None:
                lo.hide_render = True
            elif which == "door":
                lo.hide_render = kind != "door"
            else:
                lo.hide_render = kind != "pane"
        bpy.context.view_layer.update()


# ---------------------------------------------------------------- what nothing sees

def face_data(ob):
    me = ob.data
    nf = len(me.polygons)
    starts = np.empty(nf, np.int64)
    totals = np.empty(nf, np.int64)
    me.polygons.foreach_get("loop_start", starts)
    me.polygons.foreach_get("loop_total", totals)
    vi = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", vi)
    co = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3) + np.array(ob.location)
    nrm = np.empty(nf * 3, np.float64)
    me.polygons.foreach_get("normal", nrm)
    area = np.empty(nf, np.float64)
    me.polygons.foreach_get("area", area)
    mat = np.empty(nf, np.int64)
    me.polygons.foreach_get("material_index", mat)
    return {"starts": starts, "totals": totals, "vi": vi, "co": co, "n": nrm.reshape(-1, 3), "area": area, "slot": mat}


def _scene_tree(scene):
    """One BVH over the cabin, the leaf and the outside; and each object's first polygon in it."""
    verts, polys, base = [], [], {}
    for o in (scene.cabin, scene.leaf, scene.outside):
        d = face_data(o)
        base[o.name] = len(polys)
        v0 = len(verts)
        verts.extend(map(tuple, d["co"]))
        for s, t in zip(d["starts"], d["totals"]):
            polys.append([v0 + int(k) for k in d["vi"][s:s + t]])
    return BVHTree.FromPolygons(verts, polys), base, len(polys)


def seen_faces(scene, tree, total):
    """Polygons the cabin's air sees (front faces hit by rays from points through the capture boxes,
    clear of the walls): everything else (the hull's skin round the engine bay, behind the liners) is
    never in view."""
    rng = np.random.default_rng(11)
    d = rng.normal(size=(SEEN_RAYS, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    dirs = [Vector(x) for x in d]
    seen = np.zeros(total, bool)
    for c in scene.sc["captures"]:
        lo, hi = np.array(c["min"]), np.array(c["max"])
        xs = np.arange(lo[0] + 0.15, hi[0] - 0.15, SEEN_SPACING)
        ys = np.arange(lo[1] + 0.15, hi[1] - 0.25, SEEN_SPACING)
        zs = np.arange(-2.0, 2.0 + 1e-6, SEEN_SPACING)
        for x in xs:
            for y in ys:
                for z in zs:
                    o = Vector(to_b(np.array([x, y, z])))
                    for dv in dirs:
                        loc, n, i, dist = tree.ray_cast(o, dv)
                        if i is not None and n.dot(dv) < 0:
                            seen[i] = True
    return seen


def hidden_faces(scene, ob, fd, keep):
    """Faces out of the cabin's sight (`seen_faces`), and faces whose rays (HIDDEN_SHARE of them)
    meet a surface within HIDDEN_REACH: pressed against something."""
    tree, base, total = _scene_tree(scene)
    if not hasattr(scene, "_seen"):
        t0 = time.time()
        scene._seen = seen_faces(scene, tree, total)
        log(f"seen from the cabin: {int(scene._seen.sum())} of {total} faces ({time.time() - t0:.0f} s)")
    seen = scene._seen[base[ob.name]:base[ob.name] + len(fd["starts"])]
    rng = np.random.default_rng(7)
    K = 16
    u = rng.random((K, 2))
    r = np.sqrt(u[:, 0])
    phi = 2 * np.pi * u[:, 1]
    hemi = np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1 - u[:, 0])], -1)
    out = np.zeros(len(fd["starts"]), bool)
    for f in np.nonzero(keep)[0]:
        s, t = fd["starts"][f], fd["totals"][f]
        pts = fd["co"][fd["vi"][s:s + t]]
        n = fd["n"][f]
        c = pts.mean(0)
        a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
        tu = np.cross(n, a)
        tu /= np.linalg.norm(tu)
        tv = np.cross(n, tu)
        if not seen[f] and fd["area"][f] > 1e-4:
            out[f] = True
            continue
        samples = [c] + [c + 0.7 * (p - c) for p in pts[:: max(1, t // 4)][:4]]
        dirs = [Vector(tu * h[0] + tv * h[1] + n * h[2]) for h in hemi]
        allowed = int((1 - HIDDEN_SHARE) * len(samples) * K)
        miss = 0
        for q in samples:
            o = Vector(q + n * 0.002)
            for d in dirs:
                if tree.ray_cast(o, d, HIDDEN_REACH)[0] is None:
                    miss += 1
                    if miss > allowed:
                        break
            if miss > allowed:
                break
        out[f] = miss <= allowed
    return out


# ---------------------------------------------------------------- charts

def _frame(n):
    a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(a, n)
    u /= np.linalg.norm(u)
    return u, np.cross(n, u)


def _tri_overlap(a, b, eps=1e-6):
    """Two 2D triangles (3 × 2) overlap in their interiors (separating axes, shrunk by eps)."""
    for P, Q in ((a, b), (b, a)):
        for i in range(3):
            e = P[(i + 1) % 3] - P[i]
            ax = np.array([-e[1], e[0]])
            pa = P @ ax
            qa_ = Q @ ax
            if pa.max() <= qa_.min() + eps * np.linalg.norm(ax) or qa_.max() <= pa.min() + eps * np.linalg.norm(ax):
                return False
    return True


def charts(fd, usable):
    """Grows charts over usable faces by exact unfolding (module doc). Returns per face its chart id
    (−1 not charted) and per corner its chart-plane 2D position (m)."""
    starts, totals, vi, co, nrm, area = fd["starts"], fd["totals"], fd["vi"], fd["co"], fd["n"], fd["area"]
    nf = len(starts)
    edges = {}
    for f in np.nonzero(usable)[0]:
        s, t = starts[f], totals[f]
        for k in range(t):
            a, b = vi[s + k], vi[s + (k + 1) % t]
            edges.setdefault((min(a, b), max(a, b)), []).append(f)
    chart = -np.ones(nf, np.int64)
    uv2 = np.zeros((len(vi), 2), np.float64)
    cos_lim = math.cos(CHART_ANGLE)
    nid = 0
    for seed in np.argsort(-area):
        if not usable[seed] or chart[seed] >= 0:
            continue
        n0 = nrm[seed]
        tris = []
        boxes = []

        def tris_of(c2):
            return [np.array([c2[0], c2[i], c2[i + 1]]) for i in range(1, len(c2) - 1)]

        def add(f, c2):
            chart[f] = nid
            s, t = starts[f], totals[f]
            uv2[s:s + t] = c2
            for tri in tris_of(c2):
                tris.append(tri)
                boxes.append((*tri.min(0), *tri.max(0)))

        def clashes(c2):
            B = np.array(boxes)
            for tri in tris_of(c2):
                lo, hi = tri.min(0), tri.max(0)
                near = np.nonzero((B[:, 0] < hi[0]) & (B[:, 2] > lo[0]) & (B[:, 1] < hi[1]) & (B[:, 3] > lo[1]))[0]
                for i in near:
                    if _tri_overlap(tri, tris[i]):
                        return True
            return False

        u, v = _frame(n0)
        s, t = starts[seed], totals[seed]
        p = co[vi[s:s + t]]
        add(seed, np.stack([p @ u, p @ v], -1))
        queue = [seed]
        while queue:
            f = queue.pop()
            s, t = starts[f], totals[f]
            for k in range(t):
                a, b = vi[s + k], vi[s + (k + 1) % t]
                fa, fb = uv2[s + k], uv2[s + (k + 1) % t]
                for g in edges.get((min(a, b), max(a, b)), ()):
                    if g == f or chart[g] >= 0 or not usable[g]:
                        continue
                    if nrm[g] @ n0 < cos_lim or nrm[g] @ nrm[f] < cos_lim:
                        continue
                    gs, gt = starts[g], totals[g]
                    ids = list(vi[gs:gs + gt])
                    if a not in ids or b not in ids:
                        continue
                    gu, gv = _frame(nrm[g])
                    q = co[vi[gs:gs + gt]]
                    l2 = np.stack([q @ gu, q @ gv], -1)
                    ia, ib = ids.index(a), ids.index(b)
                    d0 = l2[ib] - l2[ia]
                    d1 = fb - fa
                    ang = math.atan2(d1[1], d1[0]) - math.atan2(d0[1], d0[0])
                    R = np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]])
                    c2 = (l2 - l2[ia]) @ R.T + fa
                    if clashes(c2):
                        continue
                    add(g, c2)
                    queue.append(g)
        nid += 1
    return chart, uv2, nid


def pack(fd, chart, uv2, n_charts, texel, margin, min_chart, S=None):
    """Each chart turned to its principal axes, scaled to texels and shelf-packed into a square
    atlas (the smallest power of two, or S: None if it does not fit). Returns per-corner atlas UVs
    (0..1, −1 where not lightmapped), the atlas size, the faces kept (charts whose min side is
    ≥ min_chart texels) and the share of the atlas filled."""
    starts, totals = fd["starts"], fd["totals"]
    corner_chart = np.repeat(chart, totals)
    boxes = []
    placed = {}
    for c in range(n_charts):
        sel = corner_chart == c
        p = uv2[sel]
        m = p.mean(0)
        cov = np.cov((p - m).T) if len(p) > 2 else np.eye(2)
        w, V = np.linalg.eigh(cov)
        q = (p - m) @ V[:, ::-1]
        lo, hi = q.min(0), q.max(0)
        size = (hi - lo) / texel
        if size.min() < min_chart:
            continue
        # The longer side across: shelves are as tall as their tallest chart.
        if size[1] > size[0]:
            q = q[:, ::-1]
            lo, hi, size = lo[::-1], hi[::-1], size[::-1]
        placed[c] = (q - lo) / texel
        boxes.append((c, int(math.ceil(size[0])) + margin, int(math.ceil(size[1])) + margin))
    total = sum(w * h for _, w, h in boxes)
    fixed = S is not None
    S = S or 1 << max(6, math.ceil(math.log2(math.sqrt(total / 0.8))))
    order = sorted(boxes, key=lambda b: -b[2])
    while True:
        x = y = margin
        shelf = 0
        offs = {}
        ok = True
        for c, w, h in order:
            if x + w > S:
                x = margin
                y += shelf
                shelf = 0
            if y + h > S or w > S:
                ok = False
                break
            offs[c] = (x, y)
            x += w
            shelf = max(shelf, h)
        if ok:
            break
        if fixed:
            return None
        S *= 2
    uv = -np.ones((len(uv2), 2), np.float64)
    for c, (ox, oy) in offs.items():
        sel = np.nonzero(corner_chart == c)[0]
        uv[sel] = (placed[c] + np.array([ox, oy]) + margin / 2) / S
    kept = np.zeros(len(starts), bool)
    kept[[f for f in range(len(starts)) if chart[f] in offs]] = True
    return uv, S, kept, total / (S * S)


def chart_object(scene, ob, keep_slots):
    """Lightmap UVs for an object's faces in keep_slots (the rest collapse to a point)."""
    fd = face_data(ob)
    keep = keep_slots[fd["slot"]]
    t0 = time.time()
    hidden = hidden_faces(scene, ob, fd, keep)
    log(f"{ob.name}: {int(keep.sum())} faces, {int(hidden.sum())} hidden ({time.time() - t0:.0f} s)")
    t0 = time.time()
    usable = keep & ~hidden
    chart, uv2, n = charts(fd, usable)
    B = scene.sc["bake"]
    uv, S, kept, fill = pack(fd, chart, uv2, n, B["texel"], B["margin"], B["minChart"])
    # The atlas a power of two: its spare room spent on resolution (the finest texel that still fits).
    texel = B["texel"]
    lo, hi = B["texel"] * 0.5, B["texel"]
    for _ in range(10):
        mid = (lo + hi) / 2
        r = pack(fd, chart, uv2, n, mid, B["margin"], B["minChart"], S)
        if r is None:
            lo = mid
        else:
            hi = mid
            uv, _, kept, fill = r
            texel = mid
    log(f"{ob.name}: {n} charts, {int(kept.sum())} faces lightmapped in {S}² at {texel * 100:.2f} cm ({fill:.0%} filled) ({time.time() - t0:.0f} s)")
    lm = np.where(uv[:, :1] >= 0, uv, 0.0001)
    ob.data.uv_layers["Lightmap"].data.foreach_set("uv", lm.astype(np.float32).ravel())
    return {"uv": uv, "size": S, "texel": texel, "lightmapped": kept, "hidden": hidden, "keep": keep, "fd": fd}


# ---------------------------------------------------------------- baking

def _seed(*k):
    import zlib
    return zlib.crc32(repr(k).encode()) % 2_147_483_647


def _bake(objs, img, kind="DIFFUSE", target="IMAGE_TEXTURES", **kw):
    sc = bpy.context.scene
    nodes = []
    if target == "IMAGE_TEXTURES":
        for m in {m for o in objs for m in o.data.materials if m}:
            n = m.node_tree.nodes.new("ShaderNodeTexImage")
            n.image = img
            m.node_tree.nodes.active = n
            nodes.append((m, n))
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["Lightmap"]
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    sc.render.bake.target = target
    try:
        bpy.ops.object.bake(type=kind, margin=0, use_clear=True, target=target, pass_filter={"DIRECT", "INDIRECT"}, **kw)
    finally:
        for o in objs:
            o.data.uv_layers.active = o.data.uv_layers["UVMap"]
        for m, n in nodes:
            m.node_tree.nodes.remove(n)


def _checkpoint(name):
    path = os.path.join(RAW, name + ".npz")
    if not os.path.exists(path):
        return None, 0
    z = np.load(path)
    return z["light"], int(z["n"])


def _save(name, light, n):
    os.makedirs(RAW, exist_ok=True)
    tmp = os.path.join(RAW, name + ".tmp.npz")
    np.savez(tmp, light=light, n=n)
    os.replace(tmp, os.path.join(RAW, name + ".npz"))


def _chunks(name, total, run):
    """Accumulates `run(samples, seed)` (an array) up to `total` samples in CHUNK chunks, resumable."""
    acc, done = _checkpoint(name)
    while done < total:
        s = min(CHUNK, total - done)
        px = run(s, _seed(name, done))
        acc = px * s if acc is None else acc + px * s
        done += s
        _save(name, acc, done)
        log(f"{name}: {done}/{total}")
        if os.path.exists(STOP):
            raise SystemExit(f"stopped at {name} {done}/{total} (remove {STOP} and run again to resume)")
    return acc / done


def bake_lightmap(scene, ob, which, size, samples):
    """Two independently seeded halves of a set's lightmap (raw, rows bottom first)."""
    sc = bpy.context.scene
    scene.baking(True)
    img = _image(f"_lm_{ob.name}", size, alpha=True)
    halves = []
    try:
        for h in (0, 1):
            def run(s, seed):
                scene.lighting(which)
                sc.cycles.samples = s
                sc.cycles.seed = seed
                _bake([ob], img)
                return _pixels(img)[..., :3].astype(np.float64)
            halves.append(_chunks(f"lm_{ob.name}_{which}_{h}", samples // 2, run).astype(np.float32))
    finally:
        bpy.data.images.remove(img)
    return halves


def finish_lightmap(name, halves, covered, valid, Nf):
    """The denoised mean of both halves; each half denoised alone for the QA."""
    wv = valid.astype(np.float32)
    D = []
    for i, L in enumerate([(halves[0] + halves[1]) / 2] + halves):
        tmp = os.path.join(RAW, f"_{name}_dn{i}.exr")
        denoise(push_pull(L, wv), Nf, tmp)
        img = bpy.data.images.load(tmp, check_existing=False)
        D.append(_pixels(img)[..., :3].copy())
        bpy.data.images.remove(img)
        os.remove(tmp)
    return D[0], qa(D[1], D[2], valid)


def bake_corners(scene, objs, which, samples):
    """The light at every face corner of `objs` (float colour attribute, corner domain)."""
    sc = bpy.context.scene
    scene.baking(True)
    for o in objs:
        me = o.data
        if "Bake" not in me.color_attributes:
            me.color_attributes.new("Bake", "FLOAT_COLOR", "CORNER")
        me.color_attributes.active_color = me.color_attributes["Bake"]
    out = {}
    for o in objs:
        def run(s, seed, o=o):
            scene.lighting(which)
            sc.cycles.samples = s
            sc.cycles.seed = seed
            _bake([o], None, target="VERTEX_COLORS")
            a = np.empty(len(o.data.loops) * 4, np.float32)
            o.data.color_attributes["Bake"].data.foreach_get("color", a)
            return a.reshape(-1, 4)[:, :3].astype(np.float64)
        out[o.name] = _chunks(f"vx_{o.name}_{which}", samples, run).astype(np.float32)
    return out


AO_DISTANCE = 0.35          # m: the reach of the specular occlusion (a pocket under the dash, a seam)
AO_SAMPLES = 512


def bake_ao(scene, ob, size, samples=AO_SAMPLES):
    """Short-range ambient occlusion: the lightmap (raw, rows bottom first) and the corners."""
    sc = bpy.context.scene
    sc.world.light_settings.distance = AO_DISTANCE
    scene.lighting("interior")
    img = _image(f"_ao_{ob.name}", size, alpha=True)
    try:
        sc.cycles.samples = samples
        sc.cycles.seed = 3
        _bake([ob], img, kind="AO")
        lm = _pixels(img)[..., :3].copy()
    finally:
        bpy.data.images.remove(img)
    me = ob.data
    if "Bake" not in me.color_attributes:
        me.color_attributes.new("Bake", "FLOAT_COLOR", "CORNER")
    me.color_attributes.active_color = me.color_attributes["Bake"]
    _bake([ob], None, kind="AO", target="VERTEX_COLORS")
    a = np.empty(len(me.loops) * 4, np.float32)
    me.color_attributes["Bake"].data.foreach_get("color", a)
    return lm, a.reshape(-1, 4)[:, :3].copy()


def bake_captures(scene, which, samples):
    from build.bake import _pano_camera, _render_equirect
    cam = _pano_camera(CAPTURE_RES)
    sc = bpy.context.scene
    sc.cycles.seed = 0
    scene.lighting(which, camera_black=True)
    scene.baking(False)
    out = {}
    for c in scene.sc["captures"]:
        tmp = os.path.join(RAW, f"_cap_{which}_{c['name']}.exr")
        out[c["name"]] = _render_equirect(cam, Vector(to_b(np.array(c["position"]))), samples, True, tmp)
        os.remove(tmp)
    return out


# ---------------------------------------------------------------- the whole bake

def run(samples=None, corner_samples=CORNER_SAMPLES, capture_samples=CAPTURE_SAMPLES, tag="final"):
    t_start = time.time()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(RAW, exist_ok=True)
    scene = Scene()
    sets = {"cabin": CABIN_SETS, "leaf": LEAF_SETS}
    samples = samples or SAMPLES
    meta = {"tag": tag, "fingerprint": scene.sc["fingerprint"], "texel": scene.sc["bake"]["texel"], "objects": {}, "samples": samples,
            "cornerSamples": corner_samples, "captureSamples": capture_samples, "captures": scene.sc["captures"]}
    charted = {}
    for ob, keep in ((scene.cabin, scene.cabin_slot), (scene.leaf, scene.cabin_slot)):
        ch = chart_object(scene, ob, keep)
        charted[ob.name] = ch
        np.save(os.path.join(OUT, f"uv_{ob.name}.npy"), ch["uv"].astype(np.float32))
    for ob in (scene.cabin, scene.leaf):
        ch = charted[ob.name]
        S = ch["size"]
        bpy.context.scene.world.light_settings.distance = 0.05
        covered, valid, Nf = _masks([ob], S)
        entry = {"atlas": S, "texel": ch["texel"], "sets": list(sets[ob.name]), "qa": {},
                 "faces": int(ch["keep"].sum()), "lightmapped": int(ch["lightmapped"].sum()), "hidden": int(ch["hidden"].sum())}
        for which in sets[ob.name]:
            halves = bake_lightmap(scene, ob, which, S, samples[which])
            F, q = finish_lightmap(f"{ob.name}_{which}", halves, covered, valid, Nf)
            entry["qa"][which] = q
            np.save(os.path.join(OUT, f"lm_{ob.name}_{which}.npy"), F.astype(np.float32))
            log(f"lm {ob.name} {which}: {q}")
        ao, vao = bake_ao(scene, ob, S)
        F, _ = finish_lightmap(f"{ob.name}_ao", [ao, ao], covered, valid, Nf)
        np.save(os.path.join(OUT, f"lm_{ob.name}_ao.npy"), np.clip(F, 0, 1).astype(np.float32))
        np.save(os.path.join(OUT, f"vx_{ob.name}_ao.npy"), vao.astype(np.float32))
        log(f"ao {ob.name}")
        meta["objects"][ob.name] = entry
    for which in sorted(set(CABIN_SETS) | set(LEAF_SETS)):
        objs = [o for o in (scene.cabin, scene.leaf) if which in sets[o.name]]
        for name, a in bake_corners(scene, objs, which, corner_samples).items():
            np.save(os.path.join(OUT, f"vx_{name}_{which}.npy"), a)
    for which in CABIN_SETS:
        for name, px in bake_captures(scene, which, capture_samples).items():
            np.save(os.path.join(OUT, f"cap_{which}_{name}.npy"), px.astype(np.float32))
        log(f"captures {which}")
    meta["seconds"] = time.time() - t_start
    meta["failures"] = {f"{o}/{s}": q for o, e in meta["objects"].items() for s, q in e["qa"].items()
                        if q["block_p99"] > QA_LIMITS["block_p99"] or q["block_mean"] > QA_LIMITS["block_mean"]}
    meta["limits"] = QA_LIMITS
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    log(f"done in {meta['seconds'] / 60:.1f} min; QA failures: {meta['failures'] or 'none'}")


def uvs_only():
    """Charts and packs only, with a checker preview of the atlas (raw/atlas_<object>.png)."""
    scene = Scene()
    for ob in (scene.cabin, scene.leaf):
        ch = chart_object(scene, ob, scene.cabin_slot)
        S = ch["size"]
        from build.bake import _coverage
        cov = _coverage([ob], S)
        img = bpy.data.images.new(f"atlas_{ob.name}", S, S)
        a = np.concatenate([np.repeat(cov[..., None].astype(np.float32), 3, -1), np.ones((S, S, 1), np.float32)], -1)
        img.pixels.foreach_set(a.ravel())
        os.makedirs(RAW, exist_ok=True)
        img.filepath_raw = os.path.join(RAW, f"atlas_{ob.name}.png")
        img.file_format = "PNG"
        img.save()


def views(spec_path):
    """Ground truth for the game's cabin (tools/ship-bake/compare.mjs): the cabin path-traced from
    cameras in the ship frame, under a scene's whole light (its outside and the interior), at an
    exposure, as the game's HDR view shows it (linear × 2^ev, sRGB, clipped)."""
    with open(spec_path) as f:
        spec = json.load(f)
    scene = Scene()
    sc = bpy.context.scene
    scene.lighting(spec["scene"])
    if spec.get("door"):
        # The door open (scene 3): the leaf slid into its track, the sky sampled through the door too.
        scene.leaf.location = scene.leaf_open
        for kind, lo in scene.portals.values():
            lo.hide_render = False
        bpy.context.view_layer.update()
    # The lamps and the screens too (the game's scene sets hold them).
    for m in scene.mats:
        if m.get("glow"):
            m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.0
    cd = bpy.data.cameras.new("view")
    cam = bpy.data.objects.new("view", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cd.sensor_fit = "VERTICAL"
    cd.angle = math.radians(spec["fov"])
    cd.clip_start = 0.02
    sc.render.resolution_x, sc.render.resolution_y = spec["size"]
    sc.cycles.samples = spec.get("samples", 512)
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = spec["ev"]
    sc.render.image_settings.file_format = "PNG"
    from mathutils import Matrix
    M = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], np.float64)
    for v in spec["views"]:
        R = M @ np.array(v["rotation"]).reshape(3, 3).T   # camera axes (column-major in) into Blender
        p = to_b(np.array(v["position"]))
        cam.matrix_world = Matrix([[*R[0], p[0]], [*R[1], p[1]], [*R[2], p[2]], [0, 0, 0, 1]])
        sc.render.filepath = v["out"]
        bpy.ops.render.render(write_still=True)
        log(f"view {v['out']}")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    cmd = argv[0] if argv else "all"
    if cmd == "views":
        views(argv[1])
    elif cmd == "uvs":
        uvs_only()
    elif cmd == "trial":
        # A quick pass through everything at a fraction of the samples (raw/ kept apart by tag).
        RAW = os.path.join(ROOT, "raw_trial")
        n = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 256
        run(samples={k: n for k in SAMPLES}, corner_samples=n, capture_samples=64, tag="trial")
    else:
        run()
