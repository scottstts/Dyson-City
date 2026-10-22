"""Interior architecture: skirting, picture rails, plaster cornices, walnut wainscot and ceiling roses.

Every run is derived from the built structure: the storey solid is sliced at the trim's height and
the wall-face segments are chained per room (openings and the stairs break the chains), so trims
follow the real walls, including the turret's curve, and stop at door casings.
"""
import math
from collections import defaultdict

import numpy as np
import bpy
from mathutils import Matrix

from . import core, geo
from . import plan as P
from .shell import room_at, in_opening, _pip
from .windows import _raised_panel, box, WALNUT_ROOMS, INT_CAS_W

COL = "House/Interior/Trim"

# room character: (skirting height, picture rail, cornice, wainscot height or 0)
GRAND = {"Hall", "Parlour", "Dining", "Library", "Music", "Study", "Landing", "Vestibule"}
WAINSCOT = {"Hall": 1.0, "Vestibule": 1.0, "Landing": 1.0, "Dining": 1.0}     # dining panelled in walnut (interior ref)
TILED = {"WC", "Bath", "MasterBath", "Kitchen"}


def slice_segments(o, z):
    """Wall-face segments of mesh object `o` at height z: list of (p0, p1, normal2d)."""
    me = o.data
    V = np.array([o.matrix_world @ v.co for v in me.vertices])
    out = []
    for poly in me.polygons:
        n = poly.normal
        if abs(n.z) > 0.2:
            continue
        idx = list(poly.vertices)
        pts = V[idx]
        zs = pts[:, 2] - z
        if zs.max() <= 0 or zs.min() >= 0:
            continue
        cuts = []
        m = len(idx)
        for i in range(m):
            a, b = pts[i], pts[(i + 1) % m]
            za, zb = a[2] - z, b[2] - z
            if (za < 0) != (zb < 0):
                t = za / (za - zb)
                cuts.append(a + (b - a) * t)
        if len(cuts) >= 2:
            n2 = np.array([n.x, n.y])
            n2 /= np.linalg.norm(n2)
            # a face may wrap round an opening: sort crossings along the face and pair them up
            t = np.array([-n2[1], n2[0]])
            cuts.sort(key=lambda c: float(c[:2] @ t))
            for i in range(0, len(cuts) - 1, 2):
                if np.linalg.norm(cuts[i][:2] - cuts[i + 1][:2]) > 1e-4:
                    out.append((cuts[i][:2], cuts[i + 1][:2], n2))
    return out


def breasts(level):
    out = []
    for ob in bpy.data.objects:
        if ob.name.startswith("Fireplace_") and ob.name.endswith("_Breast"):
            bb = [ob.matrix_world @ __import__("mathutils").Vector(c) for c in ob.bound_box]
            zlo = min(v.z for v in bb)
            if abs(zlo - P.LEVELS[level]) < 0.05:
                out.append(ob)
    return out


def _clip_behind(segs, boxes):
    """Remove the parts of wall segments that lie behind (inside the footprint of) breast boxes."""
    out = []
    for a, b, n in segs:
        pieces = [(a, b)]
        for (lo, hi) in boxes:
            nxt = []
            for p, q in pieces:
                d = q - p
                L = float(np.linalg.norm(d))
                if L < 1e-6:
                    continue
                # parametric interval of the segment inside the (slightly grown) box
                t0, t1 = 0.0, 1.0
                ok = True
                for k in range(2):
                    if abs(d[k]) < 1e-9:
                        if not (lo[k] - 0.03 <= p[k] <= hi[k] + 0.03):
                            ok = False
                    else:
                        ta = (lo[k] - 0.03 - p[k]) / d[k]
                        tb = (hi[k] + 0.03 - p[k]) / d[k]
                        t0, t1 = max(t0, min(ta, tb)), min(t1, max(ta, tb))
                if not ok or t1 <= t0:
                    nxt.append((p, q))
                    continue
                # keep the outside parts, ending exactly at the breast's sides
                lo2 = np.array(lo)
                hi2 = np.array(hi)
                ta_ = (np.clip(p + d * t0, lo2, hi2))
                if t0 > 1e-6:
                    nxt.append((p, p + d * t0 + d / L * 0.03))
                if t1 < 1 - 1e-6:
                    nxt.append((p + d * t1 - d / L * 0.03, q))
            pieces = nxt
        for p, q in pieces:
            out.append((p, q, n))
    return out


