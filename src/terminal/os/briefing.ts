/**
 * Briefings (docs/terminal.md): the diagrams that play with a narrated status, line by line, as a
 * film's briefing does: what is said is drawn as it is said. Each recording's lines (cues.ts, from
 * the user's timestamped transcripts) have a beat; a beat is drawn at its progress p (0 → 1 over
 * its line) and crossfades from the last one as its line starts (screen.ts).
 *
 *  - Control (T3): the compound drawing itself on; the precincts ticking over; a section through
 *    the Veil under the star's flux, its load needle settling; the band turning against the still
 *    Gyre; the Cold Hold's tanks filling; a craft flying the corridor in; a scan finding nothing;
 *    the house; the kettle steaming; an empty requester field.
 *  - Observatory (T6): the Resonator's ring drawing on, live; the star quiet; its activity inside
 *    its normal band and an empty flare forecast; the spectrum rising as its scale goes from µHz to
 *    hertz.
 */
import { DOME } from '../../city/dome/spec';
import { CORDON, CORRIDOR, HALO, LANDING_PAD, PRECINCTS } from '../../field/layout';
import { starModes, STAR_MODES } from './content';
import { drawPlan, planMapping } from './plan';
import { FONT, INK } from './theme';

type C = CanvasRenderingContext2D;
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};
/** Progress through [a, b] of p, eased. */
const seg = (p: number, a: number, b: number) => ease((p - a) / (b - a));

function label(c: C, s: string, x: number, y: number, color: string = INK.dim, size = 17, align: CanvasTextAlign = 'left', spacing = 3): void {
  c.font = `600 ${size}px ${FONT.mono}`;
  c.letterSpacing = `${spacing}px`;
  c.fillStyle = color;
  c.textAlign = align;
  c.fillText(s, x, y);
  c.letterSpacing = '0px';
  c.textAlign = 'left';
}

function big(c: C, s: string, x: number, y: number, color: string = INK.ink, size = 30, align: CanvasTextAlign = 'left'): void {
  c.font = `500 ${size}px ${FONT.sans}`;
  c.fillStyle = color;
  c.textAlign = align;
  c.fillText(s, x, y);
  c.textAlign = 'left';
}

/** A stroke drawn on along its length: `len` its (rough) length, u the share drawn. */
function drawOn(c: C, len: number, u: number, path: () => void): void {
  c.setLineDash([Math.max(0.001, len * u), len * 2]);
  c.beginPath();
  path();
  c.stroke();
  c.setLineDash([]);
}

/** A status tag: a dot and a word, fading in. */
function tag(c: C, s: string, x: number, y: number, a: number, color: string = INK.ok): void {
  if (a <= 0) return;
  c.save();
  c.globalAlpha *= a;
  c.fillStyle = color;
  c.beginPath();
  c.arc(x + 8, y - 8, 7, 0, Math.PI * 2);
  c.fill();
  label(c, s, x + 26, y, color, 20, 'left', 4);
  c.restore();
}

// --- Control (T3) ------------------------------------------------------------------------------------

/** Draws Control's beat `i` (T3's line i) at progress p. */
export function statusBeat(c: C, i: number, p: number, t: number, b: Box): void {
  switch (i) {
    case 0:
      return compound(c, p, t, b);
    case 1:
      return precincts(c, p, t, b);
    case 2:
      return veil(c, p, t, b);
    case 3:
      return spin(c, p, t, b);
    case 4:
      return hold(c, p, t, b);
    case 5:
      return traffic(c, p, t, b);
    case 6:
      return faults(c, p, t, b);
    case 7:
      return house(c, p, b);
    case 8:
      return kettle(c, p, t, b);
    default:
      return requester(c, p, t, b);
  }
}

function square(b: Box): Box {
  const s = Math.min(b.w, b.h);
  return { x: b.x + (b.w - s) / 2, y: b.y + (b.h - s) / 2, w: s, h: s };
}

