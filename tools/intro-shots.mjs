#!/usr/bin/env node
/**
 * Stills of the intro for review (docs/intro-film.md): boots once with ?intro, then jumps to each
 * time and holds it there (the world and the film held), lets TAA and the eye settle, and writes
 * tools/out/intro/t<seconds>.png.
 *
 *   node tools/intro-shots.mjs [--dist <vite build>] [--size 1600x900] [--frames 60] [--query ...] t1 t2 …
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { DIST_ORIGIN, serveDist, serveAssetHost } from './serveDist.mjs';

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
const dist = opt('dist', '');
const base = dist ? DIST_ORIGIN : opt('url', 'http://localhost:5174');
const [w, h] = opt('size', '1600x900').split('x').map(Number);
const frames = Number(opt('frames', '60'));
const query = opt('query', '');
const out = opt('out', 'tools/out/intro');
const verbose = args.includes('--verbose') ? (args.splice(args.indexOf('--verbose'), 1), true) : false;
const times = (args.length ? args : ['10', '30', '42', '55', '75', '90', '125', '140', '150']).map(Number);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--enable-dawn-features=allow_unsafe_apis', '--autoplay-policy=no-user-gesture-required'],
});
const settle = (page, n) => page.evaluate((k) => new Promise((resolve) => {
  let i = 0;
  const step = () => (++i >= k ? resolve() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);
try {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  if (dist) await serveDist(context, dist);
  await serveAssetHost(context);
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  await page.goto(`${base}/?intro=${times[0]}:hold${query ? `&${query}` : ''}`);
  const ok = await page
    .waitForFunction(() => window.__dyson?.ready === true || document.querySelector('.entry.is-error') !== null, null, { timeout: 300_000 })
    .then(() => page.evaluate(() => window.__dyson?.ready === true));
  if (!ok) {
    console.error('boot failed:', await page.evaluate(() => document.querySelector('.entry-message')?.textContent ?? ''));
    console.error(logs.slice(-30).join('\n'));
  } else {
    console.log(`booted in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const t of times) {
      await page.evaluate((s) => window.__dyson.game.introSeek(s, true), t);
      await settle(page, frames);
      const file = path.join(out, `t${String(t).replace('.', '_')}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
  if (verbose) console.log(logs.join('\n'));
  else {
    const errors = logs.filter((l) => /error|warn/i.test(l));
    if (errors.length) console.log(errors.slice(0, 10).join('\n'));
  }
  await context.close();
} finally {
  await browser.close();
}
