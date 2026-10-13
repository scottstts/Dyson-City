#!/usr/bin/env node
/**
 * Monte Carlo area shares of the shell layout (panels, frames, band, open space), mirroring
 * sky/structure/layout.ts and trace.ts panelField. Keeps enclosure.ts SURFACES consistent.
 *   node tools/coverage.mjs
 */
const DEG = Math.PI / 180;
const S = {
  lon0: 20 * DEG, spine: 0.024, band: 3.5 * DEG, low: 12 * DEG, high: 62 * DEG, wide: 17 * DEG, slot: 2.2 * DEG,
  collar: 70 * DEG, collarW: 0.02, members: [27 * DEG, 50 * DEG], memberW: 0.012, hub: 5 * DEG, pole: 4 * DEG,
};
let panel = 0, frame = 0, girdle = 0, open = 0;
const N = 400000;
const wrap = (x) => ((x % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
for (let i = 0; i < N; i++) {
  const z = 2 * Math.random() - 1, ph = 2 * Math.PI * Math.random(), r = Math.sqrt(1 - z * z);
  const q = [r * Math.cos(ph), r * Math.sin(ph), z];
  const lat = Math.asin(-q[2]);
  const lon = Math.atan2(q[0], -q[1]);
  const al = Math.abs(lat);
  if (al < S.band) { girdle++; continue; }
  // Nearest meridian.
  const k = Math.round(wrap(lon - S.lon0) / (60 * DEG));
  const dlon = wrap(lon - S.lon0 - k * 60 * DEG);
  const kk = ((k % 6) + 6) % 6;
  const arcToSpine = Math.abs(Math.cos(lat) * Math.sin(dlon));
  const hubAng = Math.acos(Math.min(1, Math.cos(lat) * Math.cos(dlon)));
  if (arcToSpine < S.spine / 2 || hubAng < S.hub || Math.PI / 2 - al < S.pole || Math.abs(al - S.collar) < S.collarW / 2) { frame++; continue; }
  const h = kk % 2 === 0 ? S.wide : S.slot;
  const inPanelLat = al > S.low && al < S.high;
  if (inPanelLat && Math.abs(dlon) > h) { panel++; continue; }
  if (kk % 2 === 0 && Math.abs(dlon) < S.wide && S.members.some((m) => Math.abs(al - m) < S.memberW / 2)) { frame++; continue; }
  open++;
}
console.log({ panel: (panel / N).toFixed(3), frame: (frame / N).toFixed(3), girdle: (girdle / N).toFixed(3), open: (open / N).toFixed(3) });
