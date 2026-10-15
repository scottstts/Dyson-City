"""Porches: the wraparound front porch (entry portico with pediment, curved run round the turret,
straight run along the east wing), the west porch with its balcony, and the rear stoop.

Each porch is described by its outer deck edge (an open polyline, outward on the right of travel)
and its plan region. Columns stand on a line inset from the edge; railings, the spindle frieze and
the beam follow that line; the lattice skirt follows the edge.
"""
import math

import numpy as np
from mathutils import Matrix

from . import core, geo
from . import plan as P
from .windows import box, _raised_panel

COL = "House/Exterior/Porch"

DECK = P.PORCH
CEIL = 4.95          # above every ground-floor head trim behind the porch (max 4.91)
BEAM_BOT = 4.6
ROOF_EDGE = 5.2
ROOF_WALL = 5.65     # meets the wall between the belt course and the first-floor aprons (5.7)
CEIL_W = 4.45        # west porch: its ceiling is the balcony slab
BEAM_W = 4.1
PEDIMENT_BACK = -2.4
OVER = 0.35
INSET = 0.24
RAIL_H = 0.88
PORCH_R = 4.6
PORTICO = (-1.6, 1.6, -4.4)    # x0, x1, front y
STEP_W = 2.2
STEPS = 5


# ---------------------------------------------------------------- paths

def main_edge():
    cx, cy = P.TURRET
    x0, x1, yf = PORTICO
    a0 = math.atan2(-math.sqrt(PORCH_R ** 2 - (x1 - cx) ** 2), x1 - cx)
    a1 = math.atan2(-0.4 - cy, math.sqrt(PORCH_R ** 2 - (-0.4 - cy) ** 2))
    pts = [(x0, P.C[1]), (x0, yf), (x1, yf)]
    ycirc = cy + PORCH_R * math.sin(a0)
    if abs(ycirc - yf) > 0.02:
        pts.append((x1, ycirc))
    pts += geo.arc(cx, cy, PORCH_R, a0, a1, step=math.radians(6))[1:]
    # the east run: straight along the wing's front, a square corner at the wing's east side
    pts += [(P.E[2], -0.4), (P.E[2], P.E[1])]
    return geo.dedupe(pts, closed=False)


def main_region_polys():
    """The deck plan: exactly the edge path, closed back through the house (the house is subtracted)."""
    e = main_edge()
    return [e + [(P.E[2], 3.0), (P.C[2], 3.0)]]


WEST_X0 = -13.6


def west_edge():
    """CCW (outward on the right): from B's front-left corner out to the west, round the front to C."""
    return [(P.B[0], P.B[1]), (WEST_X0, P.B[1]), (WEST_X0, -1.6), (P.C[0], -1.6)]


def west_region_polys():
    e = west_edge()
    return [e + [(P.C[0], P.B[1] + 1.0), (P.B[0], P.B[1] + 1.0)]]


# ---------------------------------------------------------------- path helpers

class Path2:
    def __init__(self, pts):
        self.p = np.array(pts, float)
        seg = np.linalg.norm(np.diff(self.p, axis=0), axis=1)
        self.s = np.concatenate([[0], np.cumsum(seg)])
        self.L = float(self.s[-1])

    def at(self, s):
        s = min(max(s, 0.0), self.L)
        i = min(len(self.s) - 2, int(np.searchsorted(self.s, s, side="right") - 1))
        i = max(i, 0)
        t = (s - self.s[i]) / max(1e-9, self.s[i + 1] - self.s[i])
        p = self.p[i] + (self.p[i + 1] - self.p[i]) * t
        d = self.p[i + 1] - self.p[i]
        d = d / np.linalg.norm(d)
        return p, d

    def sub(self, s0, s1, step=None):
        pts = [self.at(s0)[0]]
        for k, sk in enumerate(self.s):
            if s0 < sk < s1:
                pts.append(self.p[k])
        pts.append(self.at(s1)[0])
        return geo.dedupe([tuple(q) for q in pts], closed=False)

    def corners(self, deg=25):
        out = [0.0]
        for k in range(1, len(self.p) - 1):
            d0 = self.p[k] - self.p[k - 1]
            d1 = self.p[k + 1] - self.p[k]
            c = float(d0 @ d1 / np.linalg.norm(d0) / np.linalg.norm(d1))
            if math.degrees(math.acos(max(-1, min(1, c)))) > deg:
                out.append(float(self.s[k]))
        out.append(self.L)
        return out


def stations(path, max_span=2.4, gaps=()):
    """Column stations: every corner, plus evenly spaced ones on long runs. Spans that contain an
    opening (steps) are not subdivided, so no column ever stands in an opening."""
    cs = path.corners()
    out = []
    for i in range(len(cs) - 1):
        a, b = cs[i], cs[i + 1]
        has_gap = any(g0 < b and g1 > a for g0, g1 in gaps)
        n = 1 if has_gap else max(1, math.ceil((b - a) / max_span))
        for k in range(n):
            out.append(a + (b - a) * k / n)
    out.append(cs[-1])
    out = sorted(out)
    ded = []
    for s in out:
        if not ded or s - ded[-1] > 0.35:
            ded.append(s)
    corner_set = cs
    return [s for s in ded if any(abs(s - c) < 1e-6 for c in corner_set) or not any(g0 - 0.2 < s < g1 + 0.2 for g0, g1 in gaps)]


# ---------------------------------------------------------------- components

