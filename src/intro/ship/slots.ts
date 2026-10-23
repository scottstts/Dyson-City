/**
 * The ship's material slots (materials.ts): one draw per slot. Outside it is black: a satin black
 * composite skin, matte black for the reveals and wells, dark titanium for the machinery, burnt
 * metal for the nozzles. Inside: charcoal liners, a graphite floor, black consoles, satin aluminium
 * trim, leather on the seat.
 *
 * The cabin's slots are lit differently from the outside's (cabinLight.ts): only by what comes in
 * through the panes and the door, and by the cabin's own lamps. A finish used on both sides has a
 * slot on each.
 */
export const SHIP_SLOT = {
  // Outside.
  hull: 0,
  reveal: 1,
  titanium: 2,
  nozzle: 3,
  rubber: 4,
  matte: 5,
  trim: 6,
  lens: 7,
  // Inside.
  hullInner: 8,
  liner: 9,
  linerDark: 10,
  floor: 11,
  console: 12,
  cabinTrim: 13,
  leather: 14,
  lamp: 15,
  screen: 16,
  cabinMatte: 17,
  cabinRubber: 18,
  monitor: 19,
  display: 20,
  /** The panes' reveals (inside the glass) and the cockpit's small bright lamps. */
  paneReveal: 21,
  spot: 22,
  // Outside again: the engines' glowing cores.
  engineGlow: 23,
  // The lights' lenses (lights.ts): the navigation lights, the anti-collision strobes and beacons,
  // the landing lights.
  navRed: 24,
  navGreen: 25,
  navWhite: 26,
  strobe: 27,
  beacon: 28,
  landing: 29,
  // The skin again (materials.ts): its chamfered edges, worn through the paint to the composite;
  // the lower hull, darker; the doubler plates, unseamed.
  hullEdge: 30,
  hullLow: 31,
  hullPlate: 32,
} as const;

export const SHIP_SLOTS = 33;

/** The cabin's slots (hullInner … spot) are lit as the cabin is. */
export const isCabinSlot = (slot: number): boolean => slot >= SHIP_SLOT.hullInner && slot <= SHIP_SLOT.spot;
