"""Doors: frames, panelled/glazed leaves (separate objects pivoting on their hinge axis), hardware,
exterior and interior casings, cased openings (with fretwork spandrels) and pocket-door openings.

Engine contract: every leaf is an object named `Door_<opening>[_L|_R]` whose origin is on its hinge
axis at floor level, local Z up; custom props: hinge ('L'|'R'), swing (sign of the rotation about the
local Z axis that opens the leaf), open_angle (rest pose, radians, 0 = shut). The object's rest rotation
already includes open_angle; the shut pose is open_angle = 0.
"""
import math

import numpy as np
from mathutils import Matrix

from . import core, geo
from . import plan as P
from .windows import (box, ext_trim, int_trim, frame_matrix, room_for_opening, _raised_panel, sash,
                      WALNUT_ROOMS, CASING)

COL = "House/Exterior/Doors"
COL_INT = "House/Interior/Doors"
COL_LEAF = "House/Doors"

LEAF_T = 0.05
KNUCKLE = 0.005        # hinge pin axis: this far proud of the leaf face it swings towards


# ---------------------------------------------------------------- leaf construction

def _stick_ring(x0, x1, z0, z1, yface, sgn, s=0.014):
    """Sticking moulding (quarter-round + fillet) round a panel opening on one face.
    sgn=+1 for the +y face, -1 for the -y face."""
    prof = [(0.0, 0.0), (0.004, 0.0), (0.011, 0.003), (0.014, 0.008), (0.014, s), (0.0, s)]
    # path: rectangle inside the opening, moulding lies on the panel face, against the frame
    path = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    # build a closed sweep in the x-z plane with fixed right = +y*sgn (outward of that face)
    pts3 = [(x, yface, z) for x, z in path]
    # profile (o along face normal, h inward from the frame edge). For a CCW loop in x-z seen from
    # +y, inward is to the left; use right=(0, sgn, 0): local up = right x tangent.
    pr = [(o, -h) for o, h in prof]
    pr = geo.ccw(pr)
    g = geo.sweep(pr, pts3 if sgn > 0 else pts3[::-1], closed=True, right=(0, sgn, 0))
    return g


def leaf(w, h, t=LEAF_T, rows=None, stile=0.12, glass_arch=False):
    """A stile-and-rail door leaf, hinge edge at x=0, leaf spanning x in [0, w], faces at y=±t/2.
    rows: list of (height_fraction_or_m, kind) bottom to top between rails; kind in
    'panel' | 'panel2' (two side by side) | 'glass' | 'glass_arch'.
    Returns dict: wood, glass."""
    rows = rows or [(0.32, "panel2"), (0.55, "panel2")]
    wood, glass = core.Geo(), core.Geo()
    yb, yf = -t / 2, t / 2
    bot_rail, top_rail, mid_rail = 0.24, 0.13, 0.17
    wood.add(box(0, stile, yb, yf, 0, h))
    wood.add(box(w - stile, w, yb, yf, 0, h))
    # rails and panels
    avail = h - bot_rail - top_rail - mid_rail * (len(rows) - 1)
    tot = sum(r[0] for r in rows)
    z = bot_rail
    wood.add(box(stile, w - stile, yb, yf, 0, bot_rail))
    for i, (frac, kind) in enumerate(rows):
        hh = avail * frac / tot
        z0, z1 = z, z + hh
        if kind == "panel2":
            mw = 0.1
            xs = [(stile, (w - mw) / 2), ((w + mw) / 2, w - stile)]
            wood.add(box((w - mw) / 2, (w + mw) / 2, yb, yf, z0, z1))
        else:
            xs = [(stile, w - stile)]
        for xa, xb in xs:
            if kind.startswith("glass"):
                if kind == "glass_arch":
                    _arched_glass(wood, glass, xa, xb, z0, z1, t)
                else:
                    gw, gg, gp = sash(xa, xb, z0, z1, t / 2, "fixed", muntins=0)
                    glass.add(gg)
                    wood.add(_stick_ring(xa, xb, z0, z1, yf, 1))
                    wood.add(_stick_ring(xa, xb, z0, z1, yb, -1))
            else:
                # panel: thin board with raised fields both sides
                pt = t * 0.4
                wood.add(box(xa, xb, -pt / 2, pt / 2, z0, z1))
                wood.add(_raised_panel(xa + 0.016, xb - 0.016, z0 + 0.016, z1 - 0.016, pt / 2, t / 2 - pt / 2 - 0.002))
                rp = _raised_panel(xa + 0.016, xb - 0.016, z0 + 0.016, z1 - 0.016, pt / 2, t / 2 - pt / 2 - 0.002)
                rp = rp.xf(Matrix.Scale(-1, 4, (0, 1, 0)))
                wood.add(rp)
                # filler between panel and frame faces under the sticking
                wood.add(_stick_ring(xa, xb, z0, z1, yf, 1))
                wood.add(_stick_ring(xa, xb, z0, z1, yb, -1))
        z = z1
        if i < len(rows) - 1:
            wood.add(box(stile, w - stile, yb, yf, z, z + mid_rail))
            z += mid_rail
    wood.add(box(stile, w - stile, yb, yf, z, h))
    return {"wood": wood, "glass": glass}


