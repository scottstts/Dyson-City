#!/usr/bin/env node
/**
 * Headless captures of the UI's states (not part of the game build): loading, ready, paused.
 *
 *   node tools/ui-shots.mjs [--dist dist | --url http://localhost:5174] [--size 1920x1080] [--out tools/out/ui]
 *
 * Loading is captured partway through boot, ready once the world is up, and paused after
 * simulating a pointer-lock enter and exit; it also checks that pausing holds the frame loop
 * (no frames advance while the menu is up) and that resuming restarts it.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { DIST_ORIGIN, serveDist, serveAssetHost } from './serveDist.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dist = opt('dist', '');
const base = dist ? DIST_ORIGIN : opt('url', 'http://localhost:5174');
const [w, h] = opt('size', '1920x1080').split('x').map(Number);
const out = opt('out', 'tools/out/ui');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--enable-dawn-features=allow_unsafe_apis'],
});

try {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  if (dist) await serveDist(context, dist);
  await serveAssetHost(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/`);

  const shot = async (name) => {
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`${name}: ${file}`);
  };

  // Fading, the glyph must lay over the key art with no box of its own: with the art settled and
  // the glyph held part-transparent (an isolated group, as mid-fade), its corner region must look
  // the same with the glyph shown and hidden.
  await page.waitForFunction(() => document.querySelector('.glyph.is-drawn') && document.querySelector('.entry-art.is-shown'), null, { timeout: 60_000 });
  await page.evaluate(() => {
    const art = document.querySelector('.entry-art');
    art.style.transition = 'none';
    for (const still of art.children) still.style.animationPlayState = 'paused';
    const g = document.querySelector('.glyph');
    g.style.transition = 'none';
    g.style.opacity = '0.6';
  });
  await page.waitForTimeout(100);
  const box = await page.evaluate(() => {
    const g = document.querySelector('.glyph');
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), opacity: getComputedStyle(g).opacity };
  });
  // The box's corner, outside the sphere and its bloom's brightest part.
  const clip = { x: box.x + 1, y: box.y + 1, width: 10, height: 10 };
  const shown = await page.screenshot({ clip });
  await page.evaluate(() => (document.querySelector('.glyph').style.visibility = 'hidden'));
  const hidden = await page.screenshot({ clip });
  await page.evaluate(() => {
    const g = document.querySelector('.glyph');
    const art = document.querySelector('.entry-art');
    for (const p of ['visibility', 'transition', 'opacity']) g.style.removeProperty(p);
    art.style.removeProperty('transition');
    for (const still of art.children) still.style.removeProperty('animation-play-state');
  });
  const diff = await page.evaluate(
    async ([a, b]) => {
      const pixels = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height).data;
      };
      const [p, q] = [await pixels(a), await pixels(b)];
      let s = 0;
      for (let i = 0; i < p.length; i += 4) s += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
      return s / (p.length / 4) / 3;
    },
    [shown.toString('base64'), hidden.toString('base64')],
  );
  console.log(`fading (opacity ${box.opacity}): glyph corner differs from the bare key art by ${diff.toFixed(2)}/255`);
  if (diff > 1.5) throw new Error('the glyph shows a box over the key art');
  await page.waitForTimeout(2000);
  await shot('loading-early');
  await page.waitForFunction(() => document.querySelectorAll('.glyph-coolant path.is-lit').length >= 3 || window.__dyson?.ready, null, { timeout: 300_000 });
  await shot('loading-mid');
  await page.waitForFunction(() => window.__dyson?.ready === true || document.querySelector('.entry.is-error'), null, { timeout: 300_000 });
  if (await page.evaluate(() => !!document.querySelector('.entry.is-error'))) {
    await shot('error');
    throw new Error(await page.evaluate(() => document.querySelector('.entry-message')?.textContent ?? 'boot failed'));
  }
  await page.waitForTimeout(3000);
  await shot('ready');

  // Simulated enter and pause (headless has no pointer lock).
  await page.evaluate(() => {
    const g = window.__dyson.game;
    g.input.onLockChange(true);
    g.input.onLockChange(false);
  });
  await page.waitForTimeout(800);
  const held = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const g = window.__dyson.game;
        const f0 = g.frameIndex;
        setTimeout(() => resolve({ frozen: g.frozen, advanced: g.frameIndex - f0 }), 1000);
      }),
  );
  console.log(`paused: frozen=${held.frozen}, frames advanced in 1 s: ${held.advanced}`);
  await shot('paused');
  await page.evaluate(() => {
    document.querySelector('.pause-mute').click();
  });
  await page.waitForTimeout(400);
  await shot('paused-muted');
  const stored = await page.evaluate(() => localStorage.getItem('dyson.audio.v1'));
  console.log(`stored prefs: ${stored}`);

  const resumed = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const g = window.__dyson.game;
        g.input.onLockChange(true);
        const f0 = g.frameIndex;
        setTimeout(() => resolve({ frozen: g.frozen, advanced: g.frameIndex - f0 }), 1000);
      }),
  );
  console.log(`resumed: frozen=${resumed.frozen}, frames advanced in 1 s: ${resumed.advanced}`);
  if (held.frozen !== true || held.advanced !== 0 || resumed.frozen !== false || resumed.advanced === 0) throw new Error('pause did not hold/resume the loop');
  if (errors.length) console.log(errors.join('\n'));
  await context.close();
} finally {
  await browser.close();
}
