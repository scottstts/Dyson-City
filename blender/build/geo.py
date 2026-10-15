"""Geometry generators returning core.Geo (with UVs in metres).

Conventions
- 2D polygons are lists of (x, y), counter-clockwise seen from above unless stated.
- sweep(): profile points are (o, h): o along the path's right-hand side (outward for a CCW
  plan loop), h along the local up. A closed profile must be counter-clockwise in (o, h).
- lathe(): profile points are (r, z), listed bottom to top for an outward-facing surface.
"""
import math

import numpy as np

from .core import Geo

TAU = math.tau


# ---------------------------------------------------------------- 2D polygons

def arc(cx, cy, r, a0, a1, n=None, step=math.radians(6)):
    if n is None:
        n = max(2, int(math.ceil(abs(a1 - a0) / step)))
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def area(poly):
    p = np.asarray(poly)
    x, y = p[:, 0], p[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def ccw(poly):
    return list(poly) if area(poly) > 0 else list(reversed(poly))


def dedupe(poly, eps=1e-6, closed=True):
    out = []
    for p in poly:
        if not out or math.dist(out[-1], p) > eps:
            out.append(tuple(p))
    if closed and len(out) > 1 and math.dist(out[0], out[-1]) <= eps:
        out.pop()
    return out


def offset(poly, d, closed=True):
    """Mitred offset; positive d grows a CCW polygon outward."""
    p = np.asarray(poly, dtype=float)
    n = len(p)
    out = []
    for i in range(n):
        if not closed and i == 0:
            t = p[1] - p[0]
            t /= np.linalg.norm(t)
            out.append(tuple(p[0] + d * np.array([t[1], -t[0]])))
            continue
        if not closed and i == n - 1:
            t = p[-1] - p[-2]
            t /= np.linalg.norm(t)
            out.append(tuple(p[-1] + d * np.array([t[1], -t[0]])))
            continue
        a, b, c = p[i - 1], p[i], p[(i + 1) % n]
        t0 = (b - a) / np.linalg.norm(b - a)
        t1 = (c - b) / np.linalg.norm(c - b)
        n0 = np.array([t0[1], -t0[0]])
        n1 = np.array([t1[1], -t1[0]])
        m = n0 + n1
        ml = np.linalg.norm(m)
        if ml < 1e-9:
            m = n0
        else:
            m = m / ml
            m = m / max(0.2, float(np.dot(m, n0)))
        out.append(tuple(b + d * m))
    return out


def fillet(poly, r, n=6, closed=True, only=None):
    """Round polygon corners with radius r (only: optional set of corner indices)."""
    p = [np.array(q, float) for q in poly]
    m = len(p)
    out = []
    for i in range(m):
        if (not closed and (i == 0 or i == m - 1)) or (only is not None and i not in only):
            out.append(tuple(p[i]))
            continue
        a, b, c = p[i - 1], p[i], p[(i + 1) % m]
        u = (a - b) / np.linalg.norm(a - b)
        v = (c - b) / np.linalg.norm(c - b)
        ang = math.acos(max(-1, min(1, float(np.dot(u, v)))))
        if ang > math.pi - 1e-3:
            out.append(tuple(b))
            continue
        tlen = r / math.tan(ang / 2)
        p0 = b + u * tlen
        p1 = b + v * tlen
        bis = (u + v) / np.linalg.norm(u + v)
        cen = b + bis * (r / math.sin(ang / 2))
        a0 = math.atan2(*(p0 - cen)[::-1])
        a1 = math.atan2(*(p1 - cen)[::-1])
        da = (a1 - a0 + math.pi) % TAU - math.pi
        for k in range(n + 1):
            t = a0 + da * k / n
            out.append((cen[0] + r * math.cos(t), cen[1] + r * math.sin(t)))
    return out


def path_len(path):
    p = np.asarray(path, float)
    return float(np.sum(np.linalg.norm(np.diff(p, axis=0), axis=1)))


def resample(path2, n):
    p = np.asarray(path2, float)
    seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, p[:, k]) for k in range(p.shape[1])], 1)


# ---------------------------------------------------------------- solids

def prism(poly, z0, z1, caps=True, top=True, bottom=True):
    poly = ccw(dedupe(poly))
    n = len(poly)
    P = np.array(poly, float)
    V = np.vstack([np.c_[P, np.full(n, z0)], np.c_[P, np.full(n, z1)]])
    F, UV = [], []
    acc = 0.0
    for i in range(n):
        j = (i + 1) % n
        L = float(np.linalg.norm(P[j] - P[i]))
        F.append([i, j, n + j, n + i])
        UV.append([(acc, z0), (acc + L, z0), (acc + L, z1), (acc, z1)])
        acc += L
    if caps and bottom:
        F.append(list(range(n))[::-1])
        UV.append([(x, -y) for x, y in P[::-1]])
    if caps and top:
        F.append([n + i for i in range(n)])
        UV.append([(x, y) for x, y in P])
    return Geo(V, F, UV)


