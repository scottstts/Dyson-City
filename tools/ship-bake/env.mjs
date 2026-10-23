#!/usr/bin/env node
/**
 * The outside light at the ship for the cabin's bake (docs/intro-ship.md, "Light";
 * blender/ship/bake.py), in the ship's frame.
 *
 *   node tools/ship-bake/env.mjs --dist <vite build> [--size 512]
 *
 * Boots the intro headless on the HDR view (linear scene radiance) and, for each lit scene, holds
 * the film at one moment, puts the camera at the pilot's eye with the ship out of the picture
 * (`Intro.setCapture`) and renders six 90° cube faces in the ship's frame at several exposures:
 *
 *  - space: scene 1 (the ship barely moves against the sphere);
 *  - band: scene 2, settled on the ground (scenes 2 and 3 are baked in the landed light).
 *
 * The brackets are merged into the game's radiance and resampled to equirectangular Radiance .hdr
 * in Blender's ship frame (x forward, −z, y up): blender/bake/ship/env_<scene>.hdr (+ .json).
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { DIST_ORIGIN, serveDist, serveAssetHost } from '../serveDist.mjs';
import { CHROME, CHROME_ARGS, decodePng, mergeBrackets, sampleFace, writeRgbe } from '../hdr.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dist = opt('dist', '');
if (!dist) throw new Error('--dist <vite build> is required');
const size = Number(opt('size', '512'));
const OUT = path.resolve('blender/bake/ship');
const scene = JSON.parse(fs.readFileSync(path.join(OUT, 'scene.json'), 'utf8'));
const EYE = scene.captures.find((c) => c.name === 'cockpit').position;
// 2^-EV is each bracket's clip level (4096 down to 1/256): scene 1's sky is nearly black, the star 10.
const EVS = [-12, -8, -4, 0, 4, 8];
const SETTLE = 16;

// Cube faces in the ship frame: forward and up; the camera looks down −z with +y up.
const FACES = [
  { name: '+x', f: [1, 0, 0], u: [0, 1, 0] },
  { name: '-x', f: [-1, 0, 0], u: [0, 1, 0] },
  { name: '+z', f: [0, 0, 1], u: [0, 1, 0] },
  { name: '-z', f: [0, 0, -1], u: [0, 1, 0] },
  { name: '+y', f: [0, 1, 0], u: [-1, 0, 0] },
  { name: '-y', f: [0, -1, 0], u: [1, 0, 0] },
];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
for (const fc of FACES) fc.r = cross(fc.f, fc.u);
/** Column-major camera matrix: columns right, up, −forward, position. */
const matrixOf = (fc) => [...fc.r, 0, ...fc.u, 0, ...fc.f.map((x) => -x), 0, ...EYE, 1];

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: CHROME_ARGS });
const captured = {};
try {
  const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await serveDist(context, dist);
  await serveAssetHost(context);
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`${DIST_ORIGIN}/?intro=1:hold&manual&view=hdr&ev=0&fov=90&noao`);
  const ok = await page
    .waitForFunction(() => window.__dyson?.ready === true || document.querySelector('.entry.is-error') !== null, null, { timeout: 600_000 })
    .then(() => page.evaluate(() => window.__dyson?.ready === true));
  if (!ok) throw new Error(`boot failed\n${logs.slice(-30).join('\n')}`);
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  const tl = await page.evaluate(() => window.__dyson.game.introTimeline());
  const moments = {
    space: (tl.scene1.wake + tl.scene1.monitor) / 2,
    band: tl.scene2.touchdown + 3,
  };
  for (const [name, t] of Object.entries(moments)) {
    const faces = [];
    for (const fc of FACES) {
      const brackets = [];
      for (const ev of EVS) {
        await page.evaluate(
          ({ t, m, ev, n }) => {
            const g = window.__dyson.game;
            g.introSeek(t, true);
            g.introCapture(m);
            g.pipeline.camera.exposure.value = Math.pow(2, ev);
            for (let i = 0; i < n; i++) g.renderFrame();
          },
          { t, m: matrixOf(fc), ev, n: SETTLE },
        );
        brackets.push({ ev, img: decodePng(await page.screenshot()) });
      }
      faces.push({ ...fc, ...mergeBrackets(brackets) });
    }
    captured[name] = { t, faces };
    console.log(`${name} (t = ${t.toFixed(2)} s): captured`);
  }
  await context.close();
} finally {
  await browser.close();
}

// Resampled to Cycles' equirect in Blender's ship frame: Blender (x, y, z) is the ship's (x, −z, y).
const W = 1024;
const H = 512;
for (const [name, { t, faces }] of Object.entries(captured)) {
  const eq = new Float32Array(W * H * 3);
  let eUp = 0;
  let eFwd = 0;
  for (let row = 0; row < H; row++) {
    // Cycles' equirect: v = atan2(z, hypot(x, y)) / π + 0.5 (v = 1 at the top row of the file).
    const el = (0.5 - (row + 0.5) / H) * Math.PI;
    for (let col = 0; col < W; col++) {
      const az = -((col + 0.5) / W - 0.5) * 2 * Math.PI; // u = −atan2(y, x) / 2π + 0.5
      const b = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
      const d = [b[0], b[2], -b[1]];
      let best = null;
      let bd = -1;
      for (const fc of faces) {
        const k = dot(d, fc.f);
        if (k > bd) {
          bd = k;
          best = fc;
        }
      }
      const L = sampleFace(best, dot(d, best.r) / bd, dot(d, best.u) / bd);
      eq.set(L, (row * W + col) * 3);
      const lum = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
      const dOmega = Math.cos(el) * (Math.PI / H) * ((2 * Math.PI) / W);
      if (d[1] > 0) eUp += lum * d[1] * dOmega;
      if (d[0] > 0) eFwd += lum * d[0] * dOmega;
    }
  }
  const file = path.join(OUT, `env_${name}.hdr`);
  writeRgbe(file, eq, W, H, `Dyson City: the outside light at the ship (${name})`);
  const side = { scene: name, t, eye: EYE, frame: 'Blender ship frame: (x, -z, y) of the ship frame', units: 'game radiance', irradianceUp: eUp, irradianceForward: eFwd };
  fs.writeFileSync(file.replace(/\.hdr$/, '.json'), JSON.stringify(side, null, 2));
  console.log(`${file}: irradiance up ${eUp.toFixed(3)}, forward ${eFwd.toFixed(3)}`);
}
