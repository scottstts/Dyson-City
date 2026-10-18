"""Exterior details: chimneys, iron roof cresting, rainwater goods (downpipes), window boxes,
lanterns, urns.
"""
import math

import numpy as np
from mathutils import Matrix

from . import core, geo
from . import plan as P
from . import roofs, porch, cornice
from .windows import box, frame_matrix

COL = "House/Exterior/Details"

# ---------------------------------------------------------------- chimneys
# (name, x0, y0, x1, y1, z_start, z_top)
CHIMNEYS = [
    ("C1", -8.85, 2.6, -7.95, 3.8, 11.35, 16.3),
    ("C2", P.CHIMNEY_EXT[0], P.CHIMNEY_EXT[1], P.CHIMNEY_EXT[2], P.CHIMNEY_EXT[3], 0.0, 16.0),
    ("C3", 3.45, 6.2, 4.85, 7.0, P.L2, 16.6),
]
COURSE = 0.075


# Stacks rising from inside the top floor (C3, through the box room): the part in the room is an
# interior breast, baked with the rooms; only what stands above the room's ceiling is the exterior.
# As one exterior object the whole stack was lit as if outdoors, and in the box room it glowed.
INDOOR_STACKS = {"C3": "BoxRoom"}


def chimney(name, x0, y0, x1, y1, z0, z1, col):
    g = core.Geo()
    # shaft (a stack rising from a room: only above its ceiling)
    if name in INDOOR_STACKS:
        zc = P.CEIL[2]
        core.obj(f"Stack_{name}", box(x0, x1, y0, y1, z0, zc), "House/Interior/Stacks", "brick", smooth=None)
        # the exterior part starts just over the ceiling, in the roof's void (its foot flush with the
        # ceiling would z-fight it)
        z0 = zc + 0.01
    g.add(box(x0, x1, y0, y1, z0, z1 - 0.62))
    # recessed panels on each face of the shaft's upper part (cut later), a band of corbel courses
    z = z1 - 0.62
    steps_ = [(0.03, 1), (0.06, 1), (0.09, 2), (0.06, 1), (0.03, 1), (0.0, 1), (0.05, 2)]
    c = 0.62 / sum(n for _, n in steps_)
    for off, n in steps_:
        g.add(box(x0 - off, x1 + off, y0 - off, y1 + off, z, z + n * c))
        z += n * c
    o = core.obj(f"Chimney_{name}", g, col, "brick", smooth=None)
    # recessed panels: shallow boxes subtracted from the faces above the roof line
    cut = []
    pz0 = max(z0, 13.6 if name != "C2" else 10.6) + 0.3
    pz1 = z1 - 0.9
    if pz1 - pz0 > 0.8:
        w = 0.07
        for (a, b, side) in ((x0, x1, "y0"), (x0, x1, "y1"), (y0, y1, "x0"), (y0, y1, "x1")):
            if b - a < 0.6:
                continue
            if side == "y0":
                cut.append(core.geo_obj(box(a + 0.15, b - 0.15, y0 - 0.1, y0 + 0.035, pz0, pz1), "_p"))
            elif side == "y1":
                cut.append(core.geo_obj(box(a + 0.15, b - 0.15, y1 - 0.035, y1 + 0.1, pz0, pz1), "_p"))
            elif side == "x0":
                cut.append(core.geo_obj(box(x0 - 0.1, x0 + 0.035, a + 0.15, b - 0.15, pz0, pz1), "_p"))
            else:
                cut.append(core.geo_obj(box(x1 - 0.035, x1 + 0.1, a + 0.15, b - 0.15, pz0, pz1), "_p"))
    if cut:
        core.boolean(o, cut, op="DIFFERENCE")
    # stone cap slab
    zc = z1 - 0.62 + 0.62
    cap = box(x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, zc - 0.0, zc + 0.08)
    core.obj(f"Chimney_{name}_Cap", cap, col, "sandstone", smooth=None)
    # terracotta pots
    pots = core.Geo()
    n = 2 if (x1 - x0) * (y1 - y0) < 0.9 else 3
    long_x = (x1 - x0) >= (y1 - y0)
    pot = chimney_pot()
    for i in range(n):
        f = (i + 0.5) / n
        px = x0 + (x1 - x0) * f if long_x else (x0 + x1) / 2
        py = (y0 + y1) / 2 if long_x else y0 + (y1 - y0) * f
        pots.add(pot.move(px, py, zc + 0.08))
    core.obj(f"Chimney_{name}_Pots", pots, col, "terracotta", smooth=35)


