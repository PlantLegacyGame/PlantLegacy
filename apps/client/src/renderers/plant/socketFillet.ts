import * as THREE from 'three';

/**
 * A socket is a swept blend, not a ball.
 *
 * A child-sized sphere at the attach point hides the seam at a right angle but
 * leaves a step where a thin lateral leaves a fat trunk, and a bulge where a fat
 * branch leaves a thin root. This profile starts on the parent's own radius and
 * ends on the child's drawn start radius over a short length, which is the same
 * operation at 30, 90 and 150 degrees and in both thickness directions.
 */
export interface SocketFillet {
  /** Radius where the blend starts, inside the parent. */
  startRadius: number;
  /** Radius where the child's tube begins. */
  endRadius: number;
  /** The blend's length along the child axis. */
  length: number;
}

export function socketFilletFor(
  parentRadius: number,
  childRadius: number,
  segmentLength: number,
): SocketFillet {
  const parent = Number.isFinite(parentRadius) ? Math.max(0, parentRadius) : 0;
  const child = Number.isFinite(childRadius) ? Math.max(0, childRadius) : 0;
  const length = Number.isFinite(segmentLength) ? Math.max(0.01, segmentLength) : 0.01;
  // A parent much fatter than its child does not need its whole radius: the
  // blend is a collar, not a second trunk. A thin parent is not widened.
  const startRadius = parent > 0 ? Math.min(parent, Math.max(child, child * 1.8)) : child;
  const endRadius = child > 0 ? child : parent;
  return {
    startRadius,
    endRadius,
    length: Math.min(length * 0.35, Math.max(0.018, Math.max(startRadius, endRadius) * 1.2)),
  };
}

/** The blend's open cone, base at -Y and the child's radius at +Y. */
export function buildSocketFilletGeometry(fillet: SocketFillet, sides = 10): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(
    Math.max(0, fillet.endRadius),
    Math.max(0, fillet.startRadius),
    Math.max(0.001, fillet.length),
    Math.max(3, Math.round(sides)),
    1,
    true,
  );
}
