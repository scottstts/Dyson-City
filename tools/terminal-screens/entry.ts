/**
 * The terminal's screen alone, for review stills (tools/terminal-screens/shots.mjs): the real OS and
 * the real screen drawing, without the world. A shot presses keys after the boot, and optionally
 * holds the recording then playing at a moment.
 */
import { BOOT_TIME, TerminalOS, type TerminalKey } from '../../src/terminal/os/os';
import { TerminalScreen, type TerminalLive } from '../../src/terminal/os/screen';

const KEYS: Record<string, TerminalKey> = { u: 'up', d: 'down', l: 'left', r: 'right', e: 'enter', b: 'back' };
const live: TerminalLive = {
  craft: { phase: 'inbound', x: 260, z: 0, visible: true },
  lock: { outer: 0, inner: 1 },
  gate: { outer: 0, inner: 0 },
};

const screen = new TerminalScreen();
screen.preload();

/** Draws the screen after pressing `keys`, the recording playing held `at` seconds in (or the boot's voice let go). */
function shot(keys: string, at: number | null, asleep: boolean): string {
  const os = new TerminalOS();
  let t = 0;
  if (!asleep) {
    os.wake(0);
    t = BOOT_TIME + 0.1;
    os.update(t);
    for (const ch of keys) {
      t += 0.3;
      os.key(KEYS[ch], t);
      os.update(t);
    }
    t += 0.5;
    if (os.playback?.clip === 'T1' && keys.length) os.playback = null;
    if (at !== null && os.playback) os.playback.start = t - at;
    os.update(t);
  }
  (screen as unknown as { drawnVersion: number }).drawnVersion = -1;
  screen.update(os, live, t, true, () => null);
  return screen.canvas.toDataURL('image/png');
}

(window as unknown as { shot: typeof shot }).shot = shot;
