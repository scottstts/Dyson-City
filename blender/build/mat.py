"""Procedural PBR material library (Cycles/EEVEE nodes on UVMap, metres).

Every material reads UVs (never Generated/Object coords) so it can be baked to textures for the
engine. Material names are stable slot names the engine export maps by name.
"""
import bpy


def srgb(h):
    """'#rrggbb' -> linear RGBA."""
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c) + (1.0,)


class NB:
    """Tiny node-graph builder."""

    def __init__(self, m):
        self.m = m
        self.nt = m.node_tree
        self.nt.nodes.clear()
        self.out = self.n("ShaderNodeOutputMaterial", x=900)
        self.bsdf = self.n("ShaderNodeBsdfPrincipled", x=500)
        self.link(self.bsdf, 0, self.out, 0)
        self._uv = None
        self.view = None

    def n(self, kind, x=0, y=0, **props):
        node = self.nt.nodes.new(kind)
        node.location = (x, y)
        for k, v in props.items():
            setattr(node, k, v)
        return node

    def link(self, a, ao, b, bi):
        out = a.outputs[ao]
        if not out.enabled:
            # multi-type nodes (Mix) expose one output per data type: take the live one, else the
            # link comes from a disabled socket and silently feeds the default (white) instead
            out = next(o for o in a.outputs if o.enabled)
        self.nt.links.new(out, b.inputs[bi])

    def uv(self):
        if self._uv is None:
            self._uv = self.n("ShaderNodeUVMap", x=-1200)
            self._uv.uv_map = "UVMap"
        return self._uv

    def vec(self, scale=(1, 1, 1), rot=(0, 0, 0), loc=(0, 0, 0)):
        mp = self.n("ShaderNodeMapping", x=-1000)
        mp.inputs["Scale"].default_value = scale
        mp.inputs["Rotation"].default_value = rot
        mp.inputs["Location"].default_value = loc
        self.link(self.uv(), 0, mp, 0)
        return mp

    def noise(self, vec, scale=5.0, detail=4.0, rough=0.55, dist=0.0, dims="3D"):
        t = self.n("ShaderNodeTexNoise", x=-700)
        t.noise_dimensions = dims
        t.inputs["Scale"].default_value = scale
        t.inputs["Detail"].default_value = detail
        t.inputs["Roughness"].default_value = rough
        t.inputs["Distortion"].default_value = dist
        self.link(vec, 0, t, "Vector")
        return t

    def ramp(self, src, stops, out=0, x=-300):
        r = self.n("ShaderNodeValToRGB", x=x)
        cr = r.color_ramp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = stops[0][1]
        for p, c in stops[1:]:
            e = cr.elements.new(p)
            e.color = c
        self.link(src, out, r, 0)
        return r

    def math(self, op, a, b=None, x=-200, clamp=False):
        n = self.n("ShaderNodeMath", x=x)
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                node, sock = v if isinstance(v, tuple) else (v, 0)
                self.link(node, sock, n, i)
        return n

    def mix(self, fac, a, b, blend="MIX", x=-100):
        n = self.n("ShaderNodeMix", x=x)
        n.data_type = "RGBA"
        n.blend_type = blend
        for sock, v in (("Factor", fac), (6, a), (7, b)):
            if isinstance(v, tuple) and len(v) == 4 and all(isinstance(q, float) for q in v):
                n.inputs[sock].default_value = v
            elif isinstance(v, (int, float)):
                n.inputs[sock].default_value = v
            else:
                node, s = v if isinstance(v, tuple) else (v, 0)
                self.link(node, s, n, sock)
        return n

    def bump(self, height, strength=0.2, dist=0.01, normal=None):
        b = self.n("ShaderNodeBump", x=300, y=-400)
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = dist
        node, s = height if isinstance(height, tuple) else (height, 0)
        self.link(node, s, b, "Height")
        if normal is not None:
            self.link(normal, 0, b, "Normal")
        return b

    def set(self, **kw):
        names = {
            "base": "Base Color", "rough": "Roughness", "metal": "Metallic", "ior": "IOR",
            "trans": "Transmission Weight", "coat": "Coat Weight", "coat_rough": "Coat Roughness",
            "sheen": "Sheen Weight", "sheen_rough": "Sheen Roughness", "sheen_tint": "Sheen Tint",
            "sss": "Subsurface Weight", "sss_radius": "Subsurface Radius", "spec": "Specular IOR Level",
            "alpha": "Alpha", "emit": "Emission Color", "emit_str": "Emission Strength", "normal": "Normal",
            "aniso": "Anisotropic",
        }
        for k, v in kw.items():
            sock = self.bsdf.inputs[names[k]]
            if k == "base" and isinstance(v, tuple) and self.view is None:
                self.view = v
            if isinstance(v, bpy.types.Node):
                self.link(v, 0, self.bsdf, names[k])
            elif isinstance(v, tuple) and len(v) == 2 and isinstance(v[0], bpy.types.Node):
                self.link(v[0], v[1], self.bsdf, names[k])
            else:
                sock.default_value = v


DEFS = {}
# viewport (solid mode) colours for materials whose base colour is a node graph
VIEW = {
    "slate": "#454c55", "brick": "#7d4232", "sandstone": "#c2ad8b", "iron": "#1b1b1c", "gilt": "#d9b46a",
    "copper": "#9a6a48", "lead": "#686d70", "glass": "#a9c4cc", "terracotta": "#ad6243", "soil": "#35271c",
    "brass": "#bf9b4c", "galvanised": "#9aa0a3",
}


def define(name):
    def deco(fn):
        DEFS[name] = fn
        return fn
    return deco


def get(name: str) -> bpy.types.Material:
    m = bpy.data.materials.get(name)
    if m is not None and m.get("_built"):
        return m
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    fn = DEFS.get(name)
    if fn is None:
        base = name.split(".")[0]
        fn = DEFS.get(base)
    nb = NB(m)
    if fn is None:
        nb.set(base=(1, 0, 1, 1), rough=0.5)
    else:
        fn(nb)
    v = VIEW.get(name.split(".")[0])
    v = srgb(v) if v else (nb.view or tuple(nb.bsdf.inputs["Base Color"].default_value))
    m.diffuse_color = v
    m.roughness = 0.5
    m["_built"] = True
    return m


def rebuild_all():
    for m in bpy.data.materials:
        if "_built" in m:
            del m["_built"]
            get(m.name)


# ---------------------------------------------------------------- shared recipes

