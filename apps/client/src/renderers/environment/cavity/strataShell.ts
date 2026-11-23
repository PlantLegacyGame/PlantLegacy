/**
 * The dug wall as real layered earth.
 *
 * The pit used to be one smooth lathe with a colour gradient painted on it: six
 * rings, a lerp from topsoil to subsoil, and a shader that faked relief with
 * noise. From any angle it read as a funnel, because that is what it was - a
 * single surface with no strata, no relief and no layer edges.
 *
 * This module builds the wall as a stack of *bands*: the profile's rings are
 * subdivided into courses of earth, a doubled ring marks every stratum boundary
 * as a crease, and every ring below the lip is displaced radially by a clod
 * field so the wall has real silhouette and real normals for the lit material to
 * work with.
 *
 * It carries no colours. The strata are chosen per fragment in `bowlMesh.ts`,
 * from the config's own palette, because a colour baked per vertex can only
 * change at a polygon edge - which on this clodded wall is a ragged line that
 * follows the relief instead of a bed's contact. Every colour array this module
 * used to produce was overridden by the shader and never reached the screen.
 *
 * Pure: no THREE, no GLSL. The ring table is the contract - `update.ts` still
 * finds the lip by its y, and the tests can count courses without a GPU.
 */
import type { StrataBand } from './profile.ts';

import { CAVITY_PROFILE, CAVITY_PROFILE_DEPTH } from './profile.ts';

/** One vertex ring of the wall. */
export interface ShellRing {
  /** Height in bowl units, 0 at the lip. */
  y: number;
  /** Radius in bowl units, 1 at the lip. */
  r: number;
  /** True when this ring is one of the pair that marks a stratum boundary. */
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
  // copy has almost no height, and it is a crease in the wall's own surface. The
  // shader darkens the contact between the two beds; this is the geometry under
  // that line, so the edge survives being lit from any side.
  const boundaries = bands.slice(1).map((band) => -band.from * CAVITY_PROFILE_DEPTH);
  // Both copies belong to the contact: the quad between them is the crease, so
  // flagging only the upper one marked half of the thing the flag is for.
  const contacts = boundaries.flatMap((edge) => [edge, edge - 0.006]);
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
      boundary: contacts.some((contact) => Math.abs(contact - y) < 1e-5),
    });
  }
  return rings;
}

export interface StrataShellGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  cols: number;
  ringCount: number;
  /** Rim vertex indices, in column order, for the per-frame ground conform. */
  rimIndices: number[];
}

/**
 * Build the wall: one vertex per (ring, column), quads between rings, radial
 * relief on everything below the lip. Geometry only - see the module note for
 * why the colours are not this module's business any more.
 *
 * The lip ring is left exactly on the cut circle - it is the ring the terrain
 * conform moves - and the relief fades in below it so the mouth never grows a
 * ragged edge.
 */
export function buildStrataShell(options: {
  bands: readonly StrataBand[];
  cols?: number;
  subdivision?: number;
  relief?: number;
}): StrataShellGeometry {
  const cols = Math.max(8, Math.round(options.cols ?? 96));
  // 0.09 of a mouth was millimetre-scale grit once the wall was scaled to a
  // metre-sized pit: enough to break the fill, not enough to cast a shadow that
  // says "dug earth". 0.16 leaves clods you can see from the rim.
  const relief = Math.max(0, options.relief ?? 0.16);
  const rings = strataRings(options.bands, options.subdivision ?? 3);
  const positions = new Float32Array(rings.length * cols * 3);
  const indices: number[] = [];

  for (let ring = 0; ring < rings.length; ring += 1) {
    const spec = rings[ring];
    const depthFraction = CAVITY_PROFILE_DEPTH <= 0 ? 0 : -spec.y / CAVITY_PROFILE_DEPTH;
    for (let c = 0; c < cols; c += 1) {
      const angle = (c / cols) * Math.PI * 2;
      // The cut wall is a cylinder: the first quarter of the depth stays exactly
      // on it, so no clod can pull the wall inside the aperture and leave a
      // sliver of sky between the lip and the soil it cuts. Relief fades in below
      // that, where there is soil all round the wall to hide the wobble.
      const fade = Math.min(1, Math.max(0, (-spec.y - 0.28) / 0.22));
      // ...and fades out again at the floor. The last rings are only half the
      // mouth wide, so the same radial wobble that reads as clods on the wall is
      // a scalloped ring at the bottom: the floor cap's edge was a torn grey
      // plate with a serrated silhouette. Near the centre there is no wall left
      // to give texture, so the profile's own radius is the right one.
      const floorFade = Math.min(1, Math.max(0, (spec.r - 0.7) / 0.3));
      const wobble = ring === 0 ? 0 : clodRelief(angle, depthFraction, relief) * fade * floorFade;
      const radius = spec.r * (1 + wobble);
      const index = (ring * cols + c) * 3;
      positions[index] = Math.cos(angle) * radius;
      positions[index + 1] = spec.y;
      positions[index + 2] = Math.sin(angle) * radius;
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
    indices: new Uint32Array(indices),
    cols,
    ringCount: rings.length,
    rimIndices,
  };
}
