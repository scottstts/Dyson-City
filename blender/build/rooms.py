"""Furnishing: every room laid out against its doors, windows, hearths and stairs.

Each distinct piece is built once as a prototype (hidden collection) and placed as linked
duplicates, so repeated chairs, lamps and books share one mesh. Placement convention: a piece's
front faces local -y; rz rotates it about Z (rz=+90 deg faces +x, -90 faces -x, 180 faces +y).
Lamps and sound sources get named empties for the engine (House/Engine/...).
"""
import math

import bpy
import numpy as np
from mathutils import Matrix

from . import core, geo
from . import plan as P
from . import furniture as F
from .windows import frame_matrix, bay_face_len

COL = "House/Furniture"
PROTO = "House/Furniture/_Prototypes"
_cache = {}
D2R = math.pi / 180


MAKERS = {}      # key -> maker, so the audit can rebuild a kit's raw pieces (before they are unioned)


def proto(key, maker):
    """Build (once) a prototype object for a kit."""
    MAKERS[key] = maker
    if key in _cache and _cache[key].name in bpy.data.objects:
        return _cache[key]
    kit = maker()
    mats = list(kit.keys())
    g = core.Geo()
    for i, m in enumerate(mats):
        g.add(kit[m], i)
    o = core.obj(f"Proto_{key}", g, PROTO, mats, smooth=35, clean=True)
    _cache[key] = o
    return o


def put(room, item, key, maker, x, y, rz=0.0, z=None, level=None):
    lv = level if level is not None else next((r["level"] for r in P.ROOMS if r["name"] == room), 0)
    zz = P.LEVELS[lv] if z is None else z
    src = proto(key, maker)
    M = Matrix.Translation((x, y, zz)) @ Matrix.Rotation(rz * D2R, 4, "Z")
    o = core.instance(src, f"Furn_{room}_{item}", f"{COL}/{room}", M)
    return o


def lamp_empty(name, loc, kind="lamp", watts=60):
    core.empty(f"Lamp_{name}", "House/Engine/Lamps", loc, props={"kind": kind, "watts": watts})


def sound_empty(name, loc, clip, loop=True, gain=1.0):
    core.empty(f"Sound_{name}", "House/Engine/Sounds", loc, kind="SPHERE", size=0.15,
               props={"clip": clip, "loop": loop, "gain": gain})


# ---------------------------------------------------------------- curtains

NO_CURTAINS = {"WC", "Pantry", "MasterBath", "Bath"}
SHEER_ONLY = {"Kitchen", "BoxRoom", "MaidsRoom", "TopHall"}


def build_curtains():
    from .windows import room_for_opening
    rng = np.random.default_rng(21)
    for o in P.openings(ext=True):
        if o["kind"] != "window":
            continue
        r = room_for_opening(o)
        if r is None or r["name"] in NO_CURTAINS:
            continue
        W = o["w"] + 0.1
        pole_over, drapes = 0.25, True
        if o.get("bay") and abs(bay_face_len(o) - 1.414) < 0.05:
            W, pole_over, drapes = o["w"] + 0.04, 0.06, False       # the bay's narrow cants: sheers only
        elif o.get("bay"):
            W = o["w"] + 0.1
        elif o.get("curved"):
            W = o["w"]
        else:
            # room each side of the window, up to the nearest wall or furniture: the drapes' stack
            # needs about 0.25 m beyond the glass, otherwise the window gets a sheer on a short pole
            avail = _side_room(o) - 0.04
            if avail >= o["w"] / 2 + 0.28:
                pole_over = min(0.25, avail - W / 2)
            else:
                W, pole_over, drapes = o["w"] + 0.04, max(0.03, min(0.06, avail - (o["w"] + 0.04) / 2)), False
        head = o["head"]
        sheer_only = r["name"] in SHEER_ONLY or o["level"] == 2
        fabric = {"Parlour": "velvet_drape", "Dining": "velvet_mustard", "Music": "velvet_rust", "Library": "velvet_teal",
                  "Study": "velvet_teal", "Master": "velvet_drape", "Bedroom": "velvet_rust"}.get(r["name"], "velvet_drape")
        key = f"curtain_{round(W, 2)}_{round(head, 2)}_{fabric}_{sheer_only}_{drapes}_{round(pole_over, 3)}_{round(o['sill'], 2)}_{r['name'] == 'Kitchen'}"
        Hc = head + 0.22
        # over the kitchen sink the lace is a short valance (taps and splashes below)
        drop = o["head"] - 0.75 if r["name"] == "Kitchen" else o["sill"]
        maker = (lambda W=W, Hc=Hc, fabric=fabric, sheer_only=sheer_only, po=pole_over, dr=drapes, sill=drop:
                 F.curtains(W, Hc, 0.02, sheer=True, fabric=fabric, tie=not sheer_only, pole_over=po, drapes=dr) if not sheer_only else
                 _sheer_only(W, Hc, sill))
        src = proto(key, maker)
        # curtains hang in front of the inner wall face: local y into the room, z from the floor
        M = frame_matrix(o) @ Matrix.Translation((0, -P.TE - (0.14 if o.get("curved") else 0.0), -o["sill"])) @ Matrix.Rotation(math.pi, 4, "Z")
        ob = core.instance(src, f"Curtain_{o['name']}", f"{COL}/{r['name']}", M)


