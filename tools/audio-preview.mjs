#!/usr/bin/env node
/**
 * Renders the game's sound for scripted scenarios to WAV files, headless and offline (not part of
 * the game build). tools/audioPreview.ts is bundled with rolldown and run in headless Chrome, where
 * the real player, airlock and GameAudio schedule into an OfflineAudioContext.
 *
 *   node tools/audio-preview.mjs [--out tools/out/audio] [scenario ...]
 *
 * Scenarios: walk-in, walk-out, chamber-stand, turn, deck (default: all). Prints the event log,
 * peak and RMS per second. `direction` instead prints the left/right balance of one source 10 m
 * away from a listener turning on the spot (the HRTF and listener orientation at work).
 */
import { chromium } from 'playwright-core';
import { build } from 'rolldown';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const out = opt('out', 'tools/out/audio');
const quiet = args.includes('--quiet') ? (args.splice(args.indexOf('--quiet'), 1), true) : false;
const scenarios = args.length ? args : ['walk-in', 'walk-out', 'chamber-stand', 'turn', 'deck'];
fs.mkdirSync(out, { recursive: true });

const bundle = await build({
  input: 'tools/audioPreview.ts',
  write: false,
  output: { format: 'iife', name: 'AudioPreview' },
  logLevel: 'warn',
});
const code = bundle.output[0].code;

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: code });

function wav(sr, left, right) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(q(left[i]), 44 + i * 4);
    buf.writeInt16LE(q(right[i]), 46 + i * 4);
  }
  return buf;
}

for (const name of scenarios) {
  if (name === 'direction') {
    const rows = await page.evaluate(() => window.AudioPreview.directionCheck());
    console.log('\n== direction: source 10 m east, listener turning 90°/s (yaw 0 faces north)');
    for (const r of rows) console.log(`  yaw ${r.yaw.toFixed(0).padStart(4)}°  L−R ${r.lr.toFixed(1).padStart(6)} dB`);
    continue;
  }
  const res = await page.evaluate(async (n) => {
    const r = await window.AudioPreview.render(n);
    const enc = (a) => {
      const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(s);
    };
    return { sampleRate: r.sampleRate, left: enc(r.left), right: enc(r.right), log: r.log };
  }, name);
  const dec = (b64) => {
    const b = Buffer.from(b64, 'base64');
    return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  };
  const left = dec(res.left);
  const right = dec(res.right);
  const file = path.join(out, `${name}.wav`);
  fs.writeFileSync(file, wav(res.sampleRate, left, right));
  console.log(`\n== ${name} → ${file}`);
  if (!quiet) for (const l of res.log) console.log('  ' + l);
  const sr = res.sampleRate;
  const rows = [];
  let clipped = 0;
  for (let s = 0; s * sr < left.length; s++) {
    let pk = 0;
    let e = 0;
    const a = s * sr;
    const b = Math.min(left.length, a + sr);
    for (let i = a; i < b; i++) {
      const m = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      pk = Math.max(pk, m);
      e += (left[i] * left[i] + right[i] * right[i]) / 2;
      if (m >= 0.999) clipped++;
    }
    const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
    rows.push(`${String(s).padStart(3)}s pk ${db(pk).padStart(6)} rms ${db(Math.sqrt(e / (b - a))).padStart(6)}`);
  }
  console.log(rows.join('\n'));
  console.log(`  clipped samples: ${clipped}`);
}
await browser.close();
