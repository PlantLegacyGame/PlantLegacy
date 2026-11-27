/**
 * The planet-wide sea.
 *
 * It used to be a sphere of `planetRadius + seaLevel` centred on the body. One
 * surface for the whole world is the right model, but a tessellated sphere of a
 * 100 km radius with the segment counts a real-time mesh can afford sags badly:
 * its polar cap is a chord between the pole and the first ring, so 900 m out the
 * water sat ~17 m *below* the terrain that should have been under it, and the
 * ground covered the sea everywhere past the local patches.
 *
 * So the sea is built as a dome instead: a radial grid in the play area's own
 * tangent plane whose height is the sphere's exact curvature,
 *
 *     y = seaLevel - r^2 / (2 * planetRadius),
 *
 * with rings packed where the eye is. The height is analytic, so there is no
 * chord to sink below the ground, and one mesh covers everything the camera can
 * see - no sheet edge, no LOD seam, no reachable place without water. Its
 * coastline is not authored: the terrain is drawn at the same radius, so a shore
 * is wherever the ground rises through the dome.
 *
 * The sea carries its own bed height field. The water field's grids are sized for
 * the rain sheet (180 m of fine ground, 560 m of coarse), which leaves the shore
 * most players actually look at - the plateau rim 600 m out - with no depth
 * sample at all: every fragment there fell back to one constant column, and the
 * whole ocean shaded as a single flat grey band. This grid is sampled out to
 * 900 m so the shader knows the shelf from the basin all the way to the horizon,
 * which is what gives it a shallow-to-deep gradient and a foam line on the shore.
 */
import * as THREE from 'three';
import { worldColour } from '../worldPalette.ts';
import {
  DEFAULT_WATER_COLORS,
  type WaterColors,
  type WaterFieldTuning,
} from './waterFieldTuning.js';
import { createWaterMaterial, type WaterMaterial } from './waterMaterial.js';

/**
 * Arc distance from the pole, in metres, kept out of the planet-wide sea.
 *
 * It was cut away once, at eleven kilometres, because the local dome owns that
 * piece - and from orbit the cut was a hole in the world's water with the bare
 * shell showing through it: a grey ring at the pole, which is what a player
 * zooming in from space saw instead of their own island. Cutting it smaller only
 * made a smaller ring, so the sphere is whole again and the *dome* is the patch
 * at the pole: it sits a few centimetres proud of the sphere's own level, which
 * is enough for the depth test to prefer it wherever the two overlap.
 */
export const PLANET_SEA_POLE_HOLE_M = 0;

export interface PlanetSea {
  mesh: THREE.Mesh;
  material: WaterMaterial;
  /**
   * Radius of the water sphere about the body's centre, metres. The sea's
   * surface over any column is this sphere, which is the only exact answer
   * away from the pole: the local dome's parabola is four hundred metres out
   * at forty kilometres.
   */
  radiusM: number;
}

export interface Ocean {
  mesh: THREE.Mesh;
  material: WaterMaterial;
  /**
   * The sea's bed height around the play area, packed the way the water shaders
   * read it. The orbital shell samples the same texture: above 25 km the dome is
   * not drawn, and the coast on the shell is this coast.
   */
  bed: { texture: THREE.Texture; min: number; span: number; halfM: number };
  /**
   * Height of the sea over a point on the tangent plane, metres. The dome is the
   * planet's curvature, so this is what an eye at that column is under.
   */
  seaSurfaceYAt(x: number, z: number): number;
}

/** Water column the open sea uses beyond the bed grid's reach, metres. */
const OPEN_SEA_DEPTH_M = 12;
/**
 * How far the dome reaches, metres.
 *
 * It used to stop at 2.6 km, and every eye above the plateau saw the sea end in
 * a hard arc of sky-coloured cut geometry - the "the ocean disappears when the
 * camera is a bit high" report, which is why it was pushed out to 150 km. That
 * reach is no longer needed: the planet-wide sea covers the rest of the body, so
 * a dome past the local shelf was a second water sheet lying over the first -
 * and at 100 km from the pole the two crossed, which drew one straight line
 * across the surface wherever the eye looked. Fourteen kilometres is past the
 * authored shelf and still agrees with the sphere to under a metre.
 */
