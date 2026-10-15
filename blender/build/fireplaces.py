"""Fireplaces on the three stacks: chimney breasts, carved walnut or painted mantels, glazed tile
slips, cast-iron arched inserts with grates and coals, hearths, fenders and fire irons; the
kitchen's cast-iron range. Each fire gets a light empty for the engine (warm, flickering).
"""
import math

import numpy as np
from mathutils import Matrix

from . import core, geo
from . import plan as P
from .windows import box, _raised_panel

COL = "House/Interior/Fireplaces"

# (name, level, wall point (x, y) on the room face, inward normal angle deg, breast width, depth, style)
FIRES = [
    ("Parlour", 0, (-8.1, 3.2), 0, 1.9, 0.42, "grand"),
    ("Library", 0, (-8.4, 3.2), 180, 1.7, 0.4, "grand"),
    ("Dining", 0, (-8.1, 11.0), 0, 1.9, 0.42, "grand"),
    ("Music", 0, (4.15, 6.525), -90, 1.7, 0.4, "grand"),
    ("Kitchen", 0, (4.15, 6.675), 90, 2.1, 0.55, "range"),
    ("Master", 1, (-8.1, 3.2), 0, 1.7, 0.4, "bed"),
    ("Dressing", 1, (-8.4, 3.2), 180, 1.4, 0.35, "bed"),
    ("Bedroom", 1, (-8.1, 11.0), 0, 1.7, 0.4, "bed"),
    ("Study", 1, (4.15, 6.525), -90, 1.7, 0.4, "grand"),
    ("Guest", 1, (4.15, 6.675), 90, 1.6, 0.38, "bed"),
]


def frame(px, py, ang_deg, z):
    """Local frame: x along the wall, y into the room, origin on the wall face at floor level."""
    a = math.radians(ang_deg)
    n = (math.cos(a), math.sin(a))
    t = (n[1], -n[0])
    return Matrix(((t[0], n[0], 0, px), (t[1], n[1], 0, py), (0, 0, 1, z), (0, 0, 0, 1)))


def arched_opening(w, h, rise):
    """Outline (x, z) of an arched fire opening centred on x=0, sill at z=0."""
    pts = [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, h - rise)]
    R = (w * w / 4 + rise * rise) / (2 * rise)
    zc = h - R
    for k in range(1, 16):
        x = w / 2 - w * k / 16
        pts.append((x, zc + math.sqrt(max(0.0, R * R - x * x))))
    pts.append((-w / 2, h - rise))
    return pts


def insert(w=0.62, h=0.78, depth=0.3):
    """Cast-iron arched register grate: frame with beads, firebox, fireback, basket grate and coals."""
    iron, coal = core.Geo(), core.Geo()
    fw, fh = w + 0.22, h + 0.16
    outer = [(-fw / 2, 0.0), (fw / 2, 0.0), (fw / 2, fh), (-fw / 2, fh)]
    hole = arched_opening(w, h, 0.18)
    # frame plate (front at y=0.03, back y=0) as outer minus the arch: build ring as a boolean later
    plate = geo.extrude_profile_y(geo.ccw(outer), 0.0, 0.03)
    hole_g = geo.extrude_profile_y(geo.ccw(hole), -0.4, 0.2).move(0, 0, 0.0)
    po = core.geo_obj(plate, "_plate")
    core.boolean(po, [core.geo_obj(hole_g, "_hole")], op="DIFFERENCE")
    # bead round the arch
    arc_pts = [(x, -0.0, z) for x, z in hole[2:]] + [(hole[-1][0], 0.0, 0.0)]
    bead = geo.sweep(geo.ccw([(0.0, 0.0), (0.02, 0.0), (0.02, 0.02), (0.0, 0.02)]),
                     [(w / 2, 0.03, 0.0)] + [(x, 0.03, z) for x, z in hole[2:]] + [(-w / 2, 0.03, 0.0)], right=(0, 1, 0))
    iron.add(bead)
    # firebox: an arched back plate and splayed cheeks, all within the arch of the opening
    wi, hi = w - 0.02, h - 0.02
    iron.add(geo.extrude_profile_y(geo.ccw(arched_opening(wi, hi, 0.17)), -depth, -depth + 0.02))
    iron.add(geo.extrude_profile_y(geo.ccw([(-wi / 2, 0.0), (-wi / 2 + 0.12, 0.0), (-wi / 2 + 0.12, hi - 0.25), (-wi / 2, hi - 0.2)]), -depth + 0.02, 0.0))
    iron.add(geo.extrude_profile_y(geo.ccw([(wi / 2 - 0.12, 0.0), (wi / 2, 0.0), (wi / 2, hi - 0.2), (wi / 2 - 0.12, hi - 0.25)]), -depth + 0.02, 0.0))
    # basket grate: front bars on short legs
    for k in range(5):
        z = 0.12 + k * 0.045
        iron.add(geo.tube([(-w / 2 + 0.14, 0.02, z), (w / 2 - 0.14, 0.02, z)], 0.008, seg=8))
    for x in (-w / 2 + 0.16, 0.0, w / 2 - 0.16):
        iron.add(geo.tube([(x, 0.02, 0.0), (x, 0.02, 0.32)], 0.012, seg=8))
    iron.add(box(-w / 2 + 0.14, w / 2 - 0.14, -depth + 0.06, 0.02, 0.1, 0.12))
    # coals: a heap of irregular lumps
    rng = np.random.default_rng(3)
    lump = geo.lathe([(0.0, -0.03), (0.03, -0.025), (0.04, 0.0), (0.03, 0.025), (0.0, 0.03)], seg=6)
    for k in range(26):
        x = rng.uniform(-w / 2 + 0.18, w / 2 - 0.18)
        y = rng.uniform(-depth + 0.08, -0.02)
        z = 0.15 + rng.uniform(0, 0.08) + 0.06 * (1 - abs(x) / (w / 2))
        s = rng.uniform(0.6, 1.2)
        M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rng.uniform(0, 3), 4, "Z") @ Matrix.Diagonal((s, s * 0.8, s * 0.7, 1))
        coal.add(lump.xf(M))
    return po, iron, coal


