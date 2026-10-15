"""Roof coverings: slate courses on every pitched plane, hip rolls, mansard curb, ridges, decks.

The roof envelope is a CSG union of the roof masses (main mansard, cross gable with its front
overhang, dormers, wings). Its pitched faces are merged per plane, bisected at the course lines
and each course becomes a thin wedge solid (thick at the butt, thin at the head), so the slate
steps are real geometry. Slate joints and colour variation come from the material (UVs: U along
the course, V up the slope, metres), aligned to the same course lines.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import core, geo
from . import plan as P
from . import shell

COL = "House/Exterior/Roofs"
EXPO = 0.165          # slate course exposure (matches the slate material's row height)
T_BUTT = 0.017
T_HEAD = 0.005


# ---------------------------------------------------------------- envelopes for roofs

GABLE_OVERHANG = 0.42


def c_roof_prism():
    x0, y0, x1, y1 = P.C
    tri = [(x0, P.CORNICE_TOP), (x1, P.CORNICE_TOP), ((x0 + x1) / 2, P.GABLE_RIDGE)]
    return geo.extrude_profile_y(tri, y0 - GABLE_OVERHANG, shell.GABLE_BACK)


DORMER_OVER = 0.2      # dormer roof overhang at the front
DORMER_EAVE_OVER = 0.12


def dormer_roof_prism(d):
    o, n, t = shell.dormer_frame(d)
    hw = shell.DORMER_W / 2 + DORMER_EAVE_OVER
    pitch = math.atan2(shell.DORMER_RIDGE - shell.DORMER_EAVE, shell.DORMER_W / 2)
    ze = shell.DORMER_EAVE - DORMER_EAVE_OVER * math.tan(pitch)
    prof = [(-hw, ze), (hw, ze), (0.0, shell.DORMER_RIDGE)]
    g = geo.extrude_profile_y(prof, P.DORMER_SET - DORMER_OVER, shell.DORMER_DEPTH)
    M = Matrix(((t[0], -n[0], 0, o[0]), (t[1], -n[1], 0, o[1]), (0, 0, 1, 0), (0, 0, 0, 1)))
    return g.xf(M)


# wings ------------------------------------------------------------------------------------
WING_ROOF_BASE = 9.6
WING_BREAK = 11.0
WING_LOWER = math.radians(70)
WING_UPPER = math.radians(20)
WING_TOP = 11.5


def wing_roof(box_, attach_side):
    """Hipped mansard on a wing; the side attached to the main block runs into the main roof."""
    x0, y0, x1, y1 = box_
    d1 = (WING_BREAK - WING_ROOF_BASE) / math.tan(WING_LOWER)
    d2 = d1 + (WING_TOP - WING_BREAK) / math.tan(WING_UPPER)
    ext = 1.2
    if attach_side == "right":
        x1e = x1 + ext
    else:
        x0e = x0 - ext
    rings = []
    for z, d in ((P.EAVE_WING, 0.0), (WING_ROOF_BASE, 0.0), (WING_BREAK, d1), (WING_TOP, d2)):
        if attach_side == "right":
            rings.append([(x0 + d, y0 + d, z), (x1e, y0 + d, z), (x1e, y1 - d, z), (x0 + d, y1 - d, z)])
        else:
            rings.append([(x0e, y0 + d, z), (x1 - d, y0 + d, z), (x1 - d, y1 - d, z), (x0e, y1 - d, z)])
    return geo.loft(rings)


# ---------------------------------------------------------------- slate skin

def plane_basis(n):
    n = Vector(n).normalized()
    up = Vector((0, 0, 1))
    u = (up - n * up.dot(n))
    if u.length < 1e-6:
        u = Vector((0, 1, 0))
    u.normalize()            # up-slope direction
    a = u.cross(n)           # along the course (horizontal)
    a.normalize()
    return n, u, a


def slate_faces(bm_faces, z_ref, collect, expo=EXPO, t1=T_BUTT, t0=T_HEAD):
    """Course wedges for a list of planar bmesh faces (one plane). Adds to Geo `collect`."""
    pass


def skin_plane(poly3, normal, z_ref, expo=EXPO, t1=T_BUTT, t0=T_HEAD, under=0.0):
    """Slate courses over one planar polygon (3D points). Returns Geo with UVs."""
    n, u, a = plane_basis(normal)
    sin_p = math.sqrt(max(1e-9, 1 - n.z * n.z))
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in poly3]
    try:
        bm.faces.new(vs)
    except ValueError:
        bm.free()
        return core.Geo()
    bm.normal_update()
    # s(p) = (z - z_ref) / sin_p  (distance up the slope from the reference eave line)
    zs = [p[2] for p in poly3]
    s_min = (min(zs) - z_ref) / sin_p
    s_max = (max(zs) - z_ref) / sin_p
    k0 = math.floor(s_min / expo)
    k1 = math.ceil(s_max / expo)
    p_ref = Vector(poly3[0])
    for k in range(k0 + 1, k1):
        s = k * expo
        z = z_ref + s * sin_p
        # a point on the plane at that height
        # move from p_ref along u to reach height z
        co = p_ref + u * ((z - p_ref.z) / max(1e-9, u.z))
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=u, dist=1e-6)
    out = core.Geo()
    for f in bm.faces:
        pts = [v.co.copy() for v in f.verts]
        if f.normal.dot(n) < 0:
            pts = pts[::-1]
        if len(pts) < 3:
            continue
        sc = sum(((p.z - z_ref) / sin_p) for p in pts) / len(pts)
        k = math.floor(sc / expo)
        s_lo = k * expo
        V = []
        for p in pts:
            s = (p.z - z_ref) / sin_p
            frac = min(1.0, max(0.0, (s - s_lo) / expo))
            t = t1 + (t0 - t1) * frac
            V.append(p + n * under)
        top = []
        for p in pts:
            s = (p.z - z_ref) / sin_p
            frac = min(1.0, max(0.0, (s - s_lo) / expo))
            t = t1 + (t0 - t1) * frac
            top.append(p + n * (under + t))
        m = len(pts)
        Vall = np.array([tuple(v) for v in V] + [tuple(v) for v in top])
        F = [list(range(m))[::-1], [m + i for i in range(m)]]
        for i in range(m):
            j = (i + 1) % m
            F.append([i, j, m + j, m + i])
        UV = []
        def uvp(p):
            return (float(p.dot(a)), float((p.z - z_ref) / sin_p))
        UV.append([uvp(pts[i]) for i in range(m)][::-1])
        UV.append([uvp(pts[i]) for i in range(m)])
        for i in range(m):
            j = (i + 1) % m
            UV.append([uvp(pts[i]), uvp(pts[j]), (uvp(pts[j])[0], uvp(pts[j])[1] + 0.02), (uvp(pts[i])[0], uvp(pts[i])[1] + 0.02)])
        out.add(core.Geo(Vall, F, UV))
    bm.free()
    return out


def roof_planes(o, nz_min=0.12, nz_max=0.995):
    """Merge the pitched faces of a mesh object into planar n-gons. Returns [(pts, normal)]."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.transform(o.matrix_world)
    bm.normal_update()
    kill = [f for f in bm.faces if not (nz_min < f.normal.z < nz_max)]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=bm.verts[:], edges=bm.edges[:],
                             delimit={"NORMAL"})
    bm.normal_update()
    out = []
    for f in bm.faces:
        out.append(([v.co.copy() for v in f.verts], f.normal.copy()))
    # edges for trims: (v0, v1, n_a, n_b, convex)
    edges = []
    for e in bm.edges:
        if len(e.link_faces) == 2:
            fa, fb = e.link_faces
            # convex when face b's centre lies below face a's plane
            convex = (fb.calc_center_median() - e.verts[0].co).dot(fa.normal) < -1e-4
            edges.append((e.verts[0].co.copy(), e.verts[1].co.copy(), fa.normal.copy(), fb.normal.copy(), convex))
    bm.free()
    return out, edges


