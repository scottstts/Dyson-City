/**
 * Master-plan proposal sketch for the Field (zoning, boundaries, avenues, precincts), for review
 * before it is built. Writes tools/out/field/masterplan.png.
 *
 *   node tools/site-plan/proposal.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const OUT = 'tools/out/field/masterplan.png';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const f = (n) => (Math.round(n * 10) / 10).toString();
const out = [];
const add = (s) => out.push(s);
const text = (x, y, s, size = 12, weight = 400, fill = '#26272a', anchor = 'middle') => add(`<text x="${f(x)}" y="${f(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="1">${s}</text>`);

// Frame: x east, z south (down). Units: metres.
const GLASS = 499.75;
const CORDON = 440;
const AV = 10; // avenue half-width
const LANE = 5;
const RING = [100, 120];
const PALETTE = {
  craft: '#c9d6df',
  cryo: '#cfe0e8',
  power: '#ecd8b0',
  instruments: '#e9e2c8',
  works: '#dccbb8',
  science: '#e4dbe9',
  heat: '#ead0c4',
  estate: '#a9c088',
};

add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-560 -600 1620 1160" width="2430" height="1740" font-family="Avenir Next, Helvetica Neue, Arial, sans-serif">`);
add(`<rect x="-560" y="-600" width="1620" height="1160" fill="#f3f0e8"/>`);
add(`<defs><clipPath id="compound"><path d="M -405 ${-Math.sqrt(CORDON ** 2 - 405 ** 2)} A ${CORDON} ${CORDON} 0 1 1 -405 ${Math.sqrt(CORDON ** 2 - 405 ** 2)} Z"/></clipPath></defs>`);
add(`<circle r="560" fill="#34373c"/><circle r="${GLASS}" fill="#e6dfcf" stroke="#5f7d93" stroke-width="2.5"/>`);

// Precinct blocks (cells of the Dome's 96 m grid between avenues), coloured by zone.
const block = (x0, z0, x1, z1, zone) => add(`<rect x="${x0}" y="${z0}" width="${x1 - x0}" height="${z1 - z0}" fill="${PALETTE[zone]}" stroke="#8d8678" stroke-width="0.8" clip-path="url(#compound)"/>`);
const R = [12, 182, 202, 374, 394];
// NE
block(R[0], -R[1], R[1], -R[0], 'craft');
block(R[0], -R[4] - 40, R[1], -R[2], 'instruments');
block(R[2], -R[1], R[4] + 40, -32, 'power');
block(R[2], -R[4] - 40, R[4] + 40, -R[2], 'power');
// NW
block(-R[1], -R[1], -R[0], -R[0], 'cryo');
block(-R[1], -R[4] - 40, -R[0], -R[2], 'cryo');
block(-288, -R[1], -R[2], -R[0], 'cryo');
block(-420, -R[4] - 40, -R[2], -R[2], 'cryo');
// SW
block(-R[1], R[0], -R[0], R[1], 'science');
block(-R[1], R[2], -R[0], R[4] + 40, 'science');
block(-405, R[0], -R[2], R[1], 'science');
block(-405, R[2], -R[2], R[4] + 40, 'science');
// SE
block(R[0], 32, R[1], R[1], 'works');
block(R[2], 32, R[4] + 40, R[1], 'works');
block(R[0], R[2], R[1], R[4] + 40, 'heat');
block(R[2], R[2], R[4] + 40, R[4] + 40, 'works');
// The heat-rejection belt along the south cordon.
add(`<path d="M ${-300} ${Math.sqrt(CORDON ** 2 - 300 ** 2)} A ${CORDON} ${CORDON} 0 0 0 300 ${Math.sqrt(CORDON ** 2 - 300 ** 2)} L 300 330 L -300 330 Z" fill="${PALETTE.heat}" stroke="#8d8678" stroke-width="0.8"/>`);
// The estate.
add(`<path d="M -290 -40 L -290 -170 L ${-Math.sqrt(470 ** 2 - 170 ** 2)} -170 A 470 470 0 0 0 ${-Math.sqrt(470 ** 2 - 40 ** 2)} -40 Z" fill="${PALETTE.estate}" stroke="#6d7d55" stroke-width="2"/>`);
text(-380, -100, 'THE ESTATE', 13, 600, '#2f3a24');

// Avenues and lanes (basalt).
const road = (x0, z0, x1, z1, hw) => add(`<rect x="${Math.min(x0, x1) - (x0 === x1 ? hw : 0)}" y="${Math.min(z0, z1) - (z0 === z1 ? hw : 0)}" width="${x0 === x1 ? 2 * hw : Math.abs(x1 - x0)}" height="${z0 === z1 ? 2 * hw : Math.abs(z1 - z0)}" fill="#47484b" clip-path="url(#compound)"/>`);
road(-405, 0, -RING[1], 0, AV);
road(0, -CORDON, 0, -RING[1], AV);
road(0, RING[1], 0, CORDON, AV);
for (const s of [-1, 1]) {
  road(s * 192, -CORDON, s * 192, CORDON, AV);
  road(-CORDON, s * 192, CORDON, s * 192, AV);
}
for (const s of [-1, 1]) {
  road(s * 288, -CORDON, s * 288, CORDON, LANE);
  road(-CORDON, s * 288, CORDON, s * 288, LANE);
}
// The perimeter road inside the cordon.
add(`<circle r="${CORDON - 22}" fill="none" stroke="#47484b" stroke-width="18" clip-path="url(#compound)"/>`);
// Craft corridor (no road) and the core.
add(`<rect x="120" y="-30" width="350" height="60" fill="#5f7d93" fill-opacity="0.18" stroke="#5f7d93" stroke-dasharray="8 5"/>`);
add(`<circle r="${RING[1]}" fill="#47484b"/><circle r="${RING[0]}" fill="#ece6d8"/><circle r="45" fill="#2c2e33"/>`);
add(`<circle r="110" fill="none" stroke="#c9a043" stroke-width="7"/>`);

// Viaducts lining the avenues (both sides: the precincts' edges in the air).
add(`<g stroke="#c9a043" stroke-width="2.4" stroke-dasharray="14 4" clip-path="url(#compound)">`);
for (const s of [-1, 1]) {
  for (const o of [-14, 14]) {
    add(`<line x1="${s * 192 + o}" y1="${-CORDON}" x2="${s * 192 + o}" y2="${CORDON}"/>`);
    add(`<line x1="${-CORDON}" y1="${s * 192 + o}" x2="${CORDON}" y2="${s * 192 + o}"/>`);
  }
  add(`<line x1="${14 * s}" y1="${-CORDON}" x2="${14 * s}" y2="${-RING[1]}"/><line x1="${14 * s}" y1="${RING[1]}" x2="${14 * s}" y2="${CORDON}"/>`);
}
add(`<line x1="-405" y1="14" x2="${-RING[1]}" y2="14"/><line x1="-405" y1="-14" x2="${-RING[1]}" y2="-14"/>`);
add(`</g>`);

// The cordon: an arcaded wall-gallery round the compound, gate pylons where avenues pass.
const a0 = Math.atan2(-Math.sqrt(CORDON ** 2 - 405 ** 2), -405);
add(`<path d="M -405 ${-Math.sqrt(CORDON ** 2 - 405 ** 2)} A ${CORDON} ${CORDON} 0 1 1 -405 ${Math.sqrt(CORDON ** 2 - 405 ** 2)}" fill="none" stroke="#fbf9f3" stroke-width="9"/>`);
add(`<path d="M -405 ${-Math.sqrt(CORDON ** 2 - 405 ** 2)} A ${CORDON} ${CORDON} 0 1 1 -405 ${Math.sqrt(CORDON ** 2 - 405 ** 2)}" fill="none" stroke="#6b6a66" stroke-width="1" stroke-dasharray="3 3"/>`);
add(`<line x1="-405" y1="${-Math.sqrt(CORDON ** 2 - 405 ** 2)}" x2="-405" y2="-170" stroke="#fbf9f3" stroke-width="9"/>`);
add(`<line x1="-405" y1="16" x2="-405" y2="${Math.sqrt(CORDON ** 2 - 405 ** 2)}" stroke="#fbf9f3" stroke-width="9"/>`);
void a0;
const gate = (x, z, label) => {
  add(`<circle cx="${f(x)}" cy="${f(z)}" r="9" fill="#c9a043" stroke="#7d5f1c" stroke-width="1.2"/>`);
  if (label) text(x, z - 14, label, 10, 600);
};
gate(-405, 0, 'MAIN PORTAL');
gate(0, -CORDON + 2, 'NORTH GATE');
gate(0, CORDON - 2, 'SOUTH GATE');
for (const s of [-1, 1]) for (const t of [-1, 1]) {
  const z = Math.sqrt(CORDON ** 2 - 192 ** 2);
  gate(s * 192, t * z);
  gate(t * z, s * 192);
}

// Heroes and clusters (footprints) with secondary plant fill (hatched blocks).
const hero = (x, z, r, name, sub) => {
  add(`<circle cx="${x}" cy="${z}" r="${r}" fill="#c9a043" fill-opacity="0.85" stroke="#7d5f1c" stroke-width="1.2"/>`);
  text(x, z + 4, name, 12, 700);
  if (sub) text(x, z + 18, sub, 9, 400, '#3b3a36');
};
const fill = (x0, z0, x1, z1) => add(`<rect x="${x0}" y="${z0}" width="${x1 - x0}" height="${z1 - z0}" fill="url(#hatch)" stroke="#6b6a66" stroke-width="0.6"/>`);
add(`<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fbf9f3"/><line x1="0" y1="0" x2="0" y2="6" stroke="#8d8678" stroke-width="1.6"/></pattern></defs>`);
// NE: craft control (Mast) + hangars along the corridor; instruments (Gyre); power (Converter) + switchyards.
hero(150, -95, 22, 'MAST', 'approach control');
fill(30, -175, 120, -130);
fill(210, -78, 370, -36);
fill(210, 36, 370, 78);
hero(96, -288, 50, 'GYRE', 'instruments');
fill(30, -380, 170, -350);
hero(290, -120, 50, 'CONVERTER', 'power · 157 m');
fill(210, -330, 330, -215);
// NW: cryogen: Cold Hold tanks inner, Stills outer, compressor halls between estate and avenue, tank farm north of the estate.
hero(-96, -96, 62, 'COLD HOLD', 'tanks');
hero(-96, -288, 58, 'STILLS', 'distillation · 166 m');
fill(-282, -175, -210, -50);
fill(-400, -370, -215, -215);
// SW: science: Resonator inner, Reckoner outer, labs west.
hero(-96, 96, 60, 'RESONATOR', 'faces the house');
hero(-96, 288, 52, 'RECKONER', 'computation · 166 m');
fill(-395, 40, -215, 170);
fill(-395, 215, -215, 300);
// SE: works: the Loom across two blocks (its gantry bridges the avenue), stores and feed plant.
add(`<rect x="30" y="128" width="300" height="36" fill="#c9a043" fill-opacity="0.85" stroke="#7d5f1c" stroke-width="1.2"/>`);
add(`<circle cx="352" cy="146" r="22" fill="#c9a043" stroke="#7d5f1c" stroke-width="1.2"/>`);
text(180, 150, 'THE LOOM · gantry bridges the avenue', 11, 700);
fill(30, 50, 170, 110);
fill(215, 50, 370, 110);
fill(215, 215, 330, 330);
fill(30, 215, 170, 300);
// South: heat rejection along the cordon; cold plant at the south gate.
text(0, 372, 'HEAT REJECTION · radiator forest + cold plant at the south gate', 11, 700);

// Legend and notes.
const L = (y, c, s) => {
  add(`<rect x="560" y="${y - 10}" width="22" height="14" fill="${c}" stroke="#8d8678"/>`);
  text(592, y + 1, s, 12, 400, '#26272a', 'start');
};
text(560, -540, 'THE FIELD · MASTER PLAN (PROPOSAL)', 20, 700, '#26272a', 'start');
text(560, -516, 'The ground repeats the Dome: avenues under its ribs, a walled compound', 11, 400, '#3b3a36', 'start');
let y = -480;
for (const [k, s] of [['craft', 'Craft: control, hangars, the corridor'], ['instruments', 'Instruments: the Gyre'], ['power', 'Power: the Converter, switchyards'], ['cryo', 'Cryogen: Cold Hold, Stills, compressors, tank farm'], ['science', 'Science: Resonator, Reckoner, labs'], ['works', 'Works: the Loom, stores, feed plant'], ['heat', 'Heat rejection: radiators, cold plant']]) {
  L(y, PALETTE[k], s);
  y += 22;
}
y += 14;
for (const s of [
  'Avenues (20 m) on the Dome’s rib lines x, z = ±192; lanes (10 m) at ±288;',
  '  the Axis Road west, the Meridian north and south; the corridor east is for craft.',
  'Cordon: an arcaded wall-gallery round the compound (≈13 m, walkable on top),',
  '  gate pylons where avenues pass, the main portal on the Axis Road.',
  'Viaducts (gold, dashed) line every avenue: the precincts’ edges in the air.',
  'Each precinct: its own paving, a hero, and secondary plant (hatched) filling it:',
  '  process halls, compressor houses, tank farms, switchyards, hangars, labs.',
  'Levels: ground plant · gallery walks & viaducts (9–14 m) · the Halo (20 m) ·',
  '  tower rings & skybridges (40–110 m) · spires to the Dome’s limit.',
]) {
  text(560, y, s, 11, 400, '#26272a', 'start');
  y += 17;
}
add(`</svg>`);
fs.mkdirSync('tools/out/field', { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME });
try {
  const page = await browser.newPage({ viewport: { width: 2430, height: 1740 } });
  await page.setContent(`<!doctype html><html><body style="margin:0">${out.join('\n')}</body></html>`);
  await page.locator('svg').screenshot({ path: OUT });
} finally {
  await browser.close();
}
console.log(`wrote ${OUT}`);