def painted_wood(nb, color, grain_scale=(1.0, 14.0, 1.0), rough=0.42, chalk=0.06, grain_axis="U", bumpstr=0.08):
    """Satin oil paint over timber: faint grain telegraphing through, slight chalking, brush marks."""
    nb.view = color
    vec = nb.vec(scale=grain_scale if grain_axis == "U" else (grain_scale[1], grain_scale[0], 1))
    grain = nb.noise(vec, scale=3.0, detail=6.0, rough=0.6, dist=0.4)
    fine = nb.noise(nb.vec(scale=(40, 40, 40)), scale=4.0, detail=3)
    var = nb.ramp(nb.noise(nb.vec(scale=(0.6, 0.6, 0.6)), scale=2.0, detail=2), [(0.3, (1 - chalk, 1 - chalk, 1 - chalk, 1)), (0.7, (1, 1, 1, 1))])
    col = nb.mix(1.0, color, var, blend="MULTIPLY")
    nb.set(base=col, rough=rough)
    h = nb.math("ADD", grain, (fine, 0), x=0)
    nb.set(normal=nb.bump(h, strength=bumpstr, dist=0.002))
    nb.set(coat=0.0, spec=0.5)


def wood(nb, light, dark, scale=(1.0, 8.0, 1.0), rough=0.35, coat=0.6, ring=5.0, bump=0.04):
    """Figured hardwood: wave rings distorted by noise along the board (U = along grain)."""
    nb.view = tuple((a + b) / 2 for a, b in zip(light, dark))
    vec = nb.vec(scale=scale)
    nz = nb.noise(vec, scale=2.0, detail=6.0, rough=0.6, dist=1.4)
    w = nb.n("ShaderNodeTexWave", x=-600)
    w.wave_type = "RINGS"
    w.rings_direction = "Y"
    w.wave_profile = "SAW"
    w.inputs["Scale"].default_value = ring
    w.inputs["Distortion"].default_value = 6.0
    w.inputs["Detail"].default_value = 3.0
    nb.link(nz, "Color", w, "Vector")
    r = nb.ramp(w, [(0.0, light), (0.55, dark), (1.0, light)], out=1)
    pores = nb.noise(nb.vec(scale=(scale[0] * 60, scale[1] * 3, 60)), scale=6.0, detail=2)
    col = nb.mix(0.15, r, pores, blend="MULTIPLY")
    nb.set(base=col, rough=rough, coat=coat, coat_rough=0.12)
    nb.set(normal=nb.bump((pores, 0), strength=bump, dist=0.001))


# ---------------------------------------------------------------- exterior

@define("siding_paint")
def _siding(nb):
    painted_wood(nb, srgb("#9fb6cc"), rough=0.45, chalk=0.08)


@define("trim_paint")
def _trim(nb):
    painted_wood(nb, srgb("#ebe3cf"), rough=0.38, chalk=0.05)


@define("accent_paint")
def _accent(nb):
    """The deeper blue-grey of the front door, sash panels and porch ceiling beads."""
    painted_wood(nb, srgb("#7d93a6"), rough=0.36, chalk=0.05)


@define("porch_ceiling")
def _haint(nb):
    painted_wood(nb, srgb("#b8d6d8"), rough=0.5, chalk=0.04)


@define("porch_floor")
def _porch_floor(nb):
    painted_wood(nb, srgb("#6f7577"), rough=0.55, chalk=0.12, bumpstr=0.12)


@define("slate")
def _slate(nb):
    """Welsh blue-grey slate. UV: U along the course (m), V up the slope from the eave (m)."""
    vec = nb.vec()
    br = nb.n("ShaderNodeTexBrick", x=-700)
    br.offset = 0.5
    br.offset_frequency = 2
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 0.25
    br.inputs["Row Height"].default_value = 0.165
    br.inputs["Mortar Size"].default_value = 0.004
    br.inputs["Mortar Smooth"].default_value = 0.3
    br.inputs["Bias"].default_value = 0.0
    br.inputs["Color1"].default_value = srgb("#3b4249")
    br.inputs["Color2"].default_value = srgb("#4a525b")
    br.inputs["Mortar"].default_value = srgb("#15181b")
    nb.link(vec, 0, br, "Vector")
    cleave = nb.noise(nb.vec(scale=(8, 30, 8)), scale=4.0, detail=8, rough=0.7)
    tint = nb.ramp(nb.noise(nb.vec(scale=(1.5, 1.5, 1.5)), scale=3.0, detail=3), [(0.35, srgb("#5a6470")), (0.65, srgb("#6c6a72"))])
    col = nb.mix(0.35, (br, 0), tint, blend="OVERLAY")
    nb.set(base=col, rough=0.62, spec=0.45)
    h = nb.math("MULTIPLY", (br, 1), -1.0)
    h2 = nb.math("MULTIPLY_ADD", (cleave, 0), 0.25, x=-150)
    nb.link(h, 0, h2, 2)
    nb.set(normal=nb.bump(h2, strength=0.35, dist=0.004))


@define("iron")
def _iron(nb):
    n = nb.noise(nb.vec(scale=(30, 30, 30)), scale=3, detail=5)
    col = nb.ramp(n, [(0.4, srgb("#141516")), (0.7, srgb("#22201e"))])
    nb.set(base=col, rough=0.48, metal=0.6)
    nb.set(normal=nb.bump(n, strength=0.15, dist=0.002))


@define("gilt")
def _gilt(nb):
    n = nb.noise(nb.vec(scale=(20, 20, 20)), scale=4, detail=4)
    nb.set(base=srgb("#d9b46a"), metal=1.0, rough=nb.ramp(n, [(0.3, (0.18,) * 3 + (1,)), (0.8, (0.32,) * 3 + (1,))]))


@define("copper")
def _copper(nb):
    n = nb.noise(nb.vec(scale=(4, 4, 4)), scale=3, detail=6)
    col = nb.ramp(n, [(0.4, srgb("#a8673f")), (0.75, srgb("#7b8f7a"))])
    nb.set(base=col, metal=0.85, rough=0.4)


@define("lead")
def _lead(nb):
    n = nb.noise(nb.vec(scale=(6, 6, 6)), scale=3, detail=5)
    nb.set(base=nb.ramp(n, [(0.3, srgb("#5d6266")), (0.7, srgb("#73787b"))]), metal=0.6, rough=0.55)
    nb.set(normal=nb.bump(n, strength=0.1, dist=0.003))


