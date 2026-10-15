"""Clapboard siding, corner boards, belt course and water table on the ground/first floor walls.

Siding is a single sawtooth solid per wall run (corner to corner), cut around window/door trim
so boards butt against casings and corner boards, as on a real house.
"""
import math

import numpy as np

from . import core, geo
from . import plan as P

COL = "House/Exterior/Siding"
EXP = 0.118          # board exposure
BUTT = 0.019         # butt thickness proud of the sheathing
TIP = 0.005          # thin edge under the next board
CB_W, CB_T = 0.15, 0.032     # corner board width / thickness
IC_W = 0.06                   # inside corner strip
CASING = 0.15        # exterior window casing width
HEAD_H = 0.36        # head trim height above the opening
SILL_H = 0.2         # sill + apron below the opening
WT_TOP = 1.15        # water table top
BELT = (5.0, 5.4)    # belt course between ground and first floor
TOP_MAIN = 9.2       # bottom of the main frieze
TOP_WING = 8.95      # bottom of the wing frieze


def clap_profile(z0, z1):
    n = max(1, round((z1 - z0) / EXP))
    e = (z1 - z0) / n
    front = [(0.0, z0), (BUTT, z0)]
    for k in range(n):
        zt = z0 + (k + 1) * e
        front.append((TIP, zt))
        if k < n - 1:
            front.append((BUTT, zt))
    back = [(0.0, z0 + k * e) for k in range(n, 0, -1)]
    return front + back, n


def clap_solid(path2, z0, z1):
    prof, n = clap_profile(z0, z1)
    m = len(prof)
    g = geo.sweep(prof, [(x, y, 0) for x, y in path2], up=(0, 0, 1), caps=False)
    # index helpers into the profile
    # front: 0 back(z0), 1 butt(z0), then per board k: tip_k = 2+2k, butt_{k+1} = 3+2k
    # back chain: index m-1-j is back(z0+(j+1)e) for j = 0..n-1
    def back(k):
        return 0 if k == 0 else m - k

    def butt(k):
        return 1 if k == 0 else 1 + 2 * k

    def tip(k):
        return 2 + 2 * k

    last = len(path2) - 1
    for k in range(n):
        # the cap of board k: its bottom edge passes the previous board's thin tip (no T-junction)
        q = [back(k)] + ([tip(k - 1)] if k > 0 else []) + [butt(k), tip(k), back(k + 1)]
        g.F.append(list(q))
        g.UV.append([tuple(prof[i]) for i in q])
        qq = [last * m + i for i in q][::-1]
        g.F.append(qq)
        g.UV.append([tuple(prof[i]) for i in q][::-1])
    g.M = [0] * len(g.F)
    return g


def runs(outline):
    """Split the outline into runs at corners. Returns (polyline, start_kind, end_kind) with kind
    'convex' | 'concave'."""
    p = [np.array(q, float) for q in outline]
    n = len(p)
    corner = []
    for i in range(n):
        d0 = p[i] - p[i - 1]
        d1 = p[(i + 1) % n] - p[i]
        d0 /= np.linalg.norm(d0)
        d1 /= np.linalg.norm(d1)
        ang = math.degrees(math.acos(max(-1, min(1, float(d0 @ d1)))))
        if ang > 12:
            cr = d0[0] * d1[1] - d0[1] * d1[0]
            corner.append((i, "convex" if cr > 0 else "concave"))
    out = []
    for k in range(len(corner)):
        i0, k0 = corner[k]
        i1, k1 = corner[(k + 1) % len(corner)]
        idx = list(range(i0, i1 + 1)) if i1 > i0 else list(range(i0, n)) + list(range(0, i1 + 1))
        out.append(([tuple(p[i]) for i in idx], k0, k1))
    return out


