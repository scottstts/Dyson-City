#!/usr/bin/env node
/**
 * The game's light at the house, as an HDR environment for Blender's bake (city_plan.md §9 step 1;
 * not part of the game build).
 *
 *   node tools/house-env.mjs [--dist <vite build dir> | --url http://localhost:5174]
 *                            [--site -372,-112] [--height 6] [--face 0.9576,0.2883] [--size 512]
 *                            [--out blender/bake/house_env.hdr]
 *
 * Boots the game headless on the HDR debug view (linear scene radiance, `?view=hdr`), stands a 90°
 * camera at the house site `height` metres above the ground there, and renders the six cube faces at
 * several exposures. The brackets are merged into linear radiance (the game's one radiance scale,
 * docs/world.md) and resampled to an equirectangular Radiance .hdr in the house's Blender frame:
 * +Z up, the front (porch) facing −Y along `--face` (the game-plane direction the house faces), so
 * Blender uses it with no rotation. A JSON sidecar records the capture and the irradiance it implies.
 *
 * The house itself is hidden for the capture (it is in the bake's own scene, which occludes and
 * bounces for itself), and the eye is held outdoors (no indoor culling, the star seen): the capture is
 * the estate and everything round it, from 6 m over the terrace at the house's origin.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { DIST_ORIGIN, serveDist, serveAssetHost } from './serveDist.mjs';
import { CHROME, CHROME_ARGS, decodePng, mergeBrackets, sampleFace, writeRgbe } from './hdr.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dist = opt('dist', '');
const base = dist ? DIST_ORIGIN : opt('url', 'http://localhost:5174');
const [siteX, siteZ] = opt('site', '-372,-112').split(',').map(Number);
const height = Number(opt('height', '6'));
const face = (() => {
  const v = opt('face', '');
  const f = v ? v.split(',').map(Number) : [-siteX, -siteZ]; // default: facing the datum
  const l = Math.hypot(f[0], f[1]);
  return [f[0] / l, f[1] / l];
})();
const size = Number(opt('size', '512'));
const out = opt('out', 'blender/bake/house_env.hdr');
const EVS = [-12, -8, -4, 0, 4]; // brackets: 2^-EV is each one's clip level (4096 down to 1/16)
const SETTLE = 12;

// ---------------------------------------------------------------- cube faces (three.js, Euler YXZ)
const D = Math.PI / 180;
const FACES = [
  { name: 'north', yaw: 0, pitch: 0 },
  { name: 'east', yaw: -90 * D, pitch: 0 },
  { name: 'south', yaw: 180 * D, pitch: 0 },
  { name: 'west', yaw: 90 * D, pitch: 0 },
  { name: 'up', yaw: 0, pitch: 90 * D },
  { name: 'down', yaw: 0, pitch: -90 * D },
];
function basis(yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // R = Ry(yaw) Rx(pitch) applied to camera axes
  const R = (v) => {
    const x1 = v[0];
    const y1 = cp * v[1] - sp * v[2];
    const z1 = sp * v[1] + cp * v[2];
    return [cy * x1 + sy * z1, y1, -sy * x1 + cy * z1];
  };
  return { fwd: R([0, 0, -1]), right: R([1, 0, 0]), up: R([0, 1, 0]) };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---------------------------------------------------------------- capture
fs.mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: CHROME_ARGS });
const faces = [];
let meta;
try {
  const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  if (dist) await serveDist(context, dist);
  await serveAssetHost(context);
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}/?autostart&manual&view=hdr&ev=0&fov=90&time=0&noao&spot=gate`);
  const ok = await page
    .waitForFunction(() => window.__dyson?.ready === true || document.querySelector('.entry.is-error') !== null, null, { timeout: 600_000 })
    .then(() => page.evaluate(() => window.__dyson?.ready === true));
  if (!ok) throw new Error(`boot failed\n${logs.slice(-30).join('\n')}`);
  // only the canvas: the entry screen and any HUD are DOM overlays a screenshot would include
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  meta = await page.evaluate(
    ({ x, z, h }) => {
      const g = window.__dyson.game;
      const house = window.__dyson.world.house;
      house.root.visible = false;
      house.inside = () => false;
      g.setSpot({ position: [x, z], yaw: 0, pitch: 0 });
      // the terrace at the house's origin (grade), not the house's floor the walker stands on
      const ground = house.root.position.y;
      g.camera.position.set(x, ground + h, z);
      g.camera.rotation.order = 'YXZ';
      return { ground, eye: ground + h };
    },
    { x: siteX, z: siteZ, h: height },
  );
  for (const f of FACES) {
    const brackets = [];
    for (const ev of EVS) {
      await page.evaluate(
        ({ yaw, pitch, ev, n }) => {
          const g = window.__dyson.game;
          g.camera.rotation.set(pitch, yaw, 0);
          g.camera.updateMatrixWorld();
          g.pipeline.camera.exposure.value = Math.pow(2, ev);
          for (let i = 0; i < n; i++) g.renderFrame();
        },
        { yaw: f.yaw, pitch: f.pitch, ev, n: SETTLE },
      );
      brackets.push({ ev, img: decodePng(await page.screenshot()) });
    }
    const { w, h, rad } = mergeBrackets(brackets);
    faces.push({ ...f, ...basis(f.yaw, f.pitch), w, h, rad });
    console.log(`face ${f.name}: done`);
  }
  await context.close();
} finally {
  await browser.close();
}

// ---------------------------------------------------------------- resample to the house frame
// Blender house frame in game coordinates: Y_b = −front, Z_b = up, X_b = Y_b × Z_b
const [fx, fz] = face;
const Xb = [fz, 0, -fx];
const Yb = [-fx, 0, -fz];
const Zb = [0, 1, 0];
const W = 1024;
const H = 512;
const eq = new Float32Array(W * H * 3);
let eUp = 0;
for (let row = 0; row < H; row++) {
  // Cycles' equirect: v = atan2(z, hypot(x, y)) / π + 0.5 (v = 1 at the top row of the file)
  const v = 1 - (row + 0.5) / H;
  const el = (v - 0.5) * Math.PI;
  for (let col = 0; col < W; col++) {
    const u = (col + 0.5) / W;
    const az = -(u - 0.5) * 2 * Math.PI; // u = −atan2(y, x) / 2π + 0.5
    const db = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    const dg = [0, 1, 2].map((k) => db[0] * Xb[k] + db[1] * Yb[k] + db[2] * Zb[k]);
    let best = null;
    let bd = -1;
    for (const fc of faces) {
      const d = dot(dg, fc.fwd);
      if (d > bd) {
        bd = d;
        best = fc;
      }
    }
    const L = sampleFace(best, dot(dg, best.right) / bd, dot(dg, best.up) / bd);
    eq.set(L, (row * W + col) * 3);
    if (el > 0) {
      const lum = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
      eUp += lum * Math.sin(el) * Math.cos(el) * (Math.PI / H) * ((2 * Math.PI) / W);
    }
  }
}

writeRgbe(out, eq, W, H, 'Dyson City: game light at the house site');
const side = {
  site: [siteX, siteZ],
  ground: meta.ground,
  eye: meta.eye,
  height,
  face,
  frame: 'Blender house frame: +Z up, front facing -Y (game direction `face`), +X = (face.z, -face.x)',
  units: 'game radiance (docs/world.md: STAR_LUMINANCE = 10)',
  irradianceUp: eUp,
  whiteRadianceUp: eUp / Math.PI,
};
fs.writeFileSync(out.replace(/\.hdr$/, '.json'), JSON.stringify(side, null, 2));
console.log(`${out}: ${W}x${H}, up-facing irradiance ${eUp.toFixed(3)} (white surface radiance ${(eUp / Math.PI).toFixed(3)})`);
