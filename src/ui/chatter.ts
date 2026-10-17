/**
 * What the loading screen says: overheard lines from the people who keep the place, each tagged
 * with where it was heard. Half are tips, half are talk. Short, never an explanation of the world.
 */
export interface ChatterLine {
  readonly from: string;
  readonly text: string;
}

export const CHATTER: readonly ChatterLine[] = [
  { from: 'West Gate · ch 2', text: 'Stand on the apron. It knows you’re there.' },
  { from: 'West Gate · ch 2', text: 'Mist in the chamber is just garden air cooling. Breathe it.' },
  { from: 'Dome works', text: 'Don’t look up for long. Everyone does, the first time.' },
  { from: 'Dome works', text: 'Twenty minutes and the collar comes round again.' },
  { from: 'Dome works', text: 'It’s always noon. Stop waiting for evening.' },
  { from: 'Girdle traffic', text: 'Band’s turning on schedule. The stars are the ones moving.' },
  { from: 'Girdle traffic', text: 'Thin air out on the deck. Walk it, don’t run it.' },
  { from: 'Estate', text: 'Someone keeps the kettle warm. Nobody’s seen who.' },
  { from: 'Estate', text: 'Doors open with E. Shut them behind you, it’s a home.' },
  { from: 'Estate', text: 'Grass stops at the wall. Past it, it’s stone and gold.' },
  { from: 'Field crew', text: 'The gold throws everything back. Even the house.' },
  { from: 'Field crew', text: 'If the ring sounds wrong, it isn’t. It always sounds like that.' },
  { from: 'Field crew', text: 'Shift if you’re in a hurry. Nothing here is.' },
  { from: 'Night shift', text: 'There is no night shift.' },
  { from: 'Veil survey', text: 'Thank the Veil every time you breathe.' },
];

/** A shuffled order of the lines (deterministic for a given random source), so none repeats until all have shown. */
export function chatterOrder(random: () => number = Math.random): ChatterLine[] {
  const order = [...CHATTER];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
