/**
 * Declared seats across segments (docs/crew.md, "Joints"). The actuators are built with running
 * gaps, so nothing of one link meets the next: only the fingers and the thumb root in the palm, as
 * knuckles do.
 */
const sides = (f: (s: 'L' | 'R') => [string, string][]): [string, string][] => [...f('L'), ...f('R')];

export const HAND_SEATS: [string, string][] = sides((s) => (['index', 'middle', 'ring', 'little', 'thumb'] as const).map((f) => [`palm${s}:`, `${f}${s}:`] as [string, string]));
