"""Review renders of the bake as the engine shows it (white albedo: the light alone), headless.

- Lightmapped objects: emission of their floor's `bake/LM_*.exr` on UV `Lightmap`.
- Everything else inside: per-vertex light from `bake/probes.bin`, interpolated as the engine's
  `src/house/probeGrid.ts` does (trilinear over valid probes of the vertex's room, renormalised;
  else the room's nearest valid probe), then the SH cosine convolution / π.
- Glass is transparent onto the capture (`GameLight`); the exterior is a flat grey.

Never saved: run on a freshly loaded house.blend (`render(...)` mutates meshes and materials).
"""
import json
import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import bake as B

FLOORS = (1.05, 5.25, 9.15)
LAYERS = (0.5, 1.4, 2.4)
X0, Y0 = -12.5, -2.5


class Grid:
    def __init__(self, base=None):
        base = base or B.BASE
        man = json.load(open(os.path.join(base, "bake.json")))
        pts = man["probes"]["points"]
        self.P = np.array([p["p"] for p in pts], float)
        self.level = np.array([p["level"] for p in pts], int)
        self.valid = np.array([p["valid"] for p in pts], bool)
        boxes = man["reflections"]
        self.names = list(dict.fromkeys([p["room"] for p in pts] + [b["room"] for b in boxes]))
        rid = {n: i for i, n in enumerate(self.names)}
        self.room = np.array([rid[p["room"]] for p in pts], int)
        self.box = np.array([b["box"] for b in boxes], float)
        self.box_room = np.array([rid[b["room"]] for b in boxes], int)
        self.box_level = np.array([b["level"] for b in boxes], int)
        self.C = np.fromfile(os.path.join(base, "probes.bin"), "<f4").reshape(len(pts), 9, 3)
        ix = np.round(self.P[:, 0] - X0).astype(int)
        iy = np.round(self.P[:, 1] - Y0).astype(int)
        self.nx, self.ny = ix.max() + 1, iy.max() + 1
        lay = np.argmin(np.abs((self.P[:, 2] - np.array(FLOORS)[self.level])[:, None] - np.array(LAYERS)[None]), 1)
        self.cells = -np.ones((3, 3, self.ny, self.nx), int)
        self.cells[self.level, lay, iy, ix] = np.arange(len(pts))

    def room_at(self, q):
        b = self.box
        d = np.max(np.stack([b[None, :, 0] - q[:, None, 0], q[:, None, 0] - b[None, :, 3],
                             b[None, :, 1] - q[:, None, 1], q[:, None, 1] - b[None, :, 4],
                             b[None, :, 2] - q[:, None, 2], q[:, None, 2] - b[None, :, 5]]), 0)
        k = np.argmin(d, 1)
        return self.box_room[k], self.box_level[k]

    def light(self, p, n):
        """White-Lambertian outgoing radiance (RGB) at points p with normals n (Blender house frame)."""
        room, level = self.room_at(p + n * 0.1)
        fz = p[:, 2] - np.array(FLOORS)[level]
        lz = np.where(fz <= LAYERS[0], 0.0, np.where(fz >= LAYERS[2], 2.0, np.where(
            fz < LAYERS[1], (fz - LAYERS[0]) / (LAYERS[1] - LAYERS[0]), 1 + (fz - LAYERS[1]) / (LAYERS[2] - LAYERS[1]))))
        gx, gy = p[:, 0] - X0, p[:, 1] - Y0
        ix, iy = np.floor(gx).astype(int), np.floor(gy).astype(int)
        iz = np.minimum(np.floor(lz).astype(int), 1)
        tx, ty, tz = gx - ix, gy - iy, lz - iz
        acc = np.zeros((len(p), 9, 3))
        ws = np.zeros(len(p))
        for k in range(8):
            cx, cy, cz = ix + (k & 1), iy + ((k >> 1) & 1), iz + ((k >> 2) & 1)
            ok = (cx >= 0) & (cy >= 0) & (cx < self.nx) & (cy < self.ny)
            pi = np.full(len(p), -1)
            pi[ok] = self.cells[level[ok], cz[ok], cy[ok], cx[ok]]
            ok &= pi >= 0
            ok[ok] &= self.valid[pi[ok]] & (self.room[pi[ok]] == room[ok])
            w = (tx if k & 1 else 1 - tx) * (ty if (k >> 1) & 1 else 1 - ty) * (tz if (k >> 2) & 1 else 1 - tz)
            w = np.where(ok & (w > 0), w, 0.0)
            ws += w
            acc += self.C[np.maximum(pi, 0)] * w[:, None, None]
        sh = acc / np.maximum(ws, 1e-9)[:, None, None]
        miss = np.where(ws <= 1e-4)[0]
        for i in miss:
            pool = np.where(self.valid & (self.room == room[i]))[0]
            if not len(pool):
                pool = np.where(self.valid & (self.level == level[i]))[0]
            j = pool[np.argmin(((self.P[pool] - p[i]) ** 2).sum(1))]
            sh[i] = self.C[j]
        x, y, z = n[:, 0], n[:, 1], n[:, 2]
        k_ = 2 * 0.429043
        w = np.stack([np.full_like(x, 0.886227), 2 * 0.511664 * y, 2 * 0.511664 * z, 2 * 0.511664 * x, k_ * x * y, k_ * y * z,
                      0.743125 * z * z - 0.247708, k_ * x * z, 0.429043 * (x * x - y * y)], 1)
        return np.maximum(np.einsum("vj,vjc->vc", w, sh), 0) / math.pi


