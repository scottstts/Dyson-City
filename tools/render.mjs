#!/usr/bin/env node
/**
 * Headless fixed-view renders for review (not part of the game build).
 *
 *   node tools/render.mjs [--url http://localhost:5174 | --dist <vite build dir>] [--size 1920x1080]
 *                         [--dpr 1] [--out tools/out] [--frames 90] [--query "time=0&view=final"]
 *                         [--one-boot] [--verbose] spot1 spot2 ...
 *
 * Each spot renders with ?autostart&spot=<name>&<query>, waits for boot plus N frames (so TAA
 * history settles), then writes <out>/<spot>[-<tag>].png. Uses the installed Google
 * Chrome with WebGPU enabled. With --dist, no dev server is needed (serveDist.mjs). With --one-boot
 * the page boots once (first spot) and later spots are reached with __dyson.game.setSpot (a
 * headless boot takes minutes); spots may also be "x,z,yawDeg,pitchDeg".
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
const [w, h] = opt('size', '1920x1080').split('x').map(Number);
const dpr = Number(opt('dpr', '1'));
const out = opt('out', 'tools/out');
const frames = Number(opt('frames', '90'));
const query = opt('query', '');
const tag = opt('tag', '');
const oneBoot = args.includes('--one-boot') ? (args.splice(args.indexOf('--one-boot'), 1), true) : false;
const verbose = args.includes('--verbose') ? (args.splice(args.indexOf('--verbose'), 1), true) : false;
const spots = args.length ? args : ['east'];

fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--enable-dawn-features=allow_unsafe_apis'],
});

const settle = (page, n) =>
  page.evaluate(
    (k) =>
      new Promise((resolve) => {
        let i = 0;
        const step = () => (++i >= k ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n,
  );

const spotArg = (spot) => {
  const parts = spot.split(',').map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? { position: [parts[0], parts[1]], yaw: (parts[2] * Math.PI) / 180, pitch: (parts[3] * Math.PI) / 180 } : null;
};

async function capture(page, spot, logs, t0) {
  await settle(page, frames);
  const file = path.join(out, `${spot.replace(/[^\w.-]+/g, '_')}${tag ? `-${tag}` : ''}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => {
    const g = window.__dyson.game;
    const gpu = window.__dyson.gpuMs;
    const il = window.__dyson.world.star.illuminant.value;
    return { il: [il.x, il.y, il.z].map((v) => v.toFixed(3)).join(','), ev: Math.log2(g.pipeline.camera.exposure.value).toFixed(2), gpu: gpu === undefined ? '' : ` gpu=${(gpu / 20).toFixed(2)}ms` };
  });
  console.log(`${spot}: ${file} (${((Date.now() - t0) / 1000).toFixed(1)} s) ev=${info.ev} illum=${info.il}${info.gpu}`);
}

async function boot(spot) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  if (dist) await serveDist(context, dist);
  await serveAssetHost(context);
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const custom = spotArg(spot);
  const url = `${base}/?autostart&spot=${custom ? 'gate' : encodeURIComponent(spot)}${query ? `&${query}` : ''}`;
  await page.goto(url);
  const ok = await page
    .waitForFunction(() => window.__dyson?.ready === true || document.querySelector('.entry.is-error') !== null, null, { timeout: 300_000 })
    .then(() => page.evaluate(() => window.__dyson?.ready === true))
    .catch((e) => {
      console.error(`${spot}: ${e.message}`);
      return false;
    });
  if (!ok) {
    const msg = await page.evaluate(() => document.querySelector('.entry-message')?.textContent ?? 'unknown');
    console.error(`${spot}: boot failed: ${msg}`);
    console.error(logs.slice(-30).join('\n'));
    await context.close();
    return null;
  }
  if (custom) await page.evaluate((s) => window.__dyson.game.setSpot(s), custom);
  return { context, page, logs };
}

function report(logs) {
  if (verbose) console.log(logs.join('\n'));
  const errors = logs.filter((l) => /error|warn/i.test(l));
  if (errors.length) console.log(errors.slice(0, 8).join('\n'));
}

try {
  if (oneBoot) {
    const t0 = Date.now();
    const b = await boot(spots[0]);
    if (b) {
      for (const spot of spots) {
        const t1 = spot === spots[0] ? t0 : Date.now();
        if (spot !== spots[0]) await b.page.evaluate((s) => window.__dyson.game.setSpot(s), spotArg(spot) ?? spot);
        await capture(b.page, spot, b.logs, t1);
      }
      report(b.logs);
      await b.context.close();
    }
  } else {
    for (const spot of spots) {
      const t0 = Date.now();
      const b = await boot(spot);
      if (!b) continue;
      await capture(b.page, spot, b.logs, t0);
      report(b.logs);
      await b.context.close();
    }
  }
} finally {
  await browser.close();
}