def column_geo(h, r=0.1):
    """Turned porch column with plinth, Attic base, entasis shaft and a moulded capital."""
    g = core.Geo()
    g.add(box(-0.14, 0.14, -0.14, 0.14, 0.0, 0.1))
    prof = [(0.0, 0.1), (0.13, 0.1), (0.13, 0.13), (0.118, 0.145), (0.125, 0.165), (0.112, 0.18), (r + 0.012, 0.19),
            (r + 0.012, 0.205), (r, 0.215)]
    top = h - 0.3
    n = 10
    for k in range(1, n + 1):
        z = 0.215 + (top - 0.215) * k / n
        rr = r * (1 - 0.16 * max(0.0, (k / n - 0.33) / 0.67) ** 1.5)
        prof.append((rr, z))
    rt = prof[-1][0]
    prof += [(rt + 0.012, top + 0.01), (rt + 0.012, top + 0.03), (rt, top + 0.04), (rt + 0.01, top + 0.08),
             (rt + 0.04, top + 0.14), (rt + 0.06, top + 0.18), (rt + 0.06, top + 0.2), (0.0, top + 0.2)]
    g.add(geo.lathe(prof, seg=24))
    # abacus
    g.add(box(-0.15, 0.15, -0.15, 0.15, top + 0.2, h))
    return g


def baluster_geo(h, r=0.028):
    prof = [(0.0, 0.0), (r * 1.15, 0.0), (r * 1.15, 0.06), (r * 0.8, 0.075), (r * 0.9, 0.09), (r * 1.6, 0.2),
            (r * 1.7, 0.27), (r * 1.2, 0.36), (r * 0.7, 0.45), (r * 0.65, h - 0.16), (r * 0.9, h - 0.13),
            (r * 0.8, h - 0.11), (r * 1.15, h - 0.08), (r * 1.15, h), (0.0, h)]
    return geo.lathe(prof, seg=12)


def spindle_geo(h, r=0.017):
    prof = [(0.0, 0.0), (r, 0.0), (r, 0.025), (r * 0.6, 0.04), (r * 1.1, 0.06), (r * 0.6, h * 0.3), (r * 1.2, h * 0.5),
            (r * 0.6, h * 0.7), (r * 1.1, h - 0.06), (r * 0.6, h - 0.04), (r, h - 0.025), (r, h), (0.0, h)]
    return geo.lathe(prof, seg=10)


HANDRAIL = [(-0.045, 0.0), (0.045, 0.0), (0.045, 0.02), (0.055, 0.035), (0.05, 0.06), (0.03, 0.075),
            (-0.03, 0.075), (-0.05, 0.06), (-0.055, 0.035), (-0.045, 0.02)]
BOTRAIL = [(-0.04, 0.0), (0.04, 0.0), (0.04, 0.05), (0.025, 0.065), (-0.025, 0.065), (-0.04, 0.05)]


def rail_run(pts, z_bot, height, bal_src, spacing=0.115):
    """Handrail, bottom rail and balusters along a polyline (z from deck)."""
    g = core.Geo()
    p3 = [(x, y, 0) for x, y in pts]
    if geo.path_len(pts) < 0.12:
        return g
    hr = [(o, h + z_bot + height - 0.075) for o, h in HANDRAIL]
    g.add(geo.sweep(geo.ccw(hr), p3, up=(0, 0, 1)))
    br = [(o, h + z_bot + 0.05) for o, h in BOTRAIL]
    g.add(geo.sweep(geo.ccw(br), p3, up=(0, 0, 1)))
    path = Path2(pts)
    n = max(1, int(path.L / spacing))
    for k in range(n):
        s = (k + 0.5) * path.L / n
        p, d = path.at(s)
        g.add(bal_src.move(p[0], p[1], z_bot + 0.115))
    return g


def spindle_frieze(pts, z_top, src, spacing=0.085, drop=0.26):
    g = core.Geo()
    p3 = [(x, y, 0) for x, y in pts]
    if geo.path_len(pts) < 0.3:
        return g
    rail = [(-0.03, z_top - drop - 0.045), (0.03, z_top - drop - 0.045), (0.03, z_top - drop), (-0.03, z_top - drop)]
    g.add(geo.sweep(geo.ccw(rail), p3, up=(0, 0, 1)))
    path = Path2(pts)
    n = max(1, int(path.L / spacing))
    for k in range(n):
        p, d = path.at((k + 0.5) * path.L / n)
        g.add(src.move(p[0], p[1], z_top - drop))
    # drops (small turned pendants) under the rail every 0.6 m
    pend = geo.lathe([(0.0, 0.0), (0.02, 0.0), (0.025, 0.03), (0.012, 0.06), (0.016, 0.08), (0.0, 0.1)], seg=10)
    pend = pend.xf(Matrix.Diagonal((1.0, 1.0, -1.0, 1.0)))
    m = max(1, int(path.L / 0.6))
    for k in range(m):
        p, d = path.at((k + 0.5) * path.L / m)
        g.add(pend.move(p[0], p[1], z_top - drop - 0.045))
    return g


def corner_bracket(h=0.42, d=0.42, t=0.04):
    """Sawn porch bracket (quarter-circle with a pierced eye), in local (x along beam, z down from top)."""
    pts = [(0.0, 0.0), (d, 0.0)]
    for k in range(1, 13):
        a = (math.pi / 2) * k / 12
        pts.append((d - d * math.sin(a) + 0.0, -h + h * math.cos(a) * 0.0 - (h * (1 - math.cos(a)) * 0.0) - h * math.sin(a) * 0 + (-h * (1 - math.cos(a)))))
    pts = [(0.0, 0.0), (d, 0.0)]
    for k in range(1, 13):
        a = (math.pi / 2) * k / 12
        pts.append((d * math.cos(a) ** 1.0 * (1 - 0.0) - 0.0 + 0.0, -h * math.sin(a)))
    pts = [(x * (1 - 0.82 * (1 - x / d) if False else 1), z) for x, z in pts]
    pts.append((0.0, -h))
    poly = geo.dedupe(pts)
    # concave sweep: replace the convex quarter by a concave one (bracket curve hugs the corner)
    poly = [(0.0, 0.0), (d, 0.0)] + [(d * (1 - math.sin((math.pi / 2) * k / 12)), -h * (1 - math.cos((math.pi / 2) * k / 12))) for k in range(1, 13)]
    poly = geo.dedupe(poly)
    g = geo.extrude_profile_y(geo.ccw(poly), -t / 2, t / 2)
    return g


