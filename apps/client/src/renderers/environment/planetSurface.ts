/**
 * Planet surface math (world-as-a-planet, stage 1).
 *
 * The world is no longer an infinite flat plane: it is the surface of a sphere
 * with the play area at its pole. Stage 1 keeps the simulation's 2D coordinates
 * (x, z) and treats them as metres measured across the surface from the pole,
 * so every renderer only has to drop a position onto the sphere. Wrapping the
 * tile grid around the whole body, and gravity that points at the centre, are
 * the next stages; the helpers here are the frame they will use.
 */
import * as THREE from 'three';

// --- Terrain relief --------------------------------------------------------
// The surface is the sphere plus a small procedural displacement, so the ground
// has real shape instead of a perfect curve. Two octaves of value noise in
// metres: broad swells a few metres across with a finer roll on top. Deliberately
// cheap — it runs per vertex once when the ground is built and a few times a
// frame for placement, camera and collision.
//
// The same function drives the geometry, plant placement and the camera; a
// visual-only displacement would leave plants hovering above the swells.

function terrainHash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function terrainSmooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise in [0, 1]. */
export function terrainNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = terrainSmooth(x - xi);
  const zf = terrainSmooth(z - zi);
  const top = terrainHash(xi, zi) + (terrainHash(xi + 1, zi) - terrainHash(xi, zi)) * xf;
  const bottom =
    terrainHash(xi, zi + 1) + (terrainHash(xi + 1, zi + 1) - terrainHash(xi, zi + 1)) * xf;
  return top + (bottom - top) * zf;
}

/**
 * Height offset in metres, symmetric around zero so the ground rises and dips.
 * Returns 0 when relief is disabled.
 */
export function terrainOffset(x: number, z: number, amplitude: number): number {
  if (!(amplitude > 0)) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  // Wavelengths of roughly 10 m and 3 m. The older 5.5 m/1.6 m pair put the
  // hills so close together that at eye height the ground still read as flat:
  // relief only became visible from above, which is not where the player is.
  const unit = terrainUnit(x, z);
  return (unit - 0.5) * 2 * amplitude;
}

/** Relief height in [0, 1] before it is scaled to metres. */
export function terrainUnit(x: number, z: number): number {
  const broad = terrainNoise(x * 0.1, z * 0.1);
  const fine = terrainNoise(x * 0.34 + 31.7, z * 0.34 - 12.3);
  return broad * 0.7 + fine * 0.3;
}

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

/**
 * Radius of the high-detail terrain patch around the play area.
 *
 * The planet sphere is tessellated for a 100 km body: its vertices are about
 * 2.4 km apart, so hills tens of metres across cannot exist in it at all. The
 * patch is the metre-scale surface the player actually stands on; the planet
 * carries everything beyond it.
 */
export const TERRAIN_PATCH_RADIUS_M = 90;

/** Lift that keeps the patch above the sphere it covers, avoiding z-fighting. */
const TERRAIN_SKIN_M = 0.02;

/**
 * Relief fades to zero at the patch rim so the patch meets the planet sphere
 * exactly: no step at the edge, no seam to look at.
 */
export function terrainReliefScale(x: number, z: number): number {
  const radius = Math.hypot(x, z);
  const inner = TERRAIN_PATCH_RADIUS_M * 0.72;
  if (radius <= inner) return 1;
  if (radius >= TERRAIN_PATCH_RADIUS_M) return 0;
  const t = 1 - (radius - inner) / (TERRAIN_PATCH_RADIUS_M - inner);
  return t * t * (3 - 2 * t);
}

/**
 * Relief at a position, faded out towards the patch rim.
 *
 * Raise-only: hills sit on the sphere and nothing cuts below it. The sphere is
 * also the physics floor across the whole planet, so any dip below it would be
 * a hole the player can stand at the bottom of, floating over the visible
 * ground. Bumps above it are covered by the terrain collider; dips under it are
 * not representable without cutting the collider itself.
 */
export function terrainRelief(x: number, z: number, amplitude: number): number {
  const scale = terrainReliefScale(x, z);
  if (scale <= 0) return 0;
  const unit = (terrainOffset(x, z, 1) + 1) * 0.5;
  return unit * amplitude * scale + TERRAIN_SKIN_M;
}

/**
 * Surface height at (x, z) including the terrain displacement. Placement code
 * must use this rather than the bare sphere, or plants sink into the swells.
 */
export function planetTerrainY(radius: number, x: number, z: number, amplitude: number): number {
  const relief = amplitude > 0 ? terrainRelief(x, z, amplitude) : 0;
  return planetSurfaceY(radius, x, z) + relief;
}

/**
 * The planet's surface, and therefore the whole traversable ground. Its pole is
 * at y = 0, which is where the play area's tangent plane is. One sphere means
 * one surface: there is no cap to end, no seam where two grounds meet, and no
 * edge that stops the player.
 *
 * `amplitude` displaces every vertex along its own radius by the shared terrain
 * noise, so the ground has real relief. Tessellation is high because this is
 * the only ground geometry: at 256 × 128 the chords stay far below eye height
 * on a planet-sized radius and the voronoi of the noise is resolved properly.
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
 * The metre-scale ground of the play area: a grid that follows the sphere and
 * carries the relief, in the planet mesh's own local space. Same material as
 * the planet so the soil shader, the Root Sight cavity and the lighting apply
 * to it identically; it only adds geometry where the player can see it.
 */
export function createTerrainPatch(
  radius: number,
  amplitude: number,
  material: THREE.Material,
  segments = 96,
): THREE.Mesh {
  const extent = TERRAIN_PATCH_RADIUS_M * 2;
  const geometry = new THREE.PlaneGeometry(extent, extent, segments, segments);
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
    positions.setY(i, sphereY + terrainRelief(x, z, amplitude));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'planet-terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/**
 * The dirt under the surface: a second sphere one soil depth below the ground,
 * so a Root Sight opening lands on real geometry instead of a shaded hole. It
 * is low-poly and only visible while Root Sight is open — it cannot be seen
 * from the surface, and there is no point paying for it the rest of the time.
 */
export function createSubsoil(radius: number, depth: number, material: THREE.Material): THREE.Mesh {
  const innerRadius = Math.max(radius * 0.5, radius - Math.max(depth, 0.05));
  const geometry = new THREE.SphereGeometry(innerRadius, 128, 64);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'planet-subsoil';
  // Concentric with the planet, not resting its own pole on the surface: the
  // floor of the dirt layer has to sit `depth` metres below the ground
  // everywhere, which means the same centre as the planet and a smaller radius.
  mesh.position.y = -radius;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.visible = false;
  return mesh;
}
