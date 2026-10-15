"""Furniture and furnishings library. Every generator returns a Kit: {material name: Geo} in a local
frame (x right, y back, z up, origin on the floor at the piece's centre front-to-back unless noted).

Upholstery is built from rounded boxes (exact Minkowski rounding of a box by a sphere) with crowned
tops and button tufting; turned parts are lathes; carcasses are boxes with bevels applied on
objectification. Nothing is a bare primitive.
"""
import math

import numpy as np
from mathutils import Matrix, Vector

from . import core, geo
from .windows import box, _raised_panel

TAU = math.tau


class Kit(dict):
    def put(self, mat, g):
        if g is None or not g.F:
            return self
        if mat not in self:
            self[mat] = core.Geo()
        self[mat].add(g)
        return self

    def merge(self, other, M=None):
        for k, g in other.items():
            self.put(k, g.xf(M) if M is not None else g)
        return self

    def xf(self, M):
        out = Kit()
        for k, g in self.items():
            out[k] = g.xf(M)
        return out


def T(x=0.0, y=0.0, z=0.0, rz=0.0, s=None):
    m = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, "Z")
    if s is not None:
        m = m @ (Matrix.Diagonal((*s, 1.0)) if isinstance(s, tuple) else Matrix.Scale(s, 4))
    return m


# ---------------------------------------------------------------- upholstery primitive

