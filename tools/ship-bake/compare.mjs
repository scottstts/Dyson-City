#!/usr/bin/env node
/**
 * The cabin's baked light against ground truth (docs/intro-ship.md, "Light"): the game's HDR view
 * (linear radiance × 2^ev, sRGB) and Cycles path-tracing the same cabin under the same light
 * (blender/ship/bake.py `views`), from the same cameras in the ship frame, side by side.
 *
 *   node tools/ship-bake/compare.mjs --dist <vite build> [--scene band|space|door] [--ev 4] x,y,z,yaw,pitch …
 *
 * band: landed (scene 2); space: scene 1; door: scene 3 with the door fully open.
 *
 * yaw 0 looks forward (+x), + to port; pitch + up. Writes tools/out/ship-compare/<n>_{game,cycles}.png.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DIST_ORIGIN, serveDist, serveAssetHost } from '../serveDist.mjs';
import { CHROME, CHROME_ARGS } from '../hdr.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const dist = opt('dist', '');
const scene = opt('scene', 'band');
const ev = Number(opt('ev', '4'));
const samples = Number(opt('samples', '512'));
const [W, H] = [800, 450];
const FOV = 62;
const OUT = path.resolve('tools/out/ship-compare');
fs.mkdirSync(OUT, { recursive: true });

/** Rotation (column-major 3 × 3: right, up, back) of a camera at yaw/pitch (degrees) in the ship frame. */
function rotation(yaw, pitch) {
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  const f = [Math.cos(p) * Math.cos(y), Math.sin(p), -Math.cos(p) * Math.sin(y)];
  const r0 = [-f[2], 0, f[0]];
  const rl = Math.hypot(r0[0], r0[2]);
  const r = [r0[0] / rl, 0, r0[2] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return [...r, ...u, ...f.map((x) => -x)];
}
const views = args.map((s, i) => {
  const [x, y, z, yaw, pitch] = s.split(',').map(Number);
  return { position: [x, y, z], rotation: rotation(yaw, pitch), out: path.join(OUT, `${i}_cycles.png`), game: path.join(OUT, `${i}_game.png`) };
});

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: CHROME_ARGS });
try {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await serveDist(context, dist);
  await serveAssetHost(context);
  const page = await context.newPage();
  await page.goto(`${DIST_ORIGIN}/?intro=1:hold&manual&view=hdr&ev=${ev}&fov=${FOV}`);
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  await page.waitForFunction(() => window.__dyson?.ready === true || document.querySelector('.entry.is-error') !== null, null, { timeout: 600_000 });
  if (!(await page.evaluate(() => window.__dyson?.ready === true))) throw new Error(`boot failed\n${logs.filter((l) => l.startsWith('[error]')).slice(0, 5).join('\n')}`);
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  const tl = await page.evaluate(() => window.__dyson.game.introTimeline());
  // The door: open and the stair down, just before the eye steps out.
  const t = scene === 'space' ? (tl.scene1.wake + tl.scene1.monitor) / 2 : scene === 'door' ? tl.scene3.stepOut - 0.3 : tl.scene2.touchdown + 3;
  for (const v of views) {
    const r = v.rotation;
    const m = [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, ...v.position, 1];
    await page.evaluate(({ t, m }) => {
      const g = window.__dyson.game;
      g.introSeek(t, true);
      g.introCapture(m, false);
      for (let i = 0; i < 24; i++) g.renderFrame();
    }, { t, m });
    await page.screenshot({ path: v.game });
    console.info(v.game);
  }
} finally {
  await browser.close();
}
const spec = path.join(OUT, 'views.json');
fs.writeFileSync(spec, JSON.stringify({ scene: scene === 'door' ? 'band' : scene, door: scene === 'door', ev, fov: FOV, size: [W, H], samples, views }));
execFileSync('/Applications/Blender.app/Contents/MacOS/Blender', ['-b', '--factory-startup', '--python', 'blender/ship/bake.py', '--', 'views', spec], { stdio: ['ignore', 'ignore', 'inherit'] });
for (const v of views) console.info(v.out);
