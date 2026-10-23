/**
 * What the ship's screens show (docs/intro-ship.md, "Screens"): the side monitor the Guardian reads
 * in scene 1 (Alpha Centauri A and the sphere round it, the structure's state, all nominal, the
 * time to Dyson City), and the three dash displays (flight, track, systems) following the flight.
 *
 * Drawn into canvases, uploaded as the glass's emission; redrawn only at the rate what they show
 * changes (a clock's tick, the flight's figures), and not at all once nobody aboard can see them.
 * The palette is the ship's own: cool white and a pale cyan on near-black, amber for warnings
 * (none: everything is nominal), green-white for "nominal".
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three/webgpu';
import { STRUCTURE } from '../../sky/structure/layout';

const INK = {
  bg: '#05070a',
  panel: '#0a0e13',
  rule: 'rgba(170, 205, 230, 0.16)',
  ghost: 'rgba(170, 205, 230, 0.08)',
  ink: 'rgba(232, 242, 250, 0.94)',
  dim: 'rgba(200, 220, 236, 0.62)',
  faint: 'rgba(190, 212, 230, 0.36)',
  cyan: 'rgb(122, 212, 236)',
  cyanDim: 'rgba(122, 212, 236, 0.45)',
  ok: 'rgb(170, 232, 196)',
  star: 'rgb(255, 236, 206)',
  amber: 'rgb(255, 184, 104)',
} as const;
const SANS = '"SF Pro Display", "SF Pro Text", "Helvetica Neue", Inter, system-ui, sans-serif';
const MONO = '"SF Mono", "JetBrains Mono", Menlo, ui-monospace, monospace';

/** The monitor's canvas (16:10, as the glass) and the dash atlas (three displays side by side). */
export const MONITOR_PX = { w: 1280, h: 800 } as const;
export const DASH_PX = { w: 1920, h: 1000 / 2, each: 640 } as const;

/** What the screens show from the flight. */
export interface ScreenData {
  /** Seconds left to Dyson City (scene 1), or null on the band. */
  eta: number | null;
  /** Range to the shell (km), closing speed (km/s): scene 1. */
  range: number;
  speed: number;
  /** On the band: height (m), sink rate (m/s, + down), ground speed (m/s), distance to the spot (m). */
  height: number;
  sink: number;
  ground: number;
  toSpot: number;
  /** Engines (0..1) and the gear (1 down), the cabin's and the outside's pressure (bar). */
  main: number;
  lift: number;
  gear: number;
  outside: number;
  landed: boolean;
}

function texture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  return t;
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
const group = (n: number) => Math.round(n).toLocaleString('en-US');

export class ShipScreens {
  readonly monitor: CanvasTexture;
  readonly dash: CanvasTexture;
  private readonly m: CanvasRenderingContext2D;
  private readonly d: CanvasRenderingContext2D;
  private drawnAt = -Infinity;

  constructor() {
    const mc = document.createElement('canvas');
    mc.width = MONITOR_PX.w;
    mc.height = MONITOR_PX.h;
    const dc = document.createElement('canvas');
    dc.width = DASH_PX.w;
    dc.height = DASH_PX.h;
    this.m = mc.getContext('2d', { alpha: false })!;
    this.d = dc.getContext('2d', { alpha: false })!;
    this.monitor = texture(mc);
    this.dash = texture(dc);
  }

  /** Redraws at `rate` Hz while someone aboard can see the screens. */
  update(t: number, data: ScreenData, visible: boolean, rate = 8): void {
    if (!visible) return;
    if (t - this.drawnAt < 1 / rate && t >= this.drawnAt) return;
    this.drawnAt = t;
    this.drawMonitor(t, data);
    this.drawDash(t, data);
    this.monitor.needsUpdate = true;
    this.dash.needsUpdate = true;
  }

  dispose(): void {
    this.monitor.dispose();
    this.dash.dispose();
  }

  // --- the side monitor ------------------------------------------------------------------------