def skin_object(name, env_obj, z_refs, col=COL, mat="slate"):
    """Slate every pitched plane of env_obj. z_refs: function(normal, pts) -> reference eave z."""
    planes, edges = roof_planes(env_obj)
    g = core.Geo()
    for pts, nrm in planes:
        zr = z_refs(nrm, pts)
        g.add(skin_plane([tuple(p) for p in pts], nrm, zr))
    o = core.obj(name, g, col, mat, smooth=None, weld=False)
    return o, planes, edges


# ---------------------------------------------------------------- trims on roof edges

def hip_roll(v0, v1, na, nb, r=0.022, lift=T_BUTT):
    m = (na + nb).normalized()
    off = m * (lift + r * 0.4)
    p0, p1 = v0 + off, v1 + off
    d = (p1 - p0)
    if d.length < 0.05:
        return core.Geo()
    dn = d.normalized()
    p0, p1 = p0 + dn * 0.006, p1 - dn * 0.006
    g = geo.tube([tuple(p0), tuple(p1)], r, seg=10)
    return g


def ridge_roll(v0, v1, na, nb):
    """Ridge: a lead-capped wood roll on a ridge board."""
    m = (na + nb).normalized()
    g = core.Geo()
    g.add(hip_roll(v0, v1, na, nb, r=0.03, lift=T_BUTT + 0.01))
    return g


