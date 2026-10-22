/**
 * The loading glyph: the logo's sphere as a ray-traced illustration (tools/sphere-art.mjs,
 * public/glyph/), with its coolant lines drawn live over it from the same model
 * (sphereFrame.ts) and lit member by member as boot advances. Nothing else measures progress.
 *
 * Layers, back to front: a bloom; the cavity (the shell's inner disc, black, so the star's layer
 * dims over it rather than over the key art); what the openings show (the star and the far shell's
 * lit inner face); the outside of the fixed frame; the light the star spills onto it, added; the
 * belt (the band turning through the hub collars); the coolant lines. Every image is transparent
 * past what it holds, and the glyph is its own compositing group. The star's layers rise with the
 * lit fraction (--heat).
 *
 * The belt is a sprite sheet of the band's turn (sphereFrame BELT) seen through a window, stepped
 * by one compositor animation, so the band keeps turning while boot blocks the main thread (as
 * the bloom keeps breathing); nothing here runs per-frame JS. The coolant lines stay put: the
 * band's run along it, unchanged by its turn.
 */
import { BELT, HALF, UNIT, members, type V3 } from './sphereFrame';

const SVG = 'http://www.w3.org/2000/svg';
const ART = `${import.meta.env.BASE_URL}glyph/`;
/** How long the band takes over one period (60°), so a whole turn takes six times as long. */
const BELT_PERIOD_MS = 10_000;
/**
 * On-screen coolant line width (CSS px) per model unit of width. At the glyph's icon size the
 * model's widths would be a fraction of a pixel, so the lines keep a drawn width (style.css
 * non-scaling-stroke) and their relative weights.
 */
const COOLANT_PX = 1.2;

const fmt = (p: V3) => `${(UNIT * p[0]).toFixed(2)} ${(-UNIT * p[1]).toFixed(2)}`;
const lerp3 = (a: V3, b: V3, f: number): V3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const pct = (units: number) => `${((100 * units) / (2 * HALF)).toFixed(4)}%`;

/** The near-side runs of a polyline (z ≥ 0), cut exactly at the limb; the far side is behind the shell. */
function nearRuns(points: V3[], closed: boolean): V3[][] {
  const pts = closed ? [...points, points[0]] : points;
  const runs: V3[][] = [];
  let run: V3[] = pts[0][2] >= 0 ? [pts[0]] : [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a[2] >= 0 !== b[2] >= 0) {
      const cut = lerp3(a, b, a[2] / (a[2] - b[2]));
      if (a[2] >= 0) {
        run.push(cut);
        runs.push(run);
        run = [];
      } else run = [cut];
    }
    if (b[2] >= 0) run.push(b);
  }
  if (run.length > 1) runs.push(run);
  return runs.filter((r) => r.length > 1);
}

function layer(name: string, className = `glyph-${name}`): HTMLImageElement {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  img.src = `${ART}${name}.webp`;
  return img;
}

export class SphereGlyph {
  readonly root: HTMLDivElement;
  /** Each member's coolant path, in lighting order. */
  private readonly lines: SVGPathElement[] = [];
  private readonly spin: Animation | null;
  private lit = -1;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'glyph';
    const bloom = document.createElement('div');
    bloom.className = 'glyph-bloom';
    const cavity = document.createElement('div');
    cavity.className = 'glyph-cavity';
    // The gore shell's disc in the drawing's frame.
    cavity.style.inset = `${(50 * (1 - UNIT / HALF)).toFixed(4)}%`;

    // The belt's window: one cell of the sprite sheet, centred on the drawing.
    const beltWindow = document.createElement('div');
    beltWindow.className = 'glyph-belt';
    beltWindow.style.left = pct(HALF - BELT.pitch / 2);
    beltWindow.style.width = pct(BELT.pitch);
    beltWindow.style.top = pct(HALF + BELT.top);
    beltWindow.style.height = pct(BELT.bottom - BELT.top);
    const sheet = document.createElement('div');
    sheet.className = 'glyph-belt-sheet';
    sheet.style.width = `${BELT.cols * 100}%`;
    sheet.style.height = `${BELT.rows * 100}%`;
    const beltFront = layer('belt', 'glyph-belt-front');
    const beltGlow = layer('belt-glow', 'glyph-belt-glow');
    sheet.append(beltFront, beltGlow);
    beltWindow.appendChild(sheet);

    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `${-HALF} ${-HALF} ${2 * HALF} ${2 * HALF}`);
    svg.setAttribute('class', 'glyph-coolant');
    svg.setAttribute('aria-hidden', 'true');
    for (const m of members()) {
      // One path per member; its runs' widths differ little, so each takes the widest.
      const d = m.runs.flatMap((r) => nearRuns(r.points, r.closed).map((run) => `M${run.map(fmt).join('L')}`)).join('');
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke-width', (COOLANT_PX * Math.max(...m.runs.map((r) => r.width))).toFixed(2));
      svg.appendChild(path);
      this.lines.push(path);
    }

    const images = [layer('back'), layer('front'), layer('glow')];
    // The illustration appears whole, never layer by layer.
    void Promise.all([...images, beltFront, beltGlow].map((i) => i.decode()))
      .then(() => this.root.classList.add('is-drawn'))
      .catch(() => this.root.classList.add('is-drawn'));
    this.root.append(bloom, cavity, ...images, beltWindow, svg);

    // Frame k sits at column k % cols, row ⌊k / cols⌋; each holds for its share of the period.
    const steps: Keyframe[] = [];
    for (let k = 0; k <= BELT.frames; k++) {
      const f = k % BELT.frames;
      const x = (100 * (f % BELT.cols)) / BELT.cols;
      const y = (100 * Math.floor(f / BELT.cols)) / BELT.rows;
      steps.push({ offset: k / BELT.frames, transform: `translate(-${x}%, -${y}%)`, easing: 'steps(1, end)' });
    }
    this.spin = typeof sheet.animate === 'function' ? sheet.animate(steps, { duration: BELT_PERIOD_MS, iterations: Infinity }) : null;
  }

  /** Lights the first `fraction` of the frame. */
  setLit(fraction: number): void {
    const n = Math.round(Math.min(1, Math.max(0, fraction)) * this.lines.length);
    if (n === this.lit) return;
    this.lit = n;
    this.lines.forEach((p, i) => p.classList.toggle('is-lit', i < n));
    this.root.style.setProperty('--heat', (n / this.lines.length).toFixed(3));
  }

  /** Stops the band (it rests at its first frame). */
  stop(): void {
    this.spin?.cancel();
  }
}
