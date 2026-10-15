"""Bracketed cornices (main block, wings), bay entablatures, bay roofs, bay corner colonettes and
apron panels. The deep cornices are the house's main shade-holding projections under top light.
"""
import math

import bmesh
import numpy as np
from mathutils import Matrix, Vector

from . import core, geo
from . import plan as P
from . import roofs
from .siding import TOP_MAIN, TOP_WING, WT_TOP, BELT

COL = "House/Exterior/Cornice"


def scale_prof(prof, so, sh):
    return [(o * so, h * sh) for o, h in prof]


# main cornice: (o, h) from the frieze foot; total 1.05 tall, 0.66 projection
MAIN_PROF = [
    (0.0, 0.0), (0.035, 0.0), (0.035, 0.40),
    (0.05, 0.40), (0.05, 0.42), (0.07, 0.43), (0.088, 0.455), (0.1, 0.485), (0.1, 0.5),
    (0.52, 0.5), (0.52, 0.53), (0.535, 0.53), (0.535, 0.72),
    (0.55, 0.73), (0.565, 0.76), (0.585, 0.81), (0.605, 0.85), (0.62, 0.865), (0.64, 0.875),
    (0.64, 0.92), (0.66, 0.92), (0.66, 0.97), (0.0, 1.05),
]


def bracket_geo(h=0.48, d=0.45, t=0.09, o0=0.035):
    """Italianate scroll bracket: outline in (o, h) with a scrolled front, extruded t thick,
    with a turned drop at its foot. Built centred on x=0, o along +y, h along +z from 0."""
    pts = [(o0, 0.0)]
    # foot curl
    for k in range(9):
        a = math.pi * (1.0 - k / 8)
        pts.append((o0 + 0.05 + 0.04 * math.cos(a), 0.045 + 0.04 * math.sin(a) * -1 + 0.0))
    # S-curve front up to the top
    n = 18
    for k in range(1, n + 1):
        s = k / n
        o = o0 + 0.09 + (d - 0.09 - o0) * (0.5 - 0.5 * math.cos(math.pi * s)) ** 0.9
        hh = 0.08 + (h - 0.08) * s
        pts.append((o, hh))
    # stop short of the bed moulding (o < 0.1, h > 0.4 in profile units scaled with the bracket)
    sc = h / 0.48
    pts.append((0.1 * sc, h))
    pts.append((0.1 * sc, 0.395 * sc))
    pts.append((o0, 0.395 * sc))
    pts = geo.dedupe(pts)
    # extrude along x; then mirror y so o points +y
    g = geo.extrude_profile_x([(o, z) for o, z in pts], -t / 2, t / 2)
    # recessed panel groove faces: a thin raised fillet on each side
    side = geo.extrude_profile_x([(o0 + 0.02, 0.12), (d - 0.12, h - 0.06), (o0 + 0.02, h - 0.06)], -t / 2 - 0.006, t / 2 + 0.006)
    g.add(side)
    drop = geo.lathe([(0.0, 0.0), (0.012, 0.004), (0.03, 0.03), (0.026, 0.06), (0.014, 0.075), (0.016, 0.09), (0.0, 0.095)], seg=12)
    drop = drop.xf(Matrix.Rotation(math.pi, 4, "X")).move(0, o0 + 0.05, 0.06)
    g.add(drop)
    return g


def dentils(path2, z, o0, size=(0.035, 0.04, 0.045), spacing=0.075, avoid=None):
    """Dentil blocks along an open polyline (outward = right of travel); `avoid(seg_index, s)` -> True
    skips a block (where a bracket stands)."""
    g = core.Geo()
    w, d, h = size
    P_ = [np.array(p, float) for p in path2]
    for i in range(len(P_) - 1):
        a, b = P_[i], P_[i + 1]
        L = float(np.linalg.norm(b - a))
        if L < spacing:
            continue
        t = (b - a) / L
        n = np.array([t[1], -t[0]])
        k = int((L - 0.1) / spacing)
        for j in range(k):
            s = 0.05 + (j + 0.5) * (L - 0.1) / k
            if avoid is not None and avoid(i, s):
                continue
            c = a + t * s
            pts = [c - t * w / 2 + n * o0, c + t * w / 2 + n * o0, c + t * w / 2 + n * (o0 + d), c - t * w / 2 + n * (o0 + d)]
            g.add(geo.prism(geo.ccw([tuple(q) for q in pts]), z - h, z))
    return g