def trim_poly(poly, d0, d1):
    """Shorten an open polyline by d0 at its start and d1 at its end."""
    p = [np.array(q, float) for q in poly]

    def cut_start(pts, d):
        while len(pts) > 1:
            seg = np.linalg.norm(pts[1] - pts[0])
            if seg > d:
                pts[0] = pts[0] + (pts[1] - pts[0]) / seg * d
                return pts
            d -= seg
            pts.pop(0)
        return pts

    p = cut_start(p, d0)
    p = cut_start(p[::-1], d1)[::-1]
    return [tuple(q) for q in p]


def is_bay(poly):
    bays = [P.BAY_FRONT, P.BAY_BACK]
    for b in bays:
        for i in range(3):
            a, c = np.array(b[i]), np.array(b[i + 1])
            if np.linalg.norm(np.array(poly[0]) - a) < 1e-3 and np.linalg.norm(np.array(poly[-1]) - c) < 1e-3:
                return True
    return False


def run_top(poly):
    xm = sum(q[0] for q in poly) / len(poly)
    return TOP_WING if (xm < P.M[0] - 0.01 or xm > P.M[2] + 0.01) else TOP_MAIN


def trim_cutter(o, depth=0.12, extra_w=0.0, z_lo=None, z_hi=None):
    """Box covering an opening's exterior trim outline (siding stops here)."""
    fl = P.LEVELS[o["level"]]
    z0 = fl + o["sill"] - SILL_H if z_lo is None else z_lo
    if o["kind"] in ("door", "french"):
        z0 = fl - 0.25
    z1 = fl + o["head"] + HEAD_H if z_hi is None else z_hi
    a = o["ang"]
    n = np.array([math.cos(a), math.sin(a)])
    t = np.array([-n[1], n[0]])
    p = np.array(o["p"])
    hw = o["w"] / 2 + CASING + 0.056 + extra_w + (0.03 if o["kind"] in ("door", "french") else 0.0)
    c = [p - t * hw - n * 0.05, p + t * hw - n * 0.05, p + t * hw + n * depth, p - t * hw + n * depth]
    if o.get("curved"):
        # radial box needs to reach the curved surface at the casing's outer edges
        c = [p - t * hw - n * 0.25, p + t * hw - n * 0.25, p + t * hw + n * depth, p - t * hw + n * depth]
    return geo.prism([tuple(q) for q in c], z0, z1)


def corner_board(c, d0, d1, z0, z1, kind):
    c, d0, d1 = (np.array(v, float) for v in (c, d0, d1))
    n0 = np.array([d0[1], -d0[0]])
    n1 = np.array([d1[1], -d1[0]])
    if kind == "convex":
        m = n0 + n1
        m = m / np.linalg.norm(m)
        m = m / float(m @ n0)
        pts = [c - d0 * CB_W, c - d0 * CB_W + n0 * CB_T, c + m * CB_T, c + d1 * CB_W + n1 * CB_T, c + d1 * CB_W, c]
    else:
        s = IC_W
        pts = [c, c + d1 * s, c + d1 * s - d0 * s, c - d0 * s]
    return geo.prism(geo.ccw([tuple(q) for q in pts]), z0, z1)


