/**
 * The dug wall as real layered earth.
 *
 * The pit used to be one smooth lathe with a colour gradient painted on it: six
 * rings, a lerp from topsoil to subsoil, and a shader that faked relief with
 * noise. From any angle it read as a funnel, because that is what it was - a
 * single surface with no strata, no relief and no layer edges.
 *
 * This module builds the wall as a stack of *bands*. Each stratum gets its own
 * colour, the boundary between two strata gets a pair of rings so the change is a
 * hard edge instead of a gradient, and every ring below the lip is displaced
 * radially by a clod field so the wall has real silhouette and real normals for
 * the lit material to work with.
 *
 * Pure: no THREE, no GLSL. The ring table is the contract - `update.ts` still
 * finds the lip by its y, and the tests can count bands without a GPU.
 */
import type { StrataBand } from './profile.ts';

import { CAVITY_PROFILE, CAVITY_PROFILE_DEPTH } from './profile.ts';

/** One vertex ring of the wall. */
export interface ShellRing {
  /** Height in bowl units, 0 at the lip. */
  y: number;
  /** Radius in bowl units, 1 at the lip. */
  r: number;
  /** Index into the band list this ring's colour comes from. */
  band: number;
  /** True when this ring exists only to stop a colour gradient. */
  boundary: boolean;
}

/**
 * A wall column's relief, as a fraction of the ring's radius.
 *
 * Two octaves: clods about a fifth of the mouth across, and grit. Deterministic
 * in (angle, depth) so the wall does not crawl between frames or rebuilds.
 */
export function clodRelief(angle: number, depth: number, amplitude: number): number {
  const clods = Math.sin(angle * 7 + depth * 11.3) * Math.sin(angle * 3.1 - depth * 4.7);
  const grit = Math.sin(angle * 23.7 + 1.7) * Math.sin(depth * 19.1 - 0.4);
  // Inward only, and that is not a taste: the soil is removed by a cylinder of
  // exactly the aperture radius, so any fragment pushed *out* of that cylinder
  // has no soil behind it and is discarded by the bowl's own clip - which showed
  // as pale patches of sky through the wall. Carving dimples inward keeps every
  // fragment inside the cut, where there is earth to hide it.
  return -(0.5 + 0.5 * (clods * 0.7 + grit * 0.3)) * amplitude;
}

/** Radius of the profile at a given height, linearly between its own rings. */
export function profileRadiusAt(y: number): number {
  const height = Math.max(-CAVITY_PROFILE_DEPTH, Math.min(0, y));
  for (let i = 1; i < CAVITY_PROFILE.length; i += 1) {
    const above = CAVITY_PROFILE[i - 1];
    const below = CAVITY_PROFILE[i];
    if (height <= above.y && height >= below.y) {
      const span = above.y - below.y;
      const t = span <= 1e-6 ? 0 : (above.y - height) / span;
      return above.r + (below.r - above.r) * t;
    }
  }
  return 0;
}

/**
 * The ring table: the profile's own rings, subdivided into readable courses of
 * earth, plus a doubled ring at every stratum boundary.
 */
export function strataRings(bands: readonly StrataBand[], subdivision = 3): ShellRing[] {
  const rings: ShellRing[] = [];
  const bandAt = (y: number): number => {
    const depth = CAVITY_PROFILE_DEPTH <= 0 ? 0 : -y / CAVITY_PROFILE_DEPTH;
    for (let i = 0; i < bands.length; i += 1) {
      if (depth <= bands[i].to) return i;
    }
    return Math.max(0, bands.length - 1);
  };

  const steps = Math.max(1, Math.round(subdivision));
  const heights: number[] = [];
  for (let i = 0; i < CAVITY_PROFILE.length - 1; i += 1) {
    const above = CAVITY_PROFILE[i];
    const below = CAVITY_PROFILE[i + 1];
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      heights.push(above.y + (below.y - above.y) * t);
    }
  }
  heights.push(CAVITY_PROFILE[CAVITY_PROFILE.length - 1].y);

  // A doubled ring at each boundary. The subdivided courses do not land on a
  // stratum edge, so the edge is inserted: the quad between the upper and lower
  // copy has almost no height, and the band colour changes across that sliver
  // instead of smearing through a whole course of the wall.
  const boundaries = bands.slice(1).map((band) => -band.from * CAVITY_PROFILE_DEPTH);
  for (const y of boundaries) {
    heights.push(y, y - 0.006);
  }
  // Top to bottom, and drop duplicates that the insertion created.
  heights.sort((a, b) => b - a);
  const kept: number[] = [];
  for (const y of heights) {
    const previous = kept[kept.length - 1];
    if (previous !== undefined && Math.abs(previous - y) < 1e-5) continue;
    kept.push(y);
  }

  for (const y of kept) {
    rings.push({
      y,
      r: profileRadiusAt(y),
      band: bandAt(y),
      boundary: boundaries.some((edge) => Math.abs(edge - y) < 1e-5),
    });
  }
  return rings;
}

