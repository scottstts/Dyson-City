#!/usr/bin/env node
/**
 * Uncapped frame rate per viewpoint (not part of the game build): the real animation loop with
 * vsync and the frame-rate limit off, frozen star time, frames counted over a few seconds.
 *
 *   node tools/fps.mjs [--url http://localhost:5174] [--size 1920x1080] [--seconds 4] [--query "..."] spot…
 */
import { chromium } from 'playwright-core';

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
const [w, h] = opt('size', '1920x1080').split('x').map(Number);
const seconds = Number(opt('seconds', '4'));
const query = opt('query', '');
const spots = args.length ? args : ['east'];

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
try {
  for (const spot of spots) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(`${base}/?autostart&time=600&spot=${encodeURIComponent(spot)}${query ? `&${query}` : ''}`);
    await page.waitForFunction(() => window.__dyson?.ready === true, null, { timeout: 120_000 });
    const ms = await page.evaluate(
      (s) =>
        new Promise((resolve) => {
          let n = 0;
          let t0 = 0;
          const tick = (t) => {
            if (n === 30) t0 = t;
            n++;
            if (n > 30 && t - t0 > s * 1000) resolve((t - t0) / (n - 31));
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      seconds,
    );
    console.log(`${spot}: ${ms.toFixed(2)} ms/frame (${(1000 / ms).toFixed(0)} fps)`);
    await page.close();
  }
} finally {
  await browser.close();
}