def stair_boxes(level):
    out = []
    for st, lv, side in ((P.STAIR_MAIN, 0, "x0"), (P.STAIR_TOP, 1, "x1")):
        if lv != level:
            continue
        run = (st["risers"] // 2 - 1) * st["going"] * 2 + st["landing"]
        out.append((np.array([st["x0"] - 0.06, st["y0"] - 0.06]), np.array([st["x1"] + 0.06, st["y0"] + run + 0.06])))
    return out


def window_boxes(level, zmax):
    """Footprints (with casings) of windows whose interior trim comes below zmax above the floor."""
    out = []
    for o in P.openings(level, ext=True):
        if o["kind"] != "window" or o["sill"] - 0.15 > zmax:
            continue
        a = o["ang"]
        n = np.array([math.cos(a), math.sin(a)])
        t = np.array([-n[1], n[0]])
        p = np.array(o["p"])
        hw = o["w"] / 2 + INT_CAS_W + 0.04
        pts = [p + t * hw, p - t * hw, p + t * hw - n * (P.TE + 0.08), p - t * hw - n * (P.TE + 0.08)]
        P2 = np.array(pts)
        out.append((P2.min(0), P2.max(0)))
    return out


def room_chains(level, z, skip=None, clip=()):
    """Chains of wall-face segments per room at height z (walls and chimney breasts). Each chain is a
    list of 2D points ordered so the room is on the right of travel (sweep profiles point into it)."""
    o = bpy.data.objects[["Structure_G", "Structure_L1", "Structure_L2"][level]]
    segs = slice_segments(o, z)
    bs = breasts(level)
    if bs:
        boxes = []
        extra = []
        from .fireplaces import FIRES
        for ob in bs:
            V = np.array([ob.matrix_world @ v.co for v in ob.data.vertices])
            boxes.append((V[:, :2].min(0), V[:, :2].max(0)))
            f = next(ff for ff in FIRES if ob.name == f"Fireplace_{ff[0]}_Breast")
            a = math.radians(f[3])
            facing = np.array([math.cos(a), math.sin(a)])
            along = np.array([-facing[1], facing[0]])
            wall = np.array(f[2])
            for p, q, n in slice_segments(ob, z):
                mid = (p + q) / 2
                # keep only the breast's two side faces (the front is covered by the chimneypiece,
                # the opening's reveals by the register)
                if abs(float(n @ facing)) < 0.1 and abs(abs(float((mid - wall) @ along)) - f[4] / 2) < 0.02:
                    extra.append((p, q, n))
        segs = _clip_behind(segs, boxes) + extra
    else:
        pass
    if clip:
        segs = _clip_behind(segs, list(clip))
    by_room = defaultdict(list)
    for a, b, n in segs:
        mid = (a + b) / 2
        probe = np.array([mid[0] + n[0] * 0.06, mid[1] + n[1] * 0.06, z])
        r = room_at(probe, level)
        if r is None or in_opening(np.array([mid[0] - n[0] * 0.02, mid[1] - n[1] * 0.02, z]), level):
            continue
        if skip is not None and skip(mid, r):
            continue
        # orient: travel t = z x n  =>  t = (-n.y, n.x)
        t = np.array([-n[1], n[0]])
        if float((b - a) @ t) < 0:
            a, b = b, a
        by_room[r["name"]].append((tuple(np.round(a, 5)), tuple(np.round(b, 5))))
    out = {}
    for name, ss in by_room.items():
        out[name] = _chain(ss)
    return out


def _chain(segs):
    nxt = defaultdict(list)
    for a, b in segs:
        nxt[_key(a)].append((a, b))
    used = set()
    chains = []
    starts = {(_key(a)) for a, b in segs}
    ends = {(_key(b)) for a, b in segs}
    order = [s for s in segs if _key(s[0]) not in ends] + segs   # open chains first
    for s in order:
        if id(s) in used or (s[0], s[1]) in used:
            continue
        chain = [s[0], s[1]]
        used.add((s[0], s[1]))
        cur = s[1]
        while True:
            cand = [c for c in nxt.get(_key(cur), []) if (c[0], c[1]) not in used]
            if not cand:
                break
            c = cand[0]
            used.add((c[0], c[1]))
            chain.append(c[1])
            cur = c[1]
        closed = _key(chain[0]) == _key(chain[-1]) and len(chain) > 3
        if closed:
            chain = chain[:-1]
        chain = _simplify(chain, closed)
        if len(chain) >= 2:
            chains.append((chain, closed))
    return chains


def _key(p):
    return (round(p[0], 3), round(p[1], 3))


def _simplify(pts, closed):
    """Merge collinear consecutive points."""
    P_ = [np.array(p) for p in pts]
    out = []
    n = len(P_)
    for i in range(n):
        if not closed and (i == 0 or i == n - 1):
            out.append(P_[i])
            continue
        a, b, c = P_[i - 1], P_[i], P_[(i + 1) % n]
        d0 = b - a
        d1 = c - b
        if np.linalg.norm(d0) < 1e-6:
            continue
        cr = abs(d0[0] * d1[1] - d0[1] * d1[0]) / (np.linalg.norm(d0) * max(np.linalg.norm(d1), 1e-9))
        if cr < 1e-4 and float(d0 @ d1) > 0:
            continue
        out.append(b)
    return [tuple(p) for p in out]


def trim_ends(chain, level, z, amount):
    """Shorten open chains at ends that meet an opening by the casing width."""
    from .siding import trim_poly
    d0 = amount if _near_opening(chain[0], level, z) else 0.0
    d1 = amount if _near_opening(chain[-1], level, z) else 0.0
    return trim_poly(chain, d0, d1) if (d0 or d1) else chain


def _near_opening(p, level, z):
    for o in P.openings(level):
        if not (o["sill"] - 0.05 <= z - P.LEVELS[level] <= o["head"] + 0.05):
            continue
        a = o["ang"]
        n = np.array([math.cos(a), math.sin(a)])
        t = np.array([-n[1], n[0]])
        d = np.array(p) - np.array(o["p"])
        th = (o.get("thick", P.TI) if not o["ext"] else P.TE) + 0.1
        if abs(float(d @ t)) <= o["w"] / 2 + 0.03 and -th - 0.05 <= float(d @ n) <= th:
            return True
    return False


def _under_window(mid, r, zd):
    """Wall stretches below a window whose interior trim comes down below the dado height."""
    for o in P.openings(r["level"], ext=True):
        if o["kind"] != "window" or o["sill"] - 0.15 > zd:
            continue
        a = o["ang"]
        n = np.array([math.cos(a), math.sin(a)])
        t = np.array([-n[1], n[0]])
        d = np.array(mid) - np.array(o["p"])
        if abs(float(d @ t)) <= o["w"] / 2 + INT_CAS_W + 0.05 and -P.TE - 0.1 <= float(d @ n) <= 0.05:
            return True
    return False


def on_stairs(mid, r):
    """Wall stretches covered by a stair's wall string get no skirting."""
    for st, lv in ((P.STAIR_MAIN, 0), (P.STAIR_TOP, 1)):
        run = (st["risers"] // 2 - 1) * st["going"] * 2 + st["landing"]
        if r["level"] == lv and st["x0"] - 0.1 <= mid[0] <= st["x1"] + 0.1 and st["y0"] - 0.05 <= mid[1] <= st["y0"] + run + 0.05:
            return True
    return False


# ---------------------------------------------------------------- profiles (o into the room, h up)

def skirting_prof(h, grand):
    if grand:
        return [(0.0, 0.0), (0.024, 0.0), (0.024, h - 0.07), (0.028, h - 0.06), (0.036, h - 0.045), (0.036, h - 0.03),
                (0.03, h - 0.018), (0.02, h - 0.01), (0.012, h), (0.0, h)]
    return [(0.0, 0.0), (0.02, 0.0), (0.02, h - 0.03), (0.028, h - 0.018), (0.016, h), (0.0, h)]


PICTURE_RAIL = [(0.0, -0.025), (0.012, -0.025), (0.02, -0.018), (0.028, -0.005), (0.03, 0.006), (0.02, 0.018), (0.0, 0.025)]


def cornice_prof(grand):
    if grand:
        return [(o * 0.66, h * 0.62) for o, h in _grand_cornice()]
    return _small_cornice()


def _grand_cornice():
    if True:
        pts = [(0.0, -0.32), (0.012, -0.32), (0.018, -0.3), (0.03, -0.29), (0.03, -0.26)]
        for k in range(1, 9):
            a = (math.pi / 2) * k / 8
            pts.append((0.03 + 0.14 * (1 - math.cos(a)), -0.26 + 0.14 * math.sin(a)))
        pts += [(0.19, -0.11), (0.19, -0.085), (0.22, -0.07), (0.25, -0.04), (0.27, -0.012), (0.28, 0.0), (0.0, 0.0)]
        return pts


def _small_cornice():
    pts = [(0.0, -0.11)]
    for k in range(1, 7):
        a = (math.pi / 2) * k / 6
        pts.append((0.09 * (1 - math.cos(a)), -0.11 + 0.09 * math.sin(a)))
    pts += [(0.11, -0.01), (0.11, 0.0), (0.0, 0.0)]
    return pts


DADO_RAIL = [(0.0, -0.02), (0.018, -0.02), (0.026, -0.012), (0.03, 0.0), (0.026, 0.012), (0.016, 0.022), (0.0, 0.022)]


def sweep_chain(chain, closed, prof, z):
    p3 = [(x, y, z) for x, y in chain]
    return geo.sweep(geo.ccw(prof), p3, closed=closed, up=(0, 0, 1))


def wainscot_along(chain, z0, z1, max_panel=0.62):
    """Panelled dado: a backing board, stiles and raised fields along straight stretches."""
    g = core.Geo()
    pts = [np.array(p) for p in chain]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        L = float(np.linalg.norm(b - a))
        if L < 0.25:
            continue
        t = (b - a) / L
        n = np.array([t[1], -t[0]])      # into the room (right of travel)
        M = Matrix(((t[0], n[0], 0, a[0]), (t[1], n[1], 0, a[1]), (0, 0, 1, 0), (0, 0, 0, 1)))
        g.add(box(0.0, L, 0.0, 0.016, z0, z1).xf(M))
        k = max(1, round(L / max_panel))
        w = L / k
        for j in range(k):
            x0, x1 = j * w + 0.045, (j + 1) * w - 0.045
            if x1 - x0 < 0.08:
                continue
            g.add(_raised_panel(x0, x1, z0 + 0.07, z1 - 0.07, 0.016, 0.012).xf(M))
        for j in range(k + 1):
            x = j * w
            g.add(box(max(0.0, x - 0.045), min(L, x + 0.045), 0.016, 0.026, z0, z1).xf(M))
        g.add(box(0.0, L, 0.016, 0.026, z0, z0 + 0.07).xf(M))
        g.add(box(0.0, L, 0.016, 0.026, z1 - 0.07, z1).xf(M))
    return g


# Ceiling roses: one over each pendant in these rooms (rooms.pendant), sized to its bowl. The pendant's
# canopy seats on the rose's flat boss, ROSE_BOSS below the ceiling; elsewhere it seats on the ceiling.
ROSE_ROOMS = GRAND - {"Vestibule"}
ROSE_BOSS = 0.085
BOSS_R = 0.075              # flat boss face: wider than the pendant's canopy (0.07)


def rose_radius(room):
    """The rose a pendant in `room` hangs from (m), or None (the canopy sits on the ceiling)."""
    if room not in ROSE_ROOMS:
        return None
    return 0.34 if room in ("Parlour", "Dining") else 0.26


def rose(r=0.32):
    """Plaster ceiling rose: concentric beads and a ring of leaves (as relief rings), hanging down to a
    flat boss ROSE_BOSS below the ceiling."""
    prof = [(0.0, 0.0), (r, 0.0), (r, -0.008), (r - 0.02, -0.016), (r - 0.05, -0.02), (r - 0.06, -0.03), (r - 0.09, -0.032),
            (r * 0.55, -0.045), (r * 0.45, -0.05), (r * 0.35, -0.04), (BOSS_R + 0.01, -0.068), (BOSS_R, -0.078),
            (BOSS_R, -ROSE_BOSS), (0.0, -ROSE_BOSS)]
    g = geo.lathe(prof[::-1], seg=48)
    # leaf relief ring
    for k in range(16):
        a = math.tau * k / 16
        c, s = math.cos(a), math.sin(a)
        rr = r * 0.62
        leaf = [(rr - 0.05, -0.012), (rr, 0.0), (rr + 0.05, -0.012), (rr, 0.024)]
        pts = [(x * c, x * s) for x, _ in leaf]
        sx = [(x * c - y * s, x * s + y * c) for x, y in leaf]
        lg = geo.prism(geo.ccw(sx), -0.045, -0.006)
        g.add(lg)
    return g.xf(Matrix.Diagonal((1, 1, 1, 1)))


def build():
    core.clear(COL)
    for level in (0, 1, 2):
        fl = P.LEVELS[level]
        skirt, crowns, rails, dados, wains = core.Geo(), core.Geo(), core.Geo(), core.Geo(), core.Geo()
        skirt_w, wains_w = core.Geo(), core.Geo()
        # skirting
        for name, chains in room_chains(level, fl + 0.12, clip=stair_boxes(level)).items():
            grand = name in GRAND
            h = 0.28 if grand else 0.2
            if name in TILED:
                h = 0.15
            dst = skirt_w if name in WALNUT_ROOMS else skirt
            for chain, closed in chains:
                if not closed:
                    chain = trim_ends(chain, level, fl + 0.12, INT_CAS_W + 0.004)
                if len(chain) < 2 or geo.path_len(chain) < 0.06:
                    continue
                dst.add(sweep_chain(chain, closed, skirting_prof(h, grand), fl))
        # wainscot + dado rail
        for name, zd in WAINSCOT.items():
            r = next((rr for rr in P.rooms(level) if rr["name"] == name), None)
            if r is None:
                continue
            ch = room_chains(level, fl + zd * 0.6, clip=stair_boxes(level) + window_boxes(level, zd)).get(name, [])
            for chain, closed in ch:
                # drop stretches under windows whose aprons come down below the dado
                if not closed:
                    chain = trim_ends(chain, level, fl + zd * 0.6, INT_CAS_W + 0.004)
                if len(chain) < 2:
                    continue
                wains_w.add(wainscot_along(chain, fl + 0.28, fl + zd))
                dados.add(sweep_chain(chain, closed, DADO_RAIL, fl + zd + 0.02))
        # cornices, picture rails (rooms with flat ceilings; not on the top floor's slopes)
        if level < 2:
            for name, chains in room_chains(level, P.CEIL[level] - 0.02, clip=stair_boxes(level)).items():
                grand = name in GRAND
                for chain, closed in chains:
                    if geo.path_len(chain) < 0.1:
                        continue
                    crowns.add(sweep_chain(chain, closed, cornice_prof(grand), P.CEIL[level]))
            # the picture rail sits just above the tallest window/door casing (head + 0.18)
            zr = P.CEIL[level] - 0.27
            for name, chains in room_chains(level, zr, clip=stair_boxes(level)).items():
                if name not in GRAND or name in WAINSCOT and WAINSCOT[name] > 0.9:
                    continue
                for chain, closed in chains:
                    if len(chain) < 2 or geo.path_len(chain) < 0.1:
                        continue
                    rails.add(sweep_chain(chain, closed, PICTURE_RAIL, zr))
        tag = ["G", "L1", "L2"][level]
        if skirt.F:
            core.obj(f"Skirting_{tag}", skirt, COL, "trim_int", smooth=40)
        if skirt_w.F:
            core.obj(f"Skirting_{tag}_Walnut", skirt_w, COL, "walnut", smooth=40)
        if crowns.F:
            core.obj(f"Cornice_{tag}", crowns, COL, "ceiling_plaster", smooth=40)
        if rails.F:
            core.obj(f"PictureRail_{tag}", rails, COL, "walnut", smooth=40)
        if dados.F:
            core.obj(f"DadoRail_{tag}", dados, COL, "walnut", smooth=40)
        if wains_w.F:
            core.obj(f"Wainscot_{tag}", wains_w, COL, "walnut", smooth=None, clean=True)
    core.finish_tmp()
