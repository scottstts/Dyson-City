#!/usr/bin/env node
/**
 * Motion clips for review (not part of the game build): boots a spot once with ?manual, steps game
 * time by hand (four TAA sub-frames per captured frame, as the game would run at 60 fps for 15 fps
 * capture) and encodes the frames to H.264 with ffmpeg.
 *
 *   node tools/clip.mjs [--url http://localhost:5174] [--size 1280x720] [--fps 15] [--seconds 20]
 *                       [--speed 1] [--start 0] [--query "fov=30&look=20,47"] [--out tools/out/clips] spot
 *
 * --speed scales game time per real second of the clip (1 = real time); --start jumps the star clock
 * ahead (seconds of game time) before capture.
 */
import { chromium } from 'playwright-core';
import { serveHousePack } from './serveDist.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) {
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  }
  return fallback;
};
const base = opt('url', 'http://localhost:5174');
const [w, h] = opt('size', '1280x720').split('x').map(Number);
const fps = Number(opt('fps', '15'));
const seconds = Number(opt('seconds', '20'));
const speed = Number(opt('speed', '1'));
const start = Number(opt('start', '0'));
const query = opt('query', '');
const out = opt('out', 'tools/out/clips');
const tag = opt('tag', '');
const spot = args[0] ?? 'east';

const frameDir = path.join(out, `${spot}${tag ? `-${tag}` : ''}-frames`);
fs.rmSync(frameDir, { recursive: true, force: true });
fs.mkdirSync(frameDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU'],
});
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await serveHousePack(page.context());
  await page.goto(`${base}/?autostart&manual&spot=${encodeURIComponent(spot)}${query ? `&${query}` : ''}`);
  const ok = await page
    .waitForFunction(() => window.__dyson?.ready === true || document.querySelector('.entry.is-error') !== null, null, { timeout: 180_000 })
    .then(() => page.evaluate(() => window.__dyson?.ready === true));
  if (!ok) throw new Error('boot failed');
  await page.exposeFunction('saveFrame', (i, b64) => fs.writeFileSync(path.join(frameDir, `${String(i).padStart(5, '0')}.jpg`), Buffer.from(b64, 'base64')));
  await page.evaluate(
    async ({ frames, dt, start }) => {
      const game = window.__dyson.game;
      const canvas = document.querySelector('canvas');
      const scratch = new OffscreenCanvas(canvas.width, canvas.height);
      const ctx = scratch.getContext('2d');
      const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
      if (start > 0) game.renderFrame(start);
      // Settle TAA history at the start time.
      for (let k = 0; k < 30; k++) {
        game.renderFrame(1 / 240);
        await raf();
      }
      for (let i = 0; i < frames; i++) {
        for (let s = 0; s < 4; s++) {
          game.renderFrame(dt / 4);
          // A WebGPU canvas is only readable in the task that rendered it (before it is presented).
          if (s === 3) ctx.drawImage(canvas, 0, 0);
          await raf();
        }
        const blob = await scratch.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
        await window.saveFrame(i, btoa(bin));
      }
    },
    { frames: Math.round(seconds * fps), dt: speed / fps, start },
  );
} finally {
  await browser.close();
}
const file = path.join(out, `${spot}${tag ? `-${tag}` : ''}.mp4`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frameDir, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', file]);
fs.rmSync(frameDir, { recursive: true, force: true });
console.log(`${spot}: ${file} (${seconds} s at ${speed}× game time)`);
