"""Final trims of wall cladding where later elements meet it: porch roofs, the exterior chimney and
exterior door surrounds. Run after porch/details so the cutters exist."""
import bpy
from mathutils import Matrix

from . import core, geo
from . import plan as P
from . import siding

CLAD = ("Siding_", "BeltCourse", "WaterTable", "CornerBoards")


def build():
    objs = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(CLAD)]
    bodies = [bpy.data.objects.get(n) for n in ("Porch_Roof", "WestPorch_Roof", "RearStoop_HoodRoof")]
    bodies = [b for b in bodies if b is not None]
    x0, y0, x1, y1 = P.CHIMNEY_EXT
    doors = [o for o in P.openings(ext=True) if o["kind"] in ("door", "french")]
    for o in objs:
        cut = [core.dup(b) for b in bodies]
        if o.name.startswith("CornerBoards"):
            # the boards' feet sit 2 mm into the porch roofs: cut by the same plane as the siding beside
            # them, their cut faces lay coplanar with the siding's where the two meet
            for c in cut:
                c.matrix_world = Matrix.Translation((0.0, 0.0, -0.002)) @ c.matrix_world
        cut.append(core.geo_obj(geo.box(x0 - 0.005, y0 - 0.005, -1.0, x1 + 0.2, y1 + 0.005, 20.0), "_ch"))
        if o.name.startswith(("BeltCourse", "WaterTable")):
            for d in doors:
                cut.append(core.geo_obj(siding.trim_cutter(d, depth=0.3, z_lo=P.LEVELS[d["level"]] - 0.3), "_dc"))
        # keep only cutters overlapping this object's bounds
        lo = [min((o.matrix_world @ v.co)[k] for v in o.data.vertices) for k in range(3)]
        hi = [max((o.matrix_world @ v.co)[k] for v in o.data.vertices) for k in range(3)]
        keep = []
        for c in cut:
            cl = [min((c.matrix_world @ v.co)[k] for v in c.data.vertices) for k in range(3)]
            ch = [max((c.matrix_world @ v.co)[k] for v in c.data.vertices) for k in range(3)]
            if all(cl[k] < hi[k] and ch[k] > lo[k] for k in range(3)):
                keep.append(c)
            else:
                core.remove(c)
        if keep:
            core.boolean(o, keep, op="DIFFERENCE")
    fo = bpy.data.objects.get("Foundation")
    if fo is not None:
        cut = [core.geo_obj(geo.box(x0 - 0.01, y0 - 0.01, -1.0, x1 + 0.2, y1 + 0.01, 2.0), "_ch")]
        for d in doors:
            cut.append(core.geo_obj(siding.trim_cutter(d, depth=0.12, z_lo=P.LEVELS[d["level"]] - 0.17, z_hi=P.LEVELS[d["level"]] + 0.1), "_dc"))
        core.boolean(fo, cut, op="DIFFERENCE")
    core.finish_tmp()
