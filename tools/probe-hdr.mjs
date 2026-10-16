#!/usr/bin/env node
/**
 * Scene radiance probe for calibration (not part of the game build). Renders a spot with the HDR
 * debug view at a known exposure, decodes the screenshot and prints linear scene radiance
 * (Rec.709 luminance and RGB) averaged over small boxes.
 *
 *   node tools/probe-hdr.mjs <spot> "<extra query>" x,y [x,y ...]   (x, y in 0..1 screen UV)
 */
import { chromium } from 'playwright-core';
import { serveHousePack } from './serveDist.mjs';
import zlib from 'node:zlib';

const EV = -5; // linear scale 2^EV; radiance up to 32 before the view clamps
const [spot, query, ...pts] = process.argv.slice(2);

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
      bpp = data[9] === 6 ? 4 : 3; // colour type: RGBA or RGB, 8-bit
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
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
      out[y * stride + x] = r & 255;
    }
  }
  return { w, h, bpp, px: out };
}

const toLinear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--enable-dawn-features=allow_unsafe_apis'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await serveHousePack(page.context());
  await page.goto(`http://localhost:5174/?autostart&spot=${spot}&view=hdr&ev=${EV}${query ? `&${query}` : ''}`);
  await page.waitForFunction(() => window.__dyson?.ready === true, null, { timeout: 120_000 });
  await page.evaluate(() => new Promise((r) => { let k = 0; const s = () => (++k >= 40 ? r() : requestAnimationFrame(s)); requestAnimationFrame(s); }));
  const img = decodePng(await page.screenshot());
  for (const pt of pts) {
    const [u, v] = pt.split(',').map(Number);
    const cx = Math.round(u * img.w);
    const cy = Math.round(v * img.h);
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 6; x <= cx + 6; x++) {
      const o = (y * img.w + x) * img.bpp;
      for (let c = 0; c < 3; c++) sum[c] += toLinear(img.px[o + c]) / Math.pow(2, EV);
      n++;
    }
    const rgb = sum.map((s) => s / n);
    const L = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    console.log(`${pt}: L=${L.toFixed(3)} rgb=${rgb.map((c) => c.toFixed(3)).join(',')}`);
  }
} finally {
  await browser.close();
}
