/**
 * Geometry for the growth aim arrow.
 *
 * The arrow used to be a constant-radius tube with a fixed-size cone on the end,
 * drawn with depth testing off. From most angles that reads as a flat 2D
 * squiggle: nothing about it changes with distance or direction, so a player
 * aiming down a stem could not tell which part the arrow was attached to, or
 * which way it pointed. Two cheap geometric cues fix that:
 *
 * - the tube **tapers** from the mouth ring to the tip, the way a drawing of an
 *   arrow tapers, so direction is visible in the silhouette itself;
 * - the tip carries a **ring and a ground marker** (built in `main.ts` from this
 *   module's ring parameters), so the landing point is anchored to the world
 *   instead of floating in screen space.
 *
 * The builder is pure maths over a polyline, so it can be tested without a
 * renderer.
 */
import * as THREE from 'three';

/** Radius of the tube at a normalised position `t` (0 at the base, 1 at the tip). */
export function taperedTubeRadius(t: number, baseRadius: number, tipScale: number): number {
  const clampedT = THREE.MathUtils.clamp(t, 0, 1);
  const scale = THREE.MathUtils.clamp(tipScale, 0.05, 1);
  return Math.max(0.0002, baseRadius * (1 + (scale - 1) * clampedT));
}

/**
 * A tube along `points` whose radius shrinks from `baseRadius` to
 * `baseRadius * tipScale`.
 *
 * Built by hand rather than with `TubeGeometry` because three's tube is
 * constant-radius. The frame is a simple up-vector projection, which is stable
 * for the shallow curves the aim arrow uses (a curve that passes exactly
 * through the up vector would flip; the arrow bends sideways, so it does not).
 */
export function buildTaperedTubeGeometry(
  points: readonly THREE.Vector3[],
  baseRadius: number,
  tipScale: number,
  radialSegments = 8,
): THREE.BufferGeometry {
  const rings = Math.max(2, points.length);
  const sides = Math.max(3, Math.round(radialSegments));
  const positions: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const other = new THREE.Vector3();

  for (let i = 0; i < rings; i += 1) {
    const point = points[i];
    const next = points[Math.min(rings - 1, i + 1)];
    const previous = points[Math.max(0, i - 1)];
    tangent.subVectors(next, previous);
    if (tangent.lengthSq() < 1e-12) tangent.set(0, 1, 0);
    tangent.normalize();
    // Any vector not parallel to the tangent gives a usable basis.
    side.crossVectors(tangent, Math.abs(tangent.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : up);
    if (side.lengthSq() < 1e-12) side.set(1, 0, 0);
    side.normalize();
    other.crossVectors(tangent, side).normalize();
    const radius = taperedTubeRadius(i / (rings - 1), baseRadius, tipScale);
    for (let s = 0; s < sides; s += 1) {
      const angle = (s / sides) * Math.PI * 2;
      const cx = Math.cos(angle) * radius;
      const cy = Math.sin(angle) * radius;
      positions.push(
        point.x + side.x * cx + other.x * cy,
        point.y + side.y * cx + other.y * cy,
        point.z + side.z * cx + other.z * cy,
      );
    }
  }

  for (let i = 0; i < rings - 1; i += 1) {
    for (let s = 0; s < sides; s += 1) {
      const a = i * sides + s;
      const b = i * sides + ((s + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Where the aim ring sits, and which way its plane faces.
 *
 * The ring is the cross-section the new segment leaves from. That means its
 * plane is perpendicular to **the part it leaves**, not to the aim: on a lateral
 * bud or a gene-clamped aim, orienting it by the aim tilted the ring across the
 * arrow, which is what read as "not facing the right way in 3D".
 *
 * A seed or a root crown has no parent axis, so the mouth sits on its coat where
 * the part will leave and faces the way it will go.
 */
export interface RingFrameInput {
  /** Drawn attachment point on the part being left. */
  attach: THREE.Vector3;
  /** Unit tangent of the parent's drawn segment at the attachment, if any. */
  parentTangent?: THREE.Vector3 | null;
  /** The clamped aim direction, unit. */
  aim: THREE.Vector3;
  /** Up at the attachment (planet up), unit. Used as a last-resort normal. */
  surfaceUp: THREE.Vector3;
  /** Drawn radius of the part the new segment leaves. */
  partRadiusM: number;
}

export interface RingFrame {
  center: THREE.Vector3;
  normal: THREE.Vector3;
}

export function ringFrameFor(input: RingFrameInput): RingFrame {
  const up =
    input.surfaceUp.lengthSq() > 1e-8
      ? input.surfaceUp.clone().normalize()
      : new THREE.Vector3(0, 1, 0);
  const aim = input.aim.lengthSq() > 1e-8 ? input.aim.clone().normalize() : up;
  const tangent =
    input.parentTangent && input.parentTangent.lengthSq() > 1e-8
      ? input.parentTangent.clone().normalize()
      : null;
  if (tangent) {
    return { center: input.attach.clone(), normal: tangent };
  }
  return {
    center: input.attach.clone().addScaledVector(aim, Math.max(0, input.partRadiusM)),
    normal: aim.clone(),
  };
}

/** Metres to the ground under a point, for the aim arrow's depth marker. */
export function groundMarkerHeight(
  surfaceYAt: (x: number, z: number) => number,
  x: number,
  z: number,
): number {
  const ground = surfaceYAt(x, z);
  return Number.isFinite(ground) ? ground : 0;
}

/**
 * Keep an anchor on the part it belongs to.
 *
 * The aim ring is placed from the node's own segment (`parentAttach` → drawn
 * position). A stale or missing attachment point in the client mirror put that
 * anchor metres away - in practice on a neighbouring stem - and the player then
 * aimed from a part they had not selected. Clamping to a radius of the node's
 * drawn centre turns a wrong anchor into the best available approximation of the
 * right one instead of a gizmo somewhere else on the plant.
 */
export function clampAnchorToNode(
  anchor: THREE.Vector3,
  centre: THREE.Vector3,
  maxDistanceM: number,
): THREE.Vector3 {
  const offset = anchor.clone().sub(centre);
  const limit = Math.max(0.05, maxDistanceM);
  if (offset.lengthSq() <= limit * limit) return anchor;
  return centre.clone().addScaledVector(offset.normalize(), limit);
}
