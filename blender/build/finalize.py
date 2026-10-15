"""Last pass over every house mesh: dissolve degenerate (zero-area) faces and edges left by booleans."""
import bpy
import bmesh


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


def build():
    for o in bpy.data.objects:
        if o.type != "MESH" or not any(c.get("path", "").startswith("House") for c in o.users_collection):
            continue
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
    # meshes that came out of boolean chains without a UV map get the same metre-scale box projection
    # the builders use (wallpaper, boards and bakes all need one)
    import numpy as np
    from . import core as _core
    for o in bpy.data.objects:
        if o.type != "MESH" or not any(c.get("path", "").startswith("House") for c in o.users_collection):
            continue
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
    # boolean-cut walls carry long sliver triangles: area-weighted custom normals keep the curved
    # turret walls and the flat walls beside them evenly shaded (glTF exports custom normals)
    from . import core
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name.startswith(("Structure_", "Foundation")):
            m = o.modifiers.new("wn", "WEIGHTED_NORMAL")
            m.mode = "FACE_AREA"
            m.keep_sharp = True
            core.apply_mods(o)