def rounded_box(sx, sy, sz, r, res=10, crown=0.0, tufts=None, tuft_depth=0.018, sag_front=0.0, bottom=True):
    """A box (sx, sy, sz) centred on x/y, base at z=0, every edge rounded by r (true sphere corner).
    crown: the top domes up by this much in its middle; tufts: list of (x, y) buttons on the top
    pulled in by tuft_depth with radial creases. Returns Geo with UVs (metres)."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    ix, iy, iz = max(hx - r, 1e-4), max(hy - r, 1e-4), max(hz - r, 1e-4)
    V, F, keys = [], [], {}

    def vid(p):
        k = (round(p[0], 6), round(p[1], 6), round(p[2], 6))
        if k not in keys:
            keys[k] = len(V)
            V.append(p)
        return keys[k]

    def ticks(h, inner, n):
        # dense near the rounded edges, sparser across the flat middle
        e = np.linspace(0, 1, 5)[1:]
        lo = list(-h + (h - inner) * (1 - np.cos(e * math.pi / 2)) * 0 + (-h + (h - inner) * e) - (-h))
        a = [-h] + [-h + (h - inner) * t for t in e]
        mid = list(np.linspace(-inner, inner, max(2, n))[1:-1])
        b = [h - (h - inner) * t for t in e[::-1]] + [h]
        return np.array(a + mid + b)

    xs, ys, zs = ticks(hx, ix, res), ticks(hy, iy, res), ticks(hz, iz, max(3, res // 2))
    faces = [
        ("x", 1, ys, zs), ("x", -1, ys, zs), ("y", 1, xs, zs), ("y", -1, xs, zs), ("z", 1, xs, ys), ("z", -1, xs, ys)
    ]
    for ax, sg, us, vs in faces:
        if ax == "z" and sg < 0 and not bottom:
            continue
        grid = []
        for u in us:
            row = []
            for v in vs:
                if ax == "x":
                    p = np.array([sg * hx, u, v])
                elif ax == "y":
                    p = np.array([u, sg * hy, v])
                else:
                    p = np.array([u, v, sg * hz])
                q = np.clip(p, [-ix, -iy, -iz], [ix, iy, iz])
                d = p - q
                dl = np.linalg.norm(d)
                pp = q + d / dl * r if dl > 1e-9 else p
                row.append(pp)
            grid.append(row)
        for i in range(len(us) - 1):
            for j in range(len(vs) - 1):
                a, b, c, d = grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]
                q = [vid(tuple(a)), vid(tuple(b)), vid(tuple(c)), vid(tuple(d))]
                F.append(q)
    V = np.array(V, float)
    # orient faces outward (convex shape: normal away from centre)
    Fo = []
    for f in F:
        p = V[f]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        if np.linalg.norm(n) < 1e-14:
            n = np.cross(p[2] - p[0], p[3] - p[0])
        Fo.append(f if n @ p.mean(0) > 0 else f[::-1])
    # crown and sag
    top = V[:, 2] > hz - r * 0.999
    fx = np.clip(1 - (V[:, 0] / hx) ** 2, 0, 1)
    fy = np.clip(1 - (V[:, 1] / hy) ** 2, 0, 1)
    if crown:
        V[:, 2] += crown * fx * fy * np.clip((V[:, 2] + hz) / sz, 0, 1)
    if sag_front:
        V[:, 2] -= sag_front * fx * np.clip((V[:, 1] + hy) / sy, 0, 1) * np.clip((V[:, 2] + hz) / sz, 0, 1)
    if tufts:
        for tx, ty in tufts:
            d2 = (V[:, 0] - tx) ** 2 + (V[:, 1] - ty) ** 2
            V[:, 2] -= tuft_depth * np.exp(-d2 / (2 * 0.03 ** 2)) * top
    V[:, 2] += hz
    # unique faces (degenerate quads at collapsed corners)
    Fu = []
    for f in Fo:
        u = []
        for k in f:
            if k not in u:
                u.append(k)
        if len(u) >= 3:
            Fu.append(u)
    return core.Geo(V, Fu, None)


def buttons(pts, z, r=0.012):
    g = core.Geo()
    b = geo.lathe([(0.0, 0.0), (r, 0.0), (r * 0.8, r * 0.5), (0.0, r * 0.7)], seg=10)
    for x, y in pts:
        g.add(b.move(x, y, z))
    return g


def tuft_grid(sx, sy, nx, ny, stagger=True):
    out = []
    for j in range(ny):
        for i in range(nx):
            off = (0.5 if (stagger and j % 2) else 0.0)
            x = -sx / 2 + (i + 0.5 + off) * sx / (nx + (0.5 if stagger else 0))
            y = -sy / 2 + (j + 0.5) * sy / ny
            out.append((x, y))
    return out


# ---------------------------------------------------------------- turned & cut parts

def turned_leg(h, r=0.03, style="vase"):
    if style == "taper":
        prof = [(0.0, 0.0), (r * 0.6, 0.0), (r * 0.65, 0.02), (r * 0.6, 0.03), (r, h * 0.85), (r * 1.15, h * 0.88), (r * 1.15, h),
                (0.0, h)]
    elif style == "bun":
        prof = [(0.0, 0.0), (r * 0.9, 0.0), (r * 1.3, h * 0.35), (r * 1.1, h * 0.75), (r * 0.8, h * 0.9), (r * 0.9, h), (0.0, h)]
    else:
        prof = [(0.0, 0.0), (r * 0.7, 0.0), (r * 0.75, 0.03), (r * 0.6, 0.06), (r * 0.9, h * 0.25), (r * 1.2, h * 0.38),
                (r * 0.8, h * 0.5), (r * 0.7, h * 0.7), (r * 1.0, h * 0.8), (r * 0.85, h * 0.84), (r * 1.1, h * 0.88),
                (r * 1.1, h), (0.0, h)]
    return geo.lathe(prof, seg=16)


def sabre_leg(h, d=0.12, w=0.04, t=0.04, back=True):
    """Curved (sabre) leg in the y-z plane, extruded across x."""
    pts_f, pts_b = [], []
    for k in range(13):
        s = k / 12
        y = (d if back else -d) * (s ** 2) * 0.9
        z = h * (1 - s)
        pts_f.append((y - w / 2 * (1 - 0.4 * s), z))
        pts_b.append((y + w / 2 * (1 - 0.4 * s), z))
    poly = pts_f + pts_b[::-1]
    return geo.extrude_profile_x(geo.dedupe(poly), -t / 2, t / 2)


def moulded_top(w, d, t, r_corner=0.04, edge="ogee"):
    """A table/cabinet top: rounded-corner plan with a moulded edge (sweep around the outline)."""
    plan = geo.fillet(geo.rect(-w / 2, -d / 2, w / 2, d / 2), r_corner, n=5) if r_corner else geo.rect(-w / 2, -d / 2, w / 2, d / 2)
    plan = geo.ccw(plan)
    # the swept edge reaches inward no further than the corner radius, or it folds over itself
    e = min(0.04, 0.75 * r_corner) if r_corner else 0.04
    if edge == "ogee":
        prof = [(-e, 0.0), (0.0, 0.0), (0.006, 0.004), (0.01, 0.012), (0.012, t * 0.55), (0.008, t * 0.75), (0.0, t), (-e, t)]
    else:
        prof = [(-e, 0.0), (0.0, 0.0), (0.006, t * 0.5), (0.0, t), (-e, t)]
    inner = geo.offset(plan, -e * 0.8)
    g = geo.sweep(geo.ccw(prof), [(x, y, 0) for x, y in plan], closed=True, up=(0, 0, 1))
    g.add(geo.prism(inner, 0.0, t))
    return g


# ---------------------------------------------------------------- seating

def dining_chair(arms=False, fabric="velvet_mustard", wood="walnut_satin"):
    """Upholstered dining chair (interior ref 1): walnut frame, sabre back legs, turned front legs,
    padded seat and back, optional arms (carver)."""
    k = Kit()
    sw, sd, sh = 0.5, 0.48, 0.46
    # front legs
    for x in (-sw / 2 + 0.03, sw / 2 - 0.03):
        k.put(wood, turned_leg(sh - 0.06, 0.022, "taper").move(x, -sd / 2 + 0.03, 0.0))
    # back legs rising into the back uprights (curved)
    bh = 0.98
    for x in (-sw / 2 + 0.03, sw / 2 - 0.03):
        pts_f, pts_b = [], []
        for kk in range(17):
            s = kk / 16
            z = bh * s
            y = sd / 2 - 0.03 + 0.07 * (1 - s) ** 2 * (1 if s < 0.4 else 0) + (0.06 * (s - 0.45) ** 2 if s > 0.45 else 0)
            w = 0.036 - 0.008 * s
            pts_f.append((y - w / 2, z))
            pts_b.append((y + w / 2, z))
        k.put(wood, geo.extrude_profile_x(pts_f + pts_b[::-1], x - 0.018, x + 0.018))
    # seat rails
    k.put(wood, box(-sw / 2 + 0.03, sw / 2 - 0.03, -sd / 2 + 0.01, -sd / 2 + 0.04, sh - 0.11, sh - 0.04))
    k.put(wood, box(-sw / 2 + 0.02, -sw / 2 + 0.045, -sd / 2 + 0.05, sd / 2 - 0.05, sh - 0.11, sh - 0.04))
    k.put(wood, box(sw / 2 - 0.045, sw / 2 - 0.02, -sd / 2 + 0.05, sd / 2 - 0.05, sh - 0.11, sh - 0.04))
    # seat cushion
    k.put(fabric, rounded_box(sw - 0.02, sd - 0.03, 0.09, 0.035, res=8, crown=0.02).move(0, -0.01, sh - 0.06))
    # back cushion between the uprights
    back = rounded_box(sw - 0.1, 0.07, 0.48, 0.03, res=8, crown=0.0)
    back = back.xf(Matrix.Rotation(math.radians(-90), 4, "X"))   # thickness along -y... rotate to stand
    back = rounded_box(sw - 0.09, 0.06, 0.46, 0.028, res=8).move(0, 0, 0)
    k.put(fabric, back.xf(T(0, sd / 2 - 0.04, sh + 0.06) @ Matrix.Rotation(math.radians(-8), 4, "X")))
    # top rail
    k.put(wood, box(-sw / 2 + 0.02, sw / 2 - 0.02, sd / 2 - 0.02, sd / 2 + 0.02, bh - 0.06, bh - 0.01))
    if arms:
        for sx in (-1, 1):
            x = sx * (sw / 2 - 0.01)
            arm = [(x, -sd / 2 + 0.03, sh + 0.2), (x, -sd / 2 + 0.1, sh + 0.23), (x, sd / 2 - 0.08, sh + 0.24), (x, sd / 2 - 0.03, sh + 0.26)]
            prof = [(-0.022, -0.012), (0.022, -0.012), (0.024, 0.006), (0.012, 0.016), (-0.012, 0.016), (-0.024, 0.006)]
            k.put(wood, geo.sweep(geo.ccw(prof), arm, up=(0, 0, 1)))
            k.put(wood, geo.tube([(x, -sd / 2 + 0.04, sh - 0.05), (x, -sd / 2 + 0.05, sh + 0.21)], 0.016, seg=10))
    return k


def armchair(fabric="velvet_rust", wood="walnut_satin"):
    """Mid-century-leaning Victorian club chair (interior ref 2): deep velvet seat and back on a
    walnut frame with open arms and tapered legs."""
    k = Kit()
    w, d = 0.78, 0.82
    sh = 0.42
    for x in (-w / 2 + 0.05, w / 2 - 0.05):
        for y in (-d / 2 + 0.06, d / 2 - 0.06):
            k.put(wood, turned_leg(0.16, 0.024, "taper").move(x, y, 0.0))
    k.put(fabric, rounded_box(w - 0.04, d - 0.04, 0.16, 0.05, res=10).move(0, 0, 0.15))
    k.put(fabric, rounded_box(w - 0.18, d - 0.22, 0.14, 0.06, res=10, crown=0.03, sag_front=0.01).move(0, -0.06, sh - 0.12))
    back = rounded_box(w - 0.14, 0.2, 0.5, 0.07, res=10, crown=0.02)
    k.put(fabric, back.xf(T(0, d / 2 - 0.12, sh - 0.02) @ Matrix.Rotation(math.radians(-12), 4, "X")))
    # side arms upholstered inner, walnut arm caps
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.06)
        k.put(fabric, rounded_box(0.1, d - 0.1, 0.32, 0.04, res=8).move(x, 0.0, 0.28))
        prof = [(-0.05, 0.0), (0.05, 0.0), (0.055, 0.015), (0.04, 0.03), (-0.04, 0.03), (-0.055, 0.015)]
        path = [(x, -d / 2 + 0.01, 0.6), (x, d / 2 - 0.05, 0.62)]
        k.put(wood, geo.sweep(geo.ccw(prof), path, up=(0, 0, 1)))
        k.put(wood, geo.lathe([(0.0, 0.0), (0.04, 0.0), (0.045, 0.02), (0.03, 0.035), (0.0, 0.04)], seg=14).move(x, -d / 2 + 0.01, 0.6))
    return k


def sofa(L=2.3, fabric="velvet_mustard", wood="walnut_satin", curve=0.0):
    """Three-seat channel-tufted sofa with rolled arms, loose seat cushions and scatter cushions."""
    k = Kit()
    d, sh = 0.9, 0.44
    for x in (-L / 2 + 0.08, 0.0, L / 2 - 0.08):
        for y in (-d / 2 + 0.08, d / 2 - 0.08):
            k.put(wood, turned_leg(0.14, 0.026, "bun").move(x, y, 0.0))
    k.put(fabric, rounded_box(L, d, 0.2, 0.06, res=14).move(0, 0, 0.13))
    # channel-tufted back: vertical channels as a series of rounded cushions
    n = 7
    bw = (L - 0.3) / n
    for i in range(n):
        x = -L / 2 + 0.15 + (i + 0.5) * bw
        ch = rounded_box(bw + 0.01, 0.2, 0.52, 0.07, res=8, crown=0.02)
        k.put(fabric, ch.xf(T(x, d / 2 - 0.12, sh - 0.02) @ Matrix.Rotation(math.radians(-10), 4, "X")))
    for i in range(3):
        x = -L / 2 + 0.15 + (i + 0.5) * (L - 0.3) / 3
        k.put(fabric, rounded_box((L - 0.3) / 3 - 0.01, d - 0.3, 0.13, 0.05, res=10, crown=0.025, sag_front=0.01).move(x, -0.08, sh - 0.12))
    # rolled arms
    for sx in (-1, 1):
        x = sx * (L / 2 - 0.08)
        k.put(fabric, rounded_box(0.16, d - 0.04, 0.28, 0.07, res=10, crown=0.02).move(x, 0.0, 0.3))
    # scatter cushions (pillow shapes) in varied fabrics
    # Each leans on what is behind it at the back's own rake (faces parallel, 5 mm apart) and sits on
    # the seat cushions' crown; front pillows lean on the end ones. Rotation about Y keeps those faces
    # parallel, so a cushion can be cocked without cutting into the back.
    rake = Matrix.Rotation(math.radians(-10), 4, "X")
    y_back = d / 2 - 0.12 - 0.0985 + 0.0035 - 0.005          # front face of the back channels at the base
    cush = [("velvet_rust", -L / 2 + 0.42, 0.44, 0, 0.12), ("fabric_floral", 0.0, 0.44, 0, -0.05),
            ("velvet_rust", L / 2 - 0.42, 0.44, 0, -0.12), ("velvet_teal", -L / 2 + 0.56, 0.36, 1, -0.2),
            ("velvet_teal", L / 2 - 0.56, 0.36, 1, 0.2)]
    for mat, x, s, layer, rot in cush:
        t = 0.13
        yc = y_back - t / 2 * math.cos(math.radians(10)) - layer * (t + 0.005)
        p = rounded_box(s, t, s, 0.06, res=10, crown=0.0)
        h = s / 2
        lift = h * (math.cos(rot) + abs(math.sin(rot)) - 1)      # cocked about its middle, low corner on the seat
        k.put(mat, p.xf(T(x, yc, sh + 0.035 + lift) @ rake @ T(0, 0, h) @ Matrix.Rotation(rot, 4, "Y") @ T(0, 0, -h)))
    return k


def ottoman(r=0.3, h=0.42, fabric="velvet_teal"):
    """Round tufted pouffe with a brass band and a bullion fringe skirt."""
    k = Kit()
    body = geo.lathe([(0.0, 0.05), (r - 0.02, 0.05), (r, 0.08), (r + 0.01, h - 0.12), (r - 0.02, h - 0.04), (r - 0.06, h),
                      (0.0, h + 0.02)], seg=48)
    k.put(fabric, body)
    k.put("brass", geo.lathe([(r + 0.008, 0.06), (r + 0.016, 0.06), (r + 0.016, 0.075), (r + 0.008, 0.075)], seg=48, closed=True))
    # fringe: fine vertical strands as a ring of thin blades
    fr = core.Geo()
    n = 160
    for i in range(n):
        a = TAU * i / n
        c, s = math.cos(a), math.sin(a)
        p0 = (c * (r + 0.012), s * (r + 0.012))
        blade = [(p0[0] - s * 0.005, p0[1] + c * 0.005), (p0[0] + s * 0.005, p0[1] - c * 0.005),
                 (p0[0] + s * 0.004 + c * 0.004, p0[1] - c * 0.004 + s * 0.004), (p0[0] - s * 0.004 + c * 0.004, p0[1] + c * 0.004 + s * 0.004)]
        fr.add(geo.prism(geo.ccw(blade), 0.005, 0.06))
    k.put(fabric, fr)
    k.put(fabric, buttons([(0.0, 0.0)], h + 0.015, 0.018))
    return k


# ---------------------------------------------------------------- tables & cabinets

def dining_table(L=2.6, W=1.1, H=0.76, wood="walnut"):
    """Twin-pedestal dining table with a rounded-rectangle top, apron and curved trestle feet."""
    k = Kit()
    k.put(wood, moulded_top(L, W, 0.04, r_corner=0.35).move(0, 0, H - 0.04))
    # apron
    ap = geo.fillet(geo.rect(-L / 2 + 0.14, -W / 2 + 0.14, L / 2 - 0.14, W / 2 - 0.14), 0.2, n=4)
    ring = geo.sweep(geo.ccw([(-0.025, 0.0), (0.0, 0.0), (0.0, 0.09), (-0.025, 0.09)]), [(x, y, H - 0.13) for x, y in geo.ccw(ap)],
                     closed=True, up=(0, 0, 1))
    k.put(wood, ring)
    for x in (-L / 2 + 0.55, L / 2 - 0.55):
        col = geo.lathe([(0.0, 0.12), (0.09, 0.12), (0.1, 0.16), (0.07, 0.22), (0.08, 0.35), (0.06, 0.5), (0.065, 0.6),
                         (0.08, H - 0.16), (0.1, H - 0.13), (0.0, H - 0.13)], seg=20)
        k.put(wood, col.move(x, 0, 0))
        # four curved feet
        for ang in (math.radians(45), math.radians(135), math.radians(225), math.radians(315)):
            pts_t, pts_b = [], []
            for kk in range(11):
                s = kk / 10
                rr = 0.06 + 0.32 * s
                z = 0.14 - 0.11 * math.sin(s * math.pi / 2) + 0.02 * s
                pts_t.append((rr, z + 0.03 * (1 - s) + 0.015))
                pts_b.append((rr, z - 0.03 * (1 - s) - 0.015 if s < 1 else 0.0))
            prof = pts_b + pts_t[::-1]
            foot = geo.extrude_profile_y(geo.ccw([(a, max(0.0, b)) for a, b in prof]), -0.025, 0.025)
            k.put(wood, foot.xf(T(x, 0, 0, rz=ang)))
    k.put(wood, box(-L / 2 + 0.55, L / 2 - 0.55, -0.03, 0.03, 0.3, 0.36))
    return k


def round_table(r=0.5, H=0.48, wood="walnut", legs=4):
    k = Kit()
    top = geo.lathe([(0.0, 0.0), (r - 0.01, 0.0), (r, 0.008), (r + 0.004, 0.02), (r, 0.032), (r - 0.012, 0.038), (0.0, 0.038)], seg=48)
    k.put(wood, top.move(0, 0, H - 0.038))
    k.put(wood, geo.lathe([(r * 0.8, -0.06), (r * 0.82, -0.06), (r * 0.82, 0.0), (r * 0.8, 0.0)], seg=48, closed=True).move(0, 0, H - 0.038))
    for i in range(legs):
        a = TAU * i / legs + TAU / 8
        c, s = math.cos(a), math.sin(a)
        leg = turned_leg(H - 0.1, 0.025, "taper").xf(Matrix.Rotation(0.06, 4, "Y"))
        k.put(wood, leg.xf(T(c * r * 0.72, s * r * 0.72, 0.0, rz=a)))
    # X stretcher
    for a in (TAU / 8, 3 * TAU / 8):
        c, s = math.cos(a), math.sin(a)
        k.put(wood, geo.tube([(-c * r * 0.66, -s * r * 0.66, 0.12), (c * r * 0.66, s * r * 0.66, 0.12)], 0.014, seg=8))
    return k


def side_table(r=0.24, H=0.62, brass=False):
    k = Kit()
    mat = "brass" if brass else "walnut"
    k.put(mat if brass else "walnut", geo.lathe([(0.0, 0.0), (r, 0.0), (r + 0.006, 0.012), (r, 0.022), (0.0, 0.022)], seg=40).move(0, 0, H - 0.022))
    if brass:
        k.put("brass", geo.lathe([(r - 0.004, 0.0), (r, 0.0), (r, 0.03), (r - 0.004, 0.03)], seg=40, closed=True).move(0, 0, H))
        for i in range(3):
            a = TAU * i / 3
            k.put("brass", geo.tube([(math.cos(a) * r * 0.9, math.sin(a) * r * 0.9, H - 0.02), (math.cos(a) * r * 0.75, math.sin(a) * r * 0.75, 0.0)], 0.009, seg=8))
        k.put("brass", geo.lathe([(r * 0.78, 0.18), (r * 0.8, 0.18), (r * 0.8, 0.19), (r * 0.78, 0.19)], seg=32, closed=True))
    else:
        k.put("walnut", geo.lathe([(0.0, 0.0), (0.16, 0.0), (0.17, 0.02), (0.05, 0.06), (0.035, 0.12), (0.05, 0.3), (0.03, 0.45),
                                   (0.04, H - 0.05), (0.06, H - 0.022), (0.0, H - 0.022)], seg=24))
    return k


def drawer_front(x0, x1, z0, z1, y, k, wood="walnut", pull="brass"):
    k.put(wood, box(x0 + 0.004, x1 - 0.004, y, y + 0.018, z0 + 0.004, z1 - 0.004))
    k.put(wood, _raised_panel(x0 + 0.03, x1 - 0.03, z0 + 0.025, z1 - 0.025, y + 0.018, 0.006))
    zc = (z0 + z1) / 2
    xc = (x0 + x1) / 2
    for xx in ((xc - 0.07, xc + 0.07) if x1 - x0 > 0.4 else (xc,)):
        k.put(pull, geo.lathe([(0.0, 0.0), (0.016, 0.0), (0.018, 0.006), (0.01, 0.012), (0.012, 0.022), (0.0, 0.026)], seg=12)
              .xf(T(xx, y + 0.018, zc) @ Matrix.Rotation(-math.pi / 2, 4, "X")))


def sideboard(L=1.9, D=0.55, H=0.92, wood="walnut"):
    """Walnut sideboard: plinth, three drawers over two panelled doors and an open centre, moulded
    top with a low back gallery."""
    k = Kit()
    y0 = -D / 2
    k.put(wood, box(-L / 2 + 0.02, L / 2 - 0.02, y0 + 0.02, D / 2, 0.0, 0.1))
    k.put(wood, box(-L / 2 + 0.03, L / 2 - 0.03, y0 + 0.03, D / 2, 0.1, H - 0.04))
    k.put(wood, moulded_top(L + 0.04, D + 0.03, 0.04, r_corner=0.0).move(0, 0.0, H - 0.04))
    k.put(wood, box(-L / 2 + 0.03, L / 2 - 0.03, D / 2 - 0.03, D / 2, H, H + 0.14))
    k.put(wood, _raised_panel(-L / 2 + 0.1, L / 2 - 0.1, H + 0.02, H + 0.12, D / 2 - 0.03, 0.006).xf(Matrix.Scale(-1, 4, (0, 1, 0))
                                                                                                     ) if False else None)
    nd = 3
    dw = (L - 0.06) / nd
    for i in range(nd):
        drawer_front(-L / 2 + 0.03 + i * dw, -L / 2 + 0.03 + (i + 1) * dw, H - 0.2, H - 0.05, y0 + 0.012, k, wood)
    for i, (xa, xb) in enumerate(((-L / 2 + 0.03, -L / 2 + 0.03 + dw), (L / 2 - 0.03 - dw, L / 2 - 0.03))):
        k.put(wood, box(xa + 0.004, xb - 0.004, y0 + 0.012, y0 + 0.03, 0.12, H - 0.21))
        k.put(wood, _raised_panel(xa + 0.05, xb - 0.05, 0.17, H - 0.26, y0 + 0.012, 0.012).xf(Matrix.Identity(4)))
        xk = xb - 0.06 if i == 0 else xa + 0.06
        k.put("brass", geo.lathe([(0.0, 0.0), (0.012, 0.0), (0.014, 0.008), (0.0, 0.02)], seg=10).xf(T(xk, y0 + 0.012, 0.55) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    # open centre with a shelf
    k.put(wood, box(-L / 2 + 0.03 + dw, L / 2 - 0.03 - dw, y0 + 0.03, D / 2 - 0.02, 0.45, 0.47))
    return k


def books_row(L, depth, rng, h_range=(0.18, 0.28), lean=True):
    """A row of books standing on a shelf, spines toward -y; returns Kit with several cloth colours."""
    k = Kit()
    mats = ["book_red", "book_green", "book_blue", "book_brown", "book_ochre", "book_black"]
    x = -L / 2
    while x < L / 2 - 0.02:
        t = rng.uniform(0.018, 0.05)
        if x + t > L / 2:
            break
        h = rng.uniform(*h_range)
        dd = min(depth - 0.02, rng.uniform(0.13, 0.22))
        bk = rounded_box(t, dd, h, 0.004, res=2)
        m = mats[int(rng.integers(len(mats)))]
        k.put(m, bk.move(x + t / 2, -depth / 2 + dd / 2 + 0.01, 0.0))
        # page block visible at the top edge is part of the box; add a gilt band on some spines
        if rng.random() < 0.4:
            k.put("gilt", box(x + 0.002, x + t - 0.002, -depth / 2 + 0.008, -depth / 2 + 0.0105, h * 0.8, h * 0.83))
        x += t + rng.uniform(0.0, 0.004)
        if rng.random() < 0.06:
            x += rng.uniform(0.05, 0.12)       # a gap where books have been taken out
    return k


def bookcase(W=1.0, H=2.3, D=0.36, shelves=6, rng=None, glazed=False, wood="walnut"):
    """Built-in style bookcase: carcass, cornice, plinth, adjustable shelves on pins, full of books."""
    rng = rng or np.random.default_rng(1)
    k = Kit()
    y0 = -D / 2
    k.put(wood, box(-W / 2, -W / 2 + 0.025, y0, D / 2, 0.0, H))
    k.put(wood, box(W / 2 - 0.025, W / 2, y0, D / 2, 0.0, H))
    k.put(wood, box(-W / 2 + 0.025, W / 2 - 0.025, D / 2 - 0.012, D / 2, 0.1, H - 0.06))
    k.put(wood, box(-W / 2, W / 2, y0, D / 2, 0.0, 0.1))
    corn = [(0.0, 0.0), (0.03, 0.0), (0.05, 0.03), (0.06, 0.06), (0.06, 0.08), (0.0, 0.08)]
    k.put(wood, geo.sweep(geo.ccw(corn), [(W / 2 + 0.0, y0 + 0.001, H - 0.08), (-W / 2 - 0.0, y0 + 0.001, H - 0.08)], up=(0, 0, 1)))
    k.put(wood, box(-W / 2, W / 2, y0, D / 2, H - 0.08, H - 0.06))
    sp = (H - 0.2) / shelves
    for i in range(shelves):
        z = 0.1 + i * sp
        k.put(wood, box(-W / 2 + 0.025, W / 2 - 0.025, y0 + 0.01, D / 2 - 0.012, z, z + 0.022))
        k.put(wood, box(-W / 2 + 0.025, W / 2 - 0.025, y0 + 0.005, y0 + 0.022, z - 0.03, z + 0.022))   # shelf lip
        bk = books_row(W - 0.07, D - 0.03, rng, h_range=(min(0.18, sp * 0.6), min(0.3, sp - 0.04)))
        k.merge(bk, T(0, 0.005, z + 0.022))
    return k


def table_lamp(h=0.62, base="ceramic_green", shade="lampshade"):
    """Baluster vase lamp with a pleated drum shade and a brass finial; light empty point at bulb."""
    k = Kit()
    prof = [(0.0, 0.0), (0.07, 0.0), (0.075, 0.02), (0.06, 0.03), (0.1, 0.12), (0.12, 0.2), (0.11, 0.27), (0.06, 0.33),
            (0.035, 0.36), (0.04, 0.38), (0.0, 0.38)]
    k.put(base, geo.lathe(prof, seg=32))
    k.put("brass", geo.lathe([(0.0, 0.0), (0.08, 0.0), (0.08, 0.012), (0.0, 0.012)], seg=24))
    k.put("brass", geo.tube([(0, 0, 0.38), (0, 0, h - 0.02)], 0.008, seg=8))
    # pleated shade: a frustum whose radius ripples with the pleats
    n = 72
    r0, r1, zs0, zs1 = 0.2, 0.13, h - 0.25, h
    V, F = [], []
    rows = 6
    for j in range(rows + 1):
        t = j / rows
        z = zs0 + (zs1 - zs0) * t
        rr = r0 + (r1 - r0) * t
        for i in range(n):
            a = TAU * i / n
            rp = rr + (0.006 if i % 2 else -0.004)
            V.append((rp * math.cos(a), rp * math.sin(a), z))
    for j in range(rows):
        for i in range(n):
            i1 = (i + 1) % n
            F.append([j * n + i, j * n + i1, (j + 1) * n + i1, (j + 1) * n + i])
    sh = core.Geo(np.array(V), F, None)
    k.put(shade, sh)
    k.put(shade, sh.xf(Matrix.Scale(0.985, 4)).move(0, 0, h * 0.015).flip())     # inside face
    k.put("brass", geo.lathe([(0.0, 0.0), (0.015, 0.0), (0.02, 0.02), (0.0, 0.045)], seg=12).move(0, 0, h))
    return k


def floor_lamp(h=1.6):
    k = table_lamp(h, base="brass")
    return k


def pendant_bowl(drop=1.1, r=0.32, ceil_rose=True):
    """Alabaster/amber glass bowl pendant on three brass chains (dining & parlour refs). Hangs from z=0
    downwards (place at the ceiling)."""
    k = Kit()
    outer = [(0.0, -0.18), (r * 0.35, -0.175), (r * 0.7, -0.14), (r * 0.92, -0.07), (r, 0.0), (r * 0.98, 0.015)]
    inner = [(r * 0.98 - 0.006, 0.012), (r - 0.006, 0.0), (r * 0.92 - 0.006, -0.067), (r * 0.7 - 0.005, -0.135),
             (r * 0.35, -0.17), (0.0, -0.174)]
    k.put("lamp_glass", geo.lathe(outer + inner, seg=48).move(0, 0, -drop))
    k.put("brass", geo.lathe([(r * 0.98, -0.005), (r + 0.012, -0.005), (r + 0.012, 0.03), (r * 0.98, 0.03)], seg=48, closed=True).move(0, 0, -drop))
    for i in range(3):
        a = TAU * i / 3
        p0 = (r * math.cos(a), r * math.sin(a), -drop + 0.03)
        p1 = (0.03 * math.cos(a), 0.03 * math.sin(a), -0.08)
        # chain as links
        n = 18
        for kk in range(n):
            t = (kk + 0.5) / n
            p = [p0[i2] + (p1[i2] - p0[i2]) * t for i2 in range(3)]
            link = geo.lathe([(0.008, -0.012), (0.011, 0.0), (0.008, 0.012), (0.005, 0.0)], seg=8, closed=True)
            link = link.xf(Matrix.Rotation(math.pi / 2 * (kk % 2), 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X"))
            k.put("brass", link.move(*p))
    k.put("brass", geo.lathe([(0.0, -0.1), (0.02, -0.08), (0.06, -0.04), (0.07, 0.0), (0.0, 0.0)], seg=24))
    k.put("brass", geo.lathe([(0.0, -0.26), (0.03, -0.2), (0.0, -0.18)], seg=12).move(0, 0, -drop))
    return k


# ---------------------------------------------------------------- bedroom

def bed(W=1.5, L=2.05, wood="walnut", quilt="quilt_rose", turn=True):
    """Victorian half-tester-free bed: panelled walnut head and footboards with turned posts,
    mattress, pillows, bolster, turned-down sheet and quilt hanging over the sides."""
    k = Kit()
    hb, fb = 1.45, 0.85
    for x in (-W / 2 - 0.03, W / 2 + 0.03):
        for y, h in ((L / 2 + 0.03, hb), (-L / 2 - 0.03, fb)):
            post = geo.lathe([(0.0, 0.0), (0.045, 0.0), (0.045, 0.2), (0.035, 0.24), (0.04, h * 0.6), (0.03, h - 0.12),
                              (0.045, h - 0.08), (0.04, h - 0.03), (0.02, h), (0.0, h + 0.02)], seg=16)
            k.put(wood, post.move(x, y, 0.0))
    for y, h, sg in ((L / 2 + 0.03, hb, 1), (-L / 2 - 0.03, fb, -1)):
        k.put(wood, box(-W / 2, W / 2, y - 0.02, y + 0.02, 0.3, h - 0.08))
        k.put(wood, _raised_panel(-W / 2 + 0.08, W / 2 - 0.08, 0.4, h - 0.18, 0.02, 0.012).xf(T(0, y, 0) @ (Matrix.Scale(-1, 4, (0, 1, 0)) if sg > 0 else Matrix.Identity(4))))
        k.put(wood, box(-W / 2 - 0.03, W / 2 + 0.03, y - 0.035, y + 0.035, h - 0.1, h - 0.04))
    for x in (-W / 2, W / 2):
        k.put(wood, box(x - 0.02 if x < 0 else x - 0.0, x + 0.0 if x < 0 else x + 0.02, -L / 2, L / 2, 0.25, 0.4))
    k.put("linen", rounded_box(W - 0.02, L - 0.02, 0.24, 0.06, res=10).move(0, 0, 0.38))
    # quilt draped: a thin rounded slab larger than the mattress, sides hanging
    q = rounded_box(W + 0.14, L - 0.35, 0.05, 0.03, res=12, crown=0.02)
    q.V[:, 2] -= 0.22 * np.clip((np.abs(q.V[:, 0]) - W / 2) / 0.07, 0, 1)
    k.put(quilt, q.move(0, -0.2, 0.6))
    if turn:
        k.put("linen", rounded_box(W + 0.02, 0.35, 0.03, 0.015, res=8).move(0, L / 2 - 0.68, 0.625))     # sheet turn-down
    for x in (-W / 4, W / 4):
        k.put("linen", rounded_box(W / 2 - 0.06, 0.42, 0.14, 0.06, res=10, crown=0.03).xf(T(x, L / 2 - 0.3, 0.6) @ Matrix.Rotation(-0.25, 4, "X")))
    k.put("linen", geo.lathe([(0.0, -W / 2 + 0.05), (0.09, -W / 2 + 0.06), (0.1, -W / 2 + 0.1), (0.1, W / 2 - 0.1), (0.09, W / 2 - 0.06),
                              (0.0, W / 2 - 0.05)], seg=20).xf(T(0, L / 2 - 0.1, 0.7) @ Matrix.Rotation(math.pi / 2, 4, "Y")))
    return k


def wardrobe(W=1.3, D=0.6, H=2.15, wood="walnut", mirror=True):
    k = Kit()
    y0 = -D / 2
    k.put(wood, box(-W / 2, W / 2, y0, D / 2, 0.0, 0.12))
    k.put(wood, box(-W / 2 + 0.02, W / 2 - 0.02, y0 + 0.02, D / 2, 0.12, H - 0.12))
    corn = [(0.0, 0.0), (0.04, 0.0), (0.06, 0.04), (0.08, 0.08), (0.08, 0.12), (0.0, 0.12)]
    k.put(wood, geo.sweep(geo.ccw(corn), [(W / 2 + 0.0, y0 + 0.02, H - 0.12), (-W / 2, y0 + 0.02, H - 0.12)], up=(0, 0, 1)))
    k.put(wood, box(-W / 2 + 0.02, W / 2 - 0.02, y0 + 0.02, D / 2, H - 0.12, H))
    for i, (xa, xb) in enumerate(((-W / 2 + 0.03, -0.004), (0.004, W / 2 - 0.03))):
        k.put(wood, box(xa, xb, y0 + 0.002, y0 + 0.022, 0.42, H - 0.15))
        if mirror and i == 0:
            k.put("mirror", box(xa + 0.08, xb - 0.08, y0 - 0.001, y0 + 0.002, 0.6, H - 0.35))
        else:
            k.put(wood, _raised_panel(xa + 0.08, xb - 0.08, 0.5, H - 0.25, y0 + 0.002, 0.012).xf(Matrix.Scale(-1, 4, (0, 1, 0))).move(0, 2 * y0 + 0.004, 0))
        k.put("brass", geo.lathe([(0.0, 0.0), (0.012, 0.0), (0.014, 0.008), (0.0, 0.02)], seg=10).xf(
            T((xb - 0.05) if i == 0 else (xa + 0.05), y0 + 0.002, 1.25) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    for z0, z1 in ((0.13, 0.27), (0.28, 0.41)):
        drawer_front(-W / 2 + 0.03, W / 2 - 0.03, z0, z1, y0 + 0.002, k, wood)
    return k


def chest_of_drawers(W=1.0, D=0.5, H=0.95, wood="walnut"):
    k = Kit()
    y0 = -D / 2
    k.put(wood, box(-W / 2, W / 2, y0, D / 2, 0.0, 0.08))
    k.put(wood, box(-W / 2 + 0.02, W / 2 - 0.02, y0 + 0.02, D / 2, 0.08, H - 0.03))
    k.put(wood, moulded_top(W + 0.04, D + 0.03, 0.03, r_corner=0.0).move(0, 0, H - 0.03))
    rows = [(0.1, 0.28), (0.29, 0.47), (0.48, 0.66), (0.67, H - 0.06)]
    for z0, z1 in rows:
        drawer_front(-W / 2 + 0.02, W / 2 - 0.02, z0, z1, y0 + 0.002, k, wood)
    return k


def dressing_mirror(w=0.5, h=0.65):
    """Swing toilet mirror on a small stand (sits on a chest)."""
    k = Kit()
    k.put("walnut", box(-w / 2 - 0.04, w / 2 + 0.04, -0.1, 0.1, 0.0, 0.05))
    for sx in (-1, 1):
        k.put("walnut", turned_leg(h * 0.7, 0.016, "vase").move(sx * (w / 2 + 0.02), 0.0, 0.05))
    oval = [(w / 2 * math.cos(a), h / 2 * math.sin(a)) for a in np.linspace(0, TAU, 48, endpoint=False)]
    fr = geo.sweep(geo.ccw([(0.0, -0.01), (0.03, -0.01), (0.03, 0.012), (0.0, 0.016)]), [(x, 0.0, z + h / 2 + 0.12) for x, z in oval],
                   closed=True, right=(0, -1, 0))
    k.put("walnut", fr)
    k.put("mirror", geo.extrude_profile_y(geo.ccw([(x * 0.95, z * 0.95 + h / 2 + 0.12) for x, z in oval]), -0.004, 0.004))
    return k


# ---------------------------------------------------------------- music / study / instruments

def upright_piano(wood="walnut"):
    """Upright piano: case with carved panels, fallboard open showing the keyboard, brass candle
    sconces, turned front legs, pedals."""
    k = Kit()
    W, D, H = 1.48, 0.6, 1.3
    y0 = -D / 2
    k.put(wood, box(-W / 2, W / 2, 0.0, D / 2, 0.0, 0.1))
    k.put(wood, box(-W / 2, W / 2, y0 + 0.28, D / 2, 0.1, H))
    k.put(wood, moulded_top(W + 0.03, 0.3, 0.03, r_corner=0.0).move(0, y0 + 0.28 + 0.15 - 0.02, H))
    for sx in (-1, 1):
        k.put(wood, box(sx * W / 2 - (0.05 if sx > 0 else 0.0), sx * W / 2 + (0.0 if sx > 0 else 0.05), y0, y0 + 0.28, 0.1, 0.78))
        k.put(wood, turned_leg(0.6, 0.035, "vase").move(sx * (W / 2 - 0.07), y0 + 0.04, 0.1))
    # key bed and keys
    kz = 0.72
    k.put(wood, box(-W / 2 + 0.05, W / 2 - 0.05, y0 + 0.02, y0 + 0.28, kz - 0.06, kz))
    nk = 52
    kw = (W - 0.16) / nk
    for i in range(nk):
        x = -W / 2 + 0.08 + i * kw
        k.put("ivory", box(x + 0.001, x + kw - 0.001, y0 + 0.02, y0 + 0.17, kz, kz + 0.022))
    pat = [1, 1, 0, 1, 1, 1, 0]
    for i in range(nk - 1):
        if pat[i % 7]:
            x = -W / 2 + 0.08 + (i + 1) * kw
            k.put("ebony", box(x - kw * 0.3, x + kw * 0.3, y0 + 0.08, y0 + 0.17, kz + 0.022, kz + 0.035))
    # front panels and music desk
    k.put(wood, box(-W / 2 + 0.05, W / 2 - 0.05, y0 + 0.26, y0 + 0.28, kz + 0.05, H - 0.05))
    for x0, x1 in ((-W / 2 + 0.1, -0.05), (0.05, W / 2 - 0.1)):
        k.put(wood, _raised_panel(x0, x1, kz + 0.25, H - 0.12, y0 + 0.26, 0.01).xf(Matrix.Scale(-1, 4, (0, 1, 0))).move(0, 2 * (y0 + 0.26), 0))
    k.put(wood, box(-0.45, 0.45, y0 + 0.2, y0 + 0.26, kz + 0.18, kz + 0.2))
    # sconces
    for sx in (-1, 1):
        x = sx * (W / 2 - 0.2)
        k.put("brass", geo.tube([(x, y0 + 0.26, kz + 0.5), (x, y0 + 0.12, kz + 0.45), (x, y0 + 0.08, kz + 0.5)], 0.008, seg=8))
        k.put("brass", geo.lathe([(0.0, 0.0), (0.04, 0.0), (0.04, 0.008), (0.014, 0.02), (0.012, 0.04), (0.0, 0.04)], seg=12).move(x, y0 + 0.08, kz + 0.5))
        k.put("wax", geo.lathe([(0.0, 0.0), (0.011, 0.0), (0.011, 0.14), (0.004, 0.15), (0.0, 0.15)], seg=10).move(x, y0 + 0.08, kz + 0.54))
    for x in (-0.05, 0.05):
        k.put("brass", box(x - 0.02, x + 0.02, y0 + 0.2, y0 + 0.32, 0.05, 0.08))
    return k


def piano_stool():
    k = Kit()
    for i in range(4):
        a = TAU * i / 4 + TAU / 8
        k.put("walnut", turned_leg(0.42, 0.022, "vase").move(0.15 * math.cos(a), 0.15 * math.sin(a), 0.0))
    k.put("walnut", box(-0.25, 0.25, -0.18, 0.18, 0.42, 0.46))
    k.put("velvet_rust", rounded_box(0.5, 0.36, 0.06, 0.025, res=8, crown=0.015).move(0, 0, 0.46))
    return k


def desk(W=1.5, D=0.8, H=0.76, wood="walnut"):
    """Partners' pedestal desk with a tooled leather top and drawers."""
    k = Kit()
    y0 = -D / 2
    for sx in (-1, 1):
        xa, xb = (-W / 2, -W / 2 + 0.45) if sx < 0 else (W / 2 - 0.45, W / 2)
        k.put(wood, box(xa, xb, y0, D / 2, 0.0, 0.08))
        k.put(wood, box(xa + 0.01, xb - 0.01, y0 + 0.01, D / 2 - 0.01, 0.08, H - 0.04))
        for z0, z1 in ((0.1, 0.32), (0.33, 0.5), (0.51, H - 0.07)):
            drawer_front(xa + 0.01, xb - 0.01, z0, z1, y0 - 0.008, k, wood)
    k.put(wood, box(-W / 2 + 0.45, W / 2 - 0.45, y0 + 0.01, D / 2 - 0.01, H - 0.14, H - 0.04))
    drawer_front(-W / 2 + 0.46, W / 2 - 0.46, H - 0.14, H - 0.05, y0 - 0.008, k, wood)
    k.put(wood, moulded_top(W + 0.04, D + 0.04, 0.035, r_corner=0.02).move(0, 0, H - 0.04))
    k.put("leather_green", box(-W / 2 + 0.07, W / 2 - 0.07, y0 + 0.07, D / 2 - 0.07, H - 0.005, H - 0.0045 + 0.0011))
    return k


