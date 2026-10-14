/**
 * Layout of the Dyson structure, in shell units (R = 1, ≈ 984,000 km): the project logo
 * (public/logo.png), modelled as it is drawn.
 *
 *  - The equatorial band: a thick girder ±3.5° wide with twin edge rails — the habitable Girdle.
 *    It spins inside everything else (spin.ts), so no part of the frame crosses it:
 *  - Six meridian spines, 60° apart, from each pole to just short of the band, ending in a hub
 *    collar: a ring about the spine's crossing point, cut open over the band so the band runs
 *    through it. Its cut faces bear on the band's rails.
 *  - Open bands just north and south of the band (3.5°–12°), crossed only by short posts and
 *    diagonal braces from the panel corners down to the band's rails (mitred flush to them).
 *  - Big curved gore panels, one per 60° sector and hemisphere, from 12° to 62° latitude.
 *  - Between panels the gaps alternate: around every other hub a wide opening (±17° of longitude)
 *    crossed by latitude members at ±27° and ±50°; at the other spines a narrow slot.
 *  - A collar ring near each pole; inside it the polar cap is open, with the spines converging on a
 *    polar hub.
 *
 * Sphere frame: centre C, X east, Z south (spin axis), observer at q = (0, −1, 0) on the equator.
 * A point at latitude φ (north positive) and longitude λ (east of the observer) is
 * q = (cos φ sin λ, −cos φ cos λ, −sin φ). The city stands on the band 20° west of a hub with a
 * wide opening: looking east is the logo's front face.
 */

export const DEG = Math.PI / 180;

/** Longitude of the meridian (and hub) nearest the city, east of it. */
export const NEAR_MERIDIAN_LONGITUDE = 20 * DEG;
export const MERIDIAN_SPACING = 60 * DEG;

export const STRUCTURE = {
  /** Meridian longitudes; even indices have a wide opening, odd ones a narrow slot. */
  meridianLongitudes: [0, 1, 2, 3, 4, 5].map((k) => NEAR_MERIDIAN_LONGITUDE + k * MERIDIAN_SPACING),
  spineWidth: 0.024, // ≈ 24,000 km
  spineDepth: 0.016,
  /** The equatorial band (the habitable Girdle, roofed by the Veil): half-width in latitude. */
  girdleHalfLatitude: 3.5 * DEG,
  /** The band's twin edge rails. */
  rimWidth: 0.008,
  rimDepth: 0.004,
  /** Spines end this far from the equator, buried inside their hub collar. */
  spineEnd: 6 * DEG,
  /** Hub collars: a ring (angular radii about the crossing point), cut open over the band. */
  hubInner: 5 * DEG,
  hubOuter: 7 * DEG,
  hubDepth: 0.02,
  /** Polar hubs. */
  poleRadius: 4 * DEG,
  poleDepth: 0.016,
  /** Gore panels: latitude span and thickness. */
  panelLow: 12 * DEG,
  panelHigh: 62 * DEG,
  panelDepth: 0.006,
  panelCornerRadius: 0.02,
  /** Half-widths (longitude) of the gaps around the meridians. */
  wideHalf: 17 * DEG,
  slotHalf: 2.2 * DEG,
  /** Latitude members across the wide openings. */
  memberLatitudes: [27 * DEG, 50 * DEG],
  memberWidth: 0.012,
  memberDepth: 0.01,
  /** Polar collars. */
  collarLatitude: 70 * DEG,
  collarWidth: 0.02,
  collarDepth: 0.014,
  /** Posts and braces across the open bands at the wide openings' panel corners. */
  postWidth: 0.012,
  postDepth: 0.01,
  braceWidth: 0.007,
  braceDepth: 0.007,
  /** The braces' lower end: this far (longitude) from the hub meridian, on the band's rail, clear of the collar. */
  braceFoot: 9 * DEG,
} as const;

/**
 * The plane of a rail's poleward face, as the half-space q·n < c beyond it (q from the centre).
 * Frame parts that meet the band (collars, posts, braces) are cut by it, flush against the rail.
 */
