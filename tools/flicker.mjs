#!/usr/bin/env node
/**
 * Headless temporal-stability meter (not part of the game build).
 *
 *   node tools/flicker.mjs [--url http://localhost:5174] [--size 1600x900] [--wobble 0.6]
 *                          [--periods 6] [--out tools/out] [--query "..."] [--steady] spot1 spot2 ...
 *
 * Boots each spot with ?manual&wobble=<deg>, steps frames by hand while the camera sweeps its yaw
 * periodically (37-frame period), and captures the frame at the same phase of every period after
 * a warm-up. The view is identical at those frames, so any per-pixel difference between them is
 * temporal instability under camera motion (TAA history loss, aliasing, glare pumping).
 *
 * With --steady every sweep has the same amplitude, so the camera speed at each capture is identical
 * and only the TAA jitter phase differs: what remains is aliasing and crawl, not TAA's normal
 * softening under motion. Without it, the speed differs too (a harsher, mixed test).
 *
 * Prints per spot: mean and 99.9th-percentile per-pixel σ of display luma (0–255), and the share
 * of pixels with σ above 4/255. Writes <out>/<spot>-flicker.png: a heat map of σ.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

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
const [w, h] = opt('size', '1600x900').split('x').map(Number);
const wobble = Number(opt('wobble', '0.6'));
const periods = Number(opt('periods', '6'));
const out = opt('out', 'tools/out');
const query = opt('query', '');
const steady = args.includes('--steady');
if (steady) args.splice(args.indexOf('--steady'), 1);
const spots = args.length ? args : ['east'];
const PERIOD = 37;
const WARMUP_PERIODS = 2;

fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--enable-dawn-features=allow_unsafe_apis'],
});

try {
  for (const spot of spots) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(`${base}/?autostart&manual&time=0&wobble=${wobble}${steady ? '&steady' : ''}&spot=${encodeURIComponent(spot)}${query ? `&${query}` : ''}`);
    const ok = await page
      .waitForFunction(() => window.__dyson?.ready === true || document.querySelector('.entry.is-error') !== null, null, { timeout: 180_000 })
      .then(() => page.evaluate(() => window.__dyson?.ready === true));
    if (!ok) {
      console.error(`${spot}: boot failed`);
      console.error(logs.slice(-20).join('\n'));
      await page.close();
      continue;
    }
    const result = await page.evaluate(
      async ({ PERIOD, WARMUP_PERIODS, periods }) => {
        const game = window.__dyson.game;
        const canvas = document.querySelector('canvas');
        const W = canvas.width;
        const H = canvas.height;
        const scratch = new OffscreenCanvas(W, H);
        const ctx = scratch.getContext('2d', { willReadFrequently: true });
        const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
        // The boot already rendered a few frames: align to the start of a period.
        const sum = new Float64Array(W * H);
        const sum2 = new Float64Array(W * H);
        let n = 0;
        const total = (WARMUP_PERIODS + periods) * PERIOD;
        for (let k = 0; k < total; k++) {
          game.renderFrame(1 / 60);
          const capture = k >= WARMUP_PERIODS * PERIOD && (k + 1) % PERIOD === 0;
          // A WebGPU canvas is only readable in the task that rendered it (before it is presented).
          if (capture) ctx.drawImage(canvas, 0, 0);
          await frame();
          if (capture) {
            const px = ctx.getImageData(0, 0, W, H).data;
            for (let i = 0, j = 0; i < px.length; i += 4, j++) {
              const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
              sum[j] += y;
              sum2[j] += y * y;
            }
            n++;
          }
        }
        const sigma = new Float32Array(W * H);
        for (let j = 0; j < sigma.length; j++) sigma[j] = Math.sqrt(Math.max(sum2[j] / n - (sum[j] / n) ** 2, 0));
        const sorted = Float32Array.from(sigma).sort();
        let mean = 0;
        let above = 0;
        for (const s of sigma) {
          mean += s;
          if (s > 4) above++;
        }
        // Heat map: σ of 0 → black, 8/255 or more → white.
        const img = ctx.createImageData(W, H);
        for (let j = 0; j < sigma.length; j++) {
          const v = Math.min(255, (sigma[j] / 8) * 255);
          img.data[j * 4] = v;
          img.data[j * 4 + 1] = v * 0.6;
          img.data[j * 4 + 2] = v * 0.2;
          img.data[j * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        const blob = await scratch.convertToBlob({ type: 'image/png' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let level = 0;
        for (let j = 0; j < sum.length; j++) level += sum[j] / n;
        return {
          samples: n,
          level: level / sum.length,
          mean: mean / sigma.length,
          p999: sorted[Math.floor(sorted.length * 0.999)],
          above: above / sigma.length,
          png: Array.from(bytes),
        };
      },
      { PERIOD, WARMUP_PERIODS, periods },
    );
    const file = path.join(out, `${spot}-flicker.png`);
    fs.writeFileSync(file, Buffer.from(result.png));
    console.log(
      `${spot}: samples=${result.samples} luma=${result.level.toFixed(1)} meanσ=${result.mean.toFixed(3)} p99.9σ=${result.p999.toFixed(2)} >4/255=${(result.above * 100).toFixed(3)}%  heatmap ${file}`,
    );
    const errors = logs.filter((l) => /error/i.test(l));
    if (errors.length) console.log(errors.slice(0, 8).join('\n'));
    await page.close();
  }
} finally {
  await browser.close();
}