def desk_chair():
    """Captain's swivel chair: turned spindle back, saddle seat, four splayed legs on a swivel."""
    k = Kit()
    k.put("walnut_satin", rounded_box(0.5, 0.46, 0.05, 0.02, res=8, crown=-0.01).move(0, 0, 0.45))
    k.put("walnut_satin", geo.lathe([(0.0, 0.3), (0.05, 0.3), (0.06, 0.36), (0.04, 0.45), (0.0, 0.45)], seg=16))
    for i in range(4):
        a = TAU * i / 4 + TAU / 8
        k.put("walnut_satin", geo.tube([(0.0, 0.0, 0.32), (0.32 * math.cos(a), 0.32 * math.sin(a), 0.02)], 0.022, seg=10))
        k.put("brass", geo.lathe([(0.0, 0.0), (0.025, 0.0), (0.025, 0.03), (0.0, 0.03)], seg=10).move(0.32 * math.cos(a), 0.32 * math.sin(a), 0.0))
    # curved crest rail and arms on spindles
    arc = [(0.26 * math.cos(a), 0.08 + 0.2 * math.sin(a), 0.72) for a in np.linspace(math.radians(-10), math.radians(190), 24)]
    prof = [(-0.03, -0.02), (0.03, -0.02), (0.035, 0.0), (0.03, 0.02), (-0.03, 0.02), (-0.035, 0.0)]
    k.put("walnut_satin", geo.sweep(geo.ccw(prof), arc, up=(0, 0, 1)))
    for a in np.linspace(math.radians(5), math.radians(175), 8):
        x, y = 0.25 * math.cos(a), 0.08 + 0.19 * math.sin(a)
        k.put("walnut_satin", geo.lathe([(0.0, 0.0), (0.011, 0.0), (0.013, 0.12), (0.009, 0.24), (0.0, 0.25)], seg=8).move(x, y, 0.48))
    k.put("leather_brown", rounded_box(0.44, 0.4, 0.04, 0.018, res=8, crown=0.012).move(0, -0.01, 0.5))
    return k


