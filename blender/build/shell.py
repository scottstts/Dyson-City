"""Structure: foundation and one watertight wall+slab solid per storey (exact CSG).

Each storey solid = its envelope minus room volumes minus openings. Faces are then classified:
room floors/walls/ceilings get the room's finish, exterior faces get 'sheathing' (always covered
by siding or trim), and reveals get 'jamb'.
"""
import math

import bmesh
import numpy as np

from . import core, geo
from . import plan as P

COL = "House/Structure"


# ---------------------------------------------------------------- envelopes

def mansard_rings(inset_pairs, x0, y0, x1, y1):
    rings = []
    for z, d in inset_pairs:
        rings.append([(x0 + d, y0 + d, z), (x1 - d, y0 + d, z), (x1 - d, y1 - d, z), (x0 + d, y1 - d, z)])
    return rings


def mansard_outer(grow=0.0):
    """The mansard's outer surface; grow > 0 offsets the sloped faces outward (e.g. to the slate top)."""
    x0, y0, x1, y1 = P.M
    d1 = (P.MANSARD_BREAK - P.CORNICE_TOP) / math.tan(P.MANSARD_LOWER)
    d2 = d1 + (P.DECK - P.MANSARD_BREAK) / math.tan(P.MANSARD_UPPER)
    gl = grow / math.sin(P.MANSARD_LOWER)
    gu = grow / math.cos(P.MANSARD_UPPER)
    return geo.loft(mansard_rings([(P.L2, -grow), (P.CORNICE_TOP, -gl), (P.MANSARD_BREAK + gu * 0.5, d1 - gl),
                                   (P.DECK + gu, d2 - gl)], x0, y0, x1, y1))


def mansard_inner_rings():
    t1, t2 = math.tan(P.MANSARD_LOWER), math.tan(P.MANSARD_UPPER)
    d1 = (P.MANSARD_BREAK - P.CORNICE_TOP) / t1
    off_l = P.TROOF / math.sin(P.MANSARD_LOWER)
    off_u = P.TROOF / math.cos(P.MANSARD_UPPER)
    # lower inner plane: d = off_l + (z - cornice)/t1 ; upper inner plane: z = break - off_u + (d - d1) * t2
    z_v = P.CORNICE_TOP + (P.TE - off_l) * t1
    # intersection of the two inner planes
    a = 1 - t2 / t1
    d_x = (off_l + (P.MANSARD_BREAK - off_u - d1 * t2 - P.CORNICE_TOP) / t1) / a
    z_x = P.MANSARD_BREAK - off_u + (d_x - d1) * t2
    d_top = d1 + (P.DECK - P.MANSARD_BREAK) / t2
    z_top = P.DECK - off_u
    return [(P.L2 - 0.05, P.TE), (z_v, P.TE), (z_x, d_x), (z_top, d_top)]


def mansard_inner():
    x0, y0, x1, y1 = P.M
    return geo.loft(mansard_rings(mansard_inner_rings(), x0, y0, x1, y1))


def gable_profile(x0, x1, zb, ridge):
    xm = (x0 + x1) / 2
    return [(x0, zb), (x1, zb), (xm, ridge)]


GABLE_BACK = 4.6   # how far back (y) the cross gable's roof runs into the mansard


def c_outer():
    x0, y0, x1, y1 = P.C
    boxg = geo.box(x0, y0, P.L2, x1, 0.4, P.CORNICE_TOP)
    tri = [(x0, P.CORNICE_TOP - 0.001), (x1, P.CORNICE_TOP - 0.001), ((x0 + x1) / 2, P.GABLE_RIDGE)]
    g = geo.extrude_profile_y(tri, y0, GABLE_BACK)
    return core.merge(boxg, g)


def c_pitch():
    x0, _, x1, _ = P.C
    return math.atan2(P.GABLE_RIDGE - P.CORNICE_TOP, (x1 - x0) / 2)


def c_inner():
    x0, y0, x1, y1 = P.C
    p = c_pitch()
    dz = P.TROOF / math.cos(p)
    tp = math.tan(p)
    xi0, xi1 = x0 + P.TE, x1 - P.TE
    zl = P.CORNICE_TOP - dz + (xi0 - x0) * tp
    xm = (x0 + x1) / 2
    apex = P.CORNICE_TOP - dz + (xm - x0) * tp
    prof = [(xi0, P.L2 - 0.05), (xi1, P.L2 - 0.05), (xi1, zl), (xm, apex), (xi0, zl)]
    return geo.extrude_profile_y(prof, y0 + P.TE, GABLE_BACK - 0.3)


