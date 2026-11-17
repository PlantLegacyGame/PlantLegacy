/**
 * The pit's skirt: a wall under the rim, at exactly the cut radius.
 *
 * The ground is a sheet with no thickness. Seen from under the cut - a low eye,
 * or the eye dropped below the surface by Root Sight - its edge is a slab with
 * open background behind it, and that background is the black band across the
 * world. This backs the edge with earth instead.
 *
 * It is a mesh of its own, not extra rings in the bowl: every consumer of the
 * bowl's geometry counts rings, and a hidden sixth ring in that buffer silently
 * changed the floor depth, the rim indices and the vertex layout. As a child of
 * the bowl it shares the bowl's transform and material, so it cannot disagree
 * with the lip about where the hole is, and its two rings are copied from the
 * conformed rim every frame.
 */
import * as THREE from 'three';
import { CAVITY_PROFILE, CAVITY_SKIRT_DEPTH } from './profile.ts';

interface SkirtState {
  cols: number;
}

/** Build the skirt for a bowl. Add it as the bowl's child. */
export function createCavitySkirt(bowl: THREE.Mesh): THREE.Mesh {
  const position = bowl.geometry.getAttribute('position');
  const cols = Math.max(8, Math.round(position.count / CAVITY_PROFILE.length));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cols * 2 * 3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols * 2 * 3), 3));
  const indices: number[] = [];
  for (let c = 0; c < cols; c += 1) {
    const top = c * 2;
    const bottom = top + 1;
    const nextTop = ((c + 1) % cols) * 2;
    const nextBottom = nextTop + 1;
    indices.push(top, nextTop, bottom, bottom, nextTop, nextBottom);
  }
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, bowl.material);
  mesh.name = 'root-sight-skirt';
  // A child in the bowl's local space: the bowl's transform places it, and the
  // material (with its clip uniforms) is the bowl's own.
  mesh.frustumCulled = false;
  (mesh.userData as SkirtState).cols = cols;
  return mesh;
}

/**
 * Per-frame: hang the skirt from the bowl's rim ring, vertex for vertex.
 *
 * Reads the bowl after it has been placed and conformed, so the skirt's top edge
 * is the same line the lip ends on, and the wall under it can never show a seam.
 */
export function updateCavitySkirt(skirt: THREE.Mesh, bowl: THREE.Mesh): void {
  const src = bowl.geometry.getAttribute('position');
  const srcColour = bowl.geometry.getAttribute('color');
  const dst = skirt.geometry.getAttribute('position') as THREE.BufferAttribute;
  const dstColour = skirt.geometry.getAttribute('color') as THREE.BufferAttribute;
  const cols = (skirt.userData as SkirtState).cols;
  for (let c = 0; c < cols; c += 1) {
    const x = src.getX(c);
    const y = src.getY(c);
    const z = src.getZ(c);
    dst.setXYZ(c * 2, x, y, z);
    dst.setXYZ(c * 2 + 1, x, y - CAVITY_SKIRT_DEPTH, z);
    if (srcColour) {
      const r = srcColour.getX(c);
      const g = srcColour.getY(c);
      const b = srcColour.getZ(c);
      dstColour.setXYZ(c * 2, r, g, b);
      // Deeper down the wall is older earth, as the bowl's own strata do.
      dstColour.setXYZ(c * 2 + 1, r * 0.82, g * 0.82, b * 0.82);
    }
  }
  dst.needsUpdate = true;
  dstColour.needsUpdate = true;
}