function compound(c: C, p: number, t: number, b: Box): void {
  const q = square(b);
  // The plan reveals from the datum outward.
  c.save();
  c.beginPath();
  c.arc(q.x + q.w / 2, q.y + q.h / 2, (q.w / 2) * ease(p * 1.4), 0, Math.PI * 2);
  c.clip();
  drawPlan(c, q.x, q.y, q.w, q.h, t, null);
  c.restore();
  // A scan ring at the reveal's edge.
  c.strokeStyle = INK.amberDim;
  c.lineWidth = 2;
  c.beginPath();
  c.arc(q.x + q.w / 2, q.y + q.h / 2, (q.w / 2) * ease(p * 1.4), 0, Math.PI * 2);
  c.stroke();
  label(c, 'COMPOUND', q.x, q.y + q.h + 34, INK.ink, 18);
}

function precincts(c: C, p: number, t: number, b: Box): void {
  const q = square(b);
  drawPlan(c, q.x, q.y, q.w, q.h, t, null);
  const P = planMapping(q.x, q.y, q.w, q.h);
  const n = PRECINCTS.length;
  const done = Math.floor(p * 1.25 * n);
  // The blocks end at the Cordon, as the plan's paving does.
  const [ox, oy] = P(0, 0);
  const [rx] = P(CORDON.r - CORDON.half, 0);
  c.save();
  c.beginPath();
  c.arc(ox, oy, rx - ox, 0, Math.PI * 2);
  c.clip();
  PRECINCTS.forEach((pr, k) => {
    if (k > done) return;
    const [x0, z0] = P(pr.x0, pr.z0);
    const [x1, z1] = P(pr.x1, pr.z1);
    const fresh = k === done;
    c.fillStyle = fresh ? 'rgba(186, 214, 160, 0.42)' : 'rgba(186, 214, 160, 0.16)';
    c.fillRect(x0 + 1, z0 + 1, x1 - x0 - 2, z1 - z0 - 2);
    c.strokeStyle = INK.ok;
    c.lineWidth = 1.5;
    c.strokeRect(x0 + 1, z0 + 1, x1 - x0 - 2, z1 - z0 - 2);
  });
  c.restore();
  const zones = Math.min(7, Math.round(clamp01(p * 1.25) * 7));
  label(c, `PRECINCTS ${zones} / 7`, q.x, q.y + q.h + 34, INK.ink, 18);
  tag(c, 'NOMINAL', q.x + q.w - 150, q.y + q.h + 34, seg(p, 0.75, 0.9));
}

/** A section through the band: the deck, the Dome, the Veil 1.2 km over it, the star's flux. */
function veil(c: C, p: number, t: number, b: Box): void {
  const x0 = b.x;
  const x1 = b.x + b.w;
  const deckY = b.y + b.h - 70;
  const veilY = b.y + 120;
  const k = (deckY - veilY) / 1200;
  // The deck and the Dome, to scale under the Veil.
  c.strokeStyle = INK.dim;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x0, deckY);
  c.lineTo(x1, deckY);
  c.stroke();
  const dw = Math.min(b.w * 0.4, DOME.a * 2 * k);
  c.beginPath();
  c.ellipse(b.x + b.w / 2, deckY, dw / 2, DOME.c * k, 0, Math.PI, 0);
  c.stroke();
  label(c, 'DOME', b.x + b.w / 2, deckY - DOME.c * k - 12, INK.faint, 14, 'center');
  // Flux: arrows from the star, bright over the Veil, cut under it.
  const cols = 9;
  for (let i = 0; i < cols; i++) {
    const x = x0 + ((i + 0.5) / cols) * b.w;
    const phase = (t * 0.8 + i * 0.37) % 1;
    for (const [ya, yb, alpha] of [[b.y + 10, veilY - 14, 0.9], [veilY + 18, deckY - 10, 0.28]] as const) {
      const y = ya + (yb - ya) * phase;
      c.strokeStyle = `rgba(255, 184, 104, ${(alpha * seg(p, 0, 0.3)).toFixed(3)})`;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x, y - 18);
      c.lineTo(x, y);
      c.lineTo(x - 5, y - 7);
      c.moveTo(x, y);
      c.lineTo(x + 5, y - 7);
      c.stroke();
    }
  }
  // The Veil: drawn on, then lit.
  const lit = seg(p, 0.25, 0.55);
  c.strokeStyle = INK.amber;
  c.lineWidth = 6;
  drawOn(c, b.w, seg(p, 0.05, 0.35), () => {
    c.moveTo(x0, veilY);
    c.lineTo(x1, veilY);
  });
  if (lit > 0) {
    c.fillStyle = `rgba(255, 184, 104, ${(0.12 * lit * (0.75 + 0.25 * Math.sin(t * 4))).toFixed(3)})`;
    c.fillRect(x0, veilY - 14, b.w, 28);
  }
  label(c, 'THE VEIL · 1.2 KM', x0, veilY - 26, INK.ink, 17);
  // Its load: a needle sweeping to normal.
  const gx = x0;
  const gy = b.y + b.h - 18;
  const gw = b.w;
  c.fillStyle = INK.ghost;
  c.fillRect(gx, gy - 4, gw, 4);
  c.fillStyle = 'rgba(186, 214, 160, 0.3)';
  c.fillRect(gx, gy - 4, gw * 0.6, 4);
  const load = 0.38 * seg(p, 0.35, 0.8);
  c.fillStyle = INK.ink;
  c.fillRect(gx + gw * load - 2, gy - 16, 4, 20);
  label(c, `LOAD ${Math.round(load * 100)} %`, gx, gy - 26, INK.dim, 15);
  tag(c, 'NORMAL', gx + gw - 150, gy - 26, seg(p, 0.8, 0.95));
}