def _arched_glass(wood, glass, xa, xb, z0, z1, t):
    """Glass with a segmental arched head; the spandrels above the arch are solid wood."""
    n = 16
    w = xb - xa
    rise = min(0.18, w * 0.35)
    zs = z1 - rise
    c = (xa + xb) / 2
    R = (w * w / 4 + rise * rise) / (2 * rise)
    zc = z1 - R
    arc = []
    for i in range(n + 1):
        x = xa + w * i / n
        arc.append((x, zc + math.sqrt(max(R * R - (x - c) ** 2, 0))))
    # glass outline polygon (x, z)
    poly = [(xa, z0), (xb, z0)] + arc[::-1]
    poly = poly[:2] + poly[2:]
    ys = (-0.0025, 0.0025)
    g = geo.extrude_profile_y(geo.ccw(poly), ys[0], ys[1])
    glass.add(g)
    # spandrel wood: region between arc and z1 rectangle, full leaf thickness
    sp = [(xa, zs - 0.001)] + [(x, z) for x, z in arc] + [(xb, z1), (xa, z1)]
    sp = [(xa, arc[0][1])] + arc[1:] + [(xb, z1), (xa, z1)]
    wood.add(geo.extrude_profile_y(geo.ccw(sp), -t / 2, t / 2))
    # glazing beads on both faces following the outline
    path = [(xa, z0), (xb, z0)] + arc[::-1]
    for sgn in (1, -1):
        yf = sgn * t / 2
        pts3 = [(x, yf - sgn * 0.0, z) for x, z in (path if sgn > 0 else path[::-1])]
        pr = geo.ccw([(0.0, 0.0), (0.012, 0.0), (0.012, 0.004), (0.004, 0.012), (0.0, 0.012)])
        pr = [(o - 0.0, -h) for o, h in pr]
        wood.add(geo.sweep(geo.ccw(pr), pts3, closed=True, right=(0, sgn, 0)))
    # fill the gap between glass plane and faces (rebate): wood frame ring around the glass edge
    ring_out = [(xa, z0), (xb, z0)] + arc[::-1]


def knob(material_hint="brass"):
    """Door knob on a rose, along +y from y=0 (as a lathe about y)."""
    prof = [(0.0, 0.0), (0.03, 0.0), (0.03, 0.006), (0.024, 0.01), (0.009, 0.014), (0.008, 0.045),
            (0.02, 0.052), (0.028, 0.065), (0.026, 0.078), (0.016, 0.085), (0.0, 0.087)]
    g = geo.lathe(prof, seg=24)
    return g.xf(Matrix.Rotation(-math.pi / 2, 4, "X"))


