/**
 * The estate's tree species (docs/estate.md "Planting"), in metres: the tables set each species'
 * identity (its angles, lengths, starts and child counts); seeds vary individuals.
 *
 *  - Cedar of Lebanon: a straight trunk carrying tiers of long, nearly level limbs that end in flat
 *    plates of needles: the classic lawn specimen of an English house.
 *  - Copper beech: a broad dome of dark purple, smooth grey bark.
 *  - Common lime: tall and oval, heart-shaped leaves, the belt along the south wall.
 *  - English oak: wide, low, gnarled limbs, lobed leaves.
 *  - Apple: small, spreading, crooked, fruit among the leaves (the orchard).
 */
import type { Level, Species } from './tree';

const lvl = (o: Partial<Level> & Pick<Level, 'length' | 'radius'>): Level => ({
  sections: 8,
  segments: 6,
  children: 0,
  start: 0.2,
  angle: 50,
  gnarl: 0.1,
  twist: 0,
  taper: 0.7,
  force: [0, 1, 0],
  strength: 0.004,
  ...o,
});

export const SPECIES: Record<string, Species> = {
  cedar: {
    name: 'cedar',
    // A short trunk; long limbs held nearly level in tiers that stay broad to a flattish top; flat
    // plates of needles laid along each limb's outer half.
    levels: [
      lvl({ length: 9, radius: 0.6, sections: 10, segments: 14, children: 11, taper: 0.7, gnarl: 0.03, twist: 0.05, strength: 0.004, shape: 'even' }),
      lvl({ length: 8.5, radius: 0.48, sections: 9, segments: 8, children: 9, start: 0.18, angle: 80, gnarl: 0.07, force: [0, 0.12, 0], strength: 0.004, planar: 1 }),
      lvl({ length: 3.6, radius: 0.55, sections: 5, segments: 5, children: 6, start: 0.25, angle: 72, gnarl: 0.1, force: [0, 0.1, 0], strength: 0.004, planar: 1 }),
      lvl({ length: 1.4, radius: 0.6, sections: 3, segments: 3, start: 0.1, angle: 60, gnarl: 0.12, planar: 1 }),
    ],
    // Plates as crossed cards laid along the level branchlets (flat cards vanish edge-on from below).
    leaves: { kind: 'cedar', count: 11, size: 1.35, variance: 0.25, angle: 78, start: 0.05 },
    bark: { colour: [0.13, 0.1, 0.08], fissure: 0.8 },
  },
  copperBeech: {
    name: 'copperBeech',
    levels: [
      lvl({ length: 6.5, radius: 0.42, sections: 10, segments: 14, children: 9, taper: 0.6, gnarl: 0.03, twist: 0.05, shape: 'dome' }),
      lvl({ length: 8, radius: 0.55, sections: 9, segments: 8, children: 7, start: 0.3, angle: 48, gnarl: 0.14, strength: 0.006 }),
      lvl({ length: 3.6, radius: 0.6, sections: 6, segments: 5, children: 6, start: 0.2, angle: 55, gnarl: 0.18, strength: 0.004 }),
      lvl({ length: 1.3, radius: 0.6, sections: 3, segments: 3, start: 0.1, angle: 50, gnarl: 0.12 }),
    ],
    leaves: { kind: 'beech', count: 11, size: 0.72, variance: 0.25, angle: 60, start: 0.05 },
    bark: { colour: [0.2, 0.2, 0.19], fissure: 0.1 },
  },
  lime: {
    name: 'lime',
    levels: [
      lvl({ length: 14, radius: 0.36, sections: 12, segments: 12, children: 11, taper: 0.78, gnarl: 0.025, twist: 0.06, strength: 0.008, shape: 'dome' }),
      lvl({ length: 6.2, radius: 0.5, sections: 8, segments: 7, children: 5, start: 0.3, angle: 44, gnarl: 0.12, strength: 0.01 }),
      lvl({ length: 2.8, radius: 0.6, sections: 5, segments: 4, children: 4, start: 0.25, angle: 52, gnarl: 0.15 }),
      lvl({ length: 1.0, radius: 0.6, sections: 3, segments: 3, start: 0.1, angle: 48, gnarl: 0.1 }),
    ],
    leaves: { kind: 'lime', count: 10, size: 0.72, variance: 0.25, angle: 55, start: 0.05 },
    bark: { colour: [0.16, 0.14, 0.12], fissure: 0.55 },
  },
  oak: {
    name: 'oak',
    levels: [
      lvl({ length: 5.5, radius: 0.48, sections: 9, segments: 14, children: 7, taper: 0.55, gnarl: 0.06, twist: 0.08, shape: 'dome' }),
      lvl({ length: 8.5, radius: 0.55, sections: 9, segments: 8, children: 5, start: 0.3, angle: 62, gnarl: 0.3, strength: 0.002 }),
      lvl({ length: 3.8, radius: 0.6, sections: 6, segments: 5, children: 4, start: 0.2, angle: 58, gnarl: 0.32, strength: 0.002 }),
      lvl({ length: 1.3, radius: 0.6, sections: 3, segments: 3, start: 0.1, angle: 55, gnarl: 0.2 }),
    ],
    leaves: { kind: 'oak', count: 10, size: 0.75, variance: 0.25, angle: 60, start: 0.05 },
    bark: { colour: [0.15, 0.13, 0.11], fissure: 1 },
  },
  apple: {
    name: 'apple',
    levels: [
      lvl({ length: 1.5, radius: 0.13, sections: 5, segments: 9, children: 5, taper: 0.4, gnarl: 0.08, twist: 0.1, shape: 'even' }),
      lvl({ length: 2.6, radius: 0.6, sections: 6, segments: 6, children: 4, start: 0.3, angle: 52, gnarl: 0.35, strength: 0.001 }),
      lvl({ length: 1.3, radius: 0.6, sections: 4, segments: 4, children: 4, start: 0.2, angle: 58, gnarl: 0.35, strength: 0.0 }),
      lvl({ length: 0.55, radius: 0.6, sections: 3, segments: 3, start: 0.1, angle: 50, gnarl: 0.2 }),
    ],
    leaves: { kind: 'apple', count: 8, size: 0.5, variance: 0.25, angle: 60, start: 0.05 },
    bark: { colour: [0.17, 0.14, 0.11], fissure: 0.7 },
  },
};
