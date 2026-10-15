"""Door travel limits, found by sweeping each leaf through its opening against everything around it.

Run after the furniture is placed. For every hinged leaf the leaf is turned from shut in its opening
direction in 1-degree steps until it would touch a wall, a piece of furniture, a fireplace, a window or
another door's frame; `open_max` (signed radians) is the last clear angle less a small margin, and the
rest pose is clamped to it. Sliding (pocket) leaves are checked shut and fully open. Problems (a leaf
that cannot shut, or that opens less than 80 degrees) are kept in REPORT for the audit.
"""
import math

import bmesh
import bpy
from mathutils import Matrix
from mathutils.bvhtree import BVHTree

REPORT = []
STEP = math.radians(1.0)
MARGIN = math.radians(2.0)
LIMIT = math.radians(170.0)
# leaf geometry is shrunk this much about its own centre for the test: it runs in 3 mm gaps
SHRINK = 0.004


def _bvh(o, matrix=None):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.transform(matrix if matrix is not None else o.matrix_world)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def _obstacles():
    out = []
    for o in bpy.data.objects:
        if o.type != "MESH" or not any(c.get("path", "").startswith("House") for c in o.users_collection):
            continue
        if any("_Prototypes" in c.get("path", "") or c.get("path", "").startswith("House/Engine") for c in o.users_collection):
            continue
        n = o.name
        if n.startswith(("Structure_", "Fireplace_", "Win_", "Skirting", "Wainscot", "DadoRail", "Curtain_")) \
                or (n.startswith("Furn_") and not any(k in n for k in ("Rug", "Runner", "Pendant", "Picture"))) \
                or (n.startswith("Door_") and n.endswith("_Frame")) or n.startswith(("MainStair_", "TopStair_")):
            lo = [min((o.matrix_world @ v.co)[k] for v in o.data.vertices) for k in range(3)] if o.data.vertices else None
            hi = [max((o.matrix_world @ v.co)[k] for v in o.data.vertices) for k in range(3)] if o.data.vertices else None
            if lo is not None:
                out.append((o, lo, hi))
    return out


def _shrunk(leaf):
    """Leaf mesh in rig space, shrunk about its bounding-box centre by SHRINK on every side."""
    vs = [v.co for v in leaf.data.vertices]
    lo = [min(v[k] for v in vs) for k in range(3)]
    hi = [max(v[k] for v in vs) for k in range(3)]
    c = [(lo[k] + hi[k]) / 2 for k in range(3)]
    s = [max(0.5, 1 - 2 * SHRINK / max(hi[k] - lo[k], 1e-6)) for k in range(3)]
    return Matrix.Translation(c) @ Matrix.Diagonal((*s, 1.0)) @ Matrix.Translation([-x for x in c])


def _hits(leaf, rig_m, pose, obstacles, cache, skip):
    m = rig_m @ pose @ _shrunk(leaf)
    t = _bvh(leaf, m)
    # world bounds of the posed leaf for a quick reject
    pts = [m @ v.co for v in leaf.data.vertices]
    lo = [min(p[k] for p in pts) for k in range(3)]
    hi = [max(p[k] for p in pts) for k in range(3)]
    for o, olo, ohi in obstacles:
        if o.name in skip:
            continue
        if any(olo[k] > hi[k] or ohi[k] < lo[k] for k in range(3)):
            continue
        if o.name not in cache:
            cache[o.name] = _bvh(o)
        if t.overlap(cache[o.name]):
            return o.name
    return None


def _handle(leaf):
    """`handle`: where a hand takes the leaf, in leaf-local metres (the knob or the pull, 1.0 m up)."""
    xs = [v.co.x for v in leaf.data.vertices]
    if leaf.get("kind") == "slide":
        x = 0.06 if max(xs) > -min(xs) else -0.06            # cup pull beside the lead edge
    else:
        x = max(xs) - 0.075 if max(xs) > -min(xs) else min(xs) + 0.075   # knob near the latch edge
    leaf["handle"] = [round(x, 4), 0.0, 1.008]


def build():
    REPORT.clear()
    obstacles = _obstacles()
    cache = {}
    leaves = [o for o in bpy.data.objects if o.name.startswith("Door_") and o.get("kind") in ("hinge", "slide")]
    for leaf in leaves:
        _handle(leaf)
        rig = leaf.parent
        if rig is None:
            REPORT.append(f"{leaf.name}: no rig")
            continue
        base = leaf.name.rsplit("_", 1)[0] if leaf.name.endswith(("_L", "_R")) else leaf.name
        skip = {base + "_Frame", leaf.name}
        rm = rig.matrix_world.copy()
        if leaf["kind"] == "slide":
            for label, x in (("shut", 0.0), ("open", leaf["travel"])):
                hit = _hits(leaf, rm, Matrix.Translation((x, 0, 0)), obstacles, cache, skip)
                if hit:
                    REPORT.append(f"{leaf.name}: blocked {label} by {hit}")
            continue
        hit = _hits(leaf, rm, Matrix.Identity(4), obstacles, cache, skip)
        if hit:
            REPORT.append(f"{leaf.name}: cannot shut, touches {hit}")
        sign = 1 if leaf["swing"] > 0 else -1
        a = 0.0
        stop = None
        while a + STEP <= LIMIT:
            hit = _hits(leaf, rm, Matrix.Rotation(sign * (a + STEP), 4, "Z"), obstacles, cache, skip)
            if hit:
                stop = hit
                break
            a += STEP
        open_max = max(0.0, a - (MARGIN if stop else 0.0))
        leaf["open_max"] = sign * round(open_max, 4)
        leaf["stopped_by"] = stop or ""
        if open_max < math.radians(80):
            REPORT.append(f"{leaf.name}: opens only {math.degrees(open_max):.0f} deg (stopped by {stop})")
        rest = leaf.get("open_angle", 0.0)
        if abs(rest) > open_max:
            leaf["open_angle"] = sign * open_max
            leaf.matrix_basis = Matrix.Rotation(leaf["open_angle"], 4, "Z")
