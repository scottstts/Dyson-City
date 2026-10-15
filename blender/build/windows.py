"""Windows: double-hung sash joinery, glazing, exterior casings/hoods/sills, interior casings.

Every window is built in a local frame: x across the opening, y outward (wall outer face y=0,
inner face y=-TE), z up from the rough sill. Turret windows are flat joinery set in a radial
opening; their casings are warped onto the cylinder.
"""
import math

import numpy as np
from mathutils import Matrix

from . import core, geo
from . import plan as P
from .siding import CASING, HEAD_H, SILL_H, BUTT

COL = "House/Exterior/Windows"
COL_INT = "House/Interior/WindowTrim"

SASH_T = 0.045
STILE = 0.055
RAIL_TOP = 0.055
RAIL_BOT = 0.085
MEET = 0.038
MUNTIN = 0.024
JAMB_T = 0.026
GLASS_T = 0.005
CAS_T = 0.032        # exterior casing board thickness (proud of sheathing)
INT_CAS_W = 0.16
INT_CAS_T = 0.024

# room-dependent interior joinery finish
WALNUT_ROOMS = {"Hall", "Parlour", "Dining", "Library", "Study", "Landing", "Vestibule", "Music"}


def box(x0, x1, y0, y1, z0, z1):
    return geo.box(min(x0, x1), min(y0, y1), min(z0, z1), max(x0, x1), max(y0, y1), max(z0, z1))


# ---------------------------------------------------------------- sash

def sash(xa, xb, za, zb, y0, kind, muntins=1, putty_side=1):
    """A sash frame with glass. kind: 'upper' | 'lower' | 'fixed'. Returns (wood, glass, putty)."""
    wood, glass, putty = core.Geo(), core.Geo(), core.Geo()
    y1 = y0 - SASH_T
    rb = MEET if kind == "upper" else RAIL_BOT
    rt = MEET if kind == "lower" else RAIL_TOP
    if kind == "fixed":
        rb = rt = RAIL_TOP
    wood.add(box(xa, xa + STILE, y0, y1, za, zb))
    wood.add(box(xb - STILE, xb, y0, y1, za, zb))
    wood.add(box(xa + STILE, xb - STILE, y0, y1, za, za + rb))
    wood.add(box(xa + STILE, xb - STILE, y0, y1, zb - rt, zb))
    # panes
    gx0, gx1 = xa + STILE, xb - STILE
    gz0, gz1 = za + rb, zb - rt
    xs = [gx0]
    if muntins:
        span = (gx1 - gx0 - muntins * MUNTIN) / (muntins + 1)
        for i in range(muntins):
            m0 = gx0 + (i + 1) * span + i * MUNTIN
            wood.add(box(m0, m0 + MUNTIN, y0 - 0.006, y1 + 0.006, gz0, gz1))
            xs += [m0, m0 + MUNTIN]
    xs.append(gx1)
    ym = (y0 + y1) / 2
    pt = 0.012
    for i in range(0, len(xs), 2):
        a, b = xs[i], xs[i + 1]
        glass.add(box(a, b, ym + GLASS_T / 2, ym - GLASS_T / 2, gz0, gz1))
        # putty fillets on the outside face of the glass, round the pane
        yo = ym + GLASS_T / 2
        for (p0, p1, nrm) in (((a, gz0), (b, gz0), (0, 1)), ((b, gz1), (a, gz1), (0, -1)),
                              ((a, gz1), (a, gz0), (1, 0)), ((b, gz0), (b, gz1), (-1, 0))):
            pass
        putty.add(_putty_frame(a, b, gz0, gz1, yo, y0, pt))
    return wood, glass, putty


def _putty_frame(a, b, z0, z1, yg, yface, s):
    """Bevelled putty bead between the glass face (y=yg) and the sash face plane (y=yface)."""
    d = yface - yg
    # four triangular prisms, mitred at corners: build as a loft of an inner and outer rectangle
    outer = [(a, yg, z0), (b, yg, z0), (b, yg, z1), (a, yg, z1)]
    inner = [(a + s, yg, z0 + s), (b - s, yg, z0 + s), (b - s, yg, z1 - s), (a + s, yg, z1 - s)]
    top = [(a, yface, z0), (b, yface, z0), (b, yface, z1), (a, yface, z1)]
    g = core.Geo()
    # sloped face: from inner (on glass) to top (at sash face, frame edge)
    V = np.array(inner + top + outer, float)
    F = []
    for i in range(4):
        j = (i + 1) % 4
        F.append([i, j, 4 + j, 4 + i])        # sloped
        F.append([4 + i, 4 + j, 8 + j, 8 + i])  # against frame (hidden)
        F.append([8 + i, 8 + j, j, i])          # on glass (hidden)
    return core.Geo(V, F, None)


