"""Gable faces and their ornament: the front cross gable (siding, band, fish-scale shingles, oculus,
triple window, bargeboards, rake mouldings, overhang decks, apex truss with pendant and finial) and
the dormers (pedimented fronts, cheeks, small bargeboards, finials).

Gable ornament is built in a local frame: x across the face, y outward (face plane y=0), z up
(absolute heights); then placed with the gable's frame matrix.
"""
import math

import numpy as np
from mathutils import Matrix

from . import core, geo
from . import plan as P
from . import shell, roofs, windows, siding
from .windows import box, _raised_panel

COL = "House/Exterior/Gables"


def face_matrix(cx, cy, ang_out):
    n = (math.cos(ang_out), math.sin(ang_out))
    t = (math.sin(ang_out), -math.cos(ang_out))
    return Matrix(((t[0], n[0], 0, cx), (t[1], n[1], 0, cy), (0, 0, 1, 0), (0, 0, 0, 1)))


# ---------------------------------------------------------------- shingles

def fishscale_rows(x0, x1, z0, z1, w=0.15, expo=0.125, t1=0.016, t0=0.004, y0=0.0, gap=0.004, seg=8):
    """Individual fish-scale shingles covering [x0,x1]x[z0,z1] on the plane y=y0, rows staggered.
    Each shingle is a wedge (thick at its rounded butt, thin under the next row) with a small gap
    to its neighbours, so rows read as separate cut shingles."""
    g = core.Geo()
    nrows = int(math.ceil((z1 - z0) / expo))
    r = (w - gap) / 2
    for k in range(nrows):
        zb = z0 + k * expo
        zt = zb + expo * 1.6     # extends under the next row
        shift = (w / 2) if (k % 2) else 0.0
        xs = x0 - w + shift
        while xs < x1 + w:
            cx = xs + w / 2
            poly = []
            for i in range(seg + 1):
                a = math.pi + math.pi * i / seg
                poly.append((cx + r * math.cos(a), zb + r + r * math.sin(a)))
            poly = [(cx - r, zt)] + poly[::-1][::-1] + [(cx + r, zt)]
            poly = geo.dedupe(poly)
            m = len(poly)

            def off(z):
                f = min(1.0, max(0.0, (z - zb) / (zt - zb)))
                return t1 + (t0 - t1) * f
            V = [(x, y0 + 0.0005 * (k % 2), z) for x, z in poly] + [(x, y0 + off(z), z) for x, z in poly]
            F = [list(range(m)), [m + i for i in range(m)][::-1]]
            for i in range(m):
                j = (i + 1) % m
                F.append([i, m + i, m + j, j])
            UV = [[(x, z) for x, z in poly], [(x, z) for x, z in poly][::-1]]
            for i in range(m):
                j = (i + 1) % m
                UV.append([poly[i], (poly[i][0], poly[i][1] + 0.02), (poly[j][0], poly[j][1] + 0.02), poly[j]])
            g.add(core.Geo(np.array(V), F, UV))
            xs += w
    return g


# ---------------------------------------------------------------- rake pieces (local frame)

def rake_points(half_w, z_eave, z_ridge, over_side=0.0):
    """Left and right rake lines (x, z) from eave end to apex, in the face plane."""
    return [(-half_w - over_side, z_eave), (0.0, z_ridge)], [(half_w + over_side, z_eave), (0.0, z_ridge)]


