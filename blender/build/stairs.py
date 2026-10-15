"""Staircases: solid carriage with oak treads, painted risers, bullnose nosings, a carpet runner
held by brass rods, open string with turned balusters (two per tread), carved newels, and the
gallery balustrades round the stair voids.

Main stair: G -> L1 against the hall's east wall, rising toward the front (bottom at the back),
half landing. Its high end passes over the music-room door with headroom. Top stair: L1 -> L2
against the west wall of the landing, rising toward the back.
"""
import math

import numpy as np
from mathutils import Matrix

from . import core, geo
from . import plan as P
from .windows import box
from .porch import baluster_geo

COL = "House/Interior/Stairs"
RAIL_H = 0.9
NOSE = 0.03


class Stair:
    def __init__(self, x_wall, x_open, y_start, direction, risers, z0, rise, going, landing):
        self.xw, self.xo = x_wall, x_open
        self.y0, self.d = y_start, direction
        self.n, self.z0, self.h, self.g, self.L = risers, z0, rise, going, landing
        self.n1 = risers // 2
        self.n2 = risers - self.n1

    def y(self, s):
        return self.y0 + self.d * s

    def steps(self):
        """List of (s_front, s_back, z_top) for each tread incl. the landing; the last riser
        arrives at the upper floor at s_end."""
        out = []
        for k in range(1, self.n1):
            out.append(((k - 1) * self.g, k * self.g, self.z0 + k * self.h))
        sl = (self.n1 - 1) * self.g
        out.append((sl, sl + self.L, self.z0 + self.n1 * self.h))
        for j in range(1, self.n2):
            s0 = sl + self.L + (j - 1) * self.g
            out.append((s0, s0 + self.g, self.z0 + (self.n1 + j) * self.h))
        return out

    @property
    def s_end(self):
        return (self.n1 - 1) * self.g + self.L + (self.n2 - 1) * self.g

    def nosing_line(self):
        """(s, z) points along the nosings (for rails/strings)."""
        pts = [(0.0, self.z0)]
        for s0, s1, z in self.steps():
            pts.append((s0, z))
        pts.append((self.s_end, self.z0 + self.n * self.h))
        return pts


def pitch_z(st, s):
    """Height of the nosing line at s (flights pitched, landing flat)."""
    sl = (st.n1 - 1) * st.g
    if s <= sl:
        return st.z0 + st.h + s * st.h / st.g
    if s <= sl + st.L:
        return st.z0 + st.n1 * st.h
    return st.z0 + st.n1 * st.h + (s - sl - st.L) * st.h / st.g + st.h * 0.0


def frame(st):
    """Local (x across from the open side to the wall, y = s, z) -> world."""
    sx = 1.0 if st.xw > st.xo else -1.0
    return Matrix(((sx, 0, 0, st.xo), (0, st.d, 0, st.y0), (0, 0, 1, 0), (0, 0, 0, 1)))