def _side_room(o):
    """Clear distance from the window's centre line to the nearest wall or piece of furniture on
    either side, along the wall, 0.12-0.4 m out from it and at drape-stack heights (the smaller side)."""
    from mathutils import Vector
    dg = bpy.context.evaluated_depsgraph_get()
    sc = bpy.context.scene
    a = o["ang"]
    n = np.array([math.cos(a), math.sin(a)])
    t = np.array([-n[1], n[0]])
    best = 9.0
    for off in (0.12, 0.25, 0.4):
        p = np.array(o["p"]) - n * (P.TE + off)
        for z in (0.9, 1.4, o["head"] + 0.2):
            zz = P.LEVELS[o["level"]] + z
            for sg in (1, -1):
                org = Vector((p[0], p[1], zz))
                d = Vector((sg * t[0], sg * t[1], 0.0))
                for _ in range(8):
                    ok, loc, nrm, idx, ob, mw = sc.ray_cast(dg, org, d)
                    if not ok:
                        break
                    if ob.name.startswith(("Curtain_", "Win_")) or ob.hide_get():
                        org = loc + d * 1e-3       # look past other dressings and the window's own trim
                        continue
                    best = min(best, (loc - Vector((p[0], p[1], zz))).length)
                    break
    return best


def _sheer_only(W, Hc, sill):
    """Lace panel from the pole to the sill (kitchen, attics)."""
    k = F.curtains(W, Hc, sill - 0.02, sheer=True, fabric="velvet_drape", tie=False)
    k.pop("velvet_drape", None)
    return k


# ---------------------------------------------------------------- rooms

def pendant(room, x, y, level, big=True):
    ceil = P.CEIL[level] - 0.085          # hung from the boss of the ceiling rose
    drop = 1.0 if big else 0.7
    put(room, "Pendant", f"pendant_{big}", lambda big=big: F.pendant_bowl(drop=1.0 if big else 0.7, r=0.32 if big else 0.22),
        x, y, z=ceil)
    lamp_empty(f"{room}_Pendant", (x, y, ceil - drop - 0.05), kind="pendant", watts=100 if big else 60)


def table_lamp_on(room, item, x, y, z, rz=0.0):
    put(room, item, "table_lamp", F.table_lamp, x, y, rz, z=z)
    lamp_empty(f"{room}_{item}", (x, y, z + 0.5), kind="table_lamp", watts=40)


def picture_on_wall(room, item, x, y, z, rz, w=0.7, h=0.55, kind="landscape"):
    put(room, item, f"picture_{w}_{h}_{kind}", lambda w=w, h=h, kind=kind: F.picture(w, h, kind), x, y, rz, z=z)