def bargeboard(half_w, z_eave, z_ridge, depth=0.3, t=0.035, y=0.0, scallop=0.16, holes=True, s_start=0.0):
    """Both bargeboards as one Geo. The board hangs below the rake line; lower edge scalloped with
    pointed drops, pierced with round holes."""
    g = core.Geo()
    pitch = math.atan2(z_ridge - z_eave, half_w)
    L = math.hypot(half_w, z_ridge - z_eave)
    for side in (-1, 1):
        # local board coords: s along the rake from the eave end (0) to apex (L), d below the rake
        outline = [(s_start, 0.0), (L, 0.0)]
        # apex end: vertical cut (plumb) => in (s,d) a slanted end; approximate with a plumb line
        d_ap = depth / math.cos(pitch)
        outline.append((L - depth * math.tan(pitch) * 0.0, depth * 1.0))
        # scalloped lower edge from apex back to the eave end
        n = max(2, int((L - 0.2 - s_start) / scallop))
        for i in range(n, 0, -1):
            s0 = s_start + 0.1 + (i) * (L - 0.2 - s_start) / n
            s1 = s_start + 0.1 + (i - 1) * (L - 0.2 - s_start) / n
            for k in range(1, 9):
                u = k / 8
                s = s0 + (s1 - s0) * u
                outline.append((s, depth - 0.07 * math.sin(math.pi * u)))
        outline.append((s_start, depth * 0.7))
        outline = geo.dedupe(outline)
        # map (s, d) -> (x, z) in face plane
        def mp(s, d):
            x = side * (half_w - s * math.cos(pitch)) - 0.0
            z = z_eave + s * math.sin(pitch)
            # d below the rake, perpendicular to it
            x += side * (-d * math.sin(pitch)) * -1 * -1
            z -= d * math.cos(pitch)
            return x, z
        pts = [mp(s, d) for s, d in outline]
        # clip at the centre line (plumb cut at the apex)
        pts = [(x if side * x > 0.0 else 0.0, z) for x, z in pts]
        pts = geo.dedupe(pts)
        prof = geo.ccw(pts)
        board = geo.extrude_profile_y(prof, y - t, y)
        g.add(board)
    return g


def rake_moulding(half_w, z_eave, z_ridge, y, scale=1.0):
    """Verge moulding standing just proud of the slate edge (y = the overhang's front plane): it
    rises above the slates' butts so the course sawtooth never shows through it."""
    g = core.Geo()
    prof = [(0.0, -0.075), (0.022, -0.075), (0.032, -0.06), (0.046, -0.035), (0.056, -0.01), (0.056, 0.034),
            (0.0, 0.034)]
    prof = [(o * scale, h * scale) for o, h in prof]
    for side in (-1, 1):
        path = [(side * half_w, y, z_eave), (0.0, y, z_ridge)]
        if side > 0:
            path = path[::-1]
        g.add(geo.sweep(geo.ccw(prof), path, right=(0, 1, 0)))
    return g


def overhang_deck(half_w, z_eave, z_ridge, y_wall, y_front, thick=0.03, under=0.0):
    """Boards under the slates of the rake overhang (one per side), sloping with the roof."""
    g = core.Geo()
    pitch = math.atan2(z_ridge - z_eave, half_w)
    for side in (-1, 1):
        a = (side * half_w, z_eave)
        b = (0.0, z_ridge)
        # roof surface points at y_front..y_wall, then thickness down along -roof normal
        nz = math.cos(pitch)
        nx = side * math.sin(pitch)
        V = []
        for (x, z) in (a, b):
            for yy in (y_front, y_wall):
                V.append((x, yy, z - under))
        top = np.array(V)
        bot = top - np.array([nx, 0, nz]) * thick
        # build as a hexahedron
        verts = np.vstack([top, bot])
        F = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
        g.add(core.orient_convex(core.Geo(verts, F, None)))
    return g


