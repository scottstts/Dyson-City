/**
 * The intro's script as times (docs/intro.md, docs/intro-film.md): every beat placed from the
 * lengths of the recorded lines, so the picture waits for the voices rather than cutting them off.
 * Pure: durations in, seconds out.
 *
 * Three scenes, each opening from black and closing to it:
 *  1. Waking in the pilot's seat, far outside the sphere: the ship's AI (Aurelia) speaks, the
 *     Guardian answers, then reads the side monitor.
 *  2. The descent to the West Gate: the AI hands over to the city, the ship lands, the two talk.
 *  3. Out of the door, down the stair, toward the gate; the ship leaves; the eyes come back to the
 *     gate, exactly the game's first view.
 */

/** The nine recorded lines, in order (public/intro-audio/Intro_dialogue-N). */
export const LINES = 9;
/** Who speaks each line: the ship's AI or the Guardian (the player). */
export const SPEAKER: readonly ('ai' | 'me')[] = ['ai', 'me', 'ai', 'me', 'ai', 'ai', 'me', 'ai', 'me'];

/** A short breath between one voice ending and the other answering (s). */
const ANSWER = 0.8;
/** Black between scenes, and the fades into and out of it (s). */
const BLACK = 0.9;
const FADE_IN = 1.4;
const FADE_OUT = 1.5;

export interface Timeline {
  /** Each line's start (s from the intro's start). */
  lines: number[];
  /** Total length: the last frame is the game's first. */
  end: number;
  scene1: {
    start: number;
    /** The eyes first open (before it, black with the cabin's hum). */
    wake: number;
    /** The head turns to the side monitor, and back up from it. */
    monitor: number;
    monitorEnd: number;
    fadeOut: number;
    end: number;
  };
  scene2: {
    start: number;
    fadeIn: number;
    /** The ship over the landing spot (end of the approach), and on the ground. */
    hover: number;
    touchdown: number;
    fadeOut: number;
    end: number;
  };
  scene3: {
    start: number;
    fadeIn: number;
    /**
     * Walking to the door, which opens as they come; waiting inside it while it opens and the stair
     * runs out and down; out onto the stair (stepOut) and down it; a couple of steps toward the gate.
     */
    walk: number;
    doorOpen: number;
    stairOut: number;
    stepOut: number;
    descend: number;
    ground: number;
    /** Stopped, turning round to the ship; then backing away toward the gate, watching it go. */
    stop: number;
    turnBack: number;
    back: number;
    backEnd: number;
    stairIn: number;
    doorClose: number;
    spool: number;
    liftoff: number;
    depart: number;
    /** The eyes come back to the gate. */
    turnHome: number;
    end: number;
  };
}

/** Lengths (s) of scene 3's actions, set by its mechanisms (ship/door.ts, ship/stair.ts) and the walk. */
export const SCENE3 = {
  toDoor: 1.6,
  /** The door: unlatch, out, aft. */
  door: 2.6,
  /** The stair: out from under the threshold, then down to the ground. */
  stair: 2.9,
  /** Waiting inside the door once the stair is down, then out onto its head. */
  wait: 0.5,
  stepOut: 1.2,
  /** Down the stair. */
  descend: 3.4,
  /** A couple of steps from the stair's foot toward the gate, then round to face the ship. */
  forward: 2.2,
  turnBack: 1.6,
  /** The ship closes up, spools up, lifts, turns about and goes. */
  stairIn: 2.9,
  doorClose: 2.4,
  spool: 2.6,
  lift: 4.2,
  depart: 11,
  turnHome: 3.4,
} as const;

/** Scene 2's flight: the approach to the hover, the vertical descent. */
export const SCENE2 = {
  /** Fade-in to the start of the first line. */
  firstLine: 1.8,
  /** After the last line of the approach (#5), the ship reaches its hover. */
  hoverAfter: 4.5,
  /** Hover to touchdown. */
  descent: 6.5,
  /** Touchdown to the next line (engines spool down, the AI checks the ground). */
  settle: 2.6,
} as const;