def lattice_panel(L, h, slat=0.035, gap=0.075, t=0.012):
    """Diagonal lattice (two crossing layers) clipped to L x h, in local x (0..L), z (0..h)."""
    g = core.Geo()
    step = slat + gap
    for layer, sgn in ((0, 1), (1, -1)):
        y0 = layer * t
        k0 = int(-(h) / step) - 2
        k1 = int((L) / step) + 2
        for k in range(k0, k1):
            # slat centre line: x = c + sgn * z
            c = k * step
            # clip the slat's band to the rectangle using its four corners
            pts = []
            for zz in (0.0, h):
                xa = c + sgn * zz - slat * 0.707
                xb = c + sgn * zz + slat * 0.707
                pts.append((xa, zz))
                pts.append((xb, zz))
            poly = [pts[0], pts[1], pts[3], pts[2]]
            # clip polygon to [0,L]x[0,h]
            poly = _clip_rect(poly, 0.0, L, 0.0, h)
            if len(poly) >= 3 and abs(geo.area(poly)) > 1e-5:
                g.add(geo.extrude_profile_y(geo.ccw(poly), y0, y0 + t))
    return g


def _clip_rect(poly, x0, x1, z0, z1):
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(inter(a, b))
                out.append(b)
            elif ia:
                out.append(inter(a, b))
        return out

    def ix(xv):
        return lambda a, b: (xv, a[1] + (b[1] - a[1]) * (xv - a[0]) / (b[0] - a[0]))

    def iz(zv):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (zv - a[1]) / (b[1] - a[1]), zv)
    p = poly
    p = clip(p, lambda q: q[0] >= x0, ix(x0))
    if p:
        p = clip(p, lambda q: q[0] <= x1, ix(x1))
    if p:
        p = clip(p, lambda q: q[1] >= z0, iz(z0))
    if p:
        p = clip(p, lambda q: q[1] <= z1, iz(z1))
    return geo.dedupe(p) if p else []


def place_local(g, p, d, z=0.0):
    n = np.array([d[1], -d[0]])
    M = Matrix(((d[0], n[0], 0, p[0]), (d[1], n[1], 0, p[1]), (0, 0, 1, z), (0, 0, 0, 1)))
    return g.xf(M)


# ---------------------------------------------------------------- porch assembly

def house_cutter():
    return core.geo_obj(geo.prism(geo.offset(geo.ccw(P.outline01()), 0.0), -1.0, 20.0), "_house")


def _at_wall(p):
    """True if a deck edge end touches the house outline (it would otherwise run into the plinth)."""
    from .shell import _pip
    q = np.array(p)
    for dx, dy in ((0.1, 0), (-0.1, 0), (0, 0.1), (0, -0.1)):
        if _pip((q[0] + dx, q[1] + dy), P.outline01()):
            return True
    return False


def deck(name, region_polys, col, edge_pts):
    parts = [core.geo_obj(geo.prism(geo.ccw(p), DECK - 0.3, DECK), "_dk") for p in region_polys]
    o = parts[0]
    core.boolean(o, parts[1:], op="UNION")
    hc = core.geo_obj(geo.prism(geo.offset(geo.ccw(P.outline01()), 0.065), -1.0, 20.0), "_house")
    core.boolean(o, [hc], op="DIFFERENCE")
    o.name = f"{name}_Deck"
    for c in list(o.users_collection):
        c.objects.unlink(o)
    core.coll(col).objects.link(o)
    from . import mat as M
    core.set_mats(o, "porch_floor")
    core.smooth_by_angle(o, 30)
    # nosing round the deck edge and a fascia below it
    nose = [(0.0, -0.03), (0.02, -0.03), (0.035, -0.02), (0.04, 0.0), (0.035, 0.018), (0.02, 0.028), (0.0, 0.028)]
    from .siding import trim_poly
    ep = edge_pts
    if math.dist(ep[0], ep[1]) > 0.2:
        ep = trim_poly(ep, 0.07 if _at_wall(ep[0]) else 0.0, 0.07 if _at_wall(ep[-1]) else 0.0)
    edge_pts = ep
    p3 = [(x, y, DECK - 0.028) for x, y in edge_pts]
    core.obj(f"{name}_Nosing", geo.sweep(geo.ccw(nose), p3, up=(0, 0, 1)), col, "porch_floor", smooth=40)
    fas = [(0.0, -0.32), (0.018, -0.32), (0.018, -0.059), (0.0, -0.059)]
    core.obj(f"{name}_Fascia", geo.sweep(geo.ccw(fas), [(x, y, DECK) for x, y in edge_pts], up=(0, 0, 1)), col, "trim_paint", smooth=40)
    return o