export function railFacePlane(hemi: 1 | -1): { n: [number, number, number]; c: number } {
  const S = STRUCTURE;
  const rimLat = S.girdleHalfLatitude - S.rimWidth / 2;
  const outer = Math.sin(rimLat) + (S.rimWidth / 2) * Math.cos(rimLat);
  // North (hemi +1) lies at q.z < −outer, south at q.z > outer.
  return { n: [0, 0, hemi], c: -outer };
}

/** Unit vector (sphere frame) for latitude/longitude. */
export function sphereDir(lat: number, lon: number): [number, number, number] {
  return [Math.cos(lat) * Math.sin(lon), -Math.cos(lat) * Math.cos(lon), -Math.sin(lat)];
}

/** Normal of the meridian plane at longitude λ (q·n = cos φ · sin(λq − λ)). */
export function meridianNormal(lon: number): [number, number, number] {
  return [Math.cos(lon), Math.sin(lon), 0];
}

/** Whether meridian k has a wide opening around it. */
export function isWide(k: number): boolean {
  return k % 2 === 0;
}

/** Hub axes (sphere frame). */
export function hubAxes(): { equatorial: [number, number, number][]; poles: [number, number, number][] } {
  return {
    equatorial: STRUCTURE.meridianLongitudes.map((lon) => sphereDir(0, lon)),
    poles: [
      [0, 0, -1],
      [0, 0, 1],
    ],
  };
}

export interface Strut {
  /** Normal of the great-circle plane the strut lies in. */
  n: [number, number, number];
  /** End points (unit vectors). */
  a: [number, number, number];
  b: [number, number, number];
  width: number;
  depth: number;
  /** Hemisphere (+1 north): the strut's foot is cut flush by that rail’s face (railFacePlane). */
  hemi: 1 | -1;
}

const cross = (u: number[], v: number[]): [number, number, number] => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const norm = (v: number[]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Posts (meridional, from the band's rail up to the panel corner) and braces (from the panel corner
 * diagonally down to the rail, toward the hub) at both sides of every wide opening, both hemispheres.
 */
export function struts(): Strut[] {
  const S = STRUCTURE;
  const out: Strut[] = [];
  const rail = S.girdleHalfLatitude;
  S.meridianLongitudes.forEach((lon, k) => {
    if (!isWide(k)) return;
    for (const side of [-1, 1]) {
      for (const hemi of [-1, 1] as const) {
        const corner = sphereDir(hemi * S.panelLow, lon + side * S.wideHalf);
        const postFoot = sphereDir(hemi * rail, lon + side * S.wideHalf);
        const braceFoot = sphereDir(hemi * rail, lon + side * S.braceFoot);
        out.push({ n: norm(cross(postFoot, corner)), a: postFoot, b: corner, width: S.postWidth, depth: S.postDepth, hemi });
        out.push({ n: norm(cross(braceFoot, corner)), a: braceFoot, b: corner, width: S.braceWidth, depth: S.braceDepth, hemi });
      }
    }
  });
  return out;
}

/**
 * The half-space that ends a strut square across itself at the panel corner b (q·n < 0 keeps the
 * arc from b toward its foot); the foot is cut by railFacePlane.
 */
export function strutTopCap(s: Strut): { n: [number, number, number]; c: number } {
  const n = cross(s.b, s.n);
  return { n: [-n[0], -n[1], -n[2]], c: 0 };
}

/**
 * Elevation and distance of a shell point seen from the observer: a point at central angle γ lies
 * at elevation γ/2 and distance 2R·sin(γ/2) (inscribed angle).
 */
export function shellView(gamma: number): { elevation: number; distance: number } {
  return { elevation: gamma / 2, distance: 2 * Math.sin(gamma / 2) };
}

/** Elevation of a point at central angle γ and radius r (shell units) from the sphere centre. */
export function pointElevation(gamma: number, r: number): number {
  return Math.atan2(1 - r * Math.cos(gamma), r * Math.sin(gamma));
}