def box(x0, y0, z0, x1, y1, z1):
    return prism(rect(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)), min(z0, z1), max(z0, z1))


def cbox(cx, cy, cz, sx, sy, sz):
    return box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2)


def sweep(profile, path, closed=False, up=(0, 0, 1), right=None, caps=True, profile_closed=True, u0=0.0, scale_fn=None):
    """Sweep a 2D profile along a 3D polyline with mitred joints.

    up: fixed reference up (local right = tangent x up), or
    right: fixed right vector (local up = right x tangent), e.g. a rake moulding in a gable plane.
    scale_fn(i) -> (so, sh): optional per-path-vertex scale of the profile.
    """
    P = np.asarray(path, float)
    if P.shape[1] == 2:
        P = np.c_[P, np.zeros(len(P))]
    n = len(P)
    prof = np.asarray(profile, float)
    m = len(prof)
    segs = (np.roll(P, -1, 0) - P) if closed else (P[1:] - P[:-1])
    T = segs / np.linalg.norm(segs, axis=1)[:, None]
    if right is None:
        R = np.cross(T, np.asarray(up, float))
        nr = np.linalg.norm(R, axis=1)
        for i in range(len(R)):
            if nr[i] < 1e-6:
                # tangent parallel to `up`: borrow a neighbour's side vector, else any perpendicular
                j = next((k for k in list(range(i - 1, -1, -1)) + list(range(i + 1, len(R))) if nr[k] >= 1e-6), None)
                R[i] = R[j] / nr[j] if j is not None else np.cross(T[i], [1.0, 0.0, 0.0] if abs(T[i][0]) < 0.9 else [0.0, 1.0, 0.0])
                R[i] -= T[i] * float(R[i] @ T[i])
                nr[i] = np.linalg.norm(R[i])
        R /= nr[:, None]
        U = np.cross(R, T)
    else:
        R = np.tile(np.asarray(right, float), (len(T), 1))
        U = np.cross(R, T)
        U /= np.linalg.norm(U, axis=1)[:, None]
    Rm = np.zeros((n, 3))
    Um = np.zeros((n, 3))
    for i in range(n):
        if closed:
            a, b = (i - 1) % n, i
        else:
            a, b = max(i - 1, 0), min(i, n - 2)
        for src, dst in ((R, Rm), (U, Um)):
            v = src[a] + src[b]
            vl = np.linalg.norm(v)
            if vl < 1e-9:
                dst[i] = src[b]
                continue
            v /= vl
            dst[i] = v / max(0.25, float(np.dot(v, src[b])))
    rings = []
    for i in range(n):
        so, sh = scale_fn(i) if scale_fn else (1.0, 1.0)
        rings.append(P[i] + np.outer(prof[:, 0] * so, Rm[i]) + np.outer(prof[:, 1] * sh, Um[i]))
    V = np.vstack(rings)
    # uv
    plen = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.vstack([prof, prof[:1]]) if profile_closed else prof, axis=0), axis=1))])
    slen = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.vstack([P, P[:1]]) if closed else P, axis=0), axis=1))]) + u0
    F, UV = [], []
    nseg = n if closed else n - 1
    pseg = m if profile_closed else m - 1
    for i in range(nseg):
        i1 = (i + 1) % n
        for j in range(pseg):
            j1 = (j + 1) % m
            F.append([i * m + j, i1 * m + j, i1 * m + j1, i * m + j1])
            UV.append([(slen[i], plen[j]), (slen[i + 1], plen[j]), (slen[i + 1], plen[j + 1]), (slen[i], plen[j + 1])])
    if caps and not closed and profile_closed:
        F.append(list(range(m)))
        UV.append([tuple(q) for q in prof])
        F.append([(n - 1) * m + j for j in range(m)][::-1])
        UV.append([tuple(q) for q in prof[::-1]])
    return Geo(V, F, UV)