def norm_uv(g, x0, x1, z0, z1):
    """Map a pane's UVs to 0..1 across its local x/z extent (one leaded design per light)."""
    uv = []
    for f in g.F:
        uv.append([((g.V[i][0] - x0) / (x1 - x0), (g.V[i][2] - z0) / (z1 - z0)) for i in f])
    g.UV = uv
    return g


# ---------------------------------------------------------------- frame + sashes for one opening

def joinery(W, Ht, transom=0.0, muntins=1, ajar=0.0, fixed=False, depth_in=None, horn=None):
    """Frame, sashes and glass in local coordinates. Returns dict of Geo by material."""
    out = {"sash": core.Geo(), "glass": core.Geo(), "putty": core.Geo(), "stained": core.Geo()}
    w = out["sash"]
    xa, xb = -W / 2, W / 2
    yb = -0.215     # back of the frame (towards the room)
    yf = -0.02      # front of the frame (behind the casing)
    # jambs and head
    w.add(box(xa, xa + JAMB_T, yb, yf, 0.0, Ht))
    w.add(box(xb - JAMB_T, xb, yb, yf, 0.0, Ht))
    w.add(box(xa + JAMB_T, xb - JAMB_T, yb, yf, Ht - JAMB_T, Ht))
    ia, ib = xa + JAMB_T, xb - JAMB_T
    # sill (sloped, projecting, with drip)
    sill = [(-0.2, 0.0), (0.085, -0.035), (0.085, 0.01), (0.07, 0.022), (-0.04, 0.045), (-0.2, 0.05)]
    # profile in (y, z); extrude along x past the casings
    hw = W / 2 + (CASING + 0.05 if horn is None else horn)
    sp = geo.ccw([(-y, z) for y, z in sill])
    # across the opening the sill runs back to the frame; its horns beyond the jambs sit on the
    # outside face only (they would otherwise be buried in the wall)
    w.add(geo.sweep(sp, [(xa, 0, 0), (xb, 0, 0)], up=(0, 0, 1)))
    horn = [(y, z) for y, z in sill if y >= 0.0]
    horn = [(0.0, -0.035 * 0.0 + -0.0)] if False else horn
    hp = geo.ccw([(-y, z) for y, z in [(0.0, -0.035 * (0.0 / 0.085))] + [(0.085, -0.035), (0.085, 0.01), (0.07, 0.022), (0.0, 0.0405)]])
    if hw > W / 2 + 1e-3:
        w.add(geo.sweep(hp, [(-hw, 0, 0), (xa, 0, 0)], up=(0, 0, 1)))
        w.add(geo.sweep(hp, [(xb, 0, 0), (hw, 0, 0)], up=(0, 0, 1)))
    top_open = Ht - JAMB_T
    if transom > 0:
        tb0 = Ht - transom - 0.04
        w.add(box(ia, ib, yb, yf, tb0, tb0 + 0.06))     # transom bar
        top_open = tb0
        # fixed transom light in the outer plane
        fw, fg, fp = sash(ia, ib, tb0 + 0.06, Ht - JAMB_T, -0.05, "fixed", muntins=0)
        w.add(fw)
        out["stained"].add(norm_uv(fg, ia, ib, tb0 + 0.06, Ht - JAMB_T))
        out["putty"].add(fp)
    # stops: blind stop (outer), parting bead, inner stop
    for ys in ((-0.05, -0.02), (-0.105, -0.095), (-0.175, -0.16)):
        w.add(box(ia, ia + 0.016, ys[0], ys[1], 0.045, top_open))
        w.add(box(ib - 0.016, ib, ys[0], ys[1], 0.045, top_open))
        w.add(box(ia + 0.016, ib - 0.016, ys[0], ys[1], top_open - 0.016, top_open))
    sa, sb = ia + 0.016, ib - 0.016
    if fixed:
        fw, fg, fp = sash(sa, sb, 0.045, top_open - 0.016, -0.05, "fixed", muntins=muntins)
        w.add(fw)
        out["glass"].add(fg)
        out["putty"].add(fp)
        return out
    mid = 0.045 + (top_open - 0.016 - 0.045) / 2
    uw, ug, up_ = sash(sa, sb, mid - 0.019, top_open - 0.016, -0.05, "upper", muntins=muntins)
    lo = ajar
    lw, lg, lp = sash(sa, sb, 0.045 + lo, mid + 0.019 + lo, -0.11, "lower", muntins=muntins)
    for g_ in (uw, lw):
        w.add(g_)
    out["glass"].add(ug)
    out["glass"].add(lg)
    out["putty"].add(up_)
    out["putty"].add(lp)
    return out


