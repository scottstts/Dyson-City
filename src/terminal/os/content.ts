/**
 * What the terminal holds (docs/terminal.md, docs/terminal-narration.md): its four sections, their
 * entries, which recording each plays, and the text and figures the screen shows beside them.
 * Every figure here is the world's own (README, docs/world.md, docs/city_plan.md); the narration
 * and the screen must agree.
 */
import type { ClipId } from './cues';

export type SectionId = 'archive' | 'comms' | 'control' | 'observatory';
export type ItemKind = 'story' | 'particulars' | 'plan' | 'message' | 'status' | 'feed';

export interface Item {
  id: string;
  title: string;
  sub: string;
  kind: ItemKind;
  /** The recording it plays when opened. */
  clip?: ClipId;
}

export interface Section {
  id: SectionId;
  title: string;
  sub: string;
  /** Entries to choose from; a section without them is one page, opened directly. */
  items: Item[];
  page?: Item;
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'archive',
    title: 'Archive',
    sub: 'Records of the sphere',
    items: [
      { id: 'origin', title: 'Origin', sub: 'How the sphere was built', kind: 'story', clip: 'T2' },
      { id: 'shell', title: 'The Shell', sub: 'Particulars', kind: 'particulars' },
      { id: 'compound', title: 'The Compound', sub: 'Plan of Dyson City', kind: 'plan' },
    ],
  },
  {
    id: 'comms',
    title: 'Comms',
    sub: 'Beam traffic from Sol',
    items: [
      { id: 'hayes', title: 'Clara Hayes', sub: 'President, Centauri Accord', kind: 'message', clip: 'T4' },
      { id: 'sam', title: 'Sam', sub: 'Personal', kind: 'message', clip: 'T5' },
      { id: 'ward', title: 'General Daniel Ward', sub: 'Accord Frontier Command', kind: 'message', clip: 'T7' },
      { id: 'maya', title: 'Maya', sub: 'Personal', kind: 'message', clip: 'T8' },
    ],
  },
  { id: 'control', title: 'Control', sub: 'Operational status', items: [], page: { id: 'status', title: 'Compound status', sub: 'All precincts', kind: 'status', clip: 'T3' } },
  { id: 'observatory', title: 'Observatory', sub: 'Resonator feed', items: [], page: { id: 'feed', title: 'Resonator feed', sub: 'Alpha Centauri A', kind: 'feed', clip: 'T6' } },
];

/** The boot recording, on the first wake of a session. */
export const BOOT_CLIP: ClipId = 'T1';

/** The senders' portraits (public/profiles), and where each face sits in it (0..1 of width, height). */
export const SENDERS: Record<string, { image: string; face: [number, number]; transit: string; route: string }> = {
  hayes: { image: 'profiles/Clara-Hayes.jpeg', face: [0.52, 0.24], transit: '4 y 4 mo', route: 'Assembly Hall, Geneva · Sol' },
  sam: { image: 'profiles/Sam.jpeg', face: [0.48, 0.3], transit: '4 y 4 mo', route: 'Personal relay · Sol' },
  ward: { image: 'profiles/Ward.jpeg', face: [0.49, 0.29], transit: '4 y 4 mo', route: 'Frontier Command · Sol' },
  maya: { image: 'profiles/Maya.jpeg', face: [0.5, 0.29], transit: '4 y 4 mo', route: 'Personal relay · Sol' },
};

/** The Shell's particulars (Archive). */
export const PARTICULARS: readonly [string, string][] = [
  ['Star', 'Alpha Centauri A · G2 V · 5,790 K'],
  ['Distance from Sol', '4.37 light years'],
  ['Shell diameter', '2,000,000 km'],
  ['Photosphere overhead', '288,000 km'],
  ['Flux at the shell', '3.15 × 10⁷ W/m² · 23,000 suns'],
  ['The Veil', '1.2 km over the band · neutral'],
  ['Band', 'turning · a hub collar every 20 min'],
  ['Shell closed', '2127'],
  ['Dome', '1 km across · 251 m to the crown · 1 bar'],
  ['Compound', '200 acres'],
];

/** The status rows (Control), in the order the recording reads them. */
export type StatusRow = 'precincts' | 'veil' | 'spin' | 'gyre' | 'hold' | 'craft' | 'lock' | 'gate' | 'faults' | 'kettle';
export const STATUS_ROWS: readonly { id: StatusRow; label: string }[] = [
  { id: 'precincts', label: 'Precincts' },
  { id: 'veil', label: 'Veil load' },
  { id: 'spin', label: 'Band spin' },
  { id: 'gyre', label: 'Gyre' },
  { id: 'hold', label: 'Cold Hold' },
  { id: 'craft', label: 'Craft traffic' },
  { id: 'lock', label: 'East Lock' },
  { id: 'gate', label: 'West Gate' },
  { id: 'faults', label: 'Faults · alerts' },
  { id: 'kettle', label: 'House · kitchen' },
];

/** Which rows each line of the status recording (T3's cues, in order) speaks of. */
export const STATUS_CUE_ROWS: readonly (readonly StatusRow[])[] = [[], ['precincts'], ['veil'], ['spin', 'gyre'], ['hold'], ['craft', 'lock'], ['faults'], ['kettle'], ['kettle'], ['kettle']];

/**
 * The star's oscillations (Observatory): Alpha Centauri A's p modes, νmax ≈ 2400 µHz, large
 * separation Δν ≈ 105.5 µHz, small separation δν₀₂ ≈ 5.6 µHz, linewidths ~1 µHz; heard sped up
 * 10⁵ times (so 2400 µHz is 240 Hz).
 */
export const STAR_MODES = { numax: 2400, dnu: 105.5, dnu02: 5.6, epsilon: 1.45, envelope: 380, speed: 1e5, orders: [16, 28] as const, linewidth: 1.2 } as const;

/** The modes' frequencies (µHz) and relative amplitudes: degrees 0, 1, 2 over the orders. */
export function starModes(): { nu: number; l: number; amp: number }[] {
  const M = STAR_MODES;
  const vis = [1, 1.35, 0.7];
  const out: { nu: number; l: number; amp: number }[] = [];
  for (let n = M.orders[0]; n <= M.orders[1]; n++) {
    for (let l = 0; l <= 2; l++) {
      const nu = M.dnu * (n + l / 2 + M.epsilon) - (l === 2 ? M.dnu02 : 0);
      const env = Math.exp(-0.5 * ((nu - M.numax) / M.envelope) ** 2);
      out.push({ nu, l, amp: vis[l] * env });
    }
  }
  return out;
}
