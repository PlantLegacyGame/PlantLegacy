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
import {
  clampAttachFraction,
  jointStartRadius,
  nodeRenderRadius,
} from '@plant-legacy/shared/growth';
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

/**
 * Which way the aim leaves a part.
 *
 * Two things are easy to get wrong here and were (G6). "At the surface" is not
 * `Math.abs(y) < 0.18`: on a planet a node lying on the soil has a world Y of
 * metres, so the absolute test called every hillside node off-surface and based
 * its frame on the link to its parent instead of on the ground. And the normal
 * a part on the soil is aimed away from is the planet's up at that node, not
 * world Y - on a hillside the two differ by the slope.
 *
 * So the test measures from the ground under this part (`groundY`) and the
 * fallback direction is `surfaceUp`, which the caller resolves once for the
 * whole gizmo. A seed is on the soil whatever its Y says: it is the coat the
 * radicle leaves through.
 */
export interface GrowthStartInput {
  /** The part the new segment leaves. */
  node: { x: number; y: number; z: number };
  /** The part it grew from, if it has one. */
  parent: { x: number; y: number; z: number } | null;
  isSeed: boolean;
  /** Ground height under the part. */
  groundY: number;
  /** Up at the part (planet up), unit. */
  surfaceUp: THREE.Vector3;
  /** How far above its own ground still counts as standing on the soil. */
  toleranceM: number;
}

export function growthStartNormal(input: GrowthStartInput): THREE.Vector3 {
  const up =
    input.surfaceUp.lengthSq() > 1e-8
      ? input.surfaceUp.clone().normalize()
      : new THREE.Vector3(0, 1, 0);
  // A tolerance that is not a number makes the comparison below false, which is
  // exactly what a tolerance of zero does: the part is off the soil.
  const tolerance = Math.max(0, input.toleranceM);
  const atSurface = input.isSeed || input.node.y <= input.groundY + tolerance;
  if (!atSurface && input.parent) {
    const along = new THREE.Vector3(
      input.node.x - input.parent.x,
      input.node.y - input.parent.y,
      input.node.z - input.parent.z,
    );
    if (along.lengthSq() >= 1e-5) return along.normalize();
  }
  // A seed has no parent axis to take a normal from, and a part standing on the
  // soil is aimed away from the ground rather than along the part it grew from.
  return up;
}

/**
 * The attach fraction a press on the part means, in screen space.
 *
 * The press is projected onto the part's drawn segment — from where it leaves its
 * parent to where it is drawn — so the joint follows the pointer from one end to
 * the other. Measuring the press on the part's 3D pick sphere only reached a
 * fraction of a metre either side of the centre, which made the choice barely
 * exist (G01). `base` answers a part seen end-on, where a projection would be a
 * single pixel and the press says nothing.
 */
export function attachFractionFromScreenPress(input: {
  /** Where the part leaves its own parent, on screen. */
  startScreen: { x: number; y: number };
  /** Where the part's drawn centre is, on screen. */
  endScreen: { x: number; y: number };
  /** The press, on screen. */
  pressScreen: { x: number; y: number };
  /** Fraction used when the segment projects to a point. */
  base: number;
}): number {
  return attachFractionRequest(input).fraction;
}

/**
 * The same press, with what the gene did to it: `requested` is where the press
 * landed along the part, `fraction` is the joint the part allows, and `held` says
 * the two differ - so the caller can tell the player the spot was refused instead
 * of quietly growing somewhere else.
 */