def skirt(name, edge_pts, col, gaps=()):
    """Lattice skirt between grade and the fascia, framed by a top and bottom board."""
    from .siding import trim_poly
    path = Path2(trim_poly(geo.offset(edge_pts, -0.03, closed=False), 0.12, 0.12))
    g = core.Geo()
    frame = core.Geo()
    z0, z1 = 0.08, DECK - 0.33
    # sample the path finely to find the stretches inside gap rectangles, then panel the rest
    ss = np.linspace(0.0, path.L, int(path.L / 0.02) + 2)
    inside = [any(a <= path.at(s_)[0][0] <= b and c <= path.at(s_)[0][1] <= e for a, b, c, e in gaps) for s_ in ss]
    runs_, cur = [], None
    for s_, ins in zip(ss, inside):
        if not ins and cur is None:
            cur = [s_, s_]
        elif not ins:
            cur[1] = s_
        elif cur is not None:
            runs_.append(cur)
            cur = None
    if cur is not None:
        runs_.append(cur)
    segs = []
    for r0, r1 in runs_:
        m = max(1, round((r1 - r0) / 1.2))
        segs += [(r0 + (r1 - r0) * k / m, r0 + (r1 - r0) * (k + 1) / m) for k in range(m)]
    for s0, s1 in segs:
        if s1 - s0 < 0.15:
            continue
        p0, _ = path.at(s0)
        p1, _ = path.at(s1)
        L = float(np.linalg.norm(p1 - p0))
        dd = (p1 - p0) / L
        lp = lattice_panel(L - 0.08, z1 - z0 - 0.08)
        g.add(place_local(lp.move(0.04, -0.03, z0 + 0.04), p0, dd))
        # frame: posts between panels and boards
        frame.add(place_local(box(-0.04, 0.04, -0.05, 0.0, 0.0, z1), p0, dd))
        frame.add(place_local(box(0.0, L, -0.05, 0.0, 0.0, z0 + 0.04), p0, dd))
        frame.add(place_local(box(0.0, L, -0.05, 0.0, z1 - 0.04, z1), p0, dd))
    core.obj(f"{name}_Lattice", g, col, "trim_paint", smooth=None)
    core.obj(f"{name}_SkirtFrame", frame, col, "trim_paint", smooth=None, clean=True)


def columns_rails_frieze(name, edge_pts, col, gaps=(), pairs=(), wall_ends=True, beam_bot=None, ceil=None):
    """Columns at stations on the inset line, railings between, beam + spindle frieze above."""
    BEAM_BOT = beam_bot if beam_bot is not None else globals()["BEAM_BOT"]
    CEIL = ceil if ceil is not None else globals()["CEIL"]
    line = geo.offset(edge_pts, -INSET, closed=False)
    # the line's ends stop 0.2 short of the walls so no column or beam end touches the cladding
    from .siding import trim_poly
    line = trim_poly(line, 0.3, 0.3)
    gaps = [(g0 - 0.3, g1 - 0.3) for g0, g1 in gaps]
    path = Path2(line)
    sts = stations(path, gaps=gaps)
    hcol = BEAM_BOT - DECK
    csrc = column_geo(hcol)
    bsrc = baluster_geo(RAIL_H - 0.19)
    ssrc = spindle_geo(0.21)
    cg, rg, fg, bk = core.Geo(), core.Geo(), core.Geo(), core.Geo()
    bracket = corner_bracket()
    pos = []
    # pairs: (arc length of a station, offset of its twin column along the line)
    pairs = [(min(sts, key=lambda q: abs(q - ps)), off) for ps, off in pairs]
    for i, s in enumerate(sts):
        p, d = path.at(s)
        pos.append((s, p, d))
        cg.add(place_local(csrc, p, d, DECK))
        for (ps, off) in pairs:
            if abs(ps - s) < 1e-6:
                p2, d2 = path.at(s + off)
                cg.add(place_local(csrc, p2, d2, DECK))
    for i in range(len(sts) - 1):
        s0, s1 = sts[i] + 0.15, sts[i + 1] - 0.15
        for (ps, off) in pairs:
            if abs(ps - sts[i]) < 1e-6 and off > 0:
                s0 = sts[i] + off + 0.15
            if abs(ps - sts[i + 1]) < 1e-6 and off < 0:
                s1 = sts[i + 1] + off - 0.15
        segs = [(s0, s1)]
        for g0, g1 in gaps:
            nsegs = []
            for a, b in segs:
                if g1 <= a or g0 >= b:
                    nsegs.append((a, b))
                else:
                    if g0 > a:
                        nsegs.append((a, g0))
                    if g1 < b:
                        nsegs.append((g1, b))
            segs = nsegs
        for a, b in segs:
            if b - a > 0.2:
                rg.add(rail_run(path.sub(a, b), DECK, RAIL_H, bsrc))
        fs0, fs1 = sts[i] + 0.37, sts[i + 1] - 0.37
        for (ps, off) in pairs:
            if abs(ps - sts[i]) < 1e-6 and off > 0:
                fs0 = sts[i] + off + 0.37
            if abs(ps - sts[i + 1]) < 1e-6 and off < 0:
                fs1 = sts[i + 1] + off - 0.37
        if fs1 - fs0 > 0.4:
            fg.add(spindle_frieze(path.sub(fs0, fs1), BEAM_BOT, ssrc))
    # brackets each side of every column under the beam
    col_s = sorted([s for s, _, _ in pos] + [ps + off for (ps, off) in pairs])
    corners = path.corners()
    for s in col_s:
        for sgn in (-1, 1):
            s_b = s + sgn * 0.15
            s_far = s + sgn * (0.15 + 0.45)
            if s_far < 0.0 or s_far > path.L:
                continue
            # no bracket into a neighbouring column, across a corner, or into an opening
            if any(abs(o - s) > 1e-6 and min(s, s_far) - 0.1 < o < max(s, s_far) + 0.1 for o in col_s):
                continue
            if any(min(s, s_far) < c < max(s, s_far) for c in corners[1:-1]):
                continue
            if any(g0 < max(s, s_far) and g1 > min(s, s_far) for g0, g1 in gaps):
                continue
            ps, dd = path.at(s + sgn * 0.152)
            b = bracket if sgn > 0 else bracket.xf(Matrix.Scale(-1, 4, (1, 0, 0)))
            bk.add(place_local(b, ps, dd, BEAM_BOT))
    # beam (entablature) on the column line
    beam = [(-0.11, BEAM_BOT), (0.11, BEAM_BOT), (0.11, CEIL - 0.08), (0.13, CEIL - 0.06), (0.15, CEIL - 0.02),
            (0.15, CEIL), (-0.11, CEIL)]
    bl_ = trim_poly(geo.offset(edge_pts, -INSET, closed=False), 0.05, 0.05)
    beam_g = geo.sweep(geo.ccw(beam), [(x, y, 0) for x, y in bl_], up=(0, 0, 1))
    core.obj(f"{name}_Columns", cg, col, "trim_paint", smooth=35, clean=True)
    core.obj(f"{name}_Railings", rg, col, "trim_paint", smooth=35)
    core.obj(f"{name}_Frieze", fg, col, "trim_paint", smooth=35)
    core.obj(f"{name}_Brackets", bk, col, "trim_paint", smooth=None, clean=True)
    core.obj(f"{name}_Beam", beam_g, col, "trim_paint", smooth=40)
    return path, sts


