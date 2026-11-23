/**
 * Draws the authored T56 volume region.
 *
 * The field, the mesher and the strata are the shared package's: this file only
 * turns the arrays into a `BufferGeometry` and paints the beds. Keeping the
 * geometry out of the renderer is what lets the volume be tested without a GPU -
 * the tests build the same mesh this does and measure its underside, its closed
 * surface and its feet.
 */
import {
  buildTerrainVolumeMesh,
  type GroundHeight,
  type TerrainVolumeParams,
} from '@plant-legacy/shared/world';
import * as THREE from 'three';

/**
 * Build the region's mesh, or `null` when the region is disabled or empty.
 *
 * `rock` is the palette's mineral tint, the same role the soil shader uses for
 * its mineral grains. The three shades below are that one colour at three
 * brightnesses - a bed's compacted base, its body and its lighter top - so the
 * arch still answers to the palette and cannot introduce a colour of its own.
 */
export function createTerrainVolumeMesh(
  params: TerrainVolumeParams | undefined,
  ground: GroundHeight,
  rock: THREE.Color,
): THREE.Mesh | null {
  if (!params) return null;
  const mesh = buildTerrainVolumeMesh(ground, params);
  if (!mesh) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

  const base = rock.clone().multiplyScalar(0.72);
  const light = rock.clone().multiplyScalar(1.18);
  const colours = new Float32Array(mesh.vertices * 3);
  const shade = new THREE.Color();
  for (let v = 0; v < mesh.vertices; v += 1) {
    // A bed is darker where it is compacted and lighter at its top. `1 - cos`
    // puts the contact at one end of the ramp instead of in its middle, so the
    // boundary between two beds reads as a line rather than a soft fade.
    const bed = 0.5 - 0.5 * Math.cos(mesh.strata[v] * Math.PI * 2);
    shade.copy(base).lerp(light, bed);
    // Grain, deterministic in world position: the same rock on every load. A
    // vertex colour can only vary per vertex, so this is coarse on purpose - it
    // breaks up the band, it is not a texture.
    const x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    const z = mesh.positions[v * 3 + 2];
    const grain = 0.94 + 0.12 * Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719));
    colours[v * 3] = shade.r * grain;
    colours[v * 3 + 1] = shade.g * grain;
    colours[v * 3 + 2] = shade.b * grain;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.02,
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = 'terrain-volume';
  // It is rock in the world, not an overlay: it casts and takes the same light
  // and shadow as the ground it stands on.
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}
