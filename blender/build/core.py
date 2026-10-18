"""Scene plumbing: collections, mesh objects, modifiers applied in place, instancing, UVs, smoothing.

Units are metres. Blender axes: +X right (east when facing the front), +Y back, +Z up.
The house's front faces -Y. Origin: grade level on the centre line of the front door.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = "House"


# ---------------------------------------------------------------- collections

_COLL_CACHE = {}


def coll(path: str) -> bpy.types.Collection:
    """Get or create a nested collection 'A/B/C' under the scene root collection.

    Blender collection names are global, so each collection is keyed by its full path (custom
    property 'path'); a leaf name that already exists elsewhere is qualified with its parent."""
    c = _COLL_CACHE.get(path)
    if c is not None:
        try:
            if c.get("path") == path:
                return c
        except ReferenceError:
            pass
    parent = bpy.context.scene.collection
    acc = []
    for name in path.split("/"):
        acc.append(name)
        key = "/".join(acc)
        c = None
        for ch in parent.children:
            if ch.get("path") == key:
                c = ch
                break
        if c is None:
            nm = name if bpy.data.collections.get(name) is None else f"{acc[-2]} {name}" if len(acc) > 1 else name
            c = bpy.data.collections.new(nm)
            c["path"] = key
            parent.children.link(c)
        parent = c
    _COLL_CACHE[path] = c
    return c


def clear(path: str) -> bpy.types.Collection:
    """Empty a collection (objects and child collections, recursively) and return it."""
    c = coll(path)

    def wipe(cc):
        for ch in list(cc.children):
            wipe(ch)
            bpy.data.collections.remove(ch)
        for o in list(cc.objects):
            data = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if data is not None and data.users == 0:
                if isinstance(data, bpy.types.Mesh):
                    bpy.data.meshes.remove(data)
                elif isinstance(data, bpy.types.Curve):
                    bpy.data.curves.remove(data)
                elif isinstance(data, bpy.types.Light):
                    bpy.data.lights.remove(data)

    wipe(c)
    for k in [k for k in _COLL_CACHE if k.startswith(path + "/")]:
        _COLL_CACHE.pop(k, None)
    return c


def purge_orphans():
    for blk in (bpy.data.meshes, bpy.data.curves, bpy.data.lights):
        for d in list(blk):
            if d.users == 0:
                blk.remove(d)


def hide(c: bpy.types.Collection, hidden=True):
    lc = _layer_coll(bpy.context.view_layer.layer_collection, c.name)
    if lc:
        lc.exclude = hidden


def _layer_coll(lc, name):
    if lc.collection.name == name:
        return lc
    for ch in lc.children:
        r = _layer_coll(ch, name)
        if r:
            return r
    return None


# ---------------------------------------------------------------- geometry container

class Geo:
    """Vertices, polygon faces, per-corner UVs and per-face material slot indices."""

    __slots__ = ("V", "F", "UV", "M")

    def __init__(self, V=None, F=None, UV=None, M=None):
        self.V = np.zeros((0, 3)) if V is None else np.asarray(V, dtype=np.float64).reshape(-1, 3)
        self.F = [] if F is None else [list(f) for f in F]
        self.UV = UV  # list (per face) of list of (u, v), or None => box projection
        self.M = M if M is not None else [0] * len(self.F)

    def add(self, g: "Geo", mat: int | None = None):
        off = len(self.V)
        if self.UV is None:
            self.UV = box_uv(self.V, self.F) if self.F else []
        guv = g.UV if g.UV is not None else box_uv(g.V, g.F)
        self.V = np.vstack([self.V, g.V]) if len(self.V) else g.V.copy()
        self.F.extend([[i + off for i in f] for f in g.F])
        self.UV.extend(guv)
        self.M.extend([mat] * len(g.F) if mat is not None else g.M)
        return self

    def xf(self, m: Matrix) -> "Geo":
        M = np.array(m, dtype=np.float64)
        V = self.V @ M[:3, :3].T + M[:3, 3]
        F = self.F
        if np.linalg.det(M[:3, :3]) < 0:
            F = [list(reversed(f)) for f in F]
            UV = [list(reversed(u)) for u in self.UV] if self.UV is not None else None
        else:
            UV = self.UV
        return Geo(V, F, UV, list(self.M))

    def move(self, x=0.0, y=0.0, z=0.0) -> "Geo":
        return Geo(self.V + np.array([x, y, z]), self.F, self.UV, list(self.M))

    def setmat(self, m: int) -> "Geo":
        self.M = [m] * len(self.F)
        return self

    def flip(self) -> "Geo":
        self.F = [list(reversed(f)) for f in self.F]
        if self.UV is not None:
            self.UV = [list(reversed(u)) for u in self.UV]
        return self


def orient_convex(g: Geo) -> Geo:
    """Make every face of a convex closed part point away from the part's centre."""
    c = g.V.mean(0)
    F, UV = [], []
    for i, f in enumerate(g.F):
        p = g.V[f]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        if np.linalg.norm(n) < 1e-12 and len(f) > 3:
            n = np.cross(p[2] - p[0], p[3] - p[0])
        if float(n @ (p.mean(0) - c)) < 0:
            F.append(list(reversed(f)))
            UV.append(list(reversed(g.UV[i])) if g.UV is not None else None)
        else:
            F.append(list(f))
            UV.append(g.UV[i] if g.UV is not None else None)
    return Geo(g.V, F, UV if g.UV is not None else None, list(g.M))