export function attachFractionRequest(input: {
  startScreen: { x: number; y: number };
  endScreen: { x: number; y: number };
  pressScreen: { x: number; y: number };
  base: number;
}): { requested: number; fraction: number; held: boolean } {
  const dx = input.endScreen.x - input.startScreen.x;
  const dy = input.endScreen.y - input.startScreen.y;
  const lengthSq = dx * dx + dy * dy;
  if (!(lengthSq > 1)) {
    const fraction = clampAttachFraction(input.base);
    return { requested: input.base, fraction, held: false };
  }
  const requested =
    ((input.pressScreen.x - input.startScreen.x) * dx +
      (input.pressScreen.y - input.startScreen.y) * dy) /
    lengthSq;
  const fraction = clampAttachFraction(requested);
  // A hair of slack: a press on the cap's own edge is not a refusal.
  return { requested, fraction, held: Math.abs(requested - fraction) > 0.02 };
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
/**
 * How far from a part's drawn end the aim ring may stand: the part's own length
 * when the bud can leave part-way along it, else a little more than its thickness.
 * Allowing only the thickness pinned the ring at the tip whatever joint was chosen.
 */
export function jointAnchorAllowanceM(segmentLengthM: number, partRadiusM: number): number {
  return Math.max(0.1, segmentLengthM * 1.05, partRadiusM * 1.25);
}

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

/** The part the aim ring is stuck to: a tube (start to end), or a ball when it has no start. */
export interface RingHost {
  /** Where the part leaves its own parent; null makes the host a ball at `end`. */
  start: THREE.Vector3 | null;
  /** The part's drawn centre / end. */
  end: THREE.Vector3;
  /** Radius of the part's surface at the ring (metres). */
  radius: number;
}

export interface WrappedRing {
  /** The closed loop, lying on the host's surface. */
  points: THREE.Vector3[];
  /** Middle of the loop, on the surface. */
  centre: THREE.Vector3;
  /** Outward surface normal at the middle. */
  normal: THREE.Vector3;
}

/** A unit vector, or `fallback` when the input has no direction left. */
function unitOr(v: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
  return v.lengthSq() > 1e-10 ? v.clone().normalize() : fallback.clone();
}

/** Any unit vector perpendicular to `n`, stable for every direction. */
function perpendicularTo(n: THREE.Vector3): THREE.Vector3 {
  const seed = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  return seed.addScaledVector(n, -seed.dot(n)).normalize();
}

/**
 * A ring laid on a ball (a seed coat) at `outward`.
 *
 * A geodesic circle: every point is the outward direction turned by the same
 * angle, so the loop bends over the curvature instead of being a flat disc that
 * touches the coat at one point and lifts off all round its rim.
 */
function wrapRingOnBall(input: {
  centre: THREE.Vector3;
  radius: number;
  outward: THREE.Vector3;
  ringRadius: number;
  segments: number;
  lift: number;
}): WrappedRing {
  const radius = Math.max(1e-4, input.radius);
  const outward = unitOr(input.outward, new THREE.Vector3(0, 1, 0));
  const t1 = perpendicularTo(outward);
  const t2 = new THREE.Vector3().crossVectors(outward, t1).normalize();
  // How far round the ball the loop reaches, capped just short of the far side.
  const sweep = Math.min(Math.PI * 0.95, Math.max(1e-4, input.ringRadius) / radius);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < input.segments; i++) {
    const a = (i / input.segments) * Math.PI * 2;
    const dir = outward
      .clone()
      .multiplyScalar(Math.cos(sweep))
      .addScaledVector(t1, Math.cos(a) * Math.sin(sweep))
      .addScaledVector(t2, Math.sin(a) * Math.sin(sweep))
      .normalize();
    points.push(input.centre.clone().addScaledVector(dir, radius + input.lift));
  }
  return {
    points,
    centre: input.centre.clone().addScaledVector(outward, radius + input.lift),
    normal: outward,
  };
}

/**
 * A ring that lies on the part like a sticker.
 *
 * The flat hoop it replaces was a disc in one plane: on a stem it stood off the
 * surface wherever the ring was wider than the part, and on a seed coat, which is
 * curved in every direction, it touched at one point and lifted off all round its
 * rim. Here the part's surface is unrolled - a step along the part's own axis is a
 * step along the tube, a step across it is a turn round its circumference - and the
 * loop is cut in that flat sheet and mapped back, so it hugs the surface the way a
 * printed sticker hugs a bottle. `outward` says which side of the part it sits on.
 *
 * A host with no axis (a seed) is a ball, and takes a geodesic circle instead.
 */