def hinge(h=0.11):
    """Butt hinge knuckle on the hinge line at x=0 (vertical cylinder with finials)."""
    prof = [(0.0, -h / 2 - 0.012), (0.004, -h / 2 - 0.012), (0.007, -h / 2 - 0.004), (0.009, -h / 2),
            (0.009, h / 2), (0.007, h / 2 + 0.004), (0.004, h / 2 + 0.012), (0.0, h / 2 + 0.012)]
    return geo.lathe(prof, seg=16)


def escutcheon():
    prof = [(0.0, 0.0), (0.016, 0.0), (0.016, 0.003), (0.012, 0.005), (0.0, 0.005)]
    g = geo.lathe(prof, seg=20)
    g = g.xf(Matrix.Rotation(-math.pi / 2, 4, "X") @ Matrix.Diagonal((1.0, 2.6, 1.0, 1.0)))
    return g


def make_leaf(name, W, H, rows, hinge_side, open_angle, M, collection, wood_mat, t=LEAF_T, y_center=0.0,
              swing=1, stile=0.12, knob_h=1.0, hw="brass"):
    """Build one leaf object pivoting on its hinge. M: opening frame matrix (local x across,
    y outward). hinge_side: 'L' (at local -x edge) or 'R'."""
    lf = leaf(W, H, t, rows, stile=stile)
    # hardware: knob both faces near the latch edge, hinges on the hinge edge
    hwg = core.Geo()
    for sgn in (1, -1):
        k = knob()
        k = k.xf(Matrix.Translation((W - 0.075, sgn * t / 2, knob_h)) @ Matrix.Scale(sgn, 4, (0, 1, 0)))
        hwg.add(k)
        e = escutcheon().xf(Matrix.Translation((W - 0.075, sgn * t / 2, knob_h - 0.085)) @ Matrix.Scale(sgn, 4, (0, 1, 0)))
        hwg.add(e)
    for zh in (0.25, H / 2 + 0.1, H - 0.25):
        hwg.add(hinge().move(0.0, swing * (-t / 2 - KNUCKLE), zh))     # knuckle on the pin axis
    g = core.Geo()
    g.add(lf["wood"], 0)
    g.add(lf["glass"], 1)
    g.add(hwg, 2)
    if hinge_side == "R":
        g = g.xf(Matrix.Scale(-1, 4, (1, 0, 0)))
    o = core.obj(name, g, collection, [wood_mat, "glass", hw], smooth=35, clean=True)
    # place: pivot at the hinge line
    # local opening frame: hinge axis at x = -W_open/2 (L) or +W_open/2 (R), y = y_center
    return o, lf


def place_leaf(o, M, x_hinge, y, angle, pivot_dy=0.0, lift=0.008):
    """Origin on the hinge axis at floor level; the leaf itself clears the floor by `lift`.
    y is the leaf's centre plane; pivot_dy puts the axis on the knuckle line just proud of the face the
    leaf swings towards (as a butt hinge's pin is), so the hinge edge rolls clear of the jamb."""
    dy = pivot_dy
    for v in o.data.vertices:
        v.co.z += lift
        v.co.y -= dy
    y += dy
    o.matrix_world = M @ Matrix.Translation((x_hinge, y, 0.0)) @ Matrix.Rotation(angle, 4, "Z")


# ---------------------------------------------------------------- frames and casings

def door_frame(W, H, depth, t_jamb=0.032, stop=True, threshold=None, ext=False, stop_y=None):
    """Jamb lining across the wall thickness (y from -depth to 0), head, stops. Local coords."""
    g = core.Geo()
    xa, xb = -W / 2, W / 2
    g.add(box(xa, xa + t_jamb, -depth, 0.0, 0.0, H))
    g.add(box(xb - t_jamb, xb, -depth, 0.0, 0.0, H))
    g.add(box(xa + t_jamb, xb - t_jamb, -depth, 0.0, H - t_jamb, H))
    if stop:
        ys = stop_y or ((-depth / 2 - 0.01 - LEAF_T, -depth / 2 - 0.03 - LEAF_T) if not ext else (-0.04, -0.06))
        g.add(box(xa + t_jamb, xa + t_jamb + 0.014, ys[1], ys[0], 0.0, H - t_jamb))
        g.add(box(xb - t_jamb - 0.014, xb - t_jamb, ys[1], ys[0], 0.0, H - t_jamb))
        g.add(box(xa + t_jamb, xb - t_jamb, ys[1], ys[0], H - t_jamb - 0.014, H - t_jamb))
    return g