def chimney_pot(h=0.62):
    prof = [(0.0, 0.0), (0.16, 0.0), (0.17, 0.05), (0.15, 0.08), (0.13, 0.3), (0.115, 0.48), (0.13, 0.52), (0.14, 0.56),
            (0.13, 0.6), (0.11, 0.62), (0.09, 0.62), (0.09, 0.2), (0.0, 0.2)]
    return geo.lathe([(r, z * h / 0.62) for r, z in prof], seg=24)


# ---------------------------------------------------------------- cresting

def cresting_unit(w=0.3, h=0.42, r=0.0065):
    """One repeat of cast-iron cresting: a central spear with a fleur tip, flanked by C-scrolls,
    standing on the base rail. Local x along the run (0..w), z up."""
    g = core.Geo()
    c = w / 2
    g.add(geo.tube([(c, 0, 0.0), (c, 0, h - 0.1)], r * 1.2, seg=8))
    # fleur: three petals around the tip
    tip = [(0.0, -0.06), (0.018, -0.03), (0.02, 0.0), (0.012, 0.03), (0.0, 0.06)]
    fl = geo.lathe([(0.0, 0.0), (0.02, 0.01), (0.026, 0.04), (0.015, 0.07), (0.0, 0.1)], seg=8)
    g.add(fl.move(c, 0, h - 0.1))
    for s in (-1, 1):
        pts = []
        for k in range(14):
            a = math.pi * k / 13
            pts.append((c + s * (0.03 + 0.045 * math.sin(a)), 0, h - 0.13 - 0.07 * (1 - math.cos(a))))
        g.add(geo.tube(pts, r, seg=6))
        # lower scroll curling outward from the base
        pts = []
        for k in range(18):
            a = 1.6 * math.pi * k / 17
            rr = 0.06 * (1 - 0.45 * k / 17)
            pts.append((c + s * (0.02 + rr * (1 - math.cos(a)) * 0.9), 0, 0.03 + rr * math.sin(a) + 0.05 * k / 17))
        g.add(geo.tube(pts, r, seg=6))
    # small finial post at the unit boundary
    g.add(geo.tube([(0.0, 0, 0.0), (0.0, 0, h * 0.45)], r, seg=6))
    g.add(geo.lathe([(0.0, 0.0), (0.016, 0.0), (0.02, 0.015), (0.0, 0.035)], seg=8).move(0, 0, h * 0.45))
    return g


def cresting_along(pts, z, h=0.42, closed=True):
    g = core.Geo()
    unit = cresting_unit(h=h)
    pp = list(pts) + ([pts[0]] if closed else [])
    for i in range(len(pp) - 1):
        a, b = np.array(pp[i], float), np.array(pp[i + 1], float)
        L = float(np.linalg.norm(b - a))
        if L < 0.2:
            continue
        d = (b - a) / L
        n = max(1, round(L / 0.3))
        sc = L / (n * 0.3)
        M0 = Matrix(((d[0], -d[1], 0, a[0]), (d[1], d[0], 0, a[1]), (0, 0, 1, z), (0, 0, 0, 1)))
        for k in range(n):
            g.add(unit.xf(M0 @ Matrix.Translation((k * 0.3 * sc, 0, 0.04)) @ Matrix.Diagonal((sc, 1, 1, 1))))
        # base and top rails
        for zz, rr in ((0.0, 0.016), (0.04, 0.008)):
            g.add(box(0, L, -rr, rr, zz, zz + 0.022).xf(M0))
    # corner posts with balls
    for p in pts:
        g.add(geo.lathe([(0.0, 0.0), (0.03, 0.0), (0.03, 0.03), (0.016, 0.05), (0.016, h + 0.05), (0.035, h + 0.09),
                         (0.03, h + 0.13), (0.0, h + 0.15)], seg=12).move(p[0], p[1], z))
    return g


