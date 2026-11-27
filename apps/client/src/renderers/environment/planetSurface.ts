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
  terrainValueNoise,
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

/**
 * Up at (x, z), with world up as the flat world's answer.
 *
 * `planetUp` needs a radius to curve around; at radius 0 the ground is a plane
 * and its up is world +Y. The growth aim's starting normal and the ring frame it
 * has to agree with both decide between those two every frame, so the fallback
 * lives here once instead of in each of them.
 */
export function surfaceUpAt(radius: number, x: number, z: number): THREE.Vector3 {
  return Number.isFinite(radius) && radius > 0
    ? planetUp(radius, x, z)
    : new THREE.Vector3(0, 1, 0);
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

/**
 * How far the coarse ring sits below the fine patch at their shared edge, in
 * metres.
 *
 * A seam is a boundary two meshes share. The old patches sampled independent
 * grids and then tried to hide the millimetre gap between their edges with an
 * overlap. That is a coverage trick, not a closed surface: it works only while
 * the upper sheet covers the lower one. The fixed-radius rings now share their
 * boundary vertices with the sheet inside them and are triangulated from that
 * exact loop outward. Both sides evaluate the same height at the same point, so
 * the edge is one line, not two nearly equal lines. No sheet passes under
 * another and no sink or skirt is needed at a fixed seam.
 */
export const TERRAIN_EDGE_SEGMENTS = 256;

/**
 * How far the soil slab's walls stand inside the fine patch's edge, in metres.
 *
 * The slab used to be built to exactly the patch's own square, so its walls rose
 * to the terrain surface *at the level of detail seam*. The old rings sampled a
 * different grid, so wherever the ring interpolated a little above the patch a
 * vertical slice of the wall showed above the ground - and a wall is a century of
 * strata, so the seam read as a knife cut through sideways layers (play-test
 * 2026-11-26). Four metres in, the wall's top edge is under flat-ish interior
 * ground, on the wrong side of the seam, where nothing can peek over it.
 */
export const SOIL_SLAB_INSET_M = 4;

/**
 * How far the slab's top edge sits under the visible surface, in metres.
 *
 * Its walls have to meet the ground, but a top edge that is level with it pokes
 * through wherever a wall segment spans a dip in the surface. A centimetre of
 * sink keeps the joint buried and is far too small to see from inside the earth.
 */
export const SOIL_SLAB_SINK_M = 0.01;

/**
 * The detailed ground is one fixed mesh over the playable disc.
 *
 * The old square sheets were selected by the camera: four representations of
 * the same field, each with its own edge. This disc is the whole play area at
 * one resolution, built once, with the same height function the server samples.
 * Two metres per cell at 620 m is about 600k vertices - large, but it is one
 * draw, one geometry and no LOD boundary anywhere inside the world.
 */
export const PLAY_DISK_CELL_M = 2;

export interface PlayDiskOptions {
  radiusM: number;
  field: TerrainFieldParams;
  material: THREE.Material;
  playRadiusM?: number;
  cellSizeM?: number;
  skinM?: number;
}

/**
 * One circular ground mesh covering the playable radius, with a buried rim
 * wall so the seam against the static globe is never a visible edge.
 *
 * The rim wall is part of the same geometry: one BufferGeometry and one draw,
 * not a skirt mesh to manage. Its top ring is the disc's own edge vertex for
 * vertex, so there is no gap between the surface and the wall.
 */
export function createPlayDisk(options: PlayDiskOptions): THREE.Mesh {
  const radius = Math.max(1, options.radiusM);
  const outer = Math.max(8, options.playRadiusM ?? 620);
  const cell = Math.max(1, options.cellSizeM ?? PLAY_DISK_CELL_M);
  const rings = Math.max(8, Math.ceil(outer / cell));
  const segments = Math.max(64, Math.ceil((Math.PI * 2 * outer) / cell));
  const skinM = options.skinM ?? TERRAIN_SKIN_M;
  const heightAt = (x: number, z: number): number =>
    patchLocalSurfaceY(radius, x, z, options.field, skinM);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const step = 0.5;
  const pushNormal = (x: number, z: number): void => {
    const dx = heightAt(x - step, z) - heightAt(x + step, z);
    const dz = heightAt(x, z - step) - heightAt(x, z + step);
    const length = Math.hypot(dx, 2 * step, dz) || 1;
    normals.push(dx / length, (2 * step) / length, dz / length);
  };

  // Centre, then concentric rings. Every ring has the same segment count, so
  // the triangles have no T-junctions anywhere inside the disc - the seam
  // closure the old square ring worked for is simply not needed.
  const centreHeight = heightAt(0, 0);
  positions.push(0, centreHeight, 0);
  normals.push(0, 1, 0);
  uvs.push(0.5, 0.5);
  for (let ring = 1; ring <= rings; ring += 1) {
    const ringRadius = (outer * ring) / rings;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const x = Math.cos(angle) * ringRadius;
      const z = Math.sin(angle) * ringRadius;
      positions.push(x, heightAt(x, z), z);
      pushNormal(x, z);
      uvs.push((x / outer + 1) * 0.5, (z / outer + 1) * 0.5);
    }
  }

  const ringStart = (ring: number): number => 1 + (ring - 1) * segments;
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(0, 1 + next, 1 + segment);
  }
  for (let ring = 1; ring < rings; ring += 1) {
    const inner = ringStart(ring);
    const outerRing = ringStart(ring + 1);
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      indices.push(inner + segment, inner + next, outerRing + segment);
      indices.push(inner + next, outerRing + next, outerRing + segment);
    }
  }

  // The rim wall, in the same geometry. The static globe is a polyhedron and
  // sits a few metres inside the exact sphere at this radius; four metres of
  // buried wall covers that and the skin without a second mesh or a visible
  // line at the disc's edge.
  const rimTop = ringStart(rings);
  const bottom = positions.length / 3;
  for (let segment = 0; segment < segments; segment += 1) {
    const topIndex = rimTop + segment;
    const x = positions[topIndex * 3];
    const topY = positions[topIndex * 3 + 1];
    const z = positions[topIndex * 3 + 2];
    positions.push(x, topY - 8, z);
    const length = Math.hypot(x, z) || 1;
    normals.push(x / length, 0, z / length);
    uvs.push(segment / segments, 1);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    const top = rimTop + segment;
    const topNext = rimTop + next;
    indices.push(top, topNext, bottom + segment);
    indices.push(topNext, bottom + next, bottom + segment);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute(
    'aSurfaceCut',
    new THREE.BufferAttribute(new Float32Array(positions.length / 3).fill(1), 1),
  );
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, options.material);
  mesh.name = 'planet-play-disk';
  mesh.position.y = radius;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.playRadiusM = outer;
  mesh.userData.playDiskCellM = cell;
  mesh.userData.playDiskRings = rings;
  mesh.userData.playDiskSegments = segments;
  return mesh;
}