def curb(v0, v1, n_lower, profile):
    """Moulded curb along a horizontal mansard break edge; profile (o, h) with o outward."""
    out = Vector((n_lower.x, n_lower.y, 0)).normalized()
    d = (v1 - v0)
    d.z = 0
    if d.length < 0.05:
        return core.Geo()
    d.normalize()
    # orient travel so that right (d x up) == outward
    if d.cross(Vector((0, 0, 1))).dot(out) < 0:
        v0, v1 = v1, v0
    return geo.sweep(profile, [tuple(v0), tuple(v1)], up=(0, 0, 1))


CURB_PROF = [(-0.08, -0.06), (0.03, -0.06), (0.045, -0.04), (0.05, -0.015), (0.075, 0.0), (0.09, 0.02),
             (0.09, 0.045), (0.02, 0.06), (-0.08, 0.06)]


def build_main():
    core.clear(f"{COL}/Main")
    env = core.geo_obj(shell.mansard_outer(), "_renv")
    parts = [core.geo_obj(c_roof_prism(), "_rc")] + [core.geo_obj(dormer_roof_prism(d), "_rd") for d in P.DORMERS]
    parts += [core.geo_obj(shell.dormer_solid(d), "_rds") for d in P.DORMERS]
    core.boolean(env, parts, op="UNION")
    # remove the turret's and the wings' volumes so no slates run under them
    ring = geo.lathe([(0.0, 12.45), (P.TR2 + 0.47, 12.45), (P.TR2 + 0.47, P.TURRET_TOP + 0.5), (0.0, P.TURRET_TOP + 0.5)],
                     seg=96).move(P.TURRET[0], P.TURRET[1], 0)
    core.boolean(env, [core.geo_obj(shell.turret_outer(), "_rt"), core.geo_obj(ring, "_rr"), core.geo_obj(wing_roof(P.B, "right"), "_rwb"),
                       core.geo_obj(wing_roof(P.E, "left"), "_rwe")], op="DIFFERENCE")
    lower_sin = math.sin(P.MANSARD_LOWER)

    def zref(nrm, pts):
        nz = nrm.z
        if abs(nz - math.cos(P.MANSARD_LOWER)) < 0.02:
            return P.CORNICE_TOP
        if abs(nz - math.cos(P.MANSARD_UPPER)) < 0.02:
            return P.MANSARD_BREAK
        return min(p.z for p in pts)

    o, planes, edges = skin_object("Roof_Main_Slate", env, zref, col=f"{COL}/Main")
    trims = core.Geo()
    curbs = core.Geo()
    for v0, v1, na, nb, convex in edges:
        if not convex:
            continue
        horiz = abs(v0.z - v1.z) < 1e-3
        if horiz and abs(na.z - nb.z) > 0.2:
            lower = na if na.z < nb.z else nb
            curbs.add(curb(v0, v1, lower, CURB_PROF).move(0, 0, 0))
        else:
            trims.add(hip_roll(v0, v1, na, nb))
    core.obj("Roof_Main_Hips", trims, f"{COL}/Main", "lead", smooth=40)
    co = core.obj("Roof_Main_Curb", curbs, f"{COL}/Main", "trim_paint", smooth=40, clean=True)
    # deck: lead flat with a low parapet curb
    x0, y0, x1, y1 = P.M
    d2 = (P.MANSARD_BREAK - P.CORNICE_TOP) / math.tan(P.MANSARD_LOWER) + (P.DECK - P.MANSARD_BREAK) / math.tan(P.MANSARD_UPPER)
    deck = geo.box(x0 + d2 - 0.02, y0 + d2 - 0.02, P.DECK, x1 - d2 + 0.02, y1 - d2 + 0.02, P.DECK + 0.03)
    core.obj("Roof_Main_Deck", deck, f"{COL}/Main", "lead", smooth=None)
    core.remove(env)
    core.finish_tmp()