  private drawMonitor(t: number, s: ScreenData): void {
    const c = this.m;
    const W = MONITOR_PX.w;
    const H = MONITOR_PX.h;
    c.fillStyle = INK.bg;
    c.fillRect(0, 0, W, H);
    // Header.
    c.textBaseline = 'alphabetic';
    c.fillStyle = INK.dim;
    c.font = `500 22px ${SANS}`;
    text(c, 'AURELIA  ·  APPROACH', 48, 62, 0.16);
    c.textAlign = 'right';
    c.fillStyle = INK.ink;
    c.font = `400 30px ${MONO}`;
    const eta = s.eta ?? 0;
    c.fillText(`${pad(eta / 3600, 1)}:${pad((eta % 3600) / 60)}:${pad(eta % 60)}`, W - 48, 64);
    c.fillStyle = INK.faint;
    c.font = `500 15px ${SANS}`;
    text(c, 'TO DYSON CITY', W - 48, 90, 0.18, 'right');
    c.textAlign = 'left';
    rule(c, 48, 108, W - 96);

    // Left: the star and its shell, the ship's track in through the open band.
    const cx = 330;
    const cy = 430;
    const rStar = 128;
    const rShell = rStar * (984 / 696);
    const glow = c.createRadialGradient(cx, cy, rStar * 0.2, cx, cy, rStar * 1.08);
    glow.addColorStop(0, 'rgba(255, 246, 228, 0.95)');
    glow.addColorStop(0.75, 'rgba(255, 214, 160, 0.78)');
    glow.addColorStop(1, 'rgba(255, 170, 90, 0.0)');
    c.fillStyle = glow;
    c.beginPath();
    c.arc(cx, cy, rStar * 1.08, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = INK.cyan;
    c.lineWidth = 2;
    // The shell, broken where the open bands and the wide openings are (the logo's gaps).
    const gaps: [number, number][] = [];
    // Seen edge-on, the open bands are either side of the band, at both ends of the section.
    for (const a of [0, Math.PI]) gaps.push([a - S_OPEN[1], a - S_OPEN[0]], [a + S_OPEN[0], a + S_OPEN[1]]);
    let from = 0;
    const sorted = gaps.map(([a, b]) => [norm(a), norm(b)] as [number, number]).sort((p, q) => p[0] - q[0]);
    for (const [a, b] of sorted) {
      c.beginPath();
      c.arc(cx, cy, rShell, from, a);
      c.stroke();
      from = b;
    }
    c.beginPath();
    c.arc(cx, cy, rShell, from, Math.PI * 2);
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = INK.cyanDim;
    c.beginPath();
    c.arc(cx, cy, rShell + 8, 0, Math.PI * 2);
    c.stroke();
    // The ship, 2.15 shell radii out, and its track in.
    const sx = cx + rShell * 2.15 * Math.cos(-0.18);
    const sy = cy + rShell * 2.15 * Math.sin(-0.18) * 0.62;
    const ex = cx + rShell + 2;
    const ey = cy - rShell * 0.12;
    c.setLineDash([6, 8]);
    c.strokeStyle = INK.cyan;
    c.beginPath();
    c.moveTo(Math.min(sx, 620), sy);
    c.quadraticCurveTo((sx + ex) / 2, ey - 30, ex, ey);
    c.stroke();
    c.setLineDash([]);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
    c.fillStyle = INK.ink;
    c.beginPath();
    c.arc(Math.min(sx, 620), sy, 6, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = `rgba(122, 212, 236, ${0.25 + 0.5 * pulse})`;
    c.beginPath();
    c.arc(Math.min(sx, 620), sy, 12 + 6 * pulse, 0, Math.PI * 2);
    c.stroke();
    // Its labels.
    label(c, 'ALPHA CENTAURI A', 'G2 V  ·  5,772 K  ·  R  696,000 km', 48, 680);
    label(c, 'SHELL', 'r  984,000 km', 48, 746);
    c.textAlign = 'right';
    c.fillStyle = INK.faint;
    c.font = `500 15px ${SANS}`;
    text(c, 'RANGE', 622, 168, 0.18, 'right');
    c.fillStyle = INK.ink;
    c.font = `400 26px ${MONO}`;
    c.fillText(`${group(s.range)} km`, 622, 198);
    c.fillStyle = INK.faint;
    c.font = `500 15px ${SANS}`;
    text(c, 'CLOSING', 622, 232, 0.18, 'right');
    c.fillStyle = INK.ink;
    c.font = `400 26px ${MONO}`;
    c.fillText(`${s.speed.toFixed(1)} km/s`, 622, 262);
    c.textAlign = 'left';

    // Right: the structure as drawn (the logo), and its state.
    c.strokeStyle = INK.rule;
    c.beginPath();
    c.moveTo(680, 140);
    c.lineTo(680, H - 48);
    c.stroke();
    c.fillStyle = INK.dim;
    c.font = `500 18px ${SANS}`;
    text(c, 'DYSON SPHERE  ·  STRUCTURE', 720, 160, 0.16);
    drawSphere(c, 900, 360, 150);
    const rows: [string, string, string][] = [
      ['SHELL INTEGRITY', '', 'NOMINAL'],
      ['BAND SPIN', '7,200 s', 'NOMINAL'],
      ['COLLECTORS', '97.8 %', 'NOMINAL'],
      ['HEADERS', '3,450 K', 'NOMINAL'],
      ['VEIL', '', 'NOMINAL'],
      ['DYSON CITY', 'AUTONOMOUS', 'ONLINE'],
    ];
    rows.forEach(([k, v, st], i) => {
      const y = 556 + i * 38;
      c.fillStyle = INK.dim;
      c.font = `500 16px ${SANS}`;
      text(c, k, 720, y, 0.12);
      c.fillStyle = INK.ink;
      c.font = `400 18px ${MONO}`;
      c.textAlign = 'right';
      c.fillText(v, 1060, y);
      c.fillStyle = INK.ok;
      c.font = `600 15px ${SANS}`;
      text(c, st, W - 48, y, 0.14, 'right');
      c.textAlign = 'left';
      c.strokeStyle = INK.ghost;
      c.beginPath();
      c.moveTo(720, y + 14);
      c.lineTo(W - 48, y + 14);
      c.stroke();
    });
  }

  // --- the dash -------------------------------------------------------------------------------

  private drawDash(t: number, s: ScreenData): void {
    const c = this.d;
    const E = DASH_PX.each;
    const H = DASH_PX.h;
    c.fillStyle = INK.bg;
    c.fillRect(0, 0, DASH_PX.w, H);
    for (let i = 0; i < 3; i++) {
      c.save();
      c.translate(i * E, 0);
      c.beginPath();
      c.rect(0, 0, E, H);
      c.clip();
      if (i === 0) this.flight(c, E, H, s, t);
      else if (i === 1) this.track(c, E, H, s, t);
      else this.systems(c, E, H, s);
      c.restore();
    }
  }

  private flight(c: CanvasRenderingContext2D, W: number, H: number, s: ScreenData, t: number): void {
    header(c, s.eta !== null ? 'FLIGHT  ·  CRUISE' : s.landed ? 'FLIGHT  ·  ON GROUND' : 'FLIGHT  ·  DESCENT', W);
    // An attitude ball: the horizon and a pitch ladder.
    const cx = W / 2;
    const cy = H * 0.56;
    const r = H * 0.3;
    c.save();
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = INK.panel;
    c.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    const tilt = Math.sin(t * 0.21) * 0.02;
    c.translate(cx, cy);
    c.rotate(tilt);
    c.strokeStyle = INK.cyan;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-r, 6);
    c.lineTo(r, 6);
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = INK.cyanDim;
    for (let k = -3; k <= 3; k++) {
      if (!k) continue;
      const y = 6 - k * 24;
      const w = k % 2 ? 26 : 46;
      c.beginPath();
      c.moveTo(-w, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.restore();
    c.strokeStyle = INK.rule;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = INK.ink;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx - 40, cy);
    c.lineTo(cx - 12, cy);
    c.lineTo(cx, cy + 8);
    c.lineTo(cx + 12, cy);
    c.lineTo(cx + 40, cy);
    c.stroke();
    c.lineWidth = 1;
    // Figures either side.
    const left = s.eta !== null ? [['SPEED', `${s.speed.toFixed(1)} km/s`]] : [['GND SPD', `${s.ground.toFixed(0)} m/s`], ['SINK', `${s.sink.toFixed(1)} m/s`]];
    const right = s.eta !== null ? [['RANGE', `${group(s.range / 1000)} Mm`]] : [['HEIGHT', `${s.height.toFixed(0)} m`], ['TO SPOT', `${group(s.toSpot)} m`]];
    figures(c, left, 24, H * 0.42, 'left');
    figures(c, right, W - 24, H * 0.42, 'right');
  }

  private track(c: CanvasRenderingContext2D, W: number, H: number, s: ScreenData, t: number): void {
    header(c, s.eta !== null ? 'TRACK  ·  ALPHA CEN A' : 'TRACK  ·  WEST GATE', W);
    const cx = W / 2;
    const cy = H * 0.6;
    c.strokeStyle = INK.ghost;
    for (let k = 1; k <= 4; k++) {
      c.beginPath();
      c.arc(cx, cy, k * 42, 0, Math.PI * 2);
      c.stroke();
    }
    if (s.eta !== null) {
      // The sphere ahead, the ship's track into it.
      c.strokeStyle = INK.cyan;
      c.beginPath();
      c.arc(cx, cy - 60, 70, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([5, 7]);
      c.beginPath();
      c.moveTo(cx, H - 30);
      c.lineTo(cx, cy + 12);
      c.stroke();
      c.setLineDash([]);
    } else {
      // The landing spot and the gate east of it; the ship's place along the approach.
      const k = Math.min(s.toSpot / 2000, 1);
      c.strokeStyle = INK.cyan;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx - 10, cy - 10);
      c.lineTo(cx + 10, cy + 10);
      c.moveTo(cx + 10, cy - 10);
      c.lineTo(cx - 10, cy + 10);
      c.stroke();
      c.lineWidth = 1;
      c.strokeStyle = INK.dim;
      c.strokeRect(cx + 38, cy - 9, 18, 18);
      c.fillStyle = INK.faint;
      c.font = `500 13px ${SANS}`;
      text(c, 'GATE', cx + 47, cy + 34, 0.14, 'center');
      c.setLineDash([5, 7]);
      c.strokeStyle = INK.cyanDim;
      c.beginPath();
      c.moveTo(cx - 200 * k - 6, cy);
      c.lineTo(cx - 12, cy);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = INK.ink;
      c.beginPath();
      c.arc(cx - 200 * k - 6, cy, 6, 0, Math.PI * 2);
      c.fill();
    }
    const blink = Math.sin(t * 4) > 0 ? 1 : 0.45;
    c.fillStyle = `rgba(170, 232, 196, ${blink})`;
    c.font = `600 14px ${SANS}`;
    text(c, s.eta !== null ? 'ON TRACK' : s.landed ? 'DOWN  ·  SAFE' : 'GUIDED  ·  CITY CONTROL', W / 2, H - 22, 0.14, 'center');
  }

  private systems(c: CanvasRenderingContext2D, W: number, H: number, s: ScreenData): void {
    header(c, 'SYSTEMS', W);
    const bars: [string, number][] = [
      ['MAIN', s.main],
      ['LIFT', s.lift],
      ['POWER', 0.82],
      ['LIFE SUPPORT', 1],
    ];
    bars.forEach(([k, v], i) => {
      const y = 132 + i * 66;
      c.fillStyle = INK.dim;
      c.font = `500 15px ${SANS}`;
      text(c, k, 30, y, 0.12);
      c.fillStyle = INK.ghost;
      c.fillRect(30, y + 14, W - 160, 10);
      c.fillStyle = INK.cyan;
      c.fillRect(30, y + 14, (W - 160) * Math.min(Math.max(v, 0), 1), 10);
      c.fillStyle = INK.ink;
      c.font = `400 18px ${MONO}`;
      c.textAlign = 'right';
      c.fillText(`${Math.round(v * 100)}%`, W - 30, y + 24);
      c.textAlign = 'left';
    });
    figures(c, [['CABIN', '1.00 bar'], ['OUTSIDE', s.eta !== null ? 'VACUUM' : `${s.outside.toFixed(2)} bar`]], 30, H * 0.8, 'left', true);
    figures(c, [['GEAR', s.gear > 0.99 ? 'DOWN' : s.gear < 0.01 ? 'UP' : 'MOVING']], W - 30, H * 0.8, 'right', true);
  }
}

/** The open bands' latitudes (rad): from the band's edge to the gores. */
const S_OPEN = [STRUCTURE.girdleHalfLatitude, STRUCTURE.panelLow] as const;

function norm(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

/** Tracked capitals (canvas has letterSpacing in Chromium). */
function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, tracking: number, align: CanvasTextAlign = 'left'): void {
  const px = parseFloat(c.font.split('px')[0].split(' ').pop() ?? '16');
  (c as unknown as { letterSpacing: string }).letterSpacing = `${(tracking * px).toFixed(1)}px`;
  c.textAlign = align;
  c.fillText(s, x, y);
  (c as unknown as { letterSpacing: string }).letterSpacing = '0px';
  c.textAlign = 'left';
}

function rule(c: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  c.strokeStyle = INK.rule;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x, y + 0.5);
  c.lineTo(x + w, y + 0.5);
  c.stroke();
}

function label(c: CanvasRenderingContext2D, title: string, line: string, x: number, y: number): void {
  c.fillStyle = INK.ink;
  c.font = `600 18px ${SANS}`;
  text(c, title, x, y, 0.14);
  c.fillStyle = INK.dim;
  c.font = `400 17px ${MONO}`;
  c.fillText(line, x, y + 28);
}

function header(c: CanvasRenderingContext2D, title: string, W: number): void {
  c.fillStyle = INK.dim;
  c.font = `600 17px ${SANS}`;
  text(c, title, 30, 52, 0.16);
  rule(c, 30, 72, W - 60);
}

function figures(c: CanvasRenderingContext2D, rows: string[][], x: number, y: number, align: 'left' | 'right', wide = false): void {
  rows.forEach(([k, v], i) => {
    const yy = y + i * 70;
    c.fillStyle = INK.faint;
    c.font = `500 14px ${SANS}`;
    text(c, k, x, yy, 0.16, align);
    c.fillStyle = INK.ink;
    c.font = `400 ${wide ? 22 : 26}px ${MONO}`;
    c.textAlign = align;
    c.fillText(v, x, yy + 32);
    c.textAlign = 'left';
  });
}

/**
 * The sphere as drawn: the logo's structure in orthographic view from 12° above the band (the
 * entry screen's angle): the band, the spines, the gores' outlines, the polar collars.
 */
function drawSphere(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const tilt = (12 * Math.PI) / 180;
  const S = STRUCTURE;
  const proj = (lat: number, lon: number): [number, number, number] => {
    const x = Math.cos(lat) * Math.sin(lon);
    const y = Math.sin(lat);
    const z = Math.cos(lat) * Math.cos(lon);
    // Tilt toward the viewer about x.
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
    const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
    return [cx + x * r, cy - y2 * r, z2];
  };
  const path = (pts: [number, number, number][], front: boolean) => {
    c.beginPath();
    let pen = false;
    for (const [x, y, z] of pts) {
      if ((z >= 0) === front) {
        if (!pen) c.moveTo(x, y);
        else c.lineTo(x, y);
        pen = true;
      } else pen = false;
    }
    c.stroke();
  };
  const latLine = (lat: number, lon0: number, lon1: number) => Array.from({ length: 90 }, (_, i) => proj(lat, lon0 + ((lon1 - lon0) * i) / 89));
  const lonLine = (lon: number, lat0: number, lat1: number) => Array.from({ length: 60 }, (_, i) => proj(lat0 + ((lat1 - lat0) * i) / 59, lon));
  const draw = (front: boolean) => {
    c.strokeStyle = front ? INK.cyan : INK.ghost;
    c.lineWidth = front ? 1.4 : 1;
    // The band's edges.
    for (const s of [-1, 1]) path(latLine(s * S.girdleHalfLatitude, 0, Math.PI * 2), front);
    S.meridianLongitudes.forEach((lon0, k) => {
      const lon = lon0 - Math.PI / 2;
      for (const s of [-1, 1]) path(lonLine(lon, s * S.spineEnd, (s * Math.PI) / 2), front);
      // The gores: their outlines between this meridian's gap and the next's.
      const gap = k % 2 === 0 ? S.wideHalf : S.slotHalf;
      const nextGap = (k + 1) % 2 === 0 ? S.wideHalf : S.slotHalf;
      const a = lon + gap;
      const b = lon + Math.PI / 3 - nextGap;
      for (const s of [-1, 1]) {
        path(latLine(s * S.panelLow, a, b), front);
        path(latLine(s * S.panelHigh, a, b), front);
        path(lonLine(a, s * S.panelLow, s * S.panelHigh), front);
        path(lonLine(b, s * S.panelLow, s * S.panelHigh), front);
      }
    });
    for (const s of [-1, 1]) path(latLine(s * S.collarLatitude, 0, Math.PI * 2), front);
  };
  draw(false);
  // The star inside, seen through it.
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, r * 0.72);
  g.addColorStop(0, 'rgba(255, 240, 214, 0.55)');
  g.addColorStop(1, 'rgba(255, 190, 120, 0.0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
  c.fill();
  draw(true);
  c.strokeStyle = INK.rule;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.stroke();
}
