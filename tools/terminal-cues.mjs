#!/usr/bin/env node
/**
 * Subtitle timings for the terminal's narration (docs/terminal.md).
 *
 * Reads each clip's script from docs/terminal-narration.md (the `> ` lines under `**T<n> ·`),
 * splits it into subtitle lines (sentences; long ones at a clause), finds the pauses in
 * public/speeches/T<n>.mp3 (ffmpeg silencedetect), and places each line's start and end on pauses
 * by dynamic programming: the boundaries' share of the clip's speech must follow the lines' share
 * of the text.
 *
 * Where the user has given a timestamped transcript (tools/terminal-transcripts.json), its lines are
 * the subtitles and its times are used as given (they come from the TTS; snapping them to detected
 * pauses made things worse, as the detector splits short words), scaled only if they run past the
 * recording's end. A line too long for the screen is split at the pause nearest its clause break.
 *
 * Writes src/terminal/os/cues.ts. Re-run after re-recording a clip or editing a script.
 *
 *   node tools/terminal-cues.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(join(root, 'docs/terminal-narration.md'), 'utf8');

/** Each clip's paragraphs, by id. */
function scripts() {
  const out = {};
  let id = null;
  for (const line of doc.split('\n')) {
    const head = line.match(/^\*\*(T\d+) ·/);
    if (head) {
      id = head[1];
      out[id] = [];
      continue;
    }
    if (id && line.startsWith('> ')) out[id].push(line.slice(2).trim());
    else if (id && line.trim() && !line.startsWith('>')) id = out[id].length ? null : id;
  }
  return out;
}

/** Subtitle lines: sentences, and sentences over MAX characters split at clauses until they fit. */
const MAX = 84;
function split(s) {
  if (s.length <= MAX) return [s];
  const marks = [...s.matchAll(/[,:;—] /g)].map((m) => m.index + 1).filter((i) => i > 8 && i < s.length - 8);
  if (!marks.length) return [s];
  const mid = s.length / 2;
  const cut = marks.reduce((x, y) => (Math.abs(y - mid) < Math.abs(x - mid) ? y : x));
  return [...split(s.slice(0, cut).trim()), ...split(s.slice(cut).trim())];
}
function lines(paragraphs) {
  const out = [];
  /** Indices of lines that end a paragraph: a reader pauses longer there. */
  out.ends = new Set();
  for (const p of paragraphs) {
    // An ellipsis before a lower-case word trails off mid-sentence: not a sentence end.
    const q = p.replace(/…(?= [a-z])/g, "\u2056");
    const sentences = q.match(/[^.!?…]+[.!?…]+["”’)]*\s*|[^.!?…]+$/g) ?? [q];
    for (const raw of sentences) {
      const t = raw.trim().replace(/\u2056/g, "…");
      if (t) out.push(...split(t));
    }
    out.ends.add(out.length - 1);
  }
  return out;
}

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number(out.trim());
}

function pauses(file) {
  const log = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-38dB:d=0.18', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => [s, ends[i] ?? s]);
}

/**
 * Places the lines' n − 1 boundaries on pauses (in order) so that each line's span is as close as
 * can be to its share of the speech by its text (squared log ratio, by dynamic programming).
 */
function align(texts, gaps, duration) {
  const weights = texts.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length + 3);
  const total = weights.reduce((x, y) => x + y, 0);
  // Speech start and end: the leading and trailing silences.
  const first = gaps.length && gaps[0][0] < 0.05 ? gaps[0][1] : 0;
  const last = gaps.length && gaps[gaps.length - 1][1] > duration - 0.05 ? gaps[gaps.length - 1][0] : duration;
  const pauses = gaps.filter(([g0, g1]) => g0 > first + 0.05 && g1 < last - 0.05);
  // Boundaries: every pause, and a few points inside each run of speech (a voice can run two
  // sentences together), the latter at a cost.
  const inner = pauses.map(([g0, g1]) => [g0, g1, 0]);
  const edges = [first, ...pauses.flat(), last];
  for (let i = 0; i < edges.length; i += 2) {
    const [a, b] = [edges[i], edges[i + 1]];
    if (b - a < 1.2) continue;
    for (const f of [0.25, 0.4, 0.55, 0.7]) inner.push([a + (b - a) * f, a + (b - a) * f, 0.6]);
  }
  inner.sort((x, y) => x[0] - y[0]);
  const n = texts.length - 1;
  const m = inner.length;
  if (n === 0) return [[first, last]];
  if (m < n) throw new Error(`only ${m} pauses for ${n} boundaries`);
  const expect = weights.map((w) => ((last - first) * w) / total);
  const seg = (i, t0, t1) => Math.log((t1 - t0 + 0.2) / (expect[i] + 0.2)) ** 2;
  // A paragraph's end wants a real pause.
  const brk = (i, g) => (texts.ends?.has(i) ? 1.5 * Math.max(0, 0.55 - (g[1] - g[0])) : 0);
  // cost[i][j]: lines 0..i placed, line i ending at pause j.
  const cost = Array.from({ length: n }, () => new Array(m).fill(Infinity));
  const from = Array.from({ length: n }, () => new Array(m).fill(-1));
  for (let j = 0; j < m; j++) cost[0][j] = seg(0, first, inner[j][0]) + inner[j][2] + brk(0, inner[j]);
  for (let i = 1; i < n; i++) {
    for (let j = i; j < m; j++) {
      for (let k = i - 1; k < j; k++) {
        const c = cost[i - 1][k] + seg(i, inner[k][1], inner[j][0]) + inner[j][2] + brk(i, inner[j]);
        if (c < cost[i][j]) {
          cost[i][j] = c;
          from[i][j] = k;
        }
      }
    }
  }
  let j = -1;
  let best = Infinity;
  for (let k = n - 1; k < m; k++) {
    const c = cost[n - 1][k] + seg(n, inner[k][1], last);
    if (c < best) {
      best = c;
      j = k;
    }
  }
  const picks = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    picks[i] = j;
    j = from[i][j];
  }
  const spans = [];
  let start = first;
  for (let i = 0; i < n; i++) {
    const g = inner[picks[i]];
    spans.push([start, g[0]]);
    start = g[1];
  }
  spans.push([start, last]);
  return spans;
}