def build_stair(name, st, open_under=None, runner=True):
    col = COL
    W = abs(st.xw - st.xo)
    M = frame(st)
    if st.d < 0:
        # mirrored frame (det < 0) is handled by Geo.xf flipping faces
        pass
    body = core.Geo()
    treads = core.Geo()
    risers = core.Geo()
    nos = core.Geo()
    run = core.Geo()
    rods = core.Geo()
    soffit_drop = 0.32
    steps = st.steps()
    # carriage: per step a block from the soffit line to the tread top
    for (s0, s1, z) in steps:
        zb = pitch_z(st, s0) - soffit_drop - st.h if s1 - s0 < st.L - 1e-6 else z - 0.3
        zb_back = pitch_z(st, s1) - soffit_drop - st.h if s1 - s0 < st.L - 1e-6 else z - 0.3
        zlo = min(zb, zb_back)
        sb = s0 + 0.02          # the carriage sits behind the riser board
        se = min(s1 + 0.02, st.s_end)
        poly = [(sb, max(st.z0, zb)), (se, max(st.z0, zb_back)), (se, z - 0.03), (sb, z - 0.03)]
        if max(st.z0, zb) >= z - 0.04:
            poly = [(sb, z - 0.3), (se, z - 0.3), (se, z - 0.03), (sb, z - 0.03)]
        body.add(geo.extrude_profile_x([(s, zz) for s, zz in poly], 0.0, W - 0.035))
        # tread board with nosing (stops at the wall string)
        treads.add(box(0.0, W - 0.035, s0 - 0.0, s1, z - 0.03, z))
        nos.add(geo.extrude_profile_x([(s0, z - 0.03), (s0, z), (s0 - NOSE * 0.6, z - 0.002), (s0 - NOSE, z - 0.012),
                                        (s0 - NOSE, z - 0.02), (s0 - NOSE * 0.6, z - 0.03)][::-1] and
                                       [(s0 - NOSE, z - 0.022), (s0 - NOSE * 0.7, z - 0.03), (s0, z - 0.03), (s0, z),
                                        (s0 - NOSE * 0.7, z - 0.001), (s0 - NOSE, z - 0.01)], -0.01, W - 0.035))
        # riser under the front of this tread
        risers.add(box(0.0, W - 0.035, s0, s0 + 0.02, z - st.h + (0.0 if s0 == 0.0 else 0.0), z - 0.03))
    # final riser up to the floor above
    zt = st.z0 + st.n * st.h
    nos.add(geo.extrude_profile_x([(st.s_end - NOSE, zt - 0.022), (st.s_end - NOSE * 0.7, zt - 0.03), (st.s_end, zt - 0.03),
                                    (st.s_end, zt), (st.s_end - NOSE * 0.7, zt - 0.001), (st.s_end - NOSE, zt - 0.01)], -0.01, W - 0.035))
    # carpet runner over treads and risers with brass rods
    if runner:
        rw = W - 0.3
        xa, xb = (W - rw) / 2, (W + rw) / 2
        prof = []
        prof.append((0.0, st.z0 + 0.003))
        for (s0, s1, z) in steps:
            prof += [(s0 - NOSE - 0.006, z - st.h + 0.02), (s0 - NOSE - 0.006, z - 0.012), (s0 - NOSE + 0.004, z + 0.006),
                     (s0 + 0.01, z + 0.008), (s1 - 0.0, z + 0.008)]
        prof += [(st.s_end - NOSE - 0.006, zt - st.h + 0.02), (st.s_end - NOSE - 0.006, zt - 0.012),
                 (st.s_end - NOSE + 0.004, zt + 0.006), (st.s_end + 0.25, zt + 0.008)]
        # build as a ribbon (two rails of points) with thickness
        pts = geo.dedupe(prof[1:], closed=False)
        V, F, UV = [], [], []
        acc = 0.0
        for i, (s, z) in enumerate(pts):
            if i:
                acc += math.hypot(s - pts[i - 1][0], z - pts[i - 1][1])
            V += [(xa, s, z), (xb, s, z)]
            UV += [(0.0, acc), (1.0, acc)]
        for i in range(len(pts) - 1):
            a = 2 * i
            F.append([a, a + 1, a + 3, a + 2])
        uvf = [[UV[k] for k in f] for f in F]
        ribbon = core.Geo(np.array(V), [f[::-1] for f in F], [u[::-1] for u in uvf])
        run.add(ribbon)
        for (s0, s1, z) in steps + [(st.s_end, 0, zt)]:
            if s1 and s1 - s0 > st.g + 1e-6:
                continue
            zr = z - st.h + 0.02 if s0 != st.s_end else zt - st.h + 0.02
            rod = geo.tube([(xa - 0.04, s0 - NOSE - 0.02, zr + 0.012), (xb + 0.04, s0 - NOSE - 0.02, zr + 0.012)], 0.006, seg=8)
            rods.add(rod)
            for xe in (xa - 0.05, xb + 0.05):
                rods.add(geo.lathe([(0.0, 0.0), (0.012, 0.0), (0.012, 0.01), (0.0, 0.02)], seg=10)
                         .xf(Matrix.Translation((xe, s0 - NOSE - 0.02, zr + 0.012)) @ Matrix.Rotation(math.pi / 2, 4, "Y")))
    # strings: open string on the open side (x=0) with a moulded cap, wall string on x=W
    line = [(s, pitch_z(st, s)) for s in np.linspace(0.0, st.s_end, 80)]
    strg = core.Geo()
    for xside, t in ((0.0, -0.035), (W - 0.035, 0.035)):
        top = [(s, z + 0.02) for s, z in line]
        bot = [(s, max(st.z0 + 0.001, z - 0.3)) for s, z in line]
        poly = top + bot[::-1]
        if xside > 0:
            top = [(s, z + 0.12) for s, z in line]
            poly = top + bot[::-1]
        strg.add(geo.extrude_profile_x(geo.dedupe(poly), min(xside, xside + t), max(xside, xside + t)))
    # spandrel panelling under the open string (floor to string), except over the passage
    sp = core.Geo()
    from .windows import _raised_panel
    s_open0, s_open1 = open_under if open_under else (st.s_end + 1, st.s_end + 2)
    nseg = 7
    segs = []
    for k in range(nseg):
        a = st.s_end * k / nseg
        b = st.s_end * (k + 1) / nseg
        if b <= s_open0 or a >= s_open1:
            segs.append((a, b))
    segs = [(a, b) for a, b in segs if min(pitch_z(st, a), pitch_z(st, b)) - 0.3 >= st.z0 + 0.35]
    # one board per contiguous run (no shared end caps), panels and muntins applied on it
    runs_ = []
    for a, b in segs:
        if runs_ and abs(runs_[-1][1] - a) < 1e-6:
            runs_[-1][1] = b
        else:
            runs_.append([a, b])
    for a, b in runs_:
        top = [(s, pitch_z(st, s) - 0.3) for s in np.linspace(b, a, 40)]
        sp.add(geo.extrude_profile_x(geo.dedupe([(a, st.z0), (b, st.z0)] + top), -0.03, -0.004))
    for a, b in segs:
        za = pitch_z(st, a) - 0.3
        zb = pitch_z(st, b) - 0.3
        # raised field
        m = 0.07
        zt_ = min(za, zb) - m
        if zt_ - st.z0 > 0.3:
            sp.add(_raised_panel(a + m, b - m, st.z0 + 0.25, zt_, 0.0, 0.012).xf(
                Matrix(((0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1))).inverted() @ Matrix.Identity(4)) if False else
                   geo.extrude_profile_x([(a + m, st.z0 + 0.25), (b - m, st.z0 + 0.25), (b - m, zt_), (a + m, zt_)], -0.045, -0.03))
        # muntin posts between panels
        sp.add(box(-0.05, -0.004, a - 0.03, a + 0.03, st.z0, za))
    # balustrade on the open side: newels, handrail, balusters (two per tread)
    bal = core.Geo()
    rail = core.Geo()
    newel = newel_geo()
    sl = (st.n1 - 1) * st.g
    newel_pos = [(0.12, st.z0), (sl + 0.02, None), (sl + st.L - 0.02, None), (st.s_end - 0.02, zt)]
    hr_pts = []
    for s, z in line:
        hr_pts.append((-0.0, s, z + RAIL_H))
    # handrail sweep along the pitched line (local frame), profile mushroom rail
    hr_prof = [(-0.03, -0.06), (0.03, -0.06), (0.03, -0.04), (0.045, -0.025), (0.05, 0.0), (0.04, 0.02), (0.02, 0.03),
               (-0.02, 0.03), (-0.04, 0.02), (-0.05, 0.0), (-0.045, -0.025), (-0.03, -0.04)]
    rail.add(geo.sweep(geo.ccw(hr_prof), [(0.0, s, z + RAIL_H) for s, z in line[1:]], right=(1, 0, 0)))
    bsrc = baluster_geo(1.0, r=0.022)
    for (s0, s1, z) in steps:
        if s1 - s0 > st.g + 1e-6:
            continue
        for f in (0.25, 0.75):
            s = s0 + (s1 - s0) * f
            ztop = pitch_z(st, s) + RAIL_H - 0.06
            h = ztop - z
            g = bsrc.xf(Matrix.Translation((0.03, s, z)) @ Matrix.Diagonal((1, 1, h, 1)))
            bal.add(g)
    for s, z in newel_pos:
        zz = z if z is not None else st.z0 + st.n1 * st.h
        bal.add(newel.move(0.03, s, zz))
    notches = core.Geo()
    for s, z in newel_pos:
        zz = z if z is not None else st.z0 + st.n1 * st.h
        notches.add(box(0.03 - 0.085, 0.03 + 0.085, s - 0.085, s + 0.085, zz - 0.6, zz + 1.4))
    return M, dict(body=body, treads=treads, risers=risers, nos=nos, run=run, rods=rods, strg=strg, sp=sp, bal=bal, rail=rail,
                   notch=notches)


