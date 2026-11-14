/**
 * Capsule collision math.
 *
 * Plants are tubes, so a segment plus a radius describes every organ better
 * than a mesh and costs a few multiplications instead of a triangle test. The
 * server validates growth with these functions (no wasm in the tick) and the
 * client builds Rapier capsules from the same numbers, so gameplay and visuals
 * cannot disagree about what touches what.
 *
 * Pure and dependency-free.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Capsule {
  a: Vec3;
  b: Vec3;
  radius: number;
}

export interface ClosestPointsResult {
  /** Closest point on the first primitive. */
  pointA: Vec3;
  /** Closest point on the second primitive. */
  pointB: Vec3;
  /** Distance between the surfaces; negative means overlap. */
  distance: number;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(a: Vec3, factor: number): Vec3 {
  return { x: a.x * factor, y: a.y * factor, z: a.z * factor };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Point at `t` along a-b, clamped to the segment. */
export function pointOnSegment(a: Vec3, b: Vec3, t: number): Vec3 {
  const clamped = clamp01(t);
  return {
    x: a.x + (b.x - a.x) * clamped,
    y: a.y + (b.y - a.y) * clamped,
    z: a.z + (b.z - a.z) * clamped,
  };
}

/** Closest point on segment a-b to point p. */
export function closestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = subtract(b, a);
  const lengthSq = dot(ab, ab);
  if (lengthSq <= 1e-12) return { ...a };
  return pointOnSegment(a, b, dot(subtract(p, a), ab) / lengthSq);
}

/**
 * Closest points between two segments (Ericson, Real-Time Collision Detection
 * 5.1.9). Degenerate segments — a seed collider is a point — are handled by the
 * length guards.
 */
export function closestPointsBetweenSegments(
  a0: Vec3,
  a1: Vec3,
  b0: Vec3,
  b1: Vec3,
): { pointA: Vec3; pointB: Vec3 } {
  const d1 = subtract(a1, a0);
  const d2 = subtract(b1, b0);
  const r = subtract(a0, b0);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);

  const EPS = 1e-9;
  let s = 0;
  let t = 0;

  if (a <= EPS && e <= EPS) {
    return { pointA: { ...a0 }, pointB: { ...b0 } };
  }
  if (a <= EPS) {
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      if (denom !== 0) s = clamp01((b * f - c * e) / denom);
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }

  return { pointA: pointOnSegment(a0, a1, s), pointB: pointOnSegment(b0, b1, t) };
}

/** Surface-to-surface distance between two capsules. Negative means overlap. */
export function capsuleCapsuleDistance(a: Capsule, b: Capsule): ClosestPointsResult {
  const closest = closestPointsBetweenSegments(a.a, a.b, b.a, b.b);
  return {
    pointA: closest.pointA,
    pointB: closest.pointB,
    distance:
      distance(closest.pointA, closest.pointB) - Math.max(0, a.radius) - Math.max(0, b.radius),
  };
}

/** Surface-to-surface distance between a capsule and a sphere. */
export function capsuleSphereDistance(
  capsule: Capsule,
  center: Vec3,
  radius: number,
): ClosestPointsResult {
  const point = closestPointOnSegment(center, capsule.a, capsule.b);
  return {
    pointA: point,
    pointB: { ...center },
    distance: distance(point, center) - Math.max(0, capsule.radius) - Math.max(0, radius),
  };
}

/** True when a capsule and a sphere overlap (touching counts as overlap). */
export function capsuleIntersectsSphere(capsule: Capsule, center: Vec3, radius: number): boolean {
  return capsuleSphereDistance(capsule, center, radius).distance <= 0;
}

/** True when two capsules overlap. */
export function capsulesIntersect(a: Capsule, b: Capsule): boolean {
  return capsuleCapsuleDistance(a, b).distance <= 0;
}

/**
 * Intersection test with a clearance tolerance. `toleranceM` is the gap the
 * caller allows before calling it a collision (0 means surfaces may touch).
 */
export function capsulesIntersectWithin(a: Capsule, b: Capsule, toleranceM: number): boolean {
  return capsuleCapsuleDistance(a, b).distance <= Math.max(0, toleranceM);
}

/** Build a capsule from a segment and a radius, normalising the radius. */
export function makeCapsule(a: Vec3, b: Vec3, radius: number): Capsule {
  return { a: { ...a }, b: { ...b }, radius: Math.max(0, radius) };
}

/**
 * Half-height for a Rapier capsule that spans `length` with `radius` end caps.
 * Rapier's capsule runs along local Y with total length `2*halfHeight + 2*radius`;
 * clamping at 0 keeps a short, fat segment a sphere-ish capsule instead of
 * inverting.
 */
export function capsuleHalfHeightForSpan(lengthM: number, radiusM: number): number {
  return Math.max(0, Math.max(0, lengthM) / 2 - Math.max(0, radiusM));
}

/** Unit direction, or +Y for a degenerate segment. */
export function directionOrUp(a: Vec3, b: Vec3): Vec3 {
  const d = subtract(b, a);
  const len = length(d);
  if (len <= 1e-9) return { x: 0, y: 1, z: 0 };
  return { x: d.x / len, y: d.y / len, z: d.z / len };
}