def porch_roof(name, region_polys, col, solids, cut_extra=(), ceil=None):
    """Porch top: roof solids intersected with the grown plan region, minus the house.
    The body's underside is the ceiling (haint blue); its top is the tin roof; its sides the fascia."""
    ceil = CEIL if ceil is None else ceil
    reg = [core.geo_obj(geo.prism(geo.ccw(p), ceil - 0.001, 8.0), "_rg") for p in region_polys]
    r0 = reg[0]
    core.boolean(r0, reg[1:], op="UNION")
    body = solids[0]
    if len(solids) > 1:
        core.boolean(body, solids[1:], op="UNION")
    core.boolean(body, [r0], op="INTERSECT")
    # stop inside the cladding layer, never on the sheathing plane the cladding's back sits on
    hc = core.geo_obj(geo.prism(geo.offset(geo.ccw(P.outline01()), 0.012), -1.0, 20.0), "_house")
    core.boolean(body, [hc] + list(cut_extra), op="DIFFERENCE")
    body.name = f"{name}_Roof"
    for c in list(body.users_collection):
        c.objects.unlink(body)
    core.coll(col).objects.link(body)
    import bmesh
    from . import mat as M
    me = body.data
    core.set_mats(body, ["porch_ceiling", "roof_tin", "trim_paint"])
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        n = f.normal
        f.material_index = 0 if n.z < -0.9 else (1 if n.z > 0.3 else 2)
    bm.to_mesh(me)
    bm.free()
    core.smooth_by_angle(body, 25)
    return body


def hip_end(o, x_eave, z_eave, pitch):
    """Hip the east end of a shed solid: cut by a plane through its east eave rising westward."""
    import bmesh
    from mathutils import Vector
    bm = bmesh.new()
    bm.from_mesh(o.data)
    nrm = Vector((math.sin(pitch), 0.0, math.cos(pitch)))
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(x_eave, 0.0, z_eave),
                                 plane_no=nrm, clear_outer=True)
    cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    if cut:
        bmesh.ops.holes_fill(bm, edges=cut)
    bm.to_mesh(o.data)
    bm.free()


def grown(polys, d):
    return [geo.offset(geo.ccw(p), d) for p in polys]


def standing_seams(body, spacing=0.42, h=0.025, w=0.02):
    """Seam ribs on the tin roof: along the fall line of each top face, clipped to the face."""
    import bmesh
    from mathutils import Vector
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.transform(body.matrix_world)
    bm.normal_update()
    g = core.Geo()
    tops = [f for f in bm.faces if f.normal.z > 0.3]
    # merge coplanar / smooth groups is unnecessary: clip each face independently
    for f in tops:
        n = f.normal.copy()
        up = Vector((0, 0, 1))
        u = (up - n * up.dot(n)).normalized()
        a = u.cross(n).normalized()
        pts = [v.co.copy() for v in f.verts]
        A = [p.dot(a) for p in pts]
        U = [p.dot(u) for p in pts]
        poly = list(zip(A, U))
        if abs(geo.area(poly)) < 0.02:
            continue
        k0 = math.floor(min(A) / spacing)
        k1 = math.ceil(max(A) / spacing)
        c = pts[0]
        for k in range(k0, k1 + 1):
            ak = k * spacing
            # intersect the line a=ak with the polygon: collect u range
            us = []
            for i in range(len(poly)):
                (a0, u0), (a1, u1) = poly[i - 1], poly[i]
                if (a0 - ak) * (a1 - ak) < 0:
                    us.append(u0 + (u1 - u0) * (ak - a0) / (a1 - a0))
            if len(us) < 2:
                continue
            us.sort()
            for j in range(0, len(us) - 1, 2):
                ua, ub = us[j] + 0.01, us[j + 1] - 0.07
                if ub - ua < 0.1:
                    continue
                base = c + a * (ak - c.dot(a))
                p0 = base + u * (ua - base.dot(u))
                p1 = base + u * (ub - base.dot(u))
                # rib cross-section in (a, n)
                corners = []
                for da, dn in ((-w / 2, 0.0), (w / 2, 0.0), (w / 2, h), (-w / 2, h)):
                    corners.append((da, dn))
                V = []
                for p in (p0, p1):
                    for da, dn in corners:
                        V.append(tuple(p + a * da + n * dn))
                F = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [0, 3, 2, 1], [4, 5, 6, 7]]
                g.add(core.orient_convex(core.Geo(np.array(V), F, None)))
    bm.free()
    return g