export function wrapRingOnHost(input: {
  host: RingHost;
  /** Where on the part the ring is centred; only its position along the part matters. */
  point: THREE.Vector3;
  /** Direction from the part's axis towards the side the ring sits on, unit. */
  outward: THREE.Vector3;
  ringRadius: number;
  segments?: number;
  /** Stand-off from the surface, so the ring does not z-fight with it. */
  lift?: number;
}): WrappedRing {
  const lift = input.lift ?? 0.002;
  const segments = Math.max(8, Math.round(input.segments ?? 48));
  const radius = Math.max(1e-4, input.host.radius);
  if (!input.host.start) {
    return wrapRingOnBall({
      centre: input.host.end,
      radius,
      outward: input.outward,
      ringRadius: input.ringRadius,
      segments,
      lift,
    });
  }
  const axis = input.host.end.clone().sub(input.host.start);
  const length = axis.length();
  if (length < 1e-6) {
    return wrapRingOnBall({
      centre: input.host.end,
      radius,
      outward: input.outward,
      ringRadius: input.ringRadius,
      segments,
      lift,
    });
  }
  const axisDir = axis.divideScalar(length);
  const outward = unitOr(input.outward, axisDir);
  // The side of the part the sticker sits on: the outward direction with its
  // along-the-part component removed, so pressing near a tip still picks a flank.
  const side = outward.clone().addScaledVector(axisDir, -outward.dot(axisDir));
  if (side.lengthSq() < 1e-10) side.copy(perpendicularTo(axisDir));
  side.normalize();
  const around = new THREE.Vector3().crossVectors(axisDir, side).normalize();
  const along = input.point.clone().sub(input.host.start).dot(axisDir);
  const u0 = Math.min(length, Math.max(0, along));
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    // Flat sheet coordinates: metres along the part, metres round its surface.
    const u = Math.min(length, Math.max(0, u0 + Math.cos(a) * input.ringRadius));
    const theta = (Math.sin(a) * input.ringRadius) / radius;
    const dir = side
      .clone()
      .multiplyScalar(Math.cos(theta))
      .addScaledVector(around, Math.sin(theta));
    points.push(
      input.host.start
        .clone()
        .addScaledVector(axisDir, u)
        .addScaledVector(dir, radius + lift),
    );
  }
  return {
    points,
    centre: input.host.start
      .clone()
      .addScaledVector(axisDir, u0)
      .addScaledVector(side, radius + lift),
    normal: side,
  };
}

/** The drawn ring: a closed tube through the loop, a constant world thickness wide. */
export function ringLoopGeometry(
  points: THREE.Vector3[],
  tubeRadius: number,
  radialSegments = 6,
): THREE.TubeGeometry {
  const loop = new THREE.CatmullRomCurve3(points, true);
  return new THREE.TubeGeometry(
    loop,
    Math.max(8, points.length),
    Math.max(1e-4, tubeRadius),
    radialSegments,
    true,
  );
}

/**
 * The mouth's fill: a fan over the loop, so the ring reads as a hole in the part
 * rather than a hoop lying on it. The loop is a circle in the unrolled sheet, so a
 * fan from its middle is a valid triangulation of the patch it encloses.
 */
export function ringFanGeometry(
  points: THREE.Vector3[],
  centre: THREE.Vector3,
): THREE.BufferGeometry {
  const positions: number[] = [centre.x, centre.y, centre.z];
  for (const p of points) positions.push(p.x, p.y, p.z);
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    indices.push(0, 1 + i, 1 + ((i + 1) % points.length));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The organs whose joint is soft: a leaf, a cotyledon, a flower, a spore sac.
 *
 * They sit on the part they leave instead of flaring out of it (see
 * `jointStartRadius`'s `softOrgan`), so their base is their own thickness even
 * when the part carrying them is much thicker.
 */
const SOFT_JOINT_ORGAN_TYPES = new Set(['leaf', 'cotyledon', 'flower', 'spore_sac']);

/**
 * The mouth a new part of `emergingType` will leave from.
 *
 * The ring answers "how wide will this part's base be", so it is the organ's
 * own profile radius carried through the joint rule the grown part will be drawn
 * with - never the radius of the part it happens to be leaving, which answers a
 * different question (a spore sac on a trunk has no reason to wear a trunk-sized
 * ring). `ringMouthRadiusM` then scales it for legibility, floors it, and caps it
 * at the host so a wide mouth cannot stand off a thin part.
 */
export function growthAimMouthRadius(input: {
  emergingType: string;
  parentRadiusM: number;
  scale: number;
  minM: number;
}): number {
  const profileRadiusM = nodeRenderRadius(input.emergingType, Number.NaN);
  const emergingRadiusM = jointStartRadius(
    input.parentRadiusM,
    profileRadiusM,
    SOFT_JOINT_ORGAN_TYPES.has(input.emergingType.toLowerCase()),
  );
  return ringMouthRadiusM({
    emergingRadiusM,
    parentRadiusM: input.parentRadiusM,
    scale: input.scale,
    minM: input.minM,
  });
}

/**
 * The radius of the ring's mouth: the emerging part's own start, so a stem, a
 * lateral root and a spore sac each get a ring the size of what will leave.
 * `parentRadiusM` is the part it leaves; the mouth is never wider than that.
 */
export function ringMouthRadiusM(input: {
  emergingRadiusM: number;
  parentRadiusM: number;
  scale: number;
  minM: number;
}): number {
  const emerging = Math.max(0, input.emergingRadiusM) * Math.max(0, input.scale);
  const capped = input.parentRadiusM > 0 ? Math.min(input.parentRadiusM, emerging) : emerging;
  return Math.max(input.minM, capped);
}
