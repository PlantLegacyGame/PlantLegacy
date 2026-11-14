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
 * in the planet mesh's own local space. Same material as the planet so the soil
 * shader, the Root Sight cavity and the lighting apply identically; it only
 * adds geometry where the player can see it.
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
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const horizontal = Math.min(Math.hypot(x, z), radius * 0.99);
    // Sphere surface in local space (the planet mesh sits at -radius) plus the
    // relief, which is zero past the patch radius, so the rim matches the
    // sphere exactly.
    const sphereY = Math.sqrt(Math.max(radius * radius - horizontal * horizontal, 0));
    positions.setY(i, sphereY + terrainRelief(x, z, field) + skinM);
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

  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'planet-terrain';
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
  const outer = createTerrainPatch(
    radius,
    field,
    material,
    Math.max(24, Math.round(innerSegments * 0.6)),
    patchRadius * 2,
    0.004,
    innerExtent * 0.98,
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