def apex_truss(half_w, z_eave, z_ridge, y, scale=1.0):
    """Spindle fan under the apex: a collar, a half-round hub with a turned drop, and turned
    spindles radiating from the hub to the rakes."""
    g = core.Geo()
    pitch = math.atan2(z_ridge - z_eave, half_w)
    zc = z_ridge - 0.9 * scale
    hx = (z_ridge - zc) / math.tan(pitch) - 0.06 * scale
    t = 0.06 * scale
    g.add(box(-hx, hx, y - t, y, zc - 0.07 * scale, zc))
    # hub: half disc on the collar
    hub = geo.lathe([(0.0, 0.0), (0.11 * scale, 0.0), (0.11 * scale, t), (0.0, t)], seg=24, a0=0.0, a1=math.pi)
    hub = hub.xf(Matrix.Rotation(math.pi / 2, 4, "X")).move(0, y, zc)
    g.add(hub)
    # drop under the hub
    pend = geo.lathe([(0.0, 0.0), (0.02, 0.0), (0.04, 0.03), (0.045, 0.06), (0.025, 0.09), (0.03, 0.12),
                      (0.012, 0.16), (0.0, 0.17)], seg=16)
    pend = pend.xf(Matrix.Diagonal((scale, scale, -scale, 1.0))).move(0, y - t / 2, zc - 0.07 * scale)
    g.add(pend)
    # radiating spindles
    sp = [(0.0, 0.0), (0.011, 0.0), (0.011, 0.03), (0.007, 0.05), (0.012, 0.25), (0.007, 0.45), (0.011, 0.47), (0.011, 0.5), (0.0, 0.5)]
    n = 9
    for i in range(n):
        a = math.radians(12) + (math.pi - math.radians(24)) * i / (n - 1)
        d = np.array([math.cos(a), math.sin(a)])
        # distance from hub centre to the rake along d
        # rake lines: z = z_ridge - |x| tan(p); solve zc + s*dz = z_ridge - |s*dx| tan(p)
        s_end = (z_ridge - zc) / (d[1] + abs(d[0]) * math.tan(pitch)) - 0.05 * scale
        s0 = 0.11 * scale
        L = s_end - s0
        if L < 0.08:
            continue
        sg = geo.lathe([(r * scale, z * L / 0.5) for r, z in sp], seg=10)
        # orient the spindle's z axis along d in the x-z plane
        ang = math.atan2(d[0], d[1])
        sg = sg.xf(Matrix.Rotation(ang, 4, "Y")).move(d[0] * s0, y - t / 2, zc + d[1] * s0)
        g.add(sg)
    return g


def finial(h=0.9, r=0.07):
    prof = [(0.0, 0.0), (r * 1.1, 0.0), (r * 1.1, 0.06), (r * 0.8, 0.08), (r * 0.6, 0.12), (r * 0.9, 0.2),
            (r * 1.2, 0.28), (r * 0.9, 0.36), (r * 0.4, 0.4), (r * 0.45, 0.46), (r * 0.8, 0.5), (r * 0.8, 0.53),
            (r * 0.3, 0.56), (r * 0.25, 0.7), (r * 0.6, 0.76), (r * 0.65, 0.8), (r * 0.3, 0.86), (r * 0.08, 0.98),
            (0.0, 1.0)]
    return geo.lathe([(a, b * h) for a, b in prof], seg=20)


# ---------------------------------------------------------------- the front cross gable

def _front_gable_frame():
    x0, y0, x1, y1 = P.C
    cx = (x0 + x1) / 2
    half = (x1 - x0) / 2
    M = face_matrix(cx, y0, -math.pi / 2)
    tri = [(-half - 0.01, P.CORNICE_TOP - 2.0), (half + 0.01, P.CORNICE_TOP - 2.0), (half + 0.01, P.CORNICE_TOP),
           (0.0, P.GABLE_RIDGE), (-half - 0.01, P.CORNICE_TOP)]
    return y0, half, M, tri


