/**
 * Declared seats in the estate's masonry (structurally intentional penetrations): rails into the
 * piers they butt against, the wall's ends into the gate piers, kerbs and edgings where they meet.
 */
export const ESTATE_ALLOW: [string, string][] = [
  ['estate:wall:bay:', 'estate:piers:'],
  ['estate:wall:bay:', 'estate:finials:'],
  ['estate:wall:bay:', 'estate:gateway:set:pier:'],
  ['estate:gateway:bal:', 'estate:piers:'],
  ['estate:gateway:bal:', 'estate:finials:'],
  ['estate:gateway:bal:', 'estate:gateway:set:pier:'],
  ['estate:wall:retaining', 'estate:gateway:set:pier:'],
  ['estate:gateway:cheek:', 'estate:gateway:set:pier:'],
  // The flights butt against the gate piers' plinths.
  ['estate:gateway:flight:', 'estate:gateway:set:pier:'],
  ['estate:gateway:set:urn:', 'estate:gateway:set:pier:'],
  ['estate:balusters:', 'estate:wall:bay:'],
  ['estate:balusters:', 'estate:gateway:bal:'],
  ['estate:piers:', 'estate:wall:retaining'],
  ['estate:finials:', 'estate:wall:retaining'],
  ['estate:piers:', 'estate:gateway:'],
  ['estate:finials:', 'estate:gateway:'],
  // Each building's own members meet (posts in plates, roofs on walls, doors proud of their frames).
  ['estate:kitchen:', 'estate:kitchen:'],
  ['estate:glasshouse:', 'estate:glasshouse:'],
  ['estate:carriage:', 'estate:carriage:'],
  ['estate:pond:', 'estate:pond:'],
  // A water lily sits on its pad.
  ['estate:lilies:', 'estate:lily-pads:'],
  // Foliage brushing a bed's kerb.
  ['estate:hedge:', 'kerb:'],
  ['edging:', 'kerb:'],
  ['edging:', 'edging:'],
];