export const OCEAN_DOME_REACH_M = 6_200;
const OCEAN_RINGS = 96;
const OCEAN_SPOKES = 128;
/**
 * Half-extent of the sea's own bed height field, and its resolution.
 *
 * It reaches past the visible shore and the near islands (the plateau rim is
 * 600 m out, the water runs to about 1.3 km, the first far-field islands are at
 * 2-3 km) so the shore and the shader's foam band exist there too. Ten-metre
 * texels: fine enough for a beach at play range, coarse enough to build once.
 */
const BED_HALF_M = 6000;
const BED_CELLS = 1024;

type SeaTuning = Pick<
  WaterFieldTuning,
  'seaLevelM' | 'colors' | 'seaWaveStrength' | 'seaWaveScaleM' | 'seaFoamWidthM' | 'absorptionPerM'
>;

/** Ground height under the sea, packed the way the water shaders read it. */
function buildHeightTexture(
  bedYAt: (x: number, z: number) => number,
  halfM: number,
  cells: number,
): {
  texture: THREE.DataTexture;
  min: number;
  span: number;
} {
  const n = cells;
  const heights = new Float32Array(n * n);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const cell = (halfM * 2) / (n - 1);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const y = bedYAt(-halfM + i * cell, -halfM + j * cell);
      heights[j * n + i] = y;
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }
  const span = Math.max(0.001, max - min);
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < heights.length; i += 1) {
    const value = Math.round(((heights[i] - min) / span) * 255);
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  // The bed is read at up to ten kilometres, where one texel is smaller than a
  // pixel: without a mip chain the far waterline aliased into the streaky,
  // ragged coast the eye reads as a bad mesh. The chain costs 1.3 MB and the
  // shader's own derivatives pick the level.
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, min, span };
}

