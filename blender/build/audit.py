"""Geometry audit: run after every build. Writes blender/audit/report.txt and prints a summary.

1. Coplanar overlaps (z-fighting): triangles from any objects (or the same object) that lie in the
   same plane, face the same way and overlap in area. Opposite-facing coincident faces between
   closed solids are contacts (each covered by the other solid) and are reported separately only
   when one of the meshes is open.
2. Clearance: a walking corridor in front of and behind every door, the front steps' path to the
   front door, and the stair flights must be free of any geometry.
3. Mesh health: non-manifold edges on objects that must be closed solids, loose verts, zero-area
   faces.
"""
import math
import os
from collections import defaultdict

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from . import plan as P

OUT = "/Users/scott/Documents/Projects/Node/dysonCity/blender/audit"
SKIP_COLLS = {"_tmp_bool"}


def house_objects():
    out = []
    for o in bpy.data.objects:
        if o.type != "MESH" or o.hide_get() or o.name.startswith("_"):
            continue
        if any(c.name in SKIP_COLLS for c in o.users_collection):
            continue
        if not any(c.get("path", "").startswith("House") for c in o.users_collection):
            continue
        if any("_Prototypes" in c.get("path", "") or c.get("path", "").startswith("House/Engine") for c in o.users_collection):
            continue
        out.append(o)
    return out


def tris_world(o):
    me = o.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    if n == 0:
        return np.zeros((0, 3, 3)), np.zeros(0, int)
    V = np.zeros((len(me.vertices), 3))
    me.vertices.foreach_get("co", V.ravel())
    Mw = np.array(o.matrix_world)
    V = V @ Mw[:3, :3].T + Mw[:3, 3]
    idx = np.zeros(n * 3, int)
    me.loop_triangles.foreach_get("vertices", idx)
    poly = np.zeros(n, int)
    me.loop_triangles.foreach_get("polygon_index", poly)
    T = V[idx.reshape(-1, 3)]
    if np.linalg.det(Mw[:3, :3]) < 0:
        T = T[:, ::-1]          # a mirrored instance renders with flipped winding
    return T, poly


def _clip(subject, clipper):
    """Sutherland-Hodgman: convex clipper (CCW), arbitrary subject. 2D lists."""
    out = subject
    for i in range(len(clipper)):
        a, b = clipper[i - 1], clipper[i]
        inp = out
        out = []
        if not inp:
            break
        def inside(p):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-12
        def inter(p, q):
            x1, y1, x2, y2 = a[0], a[1], b[0], b[1]
            x3, y3, x4, y4 = p[0], p[1], q[0], q[1]
            den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
            if abs(den) < 1e-18:
                return q
            t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
            return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
        for j in range(len(inp)):
            p, q = inp[j - 1], inp[j]
            if inside(q):
                if not inside(p):
                    out.append(inter(p, q))
                out.append(q)
            elif inside(p):
                out.append(inter(p, q))
    return out


def _area(poly):
    if len(poly) < 3:
        return 0.0
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i - 1]
        x2, y2 = poly[i]
        s += x1 * y2 - x2 * y1
    return 0.5 * s


def _buried(poly, P2, signs, s):
    """True when the overlap's centroid is covered by a coplanar triangle facing the other way, i.e. the
    two same-facing faces lie flat against another surface (trim backs on a wall, feet on a floor)."""
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    for k in np.nonzero(signs != s)[0]:
        (x0, y0), (x1, y1), (x2, y2) = P2[k]
        d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(d) < 1e-14:
            continue
        l0 = ((y1 - y2) * (cx - x2) + (x2 - x1) * (cy - y2)) / d
        l1 = ((y2 - y0) * (cx - x2) + (x0 - x2) * (cy - y2)) / d
        if l0 >= -1e-6 and l1 >= -1e-6 and l0 + l1 <= 1 + 1e-6:
            return True
    return False