def ground():
    G = P.G
    rng = np.random.default_rng(31)
    # Vestibule -------------------------------------------------------------------------------
    put("Vestibule", "HallStand", "hall_stand", F.hall_stand, -1.525 + 0.16, 1.12, 90)
    put("Vestibule", "Umbrellas", "umbrella_stand", F.umbrella_stand, 1.15, 0.62, 0)
    put("Vestibule", "Mat", "door_mat_1.2", lambda: F.door_mat(1.2, 0.6), 0.0, 0.72, 0)
    # Hall ------------------------------------------------------------------------------------
    put("Hall", "Clock", "longcase", F.clock_longcase, -1.525 + 0.19, 6.62, 90)
    sound_empty("Hall_Clock", (-1.3, 6.62, G + 1.85), "clock_tick_longcase")
    put("Hall", "Console", "console_0.9", lambda: F.console_table(0.9, 0.36, 0.8), -1.525 + 0.22, 5.25, 90)
    table_lamp_on("Hall", "ConsoleLamp", -1.525 + 0.215, 5.0, G + 0.8)
    put("Hall", "Runner", "rug_runner", lambda: F.rug(1.0, 6.0, "stair_runner"), -0.35, 5.95, 0)     # clear of the vestibule doors' swing
    picture_on_wall("Hall", "Picture1", -1.525, 5.25, G + 1.55, 90, 0.8, 0.6, "landscape")
    pendant("Hall", 0.25, 5.4, 0, big=False)
    # Parlour ---------------------------------------------------------------------------------
    pr = "Parlour"
    put(pr, "Rug", "rug_parlour", lambda: F.rug(3.3, 2.5, "rug_parlour"), -4.75, 3.2, 90)
    put(pr, "Sofa", "sofa_2.3", lambda: F.sofa(2.3), -3.2, 3.2, -90)
    put(pr, "CoffeeTable", "round_table", F.round_table, -4.95, 3.2, 0)
    put(pr, "Bowl", "fruit_bowl", F.bowl_of_fruit, -4.85, 3.05, 0, z=G + 0.48)
    put(pr, "Vase", "vase_green", lambda: F.vase(0.3, 0.1), -5.15, 3.35, 0, z=G + 0.48)
    put(pr, "Armchair1", "armchair_rust", F.armchair, -6.45, 1.75, 135)
    put(pr, "Armchair2", "armchair_rust", F.armchair, -6.45, 4.65, 45)
    put(pr, "Ottoman", "ottoman", F.ottoman, -5.35, 5.35, 0)
    put(pr, "SideTable1", "side_table", F.side_table, -3.2, 1.7, 0)
    put(pr, "SideTable2", "side_table", F.side_table, -3.2, 4.7, 0)
    table_lamp_on(pr, "Lamp1", -3.2, 1.7, G + 0.62)
    table_lamp_on(pr, "Lamp2", -3.2, 4.7, G + 0.62)
    put(pr, "BayTable", "round_table_tea", lambda: F.round_table(0.42, 0.72, legs=3), -5.0, -1.55, 0)
    put(pr, "BayChair1", "carver", lambda: F.dining_chair(arms=True), -5.85, -1.7, 90)
    put(pr, "BayChair2", "carver", lambda: F.dining_chair(arms=True), -4.15, -1.7, -90)
    put(pr, "Palm1", "palm", F.potted_palm, -7.45, -0.6, 0)
    put(pr, "Palm2", "palm", F.potted_palm, -2.35, -0.6, 70)
    put(pr, "Bookcase", "bookcase_1.0", lambda: F.bookcase(1.0, 2.2, 0.36, 6, np.random.default_rng(5)), -8.1 + 0.22, 0.55, 90)
    put(pr, "MantelClock", "mantel_clock", F.mantel_clock, -7.68 + 0.13, 3.2, 90, z=G + 1.27)
    sound_empty("Parlour_Clock", (-7.55, 3.2, G + 1.45), "clock_tick_mantel", gain=0.6)
    for i, y in enumerate((2.55, 3.85)):
        put(pr, f"Candle{i}", "candlestick", F.candlestick, -7.68 + 0.12, y, 0, z=G + 1.27)
    picture_on_wall(pr, "Picture1", -1.675, 1.2, G + 1.6, -90, 0.9, 0.7, "landscape")
    picture_on_wall(pr, "Picture2", -1.675, 5.35, G + 1.6, -90, 0.55, 0.7, "portrait")
    pendant(pr, -4.89, 2.51, 0)
    # Library ---------------------------------------------------------------------------------
    lb = "Library"
    shelves = [(-12.9 + 0.22, 2.0, 90, 1.0), (-12.9 + 0.22, 4.75, 90, 1.0), (-12.9 + 0.22, 5.85, 90, 1.0), (-12.9 + 0.22, 8.45, 90, 1.0),
               (-12.06, 9.3 - 0.22, 0, 0.8), (-9.3, 9.3 - 0.22, 0, 1.0), (-8.4 - 0.22, 6.9, -90, 1.0), (-8.4 - 0.22, 7.95, -90, 1.0),
               (-12.08, 1.3 + 0.22, 180, 0.8), (-9.3, 1.3 + 0.22, 180, 1.0)]
    for i, (x, y, rz, w) in enumerate(shelves):
        put(lb, f"Bookcase{i}", f"bookcase_lib{i % 3}_{w}", lambda i=i, w=w: F.bookcase(w, 2.3, 0.36, 6, np.random.default_rng(100 + i % 3)), x, y, rz)
    put(lb, "Rug", "rug_dining", lambda: F.rug(3.0, 2.2, "rug_dining"), -10.8, 5.2, 90)
    put(lb, "Table", "library_table", lambda: F.dining_table(1.6, 0.9, 0.76), -10.9, 5.3, 90)
    put(lb, "Chair1", "carver", lambda: F.dining_chair(arms=True), -11.75, 5.3, 90)
    put(lb, "Chair2", "carver", lambda: F.dining_chair(arms=True), -10.05, 5.3, -90)
    table_lamp_on(lb, "TableLamp", -10.9, 5.85, G + 0.76)
    put(lb, "Armchair1", "armchair_rust", F.armchair, -10.0, 2.4, 60)
    put(lb, "Armchair2", "armchair_rust", F.armchair, -10.0, 4.15, 120)
    put(lb, "Globe", "globe", F.globe, -12.0, 3.4, 30)
    pendant(lb, -10.65, 5.3, 0, big=False)
    # Dining ----------------------------------------------------------------------------------
    dn = "Dining"
    cx, cy = -4.9, 9.9
    put(dn, "Rug", "rug_dining_big", lambda: F.rug(4.0, 2.8, "rug_dining"), cx, cy, 0)
    put(dn, "Table", "dining_table", F.dining_table, cx, cy, 0)
    for i, x in enumerate((-5.8, -4.9, -4.0)):
        put(dn, f"ChairS{i}", "dining_chair", F.dining_chair, x, cy - 0.82, 180)
        put(dn, f"ChairN{i}", "dining_chair", F.dining_chair, x, cy + 0.82, 0)
    put(dn, "CarverW", "carver", lambda: F.dining_chair(arms=True), -6.55, cy, 90)
    put(dn, "CarverE", "carver", lambda: F.dining_chair(arms=True), -3.25, cy, -90)
    put(dn, "Sideboard1", "sideboard", F.sideboard, -1.675 - 0.33, 10.35, -90)
    put(dn, "Sideboard2", "sideboard", F.sideboard, -3.2, 6.675 + 0.33, 180)
    for i, (x, y) in enumerate(((-1.95, 9.7), (-1.95, 11.0), (-3.9, 6.98), (-2.5, 6.98))):
        table_lamp_on(dn, f"Lamp{i}", x, y, G + 0.92)
    put(dn, "Flowers", "vase_flowers", lambda: _vase_flowers(), cx, cy, 0, z=G + 0.76)
    for i, dx in enumerate((-0.6, 0.6)):
        put(dn, f"Candle{i}", "candlestick", F.candlestick, cx + dx, cy, 0, z=G + 0.76)
    put(dn, "Fruit", "fruit_bowl", F.bowl_of_fruit, cx + 0.3, cy - 0.15, 0, z=G + 0.76)
    put(dn, "BarCart", "bar_cart", F.bar_cart, -2.3, 12.35, 0)
    picture_on_wall(dn, "Picture1", -1.675, 9.5, G + 1.7, -90, 0.8, 0.6, "landscape")
    pendant(dn, cx, cy, 0)
    # Music -----------------------------------------------------------------------------------
    mu = "Music"
    put(mu, "Piano", "piano", F.upright_piano, 5.9 - 0.35, 1.95, -90)
    put(mu, "PianoStool", "piano_stool", F.piano_stool, 4.92, 1.95, -90)
    put(mu, "Sofa", "sofa_2.0", lambda: F.sofa(2.0, "velvet_teal"), 4.05, 4.25, 180)
    put(mu, "Rug", "rug_bed", lambda: F.rug(2.6, 2.0, "rug_parlour"), 4.05, 4.6, 0)
    put(mu, "TurretTable", "round_table_tea", lambda: F.round_table(0.42, 0.72, legs=3), 4.05, -0.85, 0)
    put(mu, "TurretChair1", "carver", lambda: F.dining_chair(arms=True), 3.25, -1.0, 60)
    put(mu, "TurretChair2", "carver", lambda: F.dining_chair(arms=True), 4.85, -1.0, -60)
    put(mu, "Tea", "tea_set", F.teacup_set, 4.05, -0.85, 0, z=G + 0.72)
    table_lamp_on(mu, "PianoLamp", 5.6, 1.4, G + 1.33)
    pendant(mu, 4.04, 3.09, 0, big=False)
    # Morning ---------------------------------------------------------------------------------
    mo = "Morning"
    put(mo, "Table", "round_table_breakfast", lambda: F.round_table(0.55, 0.76, legs=4), 8.0, 6.6, 0)
    for i, a in enumerate((90, 210)):
        ra = a * D2R
        put(mo, f"Chair{i}", "dining_chair", F.dining_chair, 8.0 + 0.85 * math.cos(ra), 6.6 + 0.85 * math.sin(ra), a + 90)
    put(mo, "Desk", "desk_small", lambda: F.desk(1.2, 0.6, 0.76), 9.5 - 0.35, 5.6, -90)
    put(mo, "DeskChair", "dining_chair", F.dining_chair, 8.6, 5.6, -90 + 180)
    put(mo, "Armchair", "armchair_mustard", lambda: F.armchair("velvet_mustard"), 6.85, 3.25, 135)
    put(mo, "Palm", "palm", F.potted_palm, 8.85, 3.35, 0)
    put(mo, "Flowers", "vase_flowers", lambda: _vase_flowers(), 8.0, 6.6, 0, z=G + 0.76)
    table_lamp_on(mo, "DeskLamp", 9.285, 6.0, G + 0.76)
    # Rear hall, WC, kitchen, pantry ----------------------------------------------------------
    put("RearHall", "Bench", "bench", lambda: F.console_table(1.0, 0.36, 0.46), -1.525 + 0.2, 10.5, 90)
    put("RearHall", "Umbrellas", "umbrella_stand", F.umbrella_stand, 1.8, 12.4, 0)
    put("RearHall", "Mat", "door_mat_0.9", lambda: F.door_mat(0.9, 0.55), 1.1, 12.35, 0)
    put("WC", "WC", "wc", F.wc_high_cistern, -1.26, 12.7 - 0.33, 0)
    kt = "Kitchen"
    put(kt, "Table", "kitchen_table", F.kitchen_table, 3.8, 9.3, 90)
    for i, (x, y, rz) in enumerate(((3.1, 8.85, 90), (3.1, 9.75, 90), (4.5, 8.85, -90), (4.5, 9.75, -90))):
        put(kt, f"Chair{i}", "windsor", F.windsor_chair, x, y, rz)
    put(kt, "Dresser", "dresser", F.dresser, 5.9 - 0.3, 9.85, -90)
    put(kt, "Sink", "butler_sink_l", lambda: F.butler_sink(board_left=True), 3.35, 12.7 - 0.3, 0, z=G + 0.66)
    put(kt, "Kettle", "kettle", F.kettle, 3.55, 7.0, 0, z=G + 0.98)
    put(kt, "Pot", "pot", F.pot, 4.75, 7.0, 30, z=G + 0.98)
    put(kt, "Shelf", "shelf_jars", lambda: F.shelf_with_jars(1.2), 2.175 + 0.13, 8.3, 90, z=G + 1.55)
    sound_empty("Kitchen_Kettle", (3.55, 7.0, G + 1.1), "kettle_simmer", gain=0.5)
    pendant(kt, 3.8, 9.3, 0, big=False)
    for i, z in enumerate((0.9, 1.35, 1.8)):
        put("Pantry", f"ShelfE{i}", "shelf_jars_1.4", lambda: F.shelf_with_jars(1.4), 5.9 - 0.13, 11.9, -90, z=G + z)
        put("Pantry", f"ShelfN{i}", "shelf_jars_0.6", lambda: F.shelf_with_jars(0.6), 5.3, 11.075 + 0.13, 180, z=G + z)   # back wall is window


