"""Review renders (Workbench) to blender/renders/ — geometry checks, not final look.

Views are named; plan views are orthographic top-down cuts (camera clip) through a storey.
"""
import math
import os

import bpy
from mathutils import Euler, Vector

OUT = "/Users/scott/Documents/Projects/Node/dysonCity/blender/renders"

VIEWS = {
    # name: (location, look_at, lens or ortho scale, ortho?, clip_start)
    "front": ((2.0, -42.0, 9.0), (-1.0, 4.0, 9.0), 35, False, 0.1),
    "front34": ((24.0, -32.0, 14.0), (-1.0, 4.0, 8.0), 35, False, 0.1),
    "frontleft": ((-28.0, -30.0, 12.0), (-2.0, 4.0, 8.0), 35, False, 0.1),
    "back34": ((-24.0, 40.0, 16.0), (-1.0, 6.0, 8.0), 35, False, 0.1),
    "backright": ((26.0, 36.0, 14.0), (0.0, 6.0, 8.0), 35, False, 0.1),
    "aerial": ((26.0, -30.0, 38.0), (-1.0, 5.0, 6.0), 35, False, 0.1),
    "porch": ((-0.5, -9.5, 2.6), (4.0, -2.0, 3.0), 24, False, 0.1),
    "roof": ((0.0, -14.0, 26.0), (-1.0, 5.0, 13.0), 30, False, 0.1),
}
PLAN_CUT = {0: 3.2, 1: 7.2, 2: 11.0}


def _cam(name="ReviewCam"):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cd = bpy.data.cameras.new(name)
        cam = bpy.data.objects.new(name, cd)
        bpy.context.scene.collection.objects.link(cam)
    return cam


def _look(cam, loc, at):
    cam.location = loc
    d = Vector(at) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def _setup(res=(1400, 1000), xray=False, shading="STUDIO"):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sh = sc.display.shading
    sh.light = shading
    sh.color_type = "MATERIAL"
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sh.show_shadows = False
    sh.show_object_outline = True
    sh.show_xray = xray
    sc.display.render_aa = "8"
    sc.render.film_transparent = False
    sc.world.color = (0.55, 0.62, 0.7) if sc.world else None


def render(view="front", res=(1400, 1000), fname=None, loc=None, at=None, lens=None):
    os.makedirs(OUT, exist_ok=True)
    sc = bpy.context.scene
    prev_engine = sc.render.engine
    prev_cam = sc.camera
    _setup(res)
    cam = _cam()
    if loc is None:
        loc, at, lens, ortho, clip = VIEWS[view]
    else:
        ortho, clip = False, 0.05
    cam.data.type = "ORTHO" if ortho else "PERSP"
    cam.data.lens = lens or 35
    cam.data.clip_start = clip
    cam.data.clip_end = 500
    _look(cam, loc, at)
    sc.camera = cam
    path = os.path.join(OUT, (fname or view) + ".png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    sc.render.engine = prev_engine
    sc.camera = prev_cam
    return path


def plan(level=0, res=(1600, 1200), fname=None, region=None):
    """Orthographic top-down cut through a storey (clip just above the cut height)."""
    os.makedirs(OUT, exist_ok=True)
    sc = bpy.context.scene
    prev_engine = sc.render.engine
    prev_cam = sc.camera
    _setup(res, shading="FLAT")
    sc.display.shading.show_cavity = False
    cam = _cam()
    cut = {0: 1.05 + 2.2, 1: 5.25 + 2.0, 2: 9.15 + 2.0}[level]
    cx, cy, size = region or (-1.5, 5.6, 26.0)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = size
    cam.location = (cx, cy, cut + 30)
    cam.rotation_euler = (0, 0, 0)
    cam.data.clip_start = 30.0
    cam.data.clip_end = 30 + cut + 1
    sc.camera = cam
    path = os.path.join(OUT, (fname or f"plan{level}") + ".png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    sc.display.shading.show_cavity = True
    sc.render.engine = prev_engine
    sc.camera = prev_cam
    return path


def views(*names):
    for n in names:
        render(n)


# ---------------------------------------------------------------- EEVEE review renders
# A review-only rig (sun, sky, lamp lights) in the "_Review" collection, outside House: it is not part
# of the export, it only lets the materials, glass and shadows be judged with real lighting.

def _review_rig(interior):
    sc = bpy.context.scene
    col = bpy.data.collections.get("_Review") or bpy.data.collections.new("_Review")
    if col.name not in sc.collection.children:
        sc.collection.children.link(col)
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    sun_d = bpy.data.lights.get("_ReviewSun") or bpy.data.lights.new("_ReviewSun", "SUN")
    sun_d.energy = 4.0
    sun_d.angle = math.radians(0.6)
    sun = bpy.data.objects.new("_ReviewSun", sun_d)
    sun.rotation_euler = (math.radians(50), 0.0, math.radians(-35))
    col.objects.link(sun)
    if interior:
        for e in bpy.data.objects:
            if e.type == "EMPTY" and e.name.startswith("Lamp_"):
                ld = bpy.data.lights.new("_RL_" + e.name, "POINT")
                ld.energy = float(e.get("watts", 60)) * 0.6
                ld.color = (1.0, 0.82, 0.6)
                ld.shadow_soft_size = 0.06
                lo = bpy.data.objects.new("_RL_" + e.name, ld)
                lo.location = e.matrix_world.translation
                col.objects.link(lo)
    w = sc.world or bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.42, 0.55, 0.75, 1.0)       # plain sky dome, review only
    bg.inputs["Strength"].default_value = 0.8
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs[0], out.inputs[0])


def render_eevee(fname, loc, at, lens=24, res=(1200, 850), interior=False, samples=48):
    os.makedirs(OUT, exist_ok=True)
    sc = bpy.context.scene
    _review_rig(interior)
    sc.render.engine = "BLENDER_EEVEE"
    ee = sc.eevee
    for attr, val in (("taa_render_samples", samples), ("use_shadows", True), ("use_raytracing", True)):
        if hasattr(ee, attr):
            setattr(ee, attr, val)
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.exposure = 0.3 if interior else 0.0
    cam = _cam()
    cam.data.type = "PERSP"
    cam.data.lens = lens
    cam.data.clip_start = 0.05
    cam.data.clip_end = 500
    _look(cam, loc, at)
    sc.camera = cam
    path = os.path.join(OUT, fname + ".png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path