/** Scene 1: eyes closed, the wake-up, the look round before the AI speaks, the monitor. */
export const SCENE1 = {
  asleep: 3.0,
  /** From the eyes opening to the AI's first word. */
  firstLine: 4.6,
  /** After the Guardian's line, before turning to the monitor; how long they read it. */
  toMonitor: 0.6,
  reading: 6.2,
} as const;

/** Lays out the intro from the recorded lines' lengths (s, in order). */
export function buildTimeline(durations: readonly number[]): Timeline {
  if (durations.length !== LINES) throw new Error(`intro: ${durations.length} lines, expected ${LINES}`);
  const lines: number[] = [];
  const after = (i: number) => lines[i] + durations[i];

  // Scene 1.
  const s1Start = 0;
  const wake = s1Start + SCENE1.asleep;
  lines[0] = wake + SCENE1.firstLine;
  lines[1] = after(0) + ANSWER;
  const monitor = after(1) + SCENE1.toMonitor;
  const monitorEnd = monitor + SCENE1.reading;
  const fade1 = monitorEnd - 0.4;
  const s1End = fade1 + FADE_OUT;

  // Scene 2.
  const s2Start = s1End + BLACK;
  const fadeIn2 = s2Start;
  lines[2] = fadeIn2 + SCENE2.firstLine;
  lines[3] = after(2) + ANSWER;
  lines[4] = after(3) + ANSWER * 0.6;
  const hover = after(4) + SCENE2.hoverAfter;
  const touchdown = hover + SCENE2.descent;
  lines[5] = touchdown + SCENE2.settle;
  lines[6] = after(5) + ANSWER;
  lines[7] = after(6) + ANSWER;
  lines[8] = after(7) + ANSWER * 0.75;
  const fade2 = after(8) + 0.9;
  const s2End = fade2 + FADE_OUT;

  // Scene 3.
  const S = SCENE3;
  const s3Start = s2End + BLACK;
  const fadeIn3 = s3Start;
  const walk = fadeIn3 + 0.5;
  const doorOpen = walk + S.toDoor - 0.6;
  const stairOut = doorOpen + S.door - 0.5;
  const stepOut = stairOut + S.stair + S.wait;
  const descend = stepOut + S.stepOut;
  const ground = descend + S.descend;
  const stop = ground + S.forward;
  const turnBack = stop + 0.15;
  // Backing away from the moment they face the ship, until it is far off.
  const back = turnBack + S.turnBack * 0.6;
  const stairIn = turnBack + S.turnBack - 0.3;
  const doorClose = stairIn + S.stairIn - 0.4;
  const spool = doorClose + S.doorClose - 0.6;
  const liftoff = spool + S.spool;
  const depart = liftoff + S.lift;
  const turnHome = depart + S.depart - 2.2;
  const backEnd = turnHome - 0.4;
  const end = turnHome + S.turnHome;

  return {
    lines,
    end,
    scene1: { start: s1Start, wake, monitor, monitorEnd, fadeOut: fade1, end: s1End },
    scene2: { start: s2Start, fadeIn: fadeIn2, hover, touchdown, fadeOut: fade2, end: s2End },
    scene3: { start: s3Start, fadeIn: fadeIn3, walk, doorOpen, stairOut, stepOut, descend, ground, stop, turnBack, back, backEnd, stairIn, doorClose, spool, liftoff, depart, turnHome, end },
  };
}

/** The fades (0 black … 1 clear) at time t. */
export function exposureFade(tl: Timeline, t: number): number {
  const ramp = (a: number, d: number) => Math.min(Math.max((t - a) / d, 0), 1);
  const s1 = tl.scene1;
  const s2 = tl.scene2;
  const s3 = tl.scene3;
  if (t < s1.end) return 1 - ramp(s1.fadeOut, FADE_OUT);
  if (t < s2.start) return 0;
  if (t < s2.end) return ramp(s2.fadeIn, FADE_IN) * (1 - ramp(s2.fadeOut, FADE_OUT));
  if (t < s3.start) return 0;
  return ramp(s3.fadeIn, FADE_IN);
}

/** Which scene t falls in (1, 2, 3; the black between counts as the scene after it). */
export function sceneAt(tl: Timeline, t: number): 1 | 2 | 3 {
  if (t < tl.scene1.end) return 1;
  if (t < tl.scene2.end) return 2;
  return 3;
}
