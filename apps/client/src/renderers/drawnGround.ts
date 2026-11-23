/**
 * The soil as the player sees it, not as the field says it is.
 *
 * The terrain is drawn from a coarse triangle mesh, and between two of its
 * vertices the drawn surface can stand tens of centimetres above the height
 * field it was built from. Anything that has to *rest* on the ground - a drop's
 * contact shadow, a plant's footprint, a seed coat - has to be seated on the
 * triangle, or it hovers over the hill by exactly that difference.
 *
 * The normal comes from the same drawn heights, not from the analytic field: a
 * disc lying on the field's slope while the triangle under it faces another way
 * is the "shadow floating over the ground" a player notices at a glance.
 */
import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0);

/** How far either side of a point the drawn surface is sampled, metres. */
const NORMAL_STEP_M = 0.3;
/** The ray starts this far above the fallback height and may not fall further. */
const RAY_UP_M = 3;
const RAY_DOWN_M = 10;

export interface GroundSample {
  /** World height of the drawn soil at the point. */
  y: number;
  /** Unit normal of the drawn triangle around it. */
  normal: { x: number; y: number; z: number };
}

export class DrawnGround {
  private readonly ray = new THREE.Raycaster();
  private mesh: THREE.Object3D | null = null;
  private fallback: ((x: number, z: number) => number) | null = null;
  private readonly sampleNormal = new THREE.Vector3();

  /** Height field, used where the mesh has no triangle (or is not built yet). */
  setFallback(fallback: ((x: number, z: number) => number) | null): void {
    this.fallback = fallback;
  }

  /** The mesh the ground is actually drawn as; null until the world is built. */
  setMesh(mesh: THREE.Object3D | null): void {
    this.mesh = mesh;
  }

  /** Drawn height at a point, falling back to the field when there is no hit. */
  height(x: number, z: number): number {
    const field = this.fallback?.(x, z) ?? 0;
    const base = Number.isFinite(field) ? field : 0;
    const mesh = this.mesh;
    if (!mesh) return base;
    this.ray.near = 0;
    this.ray.far = RAY_DOWN_M;
    this.ray.set(new THREE.Vector3(x, base + RAY_UP_M, z), DOWN);
    const hit = this.ray.intersectObject(mesh, false)[0];
    return hit && Number.isFinite(hit.point.y) ? hit.point.y : base;
  }

  /** Height and the slope of the drawn surface around it. */
  sample(x: number, z: number): GroundSample {
    const y = this.height(x, z);
    const left = this.height(x - NORMAL_STEP_M, z);
    const right = this.height(x + NORMAL_STEP_M, z);
    const back = this.height(x, z - NORMAL_STEP_M);
    const front = this.height(x, z + NORMAL_STEP_M);
    // The plane through the four heights: y rises with x as (right - left), so
    // the normal tilts the other way.
    this.sampleNormal
      .set(-(right - left) / (2 * NORMAL_STEP_M), 1, -(front - back) / (2 * NORMAL_STEP_M))
      .normalize();
    return {
      y,
      normal: { x: this.sampleNormal.x, y: this.sampleNormal.y, z: this.sampleNormal.z },
    };
  }
}