# ---------------------------------------------------------------- rainwater goods

DOWNPIPES = [
    # (x, y on the wall face, outward dir, top z (under cornice), cornice projection)
    (P.M[2] - 0.22, P.M[3], (0, 1), 9.2, 0.66),
    (P.M[0] + 0.35, P.M[3], (0, 1), 9.2, 0.66),
    (P.B[0], P.B[3] - 0.35, (-1, 0), 8.95, 0.42),
    (P.E[2], P.E[3] - 0.35, (1, 0), 8.95, 0.42),
    (P.E[2], P.E[1] + 0.35, (1, 0), 8.95, 0.42),
    (P.B[0], P.B[1] + 0.35, (-1, 0), 8.95, 0.42),
]


def downpipe(x, y, d, z_top, proj, r=0.045):
    g = core.Geo()
    d = np.array(d, float)
    off = 0.12  # pipe centre off the wall (clear of the plinth's 6 cm)
    p_wall = np.array([x, y]) + d * off
    p_out = np.array([x, y]) + d * (proj * 0.7)
    zh = z_top + 0.05
    # hopper head under the cornice
    hop = geo.lathe([(0.0, 0.0), (r * 1.1, 0.0), (r * 1.5, 0.08), (r * 2.6, 0.22), (r * 2.8, 0.26), (r * 2.8, 0.3),
                     (r * 2.4, 0.3), (r * 2.4, 0.27), (0.0, 0.27)], seg=16)
    g.add(hop.move(p_out[0], p_out[1], zh - 0.3))
    # swan neck back to the wall
    zs = zh - 0.3
    pts = [(p_out[0], p_out[1], zs), (p_out[0], p_out[1], zs - 0.1),
           ((p_out[0] + p_wall[0]) / 2, (p_out[1] + p_wall[1]) / 2, zs - 0.35), (p_wall[0], p_wall[1], zs - 0.6),
           (p_wall[0], p_wall[1], 0.25), (p_wall[0] + d[0] * 0.12, p_wall[1] + d[1] * 0.12, 0.08)]
    g.add(geo.tube(pts, r, seg=12))
    # straps
    n = int((zs - 1.35) / 1.6) + 1
    t = np.array([-d[1], d[0]])
    for k in range(n):
        z = 1.35 + k * 1.6        # straps fixed to the boarding, above the plinth
        ring = geo.lathe([(r + 0.004, 0.0), (r + 0.012, 0.0), (r + 0.012, 0.05), (r + 0.004, 0.05)], seg=12, closed=True)
        g.add(ring.move(p_wall[0], p_wall[1], z))
        ear = box(-0.07, 0.07, 0.02, off - r, z, z + 0.05)
        M = Matrix(((t[0], d[0], 0, x), (t[1], d[1], 0, y), (0, 0, 1, 0), (0, 0, 0, 1)))
        g.add(ear.xf(M))
    return g


# ---------------------------------------------------------------- planting (window boxes, urns)

def leaf(L=0.07, W=0.035, curl=0.015, n=4):
    """A curved leaf blade: a 2-row strip, midrib along +x, cupped and arched."""
    V, F = [], []
    for i in range(n + 1):
        t = i / n
        x = L * t
        w = W * math.sin(math.pi * min(1.0, t * 1.1)) * (1 - 0.3 * t)
        z = curl * math.sin(math.pi * t) - 0.5 * curl * t * t
        V += [(x, -w / 2, z - 0.004), (x, 0.0, z + 0.002), (x, w / 2, z - 0.004)]
    for i in range(n):
        for j in range(2):
            a = i * 3 + j
            F.append([a, a + 3, a + 4, a + 1])
    UV = [[(V[k][0], V[k][1]) for k in f] for f in F]
    return core.Geo(np.array(V), F, UV)


def flower(r=0.018, petals=5):
    V, F = [(0.0, 0.0, 0.004)], []
    for p in range(petals):
        a0 = math.tau * p / petals
        base = len(V)
        for k in range(5):
            a = a0 + (k - 2) * 0.22
            rr = r * (0.55 + 0.45 * math.sin(math.pi * k / 4))
            V.append((rr * math.cos(a), rr * math.sin(a), 0.006 * math.sin(math.pi * k / 4)))
        for k in range(4):
            F.append([0, base + k, base + k + 1])
    return core.Geo(np.array(V), F, None)