def mantel_grand(W, H=1.42, shelf_d=0.24):
    """Carved walnut chimneypiece: console pilasters, panelled frieze, moulded shelf, overmantel with
    a bevelled mirror under an arched cornice and small shelves on brackets (as in the parlour ref)."""
    g = core.Geo()
    mirror = core.Geo()
    ph = H - 0.2
    # pilasters with consoles
    for sx in (-1, 1):
        x0, x1 = sx * (W / 2 - 0.2), sx * W / 2
        g.add(box(min(x0, x1), max(x0, x1), 0.0, 0.07, 0.0, ph))
        g.add(_raised_panel(min(x0, x1) + 0.04, max(x0, x1) - 0.04, 0.2, ph - 0.35, 0.07, 0.012))
        # console bracket under the shelf
        cons = [(0.0, 0.0), (0.12, 0.0), (0.12, -0.04)]
        for k in range(1, 10):
            a = math.pi * k / 9
            cons.append((0.06 + 0.06 * math.cos(a), -0.04 - 0.22 * k / 9 - 0.03 * math.sin(a)))
        cons.append((0.0, -0.3))
        cg = geo.extrude_profile_x([(0.07 + y, ph + z) for y, z in cons], (x0 + x1) / 2 - 0.06, (x0 + x1) / 2 + 0.06)
        g.add(cg)
        g.add(box(min(x0, x1) - 0.02, max(x0, x1) + 0.02, 0.0, 0.1, 0.0, 0.12))
    # frieze with a carved central tablet
    g.add(box(-W / 2 + 0.2, W / 2 - 0.2, 0.0, 0.05, ph - 0.24, ph))
    g.add(_raised_panel(-0.25, 0.25, ph - 0.21, ph - 0.03, 0.05, 0.02))
    for sx in (-1, 1):
        g.add(_raised_panel(sx * 0.32 if sx > 0 else -W / 2 + 0.26, W / 2 - 0.26 if sx > 0 else -0.32, ph - 0.2, ph - 0.04, 0.05, 0.01))
    # shelf
    shelf = [(0.0, 0.0), (shelf_d, 0.0), (shelf_d + 0.02, 0.012), (shelf_d + 0.02, 0.035), (shelf_d, 0.05), (0.0, 0.05)]
    g.add(geo.extrude_profile_x([(y, ph + z) for y, z in shelf], -W / 2 - 0.06, W / 2 + 0.06))
    # overmantel
    oz0 = ph + 0.05
    ow = W - 0.2
    oh = 1.25
    g.add(box(-ow / 2, ow / 2, 0.0, 0.03, oz0, oz0 + oh))                          # back board
    for sx in (-1, 1):
        g.add(box(sx * ow / 2 - (0.09 if sx > 0 else 0.0), sx * ow / 2 + (0.0 if sx > 0 else 0.09), 0.03, 0.09, oz0, oz0 + oh))
        # small display shelves on scroll brackets
        for zz in (oz0 + 0.45, oz0 + 0.85):
            xs = sx * (ow / 2 - 0.09)
            g.add(box(min(xs, xs - sx * 0.22), max(xs, xs - sx * 0.22), 0.03, 0.17, zz, zz + 0.025))
    # mirror with a moulded frame and an arched head
    mw, mh = ow - 0.62, oh - 0.32
    mz = oz0 + 0.1
    marc = arched_opening(mw, mh, 0.16)
    mirror.add(geo.extrude_profile_y(geo.ccw([(x, z + mz) for x, z in marc]), 0.03, 0.036))
    fr = [(x, 0.036, z + mz) for x, z in marc[1:]] + [(marc[0][0], 0.036, mz), (marc[1][0], 0.036, mz)]
    g.add(geo.sweep(geo.ccw([(0.0, 0.0), (0.03, 0.0), (0.035, 0.015), (0.025, 0.035), (0.0, 0.04)]),
                    [(x, 0.036, z + mz) for x, z in marc] , closed=True, right=(0, 1, 0)))
    # cornice over the overmantel with a broken pediment hint (scroll)
    cz = oz0 + oh
    cor = [(0.0, 0.0), (0.05, 0.0), (0.07, 0.03), (0.1, 0.07), (0.12, 0.08), (0.12, 0.11), (0.0, 0.11)]
    g.add(geo.extrude_profile_x([(y, cz + z) for y, z in cor], -ow / 2 - 0.08, ow / 2 + 0.08))
    return g, mirror