def thin_pane(nb, tint):
    """A pane is a thin sheet: light crosses it without bending. Cycles only carries light through a
    refracting surface as caustics (off), so shadow and diffuse rays see a plain transparent filter of
    the glass's tint; camera and glossy rays still see the real glass. Without this every room lit
    through a window renders black in Cycles."""
    lp = nb.n("ShaderNodeLightPath", x=300, y=300)
    fac = nb.math("MAXIMUM", (lp, "Is Shadow Ray"), (lp, "Is Diffuse Ray"), x=500)
    tr = nb.n("ShaderNodeBsdfTransparent", x=500, y=200)
    if isinstance(tint, tuple) and not isinstance(tint[0], bpy.types.Node):
        tr.inputs["Color"].default_value = tint
    else:
        node, sock = tint if isinstance(tint, tuple) else (tint, 0)
        nb.link(node, sock, tr, "Color")
    mx = nb.n("ShaderNodeMixShader", x=700)
    nb.link(fac, 0, mx, 0)
    nb.link(nb.bsdf, 0, mx, 1)
    nb.link(tr, 0, mx, 2)
    nb.link(mx, 0, nb.out, "Surface")


@define("glass")
def _glass(nb):
    """Cylinder glass: slight waviness of old panes."""
    n = nb.noise(nb.vec(scale=(1.5, 0.3, 1)), scale=6, detail=2)
    nb.set(base=(0.92, 0.95, 0.94, 1), rough=0.0, trans=1.0, ior=1.52, spec=0.5)
    nb.set(normal=nb.bump(n, strength=0.03, dist=0.002))
    thin_pane(nb, (0.9, 0.92, 0.92, 1.0))


@define("sandstone")
def _sandstone(nb):
    """Warm buff dressed sandstone, droved tooling across each block."""
    vec = nb.vec()
    n = nb.noise(vec, scale=6, detail=8, rough=0.65)
    big = nb.noise(nb.vec(scale=(0.7, 0.7, 0.7)), scale=2, detail=3)
    col = nb.ramp(big, [(0.3, srgb("#b9a383")), (0.7, srgb("#cdb994"))])
    col2 = nb.mix(0.25, col, n, blend="OVERLAY")
    tool = nb.n("ShaderNodeTexWave", x=-600)
    tool.wave_type = "BANDS"
    tool.bands_direction = "Y"
    tool.inputs["Scale"].default_value = 90
    tool.inputs["Distortion"].default_value = 2
    nb.link(vec, 0, tool, "Vector")
    h = nb.math("MULTIPLY_ADD", (tool, 1), 0.3, x=0)
    nb.link(n, 0, h, 2)
    nb.set(base=col2, rough=0.78)
    nb.set(normal=nb.bump(h, strength=0.25, dist=0.003))


@define("brick")
def _brick(nb):
    vec = nb.vec()
    br = nb.n("ShaderNodeTexBrick", x=-700)
    br.offset = 0.5
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 0.225
    br.inputs["Row Height"].default_value = 0.075
    br.inputs["Mortar Size"].default_value = 0.01
    br.inputs["Mortar Smooth"].default_value = 0.2
    br.inputs["Color1"].default_value = srgb("#8a4a36")
    br.inputs["Color2"].default_value = srgb("#6f3a2c")
    br.inputs["Mortar"].default_value = srgb("#b8ab96")
    br.inputs["Bias"].default_value = 0.1
    nb.link(vec, 0, br, "Vector")
    n = nb.noise(nb.vec(scale=(25, 25, 25)), scale=4, detail=6)
    col = nb.mix(0.2, (br, 0), n, blend="OVERLAY")
    nb.set(base=col, rough=0.85)
    h = nb.math("MULTIPLY_ADD", (br, 1), -0.6, x=0)
    nb.link(n, 0, h, 2)
    nb.set(normal=nb.bump(h, strength=0.4, dist=0.004))


@define("terracotta")
def _terracotta(nb):
    n = nb.noise(nb.vec(scale=(6, 6, 6)), scale=4, detail=4)
    nb.set(base=nb.ramp(n, [(0.3, srgb("#a5583a")), (0.8, srgb("#b9714c"))]), rough=0.7)


@define("door_paint")
def _door(nb):
    painted_wood(nb, srgb("#8ea2b2"), rough=0.3, chalk=0.03)


@define("brass")
def _brass(nb):
    n = nb.noise(nb.vec(scale=(15, 15, 15)), scale=4, detail=4)
    nb.set(base=nb.ramp(n, [(0.3, srgb("#b5913f")), (0.8, srgb("#c9a65a"))]), metal=1.0,
           rough=nb.ramp(n, [(0.3, (0.18,) * 3 + (1,)), (0.8, (0.34,) * 3 + (1,))], x=-250))


@define("lamp_glass")
def _lamp_glass(nb):
    nb.set(base=srgb("#f3e3c0"), rough=0.25, trans=0.6, sss=0.0, emit=srgb("#ffd9a0"), emit_str=0.0)


@define("sheer")
def _sheer(nb):
    """Ivory lace/voile: thin translucent cloth."""
    nb.set(base=srgb("#efe9dc"), rough=0.8, sheen=0.6, sheen_rough=0.4)
    tr = nb.n("ShaderNodeBsdfTranslucent", x=500, y=-300)
    tr.inputs["Color"].default_value = srgb("#f4eedf")
    mx = nb.n("ShaderNodeMixShader", x=750)
    mx.inputs[0].default_value = 0.5
    nb.link(nb.bsdf, 0, mx, 1)
    nb.link(tr, 0, mx, 2)
    nb.link(mx, 0, nb.out, 0)


@define("soil")
def _soil(nb):
    n = nb.noise(nb.vec(scale=(10, 10, 10)), scale=5, detail=8, rough=0.7)
    nb.set(base=nb.ramp(n, [(0.3, srgb("#2b1f17")), (0.7, srgb("#3f2e21"))]), rough=0.95)
    nb.set(normal=nb.bump(n, strength=0.6, dist=0.01))


@define("rubber")
def _rubber(nb):
    nb.set(base=srgb("#1c1c1c"), rough=0.75)


@define("steel_black")
def _steel_black(nb):
    nb.set(base=srgb("#1d2023"), metal=0.8, rough=0.35)


@define("chrome")
def _chrome(nb):
    nb.set(base=srgb("#d8d8d8"), metal=1.0, rough=0.08)


