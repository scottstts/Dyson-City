import { describe, expect, it } from 'vitest';
import { TerminalOS, BOOT_TIME, WAKE_TIME } from '../src/terminal/os/os';
import { NARRATION } from '../src/terminal/os/cues';
import { SECTIONS, STATUS_CUE_ROWS } from '../src/terminal/os/content';

describe('the terminal OS', () => {
  it('boots once a session with its voice, wakes quietly after', () => {
    const os = new TerminalOS();
    os.wake(0);
    expect(os.booting).toBe(true);
    expect(os.playback?.clip).toBe('T1');
    os.update(BOOT_TIME + 0.01);
    expect(os.booting).toBe(false);
    os.sleep(3);
    expect(os.playback).toBeNull();
    os.wake(10);
    expect(os.playback).toBeNull();
    os.update(10 + WAKE_TIME + 0.01);
    expect(os.booting).toBe(false);
  });

  it('navigates sections and entries, plays what it opens, and stops it going back', () => {
    const os = new TerminalOS();
    os.wake(0);
    os.update(5);
    os.key('down', 5);
    expect(os.current.id).toBe('comms');
    os.key('right', 5.1);
    expect(os.level).toBe(1);
    os.key('down', 5.2);
    os.key('enter', 5.3);
    expect(os.level).toBe(2);
    expect(os.playback?.clip).toBe('T5');
    os.key('enter', 6);
    expect(os.playback).toBeNull();
    os.key('enter', 6.5);
    expect(os.playback?.clip).toBe('T5');
    os.key('left', 7);
    expect(os.level).toBe(1);
    expect(os.playback).toBeNull();
    os.key('left', 7.1);
    os.key('left', 7.2);
    expect(os.level).toBe(0);
    expect(os.events.at(-1)?.kind).toBe('deny');
  });

  it('opens one-page sections directly; the feed leads into the star\'s song', () => {
    const os = new TerminalOS();
    os.wake(0);
    os.update(5);
    for (let i = 0; i < 3; i++) os.key('down', 5);
    expect(os.current.id).toBe('observatory');
    os.key('right', 5);
    expect(os.level).toBe(2);
    expect(os.playback?.clip).toBe('T6');
    const end = os.playback!.start + NARRATION.T6.duration;
    os.update(end + 0.01);
    expect(os.playback).toBeNull();
    expect(os.song).not.toBeNull();
    os.key('back', end + 1);
    expect(os.song).toBeNull();
    expect(os.level).toBe(0);
  });

  it('shows the line being spoken', () => {
    const os = new TerminalOS();
    os.wake(0);
    const start = os.playback!.start;
    const q = NARRATION.T1.cues[2];
    expect(os.subtitle(start + (q.t0 + q.t1) / 2)?.text).toBe(q.text);
  });
});

describe('the narration cues', () => {
  it('run in order, inside each recording', () => {
    for (const [id, n] of Object.entries(NARRATION)) {
      let last = -Infinity;
      for (const q of n.cues) {
        expect(q.t0, `${id} ${q.text}`).toBeGreaterThanOrEqual(last - 1e-6);
        expect(q.t1).toBeGreaterThan(q.t0);
        expect(q.t1).toBeLessThanOrEqual(n.duration + 1e-6);
        last = q.t1;
      }
    }
  });

  it('every clip an entry plays exists; Control lights a row set for each of its lines', () => {
    for (const s of SECTIONS) for (const it of [...s.items, ...(s.page ? [s.page] : [])]) if (it.clip) expect(NARRATION[it.clip]).toBeDefined();
    expect(STATUS_CUE_ROWS.length).toBe(NARRATION.T3.cues.length);
  });

  it('the story\'s beats are each said once', () => {
    for (const w of ['2061', 'fell toward', 'found rock', '40 years', 'plates met', 'sphere closed', 'On the inside', 'where you come in']) {
      expect(NARRATION.T2.cues.filter((q) => q.text.includes(w)).length, w).toBe(1);
    }
  });
});