def front_gable_siding(col=f"{COL}/Front"):
    """The front gable's siding from the floor line to the band, cut round the window and returns
    (re-run after the trim outline changes without rebuilding the gable)."""
    import bpy
    for n in ("Gable_Siding", "Gable_BayFlashing"):
        if bpy.data.objects.get(n):
            bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
    y0, half, M, tri = _front_gable_frame()
    z_e = P.CORNICE_TOP
    band_z = 12.2
    # --- siding on the face from the floor line to the band, cut round the window and returns
    sp = siding.clap_solid([(-half, 0.0), (half, 0.0)][::-1], siding.TOP_MAIN, band_z)
    # clap_solid sweeps along the path with outward = right of travel; along -x in local => right = +y. OK
    so = core.obj("Gable_Siding", sp.xf(M), col, "siding_paint", smooth=None)
    clip = core.geo_obj(geo.extrude_profile_y(geo.ccw(tri), -0.2, 0.2).xf(M), "_clip")
    core.boolean(so, [clip], op="INTERSECT")
    cut = [core.geo_obj(siding.trim_cutter(o), "_c") for o in P.OPENINGS if o["name"] == "L2_Gable"]
    for sx in (-1, 1):
        cut.append(core.geo_obj(box(sx * half - 0.6, sx * half + 0.6, -0.1, 0.8, siding.TOP_MAIN - 0.1, z_e + 0.02).xf(M), "_r"))
    # the front bay's roof meets the face low down
    core.boolean(so, cut, op="DIFFERENCE")
    ob = bpy.data.objects.get("BayFront_Roof_Body")
    if ob:
        bb = [ob.matrix_world @ __import__("mathutils").Vector(c) for c in ob.bound_box]
        bx0 = min(v.x for v in bb) - 0.02
        bx1 = max(v.x for v in bb) + 0.02
        bz1 = max(v.z for v in bb) + 0.045
        core.boolean(so, [core.geo_obj(geo.box(bx0, y0 - 0.2, P.L1, bx1, y0 + 0.1, bz1), "_bay")], op="DIFFERENCE")
        # lead apron flashing dressed over the bay roof against the face
        fl = geo.box(bx0 + 0.01, y0 - 0.026, bz1 - 0.12, bx1 - 0.01, y0 - 0.002, bz1 - 0.005)
        core.obj("Gable_BayFlashing", fl, col, "lead", smooth=None)
    core.finish_tmp()