def _vase_flowers():
    k = F.vase(0.32, 0.11, "ceramic_green")
    from .details import plant_clump
    lv, fl = plant_clump(np.random.default_rng(8), 0.32, 0.32, h=0.38, n_leaf=40, n_fl=26)
    k.put("leaf", lv.move(0, 0, 0.28))
    k.put("petal_white", fl.move(0, 0, 0.28))
    return k


def first():
    L1 = P.L1
    # Landing ---------------------------------------------------------------------------------
    put("Landing", "Runner", "rug_runner_g", lambda: F.rug(0.8, 6.6, "stair_runner"), 0.22, 5.9, 0)
    put("Landing", "Chair", "dining_chair", F.dining_chair, 1.05, 0.72, 180)
    pendant("Landing", 0.25, 5.8, 1, big=False)
    # Master ----------------------------------------------------------------------------------
    ms = "Master"
    put(ms, "Bed", "bed_double", F.bed_v2, -5.0, 6.525 - 1.05 - 0.08, 0)
    put(ms, "Rug", "rug_bed", lambda: F.rug(2.6, 1.8, "rug_bed"), -5.0, 4.2, 0)
    put(ms, "Wardrobe", "wardrobe", F.wardrobe, -1.675 - 0.35, 4.15, -90)
    put(ms, "Chest", "chest", F.chest_of_drawers, -8.1 + 0.3, 0.95, 90)
    put(ms, "Mirror", "dressing_mirror", F.dressing_mirror, -8.1 + 0.3, 0.95, 90, z=L1 + 0.95)
    for i, x in enumerate((-6.15, -3.85)):
        put(ms, f"NightTable{i}", "side_table", F.side_table, x, 6.05, 0)
        table_lamp_on(ms, f"Lamp{i}", x, 6.05, L1 + 0.62)
    put(ms, "Ottoman", "ottoman", F.ottoman, -5.0, 3.35, 0)
    put(ms, "BayChair", "armchair_mustard", lambda: F.armchair("velvet_mustard"), -5.0, -1.6, 180)
    put(ms, "FireChair", "armchair_mustard", lambda: F.armchair("velvet_mustard"), -6.6, 2.2, -132)
    picture_on_wall(ms, "OverBed", -5.0, 6.525, L1 + 1.75, 0, 0.8, 0.55, "landscape")
    pendant(ms, -4.89, 2.51, 1, big=False)
    # Dressing --------------------------------------------------------------------------------
    dr = "Dressing"
    put(dr, "Wardrobe", "wardrobe_1.2", lambda: F.wardrobe(1.2), -12.9 + 0.35, 4.9, 90)
    put(dr, "Table", "chest_0.9", lambda: F.chest_of_drawers(0.9, 0.5, 0.78), -9.25, 1.3 + 0.3, 180)
    put(dr, "Mirror", "dressing_mirror", F.dressing_mirror, -9.25, 1.3 + 0.3, 180, z=L1 + 0.78)
    put(dr, "Armchair", "armchair_rust", F.armchair, -9.65, 3.2, 90)
    # Master bath -----------------------------------------------------------------------------
    mb = "MasterBath"
    put(mb, "Tub", "tub", F.clawfoot_tub, -8.4 - 0.46, 7.05, 90)
    put(mb, "Basin", "basin", F.pedestal_basin, -12.3, 9.3 - 0.3, 0)
    put(mb, "WC", "wc", F.wc_high_cistern, -12.9 + 0.32, 8.65, 90)
    put(mb, "Towels", "towel_rail", F.towel_rail, -9.7, 9.3 - 0.15, 0)
    # Bedroom ---------------------------------------------------------------------------------
    bd = "Bedroom"
    put(bd, "Bed", "bed_double", F.bed_v2, -5.0, 6.675 + 1.05 + 0.08, 180)
    put(bd, "Rug", "rug_bed", lambda: F.rug(2.6, 1.8, "rug_bed"), -5.0, 8.9, 0)
    put(bd, "Wardrobe", "wardrobe", F.wardrobe, -1.675 - 0.35, 7.95, -90)
    put(bd, "Washstand", "washstand", F.washstand, -8.1 + 0.31, 7.7, 90)
    for i, x in enumerate((-6.15, -3.85)):
        put(bd, f"NightTable{i}", "side_table", F.side_table, x, 7.15, 0)
        table_lamp_on(bd, f"Lamp{i}", x, 7.15, L1 + 0.62)
    put(bd, "BayChair", "armchair_rust", F.armchair, -5.0, 13.1, 0)
    put(bd, "FireChair", "armchair_rust", F.armchair, -6.6, 10.2, -126)          # turned to the fire
    put(bd, "FireTable", "side_table", F.side_table, -6.15, 11.35, 0)
    table_lamp_on(bd, "FireLamp", -6.15, 11.35, L1 + 0.62)
    put(bd, "Chest", "chest", F.chest_of_drawers, -1.675 - 0.3, 11.55, -90)       # clear of the landing door
    put(bd, "Mirror", "dressing_mirror", F.dressing_mirror, -1.675 - 0.3, 11.55, -90, z=L1 + 0.95)
    put(bd, "Ottoman", "ottoman", F.ottoman, -5.0, 9.75, 0)
    picture_on_wall(bd, "OverBed", -5.0, 6.675, L1 + 1.75, 180, 0.8, 0.55, "landscape")
    pendant(bd, -4.89, 9.69, 1, big=False)
    # Study -----------------------------------------------------------------------------------
    st = "Study"
    put(st, "Desk", "desk", F.desk, 4.1, 0.55, 180)
    put(st, "DeskChair", "desk_chair", F.desk_chair, 4.1, 1.35, 0)
    table_lamp_on(st, "DeskLamp", 4.65, 0.45, L1 + 0.76)
    put(st, "Books", "books_pile", lambda: F.books_row(0.4, 0.25, np.random.default_rng(3)), 3.6, 0.5, 90, z=L1 + 0.76)
    for i, y in enumerate((2.95, 4.0, 5.05)):
        put(st, f"Bookcase{i}", f"bookcase_lib{i % 3}", lambda i=i: F.bookcase(1.0, 2.3, 0.36, 6, np.random.default_rng(100 + i % 3)),
            2.175 + 0.22, y, 90)
    put(st, "Globe", "globe", F.globe, 5.3, 2.9, 0)
    put(st, "Armchair1", "armchair_rust", F.armchair, 3.35, 5.05, 180)
    put(st, "Armchair2", "armchair_rust", F.armchair, 4.65, 5.15, 180)
    put(st, "Rug", "rug_study", lambda: F.rug(2.6, 2.0, "rug_dining"), 4.1, 3.6, 0)
    pendant(st, 4.04, 3.09, 1, big=False)
    # Chart room ------------------------------------------------------------------------------
    ch = "ChartRoom"
    put(ch, "PlanChest", "plan_chest", F.plan_chest, 7.95, 5.6, 0)
    put(ch, "OrreryTable", "round_table_orrery", lambda: F.round_table(0.4, 0.76, legs=3), 8.45, 7.75, 0)
    put(ch, "Orrery", "orrery", F.orrery, 8.45, 7.75, 0, z=L1 + 0.76)
    put(ch, "Bookcase", "bookcase_lib1", lambda: F.bookcase(1.0, 2.3, 0.36, 6, np.random.default_rng(101)), 6.2 + 0.22, 7.2, 90)
    put(ch, "Chair", "desk_chair", F.desk_chair, 7.95, 4.75, 180)
    picture_on_wall(ch, "Chart1", 6.2, 6.0, L1 + 1.5, 90, 0.9, 0.65, "landscape")
    pendant(ch, 7.85, 5.7, 1, big=False)
    # Guest -----------------------------------------------------------------------------------
    gs = "Guest"
    put(gs, "Bed", "bed_double", F.bed_v2, 5.9 - 1.05 - 0.08, 9.45, -90)
    put(gs, "Wardrobe", "wardrobe", F.wardrobe, 2.175 + 0.35, 11.85, 90)
    put(gs, "Washstand", "washstand", F.washstand, 2.175 + 0.31, 8.0, 90)
    put(gs, "NightTable", "side_table", F.side_table, 5.5, 8.3, 0)
    table_lamp_on(gs, "Lamp", 5.5, 8.3, L1 + 0.62)
    put(gs, "Rug", "rug_bed", lambda: F.rug(2.6, 1.8, "rug_bed"), 4.0, 9.85, 90)    # clear of the door's swing
    pendant(gs, 4.04, 9.69, 1, big=False)
    # Bath ------------------------------------------------------------------------------------
    put("Bath", "Tub", "tub", F.clawfoot_tub, -0.65, 12.7 - 0.46, 0)
    put("Bath", "Basin", "basin", F.pedestal_basin, 2.025 - 0.3, 11.6, -90)
    put("Bath", "WC", "wc", F.wc_high_cistern, 2.025 - 0.3, 12.3, -90)