# ---------------------------------------------------------------- exterior trim

def flute_profile(width, thick, n_flutes=3, depth=0.008):
    """Casing board cross-section (o = outward, h = across) with flutes; CCW in (o, h)."""
    pts = [(0.0, 0.0), (thick, 0.0)]
    gw = width / (n_flutes * 2 + 1)
    for i in range(n_flutes):
        h0 = gw * (2 * i + 1)
        for k in range(7):
            t = k / 6
            pts.append((thick - depth * math.sin(math.pi * t), h0 + gw * t))
    pts += [(thick, width), (0.0, width)]
    return pts


def ext_trim(W, Ht, kind="window", hood=True, cas_w=CASING, bay=False, fluted=True, brackets=True, head=True, base_drop=None):
    """Exterior casings, head (frieze + hood), apron. Local coords; returns Geo (trim paint)."""
    g = core.Geo()
    xa, xb = -W / 2, W / 2
    zt = Ht
    base = 0.02 if kind == "window" else (-0.15 if base_drop is None else -base_drop)
    # side casings (fluted), vertical, sweep in the x-y plane
    nfl = max(3, int(cas_w / 0.05))
    prof = flute_profile(cas_w, CAS_T, n_flutes=nfl) if fluted else [(0, 0), (CAS_T, 0), (CAS_T, cas_w), (0, cas_w)]
    # local: o -> +y, h -> across; build as an extrusion along z
    for side in (-1, 1):
        x_in = xa if side < 0 else xb
        pts = []
        for o, h in prof:
            x = x_in - h if side < 0 else x_in + h
            pts.append((x, o))
        pts = geo.ccw(pts)
        g.add(geo.prism(pts, base, zt))
        # back band moulding on the outer edge
        xo = x_in - cas_w if side < 0 else x_in + cas_w
        bb = [(xo, 0.0), (xo + 0.035 * side, 0.0), (xo + 0.035 * side, CAS_T + 0.012), (xo, CAS_T + 0.02)]
        g.add(geo.prism(geo.ccw(bb), base, zt + 0.0))
        # plinth block at the foot (doors) / sill horn sits under windows
    if not head:
        if kind == "window":
            ax0, ax1 = xa - cas_w + 0.03, xb + cas_w - 0.03
            g.add(box(ax0, ax1, 0.0, CAS_T, -SILL_H + 0.02, -0.035))
        return g
    # head: frieze board with a raised panel + hood (crown) projecting
    hx0, hx1 = xa - cas_w - 0.035, xb + cas_w + 0.035
    fz0, fz1 = zt, zt + 0.2
    g.add(box(hx0, hx1, 0.0, CAS_T, fz0, fz1))
    # raised tablet in the frieze
    g.add(_raised_panel(xa + 0.05, xb - 0.05, fz0 + 0.04, fz1 - 0.04, CAS_T, 0.012))
    if hood:
        crown = [(0.0, 0.0), (0.045, 0.0), (0.045, 0.02), (0.06, 0.03), (0.09, 0.075), (0.11, 0.09),
                 (0.11, 0.13), (0.125, 0.13), (0.125, 0.16), (0.0, 0.16)]
        # hood runs across the head with returns at both ends (sweep along a U path in plan)
        ret = 0.0
        path = [(hx0, ret, fz1), (hx1, ret, fz1)]
        cp = [(o, h) for o, h in crown]
        # sweep along +x: right = x × z = -y ; we want outward (+y), so mirror o
        cp2 = geo.ccw([(-o - CAS_T, h) for o, h in cp])
        hood_g = geo.sweep(cp2, [(hx0 - 0.0, 0, fz1), (hx1, 0, fz1)], up=(0, 0, 1))
        g.add(hood_g)
        if brackets:
            for x in (hx0 + 0.07, hx1 - 0.07):
                g.add(_bracket(x, CAS_T, fz1, 0.22, 0.09, 0.045))
    # apron under the sill
    if kind == "window":
        ax0, ax1 = xa - cas_w + 0.03, xb + cas_w - 0.03
        g.add(box(ax0, ax1, 0.0, CAS_T, -SILL_H + 0.02, -0.035))
        # cyma at the apron's foot
        cy = [(0.0, 0.0), (0.02, 0.0), (0.03, 0.012), (0.03, 0.025), (0.0, 0.03)]
        cp = geo.ccw([(-o - CAS_T, h - SILL_H + 0.02) for o, h in cy])
        g.add(geo.sweep(cp, [(ax0, 0, 0), (ax1, 0, 0)], up=(0, 0, 1)))
    return g


