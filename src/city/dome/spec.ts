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
  /** Cast nodes reach slightly below the members (all nodes are well above GASKET_Y). */
  nodeT0: 0.02,
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