def merge(*gs, mats=None) -> Geo:
    out = Geo()
    for i, g in enumerate(gs):
        out.add(g, None if mats is None else mats[i])
    return out


def box_uv(V, F, scale=1.0):
    """Per-corner UVs by box projection along each face's dominant normal axis, in metres."""
    V = np.asarray(V)
    out = []
    for f in F:
        p = V[f]
        if len(f) >= 3:
            n = np.zeros(3)
            for i in range(len(f)):  # Newell normal
                a, b = p[i], p[(i + 1) % len(f)]
                n += np.array([(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])])
        else:
            n = np.array([0, 0, 1.0])
        ax = int(np.argmax(np.abs(n)))
        if ax == 0:
            uv = np.stack([p[:, 1] * np.sign(n[0] or 1), p[:, 2]], 1)
        elif ax == 1:
            uv = np.stack([-p[:, 0] * np.sign(n[1] or 1), p[:, 2]], 1)
        else:
            uv = np.stack([p[:, 0], p[:, 1] * np.sign(n[2] or 1)], 1)
        out.append([tuple(x) for x in (uv * scale)])
    return out


# ---------------------------------------------------------------- objects

def _loose_parts(me):
    """Split a mesh into connected components; returns list of new meshes (materials kept)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    seen = set()
    parts = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        comp = set()
        while stack:
            x = stack.pop()
            if x.index in comp:
                continue
            comp.add(x.index)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in comp:
                    stack.append(y)
        seen |= comp
        parts.append(comp)
    out = []
    for comp in parts:
        b2 = bm.copy()
        b2.verts.ensure_lookup_table()
        bmesh.ops.delete(b2, geom=[b2.verts[i] for i in range(len(b2.verts)) if i not in comp], context="VERTS")
        m = bpy.data.meshes.new("_part")
        b2.to_mesh(m)
        b2.free()
        for mat in me.materials:
            m.materials.append(mat)
        out.append(m)
    bm.free()
    return out


def _is_closed(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    ok = all(e.is_manifold for e in bm.edges) and len(bm.faces) > 3
    bm.free()
    return ok


def self_union(o):
    """Union of an object's loose parts into one clean solid (no internal or coincident faces),
    with the Manifold solver; parts that are not closed are kept as they are. Materials kept."""
    me = o.data
    parts = _loose_parts(me)
    if len(parts) < 2:
        for m in parts:
            bpy.data.meshes.remove(m)
        return o
    closed = [m for m in parts if _is_closed(m)]
    openp = [m for m in parts if m not in closed]
    if len(closed) >= 2:
        tmpc = coll("_tmp_bool")
        objs = []
        for m in closed:
            ob = bpy.data.objects.new("_p", m)
            tmpc.objects.link(ob)
            objs.append(ob)
        base = objs[0]
        sub = bpy.data.collections.new("_union_ops")
        for ob in objs[1:]:
            sub.objects.link(ob)
        mod = base.modifiers.new("u", "BOOLEAN")
        mod.operation = "UNION"
        mod.solver = "MANIFOLD"
        mod.operand_type = "COLLECTION"
        mod.collection = sub
        apply_mods(base)
        bpy.data.collections.remove(sub)
        result = base.data
        for ob in objs[1:]:
            d = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if d.users == 0:
                bpy.data.meshes.remove(d)
        merged = [result] + openp
    else:
        merged = parts
        result = None
    # rebuild the object's mesh from the merged pieces
    bm = bmesh.new()
    for m in merged:
        bm.from_mesh(m)
    old = o.data
    new = bpy.data.meshes.new(old.name)
    bm.to_mesh(new)
    bm.free()
    for mat in old.materials:
        new.materials.append(mat)
    o.data = new
    if old.users == 0:
        bpy.data.meshes.remove(old)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-6)
    bm.to_mesh(o.data)
    bm.free()
    for m in merged:
        if m.users == 0:
            bpy.data.meshes.remove(m)
    if result is not None and base.name in bpy.data.objects:
        bpy.data.objects.remove(base, do_unlink=True)
    return o


def obj(name: str, g: Geo, collection: str, mats, smooth: float | None = 35.0, loc=None, weld=False, clean=False) -> bpy.types.Object:
    """Create a mesh object from a Geo. mats: material name or list of names (slot = Geo.M index)."""
    from . import mat as M

    if isinstance(mats, str):
        mats = [mats]
    me = bpy.data.meshes.new(name)
    V = g.V
    me.from_pydata(V.tolist(), [], g.F)
    uvs = g.UV if g.UV is not None else box_uv(V, g.F)
    uvl = me.uv_layers.new(name="UVMap")
    flat = [c for f in uvs for c in f]
    if flat:
        uvl.data.foreach_set("uv", np.asarray(flat, dtype=np.float32).ravel())
    for m in mats:
        me.materials.append(M.get(m))
    if len(mats) > 1:
        me.polygons.foreach_set("material_index", np.asarray(g.M, dtype=np.int32))
    me.validate(clean_customdata=False)
    if weld:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(me)
        bm.free()
    o = bpy.data.objects.new(name, me)
    coll(collection).objects.link(o)
    if loc is not None:
        o.location = loc
    if clean:
        self_union(o)
    if smooth is not None:
        smooth_by_angle(o, smooth)
    return o


def smooth_by_angle(o, deg=35.0):
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    thr = math.radians(deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if not e.is_manifold:
            e.smooth = not e.is_boundary
            continue
        e.smooth = e.calc_face_angle(math.pi) < thr
    bm.to_mesh(me)
    bm.free()


def instance(src: bpy.types.Object, name: str, collection: str, matrix: Matrix) -> bpy.types.Object:
    o = bpy.data.objects.new(name, src.data)
    o.matrix_world = matrix
    coll(collection).objects.link(o)
    return o


def empty(name, collection, loc=(0, 0, 0), rot=(0, 0, 0), kind="PLAIN_AXES", size=0.3, props=None):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = kind
    o.empty_display_size = size
    o.location = loc
    o.rotation_euler = rot
    coll(collection).objects.link(o)
    for k, v in (props or {}).items():
        o[k] = v
    return o


def dissolve_degenerate(o, dist=1e-6):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=dist)
    bm.to_mesh(o.data)
    bm.free()


def set_mats(o, names):
    """Replace all material slots (booleans carry operands' empty slots) and zero the indices."""
    from . import mat as M
    me = o.data
    me.materials.clear()
    for n in ([names] if isinstance(names, str) else names):
        me.materials.append(M.get(n))
    if isinstance(names, str) or len(names) == 1:
        me.polygons.foreach_set("material_index", np.zeros(len(me.polygons), dtype=np.int32))


def apply_mods(o: bpy.types.Object):
    """Bake the modifier stack into the mesh without operators."""
    if not o.modifiers:
        return o
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = o.data
    o.modifiers.clear()
    o.data = me
    me.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return o


def bevel(o, width=0.004, segments=2, angle=40.0, apply=True, clamp=True, harden=True):
    m = o.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.use_clamp_overlap = clamp
    m.harden_normals = False
    m.miter_outer = "MITER_ARC" if segments > 1 else "MITER_SHARP"
    if apply:
        apply_mods(o)
        smooth_by_angle(o, angle - 5)
    return o


def boolean(o, cutters, op="DIFFERENCE", solver="EXACT", apply=True, remove_cutters=True):
    """Boolean `o` against a list of objects (joined into one temp operand)."""
    if not cutters:
        return o
    n_slots = len(o.data.materials)
    tmp_coll = coll("_tmp_bool")
    if len(cutters) == 1:
        operand = cutters[0]
    else:
        operand = join_copy(cutters, "_cut", "_tmp_bool")
    m = o.modifiers.new("bool", "BOOLEAN")
    m.operation = op
    m.solver = solver
    m.object = operand
    if solver == "EXACT":
        m.use_self = True
        m.use_hole_tolerant = False
    for c in [operand]:
        c.hide_render = True
        c.display_type = "WIRE"
    if apply:
        apply_mods(o)
        dissolve_degenerate(o)
        me = o.data
        if len(me.materials) > n_slots:
            # faces from the cutter inherit the base's first slot; drop the operand's empty slots
            idx = np.zeros(len(me.polygons), dtype=np.int32)
            me.polygons.foreach_get("material_index", idx)
            idx[idx >= max(n_slots, 1)] = 0
            me.polygons.foreach_set("material_index", idx)
            while len(me.materials) > max(n_slots, 0):
                me.materials.pop(index=len(me.materials) - 1)
        if remove_cutters:
            for c in set(cutters) | {operand}:
                if c.name in bpy.data.objects:
                    d = c.data
                    bpy.data.objects.remove(c, do_unlink=True)
                    if d and d.users == 0:
                        bpy.data.meshes.remove(d)
    return o


def geo_obj(g: Geo, name="_tmp", collection="_tmp_bool") -> bpy.types.Object:
    """Raw mesh object for use as a boolean operand (no materials, no smoothing)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata(g.V.tolist(), [], g.F)
    me.validate()
    o = bpy.data.objects.new(name, me)
    coll(collection).objects.link(o)
    return o


def dup(o, name="_dup", collection="_tmp_bool"):
    c = bpy.data.objects.new(name, o.data.copy())
    c.matrix_world = o.matrix_world
    coll(collection).objects.link(c)
    return c


def remove(o):
    d = o.data
    bpy.data.objects.remove(o, do_unlink=True)
    if d is not None and getattr(d, "users", 1) == 0:
        bpy.data.meshes.remove(d)


def join_copy(objs, name, collection):
    """A new object holding the world-space union (concatenation) of the given meshes."""
    bm = bmesh.new()
    for o in objs:
        me = o.data
        tmp = me.copy()
        tmp.transform(o.matrix_world)
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    out = bpy.data.objects.new(name, me)
    coll(collection).objects.link(out)
    return out


def join(objs, name=None):
    """Join objects into the first one (world transforms baked into the first's space)."""
    if len(objs) < 2:
        return objs[0]
    base = objs[0]
    inv = base.matrix_world.inverted()
    bm = bmesh.new()
    bm.from_mesh(base.data)
    mats = list(base.data.materials)
    for o in objs[1:]:
        me = o.data.copy()
        me.transform(inv @ o.matrix_world)
        # remap material slots
        remap = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        if remap:
            idx = np.zeros(len(me.polygons), dtype=np.int32)
            me.polygons.foreach_get("material_index", idx)
            me.polygons.foreach_set("material_index", np.asarray(remap, dtype=np.int32)[idx] if len(idx) else idx)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        d = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if d.users == 0:
            bpy.data.meshes.remove(d)
    bm.to_mesh(base.data)
    bm.free()
    base.data.materials.clear()
    for m in mats:
        base.data.materials.append(m)
    if name:
        base.name = name
    return base


def finish_tmp():
    c = _COLL_CACHE.pop("_tmp_bool", None) or bpy.data.collections.get("_tmp_bool")
    if c:
        for o in list(c.objects):
            d = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if d and d.users == 0:
                bpy.data.meshes.remove(d)
        bpy.data.collections.remove(c)


def mat_xf(loc=(0, 0, 0), rz=0.0, rx=0.0, ry=0.0, s=1.0) -> Matrix:
    m = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X")
    if s != 1.0:
        m = m @ Matrix.Diagonal((s, s, s, 1.0)) if not isinstance(s, tuple) else m @ Matrix.Diagonal((*s, 1.0))
    return m


def redraw():
    for w in bpy.context.window_manager.windows:
        for a in w.screen.areas:
            if a.type == "VIEW_3D":
                a.tag_redraw()


from contextlib import contextmanager


@contextmanager
def in_scene(sc):
    """Make `sc` the current scene for operators (bakes): the window's scene in the UI, a context
    override when Blender runs in the background (no window)."""
    win = bpy.context.window
    if win is not None:
        main = win.scene
        win.scene = sc
        try:
            yield
        finally:
            win.scene = main
    else:
        with bpy.context.temp_override(scene=sc, view_layer=sc.view_layers[0]):
            yield
