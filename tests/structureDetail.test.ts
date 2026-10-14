import { describe, expect, it } from 'vitest';
import { STRUCTURE, DEG } from '../src/sky/structure/layout';
import { BELT } from '../src/sky/structure/courses';
import { DISTRICTS } from '../src/sky/structure/districts';
import { RELIEF } from '../src/sky/structure/relief';
import { PANEL_EDGE } from '../src/sky/structure/trace';
import { COLLECTOR_PLATING, DECK_PLATING, VEIL_PLATING } from '../src/sky/structure/surfaces';
import { ENCLOSURE_LUT, REFLECTION_CLASSES, SURFACES } from '../src/sky/structure/enclosure';
import { COLLECTOR_TEMPERATURE, HEADER_TEMPERATURE } from '../src/sky/structure/thermal';

/** Channel sizing (districts.ts), mirrored for the largest and smallest cells. */
const halfWidth = (S: number) => Math.min(Math.max(S * 0.0035, 0.00018), 0.0016);
const depth = (S: number) => Math.min(Math.max(S * 0.0022, 0.00012), 0.0016);
const heat = (S: number) => Math.min(Math.max(S * 0.09, 0.015), 0.07);

describe('large regions follow the shell (no glass-roof facets)', () => {
  it('only small assemblies are flat: their edges tilt by less than the panes are set', () => {
    // A flat frame tilts by half its size at its edges.
    expect(COLLECTOR_PLATING.flatMax / 2).toBeLessThan(0.2 * DEG);
    expect(VEIL_PLATING.flatMax / 2).toBeLessThan(0.15 * DEG);
    // Girder and hub decks keep their own (small) modules flat.
    expect(DECK_PLATING.flatMax).toBeGreaterThan(0);
  });
});

describe('the band is built in courses', () => {
  const edges = BELT.courseEdges;
  it('courses span the band, irregularly, with no boundary on the city line', () => {
    expect(edges[0]).toBeCloseTo(-STRUCTURE.girdleHalfLatitude / DEG, 9);
    expect(edges[edges.length - 1]).toBeCloseTo(STRUCTURE.girdleHalfLatitude / DEG, 9);
    const widths = edges.slice(1).map((e, i) => e - edges[i]);
    for (const w of widths) expect(w).toBeGreaterThan(0);
    expect(new Set(widths.map((w) => w.toFixed(2))).size).toBeGreaterThan(widths.length / 2);
    for (const e of edges) expect(Math.abs(e)).toBeGreaterThan(0.1);
  });
  it('section boundaries stay ordered (the lookup checks the two neighbours of a cell)', () => {
    expect(BELT.jitter).toBeLessThan(0.5);
    expect(BELT.sectionMin).toBeGreaterThan(BELT.courseEdges[1] * DEG - BELT.courseEdges[0] * DEG);
  });
  it('the enclosure solve uses the sections\' mean scatter for the veil', () => {
    // scatter = min + (max − min)·u², u uniform: mean min + (max − min)/3.
    const mean = BELT.scatterMin + (BELT.scatterMax - BELT.scatterMin) / 3;
    expect(SURFACES.veil.cls.albedo[0]).toBeCloseTo(mean, 3);
  });
});

describe('collector organisation', () => {
  it('manifolds are wide and deep, branches narrow and shallow, nothing deeper than the panel', () => {
    expect(halfWidth(1)).toBeGreaterThan(4 * halfWidth(0.03));
    expect(depth(1)).toBeGreaterThan(depth(0.05));
    expect(RELIEF.maxDepth).toBeLessThan(STRUCTURE.panelDepth * 0.5);
    expect(RELIEF.widest).toBeCloseTo(halfWidth(10), 9);
  });
  it('channels never cross into a neighbouring line: lines are further apart than channels are wide', () => {
    // A cut lies at least splitLo of its cell from the cell's sides; cells stop at stopMin.
    expect(DISTRICTS.splitLo * DISTRICTS.stopMin).toBeGreaterThan(2 * halfWidth(DISTRICTS.stopMin / DISTRICTS.splitLo));
  });
  it('districts hold many assemblies, assemblies many tiles', () => {
    expect(DISTRICTS.stopMin / DISTRICTS.stripMax).toBeGreaterThan(4);
    expect(DISTRICTS.stripMin / DISTRICTS.finest).toBeGreaterThanOrEqual(4);
  });
  it('the hottest channel stays below the headers (and so below the star)', () => {
    const hottest = COLLECTOR_TEMPERATURE * (1 + 0.025 + heat(10));
    expect(hottest).toBeLessThan(HEADER_TEMPERATURE);
  });
  it('the edge cross-section is ordered and keeps a continuous backing', () => {
    expect(PANEL_EDGE.face).toBeGreaterThan(0);
    expect(PANEL_EDGE.recess).toBeGreaterThan(PANEL_EDGE.face);
    expect(PANEL_EDGE.recess).toBeLessThan(1);
    expect(PANEL_EDGE.setback).toBeLessThan(STRUCTURE.panelCornerRadius);
    expect(PANEL_EDGE.connectLevels).toBeLessThanOrEqual(DISTRICTS.basinLevel);
  });
});

describe('reflections see regions', () => {
  it('every reflection class has its row in the enclosure table', () => {
    expect(ENCLOSURE_LUT.irrRows).toBe(REFLECTION_CLASSES.length + 1);
    for (const c of REFLECTION_CLASSES) expect(SURFACES[c].cls).toBeTruthy();
  });
});