def cone_outer_r(z):
    return P.TR2 * (P.TURRET_APEX - z) / (P.TURRET_APEX - P.TURRET_TOP)


def turret_outer():
    cx, cy = P.TURRET
    cyl = geo.lathe([(0, P.L2), (P.TR2, P.L2), (P.TR2, P.TURRET_TOP), (0.0, P.TURRET_APEX)], seg=72)
    return cyl.move(cx, cy, 0)


def turret_inner_profile():
    h = P.TURRET_APEX - P.TURRET_TOP
    ang = math.atan2(h, P.TR2)
    off = P.TROOF / math.sin(ang)
    r_in = P.TR2 - P.TE

    def rin(z):
        return cone_outer_r(z) - off

    # z where the cone's inner surface meets the cylinder's inner face
    zc = P.TURRET_APEX - (r_in + off) * h / P.TR2
    za = P.TURRET_APEX - off * h / P.TR2
    return [(0, P.L2 - 0.05), (r_in, P.L2 - 0.05), (r_in, zc), (0.0, za)], zc, za


def turret_inner():
    cx, cy = P.TURRET
    prof, _, _ = turret_inner_profile()
    return geo.lathe(prof, seg=72).move(cx, cy, 0)


# dormers -----------------------------------------------------------------------------------
DORMER_W = 1.7          # outer width of the dormer cheeks
DORMER_EAVE = 12.25
DORMER_RIDGE = 13.05
DORMER_DEPTH = 2.2      # how far the dormer runs back into the mansard


def dormer_frame(d):
    """(origin on the wall line, outward unit normal, along unit) for a dormer spec."""
    name, a, b, side, w = d
    if side == "front":
        return np.array([a, b]), np.array([0.0, -1.0]), np.array([1.0, 0.0])
    if side == "back":
        return np.array([a, b]), np.array([0.0, 1.0]), np.array([-1.0, 0.0])
    if side == "right":
        return np.array([a, b]), np.array([1.0, 0.0]), np.array([0.0, 1.0])
    return np.array([a, b]), np.array([-1.0, 0.0]), np.array([0.0, -1.0])


def dormer_solid(d, inner=False):
    o, n, t = dormer_frame(d)
    hw = DORMER_W / 2 - (0.12 if inner else 0.0)
    face = P.DORMER_SET + (0.24 if inner else 0.0)
    back = DORMER_DEPTH + (0.3 if inner else 0.0)
    z0 = P.L2 if inner else P.CORNICE_TOP - 0.05
    eave = DORMER_EAVE - (0.18 if inner else 0.0)
    ridge = DORMER_RIDGE - (0.22 if inner else 0.0)
    prof = [(-hw, z0), (hw, z0), (hw, eave), (0.0, ridge), (-hw, eave)]
    # build in a local frame: x along t, y inward (-n), then place
    g = geo.extrude_profile_y(prof, face, back)
    M = np.array([[t[0], -n[0], 0, o[0]], [t[1], -n[1], 0, o[1]], [0, 0, 1, 0], [0, 0, 0, 1.0]])
    from mathutils import Matrix
    return g.xf(Matrix(M.tolist()))


# ---------------------------------------------------------------- cutters

def room_prism(r, piece, z1=None):
    z0 = P.LEVELS[r["level"]]
    return geo.prism(piece, z0, z1 if z1 is not None else r["ceil"])


def opening_box(o, depth_out=0.35, depth_in=0.65, extra=0.0):
    """Rough-opening cutter in world space."""
    z0 = P.LEVELS[o["level"]] + o["sill"]
    z1 = P.LEVELS[o["level"]] + o["head"]
    a = o["ang"]
    n = np.array([math.cos(a), math.sin(a)])
    t = np.array([-n[1], n[0]])
    p = np.array(o["p"])
    hw = o["w"] / 2 + extra
    if not o["ext"]:
        th = o.get("thick", P.TI)
        depth_out = depth_in = th / 2 + 0.25
    corners = [p - t * hw - n * depth_in, p + t * hw - n * depth_in, p + t * hw + n * depth_out, p - t * hw + n * depth_out]
    return geo.prism([tuple(c) for c in corners], z0, z1)


def pocket_boxes(o):
    """The cavities in the wall either side of a pocket-door opening that the leaves slide into."""
    from .doors import POCKET_GAP
    z0 = P.LEVELS[o["level"]] + o["sill"]
    z1 = P.LEVELS[o["level"]] + o["head"]
    a = o["ang"]
    n = np.array([math.cos(a), math.sin(a)])
    t = np.array([-n[1], n[0]])
    p = np.array(o["p"])
    hw = o["w"] / 2
    out = []
    for sg in (-1, 1):
        t0, t1 = hw - 0.04, o["w"] + 0.03
        c = [p + t * sg * t0 - n * POCKET_GAP, p + t * sg * t1 - n * POCKET_GAP,
             p + t * sg * t1 + n * POCKET_GAP, p + t * sg * t0 + n * POCKET_GAP]
        out.append(geo.prism(geo.ccw([tuple(q) for q in c]), z0, z1))
    return out


