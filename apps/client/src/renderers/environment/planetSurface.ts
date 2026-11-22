/**
 * Planet surface math (world-as-a-planet).
 *
 * The world is the surface of a sphere. Stage 1 keeps the simulation's 2D
 * coordinates (x, z) and treats them as metres measured across the surface from
 * the pole, so every renderer only has to drop a position onto the sphere.
 *
 * Relief now comes from the shared `@plant-legacy/shared/world` terrain field:
 * the server validates growth against the same function, so the ground the
 * client draws is the ground the simulation believes in. Only the planet's
 * curvature is added here.
 */
import {
  type TerrainFieldParams,
  terrainHeightAt,
  terrainMaterialAt,
  terrainNormalAt,
} from '@plant-legacy/shared/world';
import * as THREE from 'three';

/**
 * How far below the tangent plane at the pole a point sits, in metres.
 *
 * `radius` is the planet's radius; `x`/`z` are metres from the pole. A point
 * past the horizon is clamped to the full radius rather than producing NaN.
 */
export function planetSurfaceDrop(radius: number, x: number, z: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const r2 = x * x + z * z;
  if (r2 >= radius * radius) return radius;
  return radius - Math.sqrt(radius * radius - r2);
}

/**
 * "Up" on the planet at (x, z): the outward surface normal. Anything standing
 * on the surface is oriented against this rather than world +Y.
 */
export function planetUp(radius: number, x: number, z: number): THREE.Vector3 {
  return planetSurfaceFrame(radius, x, z).normal;
}

/** Gravity at (x, z): straight down toward the planet's centre. */
export function planetGravity(radius: number, x: number, z: number): THREE.Vector3 {
  return planetUp(radius, x, z).multiplyScalar(-1);
}

/** Surface height at (x, z), with the pole at y = 0. */
export function planetSurfaceY(radius: number, x: number, z: number): number {
  const drop = planetSurfaceDrop(radius, x, z);
  // Avoid -0 at the pole: it compares unequal to 0 under Object.is.
  return drop === 0 ? 0 : -drop;
}

/**
 * The point `altitude` metres above the surface at (x, z), and the outward
 * normal there (which is also "up" for anything standing on the planet).
 */
export function planetSurfaceFrame(
  radius: number,
  x: number,
  z: number,
  altitude = 0,
): { point: THREE.Vector3; normal: THREE.Vector3 } {
  const centreY = -radius;
  const y = planetSurfaceY(radius, x, z);
  const normal = new THREE.Vector3(x, y - centreY, z);
  if (normal.lengthSq() === 0) normal.set(0, 1, 0);
  else normal.normalize();
  const point = new THREE.Vector3(x, y, z).addScaledVector(normal, altitude);
  return { point, normal };
}

/** Lift that keeps a patch above the sphere it covers, avoiding z-fighting. */
export const TERRAIN_SKIN_M = 0.02;

/** Relief at a position, from the shared field. */
export function terrainRelief(x: number, z: number, field: TerrainFieldParams): number {
  return terrainHeightAt(field, x, z);
}

/**
 * Surface height at (x, z) including the terrain displacement and the same
 * skin the detail patch is raised by. Placement code must use this rather than
 * the bare sphere, or plants sink into the swells and the seed ends up under
 * the drawn ground by the skin thickness.
 */
export function planetTerrainY(
  radius: number,
  x: number,
  z: number,
  field: TerrainFieldParams,
): number {
  const relief = field.amplitudeM > 0 ? terrainRelief(x, z, field) : 0;
  // The flat fallback ground has no patch above it, so it needs no skin.
  const skin = radius > 0 ? TERRAIN_SKIN_M : 0;
  return planetSurfaceY(radius, x, z) + relief + skin;
}

/**
 * Height of a ground patch's own surface, in metres above the pole's tangent
 * plane: the curvature drop, the relief on it and the skin it is raised by.
 *
 * This is the number a patch vertex stores, and it is deliberately small. A vertex
 * height written as `sqrt(radius² - r²)` is about the radius itself - 100,000 m
 * today - and float32 spaces values that size by `radius × 2⁻²³`: 7.8 mm at 100 km,
 * 0.5 m at Earth radius, paid by every vertex and growing with the planet. Written
 * as the drop instead, the stored number is a couple of metres of curvature plus
 * the relief, and the radius lives in the mesh's placement (`+radius` inside the
 * body at `-radius`), where it cancels exactly.
 *
 * Exported so the soil slab can hang its walls off exactly this number: the walls
 * and the patch they line share an edge, and a slab built from a different height
 * would leave a step along that edge. Both meshes carry the same `+radius`
 * placement, so both store patch-local metres.
 */
export function patchLocalSurfaceY(
  radius: number,
  x: number,
  z: number,
  field: TerrainFieldParams,
  skinM: number,
): number {
  const horizontal = Math.min(Math.hypot(x, z), radius * 0.99);
  const drop = radius - Math.sqrt(Math.max(radius * radius - horizontal * horizontal, 0));
  return -drop + terrainRelief(x, z, field) + skinM;
}

/**
 * The planet's surface, and therefore the whole traversable ground. Its pole is
 * at y = 0, which is where the play area's tangent plane is. One sphere means
 * one surface: there is no cap to end, no seam where two grounds meet, and no
 * edge that stops the player.
 */
