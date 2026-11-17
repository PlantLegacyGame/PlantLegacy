/**
 * Thorn geometry for `spined_epidermis` on the Three.js mesh path.
 *
 * The mutation's name promises spines, and an unlockable thorn organ is not the
 * same thing: the plant has to bristle. Kept out of MeshPlantRenderer so it can
 * be tested without a WebGL context.
 */
import * as THREE from 'three';

export function buildSpineGeometry(
  r0: number,
  r1: number,
  length: number,
  density: number,
): THREE.BufferGeometry | null {
  const clamped = Math.min(1, Math.max(0, density));
  if (clamped <= 0.01 || length < 0.02) return null;
  const count = Math.max(2, Math.round(2 + clamped * 10));
  const spineLength = Math.min(length * 0.28, Math.max(r0, r1) * 2.4 + 0.012);
  const spineRadius = spineLength * 0.28;
  const spike = new THREE.ConeGeometry(spineRadius, spineLength, 4, 1, false);
  // Cone is centred on its own origin; move the base to the origin so it can be
  // planted on the tube surface and point outward.
  spike.translate(0, spineLength / 2, 0);

  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const basePosition = spike.getAttribute('position');
  const baseNormal = spike.getAttribute('normal');
  const baseIndex = spike.getIndex();
  const baseCount = basePosition.count;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const outward = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    const angle = i * 2.399963;
    const radius = r0 + (r1 - r0) * t;
    // Alternate sides so spines read from every angle instead of in one row.
    const tilt = 0.55 + 0.25 * Math.sin(i * 1.7);
    outward.set(Math.cos(angle), tilt, Math.sin(angle)).normalize();
    quaternion.setFromUnitVectors(up, outward);
    matrix.compose(
      new THREE.Vector3(
        Math.cos(angle) * radius * 0.92,
        t * length,
        Math.sin(angle) * radius * 0.92,
      ),
      quaternion,
      new THREE.Vector3(1, 1, 1),
    );
    const offset = positions.length / 3;
    for (let v = 0; v < baseCount; v += 1) {
      vertex.fromBufferAttribute(basePosition, v).applyMatrix4(matrix);
      normal.fromBufferAttribute(baseNormal, v).applyQuaternion(quaternion);
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(normal.x, normal.y, normal.z);
    }
    if (baseIndex) {
      for (let index = 0; index < baseIndex.count; index += 1) {
        indices.push(baseIndex.getX(index) + offset);
      }
    }
  }
  spike.dispose();
  if (positions.length === 0) return null;
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}
