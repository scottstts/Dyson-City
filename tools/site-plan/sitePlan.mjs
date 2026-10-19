/**
 * Draws the city site plan (docs/city_plan_site.png): a to-scale plan of the platform under the
 * Dome, north up, with a projected west–east section below it.
 *
 * The field is drawn from the source of truth: tools/site-plan/planData.ts is bundled (rolldown)
 * and reads src/field/layout.ts and the builders' own layouts (roads, viaducts, the Halo's arches,
 * the Cold Hold's tanks, the radiator forest, the tower clusters, the East Lock), so the plan cannot
 * disagree with the build; the estate comes from src/estate/ the same way. The Dome and the West Gate are drawn here.
 *
 * Frame: plan x = world X (east), plan y = world Z (south), so north (−Z) is up. Units are metres.
 * The drawing is built as SVG and rasterised to PNG in headless Chrome (as tools/render.mjs is).
 *
 *   node tools/site-plan/sitePlan.mjs
 */
import { chromium } from 'playwright-core';
import { build } from 'rolldown';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/city_plan_site.png');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const tmp = join(os.tmpdir(), `dyson-plan-${process.pid}.mjs`);
const bundle = await build({ input: 'tools/site-plan/planData.ts', platform: 'node', write: false, output: { format: 'esm' }, logLevel: 'silent' });
fs.writeFileSync(tmp, bundle.output[0].code);
const { planData } = await import(pathToFileURL(tmp).href);
fs.rmSync(tmp, { force: true });
const D = planData();

// ── World (the Dome mirrors src/city/dome/spec.ts) ───────────────────────────────────────────
const GLASS_A = 499.75;
const GLASS_C = 250;
const PAD_R = 500;
const PAD_OUTER_R = 502.4;
const EAVE_R = 480;
const BAND_HALF = 12;
const RIBS = [96, 192, 288, 384];
const BOUNDARY_INLAY_R = 488;
const COLLAR_HALF = 48;
const domeHeight = (r) => (r >= GLASS_A ? 0 : GLASS_C * Math.sqrt(1 - (r / GLASS_A) ** 2));

// ── Layout (from the build) ──────────────────────────────────────────────────────────────────
const GATE_COURT = D.court;
const HALO_R = D.halo.r;
const CORRIDOR = D.corridor;
const HOUSE = { x: D.house[0], z: D.house[1] };
const MAST = D.mast;
const GYRE = D.gyre;
const RESONATOR = D.resonator;
const LOOM = D.loom;
const HOLD = D.hold;
const GATEWAY = D.gateway;

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────
const f = (n) => (Math.round(n * 10) / 10).toString();
const pts = (arr) => arr.map(([x, z]) => `${f(x)},${f(z)}`).join(' ');
const out = [];
const add = (s) => out.push(s);
const text = (x, y, s, cls = 'lbl', extra = '') => add(`<text x="${f(x)}" y="${f(y)}" class="${cls}" ${extra}>${s}</text>`);
/** A rectangle centred at c, `len` along unit u, `wid` across it. */
const orientedRect = (cx, cz, ux, uz, len, wid) => {
  const vx = -uz;
  const vz = ux;
  const l = len / 2;
  const w = wid / 2;
  return [
    [cx - ux * l - vx * w, cz - uz * l - vz * w],
    [cx + ux * l - vx * w, cz + uz * l - vz * w],
    [cx + ux * l + vx * w, cz + uz * l + vz * w],
    [cx - ux * l + vx * w, cz - uz * l + vz * w],
  ];
};
const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
const deg = (rad) => (rad * 180) / Math.PI;

// Height clearance to the glass, at each structure's true plan radius (least per name).
const clearances = [];
const checkClear = (name, x, z, reach, top) => {
  const r = Math.hypot(x, z) + reach;
  const c = domeHeight(r) - top;
  clearances.push({ name, r: Math.round(r), top: Math.round(top), clear: Math.round(c) });
};

// ── Style ────────────────────────────────────────────────────────────────────────────────────
const C = {
  paper: '#f3f0e8',
  deck: '#34373c',
  deckLine: '#41454b',
  pad: '#e6dfcf',
  padLine: '#d6cdb8',
  bronze: '#a5793d',
  glass: '#5f7d93',
  frame: '#8d8678',
  road: '#47484b',
  roadEdge: '#a5793d',
  lawn: '#93ad6c',
  lawnStripe: '#a0b978',
  tree: '#5d7a45',
  treeDark: '#46612f',
  gravel: '#d8ccaf',
  water: '#86aec2',
  slate: '#5b616c',
  porch: '#b7a58a',
  wall: '#cfc5b0',
  gold: '#c9a043',
  goldLight: '#ecd38a',
  goldDark: '#7d5f1c',
  ceramic: '#fbf9f3',
  ceramicLine: '#8f8a80',
  ink: '#26272a',
  inkSoft: '#6b6a66',
  glow: '#ff9a3c',
};

// ── Canvas ───────────────────────────────────────────────────────────────────────────────────
const VB = { x: -640, y: -640, w: 1700, h: 1700 };
add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" width="2550" height="2550" font-family="Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif">`);
add(`<defs>
  <radialGradient id="goldSphere" cx="0.38" cy="0.36" r="0.7">
    <stop offset="0" stop-color="${C.goldLight}"/><stop offset="0.55" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDark}"/>
  </radialGradient>
  <linearGradient id="goldBar" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.goldLight}"/><stop offset="1" stop-color="${C.gold}"/>
  </linearGradient>
  <pattern id="lawnStripes" patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(${f(deg(Math.atan2(HOUSE.z, HOUSE.x)) + 90)})">
    <rect width="12" height="12" fill="${C.lawn}"/><rect width="6" height="12" fill="${C.lawnStripe}"/>
  </pattern>
  <clipPath id="padClip"><circle r="${PAD_R}"/></clipPath>
  <style>
    .lbl{font-size:12px;fill:${C.ink};letter-spacing:0.6px}
    .hero{font-size:16px;font-weight:600;fill:${C.ink};letter-spacing:2.4px}
    .sub{font-size:10.5px;fill:${C.inkSoft};letter-spacing:0.4px}
    .zone{font-size:13px;font-weight:600;fill:${C.ink};letter-spacing:2px}
    .small{font-size:9px;fill:${C.inkSoft};letter-spacing:0.3px}
    .title{font-size:34px;font-weight:600;fill:${C.ink};letter-spacing:5px}
    .h2{font-size:14px;font-weight:600;fill:${C.ink};letter-spacing:2.2px}
    .vp{font-size:8px;font-weight:700;fill:#fff}
    .deckLbl{font-size:11px;fill:#b9b4a8;letter-spacing:2px}
  </style>
</defs>`);
add(`<rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="${C.paper}"/>`);

