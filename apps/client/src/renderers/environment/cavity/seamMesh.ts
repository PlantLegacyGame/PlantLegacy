/**
 * The rim seam, built from the bowl's own mouth ring.
 *
 * The terrain cut is a per-fragment discard and the bowl's rim sits a centimetre
 * under the surface, so at the boundary the two surfaces meet without
 * overlapping: a hairline slot that shows sky (or water) as a white sliver at the
 * lip. The old cut wall closed it, but it stood *at* the surface with a paler
 * colour, so from above it read as a tan band around the crater.
 *
 * The first attempt at a replacement drew its own circle, inset from the bowl and
 * with a different segment count. Two nearly-equal polygons leave slivers of
 * their own wherever they disagree, which is exactly what leaked at the rim.
 *
 * So this collar does not draw a circle: it copies the bowl's rim ring vertex for
 * vertex - same count, same angles, same radius after the bowl's scale - and hangs
 * each one straight down. Sharing an edge with the bowl means there is no gap
 * between them at all, and its top sits on the same ground the bowl's rim
 * conformed to, so the slot between it and the terrain is zero too.
 *
 * Colours are the bowl's own rim tones, passed in by the renderer.
 */
import * as THREE from 'three';
import { CAVITY_PROFILE, CAVITY_SEAM_DEPTH_M } from './profile.ts';

interface SeamState {
  /** Indices of the bowl's rim ring, in ring order. */
  rimIndices?: number[];
  lastKey?: string;
}

/**
 * The bowl's rim ring: the profile's first ring, which the builder emits first.
 *
 * Found by layout, not by "y is zero": on a slope the conform moves every rim
 * vertex off the mouth plane, so a height test finds nothing at all once the bowl
 * has been placed - which is exactly the state a per-frame caller sees.
 */
function bowlRimIndices(bowl: THREE.Mesh): number[] {
  const position = bowl.geometry.getAttribute('position');
  const columns = Math.max(0, Math.round(position.count / CAVITY_PROFILE.length));
  return Array.from({ length: columns }, (_, i) => i);
}

export function createCavitySeam(bowl: THREE.Mesh, colour: THREE.Color): THREE.Mesh {
  const rim = bowlRimIndices(bowl);
  const columns = rim.length;
  const positions = new Float32Array(columns * 2 * 3);
  const colours = new Float32Array(columns * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i < columns; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const next = (i + 1) % columns;
    const c = next * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  for (let i = 0; i < columns; i += 1) {
    for (const row of [0, 1] as const) {
      const v = i * 2 + row;
      positions[v * 3 + 1] = row === 0 ? 0 : -CAVITY_SEAM_DEPTH_M;
      // The lip keeps the rim's tone; the buried face darkens into the wall.
      const shade = row === 0 ? 1 : 0.72;
      colours[v * 3] = colour.r * shade;
      colours[v * 3 + 1] = colour.g * shade;
      colours[v * 3 + 2] = colour.b * shade;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    // Seen from inside the pit as well as from the slot above it.
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'root-sight-seam';
  mesh.visible = false;
  mesh.frustumCulled = false;
  (mesh.userData as SeamState).rimIndices = rim;
  return mesh;
}

/**
 * Per-frame: hang the collar from the bowl's rim, vertex for vertex.
 *
 * Reads the bowl *after* it has been placed and conformed, so the collar uses the
 * exact world positions the bowl's rim ended at: same angles, same radii, same
 * heights, no second circle to disagree with.
 */
export function updateCavitySeam(
  seam: THREE.Mesh,
  bowl: THREE.Mesh,
  surfaceHeight?: (x: number, z: number) => number,
): void {
  const state = seam.userData as SeamState;
  const rim = state.rimIndices ?? bowlRimIndices(bowl);
  state.rimIndices = rim;
  const visible = bowl.visible && rim.length > 2;
  seam.visible = visible;
  if (!visible) return;

  const bowlPosition = bowl.geometry.getAttribute('position') as THREE.BufferAttribute;
  const position = seam.geometry.getAttribute('position') as THREE.BufferAttribute;
  const key = `${bowl.position.x.toFixed(3)}|${bowl.position.y.toFixed(3)}|${bowl.position.z.toFixed(3)}|${bowl.scale.x.toFixed(3)}|${bowl.scale.y.toFixed(3)}`;
  if (state.lastKey === key) return;
  state.lastKey = key;

  for (let i = 0; i < rim.length; i += 1) {
    const index = rim[i];
    const x = bowl.position.x + bowlPosition.getX(index) * bowl.scale.x;
    const z = bowl.position.z + bowlPosition.getZ(index) * bowl.scale.z;
    // The ground this vertex cuts, not the vertex's own height: the bowl's rim is
    // buried by the sink, and leaving that gap is what leaked sky at oblique
    // angles in the first place. Falls back to the rim's own height if no sampler.
    const ground = surfaceHeight ? surfaceHeight(x, z) : bowl.position.y;
    const lip = i * 2;
    position.setXYZ(lip, x, ground, z);
    position.setXYZ(lip + 1, x, ground - CAVITY_SEAM_DEPTH_M, z);
  }
  position.needsUpdate = true;
}
