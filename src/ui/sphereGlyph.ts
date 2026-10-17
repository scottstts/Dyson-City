/**
 * The loading glyph: the logo's sphere as a ray-traced illustration (tools/sphere-art.mjs,
 * public/glyph/), with its coolant lines drawn live over it from the same model
 * (sphereFrame.ts) and lit member by member as boot advances. Nothing else measures progress.
 *
 * Layers, back to front: a bloom; the cavity (the shell's inner disc, black, so the star's layer
 * dims over it rather than over the key art); what the openings show (the star and the far shell's
 * lit inner face); the outside of the frame; the light the star spills onto it, added; the coolant
 * lines. Every image is transparent past the sphere, and the glyph is its own compositing group. The star's layers rise with the lit fraction (--heat). The bloom's
 * breathing is a transform animation, so it keeps moving while boot blocks the main thread;
 * nothing here runs per-frame JS.
 */
import { HALF, UNIT, members, type V3 } from './sphereFrame';

const SVG = 'http://www.w3.org/2000/svg';
const ART = `${import.meta.env.BASE_URL}glyph/`;

const fmt = (p: V3) => `${(UNIT * p[0]).toFixed(2)} ${(-UNIT * p[1]).toFixed(2)}`;
const lerp3 = (a: V3, b: V3, f: number): V3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

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

function layer(name: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = `glyph-${name}`;
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
    const images = [layer('back'), layer('front'), layer('glow')];
    // The illustration appears whole, never layer by layer.
    void Promise.all(images.map((i) => i.decode()))
      .then(() => this.root.classList.add('is-drawn'))
      .catch(() => this.root.classList.add('is-drawn'));

    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `${-HALF} ${-HALF} ${2 * HALF} ${2 * HALF}`);
    svg.setAttribute('class', 'glyph-coolant');
    svg.setAttribute('aria-hidden', 'true');
    for (const m of members()) {
      // One path per member; its runs' widths differ little, so each takes the widest.
      const d = m.runs.flatMap((r) => nearRuns(r.points, r.closed).map((run) => `M${run.map(fmt).join('L')}`)).join('');
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke-width', String(Math.max(...m.runs.map((r) => r.width))));
      svg.appendChild(path);
      this.lines.push(path);
    }
    this.root.append(bloom, cavity, ...images, svg);
  }

  /** Lights the first `fraction` of the frame. */
  setLit(fraction: number): void {
    const n = Math.round(Math.min(1, Math.max(0, fraction)) * this.lines.length);
    if (n === this.lit) return;
    this.lit = n;
    this.lines.forEach((p, i) => p.classList.toggle('is-lit', i < n));
    this.root.style.setProperty('--heat', (n / this.lines.length).toFixed(3));
  }
}
