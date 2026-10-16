/**
 * The planting's leaf atlas (docs/estate.md "Planting"): sixteen sprig textures painted
 * procedurally on a canvas, 512 px each in a 4 × 4 atlas. A card using a tile reads as a spray of
 * a dozen leaves (or flowers); the alpha carries the silhouette for alpha-tested cards.
 *
 * Mip levels are built here with their alpha rescaled so each level covers as much as the full
 * resolution does at the alpha test's threshold: a distant canopy stays as dense as a near one
 * instead of thinning to nothing (the usual failure of mipmapped cut-out foliage).
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType, ClampToEdgeWrapping } from 'three/webgpu';

export const ATLAS = { tiles: 4, tile: 512 } as const;

export const LEAF = {
  beech: 0,
  oak: 1,
  lime: 2,
  apple: 3,
  cedar: 4,
  laurel: 5,
  hydrangeaLeaf: 6,
  hydrangeaFlower: 7,
  rose: 8,
  lavender: 9,
  delphinium: 10,
  foxglove: 11,
  daisy: 12,
  fern: 13,
  hosta: 14,
  cabbage: 15,
} as const;
export type LeafKind = keyof typeof LEAF;

/** UV rectangle of a tile (u0, v0, u1, v1), inset half a texel per mip so bleeding stays inside. */
export function tileUV(kind: LeafKind): [number, number, number, number] {
  const i = LEAF[kind];
  const n = ATLAS.tiles;
  const x = i % n;
  const y = Math.floor(i / n);
  const pad = 2 / (ATLAS.tile * n);
  return [x / n + pad, y / n + pad, (x + 1) / n - pad, (y + 1) / n - pad];
}

type Ctx = CanvasRenderingContext2D;

/** Deterministic random for painting. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a})`;
}

/** A simple leaf blade along −y from (0, 0), length l, width w; shape: 0 ovate, 1 lanceolate, 2 cordate. */
function leafPath(ctx: Ctx, l: number, w: number, shape: number, serrate = 0): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const steps = 18;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let width: number;
    if (shape === 1) width = Math.sin(Math.PI * Math.pow(t, 0.8)) * w * 0.5;
    else if (shape === 2) width = (Math.sin(Math.PI * Math.pow(t, 0.6)) * 0.9 + (t < 0.2 ? (0.2 - t) * 2.5 : 0)) * w * 0.5;
    else width = Math.sin(Math.PI * Math.pow(t, 0.7)) * w * 0.5;
    if (serrate > 0 && i % 2 === 1) width *= 1 + serrate;
    pts.push([width, -t * l]);
  }
  for (const [x, y] of pts) ctx.lineTo(x, y);
  for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(-pts[i][0], pts[i][1]);
  ctx.closePath();
}

function drawLeaf(ctx: Ctx, x: number, y: number, ang: number, l: number, w: number, shape: number, fill: string, vein: string, serrate = 0): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  leafPath(ctx, l, w, shape, serrate);
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, fill);
  g.addColorStop(0.5, fill);
  g.addColorStop(1, fill);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.strokeStyle = vein;
  ctx.lineWidth = Math.max(1, w * 0.04);
  ctx.beginPath();
  ctx.moveTo(0, -l * 0.02);
  ctx.lineTo(0, -l * 0.92);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.6, w * 0.02);
  for (let k = 1; k < 6; k++) {
    const t = k / 6;
    ctx.beginPath();
    ctx.moveTo(0, -l * t * 0.9);
    ctx.lineTo(w * 0.32, -l * (t * 0.9 + 0.08));
    ctx.moveTo(0, -l * t * 0.9);
    ctx.lineTo(-w * 0.32, -l * (t * 0.9 + 0.08));
    ctx.stroke();
  }
  ctx.restore();
}

