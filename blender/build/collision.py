"""Collision proxies for the engine, in House/Engine/Collision (hidden, wire display, not rendered).

Every house mesh is accounted for: it either has a proxy or carries `collision_none`, the reason it
needs none, decided by geometry (never by name). An allow-list of names left whatever it forgot
without collision (the porch steps' cheeks, then the west porch's roof, which is the balcony's
floor): the walker fell through. Proxies, as objects COL_<source> with a custom prop `collision`:
  "trimesh" - the source's own triangles (sharing its mesh; a dense one gets a remeshed, decimated copy),
  "box"     - an oriented box (furniture, curtains, window openings, door leaves),
  "ramp"    - a slab under a stair's nosing line (RAMP_DEPTH thick), so walking up a stair is a smooth
              slope. *Rejected:* a solid wedge down to the floor: it filled the space under the flight,
              and the passage under the main stair's high end to the music room's door was walled off.
Door leaf boxes are parented to their leaf, so they follow it when the engine swings the door.

Reasons for no proxy (`collision_none`), each a geometric test against the colliders built so far:
  "low"      - nowhere more than LOW above the floor under it (rugs, mats): walked over;
  "skin"     - backed by a collider: from nearly every face, a collider within SKIN straight
               behind it (siding on the walls, skirtings, pictures), and nothing wide enough to stand
               on. The body (0.3 m radius) never gets that close. Being near a collider is not
               enough: a deck lies on what holds it up and the porch's skirt frames hang under the
               deck, and neither has a collider on the walker's side.
  "opening"  - inside a window's opening box;
  "hung"     - at least HUNG above the first surface under it (a floor, a table) with no surface
               wide enough to stand on (brackets, cornices): nothing walks into it, jumps into it or
               onto it.
Whatever stands on furniture collides too (as a box): the walker can jump onto a table.
The engine checks that every drawn mesh has a proxy or a reason, and walks the house to prove the
proxies match what is seen (tests/houseCollision.test.ts).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from . import core, geo
from . import plan as P
from .windows import frame_matrix

COL = "House/Engine/Collision"

# Always solid, as their own triangles: the building's structure and what the walker stands on.
BASE = ("Structure_", "Foundation")
LOW = 0.05          # m
SKIN = 0.06         # m
HUNG = 2.6          # m: over a jumping head (1.75 + 0.78) with room
STAND = 0.3         # m: narrowest up-facing patch a body could stand on
DENSE = 6000        # faces: above this a trimesh proxy is remeshed and decimated
DENSE_TARGET = 2500


def _proxy(name, me, kind, matrix=None, parent=None):
    o = bpy.data.objects.new(name, me)
    core.coll(COL).objects.link(o)
    o["collision"] = kind
    o.display_type = "WIRE"
    o.hide_render = True
    if parent is not None:
        o.parent = parent
        o.matrix_parent_inverse = Matrix.Identity(4)
        o.matrix_basis = matrix or Matrix.Identity(4)
    elif matrix is not None:
        o.matrix_world = matrix
    return o


def _box_mesh(name, lo, hi):
    g = geo.box(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2])
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in g.V], [], [list(f) for f in g.F])
    return me


def _local_bounds(o):
    bb = np.array([tuple(c) for c in o.bound_box])
    return bb.min(0), bb.max(0)


RAMP_DEPTH = 0.25   # m: the stair's slab under its nosing line


def _ramp(stair):
    """Slab under the nosing line of a stair (the top of its treads), RAMP_DEPTH deep, from the floor it
    starts on to the floor it arrives at. Under its high end the space stays free; where it comes
    down below a head, its underside stops the body as a ceiling does."""
    tr = bpy.data.objects.get(f"{stair}_Treads")
    if tr is None:
        return
    V = np.array([tuple(tr.matrix_world @ v.co) for v in tr.data.vertices])
    lo, hi = V.min(0), V.max(0)
    ax = 0 if (hi[0] - lo[0]) > (hi[1] - lo[1]) else 1          # run axis
    cross = 1 - ax
    # nosing line: the highest point of each tread, binned along the run
    a = V[:, ax]
    bins = np.round((a - a.min()) / 0.05).astype(int)
    pts = {}
    for b, z, av in zip(bins, V[:, 2], a):
        if b not in pts or z > pts[b][1]:
            pts[b] = (av, z)
    P2 = np.array(sorted(pts.values()))
    k, c = np.polyfit(P2[:, 0], P2[:, 1], 1)                    # z = k a + c
    z_lo, z_hi = P2[:, 1].min(), P2[:, 1].max()
    floor = max(z for z in P.LEVELS.values() if z <= z_lo + 0.01)
    # up to the floor it arrives at (the last step is the landing itself)
    z_hi = min((z for z in P.LEVELS.values() if z > z_hi - 0.01), default=z_hi)
    a_floor = (floor - c) / k
    a_top = (z_hi - c) / k
    # the slab's underside: the nosing line RAMP_DEPTH lower, meeting the floor further up the run
    a_under = (floor + RAMP_DEPTH - c) / k
    prof = [(a_floor, floor), (a_top, z_hi), (a_top, z_hi - RAMP_DEPTH), (a_under, floor)]
    w0, w1 = lo[cross], hi[cross]
    verts = []
    for w in (w0, w1):
        for av, z in prof:
            p = [0.0, 0.0, z]
            p[ax], p[cross] = av, w
            verts.append(tuple(p))
    faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
    me = bpy.data.meshes.new(f"COL_{stair}")
    me.from_pydata(verts, [], faces)
    me.validate()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    _proxy(f"COL_{stair}", me, "ramp")


# ---------------------------------------------------------------- the colliders built so far

class Colliders:
    """World-space triangles of every proxy so far, in a BVH for the classification tests."""

    def __init__(self):
        self.V = []
        self.F = []
        self.tree = None

    def add(self, o):
        me = o.data
        M = o.matrix_world
        base = len(self.V)
        self.V.extend(M @ v.co for v in me.vertices)
        self.F.extend([base + i for i in p.vertices] for p in me.polygons)
        self.tree = None

    def bvh(self):
        if self.tree is None:
            self.tree = BVHTree.FromPolygons(self.V, self.F, epsilon=0.0)
        return self.tree

    def floor_below(self, p, reach=50.0):
        """Height of the first up-facing collider surface at or below p (None if none)."""
        t = self.bvh()
        org = Vector((p[0], p[1], p[2] + 0.01))
        for _ in range(8):
            loc, nrm, idx, d = t.ray_cast(org, Vector((0, 0, -1)), reach)
            if loc is None:
                return None
            if nrm.z > 0.55:
                return loc.z
            org = loc - Vector((0, 0, 0.002))
        return None

    def near(self, p, dist):
        return self.bvh().find_nearest(Vector(p), dist)[0] is not None

    def behind(self, p, n, dist):
        """A collider within `dist` straight behind p (against its normal n)?"""
        loc = self.bvh().ray_cast(p + n * 0.001, -n, dist + 0.001)[0]
        return loc is not None


def _samples(o, n=96):
    """Up to n world-space vertices of an object (evenly strided)."""
    me = o.data
    M = o.matrix_world
    k = max(1, len(me.vertices) // n)
    return [M @ me.vertices[i].co for i in range(0, len(me.vertices), k)]


def _faces(o, n=96, largest=32):
    """Points across the surface with their normals (world): face centres, evenly strided, plus the
    largest faces. (Vertices cluster where detail is: a lattice's sit at its slat ends, inside the
    frame, while the open middle of every slat has nothing behind it.)"""
    me = o.data
    M = o.matrix_world
    nm = M.to_3x3().inverted_safe().transposed()
    k = max(1, len(me.polygons) // n)
    idx = set(range(0, len(me.polygons), k))
    idx |= set(sorted(range(len(me.polygons)), key=lambda i: -me.polygons[i].area)[:largest])
    return [(M @ me.polygons[i].center, (nm @ me.polygons[i].normal).normalized()) for i in sorted(idx)]


def _standable(o):
    """Has the object an up-facing patch a body could stand on (≥ STAND across in plan)?"""
    me = o.data
    M = o.matrix_world
    nm = M.to_3x3().inverted_safe().transposed()
    bm = bmesh.new()
    bm.from_mesh(me)
    up = {f.index for f in bm.faces if (nm @ f.normal).normalized().z > 0.55}
    if not up:
        bm.free()
        return False
    bm.faces.ensure_lookup_table()
    seen = set()
    for f0 in list(up):
        if f0 in seen:
            continue
        stack, patch = [f0], []
        seen.add(f0)
        while stack:
            f = bm.faces[stack.pop()]
            patch.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index in up and g.index not in seen:
                        seen.add(g.index)
                        stack.append(g.index)
        pts = np.array([tuple((M @ v.co)[:2]) for f in patch for v in f.verts])
        c = pts - pts.mean(0)
        if len(c) < 3:
            continue
        w, V = np.linalg.eigh(np.cov(c.T))
        r = c @ V
        ext = r.max(0) - r.min(0)
        if ext.min() >= STAND:
            bm.free()
            return True
    bm.free()
    return False


def classify(o, cols, openings):
    """Why `o` needs no proxy (a reason), or None (it collides)."""
    pts = _samples(o)
    if not pts:
        return "low"
    floors = [cols.floor_below(p) for p in pts]
    fl = [f for f in floors if f is not None]
    top_above = max(p.z - (f if f is not None else 0.0) for p, f in zip(pts, floors))
    if fl and top_above <= LOW:
        return "low"
    fs = _faces(o)
    backed = sum(cols.behind(c, nv, SKIN) for c, nv in fs)
    if backed >= 0.9 * len(fs) and not _standable(o):
        return "skin"
    if all(any(all(lo[k] - 0.02 <= p[k] <= hi[k] + 0.02 for k in range(3)) for lo, hi in openings) for p in pts):
        return "opening"
    low_z = min(p.z for p in pts)
    f0 = max(fl) if fl else 0.0
    if low_z - f0 >= HUNG and not _standable(o):
        return "hung"
    return None


def _dense_proxy(o):
    """A remeshed, decimated copy of a dense mesh (balusters and rails become one solid lattice:
    the body cannot pass gaps that narrow anyway)."""
    me = o.data.copy()
    tmp = bpy.data.objects.new(f"_tmp_{o.name}", me)
    bpy.context.scene.collection.objects.link(tmp)
    tmp.matrix_world = o.matrix_world
    rm = tmp.modifiers.new("remesh", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = 0.03
    dg = bpy.context.evaluated_depsgraph_get()
    ev = tmp.evaluated_get(dg)
    m1 = bpy.data.meshes.new_from_object(ev)
    tmp.modifiers.clear()
    tmp.data = m1
    dc = tmp.modifiers.new("decimate", "DECIMATE")
    dc.ratio = min(1.0, DENSE_TARGET / max(len(m1.polygons), 1))
    dg = bpy.context.evaluated_depsgraph_get()
    ev = tmp.evaluated_get(dg)
    m2 = bpy.data.meshes.new_from_object(ev)
    m2.name = f"COL_{o.name}"
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(m1)
    return m2


def _trimesh(o, cols):
    if len(o.data.polygons) > DENSE:
        px = _proxy(f"COL_{o.name}", _dense_proxy(o), "trimesh", o.matrix_world.copy())
    else:
        px = _proxy(f"COL_{o.name}", o.data, "trimesh", o.matrix_world.copy())
    cols.add(px)


def _box(o, cols):
    lo, hi = _local_bounds(o)
    px = _proxy(f"COL_{o.name}", _box_mesh(f"COL_{o.name}", lo, hi), "box", o.matrix_world.copy())
    cols.add(px)


def _house_meshes():
    out = []
    for o in bpy.data.objects:
        if o.type != "MESH" or o.name.startswith("COL_"):
            continue
        paths = [c.get("path", "") for c in o.users_collection]
        if not any(p.startswith("House") for p in paths):
            continue
        if any(p.startswith(("House/Engine", "House/_")) or "_Prototypes" in p for p in paths):
            continue
        out.append(o)
    return out


def _furniture(o):
    return o.name.startswith(("Furn_", "Curtain_"))


def _door_leaf(o):
    return o.name.startswith("Door_") and not o.name.endswith("_Frame")


def build():
    core.clear(COL)
    cols = Colliders()
    meshes = _house_meshes()
    for o in meshes:
        if "collision_none" in o:
            del o["collision_none"]
    # 1. the structure and the stairs' ramps
    for o in meshes:
        if o.name.startswith(BASE):
            _trimesh(o, cols)
    for st in ("MainStair", "TopStair"):
        _ramp(st)
        r = bpy.data.objects.get(f"COL_{st}")
        if r:
            cols.add(r)
    # 2. window openings: a box filling each opening across the wall (the glass and sashes)
    openings = []
    for op in P.openings(ext=True):
        if op["kind"] != "window":
            continue
        M = frame_matrix(op)
        lo = (-op["w"] / 2, -P.TE, 0.0)
        hi = (op["w"] / 2, 0.0, op["head"] - op["sill"])
        px = _proxy(f"COL_Win_{op['name']}", _box_mesh(f"COL_Win_{op['name']}", lo, hi), "box", M)
        cols.add(px)
        c = [M @ Vector((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1] - 0.15, hi[1] + 0.15) for z in (lo[2], hi[2])]
        openings.append((Vector([min(v[k] for v in c) for k in range(3)]), Vector([max(v[k] for v in c) for k in range(3)])))
    # 3. door leaves: a box on the leaf, moving with it
    for o in meshes:
        if _door_leaf(o) and "Pocket" not in o.name:
            lo, hi = _local_bounds(o)
            _proxy(f"COL_{o.name}", _box_mesh(f"COL_{o.name}", lo, hi), "box", Matrix.Identity(4), parent=o)
        elif _door_leaf(o):
            o["collision_none"] = "pocket"       # slides into the wall's cavity; its jambs collide
    rest = [o for o in meshes if not o.name.startswith(BASE) and not _door_leaf(o) and not bpy.data.objects.get(f"COL_{o.name}")]
    # 4. everything standing on a floor (lowest first: what stands on it is judged against it)
    rest.sort(key=lambda o: min((o.matrix_world @ Vector(c)).z for c in o.bound_box))
    for o in rest:
        why = classify(o, cols, openings)
        if why is not None:
            o["collision_none"] = why
            continue
        if _furniture(o):
            _box(o, cols)
        else:
            _trimesh(o, cols)
    # hidden in the viewport but kept in the view layer, so an export still sees the proxies
    lc = core._layer_coll(bpy.context.view_layer.layer_collection, core.coll(COL).name)
    if lc:
        lc.hide_viewport = True


def summary():
    """Counts by class (for the audit)."""
    from collections import Counter
    c = Counter()
    for o in _house_meshes():
        if bpy.data.objects.get(f"COL_{o.name}"):
            c[bpy.data.objects[f"COL_{o.name}"]["collision"]] += 1
        elif "collision_none" in o:
            c["none:" + o["collision_none"]] += 1
        else:
            c["UNCLASSIFIED"] += 1
    return dict(c)