export function createPlanetBody(radius: number, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 256, 128);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'planet-surface';
  mesh.position.y = -radius;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/**
 * One metre-scale ground patch that follows the sphere and carries the relief,
 * in patch-local metres, placed at the planet's radius. Same material as the
 * planet so the soil shader, the Root Sight cavity and the lighting apply
 * identically; it only adds geometry where the player can see it.
 *
 * `extentM` is the full width of the square, so a 620 m patch covers the whole
 * authored play area. `holeExtentM` removes the centre of the square, turning a
 * coarse outer patch into a ring: the detailed inner patch fills that hole, so
 * the two LODs never draw the same square metres twice.
 */
export function createTerrainPatch(
  radius: number,
  field: TerrainFieldParams,
  material: THREE.Material,
  segments = 96,
  extentM = 180,
  skinM = TERRAIN_SKIN_M,
  holeExtentM = 0,
): THREE.Mesh {
  const extent = Math.max(1, extentM);
  const divisions = Math.max(2, Math.min(256, Math.round(segments)));
  const geometry = new THREE.PlaneGeometry(extent, extent, divisions, divisions);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  // One surface function for both patches. The heights used to be written by the
  // position loop and the normals by `computeVertexNormals`, which only sees the
  // patch it is called on: the inner patch and the coarse ring therefore gave the
  // same seam vertex two different normals, and the light jumped across the last
  // ring of the near field. Heights and normals both read this, with a fixed
  // world-space step, so a shared point agrees at any tessellation.
  const heightAt = (x: number, z: number): number => patchLocalSurfaceY(radius, x, z, field, skinM);
  for (let i = 0; i < positions.count; i += 1) {
    positions.setY(i, heightAt(positions.getX(i), positions.getZ(i)));
  }
  positions.needsUpdate = true;

  // Drop fully-inside triangles for a ring patch. Vertices stay allocated (they
  // are not uploaded as separate draws) so the remaining grid is untouched.
  const holeHalf = Math.max(0, holeExtentM) / 2;
  const index = geometry.getIndex();
  if (holeHalf > 0 && index) {
    const kept: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      const inside = (vertex: number): boolean =>
        Math.abs(positions.getX(vertex)) < holeHalf && Math.abs(positions.getZ(vertex)) < holeHalf;
      if (inside(a) && inside(b) && inside(c)) continue;
      kept.push(a, b, c);
    }
    geometry.setIndex(kept);
  }

  // Normals from the same height function, with one fixed step. The step is in
  // metres, not in cells, so the coarse ring and the fine patch answer with the
  // same normal at the same point; the seam stops being a lighting edge even
  // though the two meshes have different vertex spacing.
  const normals = geometry.getAttribute('normal');
  const step = 0.5;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const dx = heightAt(x - step, z) - heightAt(x + step, z);
    const dz = heightAt(x, z - step) - heightAt(x, z + step);
    const length = Math.hypot(dx, 2 * step, dz) || 1;
    normals.setXYZ(i, dx / length, (2 * step) / length, dz / length);
  }
  normals.needsUpdate = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'planet-terrain';
  // The vertices are metres above the pole's tangent plane; the radius lives in
  // this placement. The patch is added as a child of the planet body (which sits
  // at `y = -radius`), so the two cancel in world space and nothing large is ever
  // stored in a vertex attribute.
  mesh.position.y = radius;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/**
 * The near-field ground: a high-resolution patch for the play area plus a
 * coarse ring out to the configured radius. Both carry the same field, so a
 * 500 m walk sees the same hills instead of a smooth ball beyond 90 m. The
 * outer patch has its centre removed and the inner patch overlaps its rim by a
 * little, so there is one ground surface everywhere and no coincident sheets.
 */
export function createTerrainPatches(
  radius: number,
  field: TerrainFieldParams,
  material: THREE.Material,
  innerSegments: number,
): { inner: THREE.Mesh; outer: THREE.Mesh } {
  const patchRadius = Math.max(20, field.patchRadiusM);
  const innerExtent = Math.min(180, patchRadius * 2);
  const inner = createTerrainPatch(
    radius,
    field,
    material,
    Math.max(16, innerSegments),
    innerExtent,
    TERRAIN_SKIN_M,
  );
  inner.name = 'planet-terrain-detail';
  // Same skin as the inner patch, and a hole two metres *under* the inner edge.
  // Two different skins (0.02 and 0.004 m) put the two surfaces 16 mm apart in
  // the overlap, which is a z-fight with sliver triangles at every grazing angle;
  // a smaller hole (98%) spread those slivers over three metres of the near
  // field, where they read as stretched cliffs. The overlap is now a covered
  // joint: the fine patch is always the surface at the seam, and the coarse ring
  // only shows beyond it.
  const outer = createTerrainPatch(
    radius,
    field,
    material,
    Math.max(24, Math.round(innerSegments * 0.6)),
    patchRadius * 2,
    TERRAIN_SKIN_M,
    Math.max(0, innerExtent - 2),
  );
  outer.name = 'planet-terrain-far';
  return { inner, outer };
}

/** Material at a depth below the surface, for the strata shading. */
export function terrainMaterialDepth(field: TerrainFieldParams, depthM: number) {
  return terrainMaterialAt(field, depthM);
}

/** Surface normal including relief, in the pole-local frame. */
export function terrainNormal(
  field: TerrainFieldParams,
  x: number,
  z: number,
  epsilonM = 0.5,
): { x: number; y: number; z: number } {
  return terrainNormalAt(field, x, z, epsilonM);
}