def _raised_panel(x0, x1, z0, z1, y0, h):
    """A low raised panel (bevelled field) on a face at y0, projecting +y by h."""
    if x1 - x0 < 0.03 or z1 - z0 < 0.03 or h <= 0:
        return core.Geo()
    b = min(0.03, (z1 - z0) / 3, (x1 - x0) / 3)
    outer = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)]
    inner = [(x0 + b, y0 + h, z0 + b), (x1 - b, y0 + h, z0 + b), (x1 - b, y0 + h, z1 - b), (x0 + b, y0 + h, z1 - b)]
    V = np.array(outer + inner, float)
    F = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7], [3, 2, 1, 0]]
    F = [f[::-1] for f in F]   # outward normals: the field faces +y
    return core.Geo(V, F, None)


def _bracket(x, y0, ztop, h, d, t):
    """Sawn scroll bracket under a hood: a profile in (y, z) extruded across x."""
    pts = []
    n = 10
    for i in range(n + 1):
        s = i / n
        # outer curve: from (d, top) down to (0, top - h) with an S curve
        yy = d * (1 - s) ** 1.6
        zz = ztop - h * s
        pts.append((yy, zz))
    pts.append((0.0, ztop - h))
    pts.append((0.0, ztop))
    prof = [(y0 + yy, zz) for yy, zz in pts]
    # extrude along x (profile in (y,z) -> extrude_profile_x expects (y,z))
    prof = geo.ccw(prof)
    gg = geo.extrude_profile_x(prof, x - t / 2, x + t / 2)
    return gg


# ---------------------------------------------------------------- interior trim

