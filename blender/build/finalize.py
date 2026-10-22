"""Last pass over every house mesh: dissolve degenerate (zero-area) faces and edges left by booleans,
give every mesh a UV map, and shade with area-weighted normals."""
import bpy
import bmesh
import numpy as np


def _fix_fins(bm):
    """Zero-area fins whose corners coincide without being shared: drop the fin, weld those corners."""
    for f in [f for f in bm.faces if f.calc_area() < 1e-10]:
        if not f.is_valid:
            continue
        vs = list(f.verts)
        pairs = [(a, b) for i, a in enumerate(vs) for b in vs[i + 1:] if (a.co - b.co).length < 1e-6]
        if pairs:
            bmesh.ops.delete(bm, geom=[f], context="FACES_ONLY")
            for a, b in pairs:
                if a.is_valid and b.is_valid:
                    bmesh.ops.pointmerge(bm, verts=[a, b], merge_co=a.co.copy())


def _drop_slivers(bm):
    """Delete closed parts thinner than 0.2 mm on average (3V/A): paper-thin leftovers of booleans that
    would only z-fight with their neighbours."""
    seen, dead = set(), []
    bm.faces.ensure_lookup_table()
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        comp, stack = [], [f0]
        while stack:
            f = stack.pop()
            if f.index in seen:
                continue
            seen.add(f.index)
            comp.append(f)
            for e in f.edges:
                stack.extend(g for g in e.link_faces if g.index not in seen)
        if not all(e.is_manifold for f in comp for e in f.edges):
            continue
        o0 = comp[0].verts[0].co.copy()
        vol = 0.0
        for f in comp:
            vs = [v.co - o0 for v in f.verts]
            for i in range(1, len(vs) - 1):
                vol += vs[0].dot(vs[i].cross(vs[i + 1])) / 6.0
        area = sum(f.calc_area() for f in comp)
        if area > 0 and 3 * abs(vol) / area < 2e-4:
            dead.extend(comp)
    if dead:
        bmesh.ops.delete(bm, geom=dead, context="FACES")


def _house_meshes():
    return [o for o in bpy.data.objects
            if o.type == "MESH" and any(c.get("path", "").startswith("House") for c in o.users_collection)]


def build():
    objs = _house_meshes()
    clean(objs)
    uv_fill(objs)
    structure_normals()
    weight_normals(objs)


def clean(objs):
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        _fix_fins(bm)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-5)
        _fix_fins(bm)
        # zero-area slivers whose edges are all long enough to survive: collapse their shortest edge
        # when it is below 2 mm (a sub-millimetre vertex move, invisible)
        for _ in range(4):
            sl = [f for f in bm.faces if f.is_valid and f.calc_area() < 1e-10]
            if not sl:
                break
            es = {min(f.edges, key=lambda e: e.calc_length()) for f in sl}
            es = [e for e in es if e.is_valid and e.calc_length() < 0.002]
            if not es:
                break
            bmesh.ops.collapse(bm, edges=es)
        _drop_slivers(bm)
        bm.to_mesh(o.data)
        bm.free()


def uv_fill(objs):
    """Meshes that came out of boolean chains without a UV map get the same metre-scale box projection
    the builders use (wallpaper, boards and bakes all need one)."""
    from . import core as _core
    for o in objs:
        # walls and breasts are re-projected even when they have a map: booleans hand the cutters'
        # UVs (other scales) to the faces they create, so wallpaper repeats would vary wall to wall
        reproject = o.name.startswith("Structure_") or (o.name.startswith("Fireplace_") and o.name.endswith("_Breast"))
        if o.data.uv_layers and not reproject:
            continue
        me = o.data
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        V = np.zeros((len(me.vertices), 3))
        me.vertices.foreach_get("co", V.ravel())
        F = [list(p.vertices) for p in me.polygons]
        uvs = _core.box_uv(V, F)
        layer = me.uv_layers.new(name="UVMap")
        layer.data.foreach_set("uv", np.asarray([c for f in uvs for c in f], dtype=np.float32).ravel())


def structure_normals():
    """Boolean-cut walls carry long sliver triangles: area-weighted custom normals keep the curved
    turret walls and the flat walls beside them evenly shaded (glTF exports custom normals)."""
    from . import core
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name.startswith(("Structure_", "Foundation")):
            m = o.modifiers.new("wn", "WEIGHTED_NORMAL")
            m.mode = "FACE_AREA"
            m.keep_sharp = True
            core.apply_mods(o)


def weight_normals(objs):
    """Every other smooth-shaded mesh: each corner's normal the area-weighted mean of the faces in its
    smooth fan (split at the sharp edges `core.smooth_by_angle` marked). A plain mean let a shallow
    chamfer tilt a large flat face's few corners and the tilt spread over the whole face: the doors'
    raised fields, whose 27° bevels sit under the 35° crease angle, shaded like pillows. The lightmapped
    objects are left alone: their light was baked with their normals."""
    from .bake import is_lightmapped
    done = set()
    for o in objs:
        me = o.data
        if me.name in done or me.has_custom_normals or is_lightmapped(o) or not any(p.use_smooth for p in me.polygons):
            continue
        done.add(me.name)
        area_weighted_normals(me)


def area_weighted_normals(me):
    nl = len(me.loops)
    if not nl:
        return
    lv = np.empty(nl, np.int64)
    me.loops.foreach_get("vertex_index", lv)
    le = np.empty(nl, np.int64)
    me.loops.foreach_get("edge_index", le)
    np_ = len(me.polygons)
    start = np.empty(np_, np.int64)
    me.polygons.foreach_get("loop_start", start)
    total = np.empty(np_, np.int64)
    me.polygons.foreach_get("loop_total", total)
    fn = np.empty(np_ * 3)
    me.polygons.foreach_get("normal", fn)
    fn = fn.reshape(-1, 3)
    area = np.empty(np_)
    me.polygons.foreach_get("area", area)
    smooth = np.empty(np_, bool)
    me.polygons.foreach_get("use_smooth", smooth)
    sharp = np.zeros(len(me.edges), bool)
    if "sharp_edge" in me.attributes:
        me.attributes["sharp_edge"].data.foreach_get("value", sharp)
    face = np.repeat(np.arange(np_), total)
    nxt = np.arange(nl) + 1
    ends = start + total
    nxt[ends - 1] = start
    # union-find over corners: two faces across a smooth edge share the fans at both its ends
    parent = np.arange(nl)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    by_edge = {}
    for c in range(nl):
        by_edge.setdefault(int(le[c]), []).append(c)
    for e, ls in by_edge.items():
        if len(ls) != 2 or sharp[e]:
            continue
        a, b = ls
        if not (smooth[face[a]] and smooth[face[b]]):
            continue
        for ca in (a, nxt[a]):
            for cb in (b, nxt[b]):
                if lv[ca] == lv[cb]:
                    ra, rb = find(ca), find(cb)
                    if ra != rb:
                        parent[ra] = rb
    root = np.array([find(i) for i in range(nl)])
    acc = np.zeros((nl, 3))
    np.add.at(acc, root, fn[face] * area[face][:, None])
    n = acc[root]
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    n = np.where(ln > 1e-12, n / np.maximum(ln, 1e-12), fn[face])
    me.normals_split_custom_set(n.tolist())