function spin(c: C, p: number, t: number, b: Box): void {
  const cy = b.y + b.h * 0.45;
  // The band, turning.
  const bx = b.x + b.w * 0.27;
  const r = Math.min(b.w * 0.22, b.h * 0.3);
  c.strokeStyle = INK.bronze;
  c.lineWidth = 4;
  c.beginPath();
  c.ellipse(bx, cy, r, r * 0.34, 0, 0, Math.PI * 2);
  c.stroke();
  const turn = t * 0.9;
  for (let i = 0; i < 12; i++) {
    const a = turn + (i / 12) * Math.PI * 2;
    const front = Math.sin(a) > 0;
    c.fillStyle = front ? INK.ink : INK.faint;
    c.beginPath();
    c.arc(bx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.34, front ? 4 : 2.5, 0, Math.PI * 2);
    c.fill();
  }
  label(c, 'BAND', bx, cy + r * 0.8 + 34, INK.ink, 17, 'center');
  // The Gyre: three gimbals and a rotor, still against the stars.
  const gx = b.x + b.w * 0.75;
  c.lineWidth = 2;
  c.strokeStyle = INK.amber;
  c.beginPath();
  c.arc(gx, cy, r * 0.8, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = INK.bronze;
  c.beginPath();
  c.ellipse(gx, cy, r * 0.8, r * 0.28, 0, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.ellipse(gx, cy, r * 0.28, r * 0.8, 0, 0, Math.PI * 2);
  c.stroke();
  const rg = c.createRadialGradient(gx - r * 0.1, cy - r * 0.1, 2, gx, cy, r * 0.3);
  rg.addColorStop(0, 'rgba(255, 236, 200, 0.95)');
  rg.addColorStop(1, 'rgba(214, 172, 118, 0.6)');
  c.fillStyle = rg;
  c.beginPath();
  c.arc(gx, cy, r * 0.26, 0, Math.PI * 2);
  c.fill();
  label(c, 'GYRE', gx, cy + r * 0.8 + 34, INK.ink, 17, 'center');
  // The two rates converge.
  const settle = seg(p, 0.2, 0.75);
  const wobble = (1 - settle) * 0.37 * Math.sin(t * 9);
  big(c, `${(3 + wobble).toFixed(3)}°/min`, bx, b.y + b.h - 40, INK.ink, 26, 'center');
  big(c, `${(3).toFixed(3)}°/min`, gx, b.y + b.h - 40, INK.ink, 26, 'center');
  c.setLineDash([4, 6]);
  c.strokeStyle = settle > 0.95 ? INK.ok : INK.faint;
  c.beginPath();
  c.moveTo(bx + r + 20, cy);
  c.lineTo(gx - r - 20, cy);
  c.stroke();
  c.setLineDash([]);
  tag(c, 'AGREES', b.x + b.w / 2 - 62, cy - 24, seg(p, 0.75, 0.9));
}

function hold(c: C, p: number, t: number, b: Box): void {
  // Foil-wrapped spheres of power-law sizes, standing clear of one another, filling. (u, v, r) in
  // the square's side; no two closer than the sum of their radii.
  const tanks: [number, number, number][] = [
    [0.3, 0.4, 0.17],
    [0.66, 0.36, 0.13],
    [0.86, 0.62, 0.09],
    [0.52, 0.72, 0.11],
    [0.18, 0.75, 0.08],
    [0.73, 0.86, 0.06],
    [0.92, 0.28, 0.05],
    [0.06, 0.36, 0.05],
    [0.36, 0.92, 0.05],
  ];
  const s = Math.min(b.w, b.h - 60);
  const ox = b.x + (b.w - s) / 2;
  const level = seg(p, 0.05, 0.8);
  tanks.forEach(([u, v, rr], i) => {
    const x = ox + u * s;
    const y = b.y + v * s;
    const r = rr * s;
    const fill = clamp01(level * 1.15 - i * 0.02);
    c.save();
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(180, 200, 214, 0.08)';
    c.fillRect(x - r, y - r, 2 * r, 2 * r);
    const top = y + r - 2 * r * fill;
    c.fillStyle = 'rgba(214, 172, 118, 0.45)';
    c.beginPath();
    c.moveTo(x - r, top + Math.sin(t * 3 + i) * 2);
    c.quadraticCurveTo(x, top - Math.sin(t * 3 + i) * 3, x + r, top + Math.sin(t * 3 + i) * 2);
    c.lineTo(x + r, y + r);
    c.lineTo(x - r, y + r);
    c.closePath();
    c.fill();
    c.restore();
    c.strokeStyle = INK.bronze;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.stroke();
  });
  label(c, `COLD HOLD ${Math.round(level * 100)} %`, b.x, b.y + b.h + 10, INK.ink, 18);
  tag(c, 'FULL', b.x + b.w - 110, b.y + b.h + 10, seg(p, 0.8, 0.92));
}

function traffic(c: C, p: number, t: number, b: Box): void {
  // The axis from the pad to the East Lock, the craft flying in along the corridor.
  const y = b.y + b.h * 0.45;
  const x0 = b.x + 30;
  const x1 = b.x + b.w - 20;
  const span = DOME.a;
  const X = (wx: number) => x0 + (wx / span) * (x1 - x0);
  const half = (CORRIDOR.half / span) * (x1 - x0);
  c.fillStyle = 'rgba(255, 184, 104, 0.06)';
  c.fillRect(X(CORRIDOR.x0), y - half, X(span) - X(CORRIDOR.x0), 2 * half);
  c.setLineDash([6, 6]);
  c.strokeStyle = INK.amberDim;
  c.lineWidth = 1.5;
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(X(CORRIDOR.x0), y + s * half);
    c.lineTo(X(span), y + s * half);
    c.stroke();
  }
  c.setLineDash([]);
  // The pad and the Halo.
  c.strokeStyle = INK.bronze;
  c.lineWidth = 3;
  c.beginPath();
  c.arc(x0, y, (HALO.r / span) * (x1 - x0), -Math.PI / 2, Math.PI / 2);
  c.stroke();
  c.fillStyle = 'rgba(30, 26, 22, 0.9)';
  c.beginPath();
  c.arc(x0, y, (LANDING_PAD.r / span) * (x1 - x0), -Math.PI / 2, Math.PI / 2);
  c.fill();
  label(c, 'PAD', x0 + 6, y + 6, INK.dim, 14);
  // The lock.
  c.fillStyle = INK.ink;
  c.fillRect(x1 - 6, y - half - 10, 6, 2 * half + 20);
  label(c, 'EAST LOCK', x1, y - half - 24, INK.dim, 14, 'right');
  // The craft: in from the lock to the pad along the line, then a new one behind it.
  const u = (p * 1.3 + t * 0.02) % 1;
  const cx = x1 - (x1 - x0 - 30) * ease(u);
  c.fillStyle = INK.ink;
  c.beginPath();
  c.moveTo(cx - 14, y);
  c.lineTo(cx + 8, y - 9);
  c.lineTo(cx + 4, y);
  c.lineTo(cx + 8, y + 9);
  c.closePath();
  c.fill();
  // The 30 s interval, a sweep.
  const rx = b.x + b.w - 70;
  const ry = b.y + b.h - 40;
  const k = (t % 30) / 30;
  c.strokeStyle = INK.ghost;
  c.lineWidth = 6;
  c.beginPath();
  c.arc(rx, ry, 30, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = INK.amber;
  c.beginPath();
  c.arc(rx, ry, 30, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
  c.stroke();
  label(c, '30 S', rx, ry + 6, INK.ink, 15, 'center');
  label(c, 'ONE EVERY THIRTY SECONDS', b.x, b.y + b.h - 34, INK.ink, 17);
  tag(c, 'ON SCHEDULE', b.x, b.y + b.h + 4, seg(p, 0.3, 0.5));
}

function faults(c: C, p: number, t: number, b: Box): void {
  // Every system a cell; a scan passes over all of them and finds nothing.
  const cols = 12;
  const rows = 6;
  const cw = b.w / cols;
  const ch = (b.h - 90) / rows;
  const scan = seg(p, 0, 0.85);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = b.x + k * cw;
      const y = b.y + r * ch;
      const seen = (k + r * 0.3) / (cols + rows * 0.3) < scan;
      c.fillStyle = seen ? 'rgba(186, 214, 160, 0.3)' : INK.ghost;
      c.fillRect(x + 4, y + 4, cw - 8, ch - 8);
    }
  }
  const sx = b.x + scan * b.w;
  c.fillStyle = 'rgba(255, 184, 104, 0.5)';
  c.fillRect(sx - 1, b.y - 6, 2, rows * ch + 12);
  big(c, 'FAULTS  0', b.x, b.y + b.h - 26, INK.ink, 28);
  big(c, 'ALERTS  0', b.x + b.w * 0.5, b.y + b.h - 26, INK.ink, 28);
  tag(c, 'NONE', b.x + b.w - 100, b.y + b.h + 8, seg(p, 0.85, 0.97));
  void t;
}

/** The house, drawn on: storey, mansard, cross gable, turret, porch. */
function house(c: C, p: number, b: Box): void {
  const s = Math.min(b.w / 520, b.h / 420);
  const ox = b.x + b.w / 2 - 260 * s;
  const oy = b.y + b.h - 40;
  const P = (x: number, y: number): [number, number] => [ox + x * s, oy - y * s];
  const lines: [number, number][][] = [
    // Ground line and main block.
    [[0, 0], [520, 0]],
    [[60, 0], [60, 190], [360, 190], [360, 0]],
    // Mansard and its deck.
    [[50, 190], [80, 270], [340, 270], [370, 190]],
    // Cross gable.
    [[150, 190], [210, 320], [270, 190]],
    // Turret and its cone.
    [[360, 0], [360, 250], [440, 250], [440, 0]],
    [[350, 250], [400, 370], [450, 250]],
    // Porch roof and posts.
    [[20, 110], [500, 110]],
    [[20, 110], [20, 0]],
    [[500, 110], [500, 0]],
    // Windows.
    [[100, 140], [130, 140], [130, 170], [100, 170], [100, 140]],
    [[290, 140], [320, 140], [320, 170], [290, 170], [290, 140]],
    [[195, 230], [225, 230], [225, 270], [195, 270], [195, 230]],
    [[385, 150], [415, 150], [415, 190], [385, 190], [385, 150]],
    // Door.
    [[195, 0], [195, 70], [225, 70], [225, 0]],
  ];
  c.strokeStyle = INK.ink;
  c.lineWidth = 2;
  lines.forEach((pts, i) => {
    const u = seg(p, (i / lines.length) * 0.7, (i / lines.length) * 0.7 + 0.25);
    if (u <= 0) return;
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) * s;
    drawOn(c, len, u, () => {
      pts.forEach(([x, y], k) => (k === 0 ? c.moveTo(...P(x, y)) : c.lineTo(...P(x, y))));
    });
  });
  label(c, 'THE HOUSE', b.x, b.y + 20, INK.ink, 18);
  label(c, 'ESTATE · NORTH OF THE GATE COURT', b.x, b.y + 48, INK.faint, 15);
}