def top():
    L2 = P.L2
    put("TopHall", "Runner", "rug_runner_t", lambda: F.rug(0.8, 6.0, "stair_runner"), 0.8, 6.2, 0)
    put("TopHall", "Trunk", "trunk", F.trunk, 1.4, 11.9, 0)
    gr = "GableRoom"
    put(gr, "Bed", "bed_single", F.single_bed, -8.1 + 0.62, 2.8, 0)
    put(gr, "Desk", "desk_small", lambda: F.desk(1.2, 0.6, 0.76), -5.0, -1.5 + 0.37, 180)
    put(gr, "Chair", "dining_chair", F.dining_chair, -5.0, -0.5, 0)
    put(gr, "Chest", "chest", F.chest_of_drawers, -2.5, 5.525 - 0.3, 0)
    put(gr, "Wardrobe", "wardrobe", F.wardrobe, -4.4, 5.525 - 0.32, 0)
    put(gr, "Washstand", "washstand", F.washstand, -1.675 - 0.31, 3.6, -90)
    put(gr, "Trunk", "trunk", F.trunk, -7.48, 1.4, 0)
    # the gable's roof slopes come down at the sides: only a low bookcase fits by the front wall
    put(gr, "Bookcase", "bookcase_low", lambda: F.bookcase(1.0, 1.2, 0.3, 3, np.random.default_rng(7)), -7.3, -1.5 + 0.17, 180)
    put(gr, "Armchair", "armchair_rust", F.armchair, -2.45, -0.45, -136)
    put(gr, "Table", "side_table", F.side_table, -3.05, -1.1, 0)        # under the ridge side of the slope
    table_lamp_on(gr, "Lamp", -3.05, -1.1, L2 + 0.62)
    picture_on_wall(gr, "Picture1", -1.675, 4.3, L2 + 1.5, -90, 0.5, 0.65, "portrait")
    put(gr, "Rug", "rug_gable", lambda: F.rug(2.4, 1.7, "rug_bed"), -5.0, 2.2, 0)
    tr = "TurretRoom"
    cx, cy = P.TURRET
    put(tr, "Seat", "window_seat", lambda: F.window_seat_curved(P.TR2 - P.TE - 0.03, math.radians(200), math.radians(370)), cx, cy, 0)
    put(tr, "Telescope", "telescope", F.telescope, cx - 0.2, cy + 0.5, 200, z=P.L2 + 0.007)   # tilted leg tips just touch the boards
    put(tr, "Armchair", "armchair_mustard", lambda: F.armchair("velvet_mustard"), cx + 0.6, cy + 1.6, 160)
    put(tr, "Table", "side_table", F.side_table, cx - 0.8, cy + 1.2, 0)
    put(tr, "Rug", "rug_round", lambda: F.rug(2.2, 2.2, "rug_parlour"), cx, cy + 0.2, 0)
    table_lamp_on(tr, "Lamp", cx - 0.8, cy + 1.2, L2 + 0.62)
    mr = "MaidsRoom"
    put(mr, "Bed", "bed_single", F.single_bed, -8.1 + 0.62, 9.6, 0)
    put(mr, "Washstand", "washstand", F.washstand, -2.4, 6.0, 180)
    put(mr, "Chair", "windsor", F.windsor_chair, -3.6, 8.0, 200)
    put(mr, "Chest", "trunk", F.trunk, -6.6, 11.6, 0)
    bx = "BoxRoom"
    for i, (x, y, rz) in enumerate(((2.8, 3.5, 10), (3.6, 4.4, -20), (5.2, 9.0, 80), (2.8, 11.6, 0))):
        put(bx, f"Trunk{i}", "trunk", F.trunk, x, y, rz)
    for i, (x, y, rz) in enumerate(((5.3, 3.4, 0), (5.3, 4.0, 15), (4.6, 11.8, 30), (5.3, 11.4, 0))):
        put(bx, f"Crate{i}", "crate", F.crate, x, y, rz)
    put(bx, "OldChair", "windsor", F.windsor_chair, 3.2, 9.6, 120)


