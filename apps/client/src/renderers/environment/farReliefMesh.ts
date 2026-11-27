/**
 * The seamless far surface.
 *
 * The chunk quadtree exists to spend triangles under the eye, and its price is
 * a ring of LOD boundaries. At ten kilometres those boundaries are already a
 * few pixels of dark skirt; no amount of matching normals removes a wall that
 * is physically below the fine patch's edge. Above the range where the authored
 * play area still needs its own meshes, the honest far LOD is one mesh: an
 * icosphere has no cube-face edges and no poles, so there is nowhere for a seam
 * to be. It reads the same `planetSurfaceReliefAt` function as the chunks, so
 * its silhouette is the same surface, only sampled more coarsely.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Three's icosphere detail is a *linear* subdivision, not 4^detail: detail 64
 * is 20 x 65^2 = 84,500 faces, about 1.5 km per triangle on a 100 km body.
 * Detail 6 was only 980 faces - six-kilometre blobs, not a surface.
 */
export const FAR_RELIEF_DETAIL = 64;

export interface FarReliefOptions {
  radiusM: number;
  material: THREE.Material;
  /** Metres of relief above the body at a direction. */
  reliefAt: (direction: THREE.Vector3) => number;
  detail?: number;
}

export function createFarReliefMesh(options: FarReliefOptions): THREE.Mesh {
  const radius = Math.max(1, options.radiusM);
  // The geometry starts as a unit icosphere. Welding its copied vertices gives
  // one smooth normal per direction instead of one normal per triangle, which
  // is what keeps the coarse far surface from reading as facets.
  const unit = new THREE.IcosahedronGeometry(1, options.detail ?? FAR_RELIEF_DETAIL);
  const geometry = mergeVertices(unit);
  unit.dispose();

  const position = geometry.getAttribute('position');
  const direction = new THREE.Vector3();
  // The far field shares the soil material, so it must speak the same cut
  // language as every other earth surface: without this attribute the shader
  // reads zero and a Root Sight opening under a high eye is covered by the
  // coarse sphere.
  geometry.setAttribute(
    'aSurfaceCut',
    new THREE.BufferAttribute(new Float32Array(position.count).fill(1), 1),
  );
  // This is the only surface that must clear the play disc's neighbourhood: a
  // 1.5 km triangle can bridge the whole detailed cap and appear as a ceiling.
  // The transition ring fills that neighbourhood, so the shader can cut this
  // mesh out under the ring without leaving a hole in the surface.
  geometry.setAttribute(
    'aFarRelief',
    new THREE.BufferAttribute(new Float32Array(position.count).fill(1), 1),
  );
  for (let i = 0; i < position.count; i += 1) {
    direction.fromBufferAttribute(position, i).normalize();
    const height = radius + options.reliefAt(direction);
    position.setXYZ(i, direction.x * height, direction.y * height, direction.z * height);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, options.material);
  // Same placement convention as the relief levels: geometry is centred on the
  // body's centre, the mesh is sunk by one radius to put the pole at y = 0.
  mesh.position.y = -radius;
  mesh.name = 'planet-far-relief';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}
