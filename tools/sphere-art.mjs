#!/usr/bin/env node
/**
 * Renders the loading glyph's sphere illustration (tools/sphereArt.ts) into public/glyph/
 * (front.webp, back.webp and glow.webp; straight alpha, transparent past the sphere; see
 * renderRows for what each holds). Rows are split
 * across worker threads; Chrome encodes the WebP.
 *
 *   node tools/sphere-art.mjs [--size 1200] [--ss 4] [--out public/glyph] [--preview tools/out/glyph.png]
 */
import { build } from 'rolldown';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const size = Number(opt('size', '1200'));
const ss = Number(opt('ss', '4'));
const out = opt('out', 'public/glyph');
const preview = opt('preview', '');

const bundlePath = path.join(os.tmpdir(), `dyson-sphere-art-${process.pid}.mjs`);
const worker = `
import { parentPort, workerData } from 'node:worker_threads';
${'/*bundle*/'}
const { size, y0, y1, ss } = workerData;
const r = renderRows(size, y0, y1, ss);
parentPort.postMessage(r, [r.front.buffer, r.back.buffer, r.glow.buffer]);
`;
const bundle = await build({ input: 'tools/sphereArt.ts', platform: 'node', write: false, output: { format: 'esm' }, logLevel: 'warn' });
const code = bundle.output[0].code.replace(/export\s*\{[^}]*\};?\s*$/, '');
fs.writeFileSync(bundlePath, worker.replace('/*bundle*/', code));

const t0 = Date.now();
const threads = Math.max(1, Math.min(os.cpus().length, 12));
const chunk = Math.ceil(size / (threads * 4));
const jobs = [];
for (let y = 0; y < size; y += chunk) jobs.push([y, Math.min(size, y + chunk)]);
const front = new Uint8ClampedArray(size * size * 4);
const back = new Uint8ClampedArray(size * size * 4);
const glow = new Uint8ClampedArray(size * size * 4);
try {
  let next = 0;
  await Promise.all(
    Array.from({ length: threads }, async () => {
      while (next < jobs.length) {
        const [y0, y1] = jobs[next++];
        const r = await new Promise((resolve, reject) => {
          const w = new Worker(bundlePath, { workerData: { size, y0, y1, ss } });
          w.once('message', resolve);
          w.once('error', reject);
        });
        for (let i = 0; i < (y1 - y0) * size; i++) {
          const o = y0 * size + i;
          for (let c = 0; c < 4; c++) {
            front[o * 4 + c] = r.front[i * 4 + c] * 255 + 0.5;
            back[o * 4 + c] = r.back[i * 4 + c] * 255 + 0.5;
            glow[o * 4 + c] = r.glow[i * 4 + c] * 255 + 0.5;
          }
        }
      }
    }),
  );
} finally {
  fs.rmSync(bundlePath, { force: true });
}
console.log(`traced ${size}² at ${ss * ss} spp in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  const encode = (pixels, type, quality) =>
    page.evaluate(
      async ({ b64, size, type, quality }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const canvas = new OffscreenCanvas(size, size);
        canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer), size, size), 0, 0);
        const blob = await canvas.convertToBlob({ type, quality });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { b64: Buffer.from(pixels.buffer).toString('base64'), size, type, quality },
    );
  fs.mkdirSync(out, { recursive: true });
  for (const [name, px, q] of [
    ['front', front, 0.9],
    ['back', back, 0.88],
    ['glow', glow, 0.88],
  ]) {
    const file = path.join(out, `${name}.webp`);
    fs.writeFileSync(file, Buffer.from(await encode(px, 'image/webp', q), 'base64'));
    console.log(`${file}: ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  }
  if (preview) {
    // Full heat over a dark ground: back + front (over) + glow.
    const comp = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const a = front[i * 4 + 3] / 255;
      const ab = back[i * 4 + 3] / 255;
      const ag = glow[i * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) comp[i * 4 + c] = (12 * (1 - ab) + back[i * 4 + c] * ab) * (1 - a) + front[i * 4 + c] * a + glow[i * 4 + c] * ag;
      comp[i * 4 + 3] = 255;
    }
    fs.mkdirSync(path.dirname(preview), { recursive: true });
    fs.writeFileSync(preview, Buffer.from(await encode(comp, 'image/png'), 'base64'));
    console.log(`preview: ${preview}`);
  }
} finally {
  await browser.close();
}