// ── Deck, platform, glass ────────────────────────────────────────────────────────────────────
const PLAN_R = 585;
add(`<circle r="${PLAN_R}" fill="${C.deck}"/>`);
for (let r = 96; r < PLAN_R; r += 96) add(`<circle r="${r}" fill="none" stroke="${C.deckLine}" stroke-width="0.6"/>`);
for (let i = 0; i < 24; i++) {
  const [x, z] = polar(PLAN_R, (i / 24) * Math.PI * 2);
  const [x0, z0] = polar(PAD_OUTER_R, (i / 24) * Math.PI * 2);
  add(`<line x1="${f(x0)}" y1="${f(z0)}" x2="${f(x)}" y2="${f(z)}" stroke="${C.deckLine}" stroke-width="0.6"/>`);
}
add(`<circle r="${PAD_OUTER_R}" fill="#cfc7b6"/>`);
add(`<circle r="${PAD_R + 1.2}" fill="#dbd3c2"/>`);
add(`<circle r="${PAD_R}" fill="${C.pad}"/>`);
add(`<g clip-path="url(#padClip)" stroke="${C.padLine}" stroke-width="0.35">`);
for (let v = 12; v < PAD_R; v += 24) {
  add(`<line x1="${v}" y1="-${PAD_R}" x2="${v}" y2="${PAD_R}"/><line x1="-${v}" y1="-${PAD_R}" x2="-${v}" y2="${PAD_R}"/>`);
  add(`<line y1="${v}" x1="-${PAD_R}" y2="${v}" x2="${PAD_R}"/><line y1="-${v}" x1="-${PAD_R}" y2="-${v}" x2="${PAD_R}"/>`);
}
add(`</g>`);
add(`<g stroke="${C.bronze}" stroke-width="0.9" fill="none"><line x1="-${PAD_R}" x2="${PAD_R}" y1="0" y2="0"/><line y1="-${PAD_R}" y2="${PAD_R}" x1="0" x2="0"/><circle r="${BOUNDARY_INLAY_R}" stroke-width="0.7"/></g>`);
add(`<circle r="${GLASS_A}" fill="none" stroke="${C.glass}" stroke-width="2.2"/>`);

// ── Collars, the West Gate and the East Lock ─────────────────────────────────────────────────
for (const a of [0, 0.5, 1, 1.5]) {
  for (const s of [-1, 1]) {
    const ang = a * Math.PI;
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    add(`<polygon points="${pts(orientedRect(ux * 504 - uz * s * COLLAR_HALF, uz * 504 + ux * s * COLLAR_HALF, ux, uz, 8, 6))}" fill="${C.ceramic}" stroke="${C.ceramicLine}" stroke-width="0.8"/>`);
  }
}
add(`<rect x="-560" y="-16" width="42" height="32" fill="#d9d1bf" stroke="${C.ceramicLine}" stroke-width="0.4"/>`);
add(`<rect x="-518" y="-9" width="48" height="18" fill="#3b3c40"/>`);
for (const s of [-1, 1]) add(`<rect x="-518" y="${s > 0 ? 9 : -16}" width="48" height="7" fill="${C.ceramic}" stroke="${C.ceramicLine}" stroke-width="0.8"/>`);
for (const x of [-499, -473]) add(`<line x1="${x}" y1="-9" x2="${x}" y2="9" stroke="${C.bronze}" stroke-width="2"/>`);
{
  const L = D.lock;
  add(`<rect x="${L.x1}" y="${-44}" width="40" height="88" fill="#d9d1bf" stroke="${C.ceramicLine}" stroke-width="0.4"/>`);
  add(`<rect x="${L.x0}" y="${-L.passageHalf}" width="${L.x1 - L.x0}" height="${2 * L.passageHalf}" fill="#3b3c40"/>`);
  for (const s of [-1, 1]) add(`<rect x="${L.x0}" y="${s > 0 ? L.passageHalf : -L.outerHalf}" width="${L.x1 - L.x0}" height="${L.outerHalf - L.passageHalf}" fill="${C.ceramic}" stroke="${C.ceramicLine}" stroke-width="0.8"/>`);
  for (const x of [L.innerLip, L.outerLip]) add(`<line x1="${x}" y1="${-L.passageHalf}" x2="${x}" y2="${L.passageHalf}" stroke="${C.bronze}" stroke-width="2.6"/>`);
}

// ── Craft corridor ───────────────────────────────────────────────────────────────────────────
add(`<rect x="${CORRIDOR.x0}" y="${-CORRIDOR.half}" width="${CORRIDOR.x1 - CORRIDOR.x0}" height="${CORRIDOR.half * 2}" fill="#5f7d93" fill-opacity="0.07" stroke="${C.glass}" stroke-width="1.1" stroke-dasharray="8 5"/>`);
for (let x = 160; x < 450; x += 60) add(`<path d="M${x} -6 L${x + 12} 0 L${x} 6" fill="none" stroke="${C.glass}" stroke-width="1.4" transform="rotate(180 ${x + 6} 0)"/>`);

// ── Precincts: each block paved in its zone's stone (field/paving.ts), inside the compound ───
const ZONE_TINT = { craft: '#77777a', instruments: '#ebe8e0', power: '#d9bf98', cryo: '#b6c0cb', science: '#efe6d3', works: '#5c5853', heat: '#c99a80' };
add(`<clipPath id="compoundClip"><circle r="${D.compoundR}"/></clipPath>`);
add(`<g clip-path="url(#compoundClip)">`);
for (const p of D.precincts) {
  if (p.x1 < D.cordon.frontX) continue;
  const x0 = Math.max(p.x0, D.cordon.frontX + 6);
  add(`<rect x="${x0}" y="${p.z0}" width="${p.x1 - x0}" height="${p.z1 - p.z0}" fill="${ZONE_TINT[p.zone]}" fill-opacity="0.55" stroke="${C.bronze}" stroke-width="0.5"/>`);
}
add(`</g>`);