def porch():
    """The lived-in porch: rocking-chair corner with a tea table, the bicycle against the rail,
    a watering can by the steps, the boot scraper and mat at the door."""
    cx, cy = P.TURRET
    def ring(r, deg):
        return cx + r * math.cos(deg * D2R), cy + r * math.sin(deg * D2R)
    tx, ty = ring(3.35, -72)
    put("Porch", "TeaTable", "round_table_tea", lambda: F.round_table(0.42, 0.72, legs=3), tx, ty, 0, z=P.PORCH)
    put("Porch", "TeaSet", "tea_set", F.teacup_set, tx, ty, 0, z=P.PORCH + 0.72)
    for i, deg in enumerate((-50, -94)):
        x, y = ring(3.3, deg)
        face = math.degrees(math.atan2(ty - y, tx - x)) + 90
        put("Porch", f"Chair{i + 1}", "armchair_mustard", lambda: F.armchair("velvet_mustard"), x, y, face, z=P.PORCH)
    put("Porch", "Bicycle", "bicycle", F.bicycle, 8.3, 0.16, 0, z=P.PORCH)       # on the deck, against the rail
    put("Porch", "WateringCan", "watering_can", F.watering_can, 1.05, -3.55, 160, z=P.PORCH)
    put("Porch", "BootScraper", "boot_scraper", F.boot_scraper, -0.95, -0.45, 0, z=P.PORCH)
    put("Porch", "DoorMat", "door_mat_1.2", lambda: F.door_mat(1.2, 0.6), 0.0, -0.45, 0, z=P.PORCH)


def build():
    core.clear(COL)
    _cache.clear()
    ground()
    first()
    top()
    porch()
    build_curtains()
    core.hide(core.coll(PROTO), True)
    core.finish_tmp()