/** Cues from a timed transcript: scaled to the recording, snapped to its pauses, long lines split. */
function fromTranscript(entries, gaps, duration) {
  const first = gaps.length && gaps[0][0] < 0.05 ? gaps[0][1] : 0;
  const last = gaps.length && gaps[gaps.length - 1][1] > duration - 0.05 ? gaps[gaps.length - 1][0] : duration;
  const end = Math.max(...entries.map((e) => e[1]));
  const k = end > last ? last / end : 1;
  const inner = gaps.filter(([g0, g1]) => g0 > first + 0.05 && g1 < last - 0.05);
  const cues = [];
  entries.forEach(([t0s, t1s, text]) => {
    const t0 = Math.min(t0s * k, duration);
    const t1 = Math.min(t1s * k, duration);
    const parts = split(text);
    if (parts.length === 1) {
      cues.push({ t0, t1, text });
      return;
    }
    // Split at the pauses inside the line nearest each clause break's share of it.
    const w = parts.map((q) => q.length);
    const total = w.reduce((x, y) => x + y, 0);
    const inside = inner.filter(([g0, g1]) => g0 > t0 + 0.3 && g1 < t1 - 0.3);
    let start = t0;
    let acc = 0;
    parts.forEach((q, j) => {
      acc += w[j];
      if (j === parts.length - 1) {
        cues.push({ t0: start, t1, text: q });
        return;
      }
      const want = t0 + ((t1 - t0) * acc) / total;
      const g = inside.reduce((x, y) => (!x || Math.abs((y[0] + y[1]) / 2 - want) < Math.abs((x[0] + x[1]) / 2 - want) ? y : x), null);
      const [e, n] = g ? [g[0], g[1]] : [want, want];
      cues.push({ t0: start, t1: e, text: q });
      start = n;
    });
  });
  return cues.map((c) => ({ t0: +c.t0.toFixed(2), t1: +c.t1.toFixed(2), text: c.text }));
}

const all = scripts();
const transcripts = JSON.parse(readFileSync(join(root, 'tools/terminal-transcripts.json'), 'utf8'));
const out = [];
for (const id of Object.keys(all).sort()) {
  const file = join(root, `public/speeches/${id}.mp3`);
  const duration = probe(file);
  const gaps = pauses(file);
  if (transcripts[id]) {
    out.push({ id, duration, cues: fromTranscript(transcripts[id], gaps, duration) });
  } else {
    const texts = lines(all[id]);
    const spans = align(texts, gaps, duration);
    out.push({ id, duration, cues: texts.map((text, i) => ({ t0: +spans[i][0].toFixed(2), t1: +spans[i][1].toFixed(2), text })) });
  }
  console.log(`${id} ${duration.toFixed(2)} s, ${out[out.length - 1].cues.length} lines${transcripts[id] ? " (transcript)" : ""}`);
  for (const c of out[out.length - 1].cues) console.log(`  ${c.t0.toFixed(2)}–${c.t1.toFixed(2)}  ${c.text}`);
}

const body = out
  .map(
    (c) =>
      `  ${c.id}: {\n    duration: ${c.duration.toFixed(3)},\n    cues: [\n${c.cues.map((q) => `      { t0: ${q.t0}, t1: ${q.t1}, text: ${JSON.stringify(q.text)} },`).join('\n')}\n    ],\n  },`,
  )
  .join('\n');
const ts = `/**
 * Subtitle cues for the terminal's narration: generated by tools/terminal-cues.mjs from
 * docs/terminal-narration.md and the recordings in public/speeches/. Do not edit by hand.
 */
export interface Cue {
  t0: number;
  t1: number;
  text: string;
}

export const NARRATION = {
${body}
} as const satisfies Record<string, { duration: number; cues: readonly Cue[] }>;

export type ClipId = keyof typeof NARRATION;
`;
writeFileSync(join(root, 'src/terminal/os/cues.ts'), ts);
console.log('wrote src/terminal/os/cues.ts');
