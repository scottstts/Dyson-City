/**
 * The compound's plan, drawn from the field's own layout (field/layout.ts): the Dome's glass, the
 * Cordon, the roads, the precincts by zone, the Halo and the pad, the heroes, the estate, the West
 * Gate and the East Lock, the craft corridor, the Stand ("you are here") and, live, the craft.
 * North up, as the site plan (docs/city_plan_site.png).
 */
import { CORDON, CORRIDOR, COLD_HOLD, CONVERTER, ESTATE, GYRE, HALO, HOUSE_SITE, LANDING_PAD, LOOM, MAST, PRECINCTS, RECKONER, RESONATOR, RING_ROAD, ROADS, STILLS, type Zone } from '../../field/layout';
import { DOME } from '../../city/dome/spec';
import { STAND, TERMINAL } from '../layout';
import { FONT, INK } from './theme';

export interface PlanLive {
  /** The craft in plan, when it is in view of the compound. */
  craft: { x: number; z: number; visible: boolean };
}

const ZONE_TONE: Record<Zone, string> = {
  craft: 'rgba(255, 184, 104, 0.09)',
  instruments: 'rgba(214, 196, 160, 0.07)',
  power: 'rgba(255, 150, 90, 0.07)',
  cryo: 'rgba(180, 200, 214, 0.07)',
  science: 'rgba(214, 186, 150, 0.08)',
  works: 'rgba(200, 170, 140, 0.07)',
  heat: 'rgba(255, 130, 80, 0.07)',
};

const HEROES: [string, number, number][] = [
  ['GYRE', GYRE.x, GYRE.z],
  ['RESONATOR', RESONATOR.x, RESONATOR.z],
  ['LOOM', (LOOM.x0 + LOOM.x1) / 2, LOOM.zB],
  ['COLD HOLD', (COLD_HOLD.x0 + COLD_HOLD.x1) / 2, (COLD_HOLD.z0 + COLD_HOLD.z1) / 2],
  ['MAST', MAST.x, MAST.z],
  ['STILLS', STILLS.x, STILLS.z],
  ['CONVERTER', CONVERTER.x, CONVERTER.z],
  ['RECKONER', RECKONER.x, RECKONER.z],
];

/** The plan's mapping from world (x, z) to the canvas, for a box (shared with the briefings). */
export function planMapping(x: number, y: number, w: number, h: number): (px: number, pz: number) => [number, number] {
  const R = DOME.a + 12;
  const s = Math.min(w, h) / (2 * R);
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (px, pz) => [cx + px * s, cy + pz * s];
}

/**
 * Draws the plan centred in a box. `highlight` names heroes to ring (the row being spoken), `t`
 * pulses the markers.
 */
