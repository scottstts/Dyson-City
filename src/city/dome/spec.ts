/**
 * The Dome: single source of truth for its dimensions (metres, local frame: +X east, +Y up,
 * +Z south, deck at y = 0, platform top at PAD_HEIGHT). See docs/dome.md.
 *
 * Reference surface S is the glass's outer face: a 2:1 semi-ellipsoid of revolution centred on the
 * platform top, landing vertical at the platform's top edge. Every frame member is a sweep along a
 * curve on S, offset outward along S's normal; the glass (no bars: one pane per coffer) is pressed
 * against the members' inner faces. Members land on the steps outside the glass; their outer faces
 * at the sill sit a 20 mm reveal inside the bottom riser.
 */
import { PAD_HEIGHT, PAD_OUTER_RADIUS, SITE } from '../../ground/site';
import { EYE_HEIGHT } from '../../world/constants';

export const DOME = {
  /** Centre height of S (the platform top). */
  centreY: PAD_HEIGHT,
  /** Horizontal semi-axis of S (glass outer face at the sill). */
  a: SITE.padRadius - 0.25,
  /** Vertical semi-axis of S. */
  c: 250,
  /** The coffer module (four 24 m pad bays). */
  module: 96,
  /** Half-distance between each Axis Band's twin rails (over the pad's first border courses). */
  bandHalf: 12,
  /** Coffer ribs, in plan, on each side of each axis. */
  ribs: [96, 192, 288, 384] as readonly number[],
  /** The Eave Ring's plan radius on S: the 288/384 ribs meet it at shared nodes (3-4-5). */
  eaveR: 480,
  /** Collars: a semicircular arch on two vertical legs, centred on each cardinal point. */
  arch: { radius: 48, centreY: 42 },
} as const;

/** Offsets along S's normal (outward). */
export const LAYER = {
  /** Members' inner faces: the glass's gasket line. */
  memberT0: 0.05,
  /**
   * Near the sill the members stand further off the glass (clear of the sill channel the glass
   * stands in), easing to the gasket line by GASKET_Y.
   */
  memberT0Sill: 0.3,
  /** Cast node bodies reach slightly below the members (all nodes are well above GASKET_Y). */
  nodeT0: 0.02,
  /** Cast node arms: between the body and the members. */
  armT0: 0.035,
  /** Splice plates stand this far off the members' inner faces (members and arms run past them). */
  plateLift: 0.015,
} as const;

/** Height above which the members bear on the glass at the gasket line. */
export const GASKET_Y = 9;

/** Member sections: half-width across the member (in S's tangent plane) and outer offset. */
export const MEMBER = {
  rail: { halfWidth: 2.5, t1: 8.3 },
  rib: { halfWidth: 1.75, t1: 5.3 },
  tie: { halfWidth: 1.1, t1: 3.6 },
  eave: { halfWidth: 2.25, t1: 7.3 },
  post: { halfWidth: 2.0, t1: 5.3 },
  arch: { halfWidth: 3.0, t1: 8.3 },
} as const;

/**
 * Fabricated girder sections (girder.ts): a glass-side bearing flange and an outer cap flange
 * joined by a recessed web, with transverse web stiffeners at panel points.
 */
export const GIRDER = {
  /** Fillet between web and flanges. */
  fillet: 0.08,
  /** Stiffener plate width along the member, and its face's inset from the flange edges. */
  stiffenerWidth: 0.22,
  stiffenerInset: 0.05,
  /** How far stiffeners are seated into the web and flanges. */
  seat: 0.02,
  /** Stiffener spacing as a multiple of the member's depth (plate-girder proportion). */
  panel: 1.0,
} as const;

/**
 * Joints (nodes.ts, splice.ts): every member ends on a bolted end-plate splice, either to a cast
 * node's arm or (at a field splice) to the next shop length of the same member.
 */
export const JOINT = {
  /** Cast arm section beyond the member's envelope. */
  armGrow: 0.08,
  /** Clearance between neighbouring arms where they leave the hub's drum. */
  armClear: 0.15,
  /** Drum crown above the tallest arm: its top bevel starts above the arms. */
  bodyProud: 0.6,
  /** Least clear arm length between the drum and the splice. */
  stub: 1.3,
  /** Splice: plate margin round the member's envelope; half the plate pair's thickness. */
  plateMargin: 0.4,
  plateHalf: 0.2,
  /** Least gap between the plates of neighbouring arms (they must read as two joints, not one). */
  plateGap: 0.7,
  /** Members and arms enter the plates by this much (declared seats). */
  seat: 0.02,
  /** Bolt pitch round a splice. */
  boltPitch: 0.8,
  /** Longest shop length between splices; longer runs get field splices. */
  fieldSpan: 50,
} as const;

/** Feet: members stand on dressed plinths with a bolted base plate. */
export const FOOT = {
  /** Members end this far below the sill inside their plinths. */
  y: 1.0,
  /** Plinth margins round the member's base: radial (in the depth) and lateral (along the sill). */
  radial: 0.08,
  lateral: 0.6,
  /** Plinth top height. */
  top: 2.4,
  /** Base plate wing beyond the member, and its thickness. */
  plateWing: 0.45,
  plateThickness: 0.14,
} as const;

/** Reveal between the frame's outer face and the bottom riser at the sill. */
export const SILL_REVEAL = 0.02;
/** How far feet and walls sink into the stone they stand on (declared penetration). */
export const FOOT_SINK = 0.02;

/** Height of the interior environment capture: eye height over the platform centre. */
export const INTERIOR_CAPTURE_Y = PAD_HEIGHT + EYE_HEIGHT;

/** y of the Eave Ring on S. */
export const EAVE_Y = DOME.centreY + DOME.c * Math.sqrt(1 - (DOME.eaveR / DOME.a) ** 2);
/** Outer offset of a drum post at the sill: its outer face sits SILL_REVEAL inside the riser. */
export const POST_T1_SILL = PAD_OUTER_RADIUS - SILL_REVEAL - DOME.a;

/**
 * Where the West Gate's gatehouse passes through the Dome's skin (gate.ts owns the gatehouse): the
 * glass stops on a bronze trim around this opening, centred on the west cardinal.
 */
export const GATE_OPENING = {
  /** Lateral half-width of the gatehouse's outer walls (gate/spec.ts outerHalf). */
  halfWidth: 16,
  /** Height of the gatehouse's roof (gate/spec.ts topY). */
  top: 31,
  /** Width of the bronze trim the glass stops on (it starts 30 mm off the gatehouse). */
  trim: 0.48,
} as const;

/** Glazing sill channel on the platform top (radial extent and top height). */
export const SILL = { rIn: DOME.a - 0.25, rOut: DOME.a + 0.18, top: PAD_HEIGHT + 0.16 } as const;