def build_front_gable():
    col = f"{COL}/Front"
    core.clear(col)
    x0, y0, x1, y1 = P.C
    cx = (x0 + x1) / 2
    half = (x1 - x0) / 2
    M = face_matrix(cx, y0, -math.pi / 2)
    z_e, z_r = P.CORNICE_TOP, P.GABLE_RIDGE
    pitch = math.atan2(z_r - z_e, half)
    band_z = 12.2
    yfront = roofs.GABLE_OVERHANG
    tri = _front_gable_frame()[3]
    front_gable_siding(col)
    # --- band at the gable's waist
    bh = (z_r - band_z) / math.tan(pitch)
    band = box(-bh - 0.3, bh + 0.3, 0.0, 0.035, band_z, band_z + 0.22)
    band.add(geo.sweep(geo.ccw([(-0.0, 0.0), (0.06, 0.0), (0.07, 0.015), (0.05, 0.03), (0.0, 0.03)]),
                       [(bh + 0.3, 0.0, band_z + 0.22), (-bh - 0.3, 0.0, band_z + 0.22)], up=(0, 0, 1)))
    bo = core.obj("Gable_Band", band.xf(M), col, "trim_paint", smooth=40)
    core.boolean(bo, [core.geo_obj(geo.extrude_profile_y(geo.ccw(tri), -0.2, 0.3).xf(M), "_clip")], op="INTERSECT")
    # --- fish-scale shingles above the band, clipped to the gable triangle, with an oculus
    sh = fishscale_rows(-bh - 0.2, bh + 0.2, band_z + 0.252, z_r + 0.1)
    shg = core.obj("Gable_Shingles", sh.xf(M), col, "shingle_paint", smooth=None, weld=False)
    tri_in = [(-half, z_e - 0.1), (half, z_e - 0.1), (0.0, z_r - 0.02)]
    core.boolean(shg, [core.geo_obj(geo.extrude_profile_y(geo.ccw(tri_in), -0.2, 0.3).xf(M), "_clip")], op="INTERSECT")
    ocz = band_z + 0.22 + 0.62
    occ = geo.lathe([(0.0, -0.3), (0.33, -0.3), (0.33, 0.3), (0.0, 0.3)], seg=40).xf(Matrix.Rotation(math.pi / 2, 4, "X")).move(0, 0, ocz)
    core.boolean(shg, [core.geo_obj(occ.xf(M), "_oc")], op="DIFFERENCE")
    # oculus: moulded ring + louvres
    ring = geo.lathe([(0.255, 0.0), (0.33, 0.0), (0.33, 0.02), (0.315, 0.045), (0.29, 0.055), (0.255, 0.04), (0.255, 0.0)], seg=48)
    ring = ring.xf(Matrix.Rotation(-math.pi / 2, 4, "X")).move(0, 0.0, ocz)
    lv = core.Geo()
    for i in range(7):
        zz = -0.21 + i * 0.07
        hw = math.sqrt(max(0.0, 0.255 ** 2 - zz ** 2)) + 0.01
        blade = geo.extrude_profile_x([(0.012, zz - 0.025), (0.07, zz + 0.025), (0.078, zz + 0.022), (0.02, zz - 0.028)], -hw, hw)
        lv.add(blade)
    back = geo.lathe([(0.0, 0.0015), (0.254, 0.0015), (0.254, 0.007), (0.0, 0.007)], seg=40).xf(Matrix.Rotation(-math.pi / 2, 4, "X"))
    lv.add(back.move(0, 0, 0))
    core.obj("Gable_Oculus", ring.xf(M), col, "trim_paint", smooth=40)
    core.obj("Gable_Oculus_Louvres", lv.move(0, 0, ocz).xf(M), col, "accent_paint", smooth=None)
    # --- rake: overhang decks, bargeboards, rake mouldings, apex truss, finial, pendant
    yb = yfront - 0.03
    deck = overhang_deck(half, z_e, z_r, 0.024, yfront - 0.02, thick=0.035)
    core.obj("Gable_OverhangDeck", deck.xf(M), col, "porch_ceiling", smooth=None, clean=True)
    bb = bargeboard(half, z_e - 0.04, z_r - 0.04, depth=0.32, y=yb, s_start=0.75)
    core.obj("Gable_Bargeboards", bb.xf(M), col, "trim_paint", smooth=None, clean=True)
    rm = rake_moulding(half + 0.01, z_e, z_r, yfront + 0.002)
    core.obj("Gable_RakeMoulding", rm.xf(M), col, "trim_paint", smooth=40, clean=True)
    tr = apex_truss(half, z_e - 0.3, z_r - 0.32, yb - 0.04, scale=1.0)
    core.obj("Gable_ApexTruss", tr.xf(M), col, "trim_paint", smooth=35)
    fin = finial(1.15, 0.075).move(0, yfront - 0.12, z_r - 0.05)
    core.obj("Gable_Finial", fin.xf(M), col, "trim_paint", smooth=35)
    # --- triple window
    build_triple_window()
    core.finish_tmp()


def build_triple_window():
    col = f"{COL}/Front"
    o = [q for q in P.OPENINGS if q["name"] == "L2_Gable"][0]
    M = windows.frame_matrix(o)
    W = o["w"]
    Ht = o["head"] - o["sill"]
    mull = 0.12
    lw = (W - 2 * mull) / 3
    gj = core.Geo()
    gl = core.Geo()
    pt = core.Geo()
    for i in range(3):
        xc = -W / 2 + lw / 2 + i * (lw + mull)
        j = windows.joinery(lw, Ht, muntins=0)
        for key, dst in (("sash", gj), ("glass", gl), ("putty", pt)):
            dst.add(j[key].move(xc, 0, 0))
    for i in (1, 2):
        xm = -W / 2 + i * lw + (i - 1) * mull
        gj.add(box(xm, xm + mull, -0.215, 0.0, 0.0, Ht))
    tr = windows.ext_trim(W, Ht)
    # applied pilasters on the mullions
    for i in (1, 2):
        xm = -W / 2 + i * lw + (i - 1) * mull
        tr.add(geo.prism(geo.ccw([(xm - 0.005, 0.0), (xm + mull + 0.005, 0.0), (xm + mull + 0.005, 0.03), (xm - 0.005, 0.03)]), 0.02, Ht))
    g = core.Geo()
    g.add(gj, 0)
    g.add(gl, 1)
    g.add(pt, 2)
    g.add(tr, 0)
    g.add(windows.int_trim(W, Ht, P.TE, "GableRoom"), 3)
    core.obj("Win_L2_Gable", g.xf(M), col, ["sash_paint", "glass", "putty", "trim_int"], smooth=30, clean=True)