export function createOcean(
  planetRadiusM: number,
  seaLevelM: number,
  colors: WaterColors = DEFAULT_WATER_COLORS,
  bedYAt: ((x: number, z: number) => number) | null = null,
  tuning: Partial<SeaTuning> = {},
): Ocean {
  // Edge fade is what carries the shore treatment below, so the sea must be built
  // with it; without it the ocean had neither a waterline nor a foam band and
  // ended in the dome's own outline.
  const material = createWaterMaterial({ edgeFade: true });
  // The water ramp is tuned for a film over soil, where a shallow sheet is the
  // thing you see. An open sea is a body: the light that goes in does not come
  // back, so the deep role is darkened here rather than in the palette the
  // puddles read. Without it the ocean was a pale grey wash at every height.
  material.deepColor.copy(worldColour(colors.deep)).multiplyScalar(0.62);
  material.shallowColor.copy(worldColour(colors.shallow));
  material.skyColor.copy(worldColour(colors.sky));
  const uniforms = material.material.uniforms;
  uniforms.uOpacity.value = 0.94;
  uniforms.uOceanMode.value = 1;
  uniforms.uOceanDepthM.value = OPEN_SEA_DEPTH_M;
  uniforms.uAbsorption.value = tuning.absorptionPerM ?? 1;
  uniforms.uSeaFoamM.value = tuning.seaFoamWidthM ?? 0.9;
  // One ripple train at a puddle's wavelength was most of why the sea looked
  // flat; the shader adds swell and chop on top of it in ocean mode.
  uniforms.uRippleStrength.value = tuning.seaWaveStrength ?? 1.5;
  uniforms.uRippleScale.value.setScalar(2 / Math.max(0.5, tuning.seaWaveScaleM ?? 5.5));
  // A sea reflects the sky it sits under, not the water it is made of. The
  // sheet's default sky is the pale water role (right for a puddle, which takes
  // the colour of the sky it mirrors at a metre across), but over kilometres the
  // sea read as a dark teal band with a hard top edge against a bright horizon.
  // Mirroring the sky's own horizon role is what makes open water meet the air.
  material.skyColor.copy(worldColour('sky_horizon'));
  // The dome is past the horizon at every play altitude, so the sea must not
  // fade before its rim: a 2.2-2.5 km fade cut the ocean off at exactly the
  // height where a player first looks out over it. The last few kilometres are
  // the only fade left, and they sit below the horizon.
  uniforms.uFadeRange.value.set(OCEAN_DOME_REACH_M - 4000, OCEAN_DOME_REACH_M - 300);
  // A transparent surface that writes depth hides everything drawn after it. The
  // sea is drawn in front of the rain, the plant and the shore, so it must not
  // own the depth buffer: it is a single layer of the dome, and the shader
  // already picks a side from where the eye is.
  material.material.depthWrite = false;
  material.material.side = THREE.DoubleSide;

  let bed: { texture: THREE.Texture; min: number; span: number; halfM: number } | null = null;
  if (bedYAt) {
    const built = buildHeightTexture(bedYAt, BED_HALF_M, BED_CELLS);
    bed = { texture: built.texture, min: built.min, span: built.span, halfM: BED_HALF_M };
    uniforms.uGroundHeight.value = built.texture;
    uniforms.uGroundHeightAvailable.value = 1;
    (uniforms.uGroundHeightOrigin.value as THREE.Vector2).set(-BED_HALF_M, -BED_HALF_M);
    uniforms.uGroundHeightSize.value = BED_HALF_M * 2;
    (uniforms.uGroundHeightRange.value as THREE.Vector2).set(built.min, built.span);
    uniforms.uGroundCoarseAvailable.value = 0;
  }

  const radius = Math.max(1, planetRadiusM);
  const seaY = seaLevelM;
  const ringCount = OCEAN_RINGS;
  const spokeCount = OCEAN_SPOKES;
  const positions = new Float32Array((1 + ringCount * spokeCount) * 3);
  const setVertex = (index: number, r: number, angle: number): void => {
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    positions[index * 3] = x;
    // The sphere's own surface, not a plane: the world curves away, and that is
    // what puts the water's edge at the distance the skyline should be.
    positions[index * 3 + 1] = seaY - (r * r) / (2 * radius);
    positions[index * 3 + 2] = z;
  };
  setVertex(0, 0, 0);
  for (let ring = 1; ring <= ringCount; ring += 1) {
    // Rings packed towards the eye: the play area is where the shore detail and
    // the water's own shading are actually resolved.
    // 2.6 packs the rings hard towards the pole: the shore (600-1300 m) needs
    // the resolution, and the far rings are a flat curved sheet that needs none.
    const r = OCEAN_DOME_REACH_M * (ring / ringCount) ** 2.6;
    for (let spoke = 0; spoke < spokeCount; spoke += 1) {
      const angle = (spoke / spokeCount) * Math.PI * 2;
      setVertex(1 + (ring - 1) * spokeCount + spoke, r, angle);
    }
  }
  const indices: number[] = [];
  const at = (ring: number, spoke: number): number =>
    ring === 0 ? 0 : 1 + (ring - 1) * spokeCount + (spoke % spokeCount);
  for (let spoke = 0; spoke < spokeCount; spoke += 1) {
    indices.push(0, at(1, spoke + 1), at(1, spoke));
  }
  for (let ring = 1; ring < ringCount; ring += 1) {
    for (let spoke = 0; spoke < spokeCount; spoke += 1) {
      const a = at(ring, spoke);
      const b = at(ring, spoke + 1);
      const c = at(ring + 1, spoke);
      const d = at(ring + 1, spoke + 1);
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Both are read in the vertex stage. A sea is one body of water with no
  // per-cell depth of its own, so they are constants.
  const count = positions.length / 3;
  geometry.setAttribute('aWater', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
  geometry.setAttribute('aFlowUV', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material.material);
  mesh.name = 'planet-ocean';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return {
    mesh,
    material,
    bed: bed ?? {
      texture: new THREE.Texture(),
      min: 0,
      span: 1,
      halfM: BED_HALF_M,
    },
    seaSurfaceYAt: (x: number, z: number) => seaY - (x * x + z * z) / (2 * radius),
  };
}

/**
 * The sea over the whole planet, as a sphere at one level.
 *
 * The dome above is exact where it is drawn - the play area and its coast - but
 * it is a tangent-plane grid, so it cannot follow the body around the back.
 * This is the same water at planet scale: one sphere at `seaLevelM` above the
 * base radius, with its vertices at the global relief's height so the shelf and
 * the basin shade from the depth the land actually has there. Its geometry has
 * the polar cap removed, because the dome owns that piece and the two surfaces
 * would otherwise fight over it.
 *
 * The sea is not scenery the camera can climb away from: it is the surface. It
 * does not fade with altitude, so the planet is a water world from orbit as
 * well as from the shore.
 */
export function createPlanetSea(
  planetRadiusM: number,
  seaLevelM: number,
  reliefAt: (direction: THREE.Vector3) => number,
  colors: WaterColors = DEFAULT_WATER_COLORS,
  // 512 rings puts a facet near 1.2 km and its sag near two metres, which the
  // lift above covers; 256 was 2.4 km and seven metres of sag.
  segments = 512,
): PlanetSea {
  const radius = Math.max(1, planetRadiusM);
  const rings = Math.max(32, Math.round(segments));
  // A sphere of polygons is inside the sphere it stands for, and on a body this
  // size the sag is not a rounding error: a 2.4 kilometre quad on a hundred-
  // kilometre radius dips seven metres below the sphere, which put the sea
  // *under* the planet body at every quad centre. The body then poked through its
  // own ocean in a lattice of bright facets - the geometric water-and-land
  // patchwork at sixty metres, and the sharp-edged bands at low zoom. The sea is
  // fine enough now that the sag is under half a metre, and it is lifted by that
  // sag so no facet can ever fall below sea level.
  const facetArc = (2 * Math.PI * radius) / rings;
  const sagM = (facetArc * facetArc) / (8 * radius);
  // A few centimetres proud of the dome it overlaps: coplanar transparent
  // surfaces flicker, and the dome is the exact one where both exist.
  const surface = radius + seaLevelM + sagM + 0.06;
  const geometry = new THREE.SphereGeometry(surface, rings, Math.max(16, Math.round(rings / 2)));
  const position = geometry.getAttribute('position');
  const water = new Float32Array(position.count);
  const direction = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    direction.fromBufferAttribute(position, i).normalize();
    // Water column above this vertex's own ground. The shader reads it as the
    // depth, so the coast is where it reaches zero and the deep water shades
    // from the same Beer-Lambert rule every other surface uses.
    water[i] = Math.max(0, seaLevelM - reliefAt(direction));
  }
  geometry.setAttribute('aWater', new THREE.BufferAttribute(water, 1));
  geometry.setAttribute(
    'aFlowUV',
    new THREE.BufferAttribute(new Float32Array(position.count * 2), 2),
  );
  // The local dome is the sea inside the cap. Drop every triangle whose three
  // vertices are all inside it, so one piece of water is drawn by one mesh.
  const holeCos = Math.cos(Math.min(Math.PI * 0.9, PLANET_SEA_POLE_HOLE_M / radius));
  const index = geometry.getIndex();
  if (index) {
    const kept: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      const inside = [a, b, c].map((v) => position.getY(v) / surface > holeCos);
      if (inside[0] && inside[1] && inside[2]) continue;
      kept.push(a, b, c);
    }
    geometry.setIndex(kept);
  }

  const material = createWaterMaterial();
  // Water seen across a planet is lit from above and reads a stop lighter than
  // the same water at arm's length; at half the role's value the globe was
  // slate rather than ocean.
  material.deepColor.copy(worldColour(colors.deep)).multiplyScalar(0.76);
  material.shallowColor.copy(worldColour(colors.shallow));
  material.skyColor.copy(worldColour('sky_horizon'));
  const uniforms = material.material.uniforms;
  uniforms.uOpacity.value = 0.96;
  uniforms.uOceanMode.value = 1;
  // One column for the whole sea, not one per vertex.
  //
  // Per-vertex looked better in theory - a pale shelf and a dark basin - but the
  // sphere's vertices are 128 latitude rings, so every vertex on a ring carries
  // the same depth and the shader interpolates *along* the ring. The globe came
  // out banded in concentric arcs of shelf and basin that had nothing to do with
  // the coast, which is the "pattern of terrain and water" an eye saw at any
  // zoom between the shell's fade and the play area. The coastline is the orbital
  // face's job (it has a kilometre-per-texel mask and paints it as a shore).
  uniforms.uOceanVertexDepth.value = 0;
  uniforms.uOceanDepthM.value = 14;
  uniforms.uAbsorption.value = 1.1;
  uniforms.uRippleStrength.value = 1.6;
  uniforms.uRippleScale.value.setScalar(2 / 5.5);
  uniforms.uSeaFoamM.value = 0.35;
  uniforms.uFadeRange.value.set(1e9, 1e9);
  uniforms.uAltitudeFade.value.set(1e9, 1e9);
  // The sea's detail is sampled from the surface: this material is the body's
  // water, so the shader builds its waves on the sphere instead of on the flat
  // plane through the pole. The radius is the sphere the sea was cut for, so a
  // wave's wavelength is the same at every latitude.
  uniforms.uPlanetSeaCentre.value.set(0, -radius, 0, 1);
  uniforms.uPlanetSeaRadius.value = surface;
  material.material.depthWrite = false;
  material.material.side = THREE.DoubleSide;

  const mesh = new THREE.Mesh(geometry, material.material);
  mesh.name = 'planet-sea';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.position.y = -radius;
  return { mesh, material, radiusM: surface };
}
