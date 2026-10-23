/**
 * HDR captures from the game's linear radiance view (`?view=hdr`) for the bakes: PNG decoding,
 * merging exposure brackets into radiance, and Radiance RGBE output (tools/house-env.mjs,
 * tools/ship-bake/env.mjs).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

/** PNG (8-bit RGB/RGBA) decode. */
export function decodePng(buf) {
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

/** sRGB 8-bit → linear. */
export const LIN = new Float64Array(256).map((_, i) => {
  const s = i / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
});

/**
 * Brackets ({ ev, img } with img from decodePng, exposure 2^ev) merged into linear radiance: per
 * pixel, the brightest exposure that did not clip, divided back by its exposure.
 */
export function mergeBrackets(brackets) {
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
  return { w, h, rad };
}

/** Bilinear lookup in a merged face at (u, v) ∈ [−1, 1]² (v up). */
export function sampleFace(fc, u, v) {
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

/** Radiance RGBE (flat, no RLE) of a W × H linear RGB image, rows top first. */
export function writeRgbe(file, eq, W, H, note) {
  const header = Buffer.from(`#?RADIANCE\n# ${note}\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`, 'ascii');
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
  fs.writeFileSync(file, Buffer.concat([header, body]));
}

/** Headless Chrome with WebGPU, as every capture tool launches it. */
export const CHROME_ARGS = ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--enable-dawn-features=allow_unsafe_apis'];
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