def plant_clump(rng, w, d, h=0.28, n_leaf=60, n_fl=18):
    """Geranium/petunia-like clump filling w x d, rooted at z=0. Returns (leaves, flowers)."""
    lv, fl = core.Geo(), core.Geo()
    lsrc = [leaf(0.06 + 0.02 * k, 0.03 + 0.01 * k) for k in range(3)]
    for i in range(n_leaf):
        x = rng.uniform(-w / 2, w / 2)
        y = rng.uniform(-d / 2, d / 2)
        z = rng.uniform(0.02, h * 0.75)
        yaw = rng.uniform(0, math.tau)
        pitch = rng.uniform(-0.6, 0.3)
        g = lsrc[i % 3]
        M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(pitch, 4, "Y")
        lv.add(g.xf(M))
        # stem to the soil
        lv.add(geo.tube([(x, y, 0.0), (x * 0.95, y * 0.95, z)], 0.003, seg=4, caps=False))
    fsrc = flower()
    for i in range(n_fl):
        cx, cy = rng.uniform(-w / 2, w / 2), rng.uniform(-d / 2, d / 2)
        cz = rng.uniform(h * 0.65, h)
        lv.add(geo.tube([(cx * 0.9, cy * 0.9, 0.0), (cx, cy, cz)], 0.003, seg=4, caps=False))
        for k in range(7):  # an umbel of florets
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(0, 0.035)
            M = (Matrix.Translation((cx + rr * math.cos(a), cy + rr * math.sin(a), cz + rng.uniform(-0.01, 0.015)))
                 @ Matrix.Rotation(rng.uniform(-0.5, 0.5), 4, "X") @ Matrix.Rotation(rng.uniform(-0.5, 0.5), 4, "Y"))
            fl.add(fsrc.xf(M))
    return lv, fl


def window_box(L, rng):
    """Planter box (local x along, y outward, z up from its base) on two brackets, with soil and a
    clump of flowering plants."""
    g = core.Geo()
    d, h = 0.24, 0.2
    g.add(box(-L / 2, L / 2, 0.0, d, 0.0, 0.025))                      # bottom
    g.add(box(-L / 2, L / 2, d - 0.025, d, 0.0, h))                    # front
    g.add(box(-L / 2, L / 2, 0.0, 0.025, 0.0, h))                      # back
    g.add(box(-L / 2, -L / 2 + 0.025, 0.025, d - 0.025, 0.0, h))
    g.add(box(L / 2 - 0.025, L / 2, 0.025, d - 0.025, 0.0, h))
    from .windows import _raised_panel
    g.add(_raised_panel(-L / 2 + 0.04, L / 2 - 0.04, 0.03, h - 0.04, d, 0.008).xf(Matrix.Identity(4)) if False else
          _panel_front(L, d, h))
    # cap moulding round the top
    cap = [(0.0, 0.0), (0.02, 0.0), (0.025, 0.012), (0.0, 0.02)]
    rim = [(-L / 2 - 0.0, d), (L / 2, d)]
    g.add(geo.sweep(geo.ccw([(o, h + hh) for o, hh in cap]), [(L / 2 + 0.02, d, 0), (-L / 2 - 0.02, d, 0)], up=(0, 0, 1)))
    # brackets
    for sx in (-L / 2 + 0.12, L / 2 - 0.12):
        pts = [(0.0, 0.0), (d - 0.02, 0.0), (0.0, -0.22)]
        g.add(geo.extrude_profile_x(pts, sx - 0.02, sx + 0.02))
    soil = box(-L / 2 + 0.025, L / 2 - 0.025, 0.025, d - 0.025, 0.025, h - 0.03)
    lv, fl = plant_clump(rng, L - 0.1, d - 0.12, h=0.2, n_leaf=int(90 * L), n_fl=int(18 * L))
    return g, soil, lv.move(0, d / 2 + 0.02, h - 0.03), fl.move(0, d / 2 + 0.02, h - 0.03)


