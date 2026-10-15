"""The house plan: every level, outline, room and opening. Single source of truth for all builders.

Metres. +X right, +Y back, +Z up; the front (porch, field side) faces -Y. Origin: grade, centre of
the front door. See blender/docs/house.md for the plan drawings and the reasoning behind them.
"""
import math

from .geo import arc, rect

# ---------------------------------------------------------------- levels (finished floor levels)
GRADE = 0.0
FOUND_TOP = 1.0            # top of the stone foundation (water table sits over the joint)
PORCH = 0.90               # porch deck (5 risers of 0.18 from grade)
G, L1, L2 = 1.05, 5.25, 9.15
LEVELS = {0: G, 1: L1, 2: L2}
CEIL = {0: 4.85, 1: 8.75, 2: 12.15}
RISERS = {0: 24, 1: 22}    # G->L1, L1->L2

TE = 0.30                  # exterior wall
TI = 0.15                  # interior partition
TROOF = 0.25               # roof build-up under the slate

EAVE_WING = 9.45           # top of B / E wing walls
CORNICE_TOP = 10.25        # top of main cornice = foot of the mansard
MANSARD_BREAK = 13.5
DECK = 15.0                # widow's walk deck
MANSARD_LOWER = math.radians(75)
MANSARD_UPPER = math.radians(22)
GABLE_RIDGE = 14.45        # below the mansard's side slope at the gable's centre line (14.52): the ridge dies into it

# ---------------------------------------------------------------- masses
M = (-8.4, 0.0, 6.2, 13.0)          # main block x0, y0, x1, y1
C = (-8.4, -1.8, -1.6, 0.0)         # front cross-gable block
B = (-13.2, 1.0, -8.4, 9.6)         # left wing
E = (6.2, 2.2, 9.8, 9.2)            # right wing
TURRET = (4.05, -0.35)
TR = 2.45                           # turret outer radius (G, L1)
TR2 = 2.45                          # turret upper stage
BAY_FRONT = [(-7.2, -1.8), (-6.2, -2.8), (-3.8, -2.8), (-2.8, -1.8)]
BAY_BACK = [(-2.8, 13.0), (-3.8, 14.0), (-6.2, 14.0), (-7.2, 13.0)]
CHIMNEY_EXT = (-9.15, 10.3, -8.4, 11.7)   # exterior dining-room stack on the west wall


def turret_angle_at(x=None, y=None):
    cx, cy = TURRET
    if x is not None:
        dy = -math.sqrt(TR * TR - (x - cx) ** 2)
        return math.atan2(dy, x - cx)
    dx = math.sqrt(TR * TR - (y - cy) ** 2)
    return math.atan2(y - cy, dx)


def outline01():
    """Ground/first floor outline (outer face of the wall frame), CCW from the front-left of B."""
    cx, cy = TURRET
    a0 = math.atan2(0.0 - cy, 1.625 - cx)            # where the entry wall meets the turret
    a0 = math.atan2(-cy, -math.sqrt(TR * TR - cy * cy))
    a1 = math.atan2(math.sqrt(TR * TR - (M[2] - cx) ** 2), M[2] - cx)  # meets the right wall
    ex = cx - math.sqrt(TR * TR - cy * cy)
    pts = [(B[0], B[1]), (B[2], B[1]), (C[0], C[1]), *BAY_FRONT, (C[2], C[1]), (C[2], 0.0), (ex, 0.0)]
    tur = arc(cx, cy, TR, a0 + 0.0, a1 + math.tau, step=math.radians(4))
    pts += tur[1:-1]
    yr = cy + math.sqrt(TR * TR - (M[2] - cx) ** 2)
    pts += [(M[2], yr), (E[0], E[1]), (E[2], E[1]), (E[2], E[3]), (E[0], E[3]), (M[2], M[3]),
            *BAY_BACK, (M[0], M[3]), (B[2], B[3]), (B[0], B[3])]
    return pts


# ---------------------------------------------------------------- rooms
# Each room: name, level, list of convex 2D pieces (inner faces), materials.
# Pieces may overlap; their union is the room. 'turret' marks the inner turret circle piece.

def _r(x0, y0, x1, y1):
    return rect(x0, y0, x1, y1)


def turret_inner(r=TR - TE):
    cx, cy = TURRET
    return arc(cx, cy, r, 0, math.tau, n=72)[:-1]


def bay_inner(bay, depth_into_room):
    """Interior of a canted bay (outer chain `bay`), extended into the room by depth_into_room."""
    from .geo import offset
    p0, p1, p2, p3 = bay
    # direction from the bay's chord into the house
    ix = 0.0
    iy = 1.0 if p1[1] < p0[1] else -1.0
    closed = [p0, p1, p2, p3, (p3[0] + ix, p3[1] + iy * depth_into_room), (p0[0], p0[1] + iy * depth_into_room)]
    from .geo import ccw
    inner = offset(ccw(closed), -TE)
    return inner


