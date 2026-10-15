"""Generated image textures (wallpapers, leaded lights, rugs, tiles, parquet), written to
blender/textures/. A small anti-aliased numpy rasteriser: filled ellipses/polygons and stroked
curves, drawn with wrap-around so every pattern tiles seamlessly.
"""
import math
import os

import numpy as np

OUT = "/Users/scott/Documents/Projects/Node/dysonCity/blender/textures"


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


class Canvas:
    def __init__(self, w, h, bg, ss=2, wrap=True):
        self.ss = ss
        self.W, self.H = w * ss, h * ss
        self.img = np.ones((self.H, self.W, 3)) * hexc(bg) if isinstance(bg, str) else np.ones((self.H, self.W, 3)) * bg
        self.wrap = wrap
        self.yy, self.xx = None, None

    def _blend(self, x0, y0, mask, color, alpha=1.0):
        """mask: coverage over a window starting at (x0, y0) (may extend outside: wraps)."""
        h, w = mask.shape
        ys = (np.arange(h) + y0)
        xs = (np.arange(w) + x0)
        if self.wrap:
            ys %= self.H
            xs %= self.W
        else:
            ky = (ys >= 0) & (ys < self.H)
            kx = (xs >= 0) & (xs < self.W)
            mask = mask[ky][:, kx]
            ys, xs = ys[ky], xs[kx]
        c = np.asarray(color, float)
        a = (mask * alpha)[..., None]
        sub = self.img[np.ix_(ys, xs)]
        self.img[np.ix_(ys, xs)] = sub * (1 - a) + c * a

    def ellipse(self, cx, cy, rx, ry, ang, color, alpha=1.0):
        s = self.ss
        cx, cy, rx, ry = cx * s, cy * s, rx * s, ry * s
        R = int(max(rx, ry)) + 2
        x0, y0 = int(cx) - R, int(cy) - R
        yy, xx = np.mgrid[0:2 * R, 0:2 * R]
        dx = xx + x0 + 0.5 - cx
        dy = yy + y0 + 0.5 - cy
        ca, sa = math.cos(ang), math.sin(ang)
        u = (dx * ca + dy * sa) / max(rx, 1e-3)
        v = (-dx * sa + dy * ca) / max(ry, 1e-3)
        d = np.sqrt(u * u + v * v)
        m = np.clip((1 - d) * min(rx, ry) + 0.5, 0, 1)
        self._blend(x0, y0, m, color, alpha)

    def leafshape(self, cx, cy, L, W, ang, color, alpha=1.0, vein=None):
        """Pointed leaf: intersection-of-circles lens along its axis."""
        s = self.ss
        cx, cy, L, W = cx * s, cy * s, L * s, W * s
        R = int(L) + 2
        x0, y0 = int(cx) - R, int(cy) - R
        yy, xx = np.mgrid[0:2 * R, 0:2 * R]
        dx = xx + x0 + 0.5 - cx
        dy = yy + y0 + 0.5 - cy
        ca, sa = math.cos(ang), math.sin(ang)
        u = (dx * ca + dy * sa)          # along the leaf, 0 at base .. L at tip
        v = (-dx * sa + dy * ca)
        t = u / L
        half = W / 2 * np.sin(np.clip(t, 0, 1) * math.pi) ** 0.8
        m = np.clip(half - np.abs(v) + 0.5, 0, 1) * ((t >= 0) & (t <= 1))
        self._blend(x0, y0, m, color, alpha)
        if vein is not None:
            mv = np.clip(1.2 - np.abs(v), 0, 1) * ((t > 0.05) & (t < 0.9))
            self._blend(x0, y0, mv, vein, alpha * 0.8)

    def stroke(self, pts, width, color, alpha=1.0):
        pts = np.asarray(pts, float)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            n = max(1, int(np.linalg.norm(b - a) / max(width * 0.35, 0.5)))
            for k in range(n):
                p = a + (b - a) * (k / n)
                self.ellipse(p[0], p[1], width / 2, width / 2, 0.0, color, alpha)

    def poly(self, pts, color, alpha=1.0):
        s = self.ss
        P = np.asarray(pts, float) * s
        x0, y0 = np.floor(P.min(0)).astype(int) - 1
        x1, y1 = np.ceil(P.max(0)).astype(int) + 1
        yy, xx = np.mgrid[y0:y1, x0:x1]
        px, py = xx + 0.5, yy + 0.5
        inside = np.zeros(px.shape, bool)
        n = len(P)
        j = n - 1
        for i in range(n):
            xi, yi = P[i]
            xj, yj = P[j]
            cond = ((yi > py) != (yj > py)) & (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi)
            inside ^= cond
            j = i
        self._blend(x0, y0, inside.astype(float), color, alpha)

    def noise(self, amp=0.03, scale=6, seed=0):
        rng = np.random.default_rng(seed)
        g = rng.normal(0, 1, (self.H // scale + 2, self.W // scale + 2))
        # bilinear upsample (wraps by construction approximately)
        yy = np.linspace(0, g.shape[0] - 1.001, self.H)
        xx = np.linspace(0, g.shape[1] - 1.001, self.W)
        y0, x0 = yy.astype(int), xx.astype(int)
        fy, fx = (yy - y0)[:, None], (xx - x0)[None, :]
        v = (g[y0][:, x0] * (1 - fy) * (1 - fx) + g[y0 + 1][:, x0] * fy * (1 - fx) + g[y0][:, x0 + 1] * (1 - fy) * fx
             + g[y0 + 1][:, x0 + 1] * fy * fx)
        self.img *= (1 + amp * v)[..., None]

    def save(self, name):
        import bpy
        img = self.img.reshape(self.H // self.ss, self.ss, self.W // self.ss, self.ss, 3).mean((1, 3))
        img = np.clip(img, 0, 1)
        h, w = img.shape[:2]
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, name + ".png")
        im = bpy.data.images.get(name + "_gen") or bpy.data.images.new(name + "_gen", w, h, alpha=False)
        if im.size[0] != w or im.size[1] != h:
            im.scale(w, h)
        rgba = np.ones((h, w, 4), np.float32)
        rgba[..., :3] = img[::-1]
        im.pixels.foreach_set(rgba.ravel())
        im.filepath_raw = path
        im.file_format = "PNG"
        im.save()
        bpy.data.images.remove(im)
        return path


# ---------------------------------------------------------------- patterns

def vine_paper(name, size, bg, vine, leaves, flowers, centre, seed, density=1.0, scale=1.0):
    """Morris-style trailing vine with pointed leaves and many-petalled flowers."""
    rng = np.random.default_rng(seed)
    c = Canvas(size, size, bg)
    c.noise(0.025, 8, seed)
    S = size
    nvines = 3
    for v in range(nvines):
        y0 = S * (v + 0.5) / nvines
        ph = rng.uniform(0, math.tau)
        amp = S * 0.09
        pts = [(x, y0 + amp * math.sin(math.tau * x / S * 2 + ph) + amp * 0.4 * math.sin(math.tau * x / S * 3 + ph * 2))
               for x in np.linspace(0, S, 160)]
        c.stroke(pts, 5 * scale, vine)
        # tendrils
        for k in range(int(10 * density)):
            i = rng.integers(5, 150)
            x, y = pts[i]
            sgn = rng.choice([-1, 1])
            curl = [(x + 18 * scale * math.sin(t) * sgn, y + sgn * (30 * scale) * (1 - math.cos(t)) * 0.8)
                    for t in np.linspace(0, 2.2, 14)]
            c.stroke(curl, 2.2 * scale, vine)
        # leaves along the vine
        for k in range(int(26 * density)):
            i = rng.integers(2, 158)
            x, y = pts[i]
            x2, y2 = pts[i + 1]
            tang = math.atan2(y2 - y, x2 - x)
            sgn = rng.choice([-1, 1])
            ang = tang + sgn * rng.uniform(0.6, 1.3)
            L = rng.uniform(38, 62) * scale
            col = leaves[rng.integers(len(leaves))]
            vein = np.clip(col * 0.65, 0, 1)
            c.leafshape(x - math.cos(ang) * 1.5, y - math.sin(ang) * 1.5, L + 3, L * 0.42 + 3, ang, np.clip(col * 0.55, 0, 1))
            c.leafshape(x, y, L, L * 0.42, ang, col, vein=vein)
    # flowers
    for k in range(int(10 * density)):
        x, y = rng.uniform(0, S), rng.uniform(0, S)
        R = rng.uniform(22, 34) * scale
        col = flowers[rng.integers(len(flowers))]
        dark = np.clip(col * 0.7, 0, 1)
        n = rng.integers(6, 9)
        for p in range(n):
            a = math.tau * p / n + rng.uniform(-0.1, 0.1)
            c.ellipse(x + math.cos(a) * R * 0.55, y + math.sin(a) * R * 0.55, R * 0.55, R * 0.28, a, dark)
            c.ellipse(x + math.cos(a) * R * 0.5, y + math.sin(a) * R * 0.5, R * 0.48, R * 0.22, a, col)
        c.ellipse(x, y, R * 0.28, R * 0.28, 0, centre)
        for p in range(8):
            a = math.tau * p / 8
            c.ellipse(x + math.cos(a) * R * 0.16, y + math.sin(a) * R * 0.16, 2.5 * scale, 2.5 * scale, 0, np.clip(centre * 1.4, 0, 1))
    # berries
    for k in range(int(30 * density)):
        x, y = rng.uniform(0, S), rng.uniform(0, S)
        c.ellipse(x, y, 4 * scale, 4 * scale, 0, flowers[rng.integers(len(flowers))] * 0.85)
    return c.save(name)


def damask(name, size, bg, fg, seed, accent=None):
    """Symmetric damask: a mirrored medallion on a half-drop repeat, tone-on-tone."""
    rng = np.random.default_rng(seed)
    c = Canvas(size, size, bg)
    c.noise(0.02, 6, seed)
    S = size
    for (ox, oy) in ((S * 0.5, S * 0.5), (0.0, 0.0)):
        for sgn in (-1, 1):
            # medallion: stacked mirrored leaves + scrolls
            for k in range(7):
                t = k / 6
                y = oy + (t - 0.5) * S * 0.62
                w = S * 0.18 * math.sin(math.pi * (0.15 + 0.7 * t))
                c.leafshape(ox, y, w * 1.6, w * 0.6, math.pi if sgn < 0 else 0.0, fg)
                c.leafshape(ox + sgn * w * 0.2, y + S * 0.03, w * 1.1, w * 0.45, (math.pi if sgn < 0 else 0.0) + sgn * 0.6, fg)
            curl = [(ox + sgn * (S * 0.12 + S * 0.08 * math.sin(a)), oy - S * 0.2 + S * 0.08 * (1 - math.cos(a)))
                    for a in np.linspace(0, 4.0, 30)]
            c.stroke(curl, S * 0.012, fg)
        c.ellipse(ox, oy - S * 0.33, S * 0.035, S * 0.05, 0, accent if accent is not None else fg)
        c.ellipse(ox, oy + S * 0.33, S * 0.03, S * 0.03, 0, accent if accent is not None else fg)
    return c.save(name)


def stripe_paper(name, size, cols, widths, seed, sprig=None):
    c = Canvas(size, size, cols[0])
    x = 0
    i = 0
    while x < size:
        w = widths[i % len(widths)]
        c.poly([(x, -1), (x + w, -1), (x + w, size + 1), (x, size + 1)], cols[i % len(cols)])
        x += w
        i += 1
    c.noise(0.02, 6, seed)
    if sprig is not None:
        rng = np.random.default_rng(seed)
        for k in range(6):
            cx = size * (k % 2 * 0.5 + 0.25)
            cy = size * (k // 2) / 3 + size / 6
            for j in range(5):
                c.leafshape(cx, cy, 16, 7, -math.pi / 2 + (j - 2) * 0.45, sprig[0])
            c.ellipse(cx, cy - 18, 6, 6, 0, sprig[1])
    return c.save(name)


def sprig_paper(name, size, bg, cols, seed, n=14):
    rng = np.random.default_rng(seed)
    c = Canvas(size, size, bg)
    c.noise(0.02, 6, seed)
    for k in range(n):
        cx, cy = rng.uniform(0, size), rng.uniform(0, size)
        a0 = rng.uniform(0, math.tau)
        stem = [(cx + math.cos(a0) * t * 40, cy + math.sin(a0) * t * 40 + 8 * math.sin(t * 3)) for t in np.linspace(0, 1, 12)]
        c.stroke(stem, 2.0, cols[0])
        for j in range(4):
            p = stem[2 + j * 2]
            c.leafshape(p[0], p[1], 15, 6, a0 + (0.8 if j % 2 else -0.8), cols[1])
        p = stem[-1]
        for j in range(5):
            a = math.tau * j / 5
            c.ellipse(p[0] + 5 * math.cos(a), p[1] + 5 * math.sin(a), 5, 3, a, cols[2])
        c.ellipse(p[0], p[1], 2.5, 2.5, 0, cols[3])
    return c.save(name)


def leaded_light(name, w, h, seed, palette):
    """Leaded stained glass panel (transom): amber field, a central flower with leaves, border.
    Writes RGB (glass colour) with the lead lines as near-black."""
    rng = np.random.default_rng(seed)
    c = Canvas(w, h, palette["field"], wrap=False)
    lead = hexc("#1d1a16")
    # border band
    b = h * 0.12
    c.poly([(0, 0), (w, 0), (w, b), (0, b)], palette["border"])
    c.poly([(0, h - b), (w, h - b), (w, h), (0, h)], palette["border"])
    c.poly([(0, 0), (b, 0), (b, h), (0, h)], palette["border"])
    c.poly([(w - b, 0), (w, 0), (w, h), (w - b, h)], palette["border"])
    # field texture: slight streaks of colour variation (cathedral glass)
    for k in range(120):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        c.ellipse(x, y, rng.uniform(10, 30), rng.uniform(3, 8), rng.uniform(0, math.pi), palette["field"] * rng.uniform(0.88, 1.08), 0.5)
    cx, cy = w / 2, h / 2
    # leaves sweeping out from the flower
    for sgn in (-1, 1):
        for k in range(3):
            ang = (0.0 if sgn > 0 else math.pi) + (k - 1) * 0.5
            L = h * (0.42 - 0.06 * abs(k - 1))
            c.leafshape(cx + sgn * h * 0.12 - math.cos(ang) * 3, cy - math.sin(ang) * 3, L + 6, L * 0.38 + 6, ang, lead)
            c.leafshape(cx + sgn * h * 0.12, cy, L, L * 0.38, ang, palette["leaf"], vein=lead)
        stem = [(cx + sgn * t, cy + 0.12 * h * math.sin(t / h * 6)) for t in np.linspace(0, w * 0.42, 40)]
        c.stroke(stem, 3.0, lead)
    # flower
    R = h * 0.26
    for p in range(8):
        a = math.tau * p / 8
        c.ellipse(cx + math.cos(a) * R * 0.5, cy + math.sin(a) * R * 0.5, R * 0.52 + 3, R * 0.25 + 3, a, lead)
    for p in range(8):
        a = math.tau * p / 8
        c.ellipse(cx + math.cos(a) * R * 0.5, cy + math.sin(a) * R * 0.5, R * 0.52, R * 0.25, a, palette["petal"])
    for p in range(8):
        a = math.tau * p / 8
        dx, dy = math.cos(a), math.sin(a)
        c.stroke([(cx + dx * R * 0.2, cy + dy * R * 0.2), (cx + dx * R, cy + dy * R)], 2.5, lead)
    c.ellipse(cx, cy, R * 0.25 + 3, R * 0.25 + 3, 0, lead)
    c.ellipse(cx, cy, R * 0.25, R * 0.25, 0, palette["eye"])
    # lead lines: border edges and a grid of quarries
    for x in (b, w - b):
        c.stroke([(x, 0), (x, h)], 3.0, lead)
    for y in (b, h - b):
        c.stroke([(0, y), (w, y)], 3.0, lead)
    for k in range(1, 8):
        x = b + (w - 2 * b) * k / 8
        if abs(x - cx) > R * 1.1:
            c.stroke([(x, b), (x, h - b)], 2.0, lead, 0.7)
    return c.save(name)


def rug(name, w, h, seed, pal):
    """Wool rug with overlapping petal/circle motifs (as in the parlour/dining references)."""
    rng = np.random.default_rng(seed)
    c = Canvas(w, h, pal[0], wrap=False)
    c.noise(0.05, 3, seed)
    # field: staggered big petals and discs
    step = 120
    for j in range(-1, h // step + 2):
        for i in range(-1, w // step + 2):
            x = i * step + (step / 2 if j % 2 else 0)
            y = j * step * 0.9
            col = pal[1 + (i * 3 + j * 5) % (len(pal) - 1)]
            c.ellipse(x, y, step * 0.62, step * 0.62, 0, col * rng.uniform(0.9, 1.05))
            c.ellipse(x, y, step * 0.4, step * 0.4, 0, pal[1 + (i + j * 2 + 2) % (len(pal) - 1)])
            for p in range(4):
                a = math.pi / 4 + p * math.pi / 2
                c.leafshape(x, y, step * 0.55, step * 0.3, a, pal[1 + (i + j + p) % (len(pal) - 1)])
            c.ellipse(x, y, step * 0.12, step * 0.12, 0, pal[0])
    # border bands
    bw = 70
    for k, col in enumerate((pal[2], pal[0], pal[4 % len(pal)])):
        o = k * bw / 3
        t = bw / 3
        c.poly([(o, o), (w - o, o), (w - o, o + t), (o, o + t)], col)
        c.poly([(o, h - o - t), (w - o, h - o - t), (w - o, h - o), (o, h - o)], col)
        c.poly([(o, o), (o + t, o), (o + t, h - o), (o, h - o)], col)
        c.poly([(w - o - t, o), (w - o, o), (w - o, h - o), (w - o - t, h - o)], col)
    c.noise(0.06, 2, seed + 1)
    return c.save(name)


def encaustic(name, size, seed):
    """Victorian geometric floor tiles: 4 tiles per repeat, terracotta/black/buff/blue."""
    c = Canvas(size, size, "#b8794f", wrap=True)
    t = size / 2
    cols = {"r": hexc("#a8552e"), "k": hexc("#2a2420"), "b": hexc("#d9c49a"), "u": hexc("#3e5c78")}
    for ty in range(2):
        for tx in range(2):
            x0, y0 = tx * t, ty * t
            c.poly([(x0, y0), (x0 + t, y0), (x0 + t, y0 + t), (x0, y0 + t)], cols["b"])
            m = t / 2
            c.poly([(x0 + m, y0 + 4), (x0 + t - 4, y0 + m), (x0 + m, y0 + t - 4), (x0 + 4, y0 + m)], cols["r"])
            c.poly([(x0 + m, y0 + t * 0.22), (x0 + t * 0.78, y0 + m), (x0 + m, y0 + t * 0.78), (x0 + t * 0.22, y0 + m)], cols["k"])
            c.ellipse(x0 + m, y0 + m, t * 0.14, t * 0.14, 0, cols["u"])
            for cx, cy in ((x0, y0), (x0 + t, y0), (x0, y0 + t), (x0 + t, y0 + t)):
                c.ellipse(cx, cy, t * 0.12, t * 0.12, math.pi / 4, cols["k"])
            # grout
            c.poly([(x0, y0), (x0 + t, y0), (x0 + t, y0 + 2), (x0, y0 + 2)], hexc("#8a7c6a"))
            c.poly([(x0, y0), (x0 + 2, y0), (x0 + 2, y0 + t), (x0, y0 + t)], hexc("#8a7c6a"))
    c.noise(0.04, 4, seed)
    return c.save(name)


def hex_tiles(name, size, seed):
    """Small white hexagonal mosaic with a black rosette every few tiles (bathrooms)."""
    rng = np.random.default_rng(seed)
    c = Canvas(size, int(size * math.sqrt(3) / 2 * 2 / 2 * 2 / math.sqrt(3) * math.sqrt(3) / 2 * 2), "#b9b4aa", wrap=True)
    H = c.H // c.ss
    W = c.W // c.ss
    r = W / 8 / math.sqrt(3) * 1.0
    nx, ny = 8, int(round(H / (1.5 * r)))
    for j in range(-1, ny + 1):
        for i in range(-1, nx + 1):
            x = i * r * math.sqrt(3) + (r * math.sqrt(3) / 2 if j % 2 else 0)
            y = j * r * 1.5
            pts = [(x + (r - 1.2) * math.cos(math.pi / 6 + k * math.pi / 3), y + (r - 1.2) * math.sin(math.pi / 6 + k * math.pi / 3)) for k in range(6)]
            black = (i % 4 == 0 and j % 4 == 0) or (i % 4 == 1 and j % 4 == 0 and False)
            col = hexc("#1f1f1f") if black else hexc("#f1eee7") * rng.uniform(0.96, 1.01)
            c.poly(pts, col)
    return c.save(name)


def parquet(name, size, seed, n=4):
    """True herringbone: plank pairs (H: n x 1, V: 1 x n) on the lattice (1,-1), (n,n) in plank
    widths, rotated 45 degrees so the zigzag runs along the texture's V axis. The rotated lattice
    is rectangular (sqrt2 x n*sqrt2 widths), so the texture tiles exactly."""
    rng = np.random.default_rng(seed)
    W = size / (8 * math.sqrt(2))
    c = Canvas(size, size, "#4a3220", wrap=True)
    r = 1 / math.sqrt(2)

    def rot(x, y):
        return ((x - y) * r * W, (x + y) * r * W)
    gap = 0.03
    for j in range(-3, 6):
        for k in range(-20, 30):
            ox, oy = k + j * n, -k + j * n
            for (x0, y0, x1, y1) in ((ox, oy, ox + n, oy + 1), (ox + n, oy, ox + n + 1, oy + n)):
                pts = [rot(x0 + gap, y0 + gap), rot(x1 - gap, y0 + gap), rot(x1 - gap, y1 - gap), rot(x0 + gap, y1 - gap)]
                X = [p[0] for p in pts]
                Y = [p[1] for p in pts]
                if max(X) < -W * 2 or min(X) > size + W * 2 or max(Y) < -W * 2 or min(Y) > size + W * 2:
                    continue
                tone = hexc("#8d6238") * rng.uniform(0.75, 1.15)
                c.poly(pts, tone)
                horiz = (x1 - x0) > (y1 - y0)
                for g in range(4):
                    f = rng.uniform(0.15, 0.85)
                    if horiz:
                        a_ = rot(x0 + 0.1, y0 + f)
                        b_ = rot(x1 - 0.1, y0 + f + rng.uniform(-0.1, 0.1))
                    else:
                        a_ = rot(x0 + f, y0 + 0.1)
                        b_ = rot(x0 + f + rng.uniform(-0.1, 0.1), y1 - 0.1)
                    c.stroke([a_, b_], 1.0, tone * 0.82, 0.5)
    c.noise(0.04, 2, seed)
    return c.save(name)


def build():
    vine_paper("wp_morris", 768, hexc("#ede1c6"), hexc("#6d6a3c"),
               [hexc("#4f7f73"), hexc("#7d9a6a"), hexc("#3e5a3a"), hexc("#a3b07a")],
               [hexc("#d9822b"), hexc("#c95a3a"), hexc("#d8a840")], hexc("#6a3a1e"), seed=3, density=2.0)
    vine_paper("wp_rose", 640, hexc("#e7cfc4"), hexc("#7b8a5c"),
               [hexc("#7c9a72"), hexc("#5d7e5a")], [hexc("#b8505a"), hexc("#d27a7c"), hexc("#efe0d6")],
               hexc("#7a2a32"), seed=11, density=0.8, scale=0.8)
    damask("wp_hall", 512, hexc("#6e2a24"), hexc("#7f3a2c"), seed=5, accent=hexc("#9a5a3a"))
    damask("wp_blue", 512, hexc("#9db0c0"), hexc("#b6c6d2"), seed=6)
    stripe_paper("wp_stripe", 512, [hexc("#d9dcc3"), hexc("#b9c6a6"), hexc("#d9dcc3"), hexc("#8ea28b")],
                 [40, 40, 40, 8], seed=8, sprig=(hexc("#6d8a5c"), hexc("#c66a5a")))
    sprig_paper("wp_small", 512, hexc("#efe4bf"), [hexc("#6f7a4a"), hexc("#86a06a"), hexc("#d58a5a"), hexc("#8a3a2a")], seed=9)
    leaded_light("sg_floral", 1024, 384, 1, dict(field=hexc("#e8c070"), border=hexc("#5c8a6a"), leaf=hexc("#4f8a3a"),
                                                  petal=hexc("#d9622b"), eye=hexc("#e8b830")))
    rug("rug_parlour", 1600, 1150, 2, [hexc("#e8dcc0"), hexc("#c0662e"), hexc("#d79a42"), hexc("#3f6a6a"),
                                       hexc("#9a3b26"), hexc("#7a8a5a")])
    rug("rug_dining", 1600, 1100, 4, [hexc("#ecdfc5"), hexc("#b8582c"), hexc("#3d6b72"), hexc("#d49a3c"),
                                      hexc("#7b4a2a")])
    rug("rug_bed", 1200, 900, 12, [hexc("#d8d0c0"), hexc("#5a6f8a"), hexc("#a35a4a"), hexc("#c9a86a"), hexc("#3a4a5a")])
    encaustic("tile_encaustic", 256, 3)
    hex_tiles("tile_hex", 512, 4)
    parquet("parquet_oak", 512, 5)