function twig(ctx: Ctx, pts: [number, number][], width: number, colour: string): void {
  ctx.strokeStyle = colour;
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

/**
 * A dense spray: several twigs fanning up from the tile's foot, leaves alternating along each, at
 * true leaf size for a card ~0.6–0.8 m across (a tile is ~1.3 mm a pixel), filling ~60 % of the tile
 * so a crown of crossed cards reads as massed foliage, not scattered twigs.
 */
function sprig(ctx: Ctx, seed: number, o: { hue: number; sat: number; light: number; l: number; w: number; shape: number; serrate?: number; count: number; spread: number; twig?: string }): void {
  const r = rng(seed);
  const S = ATLAS.tile;
  const twigs = 5;
  const per = Math.max(4, Math.round((o.count * 3) / twigs));
  const back: (() => void)[] = [];
  const front: (() => void)[] = [];
  for (let k = 0; k < twigs; k++) {
    const a = -Math.PI / 2 + (k - (twigs - 1) / 2) * 0.36 + (r() - 0.5) * 0.15;
    const len = S * (0.7 + r() * 0.22);
    const x0 = S / 2 + (r() - 0.5) * 20;
    const y0 = S * 0.98;
    const bend = (r() - 0.5) * 0.4;
    const at = (t: number): [number, number] => [x0 + Math.cos(a + bend * t) * len * t, y0 + Math.sin(a + bend * t) * len * t];
    const pts: [number, number][] = [];
    for (let i = 0; i <= 8; i++) pts.push(at(i / 8));
    twig(ctx, pts, 4 - k * 0.3 > 2 ? 4 : 3, o.twig ?? '#4a3b2a');
    for (let i = 0; i < per; i++) {
      const t = 0.12 + (i / per) * 0.88;
      const [x, y] = at(t);
      const side = i % 2 === 0 ? 1 : -1;
      const ang = a + Math.PI / 2 + side * (o.spread + (r() - 0.5) * 0.45) + bend * t;
      const l = o.l * (0.7 + r() * 0.45) * (1 - t * 0.2);
      const light = o.light * (0.78 + r() * 0.44);
      const draw = () => drawLeaf(ctx, x, y, ang, l, o.w * (l / o.l), o.shape, hsl(o.hue + (r() - 0.5) * 9, o.sat * (0.9 + r() * 0.2), light), hsl(o.hue, o.sat * 0.6, Math.min(light * 1.35, 0.8), 0.45), o.serrate ?? 0);
      (r() < 0.45 ? back : front).push(draw);
    }
    const tip = at(1);
    front.push(() => drawLeaf(ctx, tip[0], tip[1], a + Math.PI / 2, o.l, o.w, o.shape, hsl(o.hue, o.sat, o.light * 1.05), hsl(o.hue, o.sat * 0.6, o.light * 1.4, 0.45), o.serrate ?? 0));
  }
  // The leaves behind are a shade darker (they lie under the others).
  ctx.save();
  ctx.filter = 'brightness(0.78)';
  for (const d of back) d();
  ctx.restore();
  for (const d of front) d();
}

function oakLeaf(ctx: Ctx, x: number, y: number, ang: number, l: number, fill: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  // Rounded lobes, four a side.
  const lobes = 4;
  for (let side = 1; side >= -1; side -= 2) {
    for (let k = 0; k <= lobes; k++) {
      const t = (side > 0 ? k : lobes - k) / lobes;
      const y0 = -t * l;
      const wide = Math.sin(Math.PI * Math.min(t * 1.05, 1)) * l * 0.28;
      const r = l * 0.08;
      ctx.quadraticCurveTo(side * (wide + r), y0 + r * side * 0.5, side * wide * 0.55, y0 - (side * l) / lobes / 2);
    }
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(220,230,170,0.35)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -l * 0.95);
  ctx.stroke();
  ctx.restore();
}

function blossomBall(ctx: Ctx, cx: number, cy: number, r: number, seed: number, colours: string[], petal: number): void {
  const rnd = rng(seed);
  for (let i = 0; i < r * r * 0.09; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * r;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.9;
    const shade = 1 - (d / r) * 0.35 - (y > cy ? 0.15 * ((y - cy) / r) : 0);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * Math.PI);
    ctx.fillStyle = colours[Math.floor(rnd() * colours.length)];
    ctx.globalAlpha = 1;
    for (let k = 0; k < 4; k++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(0, -petal * 0.55, petal * 0.42, petal * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(0,0,0,${(1 - shade) * 0.6})`;
    ctx.beginPath();
    ctx.arc(0, 0, petal * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function paintTile(ctx: Ctx, kind: LeafKind): void {
  const S = ATLAS.tile;
  const r = rng(LEAF[kind] * 977 + 13);
  switch (kind) {
    case 'beech':
      sprig(ctx, 11, { hue: 345, sat: 0.38, light: 0.21, l: 78, w: 50, shape: 0, count: 16, spread: 1.0, serrate: 0.02 });
      break;
    case 'lime':
      sprig(ctx, 12, { hue: 88, sat: 0.42, light: 0.3, l: 82, w: 74, shape: 2, count: 13, spread: 1.05, serrate: 0.03 });
      break;
    case 'apple': {
      sprig(ctx, 13, { hue: 95, sat: 0.38, light: 0.27, l: 70, w: 40, shape: 0, count: 16, spread: 0.85, serrate: 0.04 });
      // Two apples on this spray, red flushed over green, ~6 cm.
      for (const [x, y, red] of [[S * 0.42, S * 0.55, 0.9], [S * 0.6, S * 0.47, 0.55]]) {
        const g = ctx.createRadialGradient(x - 9, y - 9, 3, x, y, 28);
        g.addColorStop(0, hsl(15 + (1 - red) * 55, 0.6, 0.52));
        g.addColorStop(0.6, hsl(2 + (1 - red) * 65, 0.62, 0.32));
        g.addColorStop(1, hsl(0 + (1 - red) * 65, 0.55, 0.18));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, 25, 23, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'oak': {
      twig(ctx, [[S / 2, S * 0.97], [S / 2 + 10, S * 0.5], [S / 2 - 15, S * 0.15]], 6, '#4a3b2a');
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI / 2 + (k - 1.5) * 0.45;
        twig(ctx, [[S / 2, S * 0.97], [S / 2 + Math.cos(a) * S * 0.75, S * 0.97 + Math.sin(a) * S * 0.8]], 4, '#4a3b2a');
        for (let i = 0; i < 8; i++) {
          const t = 0.18 + (i / 8) * 0.8;
          const x = S / 2 + Math.cos(a) * S * 0.75 * t;
          const y = S * 0.97 + Math.sin(a) * S * 0.8 * t;
          oakLeaf(ctx, x, y, a + Math.PI / 2 + (i % 2 ? 1 : -1) * (0.9 + r() * 0.5), 115 * (1 - t * 0.25), hsl(85 + (r() - 0.5) * 10, 0.4, 0.22 + r() * 0.08));
        }
      }
      oakLeaf(ctx, S / 2 - 10, S * 0.2, 0.1, 160, hsl(85, 0.4, 0.27));
      break;
    }
    case 'cedar': {
      // A flat spray of needle tufts, blue-green, on a branchlet fanning outward.
      const stems: [number, number][][] = [];
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k - 2) * 0.42;
        stems.push([[S / 2, S * 0.95], [S / 2 + Math.cos(a) * S * 0.45, S * 0.95 + Math.sin(a) * S * 0.85]]);
      }
      for (const s of stems) twig(ctx, s, 4, '#3d3426');
      for (let i = 0; i < 260; i++) {
        const s = stems[Math.floor(r() * stems.length)];
        const t = 0.15 + r() * 0.85;
        const x = s[0][0] + (s[1][0] - s[0][0]) * t + (r() - 0.5) * 30;
        const y = s[0][1] + (s[1][1] - s[0][1]) * t + (r() - 0.5) * 30;
        ctx.strokeStyle = hsl(150 + r() * 20, 0.22, 0.2 + r() * 0.1);
        ctx.lineWidth = 2;
        for (let n = 0; n < 9; n++) {
          const a = r() * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16);
          ctx.stroke();
        }
      }
      break;
    }
    case 'laurel':
      sprig(ctx, 15, { hue: 105, sat: 0.45, light: 0.16, l: 150, w: 52, shape: 1, count: 9, spread: 0.7, twig: '#2e3a1e' });
      break;
    case 'hydrangeaLeaf':
      sprig(ctx, 16, { hue: 95, sat: 0.4, light: 0.24, l: 150, w: 95, shape: 0, count: 7, spread: 1.1, serrate: 0.05, twig: '#556b2f' });
      break;
    case 'hydrangeaFlower':
      blossomBall(ctx, S / 2, S / 2, S * 0.44, 17, ['#f4f1e6', '#ebe8da', '#f7f5ee', '#e2e6d2'], 15);
      break;
    case 'rose': {
      sprig(ctx, 18, { hue: 110, sat: 0.35, light: 0.2, l: 62, w: 40, shape: 0, count: 16, spread: 1.0, serrate: 0.08, twig: '#3a4a26' });
      for (const [x, y, s] of [[S * 0.4, S * 0.3, 52], [S * 0.62, S * 0.5, 44], [S * 0.35, S * 0.62, 38]]) {
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = hsl(345, 0.55, 0.62 - k * 0.07);
          ctx.beginPath();
          ctx.arc(x, y, s * (1 - k * 0.2), 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(120,20,50,0.35)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      break;
    }
    case 'lavender': {
      for (let i = 0; i < 70; i++) {
        const x = S / 2 + (r() - 0.5) * S * 0.8;
        const top = S * (0.1 + r() * 0.35);
        twig(ctx, [[S / 2 + (x - S / 2) * 0.3, S], [x, top]], 3, hsl(100, 0.15, 0.45));
        if (i % 2 === 0) {
          for (let k = 0; k < 9; k++) {
            ctx.fillStyle = hsl(265 + r() * 15, 0.42, 0.42 + r() * 0.15);
            ctx.beginPath();
            ctx.ellipse(x + (r() - 0.5) * 5, top + k * 7, 6, 5, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      break;
    }
    case 'delphinium': {
      for (let s = 0; s < 3; s++) {
        const x = S * (0.3 + s * 0.2);
        twig(ctx, [[x, S], [x + (r() - 0.5) * 20, S * 0.05]], 6, '#4f6b2e');
        // A border's mix, spire by spire: mid blue, mauve, pale sky; never a saturated block of violet.
        const [hue, sat, light] = ([[222, 0.42, 0.52], [262, 0.3, 0.56], [208, 0.36, 0.66]] as const)[s];
        for (let k = 0; k < 22; k++) {
          const y = S * 0.1 + k * 15;
          ctx.fillStyle = hsl(hue + (r() - 0.5) * 12, sat + r() * 0.08, light + r() * 0.1);
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(x + side * (10 + r() * 6), y, 9 + r() * 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      break;
    }
    case 'foxglove': {
      for (let s = 0; s < 3; s++) {
        const x = S * (0.28 + s * 0.22);
        twig(ctx, [[x, S], [x, S * 0.08]], 6, '#4f6b2e');
        for (let k = 0; k < 14; k++) {
          const y = S * 0.12 + k * 24;
          ctx.fillStyle = hsl(320 + r() * 10, 0.45, 0.6 - k * 0.012);
          ctx.beginPath();
          ctx.ellipse(x + 12, y, 10, 16, 0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(80,10,40,0.5)';
          ctx.beginPath();
          ctx.arc(x + 15, y + 8, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'daisy': {
      for (let i = 0; i < 26; i++) {
        const x = S * (0.1 + r() * 0.8);
        const y = S * (0.1 + r() * 0.55);
        twig(ctx, [[S / 2 + (x - S / 2) * 0.4, S], [x, y]], 3, '#55702f');
        ctx.fillStyle = '#f3f0e6';
        for (let k = 0; k < 14; k++) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate((k / 14) * Math.PI * 2);
          ctx.beginPath();
          ctx.ellipse(0, -14, 4, 12, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = '#d9a419';
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'fern': {
      for (let f = 0; f < 5; f++) {
        const a = -Math.PI / 2 + (f - 2) * 0.35;
        const len = S * (0.75 + r() * 0.2);
        const ex = S / 2 + Math.cos(a) * len * 0.6;
        const ey = S + Math.sin(a) * len;
        twig(ctx, [[S / 2, S], [ex, ey]], 3, '#4a6a28');
        for (let k = 1; k < 22; k++) {
          const t = k / 22;
          const x = S / 2 + (ex - S / 2) * t;
          const y = S + (ey - S) * t;
          const pl = (1 - t) * 50 + 8;
          for (const side of [-1, 1]) drawLeaf(ctx, x, y, a + Math.PI / 2 + side * 1.2, pl, pl * 0.35, 1, hsl(100, 0.45, 0.28 + r() * 0.06), 'rgba(0,0,0,0)');
        }
      }
      break;
    }
    case 'hosta':
      sprig(ctx, 21, { hue: 100, sat: 0.35, light: 0.3, l: 200, w: 140, shape: 2, count: 5, spread: 1.15, twig: '#5c7a3a' });
      break;
    case 'cabbage': {
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        drawLeaf(ctx, S / 2 + Math.cos(a) * 30, S / 2 + Math.sin(a) * 30, a + Math.PI / 2, 210, 190, 0, hsl(165, 0.2, 0.42 + r() * 0.08), 'rgba(230,240,230,0.5)');
      }
      ctx.fillStyle = hsl(150, 0.25, 0.55);
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, 70, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/**
 * Builds the atlas: painted on a canvas, then taken as raw RGBA with its own mip chain. Texels the
 * leaves do not cover carry their tile's mean leaf colour (a canvas would store them black, and
 * filtering would draw a dark fringe round every cut-out leaf); each level is downsampled with
 * alpha-weighted colour, and its alpha rescaled to keep the tile's coverage (see the module note).
 */
export function createLeafAtlas(): DataTexture {
  const n = ATLAS.tiles;
  const S = ATLAS.tile;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S * n;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  for (const kind of Object.keys(LEAF) as LeafKind[]) {
    const i = LEAF[kind];
    ctx.save();
    ctx.translate((i % n) * S, Math.floor(i / n) * S);
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.clip();
    paintTile(ctx, kind);
    ctx.restore();
  }
  const size = S * n;
  const level0: Uint8Array = new Uint8Array(ctx.getImageData(0, 0, size, size).data);
  const coverage = tileCoverage(level0, size, 0.5);
  fillMean(level0, size);
  const mipmaps: { data: Uint8Array; width: number; height: number }[] = [{ data: level0, width: size, height: size }];
  let prev: Uint8Array = level0;
  for (let w = size / 2; w >= 1; w /= 2) {
    const next = downsample(prev, w * 2);
    if (w / n >= 2) rescaleAlpha(next, w, coverage, 0.5);
    fillMean(next, w);
    mipmaps.push({ data: next, width: w, height: w });
    prev = next;
  }
  const tex = new DataTexture(level0, size, size, RGBAFormat, UnsignedByteType);
  tex.mipmaps = mipmaps as unknown as DataTexture['mipmaps'];
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.flipY = false;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Fraction of each tile's texels above the alpha threshold. */
function tileCoverage(px: Uint8Array, size: number, threshold: number): number[] {
  const n = ATLAS.tiles;
  const tile = size / n;
  const out = new Array(n * n).fill(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (px[(y * size + x) * 4 + 3] / 255 > threshold) out[Math.floor(y / tile) * n + Math.floor(x / tile)]++;
  return out.map((c) => c / (tile * tile));
}

/** Uncovered texels take their tile's mean covered colour. */
function fillMean(px: Uint8Array, size: number): void {
  const n = ATLAS.tiles;
  const tile = Math.max(1, size / n);
  const sum = new Float64Array(n * n * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const a = px[o + 3] / 255;
      const t = (Math.min(Math.floor(y / tile), n - 1) * n + Math.min(Math.floor(x / tile), n - 1)) * 4;
      sum[t] += px[o] * a;
      sum[t + 1] += px[o + 1] * a;
      sum[t + 2] += px[o + 2] * a;
      sum[t + 3] += a;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (px[o + 3] > 8) continue;
      const t = (Math.min(Math.floor(y / tile), n - 1) * n + Math.min(Math.floor(x / tile), n - 1)) * 4;
      const w = sum[t + 3] || 1;
      px[o] = sum[t] / w;
      px[o + 1] = sum[t + 1] / w;
      px[o + 2] = sum[t + 2] / w;
    }
  }
}

/** 2× box downsample with alpha-weighted colour. */
function downsample(src: Uint8Array, size: number): Uint8Array {
  const w = size / 2;
  const out = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const o = ((y * 2 + dy) * size + x * 2 + dx) * 4;
        const al = src[o + 3] / 255 + 1e-4;
        r += src[o] * al;
        g += src[o + 1] * al;
        b += src[o + 2] * al;
        a += al;
      }
      const o = (y * w + x) * 4;
      out[o] = r / a;
      out[o + 1] = g / a;
      out[o + 2] = b / a;
      out[o + 3] = Math.min(255, ((a - 4e-4) / 4) * 255);
    }
  }
  return out;
}

/** Scales each tile's alpha so its coverage at the threshold matches the full-resolution tile's. */
function rescaleAlpha(px: Uint8Array, size: number, target: number[], threshold: number): void {
  const n = ATLAS.tiles;
  const tile = size / n;
  for (let t = 0; t < n * n; t++) {
    const tx = (t % n) * tile;
    const ty = Math.floor(t / n) * tile;
    const alpha: number[] = [];
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) alpha.push(px[((ty + y) * size + tx + x) * 4 + 3] / 255);
    const cov = (k: number) => alpha.reduce((c, a) => c + (a * k > threshold ? 1 : 0), 0) / alpha.length;
    let lo = 1;
    let hi = 8;
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2;
      if (cov(mid) < target[t]) lo = mid;
      else hi = mid;
    }
    const k = (lo + hi) / 2;
    let i = 0;
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) px[((ty + y) * size + tx + x) * 4 + 3] = Math.min(255, alpha[i++] * k * 255);
  }
}
