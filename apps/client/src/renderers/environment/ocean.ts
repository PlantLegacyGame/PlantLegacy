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

export interface Ocean {
  mesh: THREE.Mesh;
  material: WaterMaterial;
  /**
   * Height of the sea over a point on the tangent plane, metres. The dome is the
   * planet's curvature, so this is what an eye at that column is under.
   */
  seaSurfaceYAt(x: number, z: number): number;
}

/** Water column the open sea uses beyond the bed grid's reach, metres. */
const OPEN_SEA_DEPTH_M = 12;
/** How far the dome reaches, metres: past the camera's far plane and the fade. */
const OCEAN_RADIUS_M = 2600;
const OCEAN_RINGS = 96;
const OCEAN_SPOKES = 128;
/** Half-extent of the sea's own bed height field, and its resolution. */
const BED_HALF_M = 900;
const BED_CELLS = 640;

type SeaTuning = Pick<
  WaterFieldTuning,
  'seaLevelM' | 'colors' | 'seaWaveStrength' | 'seaWaveScaleM' | 'seaFoamWidthM' | 'absorptionPerM'
>;

/** Ground height under the sea, packed the way the water shaders read it. */
function buildBedTexture(bedYAt: (x: number, z: number) => number): {
  texture: THREE.DataTexture;
  min: number;
  span: number;
} {
  const n = BED_CELLS;
  const heights = new Float32Array(n * n);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const cell = (BED_HALF_M * 2) / (n - 1);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const y = bedYAt(-BED_HALF_M + i * cell, -BED_HALF_M + j * cell);
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
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
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
  material.deepColor.copy(worldColour(colors.deep));
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
  uniforms.uRippleStrength.value = tuning.seaWaveStrength ?? 1.2;
  uniforms.uRippleScale.value.setScalar(2 / Math.max(0.5, tuning.seaWaveScaleM ?? 5.5));
  // The horizon is the far plane here, so the water dissolves just before it
  // rather than ending in a line of sky-coloured cut geometry.
  uniforms.uFadeRange.value.set(2200, 2480);
  // A transparent surface that writes depth hides everything drawn after it. The
  // sea is drawn in front of the rain, the plant and the shore, so it must not
  // own the depth buffer: it is a single layer of the dome, and the shader
  // already picks a side from where the eye is.
  material.material.depthWrite = false;
  material.material.side = THREE.DoubleSide;

  if (bedYAt) {
    const bed = buildBedTexture(bedYAt);
    uniforms.uGroundHeight.value = bed.texture;
    uniforms.uGroundHeightAvailable.value = 1;
    (uniforms.uGroundHeightOrigin.value as THREE.Vector2).set(-BED_HALF_M, -BED_HALF_M);
    uniforms.uGroundHeightSize.value = BED_HALF_M * 2;
    (uniforms.uGroundHeightRange.value as THREE.Vector2).set(bed.min, bed.span);
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
    const r = OCEAN_RADIUS_M * (ring / ringCount) ** 1.6;
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
    seaSurfaceYAt: (x: number, z: number) => seaY - (x * x + z * z) / (2 * radius),
  };
}