ROOMS = []


def room(name, level, pieces, wall, floor, ceil=None, **kw):
    r = dict(name=name, level=level, pieces=pieces, wall=wall, floor=floor, ceil=ceil if ceil is not None else CEIL[level], **kw)
    ROOMS.append(r)
    return r


ROOMS.clear()
# ground floor -----------------------------------------------------------------------------
room("Vestibule", 0, [_r(-1.525, 0.3, 1.45, 1.925)], "wall_hall", "floor_encaustic")
room("Hall", 0, [_r(-1.525, 2.075, 2.025, 9.325)], "wall_hall", "floor_oak")
room("Parlour", 0, [_r(-8.1, -1.5, -1.675, 6.525), bay_inner(BAY_FRONT, 1.0)], "wall_morris", "floor_parquet")
room("Library", 0, [_r(-12.9, 1.3, -8.4, 9.3)], "wall_green", "floor_oak")
room("Dining", 0, [_r(-8.1, 6.675, -1.675, 12.7), bay_inner(BAY_BACK, 1.0)], "wall_morris", "floor_oak")
room("Music", 0, [_r(2.175, -0.35, 5.9, 6.525), turret_inner()], "wall_rose", "floor_parquet")
room("Morning", 0, [_r(6.2, 2.5, 9.5, 8.9)], "wall_yellow", "floor_oak")
room("RearHall", 0, [_r(-1.525, 9.475, 2.025, 11.525), _r(-0.025, 11.525, 2.025, 12.7)], "wall_cream", "floor_encaustic")
room("WC", 0, [_r(-1.525, 11.675, -0.175, 12.7)], "wall_tile", "floor_encaustic")
room("Kitchen", 0, [_r(2.175, 6.675, 5.9, 10.925), _r(2.175, 10.925, 4.625, 12.7)], "wall_kitchen", "floor_flag")
room("Pantry", 0, [_r(4.775, 11.075, 5.9, 12.7)], "wall_cream", "floor_flag")
# first floor ------------------------------------------------------------------------------
room("Landing", 1, [_r(-1.525, 0.3, 1.45, 1.1), _r(-1.525, 1.1, 2.025, 10.525)], "wall_hall", "floor_oak")
room("Master", 1, [_r(-8.1, -1.5, -1.675, 6.525), bay_inner(BAY_FRONT, 1.0)], "wall_blue", "floor_oak")
room("Dressing", 1, [_r(-12.9, 1.3, -8.4, 5.525)], "wall_sage", "floor_oak")
room("MasterBath", 1, [_r(-12.9, 5.675, -8.4, 9.3)], "wall_tile", "floor_hex")
room("Bedroom", 1, [_r(-8.1, 6.675, -1.675, 12.7), bay_inner(BAY_BACK, 1.0)], "wall_rose", "floor_oak")
room("Study", 1, [_r(2.175, -0.35, 5.9, 6.525), turret_inner()], "wall_green", "floor_oak")
room("ChartRoom", 1, [_r(6.2, 2.5, 9.5, 8.9)], "wall_sage", "floor_oak")
room("Guest", 1, [_r(2.175, 6.675, 5.9, 12.7)], "wall_stripe", "floor_oak")
room("Bath", 1, [_r(-1.525, 10.675, 2.025, 12.7)], "wall_tile", "floor_hex")
# top floor (mansard storey) ---------------------------------------------------------------
room("TopHall", 2, [_r(-1.525, 0.3, 1.45, 1.1), _r(-1.525, 1.1, 2.025, 12.7)], "wall_cream", "floor_pine")
room("GableRoom", 2, [_r(-8.1, -1.5, -1.675, 5.525)], "wall_small", "floor_pine")
room("TurretRoom", 2, [turret_inner(), _r(2.175, 0.4, 5.9, 2.6)], "wall_pine", "floor_pine", cone=True)
room("MaidsRoom", 2, [_r(-8.1, 5.675, -1.675, 12.7)], "wall_cream", "floor_pine")
room("BoxRoom", 2, [_r(2.175, 2.75, 5.9, 12.7)], "wall_plaster", "floor_pine")

# The turret room's ceiling is the cone: it rises into the roof.
TURRET_TOP = 13.2           # top of the turret's upper cornice / foot of the cone
TURRET_APEX = 19.6
TURRET_ROOM_CEIL = 13.0     # where the boarded cone ceiling springs inside

