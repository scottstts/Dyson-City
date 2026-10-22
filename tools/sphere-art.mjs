#!/usr/bin/env node
/**
 * Renders the loading glyph's sphere illustration (tools/sphereArt.ts) into public/glyph/: the
 * sphere with its belt left out (front.webp, back.webp, glow.webp) and the belt's turn as a sprite
 * (belt.webp, belt-glow.webp; src/ui/sphereFrame.ts BELT gives the grid). Straight alpha,
 * transparent past what each holds; see renderRows. Work is split across worker threads; Chrome
 * encodes the WebP.
 *
 *   node tools/sphere-art.mjs [--size 204] [--ss 6] [--out public/glyph] [--preview tools/out/glyph.png]
 *
 * --size is the drawing's pixel size: three times the glyph's CSS size (.glyph --size).
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
const size = Number(opt('size', '204'));
const ss = Number(opt('ss', '6'));
const out = opt('out', 'public/glyph');
const preview = opt('preview', '');

const bundlePath = path.join(os.tmpdir(), `dyson-sphere-art-${process.pid}.mjs`);
const worker = `
import { parentPort, workerData } from 'node:worker_threads';
${'/*bundle*/'}
const { view, y0, y1, ss, part, spin } = workerData;
const r = renderRows(view, y0, y1, ss, part, spin);
parentPort.postMessage(r, [r.front.buffer, r.back.buffer, r.glow.buffer]);
`;
const bundle = await build({ input: 'tools/sphereArt.ts', platform: 'node', write: false, output: { format: 'esm' }, logLevel: 'warn' });
const code = bundle.output[0].code.replace(/export\s*\{[^}]*\};?\s*$/, '');
fs.writeFileSync(bundlePath, worker.replace('/*bundle*/', code));
const { BELT, HALF, UNIT } = await import('../src/ui/sphereFrame.ts');

// The fixed part fills the drawing; each belt cell is the BELT window at the same pixel scale.
const fixedView = { width: size, x0: -HALF / UNIT, y0: HALF / UNIT, sx: (2 * HALF) / UNIT / size, sy: (2 * HALF) / UNIT / size };
const cellW = Math.round((BELT.pitch / (2 * HALF)) * size);
const cellH = Math.round(((BELT.bottom - BELT.top) / (2 * HALF)) * size);
const cellView = { width: cellW, x0: -BELT.pitch / 2 / UNIT, y0: -BELT.top / UNIT, sx: BELT.pitch / UNIT / cellW, sy: (BELT.bottom - BELT.top) / UNIT / cellH };

const t0 = Date.now();
const threads = Math.max(1, Math.min(os.cpus().length, 12));
const chunk = Math.ceil(size / (threads * 4));
const jobs = [];
for (let y = 0; y < size; y += chunk) jobs.push({ view: fixedView, y0: y, y1: Math.min(size, y + chunk), part: 'fixed', spin: 0, frame: -1 });
for (let k = 0; k < BELT.frames; k++) jobs.push({ view: cellView, y0: 0, y1: cellH, part: 'belt', spin: (k * BELT.period) / BELT.frames, frame: k });

const layer = (w, h) => new Uint8ClampedArray(w * h * 4);
const fixed = { front: layer(size, size), back: layer(size, size), glow: layer(size, size) };
const spriteW = BELT.cols * cellW;
const spriteH = BELT.rows * cellH;
const belt = { front: layer(spriteW, spriteH), glow: layer(spriteW, spriteH) };
let clipped = 0;
try {
  let next = 0;
  await Promise.all(
    Array.from({ length: threads }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const r = await new Promise((resolve, reject) => {
          const w = new Worker(bundlePath, { workerData: { view: job.view, y0: job.y0, y1: job.y1, ss, part: job.part, spin: job.spin } });
          w.once('message', resolve);
          w.once('error', reject);
        });
        const w = job.view.width;
        for (let y = 0; y < job.y1 - job.y0; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (job.part === 'fixed') {
              const o = ((job.y0 + y) * size + x) * 4;
              for (let c = 0; c < 4; c++) {
                fixed.front[o + c] = r.front[i + c] * 255 + 0.5;
                fixed.back[o + c] = r.back[i + c] * 255 + 0.5;
                fixed.glow[o + c] = r.glow[i + c] * 255 + 0.5;
              }
            } else {
              // The belt must sit wholly inside its cell, or the sprite would crop it.
              if ((y === 0 || y === cellH - 1 || x === 0 || x === w - 1) && r.front[i + 3] > 0) clipped++;
              const gx = (job.frame % BELT.cols) * cellW + x;
              const gy = Math.floor(job.frame / BELT.cols) * cellH + y;
              const o = (gy * spriteW + gx) * 4;
              for (let c = 0; c < 4; c++) {
                belt.front[o + c] = r.front[i + c] * 255 + 0.5;
                belt.glow[o + c] = r.glow[i + c] * 255 + 0.5;
              }
            }
          }
        }
      }
    }),
  );
} finally {
  fs.rmSync(bundlePath, { force: true });
}
console.log(`traced ${size}² and ${BELT.frames} belt turns of ${cellW}×${cellH} at ${ss * ss} spp in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (clipped) throw new Error(`the belt reaches its sprite cell's edge at ${clipped} pixels: widen BELT`);

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  const encode = (pixels, w, h, type, quality) =>
    page.evaluate(
      async ({ b64, w, h, type, quality }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const canvas = new OffscreenCanvas(w, h);
        canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer), w, h), 0, 0);
        const blob = await canvas.convertToBlob({ type, quality });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { b64: Buffer.from(pixels.buffer).toString('base64'), w, h, type, quality },
    );
  fs.mkdirSync(out, { recursive: true });
  for (const [name, px, w, h, q] of [
    ['front', fixed.front, size, size, 0.92],
    ['back', fixed.back, size, size, 0.9],
    ['glow', fixed.glow, size, size, 0.9],
    ['belt', belt.front, spriteW, spriteH, 0.92],
    ['belt-glow', belt.glow, spriteW, spriteH, 0.9],
  ]) {
    const file = path.join(out, `${name}.webp`);
    fs.writeFileSync(file, Buffer.from(await encode(px, w, h, 'image/webp', q), 'base64'));
    console.log(`${file}: ${w}×${h}, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  }
  if (preview) {
    // Full heat over a dark ground, the belt at rest: back + front (over) + glow, then the belt's front (over) + glow.
    const comp = new Float32Array(size * size * 3);
    const ox = Math.round((cellW - size) / 2);
    const oy = Math.round(((HALF + BELT.top) / (2 * HALF)) * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const a = fixed.front[i + 3] / 255;
        const ab = fixed.back[i + 3] / 255;
        const ag = fixed.glow[i + 3] / 255;
        const by = y - oy;
        const bx = x + ox;
        const j = by >= 0 && by < cellH ? (by * spriteW + bx) * 4 : -1;
        const ba = j >= 0 ? belt.front[j + 3] / 255 : 0;
        for (let c = 0; c < 3; c++) {
          let v = (12 * (1 - ab) + fixed.back[i + c] * ab) * (1 - a) + fixed.front[i + c] * a + fixed.glow[i + c] * ag;
          if (j >= 0) v = v * (1 - ba) + belt.front[j + c] * ba + belt.glow[j + c] * ba;
          comp[(y * size + x) * 3 + c] = v;
        }
      }
    }
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = comp[i * 3 + c];
      rgba[i * 4 + 3] = 255;
    }
    fs.mkdirSync(path.dirname(preview), { recursive: true });
    fs.writeFileSync(preview, Buffer.from(await encode(rgba, size, size, 'image/png'), 'base64'));
    console.log(`preview: ${preview}`);
  }
} finally {
  await browser.close();
}