def _panel_front(L, d, h):
    from .windows import _raised_panel
    g = core.Geo()
    n = max(1, round(L / 0.45))
    w = (L - 0.06) / n
    for i in range(n):
        x0 = -L / 2 + 0.03 + i * w
        p = _raised_panel(x0 + 0.02, x0 + w - 0.02, 0.03, h - 0.04, 0.0, 0.008)
        # panel is on y=0 facing +y: move to the front face
        g.add(p.move(0, d, 0))
    return g


def lantern(h=0.62):
    """Brass-and-glass wall/hanging lantern body (vertical axis), base at z=0."""
    frame, glass = core.Geo(), core.Geo()
    frame.add(geo.lathe([(0.0, 0.0), (0.05, 0.0), (0.08, 0.04), (0.11, 0.07), (0.11, 0.09), (0.0, 0.09)], seg=6))
    for k in range(6):
        a = math.tau * k / 6
        x, y = 0.105 * math.cos(a), 0.105 * math.sin(a)
        x2, y2 = 0.13 * math.cos(a), 0.13 * math.sin(a)
        frame.add(geo.tube([(x, y, 0.09), (x2, y2, 0.42)], 0.006, seg=6))
    gl = geo.lathe([(0.1, 0.09), (0.125, 0.42)], seg=6)
    glass.add(gl)
    frame.add(geo.lathe([(0.0, 0.42), (0.15, 0.42), (0.15, 0.44), (0.09, 0.52), (0.04, 0.56), (0.03, 0.6), (0.0, h)], seg=6))
    return frame, glass