@define("galvanised")
def _galv(nb):
    n = nb.n("ShaderNodeTexVoronoi", x=-600)
    n.inputs["Scale"].default_value = 30
    nb.link(nb.vec(), 0, n, "Vector")
    nb.set(base=nb.ramp(n, [(0.2, srgb("#8c9296")), (0.9, srgb("#a7adb0"))]), metal=0.9, rough=0.4)


@define("sash_paint")
def _sash(nb):
    painted_wood(nb, srgb("#f1ece0"), rough=0.32, chalk=0.03)


@define("putty")
def _putty(nb):
    nb.set(base=srgb("#d9d2c0"), rough=0.6)


@define("stained_glass")
def _stained(nb):
    """Leaded cathedral glass: the transom texture mapped once across each light (UV 0..1).
    The lead lines (dark texels) are opaque and rough; the glass transmits its own colour."""
    import bpy
    img = bpy.data.images.get("sg_floral.png") or bpy.data.images.load(TEX + "sg_floral.png", check_existing=True)
    t = nb.n("ShaderNodeTexImage", x=-500)
    t.image = img
    nb.link(nb.uv(), 0, t, "Vector")
    lum = nb.math("MULTIPLY", (t, 0), 1.0)
    lead = nb.ramp(t, [(0.03, (0, 0, 0, 1)), (0.08, (1, 1, 1, 1))], x=-250)
    nb.view = srgb("#c99a4a")
    nb.set(base=t, rough=0.15, ior=1.52)
    nb.link(lead, 0, nb.bsdf, "Transmission Weight")
    n = nb.noise(nb.vec(scale=(30, 30, 30)), scale=4, detail=2)
    nb.set(normal=nb.bump(n, strength=0.08, dist=0.002))
    tm = nb.n("ShaderNodeMix", x=400, y=150)
    tm.data_type = "RGBA"
    tm.blend_type = "MULTIPLY"
    tm.inputs["Factor"].default_value = 1.0
    nb.link(t, 0, tm, 6)
    nb.link(lead, 0, tm, 7)                                  # lead lines block, the glass passes its colour
    thin_pane(nb, tm)


@define("trim_int")
def _trim_int(nb):
    painted_wood(nb, srgb("#efe8d8"), rough=0.3, chalk=0.02)


@define("walnut")
def _walnut(nb):
    wood(nb, srgb("#7a4a2a"), srgb("#4a2a16"), rough=0.32, coat=0.5)


@define("sheathing")
def _sheathing(nb):
    nb.set(base=srgb("#8a8478"), rough=0.8)


@define("jamb")
def _jamb(nb):
    painted_wood(nb, srgb("#efe8d8"), rough=0.35, chalk=0.02)


@define("ceiling_plaster")
def _ceil(nb):
    n = nb.noise(nb.vec(scale=(3, 3, 3)), scale=4, detail=6)
    nb.view = srgb("#f1ebdd")
    nb.set(base=nb.ramp(n, [(0.3, srgb("#ede6d6")), (0.7, srgb("#f3eee2"))]), rough=0.85)
    nb.set(normal=nb.bump(n, strength=0.05, dist=0.002))


@define("oak_threshold")
def _oak_thr(nb):
    wood(nb, srgb("#a3784a"), srgb("#6e4a2a"), rough=0.4, coat=0.2)


@define("porcelain")
def _porcelain(nb):
    nb.set(base=srgb("#f4f1ea"), rough=0.08, coat=0.5)


@define("shingle_paint")
def _shingle(nb):
    """Fish-scale shingles in the gables: a deeper slate blue than the clapboard."""
    painted_wood(nb, srgb("#6f87a0"), rough=0.5, chalk=0.08, bumpstr=0.12)


@define("roof_tin")
def _tin(nb):
    """Painted terne-metal porch roofing, a dark slate green."""
    n = nb.noise(nb.vec(scale=(2, 2, 2)), scale=3, detail=4)
    nb.view = srgb("#3d4a48")
    nb.set(base=nb.ramp(n, [(0.3, srgb("#36433f")), (0.7, srgb("#45524d"))]), metal=0.35, rough=0.5)


@define("leaf")
def _leaf(nb):
    """Thin foliage: two-sided, translucent green."""
    n = nb.noise(nb.vec(scale=(30, 30, 30)), scale=3, detail=3)
    nb.view = srgb("#3d6a2e")
    nb.set(base=nb.ramp(n, [(0.3, srgb("#2f5a24")), (0.7, srgb("#4a7a33"))]), rough=0.45, sss=0.0)
    tr = nb.n("ShaderNodeBsdfTranslucent", x=500, y=-300)
    tr.inputs["Color"].default_value = srgb("#6a9a3a")
    mx = nb.n("ShaderNodeMixShader", x=750)
    mx.inputs[0].default_value = 0.3
    nb.link(nb.bsdf, 0, mx, 1)
    nb.link(tr, 0, mx, 2)
    nb.link(mx, 0, nb.out, 0)


@define("petal_white")
def _petal(nb):
    nb.set(base=srgb("#f4f0ea"), rough=0.5, sheen=0.3)
    tr = nb.n("ShaderNodeBsdfTranslucent", x=500, y=-300)
    tr.inputs["Color"].default_value = srgb("#fffaf0")
    mx = nb.n("ShaderNodeMixShader", x=750)
    mx.inputs[0].default_value = 0.35
    nb.link(nb.bsdf, 0, mx, 1)
    nb.link(tr, 0, mx, 2)
    nb.link(mx, 0, nb.out, 0)


# ---------------------------------------------------------------- interior

TEX = "/Users/scott/Documents/Projects/Node/dysonCity/blender/textures/"


def image_tex(nb, name, repeat=(1.0, 1.0), bump=0.0, rough=0.5, interp="Linear"):
    """Image texture repeated every `repeat` metres on the UV map."""
    import bpy
    img = bpy.data.images.get(name + ".png") or bpy.data.images.load(TEX + name + ".png", check_existing=True)
    t = nb.n("ShaderNodeTexImage", x=-500)
    t.image = img
    t.interpolation = interp
    vec = nb.vec(scale=(1 / repeat[0], 1 / repeat[1], 1))
    nb.link(vec, 0, t, "Vector")
    return t