def steps(name, col, x_c, y_top, width, n, direction=(0, -1), z_top=DECK, going=0.32, cheeks=True, start=0.042):
    """Stone steps from the deck edge down to grade: n risers, n-1 treads. They start just beyond
    the deck's nosing (the fascia is the top riser face). Cheek walls with pedestals at the foot."""
    riser = z_top / n
    d = np.array(direction, float)
    t = np.array([-d[1], d[0]])
    M = Matrix(((t[0], d[0], 0, x_c), (t[1], d[1], 0, y_top), (0, 0, 1, 0), (0, 0, 0, 1)))
    g = core.Geo()
    for k in range(1, n + 1):
        s0 = start + (k - 1) * going
        z_hi = z_top - (k - 1) * riser if k > 1 else z_top - 0.06
        z_lo = z_top - k * riser
        # riser face k, then the tread block below it (the tread top is z_lo, nosing overhang 0.025)
        if k < n:
            g.add(box(-width / 2, width / 2, s0 - 0.025, s0 + going, z_lo - 0.05, z_lo))
            g.add(box(-width / 2 + 0.005, width / 2 - 0.005, s0, s0 + going, 0.0, z_lo - 0.05))
        if k > 1 or True:
            g.add(box(-width / 2 + 0.005, width / 2 - 0.005, s0, s0 + 0.02, z_lo, z_hi if k > 1 else z_top - 0.06))
    core.obj(f"{name}_Steps", g.xf(M), col, "sandstone", smooth=None, clean=True)
    if cheeks:
        pg = core.Geo()
        L = start + (n - 1) * going
        for sx in (-1, 1):
            xo = sx * (width / 2 + 0.17)
            prof = [(start, z_top + 0.1), (L - 0.35, 0.35), (L, 0.35), (L, 0.0), (start, 0.0)]
            w2 = 0.15
            pg.add(geo.extrude_profile_x([(s_, z) for s_, z in prof], xo - w2, xo + w2))
            pg.add(pedestal(1.05).xf(Matrix.Translation((sx * (width / 2 + 0.265), L - 0.1, 0.0))))
        core.obj(f"{name}_Cheeks", pg.xf(M), col, "trim_paint", smooth=35, clean=True)


def pedestal(h):
    g = core.Geo()
    g.add(box(-0.24, 0.24, -0.24, 0.24, 0.0, 0.12))
    g.add(box(-0.2, 0.2, -0.2, 0.2, 0.12, h - 0.12))
    for s in range(4):
        pass
    g.add(_raised_panel(-0.15, 0.15, 0.25, h - 0.25, 0.2, 0.012).xf(Matrix.Identity(4)))
    g.add(_raised_panel(-0.15, 0.15, 0.25, h - 0.25, 0.2, 0.012).xf(Matrix.Rotation(math.pi, 4, "Z")))
    g.add(_raised_panel(-0.15, 0.15, 0.25, h - 0.25, 0.2, 0.012).xf(Matrix.Rotation(math.pi / 2, 4, "Z")))
    g.add(_raised_panel(-0.15, 0.15, 0.25, h - 0.25, 0.2, 0.012).xf(Matrix.Rotation(-math.pi / 2, 4, "Z")))
    cap = [(0.0, 0.0), (0.24, 0.0), (0.26, 0.03), (0.28, 0.06), (0.28, 0.12), (0.0, 0.12)]
    capg = geo.prism(geo.rect(-0.27, -0.27, 0.27, 0.27), h - 0.12, h)
    g.add(capg)
    return g


def urn(h=0.55):
    prof = [(0.0, 0.0), (0.12, 0.0), (0.12, 0.03), (0.07, 0.06), (0.05, 0.12), (0.09, 0.16), (0.17, 0.24),
            (0.2, 0.33), (0.21, 0.42), (0.23, 0.45), (0.23, 0.49), (0.19, 0.5), (0.19, 0.47), (0.0, 0.47)]
    return geo.lathe([(r * h / 0.5, z * h / 0.5) for r, z in prof], seg=28)


# ---------------------------------------------------------------- builders