def build_wings():
    core.clear(f"{COL}/Wings")
    mo = core.geo_obj(shell.mansard_outer(), "_mo")
    for nm, bx, side in (("B", P.B, "right"), ("E", P.E, "left")):
        env = core.geo_obj(wing_roof(bx, side), f"_w{nm}")
        core.boolean(env, [core.dup(mo)], op="DIFFERENCE")

        def zref(nrm, pts):
            nz = nrm.z
            if abs(nz - math.cos(WING_LOWER)) < 0.02:
                return WING_ROOF_BASE
            return WING_BREAK

        o, planes, edges = skin_object(f"Roof_{nm}_Slate", env, zref, col=f"{COL}/Wings")
        trims, curbs = core.Geo(), core.Geo()
        for v0, v1, na, nb, convex in edges:
            if not convex:
                continue
            horiz = abs(v0.z - v1.z) < 1e-3
            if horiz and abs(na.z - nb.z) > 0.2:
                lower = na if na.z < nb.z else nb
                curbs.add(curb(v0, v1, lower, CURB_PROF))
            else:
                trims.add(hip_roll(v0, v1, na, nb))
        core.obj(f"Roof_{nm}_Hips", trims, f"{COL}/Wings", "lead", smooth=40)
        core.obj(f"Roof_{nm}_Curb", curbs, f"{COL}/Wings", "trim_paint", smooth=40, clean=True)
        # flat top
        bm = bmesh.new()
        bm.from_mesh(env.data)
        tops = [f for f in bm.faces if f.normal.z > 0.999 and f.calc_center_median().z > WING_TOP - 0.01]
        g = core.Geo()
        for f in tops:
            pts = [tuple(v.co) for v in f.verts]
            g.add(geo.prism([(p[0], p[1]) for p in pts], WING_TOP, WING_TOP + 0.025))
        bm.free()
        core.obj(f"Roof_{nm}_Deck", g, f"{COL}/Wings", "lead", smooth=None)
        # keep the envelope as the roof's (hidden) body so the slate sits on something solid
        env.name = f"Roof_{nm}_Body"
        for c in list(env.users_collection):
            c.objects.unlink(env)
        core.coll(f"{COL}/Wings").objects.link(env)
        core.set_mats(env, "sheathing")
    core.remove(mo)
    core.finish_tmp()


def build():
    build_main()
    build_wings()
