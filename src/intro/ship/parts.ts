/**
 * The ship's named parts (tests/introShip.test.ts audits them) and the seats among them: a fitting
 * buried a centimetre in what carries it is declared with it, so the assembly audit admits exactly
 * that contact and no other. Each fitting on a facet also records its footprint, which the tests
 * check lies on that facet: nothing overhangs an edge or floats off the skin.
 */
import { Parts } from '../../field/kit/parts';
import type { Vec3 } from '../../geometry/polyMesh';

export interface Footprint {
  name: string;
  /** Which body's facets ('hull' or 'nacelle', starboard) and which facet. */
  body: 'hull' | 'nacelle';
  plane: number;
  /** The footprint's corners on the facet. */
  corners: Vec3[];
}

export class ShipParts extends Parts {
  readonly seats: [string, string][] = [];
  readonly footprints: Footprint[] = [];

  constructor() {
    super('ship');
  }

  /** Declares `part` seated in `host` (both as given to add/addSet: `set:` names included). */
  seat(part: string, host: string): void {
    this.seats.push([`${this.prefix}:${part}`, `${this.prefix}:${host}`]);
  }
}