def _emission(name, build):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    build(nt, em)
    return m


def _set_all(o, m):
    me = o.data
    if not me.materials:
        me.materials.append(m)
    for i in range(len(me.materials)):
        me.materials[i] = m


def prepare(base=None):
    """Swap every house material for the bake's light (call once per loaded file)."""
    base = base or B.BASE
    B.setup_world()
    grid = Grid(base)
    lm = {}
    for t in ("G", "L1", "L2"):
        img = bpy.data.images.load(os.path.join(base, f"LM_{t}.exr"), check_existing=True)
        img.colorspace_settings.name = "Non-Color"

        def b(nt, em, img=img):
            uv = nt.nodes.new("ShaderNodeUVMap")
            uv.uv_map = "Lightmap"
            tx = nt.nodes.new("ShaderNodeTexImage")
            tx.image = img
            tx.interpolation = "Linear"
            nt.links.new(uv.outputs[0], tx.inputs[0])
            nt.links.new(tx.outputs[0], em.inputs[0])
        lm[f"LM_{t}"] = _emission(f"_pv_LM_{t}", b)

    def vb(nt, em):
        a = nt.nodes.new("ShaderNodeVertexColor")
        a.layer_name = "_pv"
        nt.links.new(a.outputs[0], em.inputs[0])
    probe = _emission("_pv_probe", vb)

    def gb(nt, em):
        em.inputs[0].default_value = (0.5, 0.5, 0.5, 1)
    grey = _emission("_pv_ext", gb)
    glass = bpy.data.materials.new("_pv_glass")
    glass.use_nodes = True
    nt = glass.node_tree
    nt.nodes.clear()
    nt.links.new(nt.nodes.new("ShaderNodeBsdfTransparent").outputs[0], nt.nodes.new("ShaderNodeOutputMaterial").inputs[0])
    from .export import _part_of
    for o in list(bpy.data.objects):
        if o.type != "MESH" or not B._is_house(o) or o.name.startswith("COL_"):
            continue
        part = _part_of(o)
        if part is None:
            continue
        names = [m.name if m else "" for m in o.data.materials]
        if o.get("lightmap") in lm and "Lightmap" in o.data.uv_layers:
            o.data = o.data.copy()
            _set_all(o, lm[o["lightmap"]])
            continue
        if part == "exterior" and not o.name.startswith(("Win_", "Door_")):
            o.data = o.data.copy()
            _set_all(o, grey)
            continue
        o.data = o.data.copy()
        me = o.data
        M = o.matrix_world
        nv = len(me.loops)
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", co)
        vi = np.empty(nv, int)
        me.loops.foreach_get("vertex_index", vi)
        ln = np.empty(nv * 3)
        me.corner_normals.foreach_get("vector", ln)
        p = co.reshape(-1, 3)[vi] @ np.array(M.to_3x3()).T + np.array(M.translation)
        nm = np.array(M.to_3x3().inverted_safe().transposed())
        n = ln.reshape(-1, 3) @ nm.T
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        L = grid.light(p, n)
        if "_pv" in me.color_attributes:
            me.color_attributes.remove(me.color_attributes["_pv"])
        ca = me.color_attributes.new("_pv", "FLOAT_COLOR", "CORNER")
        ca.data.foreach_set("color", np.concatenate([L, np.ones((nv, 1))], 1).astype(np.float32).ravel())
        for i, nm_ in enumerate(names):
            me.materials[i] = glass if nm_ in ("glass", "stained_glass") else probe
        if not names:
            me.materials.append(probe)
    sc = bpy.context.scene
    sc.cycles.max_bounces = 0
    sc.cycles.transparent_max_bounces = 16
    sc.cycles.use_denoising = False
    sc.view_settings.view_transform = "Standard"
    for o in bpy.data.objects:
        if o.name.startswith("COL_") or o.type == "LIGHT":
            o.hide_render = True


def shot(path, loc, at, lens=20, res=(1400, 900), ev=6.0, samples=24):
    sc = bpy.context.scene
    cam = bpy.data.objects.get("_PVCam")
    if cam is None:
        cam = bpy.data.objects.new("_PVCam", bpy.data.cameras.new("_PVCam"))
        sc.collection.objects.link(cam)
    cam.data.type = "PERSP"
    cam.data.lens = lens
    cam.data.clip_start = 0.02
    cam.location = loc
    cam.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.cycles.samples = samples
    sc.view_settings.exposure = ev
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