def newel_geo(h=1.18):
    g = core.Geo()
    g.add(box(-0.08, 0.08, -0.08, 0.08, 0.0, 0.22))
    g.add(box(-0.07, 0.07, -0.07, 0.07, 0.22, h - 0.2))
    from .windows import _raised_panel
    for k in range(4):
        R = Matrix.Rotation(k * math.pi / 2, 4, "Z")
        g.add(_raised_panel(-0.045, 0.045, 0.32, h - 0.32, 0.07, 0.01).xf(R @ Matrix.Rotation(0, 4, "Z")) if False else
              geo.extrude_profile_y(geo.ccw([(-0.045, 0.32), (0.045, 0.32), (0.045, h - 0.32), (-0.045, h - 0.32)]), 0.07, 0.08).xf(R))
    cap = [(0.0, h - 0.2), (0.1, h - 0.2), (0.1, h - 0.17), (0.085, h - 0.15), (0.095, h - 0.12), (0.1, h - 0.1),
           (0.06, h - 0.07), (0.05, h - 0.04), (0.07, h), (0.075, h + 0.04), (0.045, h + 0.08), (0.03, h + 0.11),
           (0.04, h + 0.15), (0.0, h + 0.18)]
    g.add(geo.lathe(cap, seg=24))
    return g