# ---------------------------------------------------------------- stairs
# Main stair: G -> L1 along the east side of the hall, rising front to back, half landing.
# 22 risers of 0.191 on a 0.26 going leave a 1 m clear space at the stair's foot against the back wall
STAIR_MAIN = dict(x0=0.95, x1=2.025, y0=2.15, risers=22, going=0.26, landing=1.0, level=0)
# Second stair: L1 -> L2 along the west side of the landing, rising front to back, half landing.
STAIR_TOP = dict(x0=-1.525, x1=-0.45, y0=2.8, risers=22, going=0.27, landing=0.9, level=1)

# ---------------------------------------------------------------- openings
# kind: window | door | french | arch (cased opening, no leaf) | pocket
# wall frame: (px, py) a point on the wall's outer face (exterior) or centre line (interior),
# ang: outward normal direction (radians, plan), w: rough width, sill/head: heights above FFL.
OPENINGS = []


def opening(name, level, px, py, ang_deg, w, sill, head, kind="window", ext=True, transom=0.0, curved=False, **kw):
    o = dict(name=name, level=level, p=(px, py), ang=math.radians(ang_deg), w=w, sill=sill, head=head,
             kind=kind, ext=ext, transom=transom, curved=curved, **kw)
    OPENINGS.append(o)
    return o


def _mid(a, b):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def _turret_pt(deg, r=TR):
    a = math.radians(deg)
    return TURRET[0] + r * math.cos(a), TURRET[1] + r * math.sin(a)


OPENINGS.clear()
# ground floor: sash 2.2 + transom 0.5; heads kept low enough that the casing's corner blocks
# (head + 0.18) clear the plaster cornice (ceiling - 0.2)
WG_HEAD = 3.3
WG = dict(sill=0.6, head=WG_HEAD)
WL1 = dict(sill=0.65, head=2.95)
for lv, hw, tr in ((0, WG, 0.5), (1, WL1, 0.0)):
    n = "G" if lv == 0 else "L1"
    bf = BAY_FRONT
    opening(f"{n}_BayFront", lv, *_mid(bf[1], bf[2]), -90, 1.5, transom=tr, bay=True, **hw)
    opening(f"{n}_BayFrontL", lv, *_mid(bf[0], bf[1]), -135, 0.8, transom=tr, bay=True, **hw)
    opening(f"{n}_BayFrontR", lv, *_mid(bf[2], bf[3]), -45, 0.8, transom=tr, bay=True, **hw)
    bb = BAY_BACK
    opening(f"{n}_BayBack", lv, *_mid(bb[1], bb[2]), 90, 1.5, transom=tr, bay=True, **hw)
    opening(f"{n}_BayBackL", lv, *_mid(bb[2], bb[3]), 135, 0.8, transom=tr, bay=True, **hw)
    opening(f"{n}_BayBackR", lv, *_mid(bb[0], bb[1]), 45, 0.8, transom=tr, bay=True, **hw)
    for d in (210, 270, 330):
        opening(f"{n}_Turret{d}", lv, *_turret_pt(d), d, 0.85, curved=True, transom=tr, **hw)
    opening(f"{n}_BLeft1", lv, B[0], 3.4, 180, 1.1, transom=tr, **hw)
    opening(f"{n}_BLeft2", lv, B[0], 7.2, 180, 1.1, transom=tr, **hw)
    opening(f"{n}_BBack", lv, -10.8, B[3], 90, 1.1, **hw)
    opening(f"{n}_ERight1", lv, E[2], 4.0, 0, 1.1, transom=tr, **hw)
    opening(f"{n}_ERight2", lv, E[2], 7.2, 0, 1.1, transom=tr, **hw)
    opening(f"{n}_EBack", lv, 8.0, E[3], 90, 1.1, **hw)
    opening(f"{n}_MRight", lv, M[2], 11.2, 0, 1.1, **hw)

opening("G_Front", 0, 0.0, 0.0, -90, 1.8, 0.0, 3.35, kind="door", transom=0.55, double=True)
opening("G_BFront", 0, -10.8, B[1], -90, 1.1, sill=0.6, head=3.0)   # under the west porch ceiling
opening("G_EFront", 0, 8.0, E[1], -90, 1.5, 0.0, 3.35, kind="french", transom=0.5)
opening("G_BackDoor", 0, 1.1, M[3], 90, 1.0, 0.0, 2.95, kind="door", transom=0.4)
opening("G_WC", 0, -0.6, M[3], 90, 0.5, 1.45, 2.75, casing=0.1)
opening("G_Kitchen", 0, 3.3, M[3], 90, 1.2, 0.95, WG_HEAD)
opening("G_Pantry", 0, 5.35, M[3], 90, 0.7, 1.4, 2.9)

opening("L1_Front", 1, 0.0, 0.0, -90, 1.1, **WL1)
opening("L1_BFront", 1, -10.8, B[1], -90, 1.3, 0.0, 2.95, kind="french")
opening("L1_EFront", 1, 8.0, E[1], -90, 1.1, **WL1)
opening("L1_Back", 1, 0.25, M[3], 90, 1.0, **WL1)
opening("L1_Guest1", 1, 3.3, M[3], 90, 1.1, **WL1)
opening("L1_Guest2", 1, 5.1, M[3], 90, 1.1, **WL1)