# ---------------------------------------------------------------- dormers

def build_dormers():
    col = f"{COL}/Dormers"
    core.clear(col)
    hw_out = shell.DORMER_W / 2
    for d in P.DORMERS:
        o, n, t = shell.dormer_frame(d)
        name = d[0]
        # local frame: x across (t... use our face convention), y outward, z absolute
        ang = math.atan2(n[1], n[0])
        p = o - n * P.DORMER_SET
        M = face_matrix(p[0], p[1], ang)
        z_e, z_r = shell.DORMER_EAVE, shell.DORMER_RIDGE
        g = core.Geo()
        # face: pilasters at the corners, frieze under the eaves, pediment fill (shingles)
        w = d[4]
        sill = P.L2 + P.DORMER_SILL
        head = P.L2 + P.DORMER_HEAD
        # corner pilasters from the window's jambs out to the cheeks (full height), with capitals;
        # the apron and the frieze sit between them at the same depth, so the parts share faces exactly
        xi = w / 2 + 0.03          # a 3 cm reveal shows between the pilasters and the sash frame
        zb, zt = P.CORNICE_TOP + 0.02, z_e - 0.12
        for sx in (-1, 1):
            g.add(box(sx * xi, sx * hw_out, 0.0, 0.035, zb, zt - 0.06))
            g.add(box(sx * (xi - 0.01), sx * (hw_out + 0.01), 0.0, 0.05, zt - 0.06, zt))
        if sill - 0.005 > zb:
            g.add(box(-xi, xi, 0.0, 0.035, zb, sill - 0.005))
        if sill - 0.09 - (zb + 0.05) > 0.1:
            g.add(_raised_panel(-xi + 0.05, xi - 0.05, zb + 0.05, sill - 0.09, 0.035, 0.012))
        g.add(box(-xi + 0.01, xi - 0.01, 0.0, 0.035, head, zt))
        # eave returns (small cornice under the pediment)
        prof = [(0.0, 0.0), (0.05, 0.0), (0.06, 0.02), (0.09, 0.05), (0.1, 0.08), (0.0, 0.08)]
        g.add(geo.sweep(geo.ccw([(-o_, h) for o_, h in prof]), [(-hw_out - 0.06, 0, z_e - 0.12), (hw_out + 0.06, 0, z_e - 0.12)], up=(0, 0, 1)))
        # pediment tympanum: flat board with a sunburst of raised rays
        tri = [(-hw_out, z_e - 0.04), (hw_out, z_e - 0.04), (0.0, z_r - 0.04)]
        g.add(geo.extrude_profile_y(geo.ccw(tri), 0.0, 0.02))
        core.obj(f"Dormer_{name}_Face", g.xf(M), col, "trim_paint", smooth=35, clean=True)
        rg = core.Geo()
        for k in range(7):
            a = math.pi * (k + 0.5) / 7
            r0, r1 = 0.08, 0.7
            pts = [(r0 * math.cos(a - 0.08), r0 * math.sin(a - 0.08)), (r1 * math.cos(a - 0.05), r1 * math.sin(a - 0.05)),
                   (r1 * math.cos(a + 0.05), r1 * math.sin(a + 0.05)), (r0 * math.cos(a + 0.08), r0 * math.sin(a + 0.08))]
            pts = [(x, z_e - 0.02 + z * 0.9) for x, z in pts]
            rg.add(geo.extrude_profile_y(geo.ccw(pts), 0.02, 0.032))
        rays = core.obj(f"Dormer_{name}_Rays", rg.xf(M), col, "trim_paint", smooth=None)
        # clip the rays to the pediment
        core.boolean(rays, [core.geo_obj(geo.extrude_profile_y(geo.ccw([(-hw_out - 0.2, P.CORNICE_TOP - 0.1), (hw_out + 0.2, P.CORNICE_TOP - 0.1), (hw_out + 0.2, z_e - 0.04), (0, z_r - 0.06), (-hw_out - 0.2, z_e - 0.04)]), -0.2, 0.3).xf(M), "_dc")], op="INTERSECT")
        # rake: deck, bargeboards, moulding, finial
        ov = roofs.DORMER_OVER
        pitch = math.atan2(z_r - z_e, hw_out)
        he = hw_out + roofs.DORMER_EAVE_OVER
        ze = z_e - roofs.DORMER_EAVE_OVER * math.tan(pitch)
        deck = overhang_deck(he, ze, z_r, 0.024, ov - 0.02, thick=0.03)
        core.obj(f"Dormer_{name}_Deck", deck.xf(M), col, "porch_ceiling", smooth=None, clean=True)
        bb = bargeboard(he, ze - 0.03, z_r - 0.03, depth=0.17, y=ov - 0.026, scallop=0.12)
        core.obj(f"Dormer_{name}_Barge", bb.xf(M), col, "trim_paint", smooth=None, clean=True)
        rm = rake_moulding(he + 0.01, ze, z_r, ov + 0.002, scale=0.8)
        core.obj(f"Dormer_{name}_Rake", rm.xf(M), col, "trim_paint", smooth=40, clean=True)
        fin = finial(0.55, 0.045).move(0, ov - 0.08, z_r - 0.03)
        core.obj(f"Dormer_{name}_Finial", fin.xf(M), col, "trim_paint", smooth=35)
        # cheeks: siding on both side walls of the dormer, from the mansard up to the eave
        cg = core.Geo()
        for sx in (-1, 1):
            # cheek plane: x = sx*hw_out, running from y=0 back into the roof (y negative local)
            path = [(sx * hw_out, -shell.DORMER_DEPTH + P.DORMER_SET), (sx * hw_out, 0.0)]
            if sx < 0:
                path = path[::-1]
            cs = siding.clap_solid(path, P.CORNICE_TOP - 0.3, z_e - 0.02)
            cg.add(cs)
        co = core.obj(f"Dormer_{name}_Cheeks", cg.xf(M), col, "siding_paint", smooth=None)
        # trim the cheeks to what stands outside the mansard
        core.boolean(co, [core.geo_obj(shell.mansard_outer(grow=roofs.T_BUTT + 0.004), "_mo")], op="DIFFERENCE")
        # window
        wo = dict(name=f"L2_Dormer{name}", level=2, p=(p[0], p[1]), ang=ang, w=w, sill=P.DORMER_SILL,
                  head=P.DORMER_HEAD, kind="window", ext=True, transom=0.0, curved=False)
        Mw = windows.frame_matrix(wo)
        j = windows.joinery(w, P.DORMER_HEAD - P.DORMER_SILL, muntins=0, horn=0.0)
        gw = core.Geo()
        gw.add(j["sash"], 0)
        gw.add(j["glass"], 1)
        gw.add(j["putty"], 2)
        # no exterior casing: the dormer's pilasters frame it
        gw.add(windows.int_trim(w, P.DORMER_HEAD - P.DORMER_SILL, 0.24, ""), 3)
        core.obj(f"Win_L2_Dormer{name}", gw.xf(Mw), col, ["sash_paint", "glass", "putty", "trim_int"], smooth=30, clean=True)
    core.finish_tmp()


def build():
    build_front_gable()
    build_dormers()