def wallpaper(nb, name, repeat, rough=0.62):
    t = image_tex(nb, name, (repeat, repeat))
    fine = nb.noise(nb.vec(scale=(60, 60, 60)), scale=5, detail=3)
    nb.set(base=t, rough=rough, spec=0.35)
    # paper grain and the slight relief of block-printed colour
    h = nb.math("MULTIPLY_ADD", (fine, 0), 0.4, x=0)
    nb.link(t, 0, h, 2)
    nb.set(normal=nb.bump(h, strength=0.06, dist=0.0006))


def paint(nb, hexcol, rough=0.75):
    n = nb.noise(nb.vec(scale=(8, 8, 8)), scale=4, detail=6)
    nb.view = srgb(hexcol)
    col = nb.mix(0.06, srgb(hexcol), n, blend="OVERLAY")
    nb.set(base=col, rough=rough, spec=0.4)
    nb.set(normal=nb.bump(n, strength=0.03, dist=0.002))


VIEW.update({"wall_morris": "#e3d4b2", "wall_rose": "#dcbcb0", "wall_hall": "#6e2a24", "wall_blue": "#a3b5c4",
             "wall_stripe": "#c8d0b4", "wall_small": "#e9dcb4", "floor_parquet": "#7a5432",
             "floor_encaustic": "#a86a46", "floor_hex": "#e8e4dc", "rug_parlour": "#c07a3a", "rug_dining": "#b8693a",
             "rug_bed": "#8a8a90"})


@define("wall_morris")
def _w_morris(nb):
    wallpaper(nb, "wp_morris", 0.53)


@define("wall_rose")
def _w_rose(nb):
    wallpaper(nb, "wp_rose", 0.45)


@define("wall_hall")
def _w_hall(nb):
    wallpaper(nb, "wp_hall", 0.53, rough=0.55)


@define("wall_blue")
def _w_blue(nb):
    wallpaper(nb, "wp_blue", 0.53)


@define("wall_stripe")
def _w_stripe(nb):
    wallpaper(nb, "wp_stripe", 0.46)


@define("wall_small")
def _w_small(nb):
    wallpaper(nb, "wp_small", 0.4)


@define("wall_green")
def _w_green(nb):
    paint(nb, "#3e5644", rough=0.7)


@define("wall_yellow")
def _w_yellow(nb):
    paint(nb, "#d8b56a")


@define("wall_sage")
def _w_sage(nb):
    paint(nb, "#a2ae90")


@define("wall_cream")
def _w_cream(nb):
    paint(nb, "#e8ddc4")


@define("wall_kitchen")
def _w_kitchen(nb):
    paint(nb, "#e6dcc0", rough=0.6)


@define("wall_plaster")
def _w_plaster(nb):
    n = nb.noise(nb.vec(scale=(2, 2, 2)), scale=5, detail=8, rough=0.7)
    nb.view = srgb("#ddd3bf")
    nb.set(base=nb.ramp(n, [(0.35, srgb("#d4c9b2")), (0.7, srgb("#e6ddca"))]), rough=0.9)
    nb.set(normal=nb.bump(n, strength=0.2, dist=0.004))


@define("wall_tile")
def _w_tile(nb):
    """Glazed white brick-bond tiles, 150 x 75, grey grout."""
    br = nb.n("ShaderNodeTexBrick", x=-700)
    br.offset = 0.5
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 0.15
    br.inputs["Row Height"].default_value = 0.075
    br.inputs["Mortar Size"].default_value = 0.0025
    br.inputs["Mortar Smooth"].default_value = 0.4
    br.inputs["Color1"].default_value = srgb("#f2efe6")
    br.inputs["Color2"].default_value = srgb("#ebe7dc")
    br.inputs["Mortar"].default_value = srgb("#a9a59b")
    nb.link(nb.vec(), 0, br, "Vector")
    nb.view = srgb("#eeeae0")
    nb.set(base=(br, 0), rough=0.08, coat=0.6, coat_rough=0.05)
    h = nb.math("MULTIPLY", (br, 1), -1.0)
    nb.set(normal=nb.bump(h, strength=0.4, dist=0.002))


@define("wall_pine")
def _w_pine(nb):
    """Vertical beaded pine boarding, honey-varnished."""
    br = nb.n("ShaderNodeTexBrick", x=-700)
    br.offset = 0.0
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 10.0
    br.inputs["Row Height"].default_value = 0.11
    br.inputs["Mortar Size"].default_value = 0.004
    br.inputs["Color1"].default_value = srgb("#c08a4e")
    br.inputs["Color2"].default_value = srgb("#b07c44")
    br.inputs["Mortar"].default_value = srgb("#5a3a1e")
    nb.link(nb.vec(rot=(0, 0, 1.5708)), 0, br, "Vector")
    g = nb.noise(nb.vec(scale=(1.0, 20.0, 1.0), rot=(0, 0, 1.5708)), scale=3, detail=6, dist=1.0)
    col = nb.mix(0.25, (br, 0), g, blend="OVERLAY")
    nb.view = srgb("#b98448")
    nb.set(base=col, rough=0.35, coat=0.4)
    h = nb.math("MULTIPLY", (br, 1), -1.0)
    nb.set(normal=nb.bump(h, strength=0.3, dist=0.003))


def boards(nb, light, dark, width, length, rough=0.3, coat=0.5, gap="#2a1a10"):
    """Floorboards: per-board tone from a brick texture, figured grain, dark joints. U along boards."""
    br = nb.n("ShaderNodeTexBrick", x=-800)
    br.offset = 0.37
    br.offset_frequency = 1
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = length
    br.inputs["Row Height"].default_value = width
    br.inputs["Mortar Size"].default_value = 0.0015
    br.inputs["Mortar Smooth"].default_value = 0.2
    br.inputs["Bias"].default_value = 0.0
    br.inputs["Color1"].default_value = (0.0, 0.0, 0.0, 1)
    br.inputs["Color2"].default_value = (1.0, 1.0, 1.0, 1)
    br.inputs["Mortar"].default_value = srgb(gap)
    nb.link(nb.vec(), 0, br, "Vector")
    vec = nb.vec(scale=(1.0, 9.0, 1.0))
    nz = nb.noise(vec, scale=2.0, detail=6.0, rough=0.6, dist=1.4)
    w = nb.n("ShaderNodeTexWave", x=-600)
    w.wave_type = "RINGS"
    w.rings_direction = "Y"
    w.inputs["Scale"].default_value = 4.0
    w.inputs["Distortion"].default_value = 6.0
    nb.link(nz, "Color", w, "Vector")
    grain = nb.ramp(w, [(0.0, light), (0.6, dark), (1.0, light)], out=1)
    tone = nb.ramp(br, [(0.0, (0.82, 0.82, 0.82, 1)), (1.0, (1.1, 1.1, 1.1, 1))], out=1, x=-350)
    c1 = nb.mix(1.0, grain, tone, blend="MULTIPLY")
    c2 = nb.mix((br, 1), c1, srgb(gap), blend="MIX")
    nb.view = tuple((a + b) / 2 for a, b in zip(light, dark))
    nb.set(base=c2, rough=rough, coat=coat, coat_rough=0.15)
    h = nb.math("MULTIPLY", (br, 1), -1.0)
    nb.set(normal=nb.bump(h, strength=0.5, dist=0.0015))


