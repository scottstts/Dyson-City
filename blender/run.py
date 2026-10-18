"""Entry point executed inside Blender: reload the build package and run named builders.

From a shell:  blender/tools/bl.py -b shell.build_level:0 roofs.build
"""
import importlib
import sys
import time

BASE = "/Users/scott/Documents/Projects/Node/dysonCity/blender"
if BASE not in sys.path:
    sys.path.insert(0, BASE)


def reload():
    """Reload the build package twice so modules that import names from each other (from .x import y)
    pick up the fresh definitions regardless of order."""
    import build  # noqa: F401
    for _ in range(2):
        for name in sorted([m for m in sys.modules if m == "build" or m.startswith("build.")]):
            importlib.reload(sys.modules[name])


def go(*targets):
    reload()
    import bpy
    out = []
    for t in targets:
        mod, _, rest = t.partition(".")
        fn, _, arg = rest.partition(":")
        m = importlib.import_module(f"build.{mod}")
        t0 = time.time()
        args = list(eval("(" + arg + ",)")) if arg else []
        r = getattr(m, fn or "build")(*args)
        out.append(f"{t}: {time.time() - t0:.1f}s")
    for w in bpy.context.window_manager.windows:
        for a in w.screen.areas:
            a.tag_redraw()
    print("\n".join(out))
    return r


ALL = [
    "shell.build", "siding.build", "windows.build", "doors.build", "roofs.build", "cornice.build",
    "gables.build", "turret.build", "porch.build", "details.build", "stairs.build", "fireplaces.build", "interior.build", "rooms.build", "cuts.build", "finalize.build",
    "doorswing.build", "collision.build",
]


def build_all(save=True):
    import bpy
    # start from a clean scene: remove the House tree and orphans
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for o in list(bpy.data.objects):
        if o.type in ("MESH", "EMPTY", "CURVE", "LIGHT"):
            bpy.data.objects.remove(o, do_unlink=True)
    for blk in (bpy.data.meshes, bpy.data.curves, bpy.data.lights):
        for d in list(blk):
            if d.users == 0:
                blk.remove(d)
    go(*ALL)
    from build import mat
    mat.rebuild_all()          # no material may keep a stale graph (or the magenta placeholder) across builds
    from build import audit
    audit.run()
    if save:
        bpy.ops.wm.save_mainfile()


def bake_all(save=True):
    """The interior light under the game's light (bake/house_env.hdr from tools/house-env.mjs):
    lightmaps, probe grid, reflection captures. Run after build_all (which drops the lightmap UVs);
    takes 3–4 hours: run it headless (blender/docs/house.md "Workflow")."""
    import bpy
    reload()
    from build import bake
    bake.run()
    if save:
        bpy.ops.wm.save_mainfile()


def export_all():
    """assets/house.pack: material texture bake, glTF parts, lightmaps/probes/reflections, index.
    Run after bake_all."""
    reload()
    from build import export
    return export.run()
