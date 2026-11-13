import * as THREE from 'three';
import type { PlantNodeData } from '../PlantRenderer.js';

/**
 * Rest-pose joint matrix for one plant node in the WebGPU mesh pass.
 *
 * The mesh builder is the only place that positions a growing part: it emits
 * every segment from that node's own attach point toward its target, scaled by
 * the node's `growthProgress` (see `resolveSegmentFrame`). The vertices that
 * reach the shader are therefore already in world space and already animated.
 *
 * The joint buffer must not move them again. It used to translate each node by
 * `position - parentAttach`, which pushed every part away from its parent by its
 * own length: a 0.35 m stem was drawn floating a stem's length above the seed,
 * a radicle a radicle's length below it, and every generation added its own
 * offset so the plant came apart as it grew. The joint indices are not even
 * allocated per node (siblings share the first pair), so a per-node offset can
 * never be correct here.
 */
export function jointMatrixFor(_node: PlantNodeData): THREE.Matrix4 {
  return new THREE.Matrix4();
}