def globe(h=1.0):
    """Library globe on a turned stand with a brass meridian ring (tilted 23.4 degrees)."""
    k = Kit()
    r = 0.22
    for i in range(3):
        a = TAU * i / 3
        k.put("walnut", sabre_leg(0.5, 0.18, 0.05, 0.04, True).xf(T(0.0, 0.0, 0.0, rz=a)))
    zc = h - 0.27                       # globe centre, horizon ring level
    # the column stops below the sphere; curved struts carry the horizon ring round it, and a brass
    # pillar carries the meridian ring at its lowest point (nothing pierces the globe)
    k.put("walnut", geo.lathe([(0.0, 0.4), (0.06, 0.4), (0.04, 0.44), (0.055, 0.47), (0.03, 0.49), (0.0, 0.495)], seg=16))
    k.put("walnut", geo.lathe([(r + 0.04, 0.0), (r + 0.09, 0.0), (r + 0.09, 0.02), (r + 0.04, 0.02)], seg=48, closed=True).move(0, 0, zc))
    for i in range(3):
        a = TAU * i / 3 + TAU / 6
        c, s = math.cos(a), math.sin(a)
        pts = [(0.035, 0.47), (0.14, 0.46), (0.22, 0.52), (0.27, 0.62), (r + 0.06, zc + 0.004)]
        k.put("walnut", geo.tube([(q * c, q * s, z) for q, z in pts], 0.011, seg=8))
    sph = geo.lathe([(math.sin(t) * r, -math.cos(t) * r) for t in np.linspace(0, math.pi, 24)], seg=48, local_u=False)
    tilt = Matrix.Rotation(math.radians(23.4), 4, "X")
    k.put("globe", sph.xf(T(0, 0, zc) @ tilt))
    rm = r + 0.018
    mer = T(0, 0, zc) @ tilt @ Matrix.Rotation(math.pi / 2, 4, "Y")
    ring = geo.lathe([(r + 0.012, -0.006), (r + 0.024, -0.006), (r + 0.024, 0.006), (r + 0.012, 0.006)], seg=64, closed=True)
    k.put("brass", ring.xf(mer))
    low = min((mer @ Vector((rm * math.cos(t), rm * math.sin(t), 0.0)) for t in np.linspace(0, TAU, 360)), key=lambda p: p.z)
    k.put("brass", geo.tube([(0.0, 0.0, 0.48), (low.x, low.y * 0.6, (0.48 + low.z) / 2 - 0.005), (low.x, low.y, low.z - 0.002)], 0.009, seg=10))
    return k