def threshold(W, y0, y1, h=0.025, nose=0.02):
    prof = [(y0, 0.0), (y1 + nose, 0.0), (y1 + nose, h * 0.4), (y1, h), (y0, h)]
    hw = W / 2 + 0.02
    return geo.sweep(geo.ccw([(-y, z) for y, z in prof]), [(-hw, 0, 0), (hw, 0, 0)], up=(0, 0, 1))


# ---------------------------------------------------------------- exterior doors

def build_ext_door(o):
    M = frame_matrix(o)
    W = o["w"]
    H_all = o["head"] - o["sill"]
    tr = o.get("transom", 0.0)
    H = H_all - tr - (0.06 if tr else 0.0)
    g = core.Geo()
    fr = door_frame(W, H_all, P.TE, t_jamb=0.05, stop=False, ext=True)
    g.add(fr, 0)
    if tr:
        g.add(box(-W / 2 + 0.05, W / 2 - 0.05, -P.TE, -0.0, H, H + 0.06), 0)
        fw, fg, fp = sash(-W / 2 + 0.05, W / 2 - 0.05, H + 0.06, H_all - 0.05, -0.06, "fixed",
                          muntins=0 if W < 1.2 else 2)
        g.add(fw, 0)
        from .windows import norm_uv
        g.add(norm_uv(fg, -W / 2 + 0.05, W / 2 - 0.05, H + 0.06, H_all - 0.05), 2)
    # stops (leaves close against them from inside)
    g.add(box(-W / 2 + 0.05, -W / 2 + 0.065, -0.1, -0.06, 0.0, H), 0)
    g.add(box(W / 2 - 0.065, W / 2 - 0.05, -0.1, -0.06, 0.0, H), 0)
    g.add(box(-W / 2 + 0.05, W / 2 - 0.05, -0.1, -0.06, H - 0.015, H), 0)
    g.add(threshold(W - 0.1, -P.TE + 0.02, 0.0), 1)
    trim = ext_trim(W + 0.0, H_all, kind="door", cas_w=CASING + 0.03, base_drop=0.15 if o["level"] == 0 else 0.0)
    g.add(trim, 0)
    r = room_for_opening(o)
    mat = "walnut" if (r and r["name"] in WALNUT_ROOMS) else "trim_int"
    g.add(int_trim(W, H_all, P.TE, r["name"] if r else "", kind="door"), 3)
    core.obj(f"Door_{o['name']}_Frame", g.xf(M), COL, ["trim_paint", "oak_threshold", "stained_glass", mat], smooth=30, clean=True)
    # leaves
    if o.get("double") or o["kind"] == "french":
        lw = (W - 0.1) / 2 - 0.0075            # 6 mm at the hinge (knuckle clear of the deep lining), 1.5 at the meeting
        rows = ([(0.28, "panel2"), (0.72, "glass_arch")] if o["kind"] == "door"
                else [(0.2, "panel"), (0.8, "glass")])
        mat = "door_paint" if o["kind"] == "door" else "sash_paint"
        for side, xh in (("L", -W / 2 + 0.056), ("R", W / 2 - 0.056)):
            lo, _ = make_leaf(f"Door_{o['name']}_{side}", lw, H - 0.034, rows, side, 0.0, M, COL_LEAF, mat,
                              stile=0.11 if o["kind"] == "door" else 0.085)
            place_leaf(lo, M, xh, -0.1 - LEAF_T / 2 - 0.002, 0.0, pivot_dy=-(LEAF_T / 2 + KNUCKLE), lift=0.03)   # over the sill
            lo["hinge"], lo["swing"], lo["open_angle"] = side, (-1 if side == "L" else 1), 0.0   # inward
    else:
        lw = W - 0.1 - 0.009
        rows = [(0.42, "panel2"), (0.58, "glass")]
        lo, _ = make_leaf(f"Door_{o['name']}", lw, H - 0.034, rows, "L", 0.0, M, COL_LEAF, "door_paint")
        place_leaf(lo, M, -W / 2 + 0.056, -0.1 - LEAF_T / 2 - 0.002, 0.0, pivot_dy=-(LEAF_T / 2 + KNUCKLE), lift=0.03)
        lo["hinge"], lo["swing"], lo["open_angle"] = "L", -1, 0.0      # inward