function kettle(c: C, p: number, t: number, b: Box): void {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h * 0.6;
  const r = Math.min(b.w, b.h) * 0.2;
  c.strokeStyle = INK.ink;
  c.lineWidth = 3;
  // Body: wide at the base, rounding in to the shoulders.
  c.beginPath();
  c.moveTo(cx - r, cy + r * 0.5);
  c.lineTo(cx + r, cy + r * 0.5);
  c.quadraticCurveTo(cx + r * 1.1, cy - r * 0.1, cx + r * 0.7, cy - r * 0.45);
  c.lineTo(cx - r * 0.7, cy - r * 0.45);
  c.quadraticCurveTo(cx - r * 1.1, cy - r * 0.1, cx - r, cy + r * 0.5);
  c.closePath();
  c.stroke();
  // Lid and knob.
  c.beginPath();
  c.arc(cx, cy - r * 0.45, r * 0.32, Math.PI, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.arc(cx, cy - r * 0.84, r * 0.07, 0, Math.PI * 2);
  c.stroke();
  // Handle: over the lid, from shoulder to shoulder.
  c.beginPath();
  c.ellipse(cx, cy - r * 0.45, r * 0.6, r * 0.78, 0, Math.PI, Math.PI * 2);
  c.stroke();
  // Spout: from low on the body up to its tip.
  const tipX = cx + r * 1.46;
  const tipY = cy - r * 0.46;
  c.beginPath();
  c.moveTo(cx + r * 0.93, cy + r * 0.28);
  c.lineTo(tipX + r * 0.05, tipY + r * 0.06);
  c.moveTo(cx + r * 0.82, cy - r * 0.02);
  c.lineTo(tipX - r * 0.05, tipY - r * 0.04);
  c.stroke();
  // The ring under it, lit.
  c.strokeStyle = INK.amber;
  c.lineWidth = 4;
  c.beginPath();
  c.ellipse(cx, cy + r * 0.62, r * 0.95, r * 0.16, 0, 0, Math.PI * 2);
  c.stroke();
  // Steam from the spout's tip.
  const steam = seg(p, 0.1, 0.4);
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.5 + i / 3) % 1;
    const x = tipX + 6 + Math.sin(ph * 7 + i) * 10 + ph * 20;
    const y = tipY - 10 - ph * r * 1.4;
    c.strokeStyle = `rgba(250, 242, 226, ${(0.5 * (1 - ph) * steam).toFixed(3)})`;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(x, y, 8 + ph * 14, 0, Math.PI * 1.4);
    c.stroke();
  }
  label(c, 'HOUSE · KITCHEN', b.x, b.y + 20, INK.ink, 18);
  tag(c, 'KETTLE ON', b.x, b.y + b.h + 4, seg(p, 0.3, 0.5), INK.amber);
}