def telescope():
    """Brass refractor on a wooden tripod (turret room)."""
    k = Kit()
    hz = 1.15
    for i in range(3):
        a = TAU * i / 3
        k.put("walnut", geo.tube([(0.0, 0.0, hz - 0.05), (0.45 * math.cos(a), 0.45 * math.sin(a), 0.0)], 0.018, seg=10))
    k.put("brass", geo.lathe([(0.0, 0.0), (0.05, 0.0), (0.05, 0.08), (0.0, 0.08)], seg=16).move(0, 0, hz - 0.08))
    tube = geo.lathe([(0.0, -0.55), (0.03, -0.55), (0.03, -0.45), (0.04, -0.4), (0.042, 0.3), (0.05, 0.35), (0.05, 0.55), (0.0, 0.55)], seg=24)
    M = T(0, 0, hz + 0.02) @ Matrix.Rotation(math.radians(-62), 4, "X")
    k.put("brass", tube.xf(M))
    k.put("brass", geo.lathe([(0.0, -0.75), (0.012, -0.75), (0.014, -0.55), (0.0, -0.55)], seg=12).xf(M))
    return k


def orrery():
    """Brass orrery under glass-less display: a sun and arms carrying the planets (chart room)."""
    k = Kit()
    k.put("walnut", geo.lathe([(0.0, 0.0), (0.22, 0.0), (0.23, 0.03), (0.2, 0.06), (0.0, 0.06)], seg=40))
    k.put("brass", geo.tube([(0, 0, 0.06), (0, 0, 0.32)], 0.01, seg=8))
    k.put("gilt", geo.lathe([(math.sin(t) * 0.06, -math.cos(t) * 0.06) for t in np.linspace(0, math.pi, 12)], seg=24).move(0, 0, 0.38))
    for i, (rr, size, h) in enumerate(((0.12, 0.015, 0.3), (0.19, 0.022, 0.28), (0.27, 0.026, 0.26), (0.36, 0.02, 0.24), (0.48, 0.045, 0.22))):
        a = 1.3 * i + 0.4
        x, y = rr * math.cos(a), rr * math.sin(a)
        k.put("brass", geo.tube([(0, 0, h), (x, y, h), (x, y, h + 0.06)], 0.004, seg=6))
        planet = geo.lathe([(math.sin(t) * size, -math.cos(t) * size) for t in np.linspace(0, math.pi, 10)], seg=16)
        k.put("ivory" if i % 2 else "brass", planet.move(x, y, h + 0.06 + size))
    return k


def plan_chest(W=1.4, D=0.95, H=0.9):
    k = Kit()
    y0 = -D / 2
    k.put("oak_threshold", box(-W / 2, W / 2, y0, D / 2, 0.0, 0.08))
    k.put("oak_threshold", box(-W / 2 + 0.02, W / 2 - 0.02, y0 + 0.02, D / 2, 0.08, H - 0.03))
    k.put("oak_threshold", moulded_top(W + 0.03, D + 0.03, 0.03, r_corner=0.0).move(0, 0, H - 0.03))
    n = 6
    for i in range(n):
        z0 = 0.1 + i * (H - 0.16) / n
        z1 = z0 + (H - 0.16) / n
        drawer_front(-W / 2 + 0.02, W / 2 - 0.02, z0, z1, y0, k, "oak_threshold")
    # charts spread on top, weighted with instruments
    k.put("chart_paper", box(-0.55, 0.45, -0.3, 0.35, H, H + 0.002))
    k.put("chart_paper", box(-0.3, 0.6, -0.4, 0.15, H + 0.002, H + 0.004).xf(T(0, 0, 0, rz=0.12)))
    return k


# ---------------------------------------------------------------- kitchen

def windsor_chair():
    k = Kit()
    k.put("pine", rounded_box(0.44, 0.42, 0.045, 0.015, res=6, crown=-0.008).move(0, 0, 0.43))
    for x in (-0.17, 0.17):
        for y in (-0.15, 0.15):
            k.put("pine", geo.tube([(x * 0.85, y * 0.85, 0.43), (x * 1.15, y * 1.15, 0.0)], 0.018, seg=10))
    k.put("pine", geo.tube([(-0.2, 0.0, 0.14), (0.2, 0.0, 0.14)], 0.012, seg=8))
    arc = [(0.2 * math.cos(a), 0.06 + 0.16 * math.sin(a), 0.92) for a in np.linspace(math.radians(10), math.radians(170), 18)]
    k.put("pine", geo.sweep(geo.ccw([(-0.025, -0.02), (0.025, -0.02), (0.025, 0.02), (-0.025, 0.02)]), arc, up=(0, 0, 1)))
    for a in np.linspace(math.radians(18), math.radians(162), 7):
        x, y = 0.19 * math.cos(a), 0.06 + 0.15 * math.sin(a)
        k.put("pine", geo.tube([(x * 0.9, y * 0.9 + 0.01, 0.47), (x, y, 0.91)], 0.009, seg=6))
    return k


def kitchen_table(L=1.8, W=0.9, H=0.78):
    k = Kit()
    k.put("pine_scrubbed", box(-L / 2, L / 2, -W / 2, W / 2, H - 0.045, H))
    k.put("pine", box(-L / 2 + 0.08, L / 2 - 0.08, -W / 2 + 0.08, W / 2 - 0.08, H - 0.16, H - 0.045))
    for x in (-L / 2 + 0.1, L / 2 - 0.1):
        for y in (-W / 2 + 0.1, W / 2 - 0.1):
            k.put("pine", turned_leg(H - 0.045, 0.035, "vase").move(x, y, 0.0))
    drawer_front(-0.35, 0.35, H - 0.15, H - 0.05, -W / 2 + 0.065, k, "pine", "brass")
    return k


def dresser(W=1.8, D=0.5, H=2.2):
    """Kitchen dresser: cupboard base, open plate rack above with plates stood on edge."""
    k = Kit()
    y0 = -D / 2
    k.put("paint_dresser", box(-W / 2, W / 2, y0, D / 2, 0.0, 0.9))
    k.put("pine_scrubbed", box(-W / 2 - 0.02, W / 2 + 0.02, y0 - 0.02, D / 2, 0.9, 0.94))
    for i in range(3):
        xa = -W / 2 + 0.02 + i * (W - 0.04) / 3
        xb = xa + (W - 0.04) / 3
        drawer_front(xa, xb, 0.74, 0.88, y0 - 0.018, k, "paint_dresser")
        k.put("paint_dresser", _raised_panel(xa + 0.06, xb - 0.06, 0.1, 0.66, y0, 0.012).xf(Matrix.Scale(-1, 4, (0, 1, 0))).move(0, 2 * y0, 0))
    k.put("paint_dresser", box(-W / 2, -W / 2 + 0.03, D / 2 - 0.3, D / 2, 0.94, H))
    k.put("paint_dresser", box(W / 2 - 0.03, W / 2, D / 2 - 0.3, D / 2, 0.94, H))
    k.put("paint_dresser", box(-W / 2 + 0.03, W / 2 - 0.03, D / 2 - 0.015, D / 2, 0.94, H))
    k.put("paint_dresser", box(-W / 2 - 0.03, W / 2 + 0.03, D / 2 - 0.33, D / 2, H - 0.06, H))
    plate = geo.lathe([(0.0, 0.0), (0.06, 0.0), (0.08, 0.004), (0.12, 0.016), (0.125, 0.02), (0.12, 0.022), (0.075, 0.008), (0.0, 0.006)], seg=32)
    rng = np.random.default_rng(4)
    for s, z in enumerate((1.2, 1.55, 1.9)):
        k.put("paint_dresser", box(-W / 2 + 0.03, W / 2 - 0.03, D / 2 - 0.28, D / 2 - 0.015, z - 0.02, z))
        k.put("paint_dresser", box(-W / 2 + 0.03, W / 2 - 0.03, D / 2 - 0.27, D / 2 - 0.25, z, z + 0.05))
        n = 6                    # 250 mm plates stood side by side with a hand's gap
        for i in range(n):
            x = -W / 2 + 0.15 + i * (W - 0.3) / (n - 1)
            M = T(x, D / 2 - 0.12, z + 0.125) @ Matrix.Rotation(math.radians(78), 4, "X")
            k.put("china_blue" if (i + s) % 3 else "china", plate.xf(M))
    return k


def butler_sink(board_left=False):
    k = Kit()
    W, D, H = 0.76, 0.5, 0.25
    # fireclay basin: 40 mm walls round a bowl with a 45 mm floor, waste at the centre
    t, tb = 0.04, 0.045
    k.put("ceramic_white", box(-W / 2, W / 2, -D / 2, D / 2, 0.0, tb))
    k.put("ceramic_white", box(-W / 2, W / 2, -D / 2, -D / 2 + t, 0.0, H))
    k.put("ceramic_white", box(-W / 2, W / 2, D / 2 - t, D / 2, 0.0, H))
    k.put("ceramic_white", box(-W / 2, -W / 2 + t, -D / 2, D / 2, 0.0, H))
    k.put("ceramic_white", box(W / 2 - t, W / 2, -D / 2, D / 2, 0.0, H))
    k.put("chrome", geo.lathe([(0.0, tb - 0.004), (0.035, tb - 0.004), (0.035, tb + 0.002), (0.0, tb + 0.002)], seg=20))
    for x in (-W / 2 + 0.06, W / 2 - 0.06):
        k.put("brick", box(x - 0.06, x + 0.06, -D / 2 + 0.05, D / 2, -0.62, 0.0))
    # a scrubbed-pine tap rail across the back rim carries two pillar taps (the sink stands under a
    # window, so nothing can come off the wall above it)
    k.put("pine_scrubbed", box(-W / 2, W / 2, D / 2 - 0.07, D / 2 - 0.005, H, H + 0.035))
    for x in (-0.12, 0.12):
        z0 = H + 0.035
        k.put("brass", geo.lathe([(0.0, 0.0), (0.022, 0.0), (0.016, 0.02), (0.014, 0.09), (0.018, 0.1), (0.0, 0.11)], seg=12)
              .move(x, D / 2 - 0.04, z0))
        k.put("brass", geo.tube([(x, D / 2 - 0.04, z0 + 0.085), (x, D / 2 - 0.1, z0 + 0.085), (x, D / 2 - 0.13, z0 + 0.05)], 0.008, seg=8))
        k.put("porcelain", geo.lathe([(0.0, 0.0), (0.02, 0.0), (0.024, 0.01), (0.02, 0.016), (0.0, 0.018)], seg=12)
              .move(x, D / 2 - 0.04, z0 + 0.11))
    if board_left:
        k.put("pine_scrubbed", box(-W / 2 - 0.6, -W / 2, -D / 2, D / 2, H - 0.04, H))
    else:
        k.put("pine_scrubbed", box(W / 2, W / 2 + 0.6, -D / 2, D / 2, H - 0.04, H))
    return k


def kettle():
    k = Kit()
    body = geo.lathe([(0.0, 0.0), (0.09, 0.0), (0.11, 0.04), (0.11, 0.11), (0.08, 0.17), (0.04, 0.19), (0.0, 0.2)], seg=32)
    k.put("copper_pol", body)
    k.put("copper_pol", geo.tube([(0.09, 0.0, 0.06), (0.15, 0.0, 0.12), (0.19, 0.0, 0.17)], 0.012, seg=10))
    arc = [(-0.08 + 0.16 * t, 0.0, 0.19 + 0.08 * math.sin(math.pi * t)) for t in np.linspace(0, 1, 12)]
    k.put("brass", geo.tube(arc, 0.008, seg=8))
    return k


def pot(r=0.12, h=0.12, handle=True):
    k = Kit()
    k.put("copper_pol", geo.lathe([(0.0, 0.0), (r, 0.0), (r, h), (r + 0.006, h + 0.004), (r - 0.004, h + 0.004), (r - 0.004, 0.004), (0.0, 0.004)], seg=32))
    if handle:
        k.put("brass", geo.tube([(r, 0.0, h * 0.8), (r + 0.25, 0.0, h * 0.9)], 0.009, seg=8))
    return k


# ---------------------------------------------------------------- bathroom