# ---------------------------------------------------------------- interior doors

OPEN_ANGLES = {
    "G_HallMusic": 1.3, "G_HallRear": 0.0, "G_RearKitchen": 1.6, "G_RearWC": 0.25, "G_KitchenPantry": 1.2,
    "G_KitchenMorning": 0.9, "G_VestHall": 1.45, "G_MusicMorning": 1.5,
    "L1_LandMaster": 1.2, "L1_LandStudy": 1.55, "L1_MasterDress": 1.0, "L1_DressBath": 0.4,
    "L1_LandBed": 0.15, "L1_LandGuest": 1.4, "L1_LandBath": 0.6, "L1_StudyChart": 1.5,
    "L2_HallGable": 1.3, "L2_HallTurret": 1.6, "L2_HallMaid": 0.0, "L2_HallBox": 0.5,
}


def _rooms_both_sides(o):
    from .shell import room_at
    a = o["ang"]
    n = np.array([math.cos(a), math.sin(a)])
    th = o.get("thick", P.TI)
    p = np.array(o["p"])
    z = P.LEVELS[o["level"]] + 1.0
    ra = room_at(np.array([*(p + n * (th / 2 + 0.2)), z]), o["level"])
    rb = room_at(np.array([*(p - n * (th / 2 + 0.2)), z]), o["level"])
    return ra, rb


def build_int_door(o):
    th = o.get("thick", P.TI)
    a = o["ang"]
    # frame origin on the +n face of the partition
    n = np.array([math.cos(a), math.sin(a)])
    p = np.array(o["p"]) + n * th / 2
    oo = dict(o, p=tuple(p))
    M = frame_matrix(oo)
    W, H = o["w"], o["head"] - o["sill"]
    ra, rb = _rooms_both_sides(o)
    mat_a = "walnut" if (ra and ra["name"] in WALNUT_ROOMS) else "trim_int"
    mat_b = "walnut" if (rb and rb["name"] in WALNUT_ROOMS) else "trim_int"
    jmat = "walnut" if "walnut" in (mat_a, mat_b) else "trim_int"
    kind = o["kind"]
    # leaves hang flush with the +n face (the side they open to), stops behind them
    fr = door_frame(W, H, th, stop=(kind == "door"), stop_y=(-LEAF_T - 0.001, -LEAF_T - 0.021))
    g = core.Geo()
    g.add(fr, 0)
    # casings: side B (the -n side) is int_trim at depth th; side A (+n face) mirrored
    cw = o.get("casing")
    g.add(int_trim(W, H, th, "", kind="door", cw=cw), 1)
    g.add(int_trim(W, H, 0.0, "", kind="door", cw=cw).xf(Matrix.Scale(-1, 4, (0, 1, 0))), 2)
    if kind == "arch":
        g.add(fretwork(W, H).move(0, -th / 2, 0), 0)
    core.obj(f"Door_{o['name']}_Frame", g.xf(M), COL_INT, [jmat, mat_b, mat_a], smooth=30, clean=True)
    if kind == "arch":
        return
    if kind == "pocket":
        # leaves stand withdrawn into the wall pocket; only their lead edges and pulls show
        for side in (-1, 1):
            xe = side * (W / 2 - 0.032)
            g = box(xe - 0.012 * side, xe + 0.0 * side, -th / 2 - LEAF_T / 2, -th / 2 + LEAF_T / 2, 0.01, H - 0.035)
            gg = core.Geo().add(g)
            core.obj(f"Door_{o['name']}_Pocket{'L' if side < 0 else 'R'}", gg.xf(M), COL_INT, mat_a, smooth=None)
        return
    double = o.get("double", False)
    glazed = o.get("glazed", False)
    rows = [(0.3, "panel2"), (0.7, "glass" if glazed else "panel2")]
    ang = OPEN_ANGLES.get(o["name"], 1.2)
    yl = -0.001 - LEAF_T / 2
    pdy = LEAF_T / 2 + KNUCKLE
    if double:
        lw = (W - 0.064) / 2 - 0.0045          # 3 mm at the hinges, 3 mm between the leaves
        for side, xh, sg in (("L", -W / 2 + 0.035, 1), ("R", W / 2 - 0.035, -1)):
            lo, _ = make_leaf(f"Door_{o['name']}_{side}", lw, H - 0.04, rows, side, 0.0, M, COL_LEAF, jmat,
                              stile=0.1, swing=-1)
            place_leaf(lo, M, xh, yl, sg * ang, pivot_dy=pdy)
            lo["hinge"], lo["swing"], lo["open_angle"] = side, sg, sg * ang
    else:
        lw = W - 0.064 - 0.006
        lo, _ = make_leaf(f"Door_{o['name']}", lw, H - 0.04, [(0.36, "panel2"), (0.64, "panel2")], "L", 0.0, M,
                          COL_LEAF, jmat, stile=0.11, hw="porcelain" if jmat == "trim_int" else "brass", swing=-1)
        place_leaf(lo, M, -W / 2 + 0.035, yl, ang, pivot_dy=pdy)
        lo["hinge"], lo["swing"], lo["open_angle"] = "L", 1, ang