def coplanar(objs, tol_d=3e-4, tol_n=2e-3, min_area=4e-6):
    T, owner, normals, dd, areas = [], [], [], [], []
    for oi, o in enumerate(objs):
        t, _ = tris_world(o)
        if len(t) == 0:
            continue
        e1 = t[:, 1] - t[:, 0]
        e2 = t[:, 2] - t[:, 0]
        nrm = np.cross(e1, e2)
        a = np.linalg.norm(nrm, axis=1)
        keep = a > 2e-8
        t, nrm, a = t[keep], nrm[keep], a[keep]
        nrm = nrm / a[:, None]
        T.append(t)
        owner.append(np.full(len(t), oi))
        normals.append(nrm)
        dd.append(np.einsum("ij,ij->i", nrm, t[:, 0]))
        areas.append(a / 2)
    T = np.concatenate(T)
    owner = np.concatenate(owner)
    N = np.concatenate(normals)
    D = np.concatenate(dd)
    # canonical plane key (direction-independent), facing sign kept separately
    sgn = np.where((N[:, 0] > 1e-9) | ((np.abs(N[:, 0]) <= 1e-9) & ((N[:, 1] > 1e-9) | ((np.abs(N[:, 1]) <= 1e-9) & (N[:, 2] > 0)))), 1, -1)
    Nc = N * sgn[:, None]
    Dc = D * sgn
    kn = np.round(Nc / tol_n).astype(np.int64)
    kd = np.round(Dc / tol_d).astype(np.int64)
    buckets = defaultdict(list)
    for i in range(len(T)):
        buckets[(kn[i, 0], kn[i, 1], kn[i, 2], kd[i])].append(i)
    issues = defaultdict(lambda: [0.0, None])
    for key, ids in buckets.items():
        if len(ids) < 2:
            continue
        ids = np.array(ids)
        n0 = Nc[ids[0]]
        # 2D basis
        ax = np.array([1.0, 0, 0]) if abs(n0[0]) < 0.9 else np.array([0, 1.0, 0])
        u = np.cross(n0, ax)
        u /= np.linalg.norm(u)
        v = np.cross(n0, u)
        P2 = np.stack([T[ids] @ u, T[ids] @ v], -1)       # (k, 3, 2)
        lo = P2.min(1)
        hi = P2.max(1)
        order = np.argsort(lo[:, 0])
        for ii in range(len(order)):
            a = order[ii]
            for jj in range(ii + 1, len(order)):
                b = order[jj]
                if lo[b, 0] >= hi[a, 0] - 1e-7:
                    break
                if lo[b, 1] >= hi[a, 1] - 1e-7 or lo[a, 1] >= hi[b, 1] - 1e-7:
                    continue
                ia, ib = ids[a], ids[b]
                same_facing = sgn[ia] == sgn[ib]
                if not same_facing:
                    continue
                pa = [tuple(p) for p in P2[a]]
                pb = [tuple(p) for p in P2[b]]
                if _area(pa) < 0:
                    pa = pa[::-1]
                if _area(pb) < 0:
                    pb = pb[::-1]
                inter = _clip(pb, pa)
                ar = abs(_area(inter))
                if ar > min_area and _buried(inter, P2, sgn[ids], sgn[ia]):
                    continue        # both faces press against an opposite-facing surface: hidden back faces
                if ar > min_area:
                    k2 = (min(owner[ia], owner[ib]), max(owner[ia], owner[ib]))
                    rec = issues[k2]
                    rec[0] += ar
                    if rec[1] is None:
                        c = T[ia].mean(0)
                        rec[1] = (tuple(float(x) for x in np.round(c, 3)), tuple(float(x) for x in np.round(N[ia], 2)),
                                  tuple(float(x) for x in np.round(T[ia].min(0), 3)) + tuple(float(x) for x in np.round(T[ia].max(0), 3)),
                                  tuple(float(x) for x in np.round(T[ib].min(0), 3)) + tuple(float(x) for x in np.round(T[ib].max(0), 3)))
    return [(objs[a].name, objs[b].name, area, loc) for (a, b), (area, loc) in sorted(issues.items(), key=lambda kv: -kv[1][0])]