def build_lanterns(col):
    g, gl = core.Geo(), core.Geo()
    fr, gs = lantern()
    for sx in (-1.2, 1.2):
        # wall bracket: scroll arm from the wall to the lantern top ring
        M = Matrix.Translation((sx, -0.32, P.G + 1.9))
        g.add(fr.xf(M))
        gl.add(gs.xf(M))
        arm = [(sx, -0.05, P.G + 2.75), (sx, -0.15, P.G + 2.78), (sx, -0.3, P.G + 2.7), (sx, -0.32, P.G + 2.52)]
        g.add(geo.tube(arm, 0.012, seg=8))
        g.add(box(sx - 0.05, sx + 0.05, -0.05, -0.022, P.G + 2.45, P.G + 2.85))
        core.empty(f"Lamp_Porch_{'L' if sx < 0 else 'R'}", "House/Engine/Lamps", (sx, -0.32, P.G + 2.15),
                   props={"kind": "lantern", "lumens": 450.0})
    # hanging lantern in the portico
    yc = (porch.PORTICO[2]) / 2
    g.add(fr.xf(Matrix.Translation((0.0, yc, porch.CEIL - 1.05))))
    gl.add(gs.xf(Matrix.Translation((0.0, yc, porch.CEIL - 1.05))))
    chain = []
    for k in range(10):
        z = porch.CEIL - 0.05 - k * 0.042
        chain.append(geo.lathe([(0.012, -0.02), (0.018, 0.0), (0.012, 0.02), (0.006, 0.0)], seg=8, closed=True)
                     .xf(Matrix.Translation((0.0, yc, z)) @ Matrix.Rotation(math.pi / 2 * (k % 2), 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")))
    for c in chain:
        g.add(c)
    g.add(geo.lathe([(0.0, 0.0), (0.07, 0.0), (0.07, 0.02), (0.02, 0.05), (0.0, 0.05)], seg=16).xf(
        Matrix.Translation((0.0, yc, porch.CEIL)) @ Matrix.Diagonal((1, 1, -1, 1))))
    core.empty("Lamp_Portico", "House/Engine/Lamps", (0.0, yc, porch.CEIL - 0.8), props={"kind": "lantern", "lumens": 650.0})
    core.obj("Lanterns", g, col, "brass", smooth=35)
    core.obj("Lanterns_Glass", gl, col, "lamp_glass", smooth=None)


def build():
    core.clear(COL)
    col = COL
    for c in CHIMNEYS:
        chimney(*c, col)
    # cresting: main deck, wing decks, bay flats
    x0, y0, x1, y1 = P.M
    d2 = (P.MANSARD_BREAK - P.CORNICE_TOP) / math.tan(P.MANSARD_LOWER) + (P.DECK - P.MANSARD_BREAK) / math.tan(P.MANSARD_UPPER)
    cr = cresting_along([(x0 + d2, y0 + d2), (x1 - d2, y0 + d2), (x1 - d2, y1 - d2), (x0 + d2, y1 - d2)], P.DECK + 0.03, h=0.5)
    for nm in ("B", "E"):
        o = bpy_obj(f"Roof_{nm}_Deck")
        if o is None:
            continue
        bb = np.array([o.matrix_world @ v.co for v in o.data.vertices])
        lo, hi = bb.min(0), bb.max(0)
        c4 = [(lo[0] + 0.02, lo[1] + 0.02), (hi[0] - 0.02, lo[1] + 0.02), (hi[0] - 0.02, hi[1] - 0.02), (lo[0] + 0.02, hi[1] - 0.02)]
        # open toward the main block (its side runs into the mansard and the chimney)
        pts = [c4[2], c4[3], c4[0], c4[1]] if nm == "B" else [c4[0], c4[1], c4[2], c4[3]]
        if nm == "B":
            pts = [(hi[0] - 1.0, hi[1] - 0.02), c4[3], c4[0], (hi[0] - 1.0, lo[1] + 0.02)]
        else:
            pts = [(lo[0] + 0.5, lo[1] + 0.02), c4[1], c4[2], (lo[0] + 0.5, hi[1] - 0.02)]
        cr.add(cresting_along(pts, hi[2], h=0.36, closed=False))
    core.obj("Cresting", cr, col, "iron", smooth=35, clean=True)
    # downpipes
    dp = core.Geo()
    for x, y, d, zt, pr in DOWNPIPES:
        dp.add(downpipe(x, y, d, zt, pr))
    core.obj("Downpipes", dp, col, "accent_paint", smooth=35, clean=True)
    # window boxes under the first-floor bay windows and the turret's first-floor windows
    rng = np.random.default_rng(7)
    boxes, soil, leaves, flowers = core.Geo(), core.Geo(), core.Geo(), core.Geo()
    for o in P.openings(1, ext=True):
        if not o["name"].startswith("L1_BayFront"):
            continue
        L = o["w"] + 0.24
        M = frame_matrix(o) @ Matrix.Translation((0, 0.035, -0.23 - 0.2))
        if o.get("curved"):
            M = M @ Matrix.Translation((0, 0.03, 0))
        b, s, lv, fl = window_box(L, rng)
        boxes.add(b.xf(M))
        soil.add(s.xf(M))
        leaves.add(lv.xf(M))
        flowers.add(fl.xf(M))
    # urns on the main steps' pedestals
    urn = porch.urn(0.55)
    yf = porch.PORTICO[2]
    L = 0.042 + (porch.STEPS - 1) * 0.32
    for sx in (-1, 1):
        x = sx * (porch.STEP_W / 2 + 0.265)
        y = yf - (L - 0.1)
        boxes.add(urn.move(x, y, 1.05))
        soil.add(geo.lathe([(0.0, 0.0), (0.2, 0.0), (0.2, 0.02), (0.0, 0.02)], seg=24, closed=True).move(x, y, 1.05 + 0.44))
        lv, fl = plant_clump(rng, 0.38, 0.38, h=0.42, n_leaf=90, n_fl=22)
        leaves.add(lv.move(x, y, 1.05 + 0.46))
        flowers.add(fl.move(x, y, 1.05 + 0.46))
    core.obj("WindowBoxes", boxes, col, "trim_paint", smooth=35, clean=True)
    core.obj("WindowBoxes_Soil", soil, col, "soil", smooth=None)
    core.obj("Planting_Leaves", leaves, col, "leaf", smooth=None, weld=False)
    core.obj("Planting_Flowers", flowers, col, "petal_white", smooth=None, weld=False)
    build_lanterns(col)
    core.finish_tmp()


def bpy_obj(name):
    import bpy
    return bpy.data.objects.get(name)