def build():
    core.clear(COL)
    ol = geo.ccw(P.outline01())
    ext = P.openings(ext=True)
    bands = [(0, WT_TOP, BELT[0]), (1, BELT[1], None)]
    pieces = []
    cb_geo = core.Geo()
    for level, z0, ztop in bands:
        for poly, k0, k1 in runs(ol):
            if is_bay(poly):
                continue
            top = ztop if ztop is not None else run_top(poly)
            d0 = CB_W if k0 == "convex" else IC_W
            d1 = CB_W if k1 == "convex" else IC_W
            pl = trim_poly(poly, d0, d1)
            if len(pl) < 2 or geo.path_len(pl) < 0.05:
                continue
            g = clap_solid(pl, z0, top)
            o = core.obj(f"Siding_{'G' if level == 0 else 'L1'}_{len(pieces):02d}", g, COL, "siding_paint", smooth=None)
            # cut around trims on this band
            cut = []
            for op in ext:
                if op["level"] != level:
                    continue
                cut.append(core.geo_obj(trim_cutter(op), "_tc"))
            if P.CHIMNEY_EXT and level in (0, 1):
                x0, y0, x1, y1 = P.CHIMNEY_EXT
                cut.append(core.geo_obj(geo.box(x0 - 0.02, y0 - 0.02, 0.0, x1 + 0.1, y1 + 0.02, 12.0), "_ch"))
            # keep only cutters that touch this run's bbox
            bb = np.array(pl)
            lo, hi = bb.min(0) - 0.5, bb.max(0) + 0.5
            keep = []
            for c in cut:
                v = np.array([c.matrix_world @ vv.co for vv in c.data.vertices])
                if (v[:, 0].max() < lo[0] or v[:, 0].min() > hi[0] or v[:, 1].max() < lo[1] or v[:, 1].min() > hi[1]):
                    core.remove(c)
                else:
                    keep.append(c)
            if keep:
                core.boolean(o, keep, op="DIFFERENCE")
            core.smooth_by_angle(o, 20)
            pieces.append(o)
    # corner boards
    p = [np.array(q, float) for q in ol]
    n = len(p)
    for i in range(n):
        d0 = p[i] - p[i - 1]
        d1 = p[(i + 1) % n] - p[i]
        d0 /= np.linalg.norm(d0)
        d1 /= np.linalg.norm(d1)
        ang = math.degrees(math.acos(max(-1, min(1, float(d0 @ d1)))))
        if ang <= 12:
            continue
        cr = d0[0] * d1[1] - d0[1] * d1[0]
        kind = "convex" if cr > 0 else "concave"
        # skip bay corners: the bay gets pilasters
        on_bay = any(np.linalg.norm(p[i] - np.array(b)) < 1e-3 for bay in (P.BAY_FRONT, P.BAY_BACK) for b in bay)
        if on_bay:
            continue
        for level, z0, ztop in bands:
            top = ztop if ztop is not None else (TOP_WING if (p[i][0] < P.M[0] - 0.01 or p[i][0] > P.M[2] + 0.01 or
                                                              (abs(p[i][0] - P.M[0]) < 0.01 and (P.B[1] - 0.01 < p[i][1] < P.B[3] + 0.01) and False)) else TOP_MAIN)
            # wing/main junction corners: the board follows the lower (wing) frieze
            if abs(p[i][0] - P.B[2]) < 1e-3 and abs(p[i][1] - P.B[1]) < 1e-3 or abs(p[i][0] - P.B[2]) < 1e-3 and abs(p[i][1] - P.B[3]) < 1e-3:
                top = TOP_WING if ztop is None else ztop
            if abs(p[i][0] - P.E[0]) < 1e-3 and (abs(p[i][1] - P.E[1]) < 1e-3 or abs(p[i][1] - P.E[3]) < 1e-3):
                top = TOP_WING if ztop is None else ztop
            cb_geo.add(corner_board(p[i], d0, d1, z0, top, kind))
    cb = core.obj("CornerBoards", cb_geo, COL, "trim_paint", smooth=None)
    core.bevel(cb, 0.003, 1, 50)
    # belt course and water table, swept round the whole outline
    belt_prof = [(0.0, BELT[0]), (0.034, BELT[0]), (0.034, BELT[1] - 0.06), (0.06, BELT[1] - 0.045),
                 (0.07, BELT[1] - 0.02), (0.05, BELT[1]), (0.0, BELT[1])]
    g = geo.sweep(belt_prof, [(x, y, 0) for x, y in ol], closed=True)
    core.obj("BeltCourse", g, COL, "trim_paint", smooth=40)
    wt_prof = [(0.0, P.FOUND_TOP), (0.1, P.FOUND_TOP), (0.1, 1.03), (0.085, 1.05), (0.035, WT_TOP - 0.01), (0.0, WT_TOP)]
    g = geo.sweep(wt_prof, [(x, y, 0) for x, y in ol], closed=True)
    core.obj("WaterTable", g, COL, "trim_paint", smooth=40)
    core.finish_tmp()