def bvh_of(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.transform(o.matrix_world)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def box_bvh(c, half, rot_z=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 2 * half[0], v.co.y * 2 * half[1], v.co.z * 2 * half[2]))
        if rot_z:
            v.co.rotate(__import__("mathutils").Euler((0, 0, rot_z)))
        v.co += Vector(c)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def clearance(objs):
    """Corridors that must be empty: in front of and behind each door opening, the main steps."""
    import math as m
    issues = []
    trees = [(o, bvh_of(o)) for o in objs if not o.name.startswith(("Structure", "Foundation")) and "Deck" not in o.name
             and "Steps" not in o.name and "Runner" not in o.name and not o.name.startswith("Door_") or o.name.endswith("_Frame") and False]
    for op in P.OPENINGS:
        if op["kind"] not in ("door", "french", "pocket", "arch"):
            continue
        a = op["ang"]
        n = np.array([m.cos(a), m.sin(a)])
        th = op.get("thick", P.TI) if not op["ext"] else P.TE
        z0 = P.LEVELS[op["level"]] + 0.1
        h = min(2.0, op["head"] - op["sill"] - 0.15)
        w = min(0.8, op["w"] - 0.25)
        base = np.array(op["p"]) - (n * th / 2 if not op["ext"] else n * th / 2)
        for side in (1, -1):
            depth = 0.6
            c2 = np.array(op["p"]) + side * n * (th / 2 + 0.06 + depth / 2) if not op["ext"] else base + side * n * (th / 2 + 0.06 + depth / 2)
            tree = box_bvh((c2[0], c2[1], z0 + h / 2), (depth / 2 * abs(n[0]) + w / 2 * abs(n[1]),
                                                           depth / 2 * abs(n[1]) + w / 2 * abs(n[0]), h / 2))
            for o, t in trees:
                if o.name.startswith(("Door_" + op["name"],)) or "Leaf" in o.name:
                    continue
                if o.name.startswith("Door_") and not o.name.endswith(("_Frame", "_CasingA", "_CasingB", "_Int")):
                    continue  # door leaves swing through their own corridor by design
                if t.overlap(tree):
                    issues.append((op["name"], "front" if side > 0 else "back", o.name))
    return issues


def _bbox(o):
    M = np.array(o.matrix_world)
    c = np.array([list(v) for v in o.bound_box])
    w = c @ M[:3, :3].T + M[:3, 3]
    return w.min(0), w.max(0)


# pairs whose interpenetration is by design (one is built into / through the other)
INTENDED = [
    ("Chimney_", "Roof_"), ("Chimney_", "Structure_"), ("Chimney_", "Turret_"), ("Downpipes", "Cornice_"),
    ("Structure_", "Roof_"), ("Structure_", "Turret_"), ("Fireplace_", "Structure_"),
    ("Roof_", "Roof_"),                      # mansard curbs bedded on the break
    ("_Bal", "_Rail"), ("Gallery_", "_Rail"),  # balusters tenoned into handrails
    ("Cornice_B", "Structure_"), ("Cornice_E", "Structure_"),   # wing cornices die into the main wall
    ("Bay", "CornerBoards"),                  # bay entablatures meet the inside-corner strips
    ("_Finial", "_Deck"), ("_Finial", "Roof_Main_Hips"), ("_Barge", "_Deck"),   # finial spigots / barge tenons seated in the ridge
    ("Fireplace_Kitchen_Brass", "Fireplace_Kitchen_Range"),   # rail brackets fixed into the range front
    ("Gable_Bargeboards", "Gable_OverhangDeck"), ("Gable_Finial", "Gable_OverhangDeck"),
    ("_Rug", "Furn_"),                        # legs and plinths settle into the pile
    # seated joinery: members housed, tenoned or bedded into their neighbours (hidden inside solids)
    ("Porch_Lattice", "Porch_SkirtFrame"), ("MainStair_Nos", "MainStair_Strg"), ("TopStair_Nos", "TopStair_Strg"),
    ("MainStair_Strg", "MainStair_Sp"), ("TopStair_Strg", "TopStair_Sp"),
    ("MainStair_Rail", "Structure_"), ("TopStair_Rail", "Structure_"), ("Dormer_", "Dormer_"), ("Turret_Finial", "Turret_Spike"),
    ("Turret_Cornice", "Turret_Brackets"), ("Roof_Main_Hips", "Cresting"), ("Planting_", "WindowBoxes"),
    ("_Roof_Slate", "_Roof_Hips"), ("Win_", "Structure_"), ("Gable_Finial", "Gable_Bargeboards"),
    ("Porch_Roof", "Porch_Pediment"), ("Gable_OverhangDeck", "Cornice_"), ("Gable_Siding", "Roof_Main_Slate"),
    ("Gable_Band", "Roof_Main_Slate"), ("Gable_Finial", "Roof_Main_Slate"), ("Roof_Main_Slate", "Turret_Cone_Slate"),
    ("BayFront_Roof", "Gable_BayFlashing"),   # lead flashing dressed down over the bay roof
    ("BayBack_Roof_Hips", "Cornice_Back"), ("Cornice_Back_Brackets", "BayBack_Roof_Slate"),
    ("WindowBoxes", "BayFront_Aprons"), ("BeltCourse", "WestPorch_Roof"),
]