export function drawPlan(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, live: PlanLive | null, highlight: readonly string[] = [], labels = true): void {
  const R = DOME.a + 12;
  const s = Math.min(w, h) / (2 * R);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const P = planMapping(x, y, w, h);
  ctx.save();
  // The Dome's glass and the deck beyond.
  ctx.beginPath();
  ctx.arc(cx, cy, DOME.a * s, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 236, 200, 0.025)';
  ctx.fill();
  ctx.strokeStyle = INK.faint;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // The Dome's coffer grid, faint.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, DOME.a * s, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 236, 200, 0.05)';
  ctx.lineWidth = 1;
  for (let g = -480; g <= 480; g += 96) {
    ctx.beginPath();
    ctx.moveTo(...P(g, -R));
    ctx.lineTo(...P(g, R));
    ctx.moveTo(...P(-R, g));
    ctx.lineTo(...P(R, g));
    ctx.stroke();
  }
  ctx.restore();
  // Precincts.
  for (const pr of PRECINCTS) {
    const [x0, z0] = P(pr.x0, pr.z0);
    const [x1, z1] = P(pr.x1, pr.z1);
    ctx.fillStyle = ZONE_TONE[pr.zone];
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, (CORDON.r - CORDON.half) * s, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
    ctx.restore();
  }
  // The estate's terrace.
  {
    const [x0, z0] = P(-470, ESTATE.north);
    const [x1, z1] = P(ESTATE.east, ESTATE.south);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, (DOME.a - 30) * s, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(170, 190, 140, 0.1)';
    ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
    ctx.restore();
    const [hx, hz] = P(HOUSE_SITE[0], HOUSE_SITE[1]);
    ctx.fillStyle = INK.dim;
    ctx.fillRect(hx - 4, hz - 3, 8, 6);
  }
  // Roads: dark basalt with bronze edges.
  const road = (draw: () => void, width: number) => {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(214, 172, 118, 0.42)';
    ctx.lineWidth = width + 2;
    ctx.beginPath();
    draw();
    ctx.stroke();
    ctx.strokeStyle = '#0d0c0a';
    ctx.lineWidth = width - 1;
    ctx.beginPath();
    draw();
    ctx.stroke();
  };
  const rw = 20 * s;
  for (const r of ROADS)
    road(() => {
      ctx.moveTo(...P(r.a[0], r.a[1]));
      ctx.lineTo(...P(r.b[0], r.b[1]));
    }, rw);
  road(() => ctx.arc(cx, cy, ((RING_ROAD.r0 + RING_ROAD.r1) / 2) * s, 0, Math.PI * 2), rw);
  // The Cordon.
  ctx.strokeStyle = INK.dim;
  ctx.lineWidth = Math.max(2, CORDON.half * 2 * s);
  ctx.beginPath();
  ctx.arc(cx, cy, CORDON.r * s, Math.atan2(-172, CORDON.frontX) + 0.02, Math.atan2(172, CORDON.frontX) - 0.02 + Math.PI * 2);
  ctx.stroke();
  // The Halo and the pad.
  ctx.strokeStyle = INK.bronze;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, HALO.r * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(20, 18, 15, 0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, LANDING_PAD.r * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK.amberDim;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // The craft corridor: dashed along the axis to the East Lock.
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(255, 184, 104, 0.35)';
  ctx.lineWidth = 1;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(...P(CORRIDOR.x0, side * CORRIDOR.half));
    ctx.lineTo(...P(DOME.a, side * CORRIDOR.half));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Gates: the West Gate (people) and the East Lock (craft).
  ctx.fillStyle = INK.ink;
  for (const [gx, label, align] of [[-DOME.a, 'WEST GATE', 'left'], [DOME.a, 'EAST LOCK', 'right']] as const) {
    const [px, pz] = P(gx, 0);
    ctx.fillRect(px - 5, pz - 9, 10, 18);
    if (labels) {
      ctx.font = `600 15px ${FONT.mono}`;
      ctx.letterSpacing = '2px';
      ctx.fillStyle = INK.faint;
      ctx.textAlign = align === 'left' ? 'left' : 'right';
      ctx.fillText(label, px + (align === 'left' ? 14 : -14), pz + 34);
    }
    ctx.fillStyle = INK.ink;
  }
  // Heroes.
  ctx.textAlign = 'center';
  for (const [name, hx, hz] of HEROES) {
    const [px, pz] = P(hx, hz);
    const lit = highlight.includes(name);
    ctx.fillStyle = lit ? INK.amber : INK.bronze;
    ctx.beginPath();
    ctx.arc(px, pz, lit ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();
    if (lit) {
      ctx.strokeStyle = INK.amberDim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, pz, 14 + 4 * Math.sin(t * 4), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (labels) {
      ctx.font = `600 14px ${FONT.mono}`;
      ctx.letterSpacing = '2px';
      ctx.fillStyle = lit ? INK.ink : INK.faint;
      ctx.fillText(name, px, pz - 14);
    }
  }
  // The Stand: you are here.
  {
    const [px, pz] = P(STAND.cx, STAND.cz);
    ctx.strokeStyle = INK.amber;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, pz, Math.max(4, STAND.R * s), 0, Math.PI * 2);
    ctx.stroke();
    const k = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.strokeStyle = `rgba(255, 184, 104, ${0.15 + 0.4 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(px, pz, 10 + 16 * k, 0, Math.PI * 2);
    ctx.stroke();
    const [tx, tz] = [STAND.cx + Math.cos(TERMINAL.angle) * TERMINAL.r, STAND.cz + Math.sin(TERMINAL.angle) * TERMINAL.r];
    const [qx, qz] = P(tx, tz);
    ctx.fillStyle = INK.amber;
    ctx.beginPath();
    ctx.arc(qx, qz, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 14px ${FONT.mono}`;
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    if (labels) ctx.fillText('YOU ARE HERE', px + 18, pz - 22);
  }
  // The craft, live.
  if (live?.craft.visible) {
    const [px, pz] = P(Math.max(-R, Math.min(R, live.craft.x)), Math.max(-R, Math.min(R, live.craft.z)));
    ctx.fillStyle = INK.ink;
    ctx.save();
    ctx.translate(px, pz);
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.font = `600 14px ${FONT.mono}`;
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'center';
    ctx.fillText('CRAFT', px, pz + 26);
  }
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
  ctx.restore();
}
