/**
 * Declared seats in the field's assemblies (structurally intentional penetrations): legs into their
 * bearing pads, pads into beams, shoes into the beam and into the line they carry, straps round
 * their line and onto its shoe, ladders onto the leg they are fixed to.
 */
import { spireAllow } from '../../src/field/kit/spire';
import { radiatorLayout } from '../../src/field/heroes/spires';
import { clusterPlans } from '../../src/field/heroes/towers';
import { clusterAllow } from '../../src/field/kit/tower';
import { rackLines } from '../../src/field/layout';
import { CORDON_ALLOW } from '../../src/field/cordon';
import { PLANT_ZONES, plantAllow } from '../../src/field/plant/plant';

export const HALO_ALLOW: [string, string][] = [
  ['halo:arch:', 'halo:plinth:'],
  ['halo:arch:', 'halo:bed:'],
  ['halo:bed:', 'halo:plinth:'],
  ['halo:stem:', 'halo:arch:'],
  ['halo:stem:', 'halo:line:'],
  ['halo:strap:', 'halo:line:'],
  ['halo:strap:', 'halo:stem:'],
];

/** Per-zone seats (see each hero's module for the construction they stand for). */
export const FIELD_ALLOW: Record<string, [string, string][]> = {
  loom: [
    ['loom:rail', 'loom:track'],
    ['loom:rail', 'loom:arm'],
    ['loom:trunk', 'loom:plinth'],
    ['loom:trunk', 'loom:arm'],
    ['loom:arm', 'loom:arm'],
    ['loom:pedestal', 'loom:bearing'],
    ['loom:pedestal', 'loom:gearbox'],
    ['loom:gearbox', 'loom:motor'],
    ['loom:carriage:', 'loom:carriage:'],
    ['loom:carriage:wheel', 'loom:track'],
    ['loom:ribbon:', 'loom:carriage:ribbon'],
    ['loom:ribbon:', 'loom:spool:coil'],
    ['loom:spool:', 'loom:spool:'],
    ['loom:spool:axle', 'loom:bearing'],
    ['loom:spool:axle', 'loom:pedestal'],
    ['loom:spool:axle', 'loom:gearbox'],
  ],
  cordon: CORDON_ALLOW,
  ...Object.fromEntries(PLANT_ZONES.map((z) => [`plant-${z}`, plantAllow(z)])),
  net: [
    ...rackLines().flatMap((l): [string, string][] => {
      const p = `net:${l.name}`;
      return [
        // A pier's own members, and its arms and saddles bearing the spine and the lines.
        [`${p}:pier`, `${p}:pier`],
        [`${p}:pier`, `${p}:spine`],
        [`${p}:pier`, `${p}:supply`],
        [`${p}:pier`, `${p}:return`],
        [`${p}:pier`, `${p}:data`],
        // Where a trunk meets the main, its lines and the main's run into the manifold.
        [`${p}:manifold`, `${p}:`],
        [`${p}:manifold`, 'net:main:'],
      ];
    }),
    // Valve pavilions: their courses seated in each other, their taps into the lines above.
    ['net:pavilion', 'net:pavilion'],
    ['net:pavilion', 'net:main:'],
    ['net:pavilion', 'net:trunk-'],
  ],
  rad: radiatorLayout().flatMap((s) => spireAllow(`rad:${s.name}`)),
  ...Object.fromEntries(clusterPlans().map((c) => [c.name, clusterAllow(c.name, c)])),
  mast: [
    ...spireAllow('mast:sp-mast'),
    ['mast:array', 'mast:frame'],
    ['mast:bracket', 'mast:sp-mast:core'],
    ['mast:bracket', 'mast:frame'],
    ['mast:dish', 'mast:dish'],
    ['mast:dish', 'mast:sp-mast:ring1:deck'],
  ],
  hold: [
    ['hold:t', 'hold:t'],
    ['hold:set:', 'hold:t'],
    ['hold:run:', 'hold:riser:'],
    ['hold:riser:', 'hold:t'],
    ['hold:riser:', 'hold:foot:'],
    ['hold:sleeper:', 'hold:run:'],
  ],
  resonator: [
    ['resonator:plinth:', 'resonator:plinth:'],
    ['resonator:nadir', 'resonator:plinth:'],
    ['resonator:base:', 'resonator:plinth:'],
    ['resonator:pylon:', 'resonator:base:'],
    ['resonator:pylon:', 'resonator:plinth:'],
    ['resonator:band:', 'resonator:pylon:'],
    ['resonator:pad:', 'resonator:pylon:'],
    ['resonator:pad:', 'resonator:beam'],
    ['resonator:door:', 'resonator:pylon:'],
    ['resonator:set:rail:', 'resonator:beam'],
    ['resonator:stage:', 'resonator:beam'],
    ['resonator:dome:', 'resonator:stage:'],
    ['resonator:collar:', 'resonator:torus'],
    ['resonator:cable:', 'resonator:collar:'],
    ['resonator:cable:', 'resonator:beam'],
    ['resonator:sleeve:', 'resonator:beam'],
    ['resonator:sleeve:', 'resonator:cable:'],
    ['resonator:sensor:', 'resonator:torus'],
    ['resonator:saddle:', 'resonator:torus'],
    ['resonator:saddle:', 'resonator:pod:'],
  ],
  gyre: [
    ['gyre:plinth:', 'gyre:plinth:'],
    ['gyre:yoke', 'gyre:plinth:'],
    ['gyre:yoke:bed', 'gyre:yoke'],
    ['gyre:housing:', 'gyre:yoke'],
    ['gyre:motor:', 'gyre:yoke'],
    ['gyre:cap:', 'gyre:yoke'],
    ['gyre:deck:', 'gyre:cap:'],
    ['gyre:feed:', 'gyre:yoke'],
    ['gyre:set:rail:', 'gyre:deck:'],
    ['gyre:set:ladder:', 'gyre:yoke'],
    ['gyre:set:ladder:', 'gyre:plinth:'],
    ['gyre:feed:', 'gyre:plinth:'],
    ['gyre:feed:', 'gyre:motor:'],
    ['gyre:outer:trunnion', 'gyre:outer:ring:body'],
    ['gyre:outer:trunnion', 'gyre:housing:'],
    ['gyre:outer:trunnion', 'gyre:yoke'],
    ['gyre:outer:housing', 'gyre:outer:ring:body'],
    ['gyre:outer:ring:collar', 'gyre:outer:ring:body'],
    ['gyre:middle:trunnion', 'gyre:middle:ring:body'],
    ['gyre:middle:trunnion', 'gyre:outer:housing'],
    ['gyre:middle:trunnion', 'gyre:outer:ring:body'],
    ['gyre:middle:housing', 'gyre:middle:ring:body'],
    ['gyre:middle:ring:collar', 'gyre:middle:ring:body'],
    ['gyre:inner:trunnion', 'gyre:inner:ring:body'],
    ['gyre:inner:trunnion', 'gyre:middle:housing'],
    ['gyre:inner:trunnion', 'gyre:middle:ring:body'],
    ['gyre:inner:housing', 'gyre:inner:ring:body'],
    ['gyre:inner:ring:collar', 'gyre:inner:ring:body'],
    ['gyre:rotor:spindle', 'gyre:rotor:sphere'],
    ['gyre:rotor:spindle', 'gyre:inner:housing'],
    ['gyre:rotor:spindle', 'gyre:inner:ring:body'],
  ],
};
