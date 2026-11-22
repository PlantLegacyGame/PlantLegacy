/**
 * The soil as a slab, not a sheet.
 *
 * The ground was a displaced plane. It had no underside and no sides, so any eye
 * that saw it edge-on - a burrowed Root Sight eye, a low camera at the pit's lip,
 * the cut itself - was looking at the back of a single-sided surface with empty
 * space behind it. That is why the world could be cut open and reveal nothing:
 * there was nothing there to reveal.
 *
 * This builds the thickness the surface never had: a wall around the patch and an
 * underside beneath it, both hung off exactly the same height function the patch
 * uses, so the slab and its top cannot disagree at the shared edge. It is not a
 * decorator on the soil shader - it is geometry with an inside.
 */

import type { TerrainFieldParams } from '@plant-legacy/shared/world';
import * as THREE from 'three';
import { patchLocalSurfaceY } from './planetSurface.ts';

export interface SoilSlabOptions {
  radius: number;
  field: TerrainFieldParams;
  material: THREE.Material;
  /** Vertices along each edge of the square. */
  segments: number;
  /** Full width of the square, matching the terrain patch it lines. */
  extentM: number;
  /** The same lift the patch is raised by, so the top edge meets it. */
  skinM: number;
  /** How thick the earth is, in metres. */
  depthM: number;
  /**
   * Radius of a hole in the underside, in metres.
   *
   * The earth's bottom is a sheet, and Root Sight cuts a bowl out of the earth
   * above it. A sheet that spans the cavity crosses it: from inside the pit the
   * underside is a second floor, and from under it a flat ceiling across the
   * hole. The cavity is a void in the body, so the body's underside is absent
   * where the void is.
   */
  holeRadiusM?: number;
}

/**
 * Perimeter walls plus an underside under a square terrain patch.
 *
 * Winding: the top ring runs counter-clockwise seen from above, so the wall quads
 * face outwards and the underside faces down. Both use the terrain material, so
 * the strata shading, the aperture cut and the light all apply to the cut faces
 * exactly as they do to the surface.
 */
export function createSoilSlab(options: SoilSlabOptions): THREE.Mesh {
  const half = Math.max(1, options.extentM) / 2;
  const steps = Math.max(8, Math.round(options.segments));
  const depth = Math.max(0.05, options.depthM);

  // The same patch-local metres the patch above it stores, and the same placement:
  // a slab written at the planet's radius instead would sit a planet away from the
  // surface it is supposed to line, and every vertex would quantise at the radius.
  const topY = (x: number, z: number): number =>
    patchLocalSurfaceY(options.radius, x, z, options.field, options.skinM);

  // One closed loop around the square, counter-clockwise from above.
  const loop: { x: number; z: number }[] = [];
  for (let i = 0; i < steps; i += 1) loop.push({ x: -half + (2 * half * i) / steps, z: -half });
  for (let i = 0; i < steps; i += 1) loop.push({ x: half, z: -half + (2 * half * i) / steps });
  for (let i = 0; i < steps; i += 1) loop.push({ x: half - (2 * half * i) / steps, z: half });
  for (let i = 0; i < steps; i += 1) loop.push({ x: -half, z: half - (2 * half * i) / steps });

  const count = loop.length;
  const positions: number[] = [];
  const indices: number[] = [];

  // Wall: top ring then bottom ring, so a quad's four corners are
  // (top i, top i+1, bottom i, bottom i+1).
  for (const point of loop) {
    positions.push(point.x, topY(point.x, point.z), point.z);
  }
  for (const point of loop) {
    positions.push(point.x, topY(point.x, point.z) - depth, point.z);
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const topA = i;
    const topB = next;
    const bottomA = count + i;
    const bottomB = count + next;
    indices.push(topA, bottomA, topB, topB, bottomA, bottomB);
  }

  // Underside: a coarser grid, because it is only ever seen from inside the
  // earth where there is no detail to lose.
  const holeRadius = Math.max(0, options.holeRadiusM ?? 0);
  const underSteps = Math.max(4, Math.round(steps / 4));
  const base = positions.length / 3;
  for (let iz = 0; iz <= underSteps; iz += 1) {
    for (let ix = 0; ix <= underSteps; ix += 1) {
      const x = -half + (2 * half * ix) / underSteps;
      const z = -half + (2 * half * iz) / underSteps;
      positions.push(x, topY(x, z) - depth, z);
    }
  }
  const row = underSteps + 1;
  for (let iz = 0; iz < underSteps; iz += 1) {
    for (let ix = 0; ix < underSteps; ix += 1) {
      const a = base + iz * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      // Leave the cavity out of the earth's bottom. Any corner inside the void
      // is enough to drop the quad: a quad that merely straddles the bowl's
      // mouth would still be a strip of ceiling across the hole.
      if (holeRadius > 0) {
        let inHole = false;
        for (const index of [a, b, c, d]) {
          const vx = positions[index * 3] ?? 0;
          const vz = positions[index * 3 + 2] ?? 0;
          if (Math.hypot(vx, vz) < holeRadius) {
            inHole = true;
            break;
          }
        }
        if (inHole) continue;
      }
      // Wound to face down: seen from inside the earth, the slab's underside is
      // the ceiling of the space the roots live in.
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // How this body was built, on the geometry itself. A dev probe rebuilds it
  // (with, or with no, cavity hole) at exactly these numbers instead of
  // re-deriving radius, extent, depth and segments and drifting from the ground.
  geometry.userData.slabOptions = { ...options, holeRadiusM: holeRadius };

  const mesh = new THREE.Mesh(geometry, options.material);
  mesh.name = 'planet-soil-slab';
  mesh.position.y = options.radius;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}