def mantel_painted(W, H=1.3, shelf_d=0.2):
    g = core.Geo()
    ph = H - 0.08
    for sx in (-1, 1):
        x0, x1 = sx * (W / 2 - 0.16), sx * W / 2
        g.add(box(min(x0, x1), max(x0, x1), 0.0, 0.05, 0.0, ph))
        g.add(_raised_panel(min(x0, x1) + 0.035, max(x0, x1) - 0.035, 0.15, ph - 0.25, 0.05, 0.01))
    g.add(box(-W / 2 + 0.16, W / 2 - 0.16, 0.0, 0.04, ph - 0.2, ph))
    shelf = [(0.0, 0.0), (shelf_d, 0.0), (shelf_d + 0.015, 0.012), (shelf_d + 0.015, 0.03), (shelf_d, 0.04), (0.0, 0.04)]
    g.add(geo.extrude_profile_x([(y, ph + z) for y, z in shelf], -W / 2 - 0.04, W / 2 + 0.04))
    return g


def fender(w):
    """Brass fender: a low moulded kerb round the hearth with ball finials."""
    g = core.Geo()
    path = [(-w / 2, 0.0, 0.0), (-w / 2, 0.42, 0.0), (w / 2, 0.42, 0.0), (w / 2, 0.0, 0.0)]
    prof = [(0.0, 0.0), (0.012, 0.0), (0.012, 0.09), (0.03, 0.11), (0.03, 0.13), (0.0, 0.14)]
    g.add(geo.sweep(geo.ccw([(o - 0.006, h) for o, h in prof]), path, up=(0, 0, 1)))
    for x in (-w / 2, w / 2):
        g.add(geo.lathe([(0.0, 0.0), (0.02, 0.0), (0.03, 0.02), (0.0, 0.05)], seg=12).move(x, 0.42, 0.14))
    return g


def fire_irons():
    """Stand with poker, tongs and shovel."""
    g = core.Geo()
    g.add(geo.lathe([(0.0, 0.0), (0.09, 0.0), (0.09, 0.015), (0.02, 0.03), (0.012, 0.03)], seg=16))
    g.add(geo.tube([(0, 0, 0.03), (0, 0, 0.7)], 0.01, seg=8))
    g.add(geo.lathe([(0.0, 0.0), (0.025, 0.0), (0.03, 0.03), (0.0, 0.06)], seg=12).move(0, 0, 0.7))
    for k, ang in enumerate((0.0, 2.1, 4.2)):
        c, s = math.cos(ang), math.sin(ang)
        top = (0.04 * c, 0.04 * s, 0.66)
        bot = (0.07 * c, 0.07 * s, 0.05)
        g.add(geo.tube([top, bot], 0.007, seg=6))
        g.add(geo.lathe([(0.0, 0.0), (0.014, 0.0), (0.014, 0.07), (0.0, 0.08)], seg=8).move(*top))
    return g