def stair_void(st, z0, z1, open_side="x0"):
    """Void in the floor above a stair, wide enough for its open string (0.04 on the open side)."""
    run = (st["risers"] // 2 - 1) * st["going"] * 2 + st["landing"]
    x0 = st["x0"] - (0.04 if open_side == "x0" else 0.0)
    x1 = st["x1"] + (0.04 if open_side == "x1" else 0.0)
    return geo.box(x0, st["y0"], z0, x1, st["y0"] + run, z1)


# ---------------------------------------------------------------- classification

def _pip(pt, poly):
    x, y = pt
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-300) + xi:
            inside = not inside
        j = i
    return inside


def room_at(p3, level_hint=None):
    for r in P.ROOMS:
        if level_hint is not None and r["level"] != level_hint:
            continue
        z0 = P.LEVELS[r["level"]]
        ztop = 20.0 if r["level"] == 2 else r["ceil"]
        if not (z0 - 0.02 <= p3[2] <= ztop + 0.02):
            continue
        for pc in r["pieces"]:
            if _pip(p3[:2], pc):
                return r
    return None


def classify(o, level):
    """Assign material slots per face: room finishes, ceilings, exterior sheathing, jambs."""
    slots = ["sheathing", "jamb", "ceiling_plaster"]
    fin = {}
    for r in P.rooms(level) + (P.rooms(level + 1) if level + 1 < len(P.LEVELS) else []):
        for m in (r["wall"], r["floor"]):
            if m not in slots:
                slots.append(m)
    me = o.data
    me.materials.clear()
    from . import mat as MT
    for s in slots:
        me.materials.append(MT.get(s))
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        probe = np.array(c + n * 0.04)
        r = room_at(probe, level)
        if r is None and level + 1 < len(P.LEVELS) and probe[2] > P.LEVELS[level + 1] - 0.05:
            r = room_at(probe, level + 1)        # this storey's slab top is the floor of the room above
        if r is not None:
            if n.z > 0.7:
                f.material_index = slots.index(r["floor"])
            elif n.z < -0.7:
                f.material_index = slots.index("ceiling_plaster")
            else:
                f.material_index = slots.index(r["wall"])
        elif in_opening(probe, level):
            f.material_index = slots.index("jamb")
        else:
            f.material_index = slots.index("sheathing") if is_exterior(probe, level) else slots.index("jamb")
    bm.to_mesh(me)
    bm.free()


_OUTLINE = None


def is_exterior(p3, level):
    global _OUTLINE
    if level == 2:
        return True
    if _OUTLINE is None:
        _OUTLINE = P.outline01()
    return not _pip(p3[:2], _OUTLINE) or p3[2] > P.L2 + 0.01


def in_opening(p3, level):
    for o in P.openings(level):
        z0 = P.LEVELS[level] + o["sill"] - 0.01
        z1 = P.LEVELS[level] + o["head"] + 0.01
        if not (z0 <= p3[2] <= z1):
            continue
        a = o["ang"]
        n = np.array([math.cos(a), math.sin(a)])
        t = np.array([-n[1], n[0]])
        d = np.array(p3[:2]) - np.array(o["p"])
        th = o.get("thick", P.TI) if not o["ext"] else P.TE
        lo, hi = (-th - 0.05, 0.05) if o["ext"] else (-th / 2 - 0.05, th / 2 + 0.05)
        if abs(float(d @ t)) <= o["w"] / 2 + 0.01 and lo <= float(d @ n) <= hi:
            return True
    return False


# ---------------------------------------------------------------- builders

def build_foundation():
    core.clear(f"{COL}/Foundation")
    ol = geo.offset(geo.ccw(P.outline01()), 0.06)
    g = geo.prism(ol, P.GRADE - 0.3, P.FOUND_TOP)
    o = core.obj("Foundation", g, f"{COL}/Foundation", "sandstone", smooth=None)
    return o


