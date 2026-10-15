"""Turret top: belt ring, fish-scale shingled upper stage, bracketed ring cornice, bell-cast slate
cone and finial. Everything that would run inside the main mansard is cut away by it.
"""
import math

import numpy as np
from mathutils import Matrix

from . import core, geo
from . import plan as P
from . import shell, siding, gables, cornice

COL = "House/Exterior/Turret"
BELT_Z = (siding.TOP_MAIN, siding.TOP_MAIN + 0.42)
CORNICE_Z = 12.55
CORNICE_S = (P.TURRET_TOP - CORNICE_Z) / 1.05
FLARE = 0.44


def warp(g, R, z0=0.0):
    cx, cy = P.TURRET
    V = g.V.copy()
    phi = V[:, 0] / R
    r = R + V[:, 1]
    out = np.stack([cx + r * np.cos(phi), cy + r * np.sin(phi), V[:, 2] + z0], 1)
    return core.Geo(out, g.F, g.UV, list(g.M))


def circle_path(r, z, n=96):
    cx, cy = P.TURRET
    return [(cx + r * math.cos(math.tau * i / n), cy + r * math.sin(math.tau * i / n), z) for i in range(n)]


def cone_r(z):
    return shell.cone_outer_r(z)


def roof_r(z):
    f = max(0.0, 1.0 - (z - P.TURRET_TOP) / 1.2)
    return cone_r(z) + FLARE * f * f


def cone_profile(expo=0.16, t1=0.018, t0=0.005, z_stop=19.05):
    # sample the flared roof line by arc length
    zs = np.linspace(P.TURRET_TOP, z_stop, 600)
    rs = np.array([roof_r(z) for z in zs])
    seg = np.hypot(np.diff(rs), np.diff(zs))
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    outer = []
    n = int(L / expo)
    for k in range(n + 1):
        for frac, t in ((0.0, t1), (0.999, t0)):
            sk = min(L, (k + frac) * expo)
            z = float(np.interp(sk, s, zs))
            r = float(np.interp(sk, s, rs))
            # outward normal of the roof line (in r,z): (dz, -dr) normalised
            i = min(len(zs) - 2, int(np.searchsorted(s, sk)))
            dr, dz = rs[i + 1] - rs[i], zs[i + 1] - zs[i]
            nl = math.hypot(dr, dz)
            nr, nz = dz / nl, -dr / nl
            outer.append((r + nr * t, z + nz * t))
    outer = [(roof_r(P.TURRET_TOP) + 0.0, P.TURRET_TOP)] + outer
    top = outer[-1]
    inner = [(cone_r(z_stop) * 0.98, z_stop), (cone_r(P.TURRET_TOP), P.TURRET_TOP)]
    prof = outer + [(0.0, top[1])][:0] + inner
    return geo.dedupe(prof)