@define("floor_oak")
def _f_oak(nb):
    boards(nb, srgb("#a8794a"), srgb("#7a5230"), 0.11, 1.9)


@define("floor_pine")
def _f_pine(nb):
    boards(nb, srgb("#c8995e"), srgb("#a3713e"), 0.18, 3.2, rough=0.45, coat=0.2)


@define("floor_parquet")
def _f_parquet(nb):
    t = image_tex(nb, "parquet_oak", (0.8, 0.8))
    nb.set(base=t, rough=0.28, coat=0.6, coat_rough=0.1)
    h = nb.math("MULTIPLY", (t, 0), 1.0)
    nb.set(normal=nb.bump(h, strength=0.08, dist=0.0008))


@define("floor_encaustic")
def _f_enc(nb):
    t = image_tex(nb, "tile_encaustic", (0.3, 0.3))
    nb.set(base=t, rough=0.35, coat=0.3)
    nb.set(normal=nb.bump(t, strength=0.05, dist=0.0008))


@define("floor_hex")
def _f_hex(nb):
    t = image_tex(nb, "tile_hex", (0.26, 0.26))
    nb.set(base=t, rough=0.15, coat=0.5)
    h = nb.math("MULTIPLY", (t, 0), 1.0)
    nb.set(normal=nb.bump(h, strength=0.25, dist=0.0008))


@define("floor_flag")
def _f_flag(nb):
    br = nb.n("ShaderNodeTexBrick", x=-700)
    br.offset = 0.45
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 0.6
    br.inputs["Row Height"].default_value = 0.45
    br.inputs["Mortar Size"].default_value = 0.006
    br.inputs["Color1"].default_value = srgb("#8f877a")
    br.inputs["Color2"].default_value = srgb("#a39a88")
    br.inputs["Mortar"].default_value = srgb("#4f4a42")
    br.inputs["Bias"].default_value = 0.2
    nb.link(nb.vec(), 0, br, "Vector")
    n = nb.noise(nb.vec(scale=(6, 6, 6)), scale=4, detail=8, rough=0.7)
    col = nb.mix(0.3, (br, 0), n, blend="OVERLAY")
    nb.view = srgb("#958d7f")
    nb.set(base=col, rough=0.6)
    h = nb.math("MULTIPLY_ADD", (br, 1), -0.8, x=0)
    nb.link(n, 0, h, 2)
    nb.set(normal=nb.bump(h, strength=0.4, dist=0.004))


def rug_mat(nb, name, size):
    """Wool pile rug: image mapped once over the rug's UV (0..1 in metres scaled by size)."""
    t = image_tex(nb, name, size)
    n = nb.noise(nb.vec(scale=(300, 300, 300)), scale=6, detail=2)
    nb.set(base=t, rough=0.95, sheen=0.6, sheen_rough=0.5)
    nb.set(normal=nb.bump(n, strength=0.35, dist=0.002))


@define("rug_parlour")
def _r_parlour(nb):
    rug_mat(nb, "rug_parlour", (1.0, 1.0))


@define("rug_dining")
def _r_dining(nb):
    rug_mat(nb, "rug_dining", (1.0, 1.0))


@define("rug_bed")
def _r_bed(nb):
    rug_mat(nb, "rug_bed", (1.0, 1.0))


@define("oak_tread")
def _oak_tread(nb):
    wood(nb, srgb("#a2703f"), srgb("#6d4524"), rough=0.3, coat=0.5)


@define("stair_runner")
def _runner(nb):
    """Wool runner: deep madder field, a gold and indigo border down each edge (U across 0..1)."""
    u = nb.n("ShaderNodeSeparateXYZ", x=-700)
    nb.link(nb.uv(), 0, u, 0)
    border = nb.ramp(u, [(0.0, srgb("#d1a24a")), (0.06, srgb("#d1a24a")), (0.07, srgb("#2f3d5a")),
                              (0.12, srgb("#2f3d5a")), (0.13, srgb("#7d2a22")), (0.87, srgb("#7d2a22")),
                              (0.88, srgb("#2f3d5a")), (0.93, srgb("#2f3d5a")), (0.94, srgb("#d1a24a")), (1.0, srgb("#d1a24a"))], x=-400)
    for e in border.color_ramp.elements:
        pass
    border.color_ramp.interpolation = "CONSTANT"
    n = nb.noise(nb.vec(scale=(200, 200, 200)), scale=6, detail=2)
    m = nb.noise(nb.vec(scale=(6, 6, 6)), scale=3, detail=3)
    col = nb.mix(0.15, border, m, blend="OVERLAY")
    nb.view = srgb("#7d2a22")
    nb.set(base=col, rough=0.95, sheen=0.7, sheen_rough=0.5)
    nb.set(normal=nb.bump(n, strength=0.3, dist=0.002))


@define("cast_iron")
def _cast_iron(nb):
    n = nb.noise(nb.vec(scale=(40, 40, 40)), scale=4, detail=6)
    nb.view = srgb("#1c1b1a")
    nb.set(base=nb.ramp(n, [(0.4, srgb("#141413")), (0.7, srgb("#262422"))]), metal=0.7, rough=0.55)
    nb.set(normal=nb.bump(n, strength=0.15, dist=0.002))


@define("coal")
def _coal(nb):
    n = nb.noise(nb.vec(scale=(60, 60, 60)), scale=5, detail=4)
    nb.view = srgb("#111111")
    nb.set(base=srgb("#0d0c0b"), rough=0.35, spec=0.6)
    nb.set(normal=nb.bump(n, strength=0.5, dist=0.003))


