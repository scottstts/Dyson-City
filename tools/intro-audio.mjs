#!/usr/bin/env node
/**
 * Renders the intro's soundtrack to a WAV, headless and offline (docs/intro-audio.md):
 * tools/introAudio.ts bundled and run in headless Chrome over the real flight, eye and sound.
 *
 *   node tools/intro-audio.mjs [--from s] [--to s] [--level ambient=0,…] [--out tools/out/audio]
 *
 * Prints the timeline, where the listener is, and the peak and RMS per second, with clipping.
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
const from = Number(opt('from', '0'));
const to = Number(opt('to', '-1'));
// --level ambient=0,rumble=0: intro levels overridden (to hear one source alone).
const levels = Object.fromEntries((opt('level', '') || '').split(',').filter(Boolean).map((kv) => [kv.split('=')[0], Number(kv.split('=')[1])]));
fs.mkdirSync(out, { recursive: true });

const FILES = ['Intro_dialogue-1.mp3', 'Intro_dialogue-2.wav', 'Intro_dialogue-3.mp3', 'Intro_dialogue-4.wav', 'Intro_dialogue-5.mp3', 'Intro_dialogue-6.mp3', 'Intro_dialogue-7.wav', 'Intro_dialogue-8.mp3', 'Intro_dialogue-9.wav'];
const lines = FILES.map((f) => fs.readFileSync(path.join('public/intro-audio', f)).toString('base64'));

const bundle = await build({
  input: 'tools/introAudio.ts',
  write: false,
  platform: 'browser',
  output: { format: 'iife', name: 'IntroAudio' },
  transform: { define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false' } },
  logLevel: 'warn',
});
const code = bundle.output[0].code;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: code });
const res = await page.evaluate(
  async ([b64s, a, b, lv]) => {
    const files = b64s.map((s) => {
      const bin = atob(s);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u.buffer;
    });
    const r = await window.IntroAudio.render(files, a, b, lv);
    const enc = (x) => {
      const u = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(s);
    };
    return { sampleRate: r.sampleRate, left: enc(r.left), right: enc(r.right), log: r.log };
  },
  [lines, from, to, levels],
);
await browser.close();
const dec = (b64) => {
  const b = Buffer.from(b64, 'base64');
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const left = dec(res.left);
const right = dec(res.right);
const sr = res.sampleRate;
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
const file = path.join(out, `intro${from ? `-${from}` : ''}.wav`);
fs.writeFileSync(file, buf);
console.log(res.log.join('\n'));
let clipped = 0;
const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
for (let s = 0; s * sr < n; s++) {
  let pk = 0;
  let e = 0;
  const a = s * sr;
  const b = Math.min(n, a + sr);
  for (let i = a; i < b; i++) {
    const m = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    pk = Math.max(pk, m);
    e += (left[i] * left[i] + right[i] * right[i]) / 2;
    if (m >= 0.999) clipped++;
  }
  console.log(`${String(from + s).padStart(4)}s pk ${db(pk).padStart(6)} rms ${db(Math.sqrt(e / (b - a))).padStart(6)}`);
}
console.log(`clipped samples: ${clipped}\n→ ${file}`);
