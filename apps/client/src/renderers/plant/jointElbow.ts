/**
 * The turn a part takes at its own tip, where the next part leaves it.
 *
 * A plant is not a jointed arm: a root that carries a second root at forty
 * degrees does not end in a mitre. Two straight tubes meeting at that angle
 * read as sticks pushed together - the parent's cap stands square to its own
 * axis while the child leaves at another - and the wider the angle the worse
 * the notch. Living tissue curves into the branch instead.
 *
 * So the parent's tip is bent towards the child, over its last third, with the
 * joint itself left exactly where the graph puts it: the child still leaves
 * from the same point, and the parent arrives there along the child's own
 * direction, so the two bodies meet flush.
 */
import * as THREE from 'three';

/** One part leaving a joint, as the renderer drew it. */
export interface JointChild {
  /** Which way the child runs, from the joint towards its own tip. */
  direction: THREE.Vector3;
  /** How strongly this child pulls the tip: its drawn radius, in metres. */
  weight: number;
}

/** The turn, in the parent's own frame: how far, and towards which side. */
export interface JointElbow {
  /** Radians between the parent's axis and the direction it arrives in. */
  angle: number;
  /** Unit vector, perpendicular to the axis, on the side the tip turns to. */
  lateral: THREE.Vector3;
}

/** Below this a child is running on in the parent's own direction. */
export const MIN_ELBOW_ANGLE = 0.06;

/** The sharpest turn a parent may take at its tip: a right angle. */
export const MAX_ELBOW_ANGLE = Math.PI / 2;

export function jointElbow(
  axis: THREE.Vector3,
  children: readonly JointChild[],
): JointElbow | null {
  const up = axis.clone();
  if (up.lengthSq() < 1e-8) return null;
  up.normalize();
  const lateralSum = new THREE.Vector3();
  let totalWeight = 0;
  for (const child of children) {
    const direction = child.direction.clone();
    if (direction.lengthSq() < 1e-8) continue;
    direction.normalize();
    const along = THREE.MathUtils.clamp(direction.dot(up), -1, 1);
    // The part of the child's direction the parent would have to turn through.
    const lateral = direction.clone().addScaledVector(up, -along);
    // Straight on is no elbow; straight back is a bud folding onto its own
    // parent, which has no side to turn towards.
    if (lateral.lengthSq() < 1e-8) continue;
    const weight = Number.isFinite(child.weight) && child.weight > 0 ? child.weight : 1;
    lateralSum.addScaledVector(lateral.normalize(), Math.acos(along) * weight);
    totalWeight += weight;
  }
  if (totalWeight <= 0 || lateralSum.lengthSq() < 1e-10) return null;
  const angle = Math.min(MAX_ELBOW_ANGLE, lateralSum.length() / totalWeight);
  if (angle < MIN_ELBOW_ANGLE) return null;
  return { angle, lateral: lateralSum.normalize() };
}