def int_trim(W, Ht, depth, room_style, kind="window", cw=None):
    """Interior casing (with corner rosettes and plinths), stool and apron, in local coords with
    the wall's inner face at y = -depth."""
    g = core.Geo()
    yi = -depth
    cw, ct = (INT_CAS_W if cw is None else cw), INT_CAS_T
    xa, xb = -W / 2, W / 2
    zb = 0.0 if kind == "window" else 0.0
    # casing profile: backband + stepped field with a bead (in (o=into room, h=across from opening edge))
    prof = [(0.0, 0.0), (0.012, 0.0), (0.016, 0.006), (0.016, 0.03), (0.02, 0.05), (0.02, cw - 0.03),
            (0.03, cw - 0.025), (0.03, cw), (0.0, cw)]
    top = Ht + 0.02
    z0 = 0.06 if kind == "window" else 0.0
    if kind != "window":
        z0 = 0.23  # plinth blocks below
    for side in (-1, 1):
        x_in = xa if side < 0 else xb
        pts = []
        for o, h in prof:
            x = x_in - h if side < 0 else x_in + h
            pts.append((x, yi - o))
        g.add(geo.prism(geo.ccw(pts), z0, top))
        # corner rosette block
        bx0, bx1 = (x_in - cw, x_in) if side < 0 else (x_in, x_in + cw)
        g.add(box(bx0, bx1, yi, yi - 0.032, top, top + cw))
        ros = geo.lathe([(0.0, 0.0), (0.05, 0.0), (0.052, 0.006), (0.044, 0.012), (0.03, 0.016), (0.012, 0.022), (0.0, 0.024)], seg=24)
        ros = ros.xf(Matrix.Translation(((bx0 + bx1) / 2, yi - 0.032, top + cw / 2)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
        g.add(ros)
        if kind != "window":
            g.add(box(bx0 - 0.005 * side * -1, bx1 + 0.005 * side * -1, yi, yi - 0.036, 0.0, 0.23))
    # head casing between the blocks
    pts = [(xa, yi), (xb, yi), (xb, yi - 0.02), (xa, yi - 0.02)]
    g.add(box(xa, xb, yi, yi - 0.02, top, top + cw))
    g.add(box(xa, xb, yi, yi - 0.028, top + 0.02, top + cw - 0.02))
    if kind == "window":
        # stool (with horns) and apron
        g.add(box(xa, xb, -0.215, yi, 0.0, 0.035))
        g.add(box(xa - cw - 0.03, xb + cw + 0.03, yi, yi - 0.045, 0.0, 0.035))
        g.add(box(xa - cw + 0.02, xb + cw - 0.02, yi, yi - 0.02, -0.13, 0.0))
        g.add(box(xa - cw + 0.03, xb + cw - 0.03, yi - 0.02, yi - 0.03, -0.13, -0.1))
    return g


# ---------------------------------------------------------------- placement

def frame_matrix(o, z_extra=0.0):
    a = o["ang"]
    n = (math.cos(a), math.sin(a))
    t = (math.sin(a), -math.cos(a))
    px, py = o["p"]
    z = P.LEVELS[o["level"]] + o["sill"] + z_extra
    return Matrix(((t[0], n[0], 0, px), (t[1], n[1], 0, py), (0, 0, 1, z), (0, 0, 0, 1)))


def warp_cyl(g, o, R):
    """Map local (x, y, z) onto a cylinder of radius R about the turret centre."""
    cx, cy = P.TURRET
    a = o["ang"]
    z0 = P.LEVELS[o["level"]] + o["sill"]
    V = g.V.copy()
    phi = a - V[:, 0] / R
    r = R + V[:, 1]
    out = np.stack([cx + r * np.cos(phi), cy + r * np.sin(phi), V[:, 2] + z0], 1)
    return core.Geo(out, g.F, g.UV, list(g.M))


def tessellate_x(g, step=0.04):
    """Split faces spanning wide x so they bend smoothly when warped (simple: subdivide boxes)."""
    import bmesh
    import bpy
    me = bpy.data.meshes.new("_tess")
    me.from_pydata(g.V.tolist(), [], g.F)
    bm = bmesh.new()
    bm.from_mesh(me)
    xs = g.V[:, 0]
    lo, hi = xs.min(), xs.max()
    k = int((hi - lo) / step)
    for i in range(1, k):
        x = lo + i * (hi - lo) / k
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(x, 0, 0), plane_no=(1, 0, 0))
    bm.verts.ensure_lookup_table()
    V = np.array([v.co[:] for v in bm.verts])
    F = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    bpy.data.meshes.remove(me)
    return core.Geo(V, F, None)


def room_for_opening(o):
    from .shell import room_at
    a = o["ang"]
    n = np.array([math.cos(a), math.sin(a)])
    p = np.array(o["p"]) - n * (P.TE + 0.2)
    z = P.LEVELS[o["level"]] + 1.0
    return room_at(np.array([p[0], p[1], z]), o["level"])


def bay_face_len(o):
    p = np.array(o["p"])
    for bay in (P.BAY_FRONT, P.BAY_BACK):
        for i in range(3):
            a, b = np.array(bay[i]), np.array(bay[i + 1])
            if np.linalg.norm((a + b) / 2 - p) < 1e-3:
                return float(np.linalg.norm(b - a))
    return o["w"] + 2 * CASING


def build_window(o, ajar=0.0):
    """One object per window: joinery + glazing + exterior trim + interior trim, self-unioned so no
    two parts share a coincident face. Turret windows: trims warped to the cylinder."""
    W = o["w"]
    Ht = o["head"] - o["sill"]
    M = frame_matrix(o)
    curved = o.get("curved", False)
    j = joinery(W, Ht, transom=o.get("transom", 0.0), muntins=0 if W < 0.95 else 1, ajar=ajar)
    if o.get("bay"):
        L = bay_face_len(o)
        cw = (L - W) / 2 - 0.075
        tr = ext_trim(W, Ht, cas_w=cw, head=False, bay=True)
    else:
        tr = ext_trim(W, Ht)
    r = room_for_opening(o)
    style = r["name"] if r else ""
    it = int_trim(W, Ht, P.TE, style, cw=o.get("casing"))
    imat = "walnut" if style in WALNUT_ROOMS else "trim_int"
    g = core.Geo()
    g.add(j["sash"], 0)
    g.add(j["glass"], 1)
    g.add(j["putty"], 2)
    g.add(j["stained"], 3)
    if curved:
        g = g.xf(M)
        g.add(warp_cyl(tessellate_x(tr), o, P.TR), 4)
        g.add(warp_cyl(tessellate_x(it), o, P.TR), 5)
    else:
        g.add(tr, 4)
        g.add(it, 5)
        g = g.xf(M)
    return core.obj(f"Win_{o['name']}", g, COL, ["sash_paint", "glass", "putty", "stained_glass", "trim_paint", imat],
                    smooth=30, clean=True)


def build():
    core.clear(COL)
    core.clear(COL_INT)
    for o in P.openings(ext=True):
        if o["kind"] != "window":
            continue
        if o.get("triple"):
            continue
        build_window(o, ajar=0.12 if o["name"] == "G_ERight1" else 0.0)
    core.finish_tmp()