def build_main():
    col = f"{COL}/Main"
    core.clear(col)
    edge = main_edge()
    region = main_region_polys()
    deck("Porch", region, col, edge)
    # steps in front of the portico
    yf = PORTICO[2]
    steps("Porch", col, 0.0, yf, STEP_W, STEPS)
    # columns, rails, frieze; leave the steps opening; pair the portico's front columns
    line = Path2(geo.offset(edge, -INSET, closed=False))
    # find the arc-length of the steps opening on the inset line
    gaps = []
    xs = [p[0] for p in line.p]
    s_left = s_right = None
    for k in range(len(line.p) - 1):
        a, b = line.p[k], line.p[k + 1]
        if abs(a[1] - b[1]) < 1e-6 and abs(a[1] - (yf + INSET)) < 1e-3:
            sa = line.s[k]
            s_left = sa + (-STEP_W / 2 - a[0])
            s_right = sa + (STEP_W / 2 - a[0])
    if s_left is not None:
        gaps.append((s_left, s_right))
    sts = stations(line, gaps=gaps)
    pair_idx = []
    for s_ in sts:
        p, _ = line.at(s_)
        if abs(p[1] - (yf + INSET)) < 1e-3 and abs(abs(p[0]) - (PORTICO[1] - INSET)) < 1e-3:
            # the twin column stands back along the portico's side (left) / round the arc (right)
            pair_idx.append((s_, -0.38 if p[0] < 0 else 0.38))
    columns_rails_frieze("Porch", edge, col, gaps=gaps, pairs=pair_idx)
    skirt("Porch", edge, col, gaps=[(-STEP_W / 2 - 0.33, STEP_W / 2 + 0.33, yf - 2.0, yf + 0.2)])
    # roofs: portico gable + conical wrap + shed over the east run
    cx, cy = P.TURRET
    x0, x1, _ = PORTICO
    # the portico: a shed like the rest, with a pedimented gable over its front part only
    gable = geo.extrude_profile_y(geo.ccw([(x0 - OVER, CEIL), (x1 + OVER, CEIL), (x1 + OVER, ROOF_EDGE),
                                           (0.0, PORTICO_RIDGE), (x0 - OVER, ROOF_EDGE)]), yf - OVER, PEDIMENT_BACK)
    psl = (ROOF_WALL - ROOF_EDGE) / (0.0 - (yf - OVER))
    pshed = geo.extrude_profile_x([(0.1, CEIL), (yf - OVER, CEIL), (yf - OVER, ROOF_EDGE), (0.1, ROOF_WALL + psl * 0.1)],
                                  x0 - OVER, x1 + OVER)
    r_edge = PORCH_R + OVER
    slope = (ROOF_WALL - ROOF_EDGE) / (r_edge - P.TR)
    z_in = ROOF_WALL + slope * (P.TR - 0.5)
    cone = geo.lathe([(0.5, CEIL), (r_edge + 0.5, CEIL), (r_edge + 0.5, ROOF_EDGE - slope * 0.5), (0.5, z_in)], seg=144, closed=True).move(cx, cy, 0)
    ys = P.E[1]
    shed_depth = ys - (-0.4 - OVER)
    sl2 = (ROOF_WALL - ROOF_EDGE) / shed_depth
    shed = geo.extrude_profile_x([(ys + 0.1, CEIL), (-0.4 - OVER - 0.3, CEIL), (-0.4 - OVER - 0.3, ROOF_EDGE - sl2 * 0.3),
                                  (ys + 0.1, ROOF_WALL + sl2 * 0.1)], P.M[2] - 1.0, P.E[2] + 1.0)
    shed_o = core.geo_obj(shed, "_ps")
    hip_end(shed_o, P.E[2] + OVER, ROOF_EDGE, math.atan(sl2))
    solids = [core.geo_obj(gable, "_pg"), core.geo_obj(pshed, "_pps"), core.geo_obj(cone, "_pc"), shed_o]
    body = porch_roof("Porch", grown(region, OVER + 0.01), col, solids)
    seams = standing_seams(body)
    core.obj("Porch_RoofSeams", seams, col, "roof_tin", smooth=None)
    # crown moulding / gutter along the roof edge
    eg = geo.offset(edge, OVER, closed=False)
    # gutters only along the curved and east runs (the portico carries its pediment cornice)
    eg = [p for p in eg if p[0] > PORTICO[1] + OVER + 0.05]
    # stop the end cap 3 mm short of the portico roof's side face rather than on it
    d0 = (eg[1][0] - eg[0][0], eg[1][1] - eg[0][1])
    l0 = (d0[0] ** 2 + d0[1] ** 2) ** 0.5
    eg[0] = (eg[0][0] + d0[0] / l0 * 0.003, eg[0][1] + d0[1] / l0 * 0.003)
    gut = [(0.0, -0.05), (0.06, -0.05), (0.09, -0.03), (0.1, 0.02), (0.11, 0.05), (0.09, 0.06), (0.07, 0.0),
           (0.012, 0.0), (0.012, 0.05), (0.0, 0.05)]
    eg = geo.offset(eg, 0.01, closed=False)      # back plate hung on the fascia face
    core.obj("Porch_Gutter", geo.sweep(geo.ccw(gut), [(x, y, ROOF_EDGE - 0.03) for x, y in eg], up=(0, 0, 1)),
             col, "trim_paint", smooth=40)
    # pediment: raking cornices and tympanum ornament on the portico front
    pediment(col, yf - OVER)
    pediment(col, PEDIMENT_BACK, back=True)
    # ceiling cornice where the ceiling meets the house wall is part of interior-like trim: skip
    core.finish_tmp()


PORTICO_RIDGE = ROOF_EDGE + (PORTICO[1] - PORTICO[0] + 2 * OVER) / 2 * math.tan(math.radians(34))


def pediment(col, yface, back=False):
    x0, x1, _ = PORTICO
    half = (x1 - x0) / 2 + OVER
    pitch = math.atan2(PORTICO_RIDGE - ROOF_EDGE, half)
    g = core.Geo()
    out = 1.0 if back else -1.0
    if back:
        prof = [(0.0, -0.08), (0.03, -0.08), (0.05, -0.05), (0.07, -0.01), (0.075, 0.0), (0.0, 0.0)]
        for side in (-1, 1):
            # the back rakes stand on the shed roof: only the part above it
            path = [(side * half, yface, ROOF_EDGE), (0.0, yface, PORTICO_RIDGE)]
            if side < 0:
                path = path[::-1]
            g.add(geo.sweep(geo.ccw(prof), path, right=(0, out, 0)))
        o = core.obj("Porch_PedimentBack", g, col, "trim_paint", smooth=35, clean=True)
        return
    # raking crown on both slopes
    prof = [(0.0, -0.1), (0.04, -0.1), (0.06, -0.07), (0.09, -0.02), (0.1, 0.0), (0.0, 0.0)]
    for side in (-1, 1):
        path = [(side * half, yface, ROOF_EDGE), (0.0, yface, PORTICO_RIDGE)]
        if side > 0:
            path = path[::-1]
        g.add(geo.sweep(geo.ccw([(o, h) for o, h in prof]), path, right=(0, -1, 0)))
    # horizontal cornice across the base
    base = [(0.0, 0.0), (0.08, 0.0), (0.1, 0.03), (0.1, 0.08), (0.0, 0.1)]
    g.add(geo.sweep(geo.ccw(base), [(-half, yface, CEIL + 0.08), (half, yface, CEIL + 0.08)], up=(0, 0, 1)))
    # tympanum relief: central cartouche with scrolls (raised discs and leaves)
    # half sunburst of tapered rays radiating from the cartouche, clipped by the pediment's rakes
    zb = CEIL + 0.2
    for k in range(13):
        ang = math.radians(8) + (math.pi - math.radians(16)) * k / 12
        r0, r1 = 0.2, 1.05
        ca, sa = math.cos(ang), math.sin(ang)
        w0, w1 = 0.012, 0.045
        tx, tz = -sa, ca
        pts = [(r0 * ca - tx * w0, zb + r0 * sa - tz * w0), (r1 * ca - tx * w1, zb + r1 * sa - tz * w1),
               (r1 * ca + tx * w1, zb + r1 * sa + tz * w1), (r0 * ca + tx * w0, zb + r0 * sa + tz * w0)]
        # keep the ray inside the tympanum
        lim = []
        for x, z in pts:
            zr = PORTICO_RIDGE - 0.16 - abs(x) * math.tan(pitch)
            lim.append((x, min(z, zr)))
        if abs(geo.area(lim)) > 1e-4:
            g.add(geo.extrude_profile_y(geo.ccw(lim), yface - 0.025, yface))
    hub = geo.lathe([(0.0, 0.0), (0.2, 0.0), (0.21, 0.02), (0.18, 0.045), (0.0, 0.05)], seg=32, a0=0.0, a1=math.pi)
    hub = hub.xf(Matrix.Rotation(math.pi / 2, 4, "X")).move(0, yface, zb)
    g.add(hub)
    core.obj("Porch_Pediment", g, col, "trim_paint", smooth=35, clean=True)


