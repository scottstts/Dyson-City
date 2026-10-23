#!/usr/bin/env node
/**
 * Cold-compile check (not part of the game build): nothing may compile in play.
 *
 *   node tools/cold-compile.mjs --dist <vite build dir> [--frames 4]
 *
 * Boots the game headless (?manual: frames are stepped here), records the renderer's shader programs
 * and render pipelines once loading has finished, then looks all round from the estate's viewpoints
 * and walks the camera through the house's rooms on every floor. Any program or pipeline created
 * after loading (the counts growing) is a cold compile in play (a frozen frame the first time something comes into view):
 * listed, and the exit code is 1. The slowest stepped frames are reported too.
 */
import { chromium } from 'playwright-core';
import { DIST_ORIGIN, serveDist, serveAssetHost } from './serveDist.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dist = opt('dist', '');
const base = dist ? DIST_ORIGIN : opt('url', 'http://localhost:5174');
const frames = Number(opt('frames', '4'));

const SPOTS = ['gate', 'gateway', 'forecourt', 'approach', 'balustrade', 'pond', 'kitchen', 'carriage', 'back', 'porch', 'front', 'parlour', 'hall', 'library', 'dining', 'landing', 'study', 'turret', 'east', 'halo', 'hold'];

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--enable-dawn-features=allow_unsafe_apis'],
});
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  if (dist) await serveDist(context, dist);
  await serveAssetHost(context);
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}/?autostart&manual&spot=gate`);
  const ok = await page
    .waitForFunction(() => window.__dyson?.ready === true || document.querySelector('.entry.is-error') !== null, null, { timeout: 600_000 })
    .then(() => page.evaluate(() => window.__dyson?.ready === true));
  if (!ok) throw new Error(`boot failed\n${logs.slice(-30).join('\n')}`);
  const count = () =>
    page.evaluate(() => {
      const r = window.__dyson.game.handle.renderer;
      const p = r._pipelines;
      const programs = Object.values(p.programs).reduce((n, m) => n + m.size, 0);
      return { programs, pipelines: p.caches.size };
    });
  const before = await count();
  const slow = [];
  for (const spot of SPOTS) {
    for (let yaw = 0; yaw < 360; yaw += 45) {
      for (const pitch of [-20, 0, 35]) {
        const ms = await page.evaluate(
          ({ spot, yaw, pitch, frames }) => {
            const g = window.__dyson.game;
            g.setSpot(spot);
            g.player.setLook((yaw * Math.PI) / 180, (pitch * Math.PI) / 180);
            let worst = 0;
            for (let i = 0; i < frames; i++) {
              const t = performance.now();
              g.renderFrame();
              worst = Math.max(worst, performance.now() - t);
            }
            return worst;
          },
          { spot, yaw, pitch, frames },
        );
        slow.push({ at: `${spot} ${yaw}°/${pitch}°`, ms });
      }
    }
    // Only growth is a compile; the renderer releases pipelines nothing uses any more (a shrink).
    const now = await count();
    if (now.programs > before.programs || now.pipelines > before.pipelines) {
      console.log(`cold compile by ${spot}: programs ${before.programs} → ${now.programs}, pipelines ${before.pipelines} → ${now.pipelines}`);
      failed = true;
    }
    before.programs = Math.max(before.programs, now.programs);
    before.pipelines = Math.max(before.pipelines, now.pipelines);
  }
  slow.sort((a, b) => b.ms - a.ms);
  console.log(`slowest stepped frames (CPU ms): ${slow.slice(0, 6).map((s) => `${s.at} ${s.ms.toFixed(0)}`).join(', ')}`);
  console.log(failed ? 'FAIL: pipelines compiled after loading' : `ok: no compile after loading (${before.programs} programs, ${before.pipelines} pipelines)`);
  await context.close();
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
