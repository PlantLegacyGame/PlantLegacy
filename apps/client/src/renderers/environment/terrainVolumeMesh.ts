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
 * `rock` is the soil palette's dry and wet earth, mixed by the caller. The two
 * shades below are that one colour at two brightnesses - a bed's compacted base
 * and its lighter top - so the arch still answers to the palette and cannot
 * introduce a colour of its own.
 */
export function createTerrainVolumeMesh(
  params: TerrainVolumeParams | undefined,
  ground: GroundHeight,
  rock: THREE.Color,
  /** The ground's soil material; the volume must wear the same cut contract. */
  soilMaterial?: THREE.MeshStandardMaterial,
): THREE.Mesh | null {
  if (!params) return null;
  const mesh = buildTerrainVolumeMesh(ground, params);
  if (!mesh) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

  // A stone's beds differ in value, not in brightness: the dark base and light
  // top span 0.8..1.2 of the albedo. The first pass's 0.72..1.18 multiplied a
  // dark blend until the rock was near-black on its shaded side; 0.88..1.12
  // then hid the beds entirely at noon.
  const base = rock.clone().multiplyScalar(0.8);
  const light = rock.clone().multiplyScalar(1.2);
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
  // The volume stands inside the Root Sight aperture. Without the same cut
  // attributes the ground shader reads, the arch keeps a solid ceiling over a
  // hole the surface has already opened. They are one contract, not a second
  // material: `aSurfaceCut` opts this mesh in, and `aSkirt`/`aSkirtTop` keep the
  // shader's skirt lookup valid.
  const cuts = new Float32Array(mesh.vertices).fill(1);
  const skirts = new Float32Array(mesh.vertices);
  geometry.setAttribute('aSurfaceCut', new THREE.BufferAttribute(cuts, 1));
  geometry.setAttribute('aSkirt', new THREE.BufferAttribute(skirts, 1));
  geometry.setAttribute(
    'aSkirtTop',
    new THREE.BufferAttribute(new Float32Array(mesh.positions), 3),
  );
  geometry.computeBoundingSphere();

  const material = soilMaterial
    ? soilMaterial.clone()
    : new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        metalness: 0.02,
      });
  // The soil material's shader is compiled for vertex colours on the ground;
  // the volume's bed colours are vertex colours too.
  material.vertexColors = true;
  const object = new THREE.Mesh(geometry, material);
  object.name = 'terrain-volume';
  // It is rock in the world, not an overlay: it casts and takes the same light
  // and shadow as the ground it stands on.
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}