// ── Roads (basalt, bronze edges), the court, the landing pad, trenches ───────────────────────
add(`<rect x="${GATE_COURT.x0}" y="${GATE_COURT.z0}" width="${GATE_COURT.x1 - GATE_COURT.x0}" height="${GATE_COURT.z1 - GATE_COURT.z0}" fill="#efe9dc" stroke="${C.bronze}" stroke-width="0.8"/>`);
add(`<rect x="${GATEWAY.x0}" y="${GATEWAY.z}" width="${GATEWAY.x1 - GATEWAY.x0}" height="${GATE_COURT.z0 - GATEWAY.z}" fill="#efe9dc" stroke="${C.bronze}" stroke-width="0.6"/>`);
// The Stand in the court's north-west corner: its ramp, its stair, the deck, the terminal.
{
  const S = D.stand;
  add(`<polygon points="${pts(S.ramp)}" fill="#cfc8bb" stroke="${C.bronze}" stroke-width="0.5"/>`);
  add(`<polygon points="${pts(S.stair)}" fill="#cfc8bb" stroke="${C.bronze}" stroke-width="0.5"/>`);
  add(`<polygon points="${pts(S.outline)}" fill="#3a3632" stroke="${C.bronze}" stroke-width="0.8"/>`);
  add(`<circle cx="${S.terminal[0]}" cy="${S.terminal[1]}" r="1.2" fill="${C.bronze}"/>`);
}
add(`<g fill="${C.road}" stroke="${C.roadEdge}" stroke-width="0.9">`);
for (const s of D.roads) {
  const dx = s.b[0] - s.a[0];
  const dz = s.b[1] - s.a[1];
  const L = Math.hypot(dx, dz);
  add(`<polygon points="${pts(orientedRect((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, dx / L, dz / L, L, 2 * s.half))}"/>`);
}
add(`<circle r="${D.ringRoad.r1}"/>`);
add(`</g>`);
add(`<circle r="${D.ringRoad.r0}" fill="#ece6d8" stroke="${C.roadEdge}" stroke-width="0.9"/>`);
for (let r = D.pad.r + 11; r < D.ringRoad.r0; r += 11) add(`<circle r="${r}" fill="none" stroke="${C.padLine}" stroke-width="0.4"/>`);
add(`<line x1="${-D.ringRoad.r0}" y1="0" x2="${D.ringRoad.r0}" y2="0" stroke="${C.bronze}" stroke-width="0.9"/><line y1="${-D.ringRoad.r0}" y2="${D.ringRoad.r0}" x1="0" x2="0" stroke="${C.bronze}" stroke-width="0.9"/>`);
add(`<circle r="${D.pad.r}" fill="#2c2e33"/>`);
add(`<circle r="${D.pad.r - 3}" fill="none" stroke="${C.bronze}" stroke-width="1.2"/>`);
add(`<circle r="${D.pad.r - 14}" fill="none" stroke="${C.bronze}" stroke-width="0.6" stroke-dasharray="4 4"/>`);
add(`<circle r="3.4" fill="${C.pad}"/><circle r="3.0" fill="${C.bronze}"/>`);
add(`<g stroke="#5d5a52" stroke-width="1.1" fill="none" stroke-dasharray="1.5 1.5">`);
for (const t of D.trenches) add(`<line x1="${f(t.a[0])}" y1="${f(t.a[1])}" x2="${f(t.b[0])}" y2="${f(t.b[1])}"/>`);
add(`<circle r="${D.ringTrench}"/>`);
add(`</g>`);

// ── Viaducts: spines on Y-piers with the lines on their backs; valve pavilions under them ────
for (const l of D.racks) {
  const line = l.close ? [...l.pts, l.pts[0]] : l.pts;
  add(`<polyline points="${pts(line)}" fill="none" stroke="${C.ceramicLine}" stroke-width="4" stroke-linejoin="round"/>`);
  add(`<polyline points="${pts(line)}" fill="none" stroke="${C.ceramic}" stroke-width="3" stroke-linejoin="round"/>`);
  add(`<polyline points="${pts(line)}" fill="none" stroke="${C.gold}" stroke-width="1.4" stroke-linejoin="round"/>`);
}
for (const p of D.pavilions) add(`<circle cx="${f(p.x)}" cy="${f(p.z)}" r="4.6" fill="${C.goldLight}" stroke="${C.goldDark}" stroke-width="0.6"/>`);

// ── The secondary plant: halls, hangars, compressor houses, tank farms, switchyards, labs ────
for (const l of D.plant) {
  const fill = l.kind === 'tanks' || l.kind === 'spheres' ? C.goldLight : l.kind === 'switchyard' ? '#d8d2c4' : C.ceramic;
  if (l.kind === 'drum') add(`<circle cx="${f(l.x)}" cy="${f(l.z)}" r="${f(l.sx / 2 - 3.2)}" fill="${fill}" stroke="${C.ink}" stroke-width="0.6"/>`);
  else add(`<rect x="${f(l.x - l.sx / 2)}" y="${f(l.z - l.sz / 2)}" width="${f(l.sx)}" height="${f(l.sz)}" fill="${fill}" stroke="${C.ink}" stroke-width="0.6" ${l.kind === 'switchyard' ? 'stroke-dasharray="3 2"' : ''}/>`);
  checkClear('Secondary plant', l.x, l.z, Math.hypot(l.sx, l.sz) / 2, l.H);
}

// Service racks and feeders from the viaducts to the plant (plant/services.ts).
for (const line of D.services) add(`<polyline points="${pts(line)}" fill="none" stroke="${C.goldDark}" stroke-width="1.1" stroke-linejoin="round"/>`);

// ── The Cordon: the wall-gallery's runs, its gate bridges and pylons, the portal ─────────────
{
  const R = D.cordon.r;
  for (const r of D.cordon.plan.runs) {
    const w = 2 * 5.6;
    const stroke = r.bridge ? C.ceramicLine : C.ceramic;
    if (r.arc) {
      const [a0, a1] = r.arc;
      const p0 = polar(R, a0);
      const p1 = polar(R, a1);
      add(`<path d="M${f(p0[0])} ${f(p0[1])} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f(p1[0])} ${f(p1[1])}" fill="none" stroke="${C.ceramicLine}" stroke-width="${w + 1}"/>`);
      add(`<path d="M${f(p0[0])} ${f(p0[1])} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f(p1[0])} ${f(p1[1])}" fill="none" stroke="${stroke}" stroke-width="${w - 0.6}"/>`);
    } else {
      const [p0, p1] = r.line;
      add(`<line x1="${f(p0[0])}" y1="${f(p0[1])}" x2="${f(p1[0])}" y2="${f(p1[1])}" stroke="${C.ceramicLine}" stroke-width="${w + 1}"/><line x1="${f(p0[0])}" y1="${f(p0[1])}" x2="${f(p1[0])}" y2="${f(p1[1])}" stroke="${stroke}" stroke-width="${w - 0.6}"/>`);
    }
  }
  for (const p of D.cordon.plan.pylons) {
    add(`<polygon points="${pts(orientedRect(p.x, p.z, p.ox, p.oz, 2 * p.hr, 2 * p.ht))}" fill="${C.ceramic}" stroke="${C.ink}" stroke-width="0.8"/>`);
    add(`<circle cx="${f(p.x)}" cy="${f(p.z)}" r="${f(Math.min(p.hr, p.ht) * 0.45)}" fill="url(#goldSphere)" stroke="${C.goldDark}" stroke-width="0.5"/>`);
    checkClear('Cordon pylons', p.x, p.z, Math.hypot(p.hr, p.ht), p.height + p.crown);
  }
  const ps = D.cordon.plan.pylons[D.cordon.plan.portal.south];
  const pn = D.cordon.plan.pylons[D.cordon.plan.portal.north];
  add(`<line x1="${f(ps.x)}" y1="${f(ps.z - ps.ht)}" x2="${f(pn.x)}" y2="${f(pn.z + pn.ht)}" stroke="${C.gold}" stroke-width="3.2"/>`);
  // The perimeter road inside it.
  const rc = (D.perimeter.r0 + D.perimeter.r1) / 2;
  const q0 = polar(rc, D.perimeter.a0);
  const q1 = polar(rc, D.perimeter.a1);
  add(`<path d="M${f(q0[0])} ${f(q0[1])} A${rc} ${rc} 0 1 1 ${f(q1[0])} ${f(q1[1])}" fill="none" stroke="${C.roadEdge}" stroke-width="${D.perimeter.r1 - D.perimeter.r0 + 1.2}"/>`);
  add(`<path d="M${f(q0[0])} ${f(q0[1])} A${rc} ${rc} 0 1 1 ${f(q1[0])} ${f(q1[1])}" fill="none" stroke="${C.road}" stroke-width="${D.perimeter.r1 - D.perimeter.r0 - 0.6}"/>`);
}

