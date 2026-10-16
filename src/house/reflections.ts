/**
 * The rooms' reflection captures (blender/docs/house.md §6): 512 × 256 equirectangular radiance
 * from each room's middle at 1.6 m, as Cycles maps it (u = −atan2(y, x)/2π + 0.5, v = elevation/π
 * + 0.5, rows top first, Blender's house frame). Prefiltered here into a roughness chain (GGX,
 * filtered importance sampling) and packed into one atlas layer per room:
 *
 *   level 0 (mirror) 512 × 256 at (0, 0); level k ≥ 1 (roughness k/5) at the row below,
 *   (512 >> k) × (256 >> k), left to right.
 *
 * Stored as RGB9E5 (filterable, 4 bytes a texel). Pure: runs in the part worker.
 */

export const REFL = { width: 512, height: 256, levels: 6, atlasW: 512, atlasH: 384 } as const;

/** Atlas rectangle of a level: x, y, w, h (texels). */
export function levelRect(k: number): [number, number, number, number] {
  if (k === 0) return [0, 0, REFL.width, REFL.height];
  let x = 0;
  for (let i = 1; i < k; i++) x += REFL.width >> i;
  return [x, REFL.height, REFL.width >> k, REFL.height >> k];
}

/** Roughness each level stands for. */
export const levelRoughness = (k: number): number => k / (REFL.levels - 1);

export function decodeRGB9E5(v: number, out: Float32Array, o: number): void {
  const e = (v >>> 27) - 24;
  const s = 2 ** e;
  out[o] = (v & 511) * s;
  out[o + 1] = ((v >>> 9) & 511) * s;
  out[o + 2] = ((v >>> 18) & 511) * s;
}

export function encodeRGB9E5(r: number, g: number, b: number): number {
  const maxV = 65408;
  r = Math.min(Math.max(r, 0), maxV);
  g = Math.min(Math.max(g, 0), maxV);
  b = Math.min(Math.max(b, 0), maxV);
  const m = Math.max(r, g, b);
  if (m <= 0) return 0;
  let e = Math.max(-16, Math.floor(Math.log2(m))) + 1 + 15;
  let denom = 2 ** (e - 15 - 9);
  if (Math.floor(m / denom + 0.5) === 512) {
    denom *= 2;
    e += 1;
  }
  const rm = Math.floor(r / denom + 0.5);
  const gm = Math.floor(g / denom + 0.5);
  const bm = Math.floor(b / denom + 0.5);
  return (rm | (gm << 9) | (bm << 18) | (e << 27)) >>> 0;
}

interface Image {
  w: number;
  h: number;
  /** RGB float, rows top first. */
  px: Float32Array;
}

function downsample(src: Image): Image {
  const w = src.w >> 1;
  const h = src.h >> 1;
  const px = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      for (let c = 0; c < 3; c++) {
        const a = src.px[((2 * j) * src.w + 2 * i) * 3 + c];
        const b = src.px[((2 * j) * src.w + 2 * i + 1) * 3 + c];
        const d = src.px[((2 * j + 1) * src.w + 2 * i) * 3 + c];
        const e = src.px[((2 * j + 1) * src.w + 2 * i + 1) * 3 + c];
        px[(j * w + i) * 3 + c] = (a + b + d + e) / 4;
      }
    }
  }
  return { w, h, px };
}

/** Bilinear lookup of an equirect image toward a unit direction (Blender frame). */
function sampleDir(img: Image, x: number, y: number, z: number, out: Float32Array): void {
  const u = -Math.atan2(y, x) / (2 * Math.PI) + 0.5;
  const v = Math.asin(Math.max(-1, Math.min(1, z))) / Math.PI + 0.5;
  const fx = u * img.w - 0.5;
  const fy = (1 - v) * img.h - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  out[0] = out[1] = out[2] = 0;
  for (let k = 0; k < 4; k++) {
    const xi = (((x0 + (k & 1)) % img.w) + img.w) % img.w;
    const yi = Math.min(Math.max(y0 + (k >> 1), 0), img.h - 1);
    const w = (k & 1 ? tx : 1 - tx) * (k >> 1 ? ty : 1 - ty);
    const o = (yi * img.w + xi) * 3;
    out[0] += img.px[o] * w;
    out[1] += img.px[o + 1] * w;
    out[2] += img.px[o + 2] * w;
  }
}

function radicalInverse(i: number): number {
  let b = i >>> 0;
  b = ((b << 16) | (b >>> 16)) >>> 0;
  b = (((b & 0x55555555) << 1) | ((b & 0xaaaaaaaa) >>> 1)) >>> 0;
  b = (((b & 0x33333333) << 2) | ((b & 0xcccccccc) >>> 2)) >>> 0;
  b = (((b & 0x0f0f0f0f) << 4) | ((b & 0xf0f0f0f0) >>> 4)) >>> 0;
  b = (((b & 0x00ff00ff) << 8) | ((b & 0xff00ff00) >>> 8)) >>> 0;
  return b / 4294967296;
}

