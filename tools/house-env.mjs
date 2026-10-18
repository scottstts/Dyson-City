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
import zlib from 'node:zlib';
import { DIST_ORIGIN, serveDist, serveHousePack } from './serveDist.mjs';

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

// ---------------------------------------------------------------- PNG (8-bit RGB/RGBA) decode
function decodePng(buf) {
  let p = 8;
  let w = 0;
  let h = 0;
  let bpp = 4;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bpp = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      const v = raw[y * (stride + 1) + 1 + x];
      let r;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + x] = r & 255;
    }
  }
  return { w, h, bpp, px };
}

const LIN = new Float64Array(256).map((_, i) => {
  const s = i / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
});

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
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--enable-dawn-features=allow_unsafe_apis'],
});
const faces = [];
let meta;
try {
  const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  if (dist) await serveDist(context, dist);
  await serveHousePack(context);
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
    // merge: per pixel, the brightest exposure that did not clip, divided back by its exposure
    const { w, h, bpp } = brackets[0].img;
    const rad = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      let picked = brackets[0];
      for (const b of brackets) {
        const q = i * bpp;
        if (Math.max(b.img.px[q], b.img.px[q + 1], b.img.px[q + 2]) < 245) picked = b;
      }
      const k = Math.pow(2, -picked.ev);
      for (let c = 0; c < 3; c++) rad[i * 3 + c] = LIN[picked.img.px[i * bpp + c]] * k;
    }
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
function sampleFace(fc, u, v) {
  const x = ((u + 1) / 2) * fc.w - 0.5;
  const y = ((1 - v) / 2) * fc.h - 0.5;
  const x0 = Math.max(0, Math.min(fc.w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(fc.h - 1, Math.floor(y)));
  const x1 = Math.min(fc.w - 1, x0 + 1);
  const y1 = Math.min(fc.h - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, x - x0));
  const ty = Math.max(0, Math.min(1, y - y0));
  const o = [0, 0, 0];
  for (const [xx, yy, wgt] of [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]]) {
    const i = (yy * fc.w + xx) * 3;
    for (let c = 0; c < 3; c++) o[c] += fc.rad[i + c] * wgt;
  }
  return o;
}
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

// ---------------------------------------------------------------- Radiance RGBE (flat, no RLE)
const header = Buffer.from(`#?RADIANCE\n# Dyson City: game light at the house site\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`, 'ascii');
const body = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const r = eq[i * 3];
  const g = eq[i * 3 + 1];
  const b = eq[i * 3 + 2];
  const m = Math.max(r, g, b);
  if (m < 1e-32) continue;
  const e = Math.ceil(Math.log2(m) + 1e-9);
  const s = 256 / Math.pow(2, e);
  body[i * 4] = Math.min(255, Math.floor(r * s));
  body[i * 4 + 1] = Math.min(255, Math.floor(g * s));
  body[i * 4 + 2] = Math.min(255, Math.floor(b * s));
  body[i * 4 + 3] = e + 128;
}
fs.writeFileSync(out, Buffer.concat([header, body]));
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