// ── The Halo: the ring main on sculpted arches over the ring road ────────────────────────────
for (const a of D.halo.arches) {
  const [x, z] = polar(HALO_R, a);
  add(`<polygon points="${pts(orientedRect(x, z, Math.cos(a), Math.sin(a), 2 * D.halo.archHalf + 3, 2.2))}" fill="${C.ceramic}" stroke="${C.ceramicLine}" stroke-width="0.5"/>`);
}
add(`<circle r="${HALO_R}" fill="none" stroke="${C.goldDark}" stroke-width="12.4"/>`);
add(`<circle r="${HALO_R}" fill="none" stroke="${C.gold}" stroke-width="10.8"/>`);
add(`<circle r="${HALO_R - 4}" fill="none" stroke="${C.goldLight}" stroke-width="1.2"/>`);
checkClear('Halo', HALO_R + 6, 0, 0, 20);

// ── The Estate (as built: src/estate/, via planData) ─────────────────────────────────────────
{
  const E = D.estatePlan;
  const loopPath = (loops) => loops.map((l) => `M${l.map(([x, z]) => `${f(x)} ${f(z)}`).join(' L')} Z`).join(' ');
  // Retaining wall and balustrade: the terrace's outer face, the wall's thickness inside it.
  add(`<polygon points="${pts(E.terrace)}" fill="${C.wall}" stroke="#a89c84" stroke-width="1.2" stroke-linejoin="round"/>`);
  const FILL = { lawn: 'url(#lawnStripes)', meadow: '#b3bf86', gravel: C.gravel, ramp: C.gravel, flag: '#e3dccb', brick: '#a8644a', soil: '#8a6f4e', water: C.water };
  for (const [cls, fill] of Object.entries(FILL)) {
    for (const loops of E.regions[cls] ?? []) add(`<path d="${loopPath(loops)}" fill="${fill}" fill-rule="evenodd" stroke="${cls === 'lawn' || cls === 'meadow' ? 'none' : '#00000022'}" stroke-width="0.25"/>`);
  }
  // Hedges: yew dark, box lighter.
  for (const h of E.hedges) {
    const tag = h.closed ? 'polygon' : 'polyline';
    add(`<${tag} points="${pts(h.path)}" fill="none" stroke="${h.kind === 'yew' ? '#3f5a2c' : '#55703b'}" stroke-width="${f(h.width)}" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  add(`<polygon points="${pts(E.pool)}" fill="${C.water}" stroke="#d9d2c0" stroke-width="0.6"/>`);
  // Kitchen garden walls (brick), the glasshouse, the carriage house.
  const K = E.kitchen;
  add(`<rect x="${K.x0}" y="${K.z0}" width="${K.x1 - K.x0}" height="${K.z1 - K.z0}" fill="none" stroke="#9a5340" stroke-width="${K.wall * 2}"/>`);
  const G = E.glasshouse;
  add(`<rect x="${G.x0}" y="${G.z0}" width="${G.x1 - G.x0}" height="${G.z1 - G.z0}" fill="#d7e5ea" stroke="#7d97a3" stroke-width="0.4"/>`);
  for (let x = G.x0 + 1; x < G.x1; x += 1) add(`<line x1="${f(x)}" y1="${G.z0}" x2="${f(x)}" y2="${G.z1}" stroke="#7d97a3" stroke-width="0.12"/>`);
  const CH = E.carriage;
  add(`<rect x="${CH.x - CH.hx}" y="${CH.z - CH.hz}" width="${2 * CH.hx}" height="${2 * CH.hz}" fill="${C.slate}" stroke="${C.ink}" stroke-width="0.4"/>`);
  add(`<line x1="${CH.x - CH.hx}" y1="${CH.z}" x2="${CH.x + CH.hx}" y2="${CH.z}" stroke="#8a909a" stroke-width="0.4"/>`);
  // The house: foundation in slate, porches and steps in the porch's colour.
  E.house.forEach((p, i) => add(`<polygon points="${pts(p)}" fill="${i === 0 ? C.slate : C.porch}" stroke="${C.ink}" stroke-width="0.35"/>`));
  checkClear('House', E.houseCentre[0], E.houseCentre[1], 16, 17);
  // Trees and topiary, crowns with a soft shadow.
  for (const t of E.trees) {
    const fill = t.species === 'copperBeech' ? '#7a4a44' : t.species === 'cedar' ? '#4f6848' : C.tree;
    add(`<circle cx="${f(t.x + 0.8)}" cy="${f(t.z + 1)}" r="${f(t.r)}" fill="#000" fill-opacity="0.12"/>`);
    add(`<circle cx="${f(t.x)}" cy="${f(t.z)}" r="${f(t.r)}" fill="${fill}" fill-opacity="0.92" stroke="${C.treeDark}" stroke-width="0.4"/>`);
    checkClear(`Tree (${t.species})`, t.x, t.z, t.r, t.top);
  }
  for (const t of E.topiary) add(`<circle cx="${f(t.x)}" cy="${f(t.z)}" r="0.55" fill="#2f4722"/>`);
}

// ── The Cold Hold: foil-wrapped spheres of power-law sizes on columns ────────────────────────
for (const t of HOLD.tanks) {
  add(`<circle cx="${f(t.x + 1.5)}" cy="${f(t.z + 1.8)}" r="${f(t.R)}" fill="#000" fill-opacity="0.14"/>`);
  add(`<circle cx="${f(t.x)}" cy="${f(t.z)}" r="${f(t.R)}" fill="url(#goldSphere)" stroke="${C.goldDark}" stroke-width="0.6"/>`);
  checkClear('Cold Hold', t.x, t.z, t.R, t.top);
}

// ── The Gyre ─────────────────────────────────────────────────────────────────────────────────
{
  const { x, z } = GYRE;
  add(`<rect x="${x - GYRE.plinth.hx}" y="${z - GYRE.plinth.hz}" width="${2 * GYRE.plinth.hx}" height="${2 * GYRE.plinth.hz}" rx="9" fill="${C.ceramic}" stroke="${C.ceramicLine}" stroke-width="0.8"/>`);
  for (const s of [-1, 1]) add(`<rect x="${x - 6.5}" y="${f(z + (s > 0 ? GYRE.towerIn : -GYRE.towerOut))}" width="13" height="${GYRE.towerOut - GYRE.towerIn}" fill="${C.ceramic}" stroke="${C.ink}" stroke-width="0.8"/>`);
  add(`<line x1="${x}" y1="${z - 60}" x2="${x}" y2="${z + 60}" stroke="${C.ink}" stroke-width="0.6" stroke-dasharray="10 3 2 3"/>`);
  add(`<rect x="${x - 1.3}" y="${z - 45}" width="2.6" height="90" fill="url(#goldBar)" stroke="${C.goldDark}" stroke-width="0.6"/>`);
  add(`<ellipse cx="${x}" cy="${z}" rx="${36.5 * 0.74}" ry="${36.5 * 0.36}" transform="rotate(-32 ${x} ${z})" fill="none" stroke="${C.gold}" stroke-width="3"/>`);
  add(`<circle cx="${x}" cy="${z}" r="17" fill="url(#goldSphere)" stroke="${C.goldDark}" stroke-width="0.7"/>`);
  checkClear('Gyre', x, z, 46, GYRE.top);
}

// ── The Resonator ────────────────────────────────────────────────────────────────────────────
{
  const { x, z, pylonOff } = RESONATOR;
  const [tx, , tz] = RESONATOR.T;
  const [nx, , nz] = RESONATOR.N;
  add(`<polygon points="${pts(orientedRect(x, z, tx, tz, 2 * (pylonOff + RESONATOR.pylonHalf + 5), 46))}" fill="${C.ceramic}" stroke="${C.ceramicLine}" stroke-width="0.8"/>`);
  for (const s of [-1, 1]) add(`<polygon points="${pts(orientedRect(x + tx * pylonOff * s, z + tz * pylonOff * s, tx, tz, 16, 16))}" fill="${C.ceramic}" stroke="${C.ink}" stroke-width="0.8"/>`);
  add(`<polygon points="${pts(orientedRect(x, z, tx, tz, 2 * (pylonOff + 8), 8.4))}" fill="none" stroke="${C.ink}" stroke-width="0.7" stroke-dasharray="6 3"/>`);
  add(`<polygon points="${pts(orientedRect(x, z, tx, tz, 2 * RESONATOR.ringR + 7, 7))}" fill="url(#goldBar)" stroke="${C.goldDark}" stroke-width="0.8"/>`);
  add(`<line x1="${f(x)}" y1="${f(z)}" x2="${f(x + nx * 40)}" y2="${f(z + nz * 40)}" stroke="${C.inkSoft}" stroke-width="0.5" stroke-dasharray="2 2"/>`);
  checkClear('Resonator', x, z, pylonOff + 8, RESONATOR.top);
}

// ── The Loom ─────────────────────────────────────────────────────────────────────────────────
{
  const { x0, x1, zA, zB, spool } = LOOM;
  for (const zr of [zA, zB]) add(`<rect x="${x0}" y="${zr - 1.6}" width="${x1 - x0}" height="3.2" fill="${C.ceramic}" stroke="${C.ink}" stroke-width="0.6"/>`);
  const cx = LOOM.carriageX;
  add(`<ellipse cx="${f(cx)}" cy="${(zA + zB) / 2}" rx="${LOOM.carriageLen / 2}" ry="16.8" fill="url(#goldSphere)" stroke="${C.goldDark}" stroke-width="0.8"/>`);
  add(`<rect x="${f(cx + LOOM.carriageLen / 2)}" y="${(zA + zB) / 2 - 4}" width="${f(spool.x - cx - LOOM.carriageLen / 2)}" height="8" fill="#5a4a3a" stroke="${C.glow}" stroke-width="0.6"/>`);
  add(`<rect x="${spool.x - spool.d / 2}" y="${spool.z0}" width="${spool.d}" height="${spool.z1 - spool.z0}" fill="url(#goldBar)" stroke="${C.goldDark}" stroke-width="0.8"/>`);
  checkClear('Loom', x1, zB, 0, LOOM.carriageTop);
  checkClear('Loom spool', spool.x + spool.d / 2, spool.z1, 0, spool.centreY + spool.d / 2);
}

// ── The Mast: a ringed spire on three buttress fins ──────────────────────────────────────────
{
  const { x, z } = MAST;
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
    add(`<line x1="${x}" y1="${z}" x2="${f(x + Math.cos(a) * MAST.legR)}" y2="${f(z + Math.sin(a) * MAST.legR)}" stroke="${C.ceramicLine}" stroke-width="2.4" stroke-linecap="round"/>`);
  }
  add(`<circle cx="${x}" cy="${z}" r="8.2" fill="none" stroke="${C.ceramicLine}" stroke-width="0.9"/>`);
  add(`<circle cx="${x}" cy="${z}" r="3.4" fill="url(#goldSphere)" stroke="${C.goldDark}" stroke-width="0.7"/>`);
  checkClear('Mast', x, z, 8, MAST.top * 1.06);
}

// ── The radiator forest and the tower clusters ───────────────────────────────────────────────
for (const s of D.radiators) {
  add(`<circle cx="${f(s.x)}" cy="${f(s.z)}" r="${f(s.ring)}" fill="none" stroke="${C.goldDark}" stroke-width="0.5" stroke-dasharray="2 1.5"/>`);
  add(`<circle cx="${f(s.x)}" cy="${f(s.z)}" r="${f(s.r * 1.2)}" fill="url(#goldSphere)" stroke="${C.goldDark}" stroke-width="0.4"/>`);
  checkClear('Radiator spires', s.x, s.z, s.ring, s.top);
}
for (const c of D.clusters) {
  add(`<circle cx="${c.x}" cy="${c.z}" r="${c.podiumR}" fill="${C.ceramic}" stroke="${C.ceramicLine}" stroke-width="0.8"/>`);
  for (const r of c.rings) add(`<circle cx="${c.x}" cy="${c.z}" r="${r.R}" fill="none" stroke="${C.goldDark}" stroke-width="0.9" stroke-dasharray="5 3"/>`);
  for (const t of c.towers) {
    add(`<circle cx="${f(t.x)}" cy="${f(t.z)}" r="${f(t.r0 * 1.15)}" fill="url(#goldSphere)" stroke="${C.goldDark}" stroke-width="0.7"/>`);
    add(`<circle cx="${f(t.x + t.lean[0])}" cy="${f(t.z + t.lean[1])}" r="1.2" fill="${C.ink}"/>`);
    checkClear(c.name[0].toUpperCase() + c.name.slice(1), t.x + t.lean[0], t.z + t.lean[1], 3, t.top);
  }
}

// ── Dome frame overhead (dashed, drawn over everything inside) ───────────────────────────────
add(`<g fill="none" stroke="${C.frame}" stroke-opacity="0.75">`);
add(`<circle r="${EAVE_R}" stroke-width="1.6" stroke-dasharray="14 6"/>`);
for (const v of RIBS) {
  const e = Math.sqrt(EAVE_R ** 2 - v * v);
  for (const s of [-1, 1]) {
    add(`<line x1="${v * s}" y1="${BAND_HALF}" x2="${v * s}" y2="${f(e)}" stroke-width="1" stroke-dasharray="10 6"/><line x1="${v * s}" y1="-${BAND_HALF}" x2="${v * s}" y2="-${f(e)}" stroke-width="1" stroke-dasharray="10 6"/>`);
    add(`<line y1="${v * s}" x1="${BAND_HALF}" y2="${v * s}" x2="${f(e)}" stroke-width="1" stroke-dasharray="10 6"/><line y1="${v * s}" x1="-${BAND_HALF}" y2="${v * s}" x2="-${f(e)}" stroke-width="1" stroke-dasharray="10 6"/>`);
  }
}
for (const s of [-1, 1]) {
  add(`<line x1="-${GLASS_A}" x2="${GLASS_A}" y1="${BAND_HALF * s}" y2="${BAND_HALF * s}" stroke-width="1.8" stroke-dasharray="16 6"/>`);
  add(`<line y1="-${GLASS_A}" y2="${GLASS_A}" x1="${BAND_HALF * s}" x2="${BAND_HALF * s}" stroke-width="1.8" stroke-dasharray="16 6"/>`);
}
add(`</g>`);
// Drum posts at the 24 eave nodes, outside the glass.
{
  const angles = [];
  for (const v of RIBS) {
    const e = Math.sqrt(EAVE_R ** 2 - v * v);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      angles.push(Math.atan2(sz * e, sx * v));
      angles.push(Math.atan2(sz * v, sx * e));
    }
  }
  const uniq = [];
  for (const a of angles) if (!uniq.some((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-3)) uniq.push(a);
  for (const a of uniq) {
    const [x, z] = polar(502, a);
    add(`<polygon points="${pts(orientedRect(x, z, Math.cos(a), Math.sin(a), 5, 4))}" fill="${C.ceramic}" stroke="${C.ceramicLine}" stroke-width="0.6"/>`);
  }
}

// ── Viewpoints (city_plan.md §8; src/debug/viewpoints.ts) ────────────────────────────────────
const viewpoint = (n, x, z, dirDeg, spread = 50, len = 46) => {
  const a = (dirDeg * Math.PI) / 180;
  const h = (spread * Math.PI) / 360;
  add(`<path d="M${f(x)} ${f(z)} L${f(x + Math.cos(a - h) * len)} ${f(z + Math.sin(a - h) * len)} A${len} ${len} 0 0 1 ${f(x + Math.cos(a + h) * len)} ${f(z + Math.sin(a + h) * len)} Z" fill="#c2452d" fill-opacity="0.18" stroke="#c2452d" stroke-width="0.6"/>`);
  add(`<circle cx="${f(x)}" cy="${f(z)}" r="5.6" fill="#c2452d" stroke="#fff" stroke-width="1.2"/>`);
  text(x, z + 2.9, n, 'vp', 'text-anchor="middle"');
};
{
  // Plan direction (deg, atan2(z, x)) toward a point.
  const toward = (x, z, tx, tz) => (Math.atan2(tz - z, tx - x) * 180) / Math.PI;
  viewpoint('1', -462, 0, 0, 56, 60);
  viewpoint('2', -357, -100, toward(-357, -100, 0, 0), 70);
  viewpoint('3', -362, -96, toward(-362, -96, 0, 0) + 10, 110, 52);
  viewpoint('4', -450, -113, 180, 60, 34);
  viewpoint('5', -192, 214, toward(-192, 214, RESONATOR.x, RESONATOR.z), 60);
  viewpoint('6', 100, -28, 0, 44, 60);
  viewpoint('7', 0, 150, 90, 50, 46);
}

// ── Labels ───────────────────────────────────────────────────────────────────────────────────
const leader = (x0, z0, x1, z1) => add(`<line x1="${f(x0)}" y1="${f(z0)}" x2="${f(x1)}" y2="${f(z1)}" stroke="${C.ink}" stroke-width="0.6"/>`);
const heroLabel = (x, z, name, sub, anchor = 'start') => {
  text(x, z, name, 'hero', `text-anchor="${anchor}"`);
  text(x, z + 14, sub, 'sub', `text-anchor="${anchor}"`);
};
const tallest = (c) => Math.max(...c.towers.map((t) => t.top));
const cl = Object.fromEntries(D.clusters.map((c) => [c.name, c]));
heroLabel(GYRE.x + 50, GYRE.z - 78, 'THE GYRE', `inertial reference · rings Ø88 m · top ${Math.round(GYRE.top)} m`, 'start');
heroLabel(RESONATOR.x - 30, RESONATOR.z + 72, 'THE RESONATOR', 'ring Ø100 m, hung free · frame 130 m', 'middle');
heroLabel(171, LOOM.zA - 30, 'THE LOOM', 'gantry 320 m · 35 m to the rails · spool Ø45 m', 'middle');
heroLabel(HOLD.x, -40, 'THE COLD HOLD', `${HOLD.tanks.length} foil spheres, Ø${HOLD.dMin}–${HOLD.dMax} m`, 'middle');
heroLabel(MAST.x + 24, MAST.z - 34, 'THE MAST', `approach control · ${MAST.top} m spire`);
heroLabel(cl.stills.x, cl.stills.z - cl.stills.podiumR - 22, 'THE STILLS', `cryogen distillation · ${cl.stills.towers.length} towers, top ${Math.round(tallest(cl.stills))} m`, 'middle');
heroLabel(cl.converter.x, cl.converter.z + cl.converter.podiumR + 18, 'THE CONVERTER', `power · ${cl.converter.towers.length} towers, top ${Math.round(tallest(cl.converter))} m`, 'middle');
heroLabel(cl.reckoner.x - 70, cl.reckoner.z + cl.reckoner.podiumR + 20, 'THE RECKONER', `computation · ${cl.reckoner.towers.length} towers, top ${Math.round(tallest(cl.reckoner))} m`, 'middle');
heroLabel(0, -150, 'THE HALO', 'ring main Ø220 m on arches over the ring road', 'middle');
leader(0, -134, 0, -HALO_R - 6);
text(0, -458, 'THE CORDON · arcaded wall-gallery round the compound', 'sub', 'text-anchor="middle"');
text(0, 62, 'PAD', 'zone', 'text-anchor="middle"');
text(0, 75, 'Ø90 m · on the datum', 'sub', 'text-anchor="middle"');
text(330, 46, 'CRAFT CORRIDOR · kept clear above 20 m', 'sub', 'text-anchor="middle"');
heroLabel(310, 262, 'RADIATOR FOREST', `${D.radiators.length} heat-rejection spires`, 'middle');
text(-380, -214, 'THE ESTATE', 'zone', `text-anchor="middle"`);
text(-380, -200, 'raised soil terrace · ~170 × 130 m', 'sub', `text-anchor="middle"`);
text(-300, -58, 'house · faces the field', 'small', 'text-anchor="start"');
leader(-302, -61, -362, -104);
text(-440, 48, 'GATE COURT', 'zone', 'text-anchor="middle"');
text(-270, 30, 'AXIS ROAD · 20 m', 'sub', 'text-anchor="middle"');
text(-560, 36, 'WEST GATE', 'deckLbl', 'text-anchor="middle"');
text(-560, 50, 'people', 'deckLbl', 'text-anchor="middle" style="font-size:9px"');
text(560, 70, 'EAST LOCK', 'deckLbl', 'text-anchor="middle"');
text(560, 84, `craft · ${2 * D.lock.passageHalf} m clear`, 'deckLbl', 'text-anchor="middle"');
text(0, -540, 'NORTH COLLAR', 'deckLbl', 'text-anchor="middle"');
text(0, 553, 'SOUTH COLLAR', 'deckLbl', 'text-anchor="middle"');
text(-380, 470, 'THE GIRDLE DECK', 'deckLbl', 'text-anchor="middle" transform="rotate(-38 -380 470)"');

// ── Right column: title, north, scale, legend, views ─────────────────────────────────────────
{
  const X = 640;
  text(X, -560, 'DYSON CITY', 'title');
  text(X, -528, 'SITE PLAN · PLATFORM LEVEL', 'h2');
  text(X, -510, 'North up · metres · one drawing unit = 1 m', 'sub');
  // North arrow.
  add(`<g transform="translate(${X + 330} -540)"><circle r="20" fill="none" stroke="${C.ink}" stroke-width="0.8"/><path d="M0 -17 L7 9 L0 4 L-7 9 Z" fill="${C.ink}"/><text y="-25" class="lbl" text-anchor="middle" style="font-weight:600">N</text></g>`);
  // Scale bar.
  const sy = -470;
  for (let i = 0; i < 4; i++) add(`<rect x="${X + i * 50}" y="${sy}" width="50" height="6" fill="${i % 2 ? C.paper : C.ink}" stroke="${C.ink}" stroke-width="0.8"/>`);
  for (const v of [0, 50, 100, 200]) text(X + v, sy + 20, `${v}`, 'small', 'text-anchor="middle"');
  text(X + 210, sy + 6, 'm', 'small');
  // Legend.
  let ly = -410;
  text(X, ly, 'LEGEND', 'h2');
  ly += 22;
  const sw = (draw, label) => {
    add(draw(X, ly));
    text(X + 34, ly + 4, label, 'lbl');
    ly += 22;
  };
  sw((x, y) => `<rect x="${x}" y="${y - 7}" width="24" height="14" fill="${C.pad}" stroke="${C.padLine}"/>`, 'Limestone platform (the field’s floor)');
  sw((x, y) => `<rect x="${x}" y="${y - 7}" width="24" height="14" fill="${C.road}" stroke="${C.roadEdge}"/>`, 'Basalt road, bronze edges');
  sw((x, y) => `<g><rect x="${x}" y="${y - 7}" width="8" height="14" fill="${ZONE_TINT.cryo}"/><rect x="${x + 8}" y="${y - 7}" width="8" height="14" fill="${ZONE_TINT.power}"/><rect x="${x + 16}" y="${y - 7}" width="8" height="14" fill="${ZONE_TINT.heat}"/></g>`, 'Precinct paving: each zone its own stone');
  sw((x, y) => `<rect x="${x}" y="${y - 7}" width="24" height="14" fill="${C.ceramic}" stroke="${C.ink}" stroke-width="0.6"/>`, 'Secondary plant: halls, hangars, labs, compressors');
  sw((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 24}" y2="${y}" stroke="${C.ceramicLine}" stroke-width="10"/>`, 'The Cordon: arcaded wall-gallery, 13.7 m, pylons at its gates');
  sw((x, y) => `<rect x="${x}" y="${y - 7}" width="24" height="14" fill="${C.lawn}" stroke="#a89c84" stroke-width="2.5"/>`, 'Estate terrace (soil, lawn, planting)');
  sw((x, y) => `<rect x="${x}" y="${y - 7}" width="24" height="14" fill="url(#goldBar)" stroke="${C.goldDark}"/>`, 'Gold structure');
  sw((x, y) => `<rect x="${x}" y="${y - 7}" width="24" height="14" fill="${C.ceramic}" stroke="${C.ink}"/>`, 'White ceramic structure');
  sw((x, y) => `<g stroke="${C.goldDark}" stroke-width="0.8"><line x1="${x}" y1="${y - 1.5}" x2="${x + 24}" y2="${y - 1.5}"/><line x1="${x}" y1="${y + 1.5}" x2="${x + 24}" y2="${y + 1.5}"/><line x1="${x + 6}" y1="${y - 1.5}" x2="${x + 6}" y2="${y + 1.5}"/><line x1="${x + 13}" y1="${y - 1.5}" x2="${x + 13}" y2="${y + 1.5}"/><line x1="${x + 20}" y1="${y - 1.5}" x2="${x + 20}" y2="${y + 1.5}"/></g>`, 'Viaduct (lines on a spine, Y-piers)');
  sw((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 24}" y2="${y}" stroke="${C.frame}" stroke-width="1.8" stroke-dasharray="7 3"/>`, 'Dome frame overhead (bands, ribs, Eave Ring)');
  sw((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 24}" y2="${y}" stroke="${C.glass}" stroke-width="2.2"/>`, 'Dome glass at the sill');
  sw((x, y) => `<rect x="${x}" y="${y - 7}" width="24" height="14" fill="#5f7d93" fill-opacity="0.1" stroke="${C.glass}" stroke-dasharray="4 2"/>`, 'Craft corridor');
  sw((x, y) => `<rect x="${x}" y="${y - 7}" width="24" height="14" fill="${C.bronze}"/>`, 'Bronze inlay: survey axes, boundary ring');
  sw((x, y) => `<g><circle cx="${x + 12}" cy="${y}" r="7" fill="#c2452d" stroke="#fff" stroke-width="1.2"/></g>`, 'Viewpoint (city_plan.md §8)');
  ly += 14;
  text(X, ly, 'VIEWPOINTS', 'h2');
  ly += 22;
  for (const line of [
    '1  The inner gate opens: road into the gold, house on the left',
    '2  The porch, looking over the lawn to the field',
    '3  The turret room: the whole compound below',
    '4  The back garden bench, facing the glass and the deck',
    '5  Under the Resonator, the house in its torus',
    '6  A craft arriving along the corridor',
    '7  Driving south under the Halo toward the Loom',
  ]) {
    text(X, ly, line, 'lbl');
    ly += 19;
  }
  ly += 18;
  text(X, ly, 'HEIGHT TO THE GLASS', 'h2');
  ly += 8;
  text(X, ly + 14, 'Least clearance at each structure’s outer reach:', 'sub');
  ly += 34;
  const groups = new Map();
  for (const c of clearances) {
    const g = groups.get(c.name);
    if (!g || c.clear < g.clear) groups.set(c.name, c);
  }
  for (const c of groups.values()) {
    text(X, ly, c.name, 'lbl');
    text(X + 200, ly, `${c.top} m`, 'lbl', 'text-anchor="end"');
    text(X + 290, ly, `${c.clear} m clear`, 'lbl', 'text-anchor="end"');
    ly += 18;
  }
}

// ── Section: west–east, projected ────────────────────────────────────────────────────────────
{
  const G = 1000;
  const Y = (h) => G - h;
  const S0 = 700;
  text(-600, S0, 'SECTION · WEST–EAST, LOOKING NORTH · structures projected onto the Spinward axis', 'h2');
  text(-600, S0 + 16, 'Same scale as the plan. The Dome’s glass (S) and the 30 m clearance line inside it.', 'sub');
  const prof = [];
  const clr = [];
  for (let i = 0; i <= 200; i++) {
    const t = Math.PI - (i / 200) * Math.PI;
    const x = GLASS_A * Math.cos(t);
    const h = GLASS_C * Math.sin(t);
    prof.push([x, Y(h)]);
    const nx = Math.cos(t) / GLASS_A;
    const nh = Math.sin(t) / GLASS_C;
    const nl = Math.hypot(nx, nh);
    clr.push([x - (nx / nl) * 30, Y(h - (nh / nl) * 30)]);
  }
  add(`<rect x="-560" y="${G}" width="1140" height="14" fill="${C.deck}"/>`);
  add(`<rect x="-502.4" y="${G - 1.2}" width="1004.8" height="2.4" fill="#cfc7b6"/>`);
  add(`<polyline points="${pts(clr.filter(([, y]) => y <= G))}" fill="none" stroke="#c2452d" stroke-width="0.8" stroke-dasharray="5 4"/>`);
  add(`<polyline points="${pts(prof)}" fill="none" stroke="${C.glass}" stroke-width="2.4"/>`);
  text(0, Y(258), 'crown 251 m', 'small', 'text-anchor="middle"');
  const box = (x0, x1, h0, h1, fill, stroke = C.ink) => add(`<rect x="${f(x0)}" y="${f(Y(h1))}" width="${f(x1 - x0)}" height="${f(h1 - h0)}" fill="${fill}" stroke="${stroke}" stroke-width="0.7"/>`);
  box(-518, -470, 0, 31, C.ceramic);
  box(D.lock.x0, D.lock.x1, 0, D.lock.top, C.ceramic);
  text(-494, Y(38), 'gate 31 m', 'small', 'text-anchor="middle"');
  text((D.lock.x0 + D.lock.x1) / 2, Y(D.lock.top + 7), `East Lock ${Math.round(D.lock.top)} m`, 'small', 'text-anchor="middle"');
  // The towers: tapering needles at their projected x.
  const towerShape = (x, r0, top, lean) => add(`<polygon points="${pts([[x - r0 * 1.2, G], [x - r0 * 0.9, Y(top * 0.2)], [x + lean * 0.8 - r0 * 0.25, Y(top * 0.85)], [x + lean, Y(top)], [x + lean * 0.8 + r0 * 0.25, Y(top * 0.85)], [x + r0 * 0.9, Y(top * 0.2)], [x + r0 * 1.2, G]])}" fill="url(#goldBar)" stroke="${C.goldDark}" stroke-width="0.6"/>`);
  for (const c of D.clusters) {
    for (const t of [...c.towers].sort((p, q) => p.top - q.top)) towerShape(t.x, t.r0, t.top, t.lean[0]);
    for (const r of c.rings) add(`<line x1="${f(c.x - r.R)}" y1="${f(Y(r.h + 2.4))}" x2="${f(c.x + r.R)}" y2="${f(Y(r.h + 2.4))}" stroke="${C.ceramicLine}" stroke-width="1.6"/>`);
    text(c.x, Y(Math.max(...c.towers.map((t) => t.top)) + 8), `${c.name[0].toUpperCase() + c.name.slice(1)} ${Math.round(Math.max(...c.towers.map((t) => t.top)))} m`, 'small', 'text-anchor="middle"');
  }
  for (const s of D.radiators) towerShape(s.x, s.r, s.top, 0);
  // The Resonator, the Gyre, the Mast, the Loom, the Hold, the Halo.
  {
    const [tx] = RESONATOR.T;
    for (const s of [-1, 1]) box(RESONATOR.x + s * tx * RESONATOR.pylonOff - 7, RESONATOR.x + s * tx * RESONATOR.pylonOff + 7, 0, RESONATOR.top, C.ceramic);
    add(`<ellipse cx="${RESONATOR.x}" cy="${Y(RESONATOR.centreY)}" rx="${f(RESONATOR.ringR * Math.abs(tx))}" ry="${RESONATOR.ringR}" fill="none" stroke="${C.gold}" stroke-width="6"/>`);
    text(RESONATOR.x, Y(RESONATOR.top + 8), 'Resonator 130 m', 'small', 'text-anchor="middle"');
  }
  add(`<circle cx="${GYRE.x}" cy="${Y(GYRE.centreY)}" r="44" fill="none" stroke="${C.gold}" stroke-width="4"/>`);
  add(`<circle cx="${GYRE.x}" cy="${Y(GYRE.centreY)}" r="17" fill="url(#goldSphere)" stroke="${C.goldDark}" stroke-width="0.6"/>`);
  add(`<polygon points="${pts([[MAST.x - MAST.legR, G], [MAST.x - 3, Y(38)], [MAST.x - 0.8, Y(MAST.top)], [MAST.x + 0.8, Y(MAST.top)], [MAST.x + 3, Y(38)], [MAST.x + MAST.legR, G]])}" fill="url(#goldBar)" stroke="${C.goldDark}" stroke-width="0.6"/>`);
  text(MAST.x, Y(MAST.top + 9), `Mast ${MAST.top} m`, 'small', 'text-anchor="middle"');
  box(LOOM.x0, LOOM.x1, LOOM.railTop - 4, LOOM.railTop, C.ceramic);
  add(`<circle cx="${LOOM.spool.x}" cy="${Y(LOOM.spool.centreY)}" r="${LOOM.spool.d / 2}" fill="url(#goldSphere)" stroke="${C.goldDark}" stroke-width="0.7"/>`);
  for (const t of HOLD.tanks.filter((_, i) => i % 3 === 0)) add(`<circle cx="${f(t.x)}" cy="${f(Y(t.top - t.R))}" r="${f(t.R)}" fill="url(#goldSphere)" stroke="${C.goldDark}" stroke-width="0.6"/>`);
  for (const x of [-HALO_R, HALO_R]) add(`<path d="M${x - 12.4} ${G} Q${x} ${Y(26)} ${x + 12.4} ${G}" fill="none" stroke="${C.ceramicLine}" stroke-width="2.2"/>`);
  add(`<rect x="-45" y="${G - 1}" width="90" height="2" fill="#2c2e33"/>`);
  text(-600, G + 34, 'Projected heights; each structure’s clearance to the glass is checked at its own plan radius (table above), not at its projected position.', 'sub');
}

add(`</svg>`);
const browser = await chromium.launch({ executablePath: CHROME });
try {
  const page = await browser.newPage({ viewport: { width: 2550, height: 2550 } });
  await page.setContent(`<!doctype html><html><body style="margin:0">${out.join('\n')}</body></html>`);
  await page.locator('svg').screenshot({ path: OUT });
} finally {
  await browser.close();
}
for (const c of clearances) if (c.clear < 30) console.warn(`clearance below 30 m: ${c.name} at r ${c.r} m, top ${c.top} m, ${c.clear} m`);
console.log(`wrote ${OUT}`);