def place_brackets(path2, z0, src, spacing=0.75, pair_gap=0.0, end_margin=0.35):
    """Brackets along an open polyline, perpendicular to each segment, plus one at each corner."""
    g = core.Geo()
    P_ = [np.array(p, float) for p in path2]
    for i in range(len(P_) - 1):
        a, b = P_[i], P_[i + 1]
        L = float(np.linalg.norm(b - a))
        if L < 2 * end_margin:
            continue
        t = (b - a) / L
        n = np.array([t[1], -t[0]])
        k = max(1, round((L - 2 * end_margin) / spacing))
        for j in range(k + 1):
            s = end_margin + j * (L - 2 * end_margin) / k
            c = a + t * s
            ang = math.atan2(n[1], n[0]) - math.pi / 2
            for off in ((-pair_gap / 2, pair_gap / 2) if pair_gap else (0.0,)):
                cc = c + t * off
                M = Matrix.Translation((cc[0], cc[1], z0)) @ Matrix.Rotation(ang, 4, "Z")
                g.add(src.xf(M))
    return g


def bracket_positions(path2, spacing, pair_gap, end_margin=0.35):
    out = {}
    P_ = [np.array(p, float) for p in path2]
    for i in range(len(P_) - 1):
        L = float(np.linalg.norm(P_[i + 1] - P_[i]))
        if L < 2 * end_margin:
            continue
        k = max(1, round((L - 2 * end_margin) / spacing))
        out[i] = [end_margin + j * (L - 2 * end_margin) / k + off for j in range(k + 1) for off in (-pair_gap / 2, pair_gap / 2)]
    return out


def frieze_panels(path2, z0, z1, o0, spacing=0.75, end_margin=0.35, gap=0.07):
    """Raised panels on the frieze between bracket positions."""
    from .windows import _raised_panel
    g = core.Geo()
    P_ = [np.array(p, float) for p in path2]
    for i in range(len(P_) - 1):
        a, b = P_[i], P_[i + 1]
        L = float(np.linalg.norm(b - a))
        if L < 2 * end_margin:
            continue
        t = (b - a) / L
        n = np.array([t[1], -t[0]])
        k = max(1, round((L - 2 * end_margin) / spacing))
        pos = [end_margin + j * (L - 2 * end_margin) / k for j in range(k + 1)]
        for j in range(k):
            s0, s1 = pos[j] + gap, pos[j + 1] - gap
            if s1 - s0 < 0.12:
                continue
            panel = _raised_panel(s0, s1, z0, z1, 0.0, 0.01)
            # local x along t, y along n
            M = Matrix(((t[0], n[0], 0, a[0] + n[0] * o0), (t[1], n[1], 0, a[1] + n[1] * o0), (0, 0, 1, 0), (0, 0, 0, 1)))
            g.add(panel.xf(M))
    return g


def extend(path, d_start=0.05, d_end=0.05):
    p = [np.array(q, float) for q in path]
    if d_start:
        t = p[1] - p[0]
        p[0] = p[0] - t / np.linalg.norm(t) * d_start
    if d_end:
        t = p[-1] - p[-2]
        p[-1] = p[-1] + t / np.linalg.norm(t) * d_end
    return [tuple(q) for q in p]


def cornice_run(name, path2, z0, prof, scale=1.0, brackets=True, spacing=0.8, ext=(0.05, 0.05), col=COL):
    pr = scale_prof(prof, scale, scale)
    path = extend(path2, *ext)
    g = geo.sweep(pr, [(x, y, z0) for x, y in path], up=(0, 0, 1), caps=True)
    core.obj(f"{name}_Moulding", g, col, "trim_paint", smooth=40)
    if brackets:
        bh = 0.48 * scale
        src = bracket_geo(h=bh, d=0.45 * scale, t=0.085 * scale, o0=0.035 * scale)
        bg = place_brackets(path2, z0 + 0.0, src, spacing=spacing, pair_gap=0.16 * scale)
        bo = core.obj(f"{name}_Brackets", bg, col, "trim_paint", smooth=35, clean=True)
        pg = frieze_panels(path2, z0 + 0.06 * scale, z0 + 0.34 * scale, 0.035 * scale, spacing=spacing,
                           gap=(0.16 / 2 + 0.085 / 2 + 0.03) * scale)
        core.obj(f"{name}_Panels", pg, col, "trim_paint", smooth=None)
        bpos = bracket_positions(path2, spacing, 0.16 * scale)
        half = 0.085 * scale / 2 + 0.03 * scale

        def avoid(i, s):
            return any(abs(s - b) < half for b in bpos.get(i, ()))
        dg = dentils(path2, z0 + 0.4 * scale, 0.035 * scale, size=(0.03 * scale, 0.035 * scale, 0.04 * scale), spacing=0.07 * scale,
                     avoid=avoid)
        core.obj(f"{name}_Dentils", dg, col, "trim_paint", smooth=None)


# ---------------------------------------------------------------- bays

BAY_COL_R = 0.055
BAY_CORNICE_S = 0.62


def bay_paths(bay, offset_into_wall=0.0):
    return [tuple(p) for p in bay]