def build_level(level):
    name = ["Structure_G", "Structure_L1", "Structure_L2"][level]
    core.clear(f"{COL}/{name}")
    col = f"{COL}/{name}"
    z0 = P.LEVELS[level]
    if level == 0:
        env = geo.prism(P.outline01(), P.FOUND_TOP, P.L1)
        envo = core.geo_obj(env, "_env")
    elif level == 1:
        env = geo.prism(P.outline01(), P.L1, P.L2)
        envo = core.geo_obj(env, "_env")
        wings = [core.geo_obj(geo.box(P.B[0], P.B[1], P.L2 - 0.01, P.B[2], P.B[3], P.EAVE_WING), "_wb"),
                 core.geo_obj(geo.box(P.E[0], P.E[1], P.L2 - 0.01, P.E[2], P.E[3], P.EAVE_WING), "_we")]
        core.boolean(envo, wings, op="UNION")
        # over the bays the wall head stops at the bay cornice's top, where the bay roofs sit
        from .cornice import BAY_CORNICE_S
        zb = P.L1 + 2.95 + 1.05 * BAY_CORNICE_S
        cut = []
        for bay in (P.BAY_FRONT, P.BAY_BACK):
            wy = bay[0][1]
            iy = 1.0 if bay[1][1] < wy else -1.0
            poly = [tuple(p) for p in bay] + [(bay[3][0], wy + iy * 0.0), (bay[0][0], wy + iy * 0.0)]
            cut.append(core.geo_obj(geo.prism(geo.offset(geo.ccw(geo.dedupe(poly)), 0.01), zb, P.L2 + 0.1), "_bc"))
        core.boolean(envo, cut, op="DIFFERENCE")
    else:
        envo = core.geo_obj(mansard_outer(), "_env")
        parts = [core.geo_obj(c_outer(), "_c"), core.geo_obj(turret_outer(), "_t")]
        parts += [core.geo_obj(dormer_solid(d), f"_d{d[0]}") for d in P.DORMERS]
        core.boolean(envo, parts, op="UNION")
    # room cutters
    cutters = []
    if level < 2:
        for r in P.rooms(level):
            for pc in r["pieces"]:
                cutters.append(core.geo_obj(room_prism(r, pc), "_room"))
    else:
        inner = core.geo_obj(mansard_inner(), "_inner")
        core.boolean(inner, [core.geo_obj(c_inner(), "_ci"), core.geo_obj(turret_inner(), "_ti")]
                     + [core.geo_obj(dormer_solid(d, inner=True), "_di") for d in P.DORMERS], op="UNION")
        for r in P.rooms(2):
            for i, pc in enumerate(r["pieces"]):
                top = 19.0 if (r.get("cone") and i == 0) else r["ceil"]
                rp = core.geo_obj(room_prism(r, pc, top), "_room")
                core.boolean(rp, [core.dup(inner)], op="INTERSECT")
                cutters.append(rp)
        # dormer alcoves: the dormer interior up to its own ceiling, wherever it meets a room
        for d in P.DORMERS:
            dp = core.geo_obj(dormer_solid(d, inner=True), "_dal")
            cutters.append(dp)
        core.remove(inner)
    # openings
    for o in P.openings(level):
        cutters.append(core.geo_obj(opening_box(o), "_open"))
        if o["kind"] == "pocket":
            for pb in pocket_boxes(o):
                cutters.append(core.geo_obj(pb, "_pocket"))
    if level == 2:
        for d in P.DORMERS:
            cutters.append(core.geo_obj(dormer_window_box(d), "_dw"))
    # stair voids
    if level == 0:
        cutters.append(core.geo_obj(stair_void(P.STAIR_MAIN, P.CEIL[0] - 0.05, P.L1 + 0.05), "_void"))
    if level == 1:
        cutters.append(core.geo_obj(stair_void(P.STAIR_TOP, P.CEIL[1] - 0.05, P.L2 + 0.05, open_side="x1"), "_void"))
    core.boolean(envo, cutters, op="DIFFERENCE")
    envo.name = name
    envo.data.name = name
    for c in list(envo.users_collection):
        c.objects.unlink(envo)
    core.coll(col).objects.link(envo)
    classify(envo, level)
    core.smooth_by_angle(envo, 30)
    core.finish_tmp()
    return envo


def dormer_window_box(d):
    o, n, t = dormer_frame(d)
    w = d[4]
    p = o - n * P.DORMER_SET
    z0 = P.L2 + P.DORMER_SILL
    z1 = P.L2 + P.DORMER_HEAD
    corners = [p - t * w / 2 - n * 0.5, p + t * w / 2 - n * 0.5, p + t * w / 2 + n * 0.3, p - t * w / 2 + n * 0.3]
    return geo.prism([tuple(c) for c in corners], z0, z1)


def build():
    build_foundation()
    for lv in (0, 1, 2):
        build_level(lv)
