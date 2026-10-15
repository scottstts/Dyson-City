"""Collision proxies for the engine, in House/Engine/Collision (hidden, wire display, not rendered).

Every proxy is a mesh object named COL_<source> with a custom prop `collision`:
  "trimesh" - static triangle mesh sharing the source's mesh data (walls, floors, decks, breasts),
  "box"     - an oriented box (furniture standing on a floor, window openings, door leaves),
  "ramp"    - a solid wedge under a stair's nosing line, so walking up a stair is a smooth slope.
Door leaf boxes are parented to their leaf, so they follow it when the engine swings the door.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import core, geo
from . import plan as P
from .windows import frame_matrix

COL = "House/Engine/Collision"

TRIMESH = ("Structure_", "Foundation", "Porch_Deck", "WestPorch_Deck", "RearStoop_Deck", "Porch_Steps",
           "Porch_StepCheeks", "Porch_Columns", "Porch_Railings", "WestPorch_Columns", "WestPorch_Balustrade",
           "RearStoop_Steps")
# furniture too low, too small or hung (not standing on a floor) to block a walker
SKIP_FURN = ("Rug", "Runner", "Pendant", "Picture", "Lamp", "Kettle", "Pot", "Books", "Vase", "Candle",
             "Fruit", "Tea", "Clock", "Mirror", "Orrery", "Shelf", "Towels", "WateringCan", "Mat", "Scraper",
             "OverBed", "Chart", "Hat")


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


def _ramp(stair):
    """Wedge under the nosing line of a stair (the top of its treads), down to the floor it starts on."""
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
    a0, a1 = sorted((a_floor, a_top))
    prof = [(a_floor, floor), (a_top, z_hi), (a_top, floor)]
    w0, w1 = lo[cross], hi[cross]
    verts = []
    for w in (w0, w1):
        for av, z in prof:
            p = [0.0, 0.0, z]
            p[ax], p[cross] = av, w
            verts.append(tuple(p))
    faces = [[0, 1, 2], [5, 4, 3], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]]
    me = bpy.data.meshes.new(f"COL_{stair}")
    me.from_pydata(verts, [], faces)
    me.validate()
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    _proxy(f"COL_{stair}", me, "ramp")


def build():
    core.clear(COL)
    for o in list(bpy.data.objects):
        if o.type != "MESH" or not any(c.get("path", "").startswith("House") for c in o.users_collection):
            continue
        if any(c.get("path", "").startswith("House/Engine") for c in o.users_collection):
            continue
        n = o.name
        if n.startswith(TRIMESH) or (n.startswith("Fireplace_") and n.endswith(("_Breast", "_Range"))):
            _proxy(f"COL_{n}", o.data, "trimesh", o.matrix_world.copy())
        elif n.startswith("Furn_") and not any(s in n.split("_", 2)[-1] for s in SKIP_FURN):
            lo, hi = _local_bounds(o)
            base = (o.matrix_world @ Vector(lo)).z
            on_floor = any(abs(base - z) < 0.06 for z in list(P.LEVELS.values()) + [P.PORCH])
            if on_floor and hi[2] - lo[2] > 0.25:
                _proxy(f"COL_{n}", _box_mesh(f"COL_{n}", lo, hi), "box", o.matrix_world.copy())
        elif n.startswith("Door_") and not n.endswith("_Frame") and "Pocket" not in n:
            lo, hi = _local_bounds(o)
            _proxy(f"COL_{n}", _box_mesh(f"COL_{n}", lo, hi), "box", Matrix.Identity(4), parent=o)
    # window openings: a box filling each opening across the wall (the glass and sashes)
    for op in P.openings(ext=True):
        if op["kind"] != "window":
            continue
        M = frame_matrix(op)
        lo = (-op["w"] / 2, -P.TE, 0.0)
        hi = (op["w"] / 2, 0.0, op["head"] - op["sill"])
        _proxy(f"COL_Win_{op['name']}", _box_mesh(f"COL_Win_{op['name']}", lo, hi), "box", M)
    for st in ("MainStair", "TopStair"):
        _ramp(st)
    # hidden in the viewport but kept in the view layer, so an export still sees the proxies
    lc = core._layer_coll(bpy.context.view_layer.layer_collection, core.coll(COL).name)
    if lc:
        lc.hide_viewport = True
