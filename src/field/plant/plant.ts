/**
 * The secondary plant by zone (docs/field.md, "Secondary plant"): every lot of a zone's precincts
 * built into one set of parts (one mesh per zone) with its services (lane racks, branches,
 * feeders from the viaducts), lit by the probe of that zone's hero.
 */
import { Parts } from '../kit/parts';
import type { Zone } from '../layout';
import { buildLot, lotAllow } from './buildings';
import { plantLots } from './lots';
import { buildFeeder, buildRack, serviceAllow, servicePlan } from './services';

export const PLANT_ZONES: readonly Zone[] = ['craft', 'instruments', 'power', 'cryo', 'science', 'works', 'heat'];

export function buildPlant(zone: Zone): Parts {
  const parts = new Parts('plant');
  for (const l of plantLots()) if (l.zone === zone) buildLot(parts, l);
  const { racks, feeders } = servicePlan();
  for (const rk of racks) if (rk.precinct.zone === zone) buildRack(parts, rk);
  for (const fd of feeders) if (fd.lot.zone === zone) buildFeeder(parts, fd);
  return parts;
}

/** Declared seats of a zone's plant (each lot's own, and the services'). */
export function plantAllow(zone: Zone): [string, string][] {
  return [
    ...plantLots()
      .filter((l) => l.zone === zone)
      .flatMap(lotAllow),
    ...serviceAllow(),
  ];
}