def lathe(profile, seg=32, a0=0.0, a1=TAU, caps=True, flip=False, local_u=False, closed=False):
    """Revolve (r, z) profile about Z. Points with r==0 collapse to the axis.
    closed: the profile is a closed loop (last point joins the first), giving a solid ring."""
    prof = np.asarray(list(profile), float)
    if closed and np.allclose(prof[0], prof[-1]):
        prof = prof[:-1]
    full = abs(a1 - a0 - TAU) < 1e-9
    na = seg if full else seg + 1
    angs = a0 + (a1 - a0) * np.arange(na) / seg
    V = []
    idx = []
    for r, z in prof:
        if r < 1e-7:
            idx.append([len(V)] * na)
            V.append((0.0, 0.0, z))
        else:
            row = []
            for a in angs:
                row.append(len(V))
                V.append((r * math.cos(a), r * math.sin(a), z))
            idx.append(row)
    loop = np.vstack([prof, prof[:1]]) if closed else prof
    plen = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(loop, axis=0), axis=1))])
    rref = max(float(prof[:, 0].max()), 1e-3)
    F, UV = [], []
    nprof = len(prof)
    for j in range(nprof if closed else nprof - 1):
        jn = (j + 1) % nprof
        for i in range(seg):
            i1 = (i + 1) % na
            q = [idx[j][i], idx[j][i1], idx[jn][i1], idx[jn][i]]
            aa = a0 + (a1 - a0) * i / seg
            ab = a0 + (a1 - a0) * (i + 1) / seg
            if local_u:
                r0, r1 = prof[j][0], prof[jn][0]
                uv = [(aa * r0, plen[j]), (ab * r0, plen[j]), (ab * r1, plen[j + 1]), (aa * r1, plen[j + 1])]
            else:
                uv = [(aa * rref, plen[j]), (ab * rref, plen[j]), (ab * rref, plen[j + 1]), (aa * rref, plen[j + 1])]
            # drop collapsed corners
            qq, uu = [], []
            for k in range(4):
                if q[k] not in qq:
                    qq.append(q[k])
                    uu.append(uv[k])
            if len(qq) >= 3:
                F.append(qq[::-1] if flip else qq)
                UV.append(uu[::-1] if flip else uu)
    if caps and not full:
        # close a partial revolution with its two profile end faces
        for ia, ang, sgn in ((0, a0, -1.0), (na - 1, a1, 1.0)):
            ring = []
            for j in range(len(prof)):
                k = idx[j][ia]
                if not ring or ring[-1] != k:
                    ring.append(k)
            if len(ring) >= 3 and ring[0] == ring[-1]:
                ring.pop()
            if len(ring) < 3:
                continue
            P3 = np.array([V[k] for k in ring])
            nrm = np.zeros(3)
            for t in range(len(ring)):
                a_, b_ = P3[t], P3[(t + 1) % len(ring)]
                nrm += np.cross(a_, b_)
            want = sgn * np.array([-math.sin(ang), math.cos(ang), 0.0])
            if float(nrm @ want) < 0:
                ring = ring[::-1]
            F.append(ring)
            UV.append([(float(V[k][0]), float(V[k][2])) for k in ring])
    g = Geo(np.array(V), F, UV)
    return g


def loft(rings, closed=True, caps=True, flip=False):
    """Skin a list of equal-length 3D rings (each Nx3)."""
    R = [np.asarray(r, float) for r in rings]
    N = len(R[0])
    V = np.vstack(R)
    F, UV = [], []
    vacc = [0.0]
    for k in range(1, len(R)):
        vacc.append(vacc[-1] + float(np.mean(np.linalg.norm(R[k] - R[k - 1], axis=1))))
    uacc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.vstack([R[0], R[0][:1]]), axis=0), axis=1))])
    ns = N if closed else N - 1
    for k in range(len(R) - 1):
        for i in range(ns):
            i1 = (i + 1) % N
            f = [k * N + i, k * N + i1, (k + 1) * N + i1, (k + 1) * N + i]
            uv = [(uacc[i], vacc[k]), (uacc[i + 1], vacc[k]), (uacc[i + 1], vacc[k + 1]), (uacc[i], vacc[k + 1])]
            F.append(f[::-1] if flip else f)
            UV.append(uv[::-1] if flip else uv)
    if caps and closed:
        a = list(range(N))[::-1]
        b = [(len(R) - 1) * N + i for i in range(N)]
        if flip:
            a, b = a[::-1], b[::-1]
        F += [a, b]
        UV += [[(float(R[0][i][0]), float(R[0][i][1])) for i in a], [(float(R[-1][i - (len(R) - 1) * N][0]), float(R[-1][i - (len(R) - 1) * N][1])) for i in b]]
    return Geo(V, F, UV)


def plane_poly(poly3, flip=False):
    """A single n-gon from 3D points."""
    V = np.asarray(poly3, float)
    f = list(range(len(V)))
    return Geo(V, [f[::-1] if flip else f], None)


def tube(path, r, seg=12, closed=False, caps=True):
    prof = [(r * math.cos(a), r * math.sin(a)) for a in np.linspace(0, TAU, seg, endpoint=False)]
    P = np.asarray(path, float)
    # choose a reference up not parallel to the path
    d = P[-1] - P[0]
    up = (0, 0, 1) if abs(d[2]) < 0.9 * np.linalg.norm(d) else (1, 0, 0)
    return sweep(prof, P, closed=closed, up=up, caps=caps)


def extrude_profile_y(profile2, y0, y1):
    """Extrude a closed (x, z) profile along +Y from y0 to y1 (profile CCW in x-z seen from -Y)."""
    p = ccw(profile2)
    path = [(0, y0, 0), (0, y1, 0)]
    # sweep along +Y with up=Z: right = Y x Z = +X; profile (o,h) = (x,z)
    return sweep(p, path, up=(0, 0, 1))


def extrude_profile_x(profile2, x0, x1):
    """Extrude a closed (y, z) profile along +X (right = X x Z = -Y, so o = -y)."""
    p = ccw([(-y, z) for y, z in profile2])
    return sweep(p, [(x0, 0, 0), (x1, 0, 0)], up=(0, 0, 1))