function requester(c: C, p: number, t: number, b: Box): void {
  const y = b.y + b.h * 0.42;
  label(c, 'STANDING ORDER', b.x, y - 120, INK.faint, 16);
  big(c, 'Kitchen kettle · on', b.x, y - 76, INK.ink, 30);
  label(c, 'REQUESTED BY', b.x, y - 10, INK.faint, 16);
  c.strokeStyle = INK.rule;
  c.lineWidth = 2;
  c.strokeRect(b.x, y + 10, b.w, 64);
  // The field is searched, then left empty.
  const search = seg(p, 0, 0.55);
  if (search < 1) {
    c.fillStyle = INK.amberGhost;
    c.fillRect(b.x + 2, y + 12, (b.w - 4) * search, 60);
    label(c, 'SEARCHING RECORDS', b.x + 18, y + 50, INK.dim, 16);
  } else {
    big(c, '—', b.x + 20, y + 54, INK.ink, 32);
    if (Math.floor(t * 2) % 2 === 0) {
      c.fillStyle = INK.amber;
      c.fillRect(b.x + 56, y + 26, 3, 34);
    }
  }
  tag(c, 'NO RECORD', b.x, y + 130, seg(p, 0.6, 0.75), INK.amber);
}

// --- Observatory (T6) --------------------------------------------------------------------------------