def bay_roof(bay, z0, rise, proj):
    """A hipped bay roof: the bay outline grown by `proj`, planes rising inward to the wall."""
    chain = [np.array(p, float) for p in bay]
    # outward offset chain (open polyline, right side = outward for the bay's travel direction)
    off = geo.offset(geo.ccw(chain + [chain[-1] + (chain[-1] - chain[0]) * 0.0]), 0) if False else None
    p0, p1, p2, p3 = chain
    inward = np.array([0.0, 1.0]) if p1[1] < p0[1] else np.array([0.0, -1.0])
    # build the closed plan polygon: offset chain + two points back on the wall line
    ochain = geo.offset([tuple(q) for q in chain], proj, closed=False)
    wall_y = p0[1]
    a = np.array(ochain[0])
    b = np.array(ochain[-1])
    poly = [tuple(q) for q in ochain] + [(b[0], wall_y + inward[1] * 0.3), (a[0], wall_y + inward[1] * 0.3)]
    poly = geo.ccw(poly)
    g = geo.prism(poly, z0, z0 + rise + 0.6)
    me_obj = core.geo_obj(g, "_bayroof")
    bm = bmesh.new()
    bm.from_mesh(me_obj.data)
    pitch = math.atan2(rise, proj + np.linalg.norm(p1 - p0) * 0.7071)
    for i in range(3):
        e0 = np.array(ochain[i])
        e1 = np.array(ochain[i + 1])
        t = (e1 - e0) / np.linalg.norm(e1 - e0)
        n_out = np.array([t[1], -t[0]])
        if n_out @ (-inward) < 0:
            n_out = -n_out
        # plane through the eave edge, rising inward
        nrm = Vector((n_out[0] * math.sin(pitch), n_out[1] * math.sin(pitch), math.cos(pitch)))
        co = Vector((e0[0], e0[1], z0 + 0.06))
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=nrm, clear_outer=True)
        cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if cut:
            bmesh.ops.holes_fill(bm, edges=cut)
    bm.to_mesh(me_obj.data)
    bm.free()
    return me_obj


def build_bays():
    core.clear(f"{COL}/Bays")
    col = f"{COL}/Bays"
    for tag, bay in (("Front", P.BAY_FRONT), ("Back", P.BAY_BACK)):
        chain = [tuple(p) for p in bay]
        # G entablature: frieze + small crown between window heads and the belt
        hh = (P.L1 - P.G - 0.25) - P.WG_HEAD - 0.0     # up to the belt course
        g_prof = [(0.0, 0.0), (0.03, 0.0), (0.03, hh - 0.15), (0.045, hh - 0.14), (0.07, hh - 0.11), (0.085, hh - 0.08),
                  (0.1, hh - 0.06), (0.1, hh - 0.02), (0.03, hh), (0.0, hh)]
        zg = P.G + P.WG_HEAD
        g = geo.sweep(g_prof, [(x, y, zg) for x, y in chain], up=(0, 0, 1))
        core.obj(f"Bay{tag}_G_Entablature", g, col, "trim_paint", smooth=40)
        # L1 cornice with brackets, then the bay roof
        zl = P.L1 + 2.95
        bs = BAY_CORNICE_S
        cornice_run(f"Bay{tag}_L1_Cornice", chain, zl, MAIN_PROF, scale=bs, spacing=0.55, col=col, ext=(0.0, 0.0))
        top = zl + 1.05 * bs
        # a low hipped roof that meets the wall below the main frieze (TOP_MAIN)
        ro = bay_roof(bay, top, TOP_MAIN - 0.03 - top - 0.06, 0.41)
        # the roof stops on the cladding face of the wall it leans against
        wy = bay[0][1]
        cut = geo.box(-20.0, wy - 0.02, P.L1, 20.0, wy + 6.0, 20.0) if bay[1][1] < wy else geo.box(-20.0, wy - 6.0, P.L1, 20.0, wy + 0.02, 20.0)
        core.boolean(ro, [core.geo_obj(cut, "_wall")], op="DIFFERENCE")
        # slate the roof planes, keep the body
        planes, edges = roofs.roof_planes(ro)
        sg = core.Geo()
        for pts, nrm in planes:
            sg.add(roofs.skin_plane([tuple(p) for p in pts], nrm, top))
        core.obj(f"Bay{tag}_Roof_Slate", sg, col, "slate", smooth=None, weld=False)
        hips = core.Geo()
        for v0, v1, na, nb, convex in edges:
            if convex and abs(na.z - nb.z) < 0.2:
                hips.add(roofs.hip_roll(v0, v1, na, nb, r=0.018))
        core.obj(f"Bay{tag}_Roof_Hips", hips, col, "lead", smooth=40)
        ro.name = f"Bay{tag}_Roof_Body"
        for c in list(ro.users_collection):
            c.objects.unlink(ro)
        core.coll(col).objects.link(ro)
        from . import mat as M
        core.set_mats(ro, "lead")
        # colonettes at the two outer corners, both storeys
        cg = core.Geo()
        prof = [(0.0, 0.0), (0.062, 0.0), (0.062, 0.04), (0.054, 0.05), (0.058, 0.07), (0.048, 0.09),
                (0.044, 0.12)]
        for z0, z1 in ((WT_TOP, P.G + P.WG_HEAD), (BELT[1], P.L1 + 2.95)):
            h = z1 - z0
            pr = prof + [(0.04, h * 0.5), (0.044, h - 0.12), (0.048, h - 0.09), (0.058, h - 0.07), (0.054, h - 0.05),
                         (0.062, h - 0.04), (0.062, h - 0.003), (0.0, h - 0.003)]
            col_g = geo.lathe(pr, seg=20)
            for k in (1, 2):
                c = np.array(bay[k])
                # bisector outward
                a = np.array(bay[k - 1])
                b = np.array(bay[k + 1])
                bis = (c - a) / np.linalg.norm(c - a) + (c - b) / np.linalg.norm(c - b)
                bis /= np.linalg.norm(bis)
                cc = c + bis * 0.065
                cg.add(col_g.move(cc[0], cc[1], z0))
        core.obj(f"Bay{tag}_Colonettes", cg, col, "trim_paint", smooth=35)
        # apron panels below the sills on each face (both storeys)
        from .windows import _raised_panel
        pg = core.Geo()
        for z0, z1 in ((WT_TOP + 0.02, P.G + 0.6 - 0.2), (BELT[1] + 0.02, P.L1 + 0.65 - 0.2)):
            for i in range(3):
                a = np.array(bay[i], float)
                b = np.array(bay[i + 1], float)
                L = float(np.linalg.norm(b - a))
                t = (b - a) / L
                n = np.array([t[1], -t[0]])
                M = Matrix(((t[0], n[0], 0, a[0]), (t[1], n[1], 0, a[1]), (0, 0, 1, 0), (0, 0, 0, 1)))
                x0, x1 = 0.09, L - 0.09
                bd = geo.box(x0 - 0.03, 0.0, z0, x1 + 0.03, 0.03, z1)
                pg.add(bd.xf(M))
                pg.add(_raised_panel(x0 + 0.03, x1 - 0.03, z0 + 0.04, z1 - 0.04, 0.03, 0.014).xf(M))
        core.obj(f"Bay{tag}_Aprons", pg, col, "trim_paint", smooth=None)