export interface StrataShellGeometry {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  cols: number;
  ringCount: number;
  /** Rim vertex indices, in column order, for the per-frame ground conform. */
  rimIndices: number[];
}

/**
 * Build the wall: one vertex per (ring, column), quads between rings, band
 * colours per vertex, radial relief on everything below the lip.
 *
 * The lip ring is left exactly on the cut circle - it is the ring the terrain
 * conform moves - and the relief fades in below it so the mouth never grows a
 * ragged edge.
 */
export function buildStrataShell(options: {
  bands: readonly StrataBand[];
  colors: readonly [number, number, number][];
  cols?: number;
  subdivision?: number;
  relief?: number;
}): StrataShellGeometry {
  const cols = Math.max(8, Math.round(options.cols ?? 96));
  const relief = Math.max(0, options.relief ?? 0.09);
  const rings = strataRings(options.bands, options.subdivision ?? 3);
  const positions = new Float32Array(rings.length * cols * 3);
  const colors = new Float32Array(rings.length * cols * 3);
  const indices: number[] = [];

  for (let ring = 0; ring < rings.length; ring += 1) {
    const spec = rings[ring];
    const depthFraction = CAVITY_PROFILE_DEPTH <= 0 ? 0 : -spec.y / CAVITY_PROFILE_DEPTH;
    const colour = options.colors[Math.min(options.colors.length - 1, spec.band)] ?? [0, 0, 0];
    for (let c = 0; c < cols; c += 1) {
      const angle = (c / cols) * Math.PI * 2;
      // The cut wall is a cylinder: the first quarter of the depth stays exactly
      // on it, so no clod can pull the wall inside the aperture and leave a
      // sliver of sky between the lip and the soil it cuts. Relief fades in below
      // that, where there is soil all round the wall to hide the wobble.
      const fade = Math.min(1, Math.max(0, (-spec.y - 0.28) / 0.22));
      const wobble = ring === 0 ? 0 : clodRelief(angle, depthFraction, relief) * fade;
      const radius = spec.r * (1 + wobble);
      const index = (ring * cols + c) * 3;
      positions[index] = Math.cos(angle) * radius;
      positions[index + 1] = spec.y;
      positions[index + 2] = Math.sin(angle) * radius;
      // Grit per vertex, so even a band is not a flat fill.
      const grit = 0.92 + 0.16 * (0.5 + 0.5 * Math.sin(angle * 37.1 + spec.y * 53.7));
      // The lower copy of a boundary ring is the seam: a dark line of packed earth
      // where one layer meets the next. Without it the bands are three browns
      // that read as one brown with lighting on it.
      const seam = spec.boundary ? 0.62 : 1;
      colors[index] = colour[0] * grit * seam;
      colors[index + 1] = colour[1] * grit * seam;
      colors[index + 2] = colour[2] * grit * seam;
    }
  }

  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = ring * cols + c;
      const b = ring * cols + ((c + 1) % cols);
      const next = a + cols;
      const nextNext = b + cols;
      indices.push(a, next, b, b, next, nextNext);
    }
  }

  const rimIndices: number[] = [];
  for (let c = 0; c < cols; c += 1) rimIndices.push(c);

  return {
    positions,
    colors,
    indices: new Uint32Array(indices),
    cols,
    ringCount: rings.length,
    rimIndices,
  };
}