def clawfoot_tub(L=1.7, W=0.78, H=0.62):
    """Roll-top bath: a superellipse plan lofted with a rolled rim and an inner basin, on four
    cast claw-and-ball feet."""
    k = Kit()

    def ring(a, b, z, n=48, p=2.6):
        out = []
        for i in range(n):
            t = TAU * i / n
            c, s = math.cos(t), math.sin(t)
            out.append((a * math.copysign(abs(c) ** (2 / p), c), b * math.copysign(abs(s) ** (2 / p), s), z))
        return out
    outer = [ring(L / 2 - 0.12, W / 2 - 0.1, 0.18), ring(L / 2 - 0.04, W / 2 - 0.03, 0.3), ring(L / 2, W / 2, H - 0.03)]
    rim = [ring(L / 2 + 0.01, W / 2 + 0.01, H - 0.02), ring(L / 2 + 0.005, W / 2 + 0.005, H), ring(L / 2 - 0.04, W / 2 - 0.04, H)]
    inner = [ring(L / 2 - 0.06, W / 2 - 0.06, H - 0.01), ring(L / 2 - 0.12, W / 2 - 0.1, 0.4), ring(L / 2 - 0.25, W / 2 - 0.16, 0.24)]
    body = geo.loft(outer + rim + inner, closed=True, caps=True)
    k.put("ceramic_white", body)
    for sx in (-1, 1):
        for sy in (-1, 1):
            foot = geo.lathe([(0.0, 0.0), (0.04, 0.0), (0.045, 0.03), (0.03, 0.06), (0.035, 0.12), (0.05, 0.18), (0.0, 0.2)], seg=12)
            k.put("brass", foot.move(sx * (L / 2 - 0.2), sy * (W / 2 - 0.16), 0.0))
    # taps and overflow on the end
    for y in (-0.08, 0.08):
        k.put("brass", geo.tube([(L / 2 - 0.06, y, H), (L / 2 - 0.06, y, H + 0.12), (L / 2 - 0.12, y, H + 0.14)], 0.012, seg=10))
    return k


def pedestal_basin():
    k = Kit()
    k.put("ceramic_white", geo.lathe([(0.0, 0.0), (0.16, 0.0), (0.12, 0.05), (0.09, 0.4), (0.12, 0.62), (0.0, 0.64)], seg=32))
    bowl = geo.loft([[(0.3 * math.cos(t) * (1.0 if math.cos(t) > 0 else 1.0), 0.22 * math.sin(t), z) for t in np.linspace(0, TAU, 40, endpoint=False)]
                     for z in (0.64, 0.82)] + [[(0.26 * math.cos(t), 0.18 * math.sin(t), 0.84) for t in np.linspace(0, TAU, 40, endpoint=False)]] +
                    [[(0.2 * math.cos(t), 0.13 * math.sin(t), 0.72) for t in np.linspace(0, TAU, 40, endpoint=False)]], closed=True)
    k.put("ceramic_white", bowl)
    for x in (-0.1, 0.1):
        k.put("brass", geo.lathe([(0.0, 0.0), (0.02, 0.0), (0.014, 0.08), (0.03, 0.1), (0.0, 0.11)], seg=6).move(x, 0.15, 0.84))
    return k


def wc_high_cistern():
    k = Kit()
    k.put("ceramic_white", geo.lathe([(0.0, 0.0), (0.14, 0.0), (0.12, 0.2), (0.16, 0.36), (0.19, 0.4), (0.0, 0.4)], seg=32).xf(Matrix.Diagonal((1.0, 1.25, 1.0, 1.0))))
    k.put("walnut", geo.lathe([(0.0, 0.4), (0.21, 0.4), (0.21, 0.43), (0.0, 0.43)], seg=32).xf(Matrix.Diagonal((1.0, 1.2, 1.0, 1.0))))
    k.put("cast_iron", box(-0.25, 0.25, 0.12, 0.3, 1.9, 2.2))
    k.put("brass", geo.tube([(0.0, 0.2, 0.42), (0.0, 0.2, 1.9)], 0.018, seg=10))
    k.put("brass", geo.tube([(0.2, 0.12, 1.95), (0.2, 0.1, 1.35)], 0.003, seg=6))
    k.put("ceramic_white", geo.lathe([(0.0, 0.0), (0.015, 0.0), (0.02, 0.06), (0.0, 0.08)], seg=10).move(0.2, 0.1, 1.27))
    return k


# ---------------------------------------------------------------- textiles & decoration

def rug(w, d, mat, t=0.012, fringe=True):
    """Pile rug with eased edges and knotted fringe on its short ends; UV 0..1 over the field."""
    k = Kit()
    g = rounded_box(w, d, t, 0.004, res=3)
    g.UV = [[((g.V[i][0] + w / 2) / w, (g.V[i][1] + d / 2) / d) for i in f] for f in g.F]
    k.put(mat, g.move(0, 0, 0.001))
    if fringe:
        fr = core.Geo()
        n = int(w / 0.025)
        for side in (-1, 1):
            for i in range(n):
                x = -w / 2 + (i + 0.5) * w / n
                y = side * d / 2
                fr.add(box(x - 0.004, x + 0.004, min(y, y + side * 0.06), max(y, y + side * 0.06), 0.001, 0.004))
        k.put("linen", fr)
    return k


TIE_Z = 1.15        # holdback height: above the dado rails and wainscot caps (about 1.0 m)


def curtains(W, Hc, drop_to, sheer=True, fabric="velvet_drape", tie=True, rng=None, pole_over=0.25, drapes=True):
    """Window dressing hung from a pole above the opening (local x across the window, y into the
    room from the wall face, z up from the floor): brass pole with finials and rings, a gathered
    sheer across the glass and heavy drapes tied back to each side."""
    rng = rng or np.random.default_rng(2)
    k = Kit()
    pole_z = Hc
    half = W / 2 + pole_over
    k.put("brass", geo.tube([(-half, 0.11, pole_z), (half, 0.11, pole_z)], 0.016, seg=12))
    for sx in (-1, 1):
        k.put("brass", geo.lathe([(0.0, 0.0), (0.03, 0.0), (0.035, 0.03), (0.02, 0.06), (0.0, 0.09)], seg=14)
              .xf(T(sx * half, 0.11, pole_z) @ Matrix.Rotation(sx * math.pi / 2, 4, "Y")))
        k.put("brass", geo.tube([(sx * (half - 0.1), 0.0, pole_z), (sx * (half - 0.1), 0.11, pole_z)], 0.008, seg=8))

    def panel(x0, x1, z0, z1, y, folds, amp, gather_to=None, gather_z=None):
        nx, nz = max(8, int((x1 - x0) / 0.025)), 14
        V, F, UV = [], [], []
        for j in range(nz + 1):
            tz = j / nz
            z = z1 - (z1 - z0) * tz
            for i in range(nx + 1):
                tx = i / nx
                x = x0 + (x1 - x0) * tx
                if gather_to is not None:
                    # pull toward the tie-back point, strongest at the tie height
                    w = max(0.0, 1 - abs(z - gather_z) / (z1 - z0) * 1.6)
                    x = x + (gather_to - x) * w * 0.75
                yy = y + amp * math.sin(tx * folds * TAU + 0.6 * math.sin(tz * 3)) * (1 + 0.3 * tz)
                V.append((x, yy, z))
                UV.append((x, z))
        for j in range(nz):
            for i in range(nx):
                a = j * (nx + 1) + i
                F.append([a, a + 1, a + nx + 2, a + nx + 1])
        g = core.Geo(np.array(V), F, [[UV[q] for q in f] for f in F])
        return g

    if sheer:
        sh = panel(-W / 2 - 0.1, W / 2 + 0.1, drop_to + 0.02, pole_z - 0.04, 0.09, W * 5, 0.012)
        k.put("sheer", sh)
        k.put("sheer", sh.move(0, 0.002, 0).flip())
    for sx in ((-1, 1) if drapes else ()):
        x0, x1 = (-half + 0.05, -W / 2 + 0.1) if sx < 0 else (W / 2 - 0.1, half - 0.05)
        gx = (x0 + 0.05) if sx < 0 else (x1 - 0.05)
        dr = panel(x0, x1, drop_to, pole_z - 0.05, 0.16, 4.5, 0.035, gather_to=gx if tie else None, gather_z=TIE_Z)
        k.put(fabric, dr)
        k.put(fabric, dr.move(0, 0.004, 0).flip())
        if tie:
            # holdback: an arm from the wall just outside the gathered bundle, curling round in front of
            # it to a rosette, so the fabric is held behind the arm instead of being pierced by it
            xa, xr = gx + sx * 0.07, gx - sx * 0.02
            arm = [(xa, 0.0, TIE_Z), (xa, 0.15, TIE_Z), (xa - sx * 0.02, 0.215, TIE_Z), (xa - sx * 0.06, 0.24, TIE_Z), (xr, 0.245, TIE_Z)]
            k.put("gilt", geo.tube(arm, 0.007, seg=8))
            k.put("gilt", geo.lathe([(0.0, 0.0), (0.03, 0.0), (0.035, 0.01), (0.03, 0.02), (0.012, 0.028), (0.0, 0.03)], seg=16)
                  .xf(T(xr, 0.24, TIE_Z) @ Matrix.Rotation(-math.pi / 2, 4, "X")))
            k.put("gilt", geo.lathe([(0.0, 0.0), (0.025, 0.0), (0.025, 0.008), (0.0, 0.008)], seg=12)
                  .xf(T(xa, 0.0, TIE_Z) @ Matrix.Rotation(-math.pi / 2, 4, "X")))      # wall plate
    return k


def picture(w, h, kind="landscape", frame="gilt"):
    """Framed picture hanging flat on a wall (local: x across, y out of the wall, z up from its foot),
    with brass picture-rail hooks and cords."""
    k = Kit()
    fw = 0.07
    outer = [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, h), (-w / 2, h)]
    prof = [(0.0, 0.0), (0.0, fw), (0.012, fw), (0.03, fw - 0.012), (0.04, fw - 0.03), (0.035, 0.012), (0.02, 0.0)]
    path = [(x, 0.0, z) for x, z in [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, h), (-w / 2, h)]]
    k.put(frame, geo.sweep(geo.ccw([(o, -hh) for hh, o in [(p[1], p[0]) for p in prof]]), path[::-1], closed=True, right=(0, 1, 0)))
    can = box(-w / 2 + fw * 0.9, w / 2 - fw * 0.9, 0.004, 0.012, fw * 0.9, h - fw * 0.9)
    can.UV = [[((can.V[i][0] + w / 2) / w, can.V[i][2] / h) for i in f] for f in can.F]
    k.put("painting_" + kind, can)
    return k.xf(Matrix.Scale(-1, 4, (0, 1, 0)))


def vase(h=0.35, r=0.12, mat="ceramic_green"):
    prof = [(0.0, 0.0), (r * 0.55, 0.0), (r * 0.6, 0.02), (r, h * 0.35), (r * 0.9, h * 0.6), (r * 0.45, h * 0.85), (r * 0.5, h),
            (r * 0.42, h), (r * 0.38, h * 0.88), (r * 0.8, h * 0.6), (r * 0.9, h * 0.35), (r * 0.5, 0.03), (0.0, 0.03)]
    k = Kit()
    k.put(mat, geo.lathe(prof, seg=32))
    return k


def candlestick(h=0.3):
    k = Kit()
    k.put("brass", geo.lathe([(0.0, 0.0), (0.06, 0.0), (0.065, 0.01), (0.03, 0.03), (0.015, 0.06), (0.025, 0.12), (0.012, 0.18),
                              (0.014, h - 0.03), (0.03, h - 0.02), (0.02, h), (0.0, h)], seg=20))
    k.put("wax", geo.lathe([(0.0, 0.0), (0.011, 0.0), (0.011, 0.2), (0.005, 0.21), (0.0, 0.21)], seg=12).move(0, 0, h))
    return k


def bowl_of_fruit(r=0.15):
    k = Kit()
    k.put("brass", geo.lathe([(0.0, 0.0), (0.05, 0.0), (0.03, 0.03), (r * 0.6, 0.04), (r, 0.09), (r - 0.006, 0.092), (r * 0.6, 0.048), (0.0, 0.045)], seg=32))
    orange = geo.lathe([(math.sin(t) * 0.038, -math.cos(t) * 0.036) for t in np.linspace(0, math.pi, 10)], seg=16)
    for i, (x, y, z) in enumerate(((0.0, 0.0, 0.085), (0.06, 0.02, 0.08), (-0.05, 0.04, 0.08), (0.01, -0.06, 0.08), (0.02, 0.0, 0.14))):
        k.put("orange", orange.move(x, y, z))
    return k