def fretwork(W, H):
    """Spindle-and-fretwork screen across the head of a cased opening, with scroll brackets at both
    sides (as in the parlour reference): a frieze rail, a row of turned spindles, corner brackets."""
    g = core.Geo()
    xa, xb = -W / 2 + 0.032, W / 2 - 0.032
    rail_z = H - 0.32
    d = 0.05
    g.add(box(xa, xb, -d / 2, d / 2, rail_z - 0.05, rail_z))       # bottom rail
    g.add(box(xa, xb, -d / 2, d / 2, H - 0.07, H - 0.032))          # top rail
    # spindles
    sp_prof = [(0.0, 0.0), (0.011, 0.0), (0.011, 0.02), (0.007, 0.03), (0.012, 0.07), (0.007, 0.11),
               (0.011, 0.13), (0.007, 0.15), (0.011, 0.17), (0.011, 0.19), (0.0, 0.19)]
    sp_h = (H - 0.07) - rail_z
    sp = geo.lathe([(r, z * sp_h / 0.19) for r, z in sp_prof], seg=12)
    n = max(4, int((xb - xa) / 0.075))
    for i in range(n):
        x = xa + (i + 0.5) * (xb - xa) / n
        g.add(sp.move(x, 0, rail_z))
    # scroll brackets in the corners below the rail
    for side in (-1, 1):
        x_edge = xa if side < 0 else xb
        pts = []
        L = 0.42
        for k in range(17):
            s = k / 16
            # quarter ellipse with a reverse curl near the wall
            xx = L * (1 - math.cos(s * math.pi / 2))
            zz = L * (1 - math.sin(s * math.pi / 2))
            pts.append((xx, zz))
        poly = [(0.0, 0.0)] + [(L - xx, L - zz) for xx, zz in pts] + [(0.0, L)]
        # cut a pierced circle-ish by keeping the profile simple: outline in (x, z)
        poly = [(x_edge - side * px, rail_z - 0.05 - L + pz) for px, pz in poly]
        poly = geo.dedupe(poly)
        g.add(geo.extrude_profile_y(geo.ccw(poly), -0.012, 0.012))
    return g


def build():
    core.clear(COL)
    core.clear(COL_INT)
    core.clear(COL_LEAF)
    for o in P.OPENINGS:
        if o["ext"] and o["kind"] in ("door", "french"):
            build_ext_door(o)
        elif not o["ext"]:
            build_int_door(o)
    core.finish_tmp()