def build():
    core.clear(COL)
    cx, cy = P.TURRET
    R = P.TR2
    mo = core.geo_obj(shell.mansard_outer(), "_mo")
    # belt ring
    belt = [(0.0, 0.0), (0.035, 0.0), (0.035, 0.3), (0.05, 0.31), (0.07, 0.34), (0.085, 0.38), (0.09, 0.42), (0.0, 0.42)]
    g = geo.sweep(belt, circle_path(R, BELT_Z[0]), closed=True, up=(0, 0, 1))
    o = core.obj("Turret_Belt", g, COL, "trim_paint", smooth=40)
    core.boolean(o, [core.dup(mo)], op="DIFFERENCE")
    # fish-scale shingles, wrapped round the cylinder, cut round the windows and the mansard
    circ = math.tau * R
    sh = gables.fishscale_rows(0.0, circ, BELT_Z[1] + 0.01, CORNICE_Z + 0.05)
    sw = warp(sh, R)
    so = core.obj("Turret_Shingles", sw, COL, "shingle_paint", smooth=None, weld=False)
    cut = [core.geo_obj(shell.mansard_outer(grow=0.021), "_mog"),
           core.geo_obj(geo.lathe([(0.0, CORNICE_Z), (R + 0.2, CORNICE_Z), (R + 0.2, P.TURRET_TOP + 1), (0.0, P.TURRET_TOP + 1)],
                                  seg=96).move(cx, cy, 0), "_top")]
    for op in P.openings(2, ext=True):
        if op["name"].startswith("L2_Turret"):
            cut.append(core.geo_obj(siding.trim_cutter(op, depth=0.2), "_tc"))
    core.boolean(so, cut, op="DIFFERENCE")
    # cornice ring with radial brackets
    path = circle_path(R, CORNICE_Z)
    pr = cornice.scale_prof(cornice.MAIN_PROF, CORNICE_S, CORNICE_S)
    g = geo.sweep(pr, path, closed=True, up=(0, 0, 1))
    o = core.obj("Turret_Cornice", g, COL, "trim_paint", smooth=40)
    core.boolean(o, [core.dup(mo)], op="DIFFERENCE")
    src = cornice.bracket_geo(h=0.48 * CORNICE_S, d=0.45 * CORNICE_S, t=0.085 * CORNICE_S, o0=0.035 * CORNICE_S)
    bg = core.Geo()
    n = int(circ / 0.62)
    for i in range(n):
        a = math.tau * (i + 0.5) / n
        px, py = cx + R * math.cos(a), cy + R * math.sin(a)
        # skip brackets that would sit inside the mansard
        if (P.M[0] < px < P.M[2] and 0.3 < py < P.M[3]):
            continue
        M = Matrix.Translation((px, py, CORNICE_Z + 0.02 * CORNICE_S)) @ Matrix.Rotation(a - math.pi / 2, 4, "Z")
        bg.add(src.xf(M))
    bo = core.obj("Turret_Brackets", bg, COL, "trim_paint", smooth=35)
    core.boolean(bo, [core.dup(mo)], op="DIFFERENCE")
    # slate cone with a bell-cast flare
    prof = cone_profile()
    cg = geo.lathe(prof, seg=128, local_u=True, closed=True).move(cx, cy, 0)
    core.obj("Turret_Cone_Slate", cg, COL, "slate", smooth=None)
    # flare soffit ring under the kick (closes the eave over the cornice)
    sp = [(R + 0.42, P.TURRET_TOP - 0.035), (roof_r(P.TURRET_TOP) + 0.02, P.TURRET_TOP - 0.035),
          (roof_r(P.TURRET_TOP) + 0.02, P.TURRET_TOP - 0.003), (R + 0.42, P.TURRET_TOP - 0.003)]
    core.obj("Turret_Eave", geo.lathe(sp, seg=128, closed=True).move(cx, cy, 0), COL, "lead", smooth=40)
    # finial: collar, turned shaft, ball and gilt spike
    z0 = 19.0
    fin = [(0.0, 0.0), (0.2, 0.0), (0.21, 0.04), (0.17, 0.08), (0.12, 0.1), (0.1, 0.18), (0.14, 0.26), (0.15, 0.32),
           (0.1, 0.38), (0.07, 0.42), (0.065, 0.6), (0.1, 0.66), (0.1, 0.7), (0.06, 0.74), (0.06, 0.82)]
    for k in range(13):
        a = math.pi * k / 12
        fin.append((0.03 + 0.13 * math.sin(a), 0.82 + 0.13 * (1 - math.cos(a))))
    fin += [(0.045, 1.1), (0.0, 1.11)]
    core.obj("Turret_Finial", geo.lathe(geo.dedupe(fin, closed=False), seg=32).move(cx, cy, z0), COL, "copper", smooth=35)
    spike = [(0.0, 0.0), (0.04, 0.0), (0.035, 0.1), (0.02, 0.4), (0.008, 0.85), (0.0, 0.95)]
    core.obj("Turret_Spike", geo.lathe(spike, seg=16).move(cx, cy, z0 + 1.1), COL, "gilt", smooth=35)
    import bpy
    for n, rr in (("Cornice_Front_Moulding", 0.095), ("Cornice_Front_Dentils", 0.11), ("Cornice_Front_Panels", 0.115),
                  ("Cornice_Front_Brackets", 0.12)):
        ob = bpy.data.objects.get(n)
        if ob is not None:
            cyl = geo.lathe([(0.0, 8.0), (R + rr, 8.0), (R + rr, 11.0), (0.0, 11.0)], seg=96).move(cx, cy, 0)
            core.boolean(ob, [core.geo_obj(cyl, "_tc")], op="DIFFERENCE")
    hips = bpy.data.objects.get("Roof_Main_Hips")
    if hips is not None:
        cone = geo.lathe([(0.0, 12.0), (P.TR2 + 0.5, 12.0), (P.TR2 + 0.5, P.TURRET_TOP), (cone_r(17.0) + 0.05, 17.0), (0.0, 17.0)],
                         seg=96).move(cx, cy, 0)
        core.boolean(hips, [core.geo_obj(cone, "_hc")], op="DIFFERENCE")
    core.remove(mo)
    core.finish_tmp()