# top floor: gable triple window, turret ring, dormers
opening("L2_Gable", 2, -5.0, C[1], -90, 2.5, 0.85, 2.45, triple=True)
for i, d in enumerate((213, 249, 285, 321, 357)):
    opening(f"L2_Turret{i}", 2, *_turret_pt(d % 360), d % 360, 0.72, 0.75, 2.55, curved=True)
DORMERS = [
    # name, x/y centre on the wall line, side, window width
    ("Front", 0.0, M[1], "front", 0.9),
    ("BackL", -5.0, M[3], "back", 0.9),
    ("BackC", 0.25, M[3], "back", 0.9),
    ("BackR", 3.9, M[3], "back", 0.9),
    ("Right", M[2], 11.2, "right", 0.9),
]
DORMER_SILL, DORMER_HEAD = 1.15, 2.65
DORMER_SET = 0.0             # dormer faces rise straight off the cornice, in line with the wall below

# interior doors (ext=False). p = point on the partition centre line, ang = normal direction.
D = dict(sill=0.0, ext=False)
opening("G_VestHall", 0, -0.04, 2.0, 90, 1.5, head=2.95, kind="door", double=True, glazed=True, transom=0.45, **D)
opening("G_HallParlour", 0, -1.6, 3.6, 180, 1.7, head=3.05, kind="pocket", **D)
opening("G_HallDining", 0, -1.6, 8.0, 180, 1.5, head=3.05, kind="pocket", **D)
opening("G_ParlourDining", 0, -5.6, 6.6, 90, 2.2, head=3.05, kind="arch", **D)
opening("G_ParlourLibrary", 0, -8.25, 5.3, 180, 1.5, head=3.05, kind="pocket", thick=TE, **D)
opening("G_HallMusic", 0, 2.1, 2.62, 0, 0.85, head=2.5, kind="door", casing=0.1, **D)   # under the stair's high end
opening("G_HallRear", 0, -0.5, 9.4, 90, 1.0, head=2.75, kind="door", **D)
opening("G_MusicMorning", 0, 6.05, 4.6, 0, 1.4, head=2.95, kind="door", double=True, glazed=True, thick=TE, **D)
opening("G_RearKitchen", 0, 2.1, 11.0, 0, 0.95, head=2.6, kind="door", **D)
opening("G_RearWC", 0, -0.65, 11.6, -90, 0.7, head=2.3, kind="door", casing=0.07, **D)   # clear of the WC pan
opening("G_KitchenPantry", 0, 4.7, 11.9, 0, 0.8, head=2.3, kind="door", **D)
opening("G_KitchenMorning", 0, 6.05, 8.1, 0, 0.9, head=2.6, kind="door", thick=TE, **D)

opening("L1_LandMaster", 1, -1.6, 1.55, 180, 0.95, head=2.6, kind="door", **D)
opening("L1_LandStudy", 1, 2.1, 1.62, 0, 0.8, head=2.6, kind="door", casing=0.1, **D)
opening("L1_MasterDress", 1, -8.25, 4.8, 180, 0.9, head=2.6, kind="door", thick=TE, **D)
opening("L1_DressBath", 1, -10.8, 5.6, 90, 0.8, head=2.4, kind="door", **D)
# between the gallery's end and the bath wall there is 1.1 m of wall: 0.8 m doors with narrow casings
opening("L1_LandBed", 1, -1.6, 9.97, 180, 0.8, head=2.6, kind="door", casing=0.1, **D)
opening("L1_LandGuest", 1, 2.1, 9.97, 0, 0.8, head=2.6, kind="door", casing=0.1, **D)
opening("L1_LandBath", 1, 0.6, 10.6, 90, 0.85, head=2.4, kind="door", **D)
opening("L1_StudyChart", 1, 6.05, 4.6, 0, 0.95, head=2.6, kind="door", thick=TE, **D)

opening("L2_HallGable", 2, -1.6, 1.55, 180, 0.9, head=2.3, kind="door", **D)
opening("L2_HallTurret", 2, 2.1, 1.62, 0, 0.8, head=2.3, kind="door", casing=0.1, **D)
opening("L2_HallMaid", 2, -1.6, 10.6, 180, 0.9, head=2.3, kind="door", **D)
opening("L2_HallBox", 2, 2.1, 8.2, 0, 0.9, head=2.3, kind="door", **D)


def openings(level=None, ext=None):
    return [o for o in OPENINGS if (level is None or o["level"] == level) and (ext is None or o["ext"] == ext)]


def rooms(level=None):
    return [r for r in ROOMS if level is None or r["level"] == level]