def kitchen_range(W=1.9, H=0.95):
    """Cast-iron kitchen range: twin ovens, firebox with a fire door, hotplate top, brass rail,
    plate rack canopy, set in the breast's recess."""
    g, brass = core.Geo(), core.Geo()
    d = 0.6
    g.add(box(-W / 2, W / 2, 0.0, d, 0.0, 0.08))                       # plinth
    g.add(box(-W / 2, W / 2, 0.0, d, 0.08, H - 0.04))                   # body
    g.add(box(-W / 2 - 0.02, W / 2 + 0.02, 0.0, d + 0.03, H - 0.04, H))  # hotplate
    for x in (-W / 4 - 0.12, W / 4 + 0.12):
        # oven doors with panels and handles
        g.add(box(x - 0.26, x + 0.26, d, d + 0.03, 0.2, 0.74))
        g.add(_raised_panel(x - 0.21, x + 0.21, 0.25, 0.69, d + 0.03, 0.012))
        brass.add(geo.tube([(x - 0.12, d + 0.07, 0.66), (x + 0.12, d + 0.07, 0.66)], 0.012, seg=8))
        for xx in (x - 0.12, x + 0.12):
            brass.add(geo.tube([(xx, d + 0.03, 0.66), (xx, d + 0.07, 0.66)], 0.008, seg=6))
    # fire door (centre)
    g.add(box(-0.18, 0.18, d, d + 0.03, 0.3, 0.62))
    for k in range(5):
        x = -0.12 + k * 0.06
        g.add(box(x - 0.012, x + 0.012, d + 0.03, d + 0.04, 0.36, 0.56))
    # hob lids
    for x in (-0.55, -0.15, 0.25, 0.65):
        g.add(geo.lathe([(0.0, 0.0), (0.13, 0.0), (0.13, 0.01), (0.03, 0.02), (0.0, 0.025)], seg=24).move(x, d / 2 + 0.05, H))
    # towel rail
    brass.add(geo.tube([(-W / 2, d + 0.12, H - 0.12), (W / 2, d + 0.12, H - 0.12)], 0.012, seg=10))
    for x in (-W / 2 + 0.03, W / 2 - 0.03):
        brass.add(geo.tube([(x, d + 0.03, H - 0.12), (x, d + 0.12, H - 0.12)], 0.01, seg=8))
    # flue canopy and plate rack
    g.add(box(-W / 2 + 0.2, W / 2 - 0.2, 0.0, 0.3, H + 0.75, H + 1.1))
    for k in range(10):
        x = -W / 2 + 0.3 + k * (W - 0.6) / 9
        g.add(geo.tube([(x, 0.32, H + 0.5), (x, 0.32, H + 0.74)], 0.006, seg=6))
    return g, brass


