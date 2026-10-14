#!/usr/bin/env node
/**
 * Headless fixed-view renders for review (not part of the game build).
 *
 *   node tools/render.mjs [--url http://localhost:5174 | --dist <vite build dir>] [--size 1920x1080]
 *                         [--dpr 1] [--out tools/out] [--frames 90] [--query "time=0&view=final"]
 *                         spot1 spot2 ...
 *
 * Each spot renders with ?autostart&spot=<name>&<query>, waits for boot plus N frames (so TAA
 * history settles), then writes <out>/<spot>[-<tag>].png. Uses the installed Google
 * Chrome with WebGPU enabled. With --dist, no dev server is needed (serveDist.mjs).
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { DIST_ORIGIN, serveDist } from './serveDist.mjs';

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
const [w, h] = opt('size', '1920x1080').split('x').map(Number);
const dpr = Number(opt('dpr', '1'));
const out = opt('out', 'tools/out');
const frames = Number(opt('frames', '90'));
const query = opt('query', '');
const tag = opt('tag', '');
const spots = args.length ? args : ['east'];

fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--enable-dawn-features=allow_unsafe_apis'],
});

try {
  for (const spot of spots) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    if (dist) await serveDist(context, dist);
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const url = `${base}/?autostart&spot=${encodeURIComponent(spot)}${query ? `&${query}` : ''}`;
    const t0 = Date.now();
    await page.goto(url);
    const ok = await page
      .waitForFunction(() => window.__dyson?.ready === true || document.querySelector('.entry.is-error') !== null, null, { timeout: 120_000 })
      .then(() => page.evaluate(() => window.__dyson?.ready === true));
    if (!ok) {
      const msg = await page.evaluate(() => document.querySelector('.entry-message')?.textContent ?? 'unknown');
      console.error(`${spot}: boot failed: ${msg}`);
      console.error(logs.slice(-20).join('\n'));
      await context.close();
      continue;
    }
    // Let TAA history settle.
    await page.evaluate(
      (n) =>
        new Promise((resolve) => {
          let k = 0;
          const step = () => (++k >= n ? resolve() : requestAnimationFrame(step));
          requestAnimationFrame(step);
        }),
      frames,
    );
    const file = path.join(out, `${spot}${tag ? `-${tag}` : ''}.png`);
    await page.screenshot({ path: file });
    const info = await page.evaluate(() => {
      const g = window.__dyson.game;
      const gpu = window.__dyson.gpuMs;
      const il = window.__dyson.world.star.illuminant.value;
      return { il: [il.x, il.y, il.z].map((v) => v.toFixed(3)).join(','), ev: Math.log2(g.pipeline.camera.exposure.value).toFixed(2), gpu: gpu === undefined ? '' : ` gpu=${(gpu / 20).toFixed(2)}ms` };
    });
    console.log(`${spot}: ${file} (${((Date.now() - t0) / 1000).toFixed(1)} s) ev=${info.ev} illum=${info.il}${info.gpu}`);
    const errors = logs.filter((l) => /error|warn/i.test(l));
    if (errors.length) console.log(errors.slice(0, 8).join('\n'));
    await context.close();
  }
} finally {
  await browser.close();
}