@define("tile_green")
def _tile_green(nb):
    """Glazed art tiles (150 mm): deep teal-green with a mottled glaze."""
    br = nb.n("ShaderNodeTexBrick", x=-700)
    br.offset = 0.0
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 0.15
    br.inputs["Row Height"].default_value = 0.15
    br.inputs["Mortar Size"].default_value = 0.002
    br.inputs["Color1"].default_value = srgb("#2f6a62")
    br.inputs["Color2"].default_value = srgb("#3a7a6e")
    br.inputs["Mortar"].default_value = srgb("#c9c2b0")
    nb.link(nb.vec(), 0, br, "Vector")
    n = nb.noise(nb.vec(scale=(12, 12, 12)), scale=4, detail=5)
    col = nb.mix(0.3, (br, 0), n, blend="OVERLAY")
    nb.view = srgb("#33706a")
    nb.set(base=col, rough=0.06, coat=0.8, coat_rough=0.04)
    h = nb.math("MULTIPLY", (br, 1), -1.0)
    nb.set(normal=nb.bump(h, strength=0.4, dist=0.002))


@define("mirror")
def _mirror(nb):
    nb.view = srgb("#c8ccd0")
    nb.set(base=srgb("#e8e8e4"), metal=1.0, rough=0.02)


@define("marble_hearth")
def _marble(nb):
    n = nb.noise(nb.vec(scale=(3, 3, 3)), scale=3, detail=8, dist=4.0)
    nb.view = srgb("#d9d4ca")
    nb.set(base=nb.ramp(n, [(0.45, srgb("#e6e1d6")), (0.52, srgb("#8e8a82")), (0.58, srgb("#e2ddd2"))]), rough=0.15, coat=0.4)


# ---------------------------------------------------------------- furnishings

def velvet(nb, hexcol, sheen_hex=None):
    """Cotton/silk velvet: strong sheen at grazing angles, crushed-pile tone variation."""
    n = nb.noise(nb.vec(scale=(6, 6, 6)), scale=3, detail=4)
    pile = nb.noise(nb.vec(scale=(300, 300, 300)), scale=5, detail=2)
    col = nb.mix(0.18, srgb(hexcol), n, blend="OVERLAY")
    nb.view = srgb(hexcol)
    nb.set(base=col, rough=0.85, sheen=1.0, sheen_rough=0.35, spec=0.2)
    nb.bsdf.inputs["Sheen Tint"].default_value = srgb(sheen_hex or hexcol)
    nb.set(normal=nb.bump(pile, strength=0.15, dist=0.001))


@define("velvet_mustard")
def _v1(nb):
    velvet(nb, "#b88a2a", "#e8c46a")


@define("velvet_rust")
def _v2(nb):
    velvet(nb, "#9a4424", "#d8784a")


@define("velvet_teal")
def _v3(nb):
    velvet(nb, "#1f4e52", "#4f8a8a")


@define("velvet_drape")
def _v4(nb):
    velvet(nb, "#7a3a2a", "#c87a52")


@define("fabric_floral")
def _ff(nb):
    t = image_tex(nb, "wp_morris", (0.35, 0.35))
    nb.view = srgb("#d8c4a0")
    nb.set(base=t, rough=0.8, sheen=0.4)


@define("walnut_satin")
def _ws(nb):
    wood(nb, srgb("#6e4026"), srgb("#3e2213"), rough=0.4, coat=0.25)


@define("lampshade")
def _shade(nb):
    nb.set(base=srgb("#efe2c4"), rough=0.85, sheen=0.3)
    tr = nb.n("ShaderNodeBsdfTranslucent", x=500, y=-300)
    tr.inputs["Color"].default_value = srgb("#ffd9a0")
    mx = nb.n("ShaderNodeMixShader", x=750)
    mx.inputs[0].default_value = 0.55
    nb.link(nb.bsdf, 0, mx, 1)
    nb.link(tr, 0, mx, 2)
    nb.link(mx, 0, nb.out, 0)


def glazed(nb, hexcol, rough=0.08):
    n = nb.noise(nb.vec(scale=(8, 8, 8)), scale=3, detail=4)
    col = nb.mix(0.25, srgb(hexcol), n, blend="OVERLAY")
    nb.view = srgb(hexcol)
    nb.set(base=col, rough=rough, coat=1.0, coat_rough=0.03)


@define("ceramic_green")
def _cg(nb):
    glazed(nb, "#3f6a52")


@define("ceramic_white")
def _cw(nb):
    glazed(nb, "#f2efe8", 0.05)


@define("china")
def _ch(nb):
    glazed(nb, "#f4f2ec", 0.05)


@define("china_blue")
def _chb(nb):
    glazed(nb, "#5a78a8", 0.05)


@define("linen")
def _linen(nb):
    n = nb.noise(nb.vec(scale=(200, 200, 200)), scale=6, detail=2)
    nb.view = srgb("#efeadf")
    nb.set(base=srgb("#efeadf"), rough=0.9, sheen=0.5)
    nb.set(normal=nb.bump(n, strength=0.1, dist=0.0008))


@define("quilt_rose")
def _quilt(nb):
    t = image_tex(nb, "wp_rose", (0.5, 0.5))
    nb.view = srgb("#c99a96")
    nb.set(base=t, rough=0.85, sheen=0.5)


@define("ivory")
def _ivory(nb):
    nb.set(base=srgb("#efe6cf"), rough=0.25, coat=0.3)


@define("ebony")
def _ebony(nb):
    nb.set(base=srgb("#141210"), rough=0.2, coat=0.5)


@define("wax")
def _wax(nb):
    nb.set(base=srgb("#f1ead6"), rough=0.4, sss=0.4, sss_radius=(0.02, 0.015, 0.01))


@define("leather_green")
def _lg(nb):
    n = nb.noise(nb.vec(scale=(40, 40, 40)), scale=6, detail=4)
    nb.view = srgb("#2e4a32")
    nb.set(base=srgb("#2e4a32"), rough=0.45, coat=0.2)
    nb.set(normal=nb.bump(n, strength=0.2, dist=0.001))


@define("leather_brown")
def _lb(nb):
    n = nb.noise(nb.vec(scale=(40, 40, 40)), scale=6, detail=4)
    nb.view = srgb("#5a3420")
    nb.set(base=srgb("#5a3420"), rough=0.45, coat=0.2)
    nb.set(normal=nb.bump(n, strength=0.2, dist=0.001))


@define("globe")
def _globe(nb):
    n = nb.noise(nb.vec(scale=(1.5, 1.5, 1.5)), scale=3, detail=6)
    nb.view = srgb("#c9b48a")
    nb.set(base=nb.ramp(n, [(0.48, srgb("#8fa79a")), (0.5, srgb("#d6c28e")), (0.6, srgb("#b9a06a"))]), rough=0.3, coat=0.6)