const SAMPLES = 32;

/** Prefilters one capture into its atlas layer (Uint32 RGB9E5, atlasW × atlasH). */
export function prefilterCapture(rgb9e5: Uint32Array, out: Uint32Array): void {
  const { width: W, height: H, atlasW } = REFL;
  const base: Image = { w: W, h: H, px: new Float32Array(W * H * 3) };
  for (let i = 0; i < W * H; i++) decodeRGB9E5(rgb9e5[i], base.px, i * 3);
  // Box chain to sample from (filtered importance sampling picks the level a sample's solid angle needs).
  const chain: Image[] = [base];
  while (chain[chain.length - 1].w > 8) chain.push(downsample(chain[chain.length - 1]));
  // Level 0: the capture itself.
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) out[j * atlasW + i] = rgb9e5[j * W + i];
  const texelSolid = (4 * Math.PI) / (W * H);
  const c = new Float32Array(3);
  for (let k = 1; k < REFL.levels; k++) {
    const [ox, oy, lw, lh] = levelRect(k);
    const a = Math.max(levelRoughness(k), 0.05) ** 2;
    for (let j = 0; j < lh; j++) {
      const el = (0.5 - (j + 0.5) / lh) * Math.PI;
      for (let i = 0; i < lw; i++) {
        const az = -((i + 0.5) / lw - 0.5) * 2 * Math.PI;
        // N = V = R: the texel's direction.
        const nx = Math.cos(el) * Math.cos(az);
        const ny = Math.cos(el) * Math.sin(az);
        const nz = Math.sin(el);
        // Tangent frame: t = normalize(up × n), up = +Z (or +X at the poles).
        const upx = Math.abs(nz) < 0.999 ? 0 : 1;
        const upz = 1 - upx;
        let tx = -upz * ny;
        let ty = upz * nx - upx * nz;
        let tz = upx * ny;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        const bx = ny * tz - nz * ty;
        const by = nz * tx - nx * tz;
        const bz = nx * ty - ny * tx;
        let r = 0, g = 0, b = 0, wsum = 0;
        for (let s = 0; s < SAMPLES; s++) {
          const u1 = (s + 0.5) / SAMPLES;
          const u2 = radicalInverse(s);
          const cosT = Math.sqrt((1 - u1) / (1 + (a * a - 1) * u1));
          const sinT = Math.sqrt(1 - cosT * cosT);
          const phi = 2 * Math.PI * u2;
          const hxl = sinT * Math.cos(phi), hyl = sinT * Math.sin(phi), hzl = cosT;
          const hx = tx * hxl + bx * hyl + nx * hzl;
          const hy = ty * hxl + by * hyl + ny * hzl;
          const hz = tz * hxl + bz * hyl + nz * hzl;
          const vh = hx * nx + hy * ny + hz * nz;
          const lx = 2 * vh * hx - nx;
          const ly = 2 * vh * hy - ny;
          const lz = 2 * vh * hz - nz;
          const nl = lx * nx + ly * ny + lz * nz;
          if (nl <= 0) continue;
          // pdf of L (N = V): D(h)·cosθh / (4 v·h) = D/4.
          const d2 = (cosT * cosT) * (a * a - 1) + 1;
          const D = (a * a) / (Math.PI * d2 * d2);
          const pdf = D / 4;
          const solid = 1 / (SAMPLES * pdf);
          // Equirect texels shrink toward the poles by cos(elevation).
          const texel = texelSolid * Math.max(Math.sqrt(1 - lz * lz), 0.05);
          const mip = Math.min(Math.max(0.5 * Math.log2(solid / texel) + 1, 0), chain.length - 1);
          const m0 = Math.floor(mip);
          const m1 = Math.min(m0 + 1, chain.length - 1);
          const f = mip - m0;
          sampleDir(chain[m0], lx, ly, lz, c);
          let cr = c[0] * (1 - f), cg = c[1] * (1 - f), cb = c[2] * (1 - f);
          if (f > 0) {
            sampleDir(chain[m1], lx, ly, lz, c);
            cr += c[0] * f;
            cg += c[1] * f;
            cb += c[2] * f;
          }
          r += cr * nl;
          g += cg * nl;
          b += cb * nl;
          wsum += nl;
        }
        out[(oy + j) * atlasW + ox + i] = encodeRGB9E5(r / wsum, g / wsum, b / wsum);
      }
    }
  }
}