def gallery(pts, z, col_name, mat, newel_start=True, newel_end=True):
    """Balustrade along a polyline at floor level z (balusters, handrail, bottom rail, end newels)."""
    g = core.Geo()
    bsrc = baluster_geo(RAIL_H - 0.12, r=0.022)
    p3 = [(x, y, 0) for x, y in pts]
    hr = [(-0.03, -0.06), (0.03, -0.06), (0.03, -0.04), (0.045, -0.025), (0.05, 0.0), (0.04, 0.02), (0.02, 0.03),
          (-0.02, 0.03), (-0.04, 0.02), (-0.05, 0.0), (-0.045, -0.025), (-0.03, -0.04)]
    g.add(geo.sweep(geo.ccw([(o, h + z + RAIL_H) for o, h in hr]), p3, up=(0, 0, 1)))
    g.add(geo.sweep(geo.ccw([(-0.035, z), (0.035, z), (0.035, z + 0.06), (-0.035, z + 0.06)]), p3, up=(0, 0, 1)))
    L = geo.path_len(pts)
    n = int(L / 0.12)
    from .porch import Path2
    pa = Path2(pts)
    for k in range(n):
        p, _ = pa.at((k + 0.5) * L / n)
        g.add(bsrc.move(p[0], p[1], z + 0.06))
    nw = newel_geo()
    for p in [q for q, on in ((pts[0], newel_start), (pts[-1], newel_end)) if on]:
        g.add(nw.move(p[0], p[1], z))
    return g