def build_west():
    col = f"{COL}/West"
    core.clear(col)
    edge = west_edge()
    region = west_region_polys()
    deck("WestPorch", region, col, edge)
    ys = -0.3
    steps("WestPorch", col, WEST_X0, ys, 1.6, STEPS, direction=(-1, 0))
    line = Path2(geo.offset(edge, -INSET, closed=False))
    gaps = []
    for k in range(len(line.p) - 1):
        a_, b_ = line.p[k], line.p[k + 1]
        if abs(a_[0] - b_[0]) < 1e-6 and abs(a_[0] - (WEST_X0 + INSET)) < 1e-3:
            sa = line.s[k]
            # this segment runs -y from y=B[1]-INSET
            g0 = sa + (a_[1] - (ys + 0.8))
            g1 = sa + (a_[1] - (ys - 0.8))
            gaps.append((min(g0, g1), max(g0, g1)))
    columns_rails_frieze("WestPorch", edge, col, gaps=gaps, beam_bot=BEAM_W, ceil=CEIL_W)
    skirt("WestPorch", edge, col, gaps=[(WEST_X0 - 2.0, WEST_X0 + 0.2, ys - 0.8 - 0.33, ys + 0.8 + 0.33)])
    # flat roof = the balcony floor above, with a bracketed cornice and a balustrade
    top = P.L1 - 0.02
    slab = [core.geo_obj(geo.prism(geo.ccw(p), CEIL_W, top), "_ws") for p in region]
    body = porch_roof("WestPorch", region, col, slab, ceil=CEIL_W)
    from . import cornice
    s_ = (top - CEIL_W) / 1.05
    from .siding import trim_poly
    cornice.cornice_run("WestPorch_Cornice", trim_poly(edge, 0.045, 0.045), CEIL_W, cornice.MAIN_PROF, scale=s_, spacing=0.6,
                        ext=(0.0, 0.0), col=col)
    bsrc = baluster_geo(RAIL_H - 0.19)
    # the balustrade starts clear of the B wall and stops clear of C's wall
    bl = trim_poly(geo.offset(edge, -0.14, closed=False), 0.18, 0.18)
    bg = rail_run(bl, top, RAIL_H + 0.1, bsrc)
    path = Path2(bl)
    for s2 in path.corners():
        p, d = path.at(s2)
        bg.add(pedestal(RAIL_H + 0.2).xf(Matrix.Translation((p[0], p[1], top)) @ Matrix.Diagonal((0.55, 0.55, 1.0, 1.0))))
    core.obj("WestPorch_Balustrade", bg, col, "trim_paint", smooth=35, clean=True)
    core.finish_tmp()


def build_rear():
    col = f"{COL}/Rear"
    core.clear(col)
    x = 1.1
    reg = [geo.rect(x - 1.1, P.M[3] - 0.02, x + 1.1, P.M[3] + 1.6)]
    edge = [(x - 1.1, P.M[3]), (x - 1.1, P.M[3] + 1.6), (x + 1.1, P.M[3] + 1.6), (x + 1.1, P.M[3])][::-1]
    deck("RearStoop", reg, col, edge)
    steps("RearStoop", col, x, P.M[3] + 1.6, 1.4, STEPS, direction=(0, 1))
    # hood over the door on two big brackets
    g = core.Geo()
    hz = P.G + 3.42
    g.add(box(x - 0.95, x + 0.95, P.M[3] + 0.024, P.M[3] + 0.95, hz, hz + 0.14))
    br = corner_bracket(h=0.6, d=0.6, t=0.07)
    for sx in (-0.8, 0.8):
        b = br.xf(Matrix.Rotation(math.pi / 2, 4, "Z"))
        g.add(b.move(x + sx, P.M[3] + 0.024, hz))
    core.obj("RearStoop_Hood", g, col, "trim_paint", smooth=None)
    roof = geo.extrude_profile_x([(P.M[3] + 0.024, hz + 0.14), (P.M[3] + 1.05, hz + 0.14), (P.M[3] + 1.05, hz + 0.2),
                                  (P.M[3] + 0.024, hz + 0.5)], x - 1.05, x + 1.05)
    core.obj("RearStoop_HoodRoof", roof, col, "roof_tin", smooth=None)
    # side rails
    bsrc = baluster_geo(RAIL_H - 0.19)
    rg = core.Geo()
    for sx in (-1, 1):
        pts = [(x + sx * 0.98, P.M[3] + 0.1), (x + sx * 0.98, P.M[3] + 1.5)]
        rg.add(rail_run(pts, DECK, RAIL_H, bsrc))
    core.obj("RearStoop_Rails", rg, col, "trim_paint", smooth=35)
    core.finish_tmp()


def build():
    build_main()
    build_west()
    build_rear()