/** Draws the Observatory's beat `i` (T6's line i) at progress p. */
export function feedBeat(c: C, i: number, p: number, t: number, b: Box): void {
  switch (i) {
    case 0:
      return resonator(c, p, t, b);
    case 1:
      return quiet(c, p, t, b);
    case 2:
      return activity(c, p, t, b);
    default:
      return oscillations(c, p, t, b);
  }
}

function resonator(c: C, p: number, t: number, b: Box): void {
  const cx = b.x + b.w * 0.42;
  const top = b.y + 30;
  const foot = b.y + b.h - 40;
  const r = (foot - top) * 0.32;
  const cy = top + (foot - top) * 0.52;
  c.strokeStyle = INK.dim;
  c.lineWidth = 4;
  // The portal frame.
  const fx = r * 1.7;
  drawOn(c, (foot - top) * 2 + fx * 2, seg(p, 0, 0.35), () => {
    c.moveTo(cx - fx, foot);
    c.lineTo(cx - fx, top);
    c.lineTo(cx + fx, top);
    c.lineTo(cx + fx, foot);
  });
  // Cables from the isolation stages.
  c.lineWidth = 1.5;
  c.strokeStyle = INK.faint;
  const cab = seg(p, 0.25, 0.5);
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(cx + s * fx * 0.6, top);
    c.lineTo(cx + s * fx * 0.6 + (cx + s * r * 0.7 - (cx + s * fx * 0.6)) * cab, top + (cy - r * 0.7 - top) * cab);
    c.stroke();
  }
  // The ring.
  c.strokeStyle = INK.bronze;
  c.lineWidth = 10;
  drawOn(c, Math.PI * 2 * r, seg(p, 0.35, 0.7), () => c.arc(cx, cy, r, -Math.PI / 2, Math.PI * 1.5));
  // Live: rings going out from it.
  const live = seg(p, 0.7, 0.8);
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.6 + i / 3) % 1;
    c.strokeStyle = `rgba(255, 184, 104, ${(0.5 * (1 - ph) * live).toFixed(3)})`;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, r + 14 + ph * r * 0.8, 0, Math.PI * 2);
    c.stroke();
  }
  label(c, 'THE RESONATOR', b.x + b.w * 0.76, cy - 40, INK.ink, 18);
  label(c, 'RING 100 M · NEAR 0 K', b.x + b.w * 0.76, cy - 8, INK.faint, 15);
  tag(c, 'FEED LIVE', b.x + b.w * 0.76, cy + 46, live);
}

