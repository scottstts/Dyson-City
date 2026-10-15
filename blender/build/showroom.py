"""Review layout of the furniture library away from the house (collection excluded from export)."""
import numpy as np
from . import core, furniture as F

COL = "Showroom"


def place(kit, name, x, y=40.0, rz=0.0):
    for mat, g in kit.items():
        core.obj(f"SR_{name}_{mat}", g.xf(F.T(x, y, 0.0, rz=rz)), COL, mat, smooth=35)


def build():
    core.clear(COL)
    rng = np.random.default_rng(1)
    items = [("dchair", F.dining_chair()), ("carver", F.dining_chair(arms=True)), ("arm", F.armchair()), ("sofa", F.sofa()),
             ("ottoman", F.ottoman()), ("dtable", F.dining_table(2.0, 1.0)), ("rtable", F.round_table()), ("side", F.side_table(brass=True)),
             ("sideboard", F.sideboard()), ("bookcase", F.bookcase(rng=rng)), ("lamp", F.table_lamp()), ("bed", F.bed()),
             ("wardrobe", F.wardrobe()), ("chest", F.chest_of_drawers()), ("piano", F.upright_piano()), ("desk", F.desk()),
             ("dchair2", F.desk_chair()), ("globe", F.globe()), ("scope", F.telescope()), ("orrery", F.orrery()),
             ("windsor", F.windsor_chair()), ("ktable", F.kitchen_table()), ("dresser", F.dresser()), ("tub", F.clawfoot_tub()),
             ("basin", F.pedestal_basin()), ("wc", F.wc_high_cistern()), ("clock", F.clock_longcase()), ("palm", F.potted_palm())]
    x = 0.0
    for name, kit in items:
        place(kit, name, x)
        x += 2.4