def build():
    core.clear(COL)
    for name, level, (px, py), ang, W, D, style in FIRES:
        fl = P.LEVELS[level]
        M = frame(px, py, ang, fl)
        ceil = P.CEIL[level]
        r = next(rr for rr in P.rooms(level) if rr["name"] == name)
        # chimney breast (room wall finish), with the fire opening cut
        brz = ceil - fl
        breast = core.geo_obj(box(-W / 2, W / 2, 0.0, D, 0.0, brz).xf(M), "_br")
        if style != "range":
            ow, oh = 0.74, 0.86
            hole = core.geo_obj(geo.extrude_profile_y(geo.ccw(arched_opening(ow, oh, 0.2)), 0.04, D + 0.1).xf(M), "_bh")
            core.boolean(breast, [hole], op="DIFFERENCE")
        else:
            hole = core.geo_obj(box(-W / 2 + 0.12, W / 2 - 0.12, 0.05, D + 0.1, 0.0, 2.15).xf(M), "_bh")
            core.boolean(breast, [hole], op="DIFFERENCE")
        breast.name = f"Fireplace_{name}_Breast"
        for c in list(breast.users_collection):
            c.objects.unlink(breast)
        core.coll(COL).objects.link(breast)
        core.set_mats(breast, r["wall"])
        Mf = M @ Matrix.Translation((0, D, 0))   # on the breast face
        if style == "range":
            g, brass = kitchen_range(W - 0.3)
            core.obj(f"Fireplace_{name}_Range", g.xf(M @ Matrix.Translation((0, 0.085, 0))), COL, "cast_iron", smooth=35, clean=True)
            core.obj(f"Fireplace_{name}_Brass", brass.xf(M @ Matrix.Translation((0, 0.085, 0))), COL, "brass", smooth=35)
            # brick-lined recess and a deal mantel shelf over it
            lining = box(-W / 2 + 0.12, W / 2 - 0.12, 0.05, 0.08, 0.0, 2.15)
            core.obj(f"Fireplace_{name}_Lining", lining.xf(M), COL, "brick", smooth=None)
            shelf = box(-W / 2 - 0.05, W / 2 + 0.05, D, D + 0.22, 2.2, 2.25)
            core.obj(f"Fireplace_{name}_Shelf", shelf.xf(M), COL, "trim_int", smooth=None)
            core.empty(f"Lamp_Fire_{name}", "House/Engine/Lamps", tuple((M @ Matrix.Translation((0, 0.5, 0.45))).translation),
                       props={"kind": "fire", "watts": 300})
            continue
        # cast-iron insert set into the opening, tile slips around it, mantel, hearth
        po, iron, coal = insert(0.62, 0.78, depth=D - 0.08)
        # the register plate (a boolean result) and the firebox become one cast-iron object
        pm = po.data
        pg = core.Geo(np.array([v.co[:] for v in pm.vertices]), [list(p.vertices) for p in pm.polygons], None)
        core.remove(po)
        iron.add(pg)
        Mi = Mf @ Matrix.Translation((0, 0, 0.03))      # the register stands on the hearth
        core.obj(f"Fireplace_{name}_Iron", iron.xf(Mi), COL, "cast_iron", smooth=35, clean=True)
        core.obj(f"Fireplace_{name}_Coals", coal.xf(Mi), COL, "coal", smooth=None)
        # tile slips framing the register (between register and mantel)
        # from the register out to the mantel's pilasters, and up to its frieze
        mw = (W + 0.1) if style == "grand" else W
        pil = (0.2 if style == "grand" else 0.16)
        xin = mw / 2 - pil
        ztop = (1.42 - 0.2 - 0.24) if style == "grand" else (1.3 - 0.08 - 0.2)
        tiles = core.Geo()
        tiles.add(box(-xin, -0.42, 0.0, 0.012, 0.03, 0.97))
        tiles.add(box(0.42, xin, 0.0, 0.012, 0.03, 0.97))
        tiles.add(box(-xin, xin, 0.0, 0.012, 0.97, ztop))
        core.obj(f"Fireplace_{name}_Tiles", tiles.xf(Mf), COL, "tile_green", smooth=None, clean=True)
        if style == "grand":
            mg, mirror = mantel_grand(W + 0.1)
            core.obj(f"Fireplace_{name}_Mantel", mg.xf(Mf @ Matrix.Translation((0, 0.012, 0))), COL, "walnut", smooth=35, clean=True)
            core.obj(f"Fireplace_{name}_Mirror", mirror.xf(Mf @ Matrix.Translation((0, 0.012, 0))), COL, "mirror", smooth=None)
        else:
            mg = mantel_painted(W)
            core.obj(f"Fireplace_{name}_Mantel", mg.xf(Mf @ Matrix.Translation((0, 0.012, 0))), COL, "trim_int", smooth=35, clean=True)
        # hearth stone (raised slightly), fender, irons
        hearth = box(-xin + 0.025, xin - 0.025, 0.012, 0.5, 0.0, 0.03)       # between the pilasters' plinths
        core.obj(f"Fireplace_{name}_Hearth", hearth.xf(Mf), COL, "marble_hearth", smooth=None)
        core.obj(f"Fireplace_{name}_Fender", fender(2 * xin - 0.08).xf(Mf @ Matrix.Translation((0, 0.04, 0.03))), COL, "brass", smooth=35, clean=True)
        if style == "grand":
            core.obj(f"Fireplace_{name}_Irons", fire_irons().xf(Mf @ Matrix.Translation((W / 2 + 0.22, 0.28, 0.0))), COL, "brass", smooth=35, clean=True)
        core.empty(f"Lamp_Fire_{name}", "House/Engine/Lamps", tuple((Mf @ Matrix.Translation((0, -0.12, 0.3))).translation),
                   props={"kind": "fire", "watts": 400 if style == "grand" else 250})
    core.finish_tmp()