def build():
    core.clear(COL)
    sm = P.STAIR_MAIN
    run_len = (sm["risers"] // 2 - 1) * sm["going"] * 2 + sm["landing"]
    main = Stair(sm["x1"], sm["x0"], sm["y0"] + run_len, -1, sm["risers"], P.G, (P.L1 - P.G) / sm["risers"],
                 sm["going"], sm["landing"])
    # passage under the high end, over the music-room door
    door_y = 2.62
    s_door = main.y0 - door_y
    M, parts = build_stair("MainStair", main, open_under=(s_door - 0.9, main.s_end + 0.1))
    tp = P.STAIR_TOP
    top = Stair(tp["x0"], tp["x1"], tp["y0"], 1, tp["risers"], P.L1, (P.L2 - P.L1) / tp["risers"], tp["going"], tp["landing"])
    M2, parts2 = build_stair("TopStair", top)
    mats = dict(body="ceiling_plaster", treads="oak_tread", risers="trim_int", nos="oak_tread", run="stair_runner",
                rods="brass", strg="walnut", sp="walnut", bal="walnut", rail="walnut")
    for nm, Mx, pr in (("MainStair", M, parts), ("TopStair", M2, parts2)):
        notch = pr.pop("notch")
        for k, g in pr.items():
            if not g.F:
                continue
            core.obj(f"{nm}_{k.capitalize()}", g.xf(Mx), COL, mats[k], smooth=35 if k in ("bal", "rail", "rods", "nos") else None,
                     weld=k not in ("run",), clean=k in ("body", "bal", "sp", "strg", "rods"))
            if k in ("body", "treads", "risers", "nos", "strg", "run", "rods"):
                ob = __import__("bpy").data.objects[f"{nm}_{k.capitalize()}"]
                core.boolean(ob, [core.geo_obj(notch.xf(Mx), "_notch")], op="DIFFERENCE")
    # gallery balustrades at L1 round the main stair void (open edge toward the gallery + back end)
    x_open = sm["x0"]
    y_back = sm["y0"] + run_len
    top_newel_y = main.y0 - main.s_end + 0.02       # world y of the main stair's top newel
    xe = x_open - 0.04 - 0.05            # on the floor, 5 cm in from the stairwell's edge
    g1 = gallery([(xe, top_newel_y + 0.25), (xe, y_back + 0.13), (sm["x1"] - 0.13, y_back + 0.13)], P.L1, "L1", "walnut")
    # at L2 round the top stair void
    run2 = (tp["risers"] // 2 - 1) * tp["going"] * 2 + tp["landing"]
    top2_y = top.y0 + top.s_end - 0.02
    xe2 = tp["x1"] + 0.04 + 0.05
    g2 = gallery([(tp["x0"] + 0.13, tp["y0"] - 0.13), (xe2, tp["y0"] - 0.13), (xe2, top2_y - 0.25)], P.L2, "L2", "walnut")
    # the wall string stops round the music-room door's casing
    ws = __import__("bpy").data.objects.get("MainStair_Strg")
    if ws is not None:
        cut = core.geo_obj(geo.box(sm["x1"] - 0.2, door_y - 0.5 - 0.2, P.G - 0.1, sm["x1"] + 0.2, door_y + 0.5 + 0.2, P.G + 2.75 + 0.22), "_wc")
        core.boolean(ws, [cut], op="DIFFERENCE")
    core.obj("Gallery_L1", g1, COL, "walnut", smooth=35, clean=True)
    core.obj("Gallery_L2", g2, COL, "walnut", smooth=35, clean=True)
    core.finish_tmp()