def clock_longcase():
    """Longcase clock (hall): plinth, trunk with a door, hood with a painted dial, brass finials."""
    k = Kit()
    k.put("walnut", box(-0.26, 0.26, -0.13, 0.13, 0.0, 0.5))
    k.put("walnut", box(-0.2, 0.2, -0.1, 0.11, 0.5, 1.55))
    k.put("walnut", _raised_panel(-0.15, 0.15, 0.6, 1.45, -0.1, 0.012).xf(Matrix.Scale(-1, 4, (0, 1, 0))).move(0, -0.2, 0))
    k.put("walnut", box(-0.25, 0.25, -0.14, 0.13, 1.55, 2.1))
    k.put("clock_dial", geo.lathe([(0.0, 0.0), (0.15, 0.0), (0.15, 0.004), (0.0, 0.004)], seg=40).xf(T(0, -0.14, 1.83) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    k.put("brass", geo.lathe([(0.15, -0.006), (0.17, -0.006), (0.17, 0.006), (0.15, 0.006)], seg=40, closed=True).xf(T(0, -0.145, 1.83) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    for ang, L in ((0.6, 0.1), (2.2, 0.13)):
        k.put("cast_iron", box(-0.004, 0.004, -0.16, -0.155, 0.0, L).xf(T(0, 0, 1.83) @ Matrix.Rotation(ang, 4, "Y")))
    k.put("walnut", geo.sweep(geo.ccw([(0.0, 0.0), (0.03, 0.0), (0.05, 0.04), (0.05, 0.07), (0.0, 0.07)]),
                              [(0.25, -0.14, 2.1), (-0.25, -0.14, 2.1)], up=(0, 0, 1)))
    for x in (-0.2, 0.0, 0.2):
        k.put("brass", geo.lathe([(0.0, 0.0), (0.02, 0.0), (0.025, 0.04), (0.0, 0.1)], seg=10).move(x, -0.05, 2.17))
    return k


def mantel_clock():
    k = Kit()
    k.put("marble_black", box(-0.2, 0.2, -0.07, 0.07, 0.0, 0.05))
    k.put("marble_black", box(-0.16, 0.16, -0.06, 0.06, 0.05, 0.28))
    k.put("marble_black", geo.extrude_profile_y(geo.ccw([(-0.17, 0.28), (0.17, 0.28), (0.0, 0.36)]), -0.065, 0.065))
    k.put("clock_dial", geo.lathe([(0.0, 0.0), (0.075, 0.0), (0.075, 0.003), (0.0, 0.003)], seg=32).xf(T(0, -0.063, 0.17) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    k.put("brass", geo.lathe([(0.075, -0.004), (0.088, -0.004), (0.088, 0.006), (0.075, 0.006)], seg=32, closed=True).xf(T(0, -0.066, 0.17) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    return k


def potted_palm(h=1.25, pot_r=0.2, rng=None):
    """Kentia-like palm in a glazed jardinière: arching fronds with paired leaflets."""
    rng = rng or np.random.default_rng(9)
    k = Kit()
    k.put("ceramic_green", geo.lathe([(0.0, 0.0), (pot_r * 0.7, 0.0), (pot_r * 0.75, 0.03), (pot_r, pot_r * 0.9), (pot_r * 1.05, pot_r * 1.2),
                                      (pot_r * 0.95, pot_r * 1.22), (pot_r * 0.9, pot_r * 1.0), (0.0, pot_r * 1.0)], seg=32))
    k.put("soil", geo.lathe([(0.0, 0.0), (pot_r * 0.93, 0.0), (pot_r * 0.93, 0.01), (0.0, 0.01)], seg=24).move(0, 0, pot_r * 1.1))
    lf = core.Geo()
    for f in range(9):
        yaw = TAU * f / 9 + rng.uniform(-0.2, 0.2)
        lift = rng.uniform(0.9, 1.25)
        L = h * rng.uniform(0.6, 0.9)
        pts = []
        for s in np.linspace(0, 1, 16):
            pts.append((math.cos(yaw) * L * 0.38 * s, math.sin(yaw) * L * 0.38 * s, pot_r * 1.1 + L * (lift * s - 0.75 * s * s)))
        lf.add(geo.tube(pts, 0.006, seg=5))
        for i in range(2, 15):
            p = np.array(pts[i])
            dvec = np.array(pts[i + 1]) - p
            dvec /= np.linalg.norm(dvec)
            side = np.cross(dvec, [0, 0, 1])
            side /= np.linalg.norm(side) + 1e-9
            ll = 0.16 * math.sin(math.pi * i / 15) + 0.04
            for sg in (-1, 1):
                tip = p + side * sg * ll + np.array([0, 0, -0.06]) + dvec * 0.05
                mid = (p + tip) / 2
                wv = dvec * 0.012
                V = np.array([p - wv, p + wv, mid + wv * 1.2 + np.array([0, 0, 0.01]), tip, mid - wv * 1.2 + np.array([0, 0, 0.01])])
                lf.add(core.Geo(V, [[0, 1, 2, 3, 4]], None))
    k.put("leaf", lf)
    return k


def teacup_set():
    """Tray with teapot, two cups and saucers (porch tea table)."""
    k = Kit()
    k.put("silver", geo.lathe([(0.0, 0.0), (0.2, 0.0), (0.21, 0.015), (0.2, 0.016), (0.19, 0.004), (0.0, 0.004)], seg=40))
    k.put("china", geo.lathe([(0.0, 0.0), (0.05, 0.0), (0.07, 0.03), (0.075, 0.08), (0.06, 0.12), (0.03, 0.13), (0.035, 0.14),
                              (0.0, 0.15)], seg=32).move(-0.06, 0.03, 0.004))
    k.put("china", geo.tube([(-0.0, 0.03, 0.06), (0.05, 0.03, 0.1), (0.07, 0.03, 0.13)], 0.008, seg=8))
    for x, y in ((0.08, -0.06), (0.07, 0.08)):          # saucers inside the tray's rim
        k.put("china", geo.lathe([(0.0, 0.0), (0.06, 0.0), (0.07, 0.008), (0.065, 0.01), (0.0, 0.006)], seg=24).move(x, y, 0.004))
        k.put("china", geo.lathe([(0.0, 0.0), (0.025, 0.0), (0.04, 0.03), (0.045, 0.055), (0.04, 0.055), (0.035, 0.032), (0.0, 0.006)], seg=24).move(x, y, 0.012))
    return k


# ---------------------------------------------------------------- more pieces

def drape(w, l, top, hang_side, hang_foot, r=0.06, t=0.012, nx=28, ny=36):
    """A cloth laid over a w x l block whose top is at z=top: flat on top, rolling over the edges with
    radius r and hanging down (sides and foot); the head end stops flat. Thin closed solid."""
    def fold(s, edge):
        # s: signed distance beyond the block edge along the cloth (<= 0 means on top)
        if s <= 0:
            return 0.0, 0.0
        q = math.pi * r / 2
        if s < q:
            return r * math.sin(s / r), -r * (1 - math.cos(s / r))
        return r, -r - (s - q)
    us = np.linspace(-w / 2 - hang_side, w / 2 + hang_side, nx)
    vs = np.linspace(-l / 2 - hang_foot, l / 2, ny)
    top_v, bot_v = [], []
    for v in vs:
        for u in us:
            sx = abs(u) - w / 2
            sy = -v - l / 2
            dx, dzx = fold(sx, w)
            dy, dzy = fold(sy, l)
            x = math.copysign(min(abs(u), w / 2) + dx, u)
            y = (v if sy <= 0 else -l / 2 - dy)
            z = top + dzx + dzy
            top_v.append((x, y, z))
    V = np.array(top_v)
    # thickness along the local normal approximated by pushing toward the block centre
    cen = np.array([0.0, 0.0, top - 0.3])
    dirs = V - cen
    dirs /= np.linalg.norm(dirs, axis=1)[:, None]
    Vb = V - dirs * t
    n = len(V)
    F = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = j * nx + i
            F.append([a, a + 1, a + nx + 1, a + nx])
            F.append([n + a, n + a + nx, n + a + nx + 1, n + a + 1])
    # rims
    def rim(idx):
        out = []
        for k in range(len(idx) - 1):
            a, b = idx[k], idx[k + 1]
            out.append([a, n + a, n + b, b])
        return out
    F += rim([j * nx for j in range(ny)][::-1]) + rim([j * nx + nx - 1 for j in range(ny)])
    F += rim(list(range(nx))) + rim([(ny - 1) * nx + i for i in range(nx)][::-1])
    g = core.Geo(np.vstack([V, Vb]), F, None)
    return core.orient_convex(g) if False else g


def bed_v2(W=1.5, L=2.05, wood="walnut", quilt="quilt_rose"):
    k = bed(W, L, wood, quilt, turn=False)
    k.pop(quilt, None)
    # sides hang; the foot is tucked in at the mattress end (a hanging fold would pass through the footboard)
    # quilt resting on the mattress (top 0.62) from the foot to just short of the pillows
    k[quilt] = drape(W - 0.02, L - 0.54, 0.633, 0.26, 0.0).move(0, -0.25, 0.0)
    # sheet turned down over the quilt's head edge: a band draped over the quilt, hanging with it
    k.put("linen", drape(W + 0.006, 0.33, 0.646, 0.24, 0.0, r=0.072, t=0.006).move(0, L / 2 - 0.685, 0.0))
    return k


def single_bed(wood="walnut", quilt="quilt_rose"):
    return bed_v2(0.95, 1.95, wood, quilt)


def washstand():
    """Marble-topped washstand with a tiled splashback, jug and basin, towel rails at the ends."""
    k = Kit()
    W, D, H = 1.0, 0.5, 0.78
    k.merge(chest_of_drawers(W, D, H - 0.03, "walnut"))
    k.pop("walnut_top", None)
    k.put("marble_hearth", box(-W / 2 - 0.02, W / 2 + 0.02, -D / 2 - 0.02, D / 2, H - 0.03, H))
    k.put("tile_green", box(-W / 2, W / 2, D / 2 - 0.02, D / 2, H, H + 0.3))
    k.put("china", geo.lathe([(0.0, 0.0), (0.08, 0.0), (0.18, 0.06), (0.2, 0.1), (0.19, 0.105), (0.17, 0.065), (0.0, 0.012)], seg=32).move(0, -0.02, H))
    k.put("china", geo.lathe([(0.0, 0.0), (0.07, 0.0), (0.1, 0.1), (0.09, 0.2), (0.06, 0.26), (0.07, 0.3), (0.0, 0.3)], seg=32).move(0, -0.02, H + 0.012))
    for sx in (-1, 1):
        k.put("walnut", geo.tube([(sx * W / 2, -0.15, H - 0.2), (sx * (W / 2 + 0.08), -0.15, H - 0.2), (sx * (W / 2 + 0.08), 0.15, H - 0.2),
                                  (sx * W / 2, 0.15, H - 0.2)], 0.01, seg=8))
    return k


def hall_stand():
    """Hall stand: mirror, coat hooks, glove box and umbrella trays, walnut."""
    k = Kit()
    W, H = 1.0, 2.1
    for sx in (-1, 1):
        k.put("walnut", turned_leg(H, 0.03, "vase").move(sx * (W / 2 - 0.04), 0.0, 0.0))
        # umbrella drip tray on the floor between the legs
        k.put("cast_iron", geo.lathe([(0.0, 0.0), (0.12, 0.0), (0.12, 0.04), (0.11, 0.045), (0.0, 0.01)], seg=24).move(sx * (W / 2 - 0.2), -0.05, 0.0))
    k.put("walnut", box(-W / 2, W / 2, -0.18, 0.06, 0.72, 0.8))
    k.put("walnut", box(-W / 2 + 0.05, W / 2 - 0.05, 0.02, 0.06, 0.8, H - 0.1))
    k.put("mirror", box(-0.3, 0.3, 0.015, 0.02, 1.05, 1.75))
    k.put("walnut", geo.sweep(geo.ccw([(0.0, 0.0), (0.03, 0.0), (0.05, 0.04), (0.05, 0.08), (0.0, 0.08)]),
                              [(W / 2, 0.02, H - 0.1), (-W / 2, 0.02, H - 0.1)], up=(0, 0, 1)))
    for x in (-0.42, -0.36, 0.36, 0.42):
        k.put("brass", geo.tube([(x, 0.02, 1.7), (x, -0.06, 1.68), (x, -0.08, 1.74)], 0.008, seg=6))
    k.put("felt_hat", geo.lathe([(0.0, 0.0), (0.13, 0.0), (0.145, 0.008), (0.145, 0.02), (0.13, 0.012), (0.078, 0.016),
                                          (0.072, 0.05), (0.065, 0.11), (0.0, 0.11)], seg=24).xf(T(-0.39, -0.14, 1.6) @ Matrix.Rotation(0.3, 4, "X")))     # hung by its crown on the hook
    return k


def umbrella_stand():
    k = Kit()
    k.put("brass", geo.lathe([(0.0, 0.0), (0.12, 0.0), (0.13, 0.02), (0.11, 0.08), (0.11, 0.5), (0.13, 0.55), (0.12, 0.56), (0.1, 0.52),
                              (0.1, 0.04), (0.0, 0.04)], seg=28))
    for ang, tilt in ((0.4, 0.12), (2.5, 0.08)):
        u = geo.lathe([(0.0, 0.0), (0.008, 0.0), (0.04, 0.4), (0.03, 0.7), (0.008, 0.9), (0.0, 0.92)], seg=10)
        k.put("umbrella", u.xf(T(0.04 * math.cos(ang), 0.04 * math.sin(ang), 0.05) @ Matrix.Rotation(tilt, 4, "X")))
        k.put("walnut", geo.tube([(0.04 * math.cos(ang), 0.04 * math.sin(ang) + 0.11, 0.97), (0.04 * math.cos(ang) + 0.05, 0.04 * math.sin(ang) + 0.11, 1.02)], 0.01, seg=8))
    return k


def console_table(W=1.2, D=0.4, H=0.8):
    k = Kit()
    k.put("walnut", moulded_top(W, D, 0.03, r_corner=0.0).move(0, 0, H - 0.03))
    k.put("walnut", box(-W / 2 + 0.03, W / 2 - 0.03, -D / 2 + 0.03, D / 2 - 0.03, H - 0.13, H - 0.03))
    drawer_front(-0.3, 0.3, H - 0.13, H - 0.035, -D / 2 + 0.012, k)
    for x in (-W / 2 + 0.06, W / 2 - 0.06):
        for y in (-D / 2 + 0.06, D / 2 - 0.06):
            k.put("walnut", turned_leg(H - 0.13, 0.022, "vase").move(x, y, 0.0))
    k.put("walnut", box(-W / 2 + 0.06, W / 2 - 0.06, -D / 2 + 0.06, D / 2 - 0.06, 0.12, 0.14))
    return k


def trunk(W=0.9, D=0.5, H=0.5):
    k = Kit()
    k.put("leather_brown", rounded_box(W, D, H - 0.12, 0.012, res=4))
    lid = geo.extrude_profile_x([(-D / 2, 0.0), (D / 2, 0.0), (D / 2, 0.06), (D * 0.3, 0.11), (-D * 0.3, 0.11), (-D / 2, 0.06)], -W / 2, W / 2)
    k.put("leather_brown", lid.move(0, 0, H - 0.12))
    for x in (-W / 2 + 0.12, W / 2 - 0.12):
        k.put("oak_threshold", box(x - 0.03, x + 0.03, -D / 2 - 0.005, D / 2 + 0.005, 0.0, H - 0.1))
    k.put("brass", box(-0.05, 0.05, -D / 2 - 0.01, -D / 2, H - 0.2, H - 0.1))
    return k


def crate(s=0.5):
    k = Kit()
    for i in range(4):
        z = 0.01 + i * s / 4
        for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if sx:
                k.put("pine", box(sx * s / 2 - (0.015 if sx > 0 else 0), sx * s / 2 + (0 if sx > 0 else 0.015), -s / 2, s / 2, z, z + s / 4 - 0.01))
            else:
                k.put("pine", box(-s / 2 + 0.015, s / 2 - 0.015, sy * s / 2 - (0.015 if sy > 0 else 0), sy * s / 2 + (0 if sy > 0 else 0.015), z, z + s / 4 - 0.01))
    k.put("pine", box(-s / 2 + 0.015, s / 2 - 0.015, -s / 2 + 0.015, s / 2 - 0.015, 0.0, 0.012))
    return k


def window_seat_curved(r_in, a0, a1, depth=0.42, h=0.42, cushions=True):
    """Upholstered window seat following the turret's inner wall between angles a0..a1 (radians),
    local origin at the turret centre."""
    k = Kit()
    n = max(8, int((a1 - a0) * r_in / 0.15))
    outer = [(r_in * math.cos(a0 + (a1 - a0) * i / n), r_in * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    inner = [((r_in - depth) * math.cos(a0 + (a1 - a0) * i / n), (r_in - depth) * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    poly = outer + inner[::-1]
    k.put("trim_int", geo.prism(geo.ccw(poly), 0.0, h - 0.1))
    # panel faces on the front of the box
    for i in range(0, n, 2):
        aa = a0 + (a1 - a0) * (i + 0.5) / n
    k.put("velvet_teal", rounded_box(1.0, 1.0, 0.1, 0.04, res=4).xf(Matrix.Identity(4)) if False else None)
    if cushions:
        m = max(1, int((a1 - a0) * (r_in - depth / 2) / 0.5))
        for j in range(m):
            am = a0 + (a1 - a0) * (j + 0.5) / m
            seg_len = (a1 - a0) * (r_in - depth / 2) / m - 0.02
            c = rounded_box(seg_len, depth - 0.04, 0.1, 0.04, res=8, crown=0.02)
            M = T((r_in - depth / 2) * math.cos(am), (r_in - depth / 2) * math.sin(am), h - 0.1, rz=am + math.pi / 2)
            k.put("velvet_teal", c.xf(M))
            if j % 2:
                continue
            pil = rounded_box(0.36, 0.11, 0.3, 0.05, res=8)
            Mp = T((r_in - 0.2) * math.cos(am), (r_in - 0.2) * math.sin(am), h + 0.035, rz=am + math.pi / 2) @ Matrix.Rotation(math.radians(12), 4, "X")
            k.put("fabric_floral" if j % 4 else "velvet_rust", pil.xf(Mp))
    return k


def towel_rail():
    k = Kit()
    for x in (-0.3, 0.3):
        k.put("brass", geo.lathe([(0.0, 0.0), (0.06, 0.0), (0.03, 0.03), (0.015, 0.05), (0.0, 0.05)], seg=12).move(x, 0, 0))
        k.put("brass", geo.tube([(x, 0, 0.05), (x, 0, 0.85)], 0.012, seg=10))
    for z in (0.45, 0.8):
        k.put("brass", geo.tube([(-0.3, 0, z), (0.3, 0, z)], 0.01, seg=10))
    k.put("linen", drape(0.5, 0.06, 0.81, 0.0, 0.0, r=0.03, nx=12, ny=4).xf(T(0, 0, 0)) if False else box(-0.22, 0.22, -0.015, 0.015, 0.45, 0.82))
    return k


def shelf_with_jars(W=1.0):
    k = Kit()
    k.put("pine", box(-W / 2, W / 2, -0.12, 0.12, 0.0, 0.025))
    for x in (-W / 2 + 0.05, W / 2 - 0.05):
        k.put("pine", geo.extrude_profile_x([(0.12, 0.0), (0.12, -0.18), (0.1, -0.18), (-0.1, -0.0)], x - 0.012, x + 0.012))
    rng = np.random.default_rng(11)
    x = -W / 2 + 0.08
    while x < W / 2 - 0.08:
        r = rng.uniform(0.04, 0.07)
        h = rng.uniform(0.12, 0.24)
        k.put("glass_jar", geo.lathe([(0.0, 0.0), (r, 0.0), (r, h * 0.85), (r * 0.7, h * 0.92), (r * 0.7, h), (0.0, h)], seg=20).move(x + r, 0.0, 0.025))
        k.put("jar_contents", geo.lathe([(0.0, 0.0), (r * 0.93, 0.0), (r * 0.93, h * 0.6), (0.0, h * 0.6)], seg=16).move(x + r, 0.0, 0.03))
        x += 2 * r + rng.uniform(0.02, 0.05)
    return k


def bar_cart():
    k = Kit()
    for x in (-0.33, 0.33):
        for y in (-0.2, 0.2):
            k.put("brass", geo.tube([(x, y, 0.06), (x, y, 0.82)], 0.01, seg=8))
            k.put("rubber", geo.lathe([(0.0, -0.03), (0.03, -0.028), (0.032, 0.0), (0.03, 0.028), (0.0, 0.03)], seg=12)
                  .xf(T(x, y, 0.035) @ Matrix.Rotation(math.pi / 2, 4, "Y")))
    for z in (0.2, 0.72):
        k.put("walnut", box(-0.35, 0.35, -0.22, 0.22, z, z + 0.02))
        k.put("brass", geo.tube([(-0.35, -0.22, z + 0.06), (0.35, -0.22, z + 0.06), (0.35, 0.22, z + 0.06), (-0.35, 0.22, z + 0.06), (-0.35, -0.22, z + 0.06)], 0.006, seg=6))
    rng = np.random.default_rng(5)
    for i in range(5):
        x = -0.25 + i * 0.12
        h = rng.uniform(0.2, 0.28)
        k.put("glass", geo.lathe([(0.0, 0.0), (0.045, 0.0), (0.045, h * 0.6), (0.02, h * 0.75), (0.015, h), (0.0, h)], seg=20).move(x, 0.05, 0.74))
        k.put("whisky", geo.lathe([(0.0, 0.0), (0.04, 0.0), (0.04, h * 0.45), (0.0, h * 0.45)], seg=16).move(x, 0.05, 0.745))
    return k


def bicycle():
    """A safety bicycle leaning on its stand: two spoked wheels, diamond frame, saddle, bars."""
    k = Kit()
    R = 0.34
    for xc in (-0.53, 0.53):
        k.put("rubber", geo.lathe([(R - 0.02, -0.015), (R, -0.012), (R + 0.012, 0.0), (R, 0.012), (R - 0.02, 0.015)], seg=48, closed=True)
              .xf(T(xc, 0, R + 0.012) @ Matrix.Rotation(math.pi / 2, 4, "X")))
        k.put("chrome", geo.lathe([(R - 0.03, -0.01), (R - 0.02, -0.01), (R - 0.02, 0.01), (R - 0.03, 0.01)], seg=48, closed=True)
              .xf(T(xc, 0, R + 0.012) @ Matrix.Rotation(math.pi / 2, 4, "X")))
        for i in range(32):
            a = TAU * i / 32
            k.put("chrome", geo.tube([(xc, (0.03 if i % 2 else -0.03), R + 0.012), (xc + (R - 0.03) * math.cos(a), 0.0, R + 0.012 + (R - 0.03) * math.sin(a))], 0.0015, seg=4, caps=False))
        k.put("chrome", geo.lathe([(0.0, -0.035), (0.02, -0.035), (0.02, 0.035), (0.0, 0.035)], seg=12).xf(T(xc, 0, R + 0.012) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    bb = (0.0, 0.0, 0.3)
    seat = (-0.15, 0.0, 0.85)
    head = (0.42, 0.0, 0.88)
    rw, fw = (-0.53, 0.0, R + 0.012), (0.53, 0.0, R + 0.012)
    for a, b in ((bb, seat), (bb, head), (seat, head), (bb, rw), (seat, rw), (head, fw)):
        k.put("frame_green", geo.tube([a, b], 0.014, seg=10))
    k.put("leather_brown", rounded_box(0.24, 0.16, 0.06, 0.025, res=6, crown=0.01).move(-0.17, 0, 0.88))
    k.put("chrome", geo.tube([(0.42, 0.0, 0.88), (0.44, 0.0, 1.0), (0.38, -0.25, 1.02)], 0.011, seg=8))
    k.put("chrome", geo.tube([(0.44, 0.0, 1.0), (0.38, 0.25, 1.02)], 0.011, seg=8))
    k.put("rubber", geo.lathe([(0.0, 0.0), (0.084, 0.0), (0.084, 0.008), (0.0, 0.008)], seg=24).xf(T(0.0, 0.03, 0.3) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    return k


def watering_can():
    k = Kit()
    k.put("galvanised", geo.lathe([(0.0, 0.0), (0.11, 0.0), (0.11, 0.24), (0.1, 0.25), (0.0, 0.25)], seg=32))
    k.put("galvanised", geo.tube([(0.1, 0.0, 0.05), (0.25, 0.0, 0.2), (0.38, 0.0, 0.32)], 0.014, seg=10))
    k.put("galvanised", geo.lathe([(0.0, 0.0), (0.02, 0.0), (0.04, 0.05), (0.0, 0.055)], seg=16).xf(T(0.38, 0, 0.32) @ Matrix.Rotation(math.radians(45), 4, "Y")))
    arc = [(-0.1 + 0.2 * t, 0.0, 0.25 + 0.1 * math.sin(math.pi * t)) for t in np.linspace(0, 1, 10)]
    k.put("galvanised", geo.tube(arc, 0.01, seg=8))
    return k


def boot_scraper():
    k = Kit()
    k.put("cast_iron", box(-0.2, 0.2, -0.12, 0.12, 0.0, 0.02))
    for sx in (-1, 1):
        scroll = [(sx * 0.14, 0.0, 0.02), (sx * 0.15, 0.0, 0.15), (sx * 0.12, 0.0, 0.24), (sx * 0.06, 0.0, 0.27), (sx * 0.05, 0.0, 0.21)]
        k.put("cast_iron", geo.tube(scroll, 0.012, seg=8))
    k.put("cast_iron", box(-0.14, 0.14, -0.004, 0.004, 0.12, 0.17))
    return k


def door_mat(w=1.0, d=0.6):
    k = Kit()
    g = rounded_box(w, d, 0.02, 0.006, res=3)
    k.put("coir", g)
    return k