def build():
    core.clear(f"{COL}/Main")
    col = f"{COL}/Main"
    tur_l = (P.TURRET[0] - math.sqrt(P.TR ** 2 - P.TURRET[1] ** 2), 0.0)
    yr = P.TURRET[1] + math.sqrt(P.TR ** 2 - (P.M[2] - P.TURRET[0]) ** 2)
    runs = [
        ("Cornice_Front", [(-2.15, P.C[1]), (P.C[2], P.C[1]), (P.C[2], 0.0), (tur_l[0] + 0.15, 0.0)], (0.0, 0.0)),
        ("Cornice_Back", [(P.M[2], P.E[3] + 0.55), (P.M[2], P.M[3]), (P.M[0], P.M[3]), (P.M[0], P.CHIMNEY_EXT[3] + 0.06)], (0.0, 0.0)),
        ("Cornice_Left", [(P.M[0], P.B[1] - 0.55), (P.M[0], P.C[1]), (P.C[0] + 0.55, P.C[1])], (0.0, 0.0)),
    ]
    for name, path, ext in runs:
        cornice_run(name, path, TOP_MAIN, MAIN_PROF, ext=ext)
    # wings
    core.clear(f"{COL}/Wings")
    s = (P.WING_ROOF_BASE - TOP_WING) / 1.05 if hasattr(P, "WING_ROOF_BASE") else 0.62
    s = (roofs.WING_ROOF_BASE - TOP_WING) / 1.05
    cornice_run("Cornice_B", [(P.B[2], P.B[3]), (P.B[0], P.B[3]), (P.B[0], P.B[1]), (P.B[2], P.B[1])],
                TOP_WING, MAIN_PROF, scale=s, spacing=0.65, ext=(0.06, 0.06), col=f"{COL}/Wings")
    cornice_run("Cornice_E", [(P.E[0], P.E[1]), (P.E[2], P.E[1]), (P.E[2], P.E[3]), (P.E[0], P.E[3])],
                TOP_WING, MAIN_PROF, scale=s, spacing=0.65, ext=(0.06, 0.06), col=f"{COL}/Wings")
    build_bays()
    core.finish_tmp()