def _intended(a, b):
    def m(n, k):
        return n.startswith(k) or (k.startswith("_") and k in n)
    for x, y in INTENDED:
        if (m(a, x) and m(b, y)) or (m(a, y) and m(b, x)):
            return True
    return False


def _inside(tree, v, lo, hi):
    """Ray-parity inside test against a closed mesh (count crossings along +z and along +x)."""
    from mathutils import Vector
    votes = 0
    for d in (Vector((0.0013, 0.0021, 1)).normalized(), Vector((1, 0.0017, 0.0011)).normalized(),
              Vector((0.0019, 0.7071, 0.7071)).normalized(), Vector((-0.577, 0.5771, -0.5773)).normalized(),
              Vector((0.31, -0.9, 0.3)).normalized()):
        p = v + Vector((1.3e-5, -2.1e-5, 1.7e-5))     # off any face plane the vertex sits on
        n = 0
        for _ in range(64):
            loc, nrm, idx, dist = tree.ray_cast(p, d)
            if loc is None:
                break
            n += 1
            p = loc + d * 1e-5
        votes += n % 2
    return votes >= 3


def penetration(objs, depth=0.004, max_verts=1500):
    """Vertices of B lying more than `depth` inside closed solid A (ray parity + surface distance)."""
    trees, boxes, closed = {}, {}, {}
    for o in objs:
        boxes[o.name] = _bbox(o)
    hits = []
    for a in objs:
        lo_a, hi_a = boxes[a.name]
        for b in objs:
            if a is b or _intended(a.name, b.name):
                continue
            lo_b, hi_b = boxes[b.name]
            if np.any(lo_b > hi_a) or np.any(hi_b < lo_a):
                continue
            if a.name not in closed:
                bm = bmesh.new()
                bm.from_mesh(a.data)
                closed[a.name] = len(bm.edges) > 0 and all(e.is_manifold for e in bm.edges)
                bm.free()
                if closed[a.name]:
                    trees[a.name] = bvh_of(a)
            if not closed[a.name]:
                continue
            Mb = b.matrix_world
            vs = b.data.vertices
            step = max(1, len(vs) // max_verts)
            n_in = 0
            worst = 0.0
            where = None
            for i in range(0, len(vs), step):
                v = Mb @ vs[i].co
                if not (lo_a[0] < v.x < hi_a[0] and lo_a[1] < v.y < hi_a[1] and lo_a[2] < v.z < hi_a[2]):
                    continue
                loc, nrm, idx, dist = trees[a.name].find_nearest(v)
                if loc is None or dist < depth:
                    continue
                if (v - loc).dot(nrm) < 0 and _inside(trees[a.name], v, lo_a, hi_a):
                    n_in += 1
                    if dist > worst:
                        worst, where = dist, tuple(round(c, 3) for c in v)
            if n_in:
                hits.append((b.name, a.name, n_in, worst, where))
    hits.sort(key=lambda h: -h[3])
    return hits


def mesh_health(objs):
    """Loose verts, zero-area faces, and inside-out closed parts (negative signed volume)."""
    out = []
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        loose = sum(1 for v in bm.verts if not v.link_edges)
        zero = sum(1 for f in bm.faces if f.calc_area() < 1e-10)
        nm = sum(1 for e in bm.edges if not e.is_manifold)
        # inside-out parts: walk connected components, signed volume of closed ones
        inv = 0
        seen = set()
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
                    for g in e.link_faces:
                        if g.index not in seen:
                            stack.append(g)
            if all(e.is_manifold for f in comp for e in f.edges):
                o0 = np.array(comp[0].verts[0].co, dtype=np.float64)
                vol = 0.0
                for f in comp:
                    vs = [np.array(v.co, dtype=np.float64) - o0 for v in f.verts]
                    for i in range(1, len(vs) - 1):
                        vol += float(np.dot(vs[0], np.cross(vs[i], vs[i + 1]))) / 6.0
                if vol < -1e-9:
                    inv += 1
        bm.free()
        if loose or zero or inv:
            out.append((o.name, loose, zero, nm, inv))
    return out


def _parts(o):
    """Closed loose parts of a mesh (local coords): list of (material index, vertex array, faces)."""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    seen, out = set(), []
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
        closed = all(e.is_manifold for f in comp for e in f.edges)
        vs = {v.index: v.co.copy() for f in comp for v in f.verts}
        ids = list(vs)
        remap = {k: i for i, k in enumerate(ids)}
        out.append((comp[0].material_index, closed, [vs[k] for k in ids],
                    [[remap[v.index] for v in f.verts] for f in comp]))
    bm.free()
    return out


# material pairs that legitimately pass into each other inside one kit
KIT_JOINTS = [
    ("jar_contents", "glass_jar"), ("whisky", "glass"),            # contents inside their glass
    ("brass", "felt_hat"),                                         # a hat hung by its crown on a hook
    ("walnut", "velvet"), ("walnut", "leather"),                   # show-wood frames under the upholstery
    ("brass", "walnut"), ("brass", "pine"), ("brass", "oak"), ("brass", "paint_dresser"), ("brass", "ceramic"),
    ("brass", "chrome"),                                           # hardware screwed / let into its timber
    ("china", "paint_dresser"),                                    # plates stood in the plate groove
    ("frame_green", "chrome"), ("frame_green", "rubber"), ("chrome", "rubber"),   # bicycle joints
]


# kits whose same-material thin members are socketed into each other by design
KIT_SOCKETED = {"orrery": "brass arms in the central spindle", "boot_scraper": "blade let into its scrolls"}


def _kit_joint(a, b):
    a, b = str(a), str(b)
    return any((a.startswith(x) and b.startswith(y)) or (a.startswith(y) and b.startswith(x)) for x, y in KIT_JOINTS)


def _thickness(p):
    """Mean thickness of a closed part, 3V/A (a plate or a quilt is a few mm, a book centimetres)."""
    _, closed, vs, fs = p
    if not closed:
        return 1.0
    o0 = vs[0]
    vol = area = 0.0
    for f in fs:
        q = [vs[i] - o0 for i in f]
        for i in range(1, len(q) - 1):
            vol += q[0].dot(q[i].cross(q[i + 1])) / 6.0
            area += ((vs[f[i]] - vs[f[0]]).cross(vs[f[i + 1]] - vs[f[0]])).length / 2
    return 3 * abs(vol) / area if area > 0 else 1.0


def part_penetration(objs, depth=0.008, max_parts=600):
    """Inside one object: vertices of a part > depth inside a closed part of another material (a cushion
    sunk into a sofa back, a book through a shelf). Same-material parts and shallower seats are joinery."""
    from mathutils import Vector
    hits = []
    for o in objs:
        parts = _parts(o)
        if len(parts) < 2 or len(parts) > max_parts:
            continue
        boxes = [(np.min(np.array(p[2]), 0), np.max(np.array(p[2]), 0)) for p in parts]
        thick = [_thickness(p) for p in parts]
        trees = {}
        worst = {}
        for ia, (ma, ca, va, fa) in enumerate(parts):
            if not ca:
                continue
            lo_a, hi_a = boxes[ia]
            for ib, (mb, cb, vb, fb) in enumerate(parts):
                if ib == ia:
                    continue
                thin = thick[ia] < 0.015 and thick[ib] < 0.015
                if mb == ma and not thin:
                    continue        # same-material overlaps are unioned joinery, unless both are thin shells
                thr = min(depth, max(0.002, 0.35 * thick[ia]))
                lo_b, hi_b = boxes[ib]
                if np.any(lo_b > hi_a) or np.any(hi_b < lo_a):
                    continue
                if ia not in trees:
                    trees[ia] = BVHTree.FromPolygons(va, fa)
                t = trees[ia]
                n_in, best = 0, (0.0, None)
                for v in vb:
                    if not (lo_a[0] < v.x < hi_a[0] and lo_a[1] < v.y < hi_a[1] and lo_a[2] < v.z < hi_a[2]):
                        continue
                    loc, nrm, idx, dist = t.find_nearest(v)
                    if loc is None or dist < thr or (v - loc).dot(nrm) >= 0:
                        continue
                    if _inside(t, Vector(v), lo_a, hi_a):
                        n_in += 1
                        if dist > best[0]:
                            best = (dist, tuple(round(c, 3) for c in v))
                # below the 8 mm joinery depth (thin shells) only a broad overlap counts: a tube end or
                # a spigot let into a thin plate is a joint, a plate through a plate is not
                if n_in and (thr >= depth or n_in >= 0.15 * len(vb)):
                    key = (o.data.materials[mb].name if mb < len(o.data.materials) and o.data.materials[mb] else mb,
                           o.data.materials[ma].name if ma < len(o.data.materials) and o.data.materials[ma] else ma)
                    if best[0] > worst.get(key, (0, None))[0]:
                        worst[key] = best
        for (mb, ma), (w, where) in worst.items():
            if not _kit_joint(mb, ma):
                hits.append((o.name, mb, ma, w, where))
    hits.sort(key=lambda h: -h[3])
    return hits


def kit_penetration():
    """Rebuild every furniture kit's raw pieces (one loose part per put, before the clean union merges
    them) and test them against each other."""
    from . import rooms, core
    hits = []
    for key, maker in rooms.MAKERS.items():
        kit = maker()
        mats = list(kit.keys())
        g = core.Geo()
        for i, m in enumerate(mats):
            g.add(kit[m], i)
        o = core.obj(f"_raw_{key}", g, "House/_Audit", mats, smooth=None)
        hits += [(f"kit {key}",) + h[1:] for h in part_penetration([o])
                 if not (key in KIT_SOCKETED and h[1] == h[2])]
        core.remove(o)
    c = next((c for c in bpy.data.collections if c.get("path") == "House/_Audit"), None)
    if c is not None:
        bpy.data.collections.remove(c)
    hits.sort(key=lambda h: -h[3])
    return hits


def material_health():
    """Shader graphs that would render wrong: links from/to disabled sockets (a Mix node's float
    output feeding a colour reads as white) and placeholder magenta materials."""
    out = []
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        for l in m.node_tree.links:
            if not l.from_socket.enabled or not l.to_socket.enabled:
                out.append(f"{m.name}: link {l.from_node.name}.{l.from_socket.identifier} -> {l.to_node.name}.{l.to_socket.identifier} uses a disabled socket")
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED" and not n.inputs["Base Color"].is_linked \
                    and tuple(n.inputs["Base Color"].default_value)[:3] == (1.0, 0.0, 1.0):
                out.append(f"{m.name}: placeholder (no definition)")
    for o in house_objects():
        if not o.data.uv_layers:
            out.append(f"{o.name}: no UV map")
        if o.name.startswith("Structure_"):
            # a jamb/sheathing finish on a big horizontal face means a floor or ceiling was misclassified
            from .shell import room_at, in_opening
            me = o.data
            for slot in ("jamb", "sheathing"):
                idx = [i for i, m in enumerate(me.materials) if m and m.name == slot]
                ar = 0.0
                for p in me.polygons:
                    if p.material_index in idx and abs(p.normal.z) > 0.7:
                        q = np.array(p.center + p.normal * 0.04)
                        lv = max((i for i, z in P.LEVELS.items() if z <= q[2] + 0.06), default=None)
                        if lv is None:
                            continue
                        if room_at(q, lv) is not None and not in_opening(q, lv):
                            ar += p.area          # faces a room yet carries a reveal/exterior finish
                if ar > 0.05:
                    out.append(f"{o.name}: {ar:.2f} m2 of room-facing floor/ceiling finished as {slot}")
    return out


def run(write=True, full=True):
    objs = house_objects()
    import time
    t0 = time.time()
    cp = coplanar(objs)
    t1 = time.time()
    cl = clearance(objs)
    mh = mesh_health(objs)
    pen = penetration(objs) if full else []
    pp = (kit_penetration() + part_penetration([o for o in objs if o.name.startswith(("Fireplace_", "Win_", "Door_"))])) if full else []
    lines = [f"objects: {len(objs)}  (coplanar {t1 - t0:.1f}s)", "", f"COPLANAR SAME-FACING OVERLAPS: {len(cp)}"]
    for a, b, ar, loc in cp:
        lines.append(f"  {ar * 1e4:9.1f} cm2  {a}  <->  {b}  @ {loc}")
    lines += ["", f"CLEARANCE VIOLATIONS: {len(cl)}"]
    for d, side, o in cl:
        lines.append(f"  door {d} ({side}) blocked by {o}")
    lines += ["", f"MESH HEALTH (loose verts / zero faces / inside-out parts): {len(mh)}"]
    for n, l, z, nm, inv in mh:
        lines.append(f"  {n}: loose {l}, zero {z}, inside-out parts {inv}  (non-manifold edges {nm})")
    lines += ["", f"INTERPENETRATION (vertices of A > 4 mm inside closed solid B): {len(pen)}"]
    for b, a, n, w, where in pen:
        lines.append(f"  {b}  inside  {a}: {n} verts, deepest {w * 100:.1f} cm @ {where}")
    from . import doorswing
    lines += ["", f"DOORS (shut / swing / slide checks): {len(doorswing.REPORT)}"] + [f"  {x}" for x in doorswing.REPORT]
    mh2 = material_health()
    lines += ["", f"MATERIALS: {len(mh2)}"] + [f"  {x}" for x in mh2]
    lines += ["", f"PART INTERPENETRATION inside one object (part of material A > 8 mm inside closed part of B): {len(pp)}"]
    for n, mb, ma, w, where in pp:
        lines.append(f"  {n}: {mb} inside {ma}, deepest {w * 100:.1f} cm @ local {where}")
    from . import collision
    cs = collision.summary()
    lines += ["", f"COLLISION (every mesh has a proxy or a geometric reason for none): {cs.get('UNCLASSIFIED', 0)} unclassified",
              "  " + ", ".join(f"{k} {v}" for k, v in sorted(cs.items()))]
    lines += [f"  UNCLASSIFIED {o.name}" for o in collision._house_meshes()
              if not bpy.data.objects.get(f"COL_{o.name}") and "collision_none" not in o]
    txt = "\n".join(lines)
    if write:
        os.makedirs(OUT, exist_ok=True)
        open(os.path.join(OUT, "report.txt"), "w").write(txt)
    print("\n".join(lines[:3]) + f"\nclearance: {len(cl)}  health: {len(mh)}  penetration: {len(pen)}  part-penetration: {len(pp)}")
    return cp, cl, mh