@define("pine")
def _pine(nb):
    wood(nb, srgb("#c99a62"), srgb("#a5713f"), rough=0.45, coat=0.15)


@define("pine_scrubbed")
def _pines(nb):
    wood(nb, srgb("#dcc49c"), srgb("#c4a678"), rough=0.75, coat=0.0, bump=0.06)


@define("paint_dresser")
def _pdr(nb):
    painted_wood(nb, srgb("#7d927a"), rough=0.5, chalk=0.08)


@define("copper_pol")
def _cpol(nb):
    n = nb.noise(nb.vec(scale=(10, 10, 10)), scale=3, detail=3)
    nb.view = srgb("#b8673a")
    nb.set(base=nb.ramp(n, [(0.3, srgb("#c4743f")), (0.8, srgb("#a85a30"))]), metal=1.0, rough=0.22)


@define("silver")
def _silver(nb):
    nb.set(base=srgb("#d8d8d4"), metal=1.0, rough=0.15)


@define("orange")
def _orange(nb):
    n = nb.noise(nb.vec(scale=(80, 80, 80)), scale=6, detail=2)
    nb.set(base=srgb("#e0801f"), rough=0.4, sss=0.1)
    nb.set(normal=nb.bump(n, strength=0.3, dist=0.0008))


@define("clock_dial")
def _dial(nb):
    nb.set(base=srgb("#efe8d4"), rough=0.3)


@define("marble_black")
def _mb(nb):
    n = nb.noise(nb.vec(scale=(4, 4, 4)), scale=4, detail=8, dist=3.0)
    nb.view = srgb("#1c1c1c")
    nb.set(base=nb.ramp(n, [(0.47, srgb("#141414")), (0.5, srgb("#6a6660")), (0.53, srgb("#181818"))]), rough=0.12, coat=0.6)


@define("chart_paper")
def _chart(nb):
    n = nb.noise(nb.vec(scale=(20, 20, 20)), scale=4, detail=5)
    nb.view = srgb("#e3d6b4")
    nb.set(base=nb.mix(0.15, srgb("#e3d6b4"), n, blend="OVERLAY"), rough=0.8)


@define("painting_landscape")
def _paint_l(nb):
    """An oil landscape suggested by bands: sky, distant hills, a meadow, brush texture."""
    sep = nb.n("ShaderNodeSeparateXYZ", x=-700)
    nb.link(nb.uv(), 0, sep, 0)
    wob = nb.noise(nb.vec(scale=(6, 6, 6)), scale=4, detail=6)
    h = nb.math("MULTIPLY_ADD", (wob, 0), 0.12, x=-500)
    nb.link(sep, 1, h, 2)
    r = nb.ramp(h, [(0.0, srgb("#4c5a2c")), (0.35, srgb("#7d8a48")), (0.42, srgb("#5d6f7a")), (0.55, srgb("#9aa8a8")),
                    (0.8, srgb("#d8c9a0")), (1.0, srgb("#c9b48a"))])
    brush = nb.noise(nb.vec(scale=(120, 40, 1)), scale=5, detail=3)
    nb.view = srgb("#8a8a6a")
    nb.set(base=r, rough=0.45, coat=0.4)
    nb.set(normal=nb.bump(brush, strength=0.2, dist=0.001))


@define("painting_portrait")
def _paint_p(nb):
    sep = nb.n("ShaderNodeSeparateXYZ", x=-700)
    nb.link(nb.uv(), 0, sep, 0)
    d = nb.math("SUBTRACT", (sep, 0), 0.5)
    d2 = nb.math("MULTIPLY", d, d)
    e = nb.math("SUBTRACT", (sep, 1), 0.62)
    e2 = nb.math("MULTIPLY", e, e)
    s = nb.math("ADD", d2, e2)
    r = nb.ramp(s, [(0.0, srgb("#c99a7a")), (0.03, srgb("#a87a5a")), (0.05, srgb("#2a2018")), (0.3, srgb("#3a3024"))])
    nb.view = srgb("#3a3024")
    nb.set(base=r, rough=0.4, coat=0.5)


for _c, _hex in (("red", "#7a2a22"), ("green", "#2e4a32"), ("blue", "#2a3a5a"), ("brown", "#5a3a22"), ("ochre", "#a37a3a"),
                 ("black", "#1e1c1a")):
    def _mk(hexcol):
        def fn(nb):
            n = nb.noise(nb.vec(scale=(60, 60, 60)), scale=5, detail=3)
            nb.view = srgb(hexcol)
            nb.set(base=nb.mix(0.15, srgb(hexcol), n, blend="OVERLAY"), rough=0.7, sheen=0.2)
        return fn
    DEFS["book_" + _c] = _mk(_hex)


@define("felt_hat")
def _felt(nb):
    nb.set(base=srgb("#2a2622"), rough=0.9, sheen=0.4)


@define("umbrella")
def _umb(nb):
    nb.set(base=srgb("#1d1f24"), rough=0.6, sheen=0.3)


@define("glass_jar")
def _gj(nb):
    nb.view = srgb("#b9cfc8")
    nb.set(base=srgb("#dfe9e2"), rough=0.05, trans=1.0, ior=1.5)


@define("jar_contents")
def _jc(nb):
    n = nb.noise(nb.vec(scale=(50, 50, 50)), scale=5, detail=3)
    nb.view = srgb("#a8632e")
    nb.set(base=nb.ramp(n, [(0.3, srgb("#8a3a1e")), (0.7, srgb("#c4843a"))]), rough=0.5)


@define("whisky")
def _wh(nb):
    nb.view = srgb("#a8641e")
    nb.set(base=srgb("#b8701e"), rough=0.05, trans=0.9, ior=1.36)


@define("frame_green")
def _fg(nb):
    nb.set(base=srgb("#1f3a2a"), rough=0.25, coat=0.8, metal=0.3)


@define("coir")
def _coir(nb):
    n = nb.noise(nb.vec(scale=(150, 150, 150)), scale=6, detail=3)
    nb.view = srgb("#8a6a3e")
    nb.set(base=nb.mix(0.3, srgb("#8a6a3e"), n, blend="OVERLAY"), rough=0.95)
    nb.set(normal=nb.bump(n, strength=0.6, dist=0.002))