function quiet(c: C, p: number, t: number, b: Box): void {
  const r = Math.min(b.w, b.h) * 0.36;
  const cx = b.x + b.w * 0.38;
  const cy = b.y + b.h * 0.5;
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(255, 248, 232, 1)');
  g.addColorStop(0.7, 'rgba(255, 210, 150, 0.85)');
  g.addColorStop(1, 'rgba(255, 170, 90, 0.5)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, r * ease(p * 3), 0, Math.PI * 2);
  c.fill();
  // Granulation: faint cells, churning.
  c.save();
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.clip();
  for (let i = 0; i < 90; i++) {
    const a = i * 2.39996;
    const d = Math.sqrt((i + 0.5) / 90) * r;
    const k = 0.5 + 0.5 * Math.sin(t * 2 + i * 1.7);
    c.fillStyle = `rgba(160, 90, 30, ${(0.08 * k).toFixed(3)})`;
    c.beginPath();
    c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * 0.06, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
  // Activity: a needle, low.
  const gx = b.x + b.w * 0.72;
  const gy = cy + 40;
  const gr = r * 0.7;
  c.strokeStyle = INK.ghost;
  c.lineWidth = 10;
  c.beginPath();
  c.arc(gx, gy, gr, Math.PI, Math.PI * 2);
  c.stroke();
  c.strokeStyle = 'rgba(186, 214, 160, 0.5)';
  c.beginPath();
  c.arc(gx, gy, gr, Math.PI, Math.PI * 1.45);
  c.stroke();
  const v = 0.18 * seg(p, 0.2, 0.7) + 0.01 * Math.sin(t * 3);
  const a = Math.PI + v * Math.PI;
  c.strokeStyle = INK.ink;
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(gx, gy);
  c.lineTo(gx + Math.cos(a) * gr * 0.95, gy + Math.sin(a) * gr * 0.95);
  c.stroke();
  label(c, 'ACTIVITY', gx, gy + 40, INK.dim, 16, 'center');
  tag(c, 'QUIET', gx - 50, gy + 84, seg(p, 0.6, 0.8));
}

function activity(c: C, p: number, t: number, b: Box): void {
  // The last hours of surface activity, inside its normal band.
  const gx = b.x;
  const gw = b.w;
  const gy = b.y + 40;
  const gh = b.h * 0.5;
  const band = [0.25, 0.65];
  c.fillStyle = 'rgba(186, 214, 160, 0.1)';
  c.fillRect(gx, gy + gh * (1 - band[1]), gw, gh * (band[1] - band[0]));
  label(c, 'NORMAL RANGE', gx + gw - 4, gy + gh * (1 - band[1]) - 10, INK.ok, 14, 'right');
  axes(c, gx, gy, gw, gh);
  const drawn = seg(p, 0, 0.5);
  c.strokeStyle = INK.ink;
  c.lineWidth = 2.5;
  c.beginPath();
  const n = 240;
  for (let i = 0; i <= n * drawn; i++) {
    const u = i / n;
    const v = 0.45 + 0.09 * Math.sin(u * 23 + 1.3) + 0.06 * Math.sin(u * 61) + 0.03 * Math.sin(u * 140 + t);
    const x = gx + u * gw;
    const y = gy + gh * (1 - v);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
  label(c, 'SURFACE ACTIVITY · 24 H', gx, gy - 14, INK.dim, 15);
  // The flare forecast: the next day's slots, empty.
  const fy = gy + gh + 90;
  label(c, 'FLARE FORECAST · NEXT 24 H', gx, fy - 16, INK.dim, 15);
  const slots = 24;
  const shown = seg(p, 0.45, 0.85);
  for (let i = 0; i < slots; i++) {
    if (i / slots > shown) break;
    c.strokeStyle = INK.rule;
    c.lineWidth = 2;
    c.strokeRect(gx + (i / slots) * gw + 3, fy, gw / slots - 6, 46);
  }
  tag(c, 'NONE', gx, fy + 100, seg(p, 0.85, 0.95));
}

/** The graph's frame. */
function axes(c: C, x: number, y: number, w: number, h: number): void {
  c.fillStyle = INK.rule;
  c.fillRect(x, y + h, w, 1.5);
  c.fillRect(x, y, 1.5, h);
}

function oscillations(c: C, p: number, t: number, b: Box): void {
  const modes = starModes();
  const top = b.y + 40;
  const h = b.h * 0.6;
  const nu0 = 1600;
  const nu1 = 3200;
  const fx = (nu: number) => b.x + ((nu - nu0) / (nu1 - nu0)) * b.w;
  c.fillStyle = INK.faint;
  c.fillRect(b.x, top + h, b.w, 1.5);
  const rise = seg(p, 0.05, 0.5);
  modes.forEach((m, i) => {
    const hh = m.amp * (h - 30) * clamp01(rise * 1.6 - (Math.abs(m.nu - STAR_MODES.numax) / 1600));
    c.fillStyle = m.l === 0 ? INK.amber : m.l === 1 ? INK.bronze : 'rgba(255, 214, 160, 0.75)';
    c.fillRect(fx(m.nu) - 2, top + h - hh * (0.92 + 0.08 * Math.sin(t * 5 + i)), 4, hh * (0.92 + 0.08 * Math.sin(t * 5 + i)));
  });
  // The scale: µHz, then the same comb in hertz, sped up 10⁵ times.
  const swap = seg(p, 0.45, 0.75);
  for (let nu = 1800; nu <= 3000; nu += 200) {
    const x = fx(nu);
    c.save();
    c.globalAlpha *= 1 - swap;
    label(c, String(nu), x, top + h + 34, INK.dim, 16, 'center', 1);
    c.restore();
    c.save();
    c.globalAlpha *= swap;
    label(c, `${Math.round((nu * 1e-6 * STAR_MODES.speed) * 10) / 10}`, x, top + h + 34, INK.amber, 16, 'center', 1);
    c.restore();
  }
  label(c, swap < 0.5 ? 'µHz' : 'Hz', b.x + b.w, top + h + 34, INK.faint, 15, 'right');
  const k = Math.round(1 + (STAR_MODES.speed - 1) * seg(p, 0.45, 0.8));
  big(c, `× ${k.toLocaleString('en-GB').replace(/,/g, ' ')}`, b.x, b.y + b.h - 10, swap > 0.5 ? INK.amber : INK.ink, 40);
  label(c, 'SPEED-UP · THE STAR, IN AN EAR', b.x + 260, b.y + b.h - 20, INK.faint, 15);
}