/**
 * A circular ring of ground from an inner radius to an outer radius.
 *
 * Its first row can reuse the play disc's own angular resolution, which lets
 * the ring start on the disc's rim vertex for vertex. Heights come from the
 * caller so the ring can blend the authored near surface into the global
 * planet field without owning either field itself. The outer edge has a short
 * inward lip so it disappears under the coarser globe instead of ending in a
 * visible cut.
 */
export interface SurfaceRingOptions {
  innerRadiusM: number;
  outerRadiusM: number;
  segments: number;
  rows?: number;
  heightAt: (x: number, z: number) => number;
  material: THREE.Material;
  lipDepthM?: number;
  name?: string;
}

export function createSurfaceRing(options: SurfaceRingOptions): THREE.Mesh {
  const inner = Math.max(0, options.innerRadiusM);
  const outer = Math.max(inner + 1e-3, options.outerRadiusM);
  const segments = Math.max(8, Math.min(4096, Math.round(options.segments)));
  const rows = Math.max(1, Math.min(256, Math.round(options.rows ?? 48)));
  const lipDepth = Math.max(0, options.lipDepthM ?? 0);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Quadratic row spacing: the first cells are only a few metres wide at the
  // disc rim, where the eye can be, and grow towards the coarse globe. A
  // linear ring would put the first radial step hundreds of metres wide there.
  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows;
    const radius = inner + (outer - inner) * t * t;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      positions.push(x, options.heightAt(x, z), z);
      uvs.push((x / outer + 1) * 0.5, (z / outer + 1) * 0.5);
    }
  }

  for (let row = 0; row < rows; row += 1) {
    const innerRow = row * segments;
    const outerRow = (row + 1) * segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = innerRow + segment;
      const b = innerRow + next;
      const c = outerRow + segment;
      const d = outerRow + next;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  // A short wall at the far edge, facing outward. The coarse globe is sampled
  // at 1.5 km triangles and can sit a few metres above or below the ring's own
  // exact global height; the lip keeps a sky sliver from appearing between them.
  if (lipDepth > 0) {
    const outerStart = rows * segments;
    const lipStart = positions.length / 3;
    for (let segment = 0; segment < segments; segment += 1) {
      const index = outerStart + segment;
      const x = positions[index * 3];
      const z = positions[index * 3 + 2];
      positions.push(x, positions[index * 3 + 1] - lipDepth, z);
      uvs.push((x / outer + 1) * 0.5, 1);
    }
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const top = outerStart + segment;
      const topNext = outerStart + next;
      indices.push(top, topNext, lipStart + segment);
      indices.push(topNext, lipStart + next, lipStart + segment);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const normals = new Float32Array(positions.length);
  const step = 0.5;
  const surfaceCount = (rows + 1) * segments;
  for (let index = 0; index < surfaceCount; index += 1) {
    const x = positions[index * 3];
    const z = positions[index * 3 + 2];
    const dx = options.heightAt(x - step, z) - options.heightAt(x + step, z);
    const dz = options.heightAt(x, z - step) - options.heightAt(x, z + step);
    const length = Math.hypot(dx, 2 * step, dz) || 1;
    normals[index * 3] = dx / length;
    normals[index * 3 + 1] = (2 * step) / length;
    normals[index * 3 + 2] = dz / length;
  }
  // The lip is a wall, not another sample of the ground: give it the outward
  // radial normal the rim wall of the play disc uses.
  for (let index = surfaceCount; index < positions.length / 3; index += 1) {
    const x = positions[index * 3];
    const z = positions[index * 3 + 2];
    const length = Math.hypot(x, z) || 1;
    normals[index * 3] = x / length;
    normals[index * 3 + 2] = z / length;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute(
    'aSurfaceCut',
    new THREE.BufferAttribute(new Float32Array(positions.length / 3).fill(1), 1),
  );
  geometry.setAttribute(
    'aFarRelief',
    new THREE.BufferAttribute(new Float32Array(positions.length / 3), 1),
  );
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, options.material);
  mesh.name = options.name ?? 'planet-surface-ring';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/**
 * Height of the hills past the authored patch, in metres.
 *
 * The patch fades its relief to zero at its own rim so the fine ground meets
 * the smooth planet with no step - which is right where the player walks, and
 * wrong where the eye looks: past 620 m the world became a bare arc, and the
 * horizon read as a drawn line rather than a skyline (S30). This is the relief
 * that carries on out there: three octaves of the same value noise the field
 * uses, at wavelengths of hundreds of metres, so the far ground has hills big
 * enough to break the arc and no detail finer than the far mesh can draw.
 *
 * It is a landmass now, not a shoal. These hills were sunk under sea level by
 * one metre for a while, which left the play area an island a few hundred
 * metres across in an infinite teal sheet: from three kilometres the whole world
 * was water with one thin strip of sand in it, and from orbit the only feature
 * over the pole was the sea's own hole. At eighty metres the world sits on a
 * real island - high ground, valleys, a coast where the field crosses the sea
 * level at four to six kilometres - so what is under the plant is also what the
 * planet is made of. The troughs still dip to the sphere, which only deepens the
 * water in an inlet.
 */
export const FAR_FIELD_RELIEF_M = 80;
/** Metres the far hills are sunk below their noise floor. */
export const FAR_FIELD_SINK_M = 0;

/**
 * Where the far field starts growing in, and how far it takes to be full.
 *
 * The distance is measured to the *square* the ring's hole cuts, not to a
 * radius: the ring is a square patch, so a vertex on its edge at (620, 300) is
 * 688 m from the centre but exactly on the seam, and blending by radius would
 * lift it almost a metre above the ring it has to meet. Measured this way the
 * far field is exactly zero along the whole edge - every side and every corner -
 * and the two meshes share the bare sphere there.
 */
export function farFieldRelief(x: number, z: number, field: TerrainFieldParams): number {
  const radius = Math.max(20, field.patchRadiusM);
  const distance = Math.max(Math.abs(x), Math.abs(z));
  if (!Number.isFinite(distance) || distance <= radius) return 0;
  const t = Math.min(1, (distance - radius) / (radius * 0.9));
  const blend = t * t * (3 - 2 * t);
  const seed = (field.seed ^ 0x2f6e2b1) | 0;
  const octave = (wavelength: number, offset: number, weight: number): number =>
    weight *
    terrainValueNoise(
      x / wavelength + offset,
      z / wavelength - offset * 0.7,
      seed + Math.round(offset * 131),
    );
  const noise = Math.min(
    1,
    Math.max(0, octave(900, 0.31, 0.55) + octave(420, 2.7, 0.28) + octave(210, 7.9, 0.17)),
  );
  // The mesh ends at 6 km. Fade the outer relief to the bare sphere so the
  // square edge is under the sea and can never be seen as a cut cliff - and do
  // it by radius, not by the square's own max axis: faded by max, every side
  // still ends at the same square and the whole island cluster reads as a
  // stamped block from orbit. A radial shore leaves an archipelago.
  const edge = 1 - Math.min(1, Math.max(0, (Math.hypot(x, z) - 4200) / 1400));
  const edgeBlend = edge * edge * (3 - 2 * edge);
  return blend * edgeBlend * (1.5 + FAR_FIELD_RELIEF_M * noise - FAR_FIELD_SINK_M);
}

/**
 * Relief at a position: the authored field inside the patch, plus the far
 * hills outside it. One function, so the ground, the water solved on it and
 * everything placed on it agree about where the surface is.
 */
export function terrainRelief(x: number, z: number, field: TerrainFieldParams): number {
  const near = terrainHeightAt(field, x, z);
  if (!(field.amplitudeM > 0)) return near;
  return near + farFieldRelief(x, z, field);
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
/**
 * Facets around the planet body's equator.
 *
 * 256 left the body's facets 7.5 m inside the true sphere at a 100 km radius,
 * and the far patch - built on the exact sphere - ended over that step. 384
 * nearly halves the sag, and the skirt is sized from `planetFacetSag` at this
 * same number, so the two cannot drift apart.
 */
export const PLANET_BODY_SEGMENTS = 384;

export function createPlanetBody(
  radius: number,
  material: THREE.Material,
  widthSegments = PLANET_BODY_SEGMENTS,
  heightSegments = PLANET_BODY_SEGMENTS / 2,
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'planet-surface';
  mesh.position.y = -radius;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/**
 * How far inside the true sphere the body's widest facets sit, in metres.
 *
 * A sphere mesh is a polyhedron: every flat face is a chord, and the chord sags
 * towards the centre by `radius · (1 − cos(π / segments))`. At the shipped
 * radius that is metres, not millimetres, and the ground patches are built on
 * the *exact* sphere - so at the patch's outer edge the body's first facet can
 * stand below it, a step down into nothing. The skirt is sized from this number
 * rather than from a guess.
 */
export function planetFacetSag(radius: number, segments: number): number {
  const n = Math.max(3, Math.round(segments));
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  return radius * (1 - Math.cos(Math.PI / n));
}

/**
 * A wall hanging from a square ground patch's edge, down far enough to meet the
 * planet body underneath it.
 *
 * The ground patches are built on the exact sphere; the body is a polyhedron and
 * its facets sit *inside* that sphere, by `planetFacetSag`. At the far patch's
 * outer edge the two surfaces therefore part company - the coarse ground ends and
 * the body is metres lower - and an eye at that edge, or the camera looking along
 * it, saw the patch floating over a gap. The skirt closes that step with the same
 * height function the patch uses, so its top edge is the patch's own edge and its
 * bottom is buried in the body.
 */
export function createTerrainSkirt(
  radius: number,
  field: TerrainFieldParams,
  material: THREE.Material,
  extentM: number,
  skinM: number,
  depthM: number,
  segments = 64,
  name = 'planet-terrain-skirt',
): THREE.Mesh {
  const half = Math.max(1, extentM) / 2;
  const steps = Math.max(8, Math.round(segments));
  const depth = Math.max(0.5, depthM);
  const topY = (x: number, z: number): number => patchLocalSurfaceY(radius, x, z, field, skinM);

  // One closed loop round the square, counter-clockwise from above, the same
  // walk the soil slab's walls take, so the quads face outwards.
  const loop: { x: number; z: number }[] = [];
  for (let i = 0; i < steps; i += 1) loop.push({ x: -half + (2 * half * i) / steps, z: -half });
  for (let i = 0; i < steps; i += 1) loop.push({ x: half, z: -half + (2 * half * i) / steps });
  for (let i = 0; i < steps; i += 1) loop.push({ x: half - (2 * half * i) / steps, z: half });
  for (let i = 0; i < steps; i += 1) loop.push({ x: -half, z: half - (2 * half * i) / steps });

  const count = loop.length;
  const positions: number[] = [];
  for (const point of loop) positions.push(point.x, topY(point.x, point.z), point.z);
  for (const point of loop) positions.push(point.x, topY(point.x, point.z) - depth, point.z);
  const indices: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    indices.push(i, count + i, next, next, count + i, count + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  // The patch's own placement: patch-local metres, cancelled by the body's
  // `-radius`, so the skirt joins the patch it hangs from in world space.
  mesh.position.y = radius;
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
 * `extentM` is the full width of the square. A ring around it is built by
 * `createTerrainRing`, whose inner edge is this square's edge.
 */
export function createTerrainPatch(
  radius: number,
  field: TerrainFieldParams,
  material: THREE.Material,
  segments = 96,
  extentM = 180,
  skinM = TERRAIN_SKIN_M,
  reliefAt?: (x: number, z: number) => number,
): THREE.Mesh {
  const extent = Math.max(1, extentM);
  const divisions = Math.max(2, Math.min(256, Math.round(segments)));
  const geometry = new THREE.PlaneGeometry(extent, extent, divisions, divisions);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  // One surface function for the patch and the ring outside it. Heights and
  // normals both read this, with a fixed world-space step, so a shared boundary
  // point agrees at any tessellation.
  const heightAt = (x: number, z: number): number =>
    patchLocalSurfaceY(radius, x, z, field, skinM) + (reliefAt ? reliefAt(x, z) : 0);
  for (let i = 0; i < positions.count; i += 1) {
    positions.setY(i, heightAt(positions.getX(i), positions.getZ(i)));
  }
  positions.needsUpdate = true;

  // Normals from the same height function, with one fixed step. The step is in
  // metres, not in cells, so a patch and the ring outside it answer with the
  // same normal at a shared boundary point; the seam is not a lighting edge even
  // though the two meshes have different interior spacing.
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
/**
 * The square ring between two concentric squares, with the inner loop sampled
 * at exactly the same points as the sheet that fills it.
 *
 * This is the seam closure. The ring does not start at a separately sampled
 * grid just inside the inner square: its first loop is the inner square's own
 * boundary, point for point, and every further loop is mapped outward from that
 * loop. The two meshes therefore meet along one polyline with no T-junction and
 * no overlap, so there is no hairline to cover and nothing to sink.
 *
 * `edgeSegments` is the number of intervals on each side, including the inner
 * and outer loops. A square loop has `4 * edgeSegments` vertices: one corner
 * starts each side, and the closing edge runs back to the first corner.
 */
export function createTerrainRing(
  radius: number,
  field: TerrainFieldParams,
  material: THREE.Material,
  innerHalfM: number,
  outerHalfM: number,
  edgeSegments = TERRAIN_EDGE_SEGMENTS,
  radialRows = 48,
  skinM = TERRAIN_SKIN_M,
  reliefAt?: (x: number, z: number) => number,
  name = 'planet-terrain-ring',
): THREE.Mesh {
  const inner = Math.max(0, innerHalfM);
  const outer = Math.max(inner + 1e-3, outerHalfM);
  const segments = Math.max(8, Math.min(512, Math.round(edgeSegments)));
  const rows = Math.max(1, Math.min(256, Math.round(radialRows)));
  const loopCount = segments * 4;
  const heightAt = (x: number, z: number): number =>
    patchLocalSurfaceY(radius, x, z, field, skinM) + (reliefAt ? reliefAt(x, z) : 0);

  const point = (half: number, index: number, target: THREE.Vector3): THREE.Vector3 => {
    const side = Math.floor(index / segments);
    const f = (index % segments) / segments;
    switch (side) {
      case 0:
        return target.set(-half + 2 * half * f, 0, -half);
      case 1:
        return target.set(half, 0, -half + 2 * half * f);
      case 2:
        return target.set(half - 2 * half * f, 0, half);
      default:
        return target.set(-half, 0, half - 2 * half * f);
    }
  };

  const positions: number[] = [];
  const uvs: number[] = [];
  const scratch = new THREE.Vector3();
  for (let row = 0; row <= rows; row += 1) {
    const half = inner + ((outer - inner) * row) / rows;
    for (let i = 0; i < loopCount; i += 1) {
      point(half, i, scratch);
      positions.push(scratch.x, heightAt(scratch.x, scratch.z), scratch.z);
      uvs.push((scratch.x / outer + 1) * 0.5, (scratch.z / outer + 1) * 0.5);
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    const innerRow = row * loopCount;
    const outerRow = (row + 1) * loopCount;
    for (let i = 0; i < loopCount; i += 1) {
      const next = (i + 1) % loopCount;
      const a = innerRow + i;
      const b = innerRow + next;
      const c = outerRow + i;
      const d = outerRow + next;
      // The loop above runs counter-clockwise seen from +Y, and the next row is
      // farther out, so this order faces up. The other order makes the ring a
      // one-sided sheet seen from below: a black band exactly on the seam.
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  // Same fixed-world-step normals as the patch inside it, so the two meshes
  // agree at the shared loop instead of lighting it as a crease.
  const normals = new Float32Array(positions.length);
  const step = 0.5;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    const dx = heightAt(x - step, z) - heightAt(x + step, z);
    const dz = heightAt(x, z - step) - heightAt(x, z + step);
    const length = Math.hypot(dx, 2 * step, dz) || 1;
    normals[i] = dx / length;
    normals[i + 1] = (2 * step) / length;
    normals[i + 2] = dz / length;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.y = radius;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.terrainEdgeSegments = segments;
  mesh.userData.terrainRadialRows = rows;
  return mesh;
}

/**
 * Full width of the coarse ring, in metres: the patch radius doubled. Exported
 * so a caller building a ring's outer edge uses the same square.
 */
export function terrainOuterExtentM(field: TerrainFieldParams): number {
  return Math.max(20, field.patchRadiusM) * 2;
}

/**
 * Full width of the far field, in metres: six kilometres across, so its edges
 * are past the horizon from any eye on the play area and no edge can be seen.
 */
export const FAR_FIELD_EXTENT_M = 6000;

/** Half-width of the high-detail authored sheet around the play area. */
export const TERRAIN_DETAIL_HALF_EXTENT_M = 180;

/**
 * The ground from the edge of the authored patch to the horizon.
 *
 * Its inner loop is the outer ring's own outer loop, point for point, and the
 * first radial row starts there. At 620 m the relief is zero, so the two rings
 * share the bare sphere as well as the boundary. Its cells are about forty
 * metres now: at the old hundred-metre grid the 210 m hills were two samples
 * wide, so the coast came out as stair-steps and straight facets - the "blocky
 * islands" at 10 km.
 */
export function createTerrainFarField(
  radius: number,
  field: TerrainFieldParams,
  material: THREE.Material,
  segments = TERRAIN_EDGE_SEGMENTS,
  reliefAt?: (x: number, z: number) => number,
): THREE.Mesh {
  return createTerrainRing(
    radius,
    field,
    material,
    terrainOuterExtentM(field) / 2,
    FAR_FIELD_EXTENT_M / 2,
    Math.max(8, Math.round(segments)),
    64,
    TERRAIN_SKIN_M,
    reliefAt,
    'planet-terrain-horizon',
  );
}

/**
 * Rebuild the horizon with the planet-wide relief included.
 *
 * The horizon is created before the global field exists (it is part of the
 * authored ground), so its first geometry knows only the near field. Once the
 * relief parameters are known, the same mesh is given the combined field in
 * place: same radius, same square, same material, one extra height term. Without
 * this the horizon ends at six kilometres as a flat plain while the chunk tree
 * immediately outside it stands on the global hills - the square shade the
 * player sees from ten kilometres up.
 */
export function retargetTerrainFarField(
  mesh: THREE.Mesh,
  radius: number,
  field: TerrainFieldParams,
  reliefAt: (x: number, z: number) => number,
  segments = 256,
): void {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!material) return;
  // Keep the shared boundary loop: rebuilding at another segment count would
  // move the inner edge off the ring it is welded to and open the seam again.
  const edgeSegments = Number(mesh.userData.terrainEdgeSegments) || segments;
  const rebuilt = createTerrainFarField(radius, field, material, edgeSegments, reliefAt);
  mesh.geometry.dispose();
  mesh.geometry = rebuilt.geometry;
  mesh.userData.terrainEdgeSegments = edgeSegments;
  mesh.userData.terrainRadialRows = rebuilt.userData.terrainRadialRows;
}

export function createTerrainPatches(
  radius: number,
  field: TerrainFieldParams,
  material: THREE.Material,
  innerSegments: number,
): { inner: THREE.Mesh; outer: THREE.Mesh; horizon: THREE.Mesh } {
  const patchRadius = Math.max(20, field.patchRadiusM);
  const innerExtent = Math.min(TERRAIN_DETAIL_HALF_EXTENT_M, patchRadius * 2);
  // Every fixed boundary uses one loop count. The inner sheet, the ring around
  // it and the horizon ring are all triangulated from that same loop, so their
  // shared edges are coincident vertex for vertex. The config used to set only
  // the inner sheet's divisions, which is why the ring needed an overlap.
  const edgeSegments = Math.max(
    128,
    Math.min(TERRAIN_EDGE_SEGMENTS, Math.round(innerSegments) * 2),
  );
  const inner = createTerrainPatch(
    radius,
    field,
    material,
    edgeSegments,
    innerExtent,
    TERRAIN_SKIN_M,
  );
  inner.name = 'planet-terrain-detail';
  // No centre, no sink, no overlap: the ring's first loop is the inner sheet's
  // boundary, and it fans outward from there.
  const outer = createTerrainRing(
    radius,
    field,
    material,
    innerExtent / 2,
    terrainOuterExtentM(field) / 2,
    edgeSegments,
    48,
    TERRAIN_SKIN_M,
    undefined,
    'planet-terrain-far',
  );
  // The far field: hills from the ring's edge out past the horizon, so the
  // skyline is relief rather than the planet's own smooth arc. Its inner loop is
  // the outer ring's outer loop, at the same edge count and the same heights.
  const horizon = createTerrainFarField(radius, field, material, edgeSegments);
  return { inner, outer, horizon };
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
