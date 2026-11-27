/**
 * The growth-aim gizmo: the shape you are about to grow, drawn as a ghost.
 *
 * It used to be a compass: a hoop at the mouth, a curved arrow to the tip, the
 * aim split into red/green/blue axis legs, a triad at the joint, a cone head, a
 * drop post and a shadow ribbon on the soil. Fourteen strokes answering one
 * question - which way does this shoot go - and at arm's length over a seedling
 * they overlapped into a knot of tiny coloured bars. The axis inks were the
 * worst of it: they name x, y and z, which is how the code stores a direction,
 * not how a player thinks about where a shoot ends up.
 *
 * What replaced it is the shoot itself. A translucent tapered tube follows the
 * same path the part will, ends in a bud, and fades where it passes under the
 * soil (per-vertex alpha, because this canvas has no depth against the scene).
 * One hoop stays at the mouth - where the part leaves - and one hoop lies on the
 * soil where the shoot crosses it, which is the only part of "down" the eye can
 * check from outside the ground. A landing hoop rings the tip while the tip is
 * still in the air. Four parts, all the same green, and the ghost's own length
 * is the readout the arrow head was trying to be.
 *
 * The strokes are sized in pixels of the eye, not in metres: the aim is read
 * both at arm's length and from across the plot, and a world-thick line that
 * reads at 2 m is a sub-pixel hair at 20. See `aimGauge` below.
 *
 * What stayed in `main.ts`: the aim *state* (yaw, pitch, drag mapping, commit).
 * This module owns the meshes and the overlay canvas that draws them above the
 * plant canvas.
 */
import * as THREE from 'three';
import type { AppContext } from '../app/appContext.ts';

/** Everything the overlay needs from the aim state it does not own. */
export interface GrowthAimGizmoHooks {
  /** The option the player is currently aiming, if any. */
  getDrawingData: () => { nodeId: string; selectedOptionType?: string } | null;
  /** True when the player moved the ring onto the part's surface. */
  isAnchorOnNodeSurface: () => boolean;
  /**
   * True while the option's gene sector is holding the aim.
   *
   * Optional so a test can build the hooks it needs without one; absent means
   * "not held", which is the arrow's ordinary ink.
   */
  isAimHeldByGene?: () => boolean;
  /** World point the aim ring is anchored to; written by the aim code. */
  ringAnchor: THREE.Vector3;
  /** Which handle the current press is on, for an unmistakable active state. */
  activeHandle?: () => 'origin' | 'direction' | null;
  /** True while the shoot's tip is clear of the soil, so a landing hoop means something. */
  isTipClearOfGround: () => boolean;
  /** True while the shoot's path crosses the soil, so the pierce hoop has a place. */
  crossesSoil: () => boolean;
  /**
   * The player's own drawn tubes, for the arc the ring hides behind them.
   *
   * Nothing here reads the plant mirror: the caller owns the animation, so the
   * capsules it hands over are already where the plant is drawn this frame.
   */
  occluders: () => readonly RingOccluder[];
}

/**
 * The aim's two inks.
 *
 * Green is "this is the direction you are asking for"; amber is "the gene is
 * holding it here". Colour is the only signal a stopped drag can give without a
 * line of text, and a stopped drag with no signal is what made the aim look
 * fixed (G02).
 */
export const AIM_ARROW_INK = 0x9ede63;
export const AIM_ARROW_HELD_INK = 0xf0c05b;
/** The bud at the shoot's end: warm white, so it reads against green and soil. */
export const AIM_BUD_INK = 0xfff3c4;
/** The joint handle: warm orange means "drag me along the parent". */
export const AIM_ORIGIN_INK = 0xffb45e;

/**
 * How big one stroke of the aim should be, in metres, at a given eye distance.
 *
 * The gizmo lives on its own canvas over the scene, so a stroke drawn at a fixed
 * world thickness is 2 px at arm's length and vanishes past ten metres - which is
 * exactly the range a player picks a branch from. Everything on the gizmo is
 * sized from this one number so the parts stay in proportion with each other at
 * every zoom instead of each having its own clamp.
 */
export function aimGauge(eyeDistanceM: number): number {
  if (!Number.isFinite(eyeDistanceM)) return 0.02;
  return THREE.MathUtils.clamp(eyeDistanceM * 0.0075, 0.008, 0.14);
}

/** The meshes, once built. */
export interface GrowthAimParts {
  group: THREE.Group;
  /** The hoop round the part's mouth, unrolled onto its surface where it can be. */
  ring: THREE.Mesh;
  /** A translucent patch filling the mouth, so the hoop reads as a hole to leave. */
  mouthDisc: THREE.Mesh;
  /** The shoot itself: the shape being asked for, not an arrow pointing at it. */
  ghost: THREE.Mesh;
  /** The bud the shoot ends in. */
  bud: THREE.Mesh;
  /** The explicit move-joint handle at the mouth. */
  originPuck: THREE.Mesh;
  /** The arrowhead that makes the aim direction readable from any orbit. */
  directionCone: THREE.Mesh;
  /** A hoop lying on the soil where the shoot crosses it. */
  pierce: THREE.Mesh;
  /** A landing hoop round the tip, while the tip is still in the air. */
  tipRing: THREE.Mesh;
  /**
   * The shoot's own path traced on the soil, under it.
   *
   * Seen from behind the seed the shoot is foreshortened to a few pixels, and a
   * radicle that goes away from the eye is the worst case: the one thing the eye
   * cannot read is distance along the view ray. Footprints on the ground carry
   * that half of the answer - which way, and how far - while the ghost carries
   * the height.
   */
  trail: THREE.Mesh;
  /** The ring on the soil the shoot would land on, under the bud. */
  landing: THREE.Mesh;
  /** The post from the soil up to a bud in the air: how far above the ground it ends. */
  drop: THREE.Mesh;
}

export interface GrowthAimGizmo {
  /** Build on first use; returns the meshes. */
  ensure(): GrowthAimParts;
  /** Hide the whole overlay (aim cancelled). */
  hide(): void;
  /** Make the overlay and its canvas visible again. */
  show(): void;
  /** Per-frame: hide what the plant stands in front of, then draw. */
  render(): void;
  /** Radius the ring was last built at; kept by the caller for rebuild checks. */
  readonly parts: GrowthAimParts | null;
}

/** The ring's own ink, and the ink it wears where the plant stands in front. */
export const AIM_RING_INK = 0xf2e3a0;
export const AIM_RING_BEHIND_INK = 0xf08a3c;

/**
 * One drawn piece of the plant's body, as a capsule: the tube a segment draws.
 *
 * The ring is asked about tubes rather than node centres, because the body the
 * player sees between two nodes is where the occluded arcs come from.
 */
export interface RingOccluder {
  from: THREE.Vector3;
  to: THREE.Vector3;
  radius: number;
}

/**
 * Which points round the ring the player's own plant stands in front of.
 *
 * The whole ring used to be hidden the moment a part crossed the anchor (G8,
 * U09), so half the loop vanished and the aim lost its shape. The ring is a hoop
 * round the part: its far side is behind that part and its near side is not, and
 * what the eye needs is the difference, not the whole hoop disappearing. So the
 * hidden arc is measured here and painted orange, and the visible arc keeps the
 * ring's own ink.
 *
 * Only the player's own parts count - another plant is scenery - and only parts
 * near the ring, because a part metres away can only be in front of it from the
 * far side of the horizon.
 */
export function ringOcclusionFactors(query: {
  cameraPosition: THREE.Vector3;
  /** World points round the ring, in the order the ring's vertices are drawn. */
  points: readonly THREE.Vector3[];
  /** The player's own drawn tubes, each a capsule; another plant is scenery. */
  occluders: readonly RingOccluder[];
}): Float32Array {
  const factors = new Float32Array(query.points.length);
  if (query.points.length === 0 || query.occluders.length === 0) return factors;
  const centre = new THREE.Vector3();
  for (const point of query.points) centre.add(point);
  centre.divideScalar(query.points.length);
  let reach = 0;
  for (const point of query.points) reach = Math.max(reach, point.distanceTo(centre));
  // Eight hoop-widths: a leaf that far in front can still cover it from a low
  // eye, and a part beyond that is scenery across the whole ring or nothing.
  reach = reach * 8 + 1;

  const parts: RingOccluder[] = [];
  for (const occluder of query.occluders) {
    const at = occluder.to;
    if (at.distanceTo(centre) > reach + occluder.radius) continue;
    // A hair inside the drawn body: the ring sits on the surface it belongs to,
    // and that surface must not count as standing in front of itself.
    parts.push({ from: occluder.from, to: occluder.to, radius: occluder.radius * 0.9 });
  }
  if (parts.length === 0) return factors;

  const direction = new THREE.Vector3();
  for (let i = 0; i < query.points.length; i += 1) {
    const point = query.points[i];
    if (!point) continue;
    const distance = direction.subVectors(point, query.cameraPosition).length();
    if (distance <= 1e-4) continue;
    direction.divideScalar(distance);
    for (const part of parts) {
      const hit = rayCapsule(query.cameraPosition, direction, part);
      if (hit < distance - RING_OCCLUSION_EPSILON) {
        factors[i] = 1;
        break;
      }
    }
  }
  return factors;
}

/** How far in front of a ring vertex a body must stand to count. */
const RING_OCCLUSION_EPSILON = 0.004;

const capsuleAxis = new THREE.Vector3();
const capsuleOffset = new THREE.Vector3();
const capsuleEnd = new THREE.Vector3();

/**
 * Where a ray enters a capsule, or Infinity when it misses.
 *
 * The plant is drawn as tubes, so the ring has to be asked about tubes: a sphere
 * at a node's centre misses the body the player actually sees between two nodes.
 * The ray starts at the eye, and the side wall is solved first; a miss there is
 * retried against the rounded end the ray is pointing at.
 */
function rayCapsule(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  capsule: RingOccluder,
): number {
  const axis = capsuleAxis.subVectors(capsule.to, capsule.from);
  const lengthSq = axis.lengthSq();
  // A node with no drawn parent is a bead, not a tube.
  if (lengthSq < 1e-10) {
    return raySphere(origin, direction, capsule.to, capsule.radius);
  }
  const offset = capsuleOffset.subVectors(origin, capsule.from);
  const alongAxis = direction.dot(axis);
  const axisOffset = axis.dot(offset);
  const rayOffset = direction.dot(offset);
  const squared = lengthSq - alongAxis * alongAxis;
  const linear = lengthSq * rayOffset - axisOffset * alongAxis;
  const constant =
    lengthSq * offset.lengthSq() - axisOffset * axisOffset - capsule.radius ** 2 * lengthSq;
  const roots = linear * linear - squared * constant;
  let wall = Number.POSITIVE_INFINITY;
  if (roots >= 0 && squared > 1e-12) {
    const alongWall = (-linear - Math.sqrt(roots)) / squared;
    const onAxis = axisOffset + alongWall * alongAxis;
    if (onAxis > 0 && onAxis < lengthSq) wall = alongWall;
  }
  // The two rounded ends are part of the capsule, so a ray that only reaches one
  // of them still lands on the body. Whichever comes first is the entry.
  return Math.min(
    wall,
    raySphere(origin, direction, capsule.from, capsule.radius),
    raySphere(origin, direction, capsule.to, capsule.radius),
  );
}

function raySphere(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  centre: THREE.Vector3,
  radius: number,
): number {
  const toCentre = capsuleEnd.subVectors(centre, origin);
  const alongRay = toCentre.dot(direction);
  const squared = toCentre.lengthSq() - alongRay * alongRay;
  if (squared > radius * radius) return Number.POSITIVE_INFINITY;
  return alongRay - Math.sqrt(radius * radius - squared);
}

/**
 * Paint the ring's vertices, orange where the plant stands in front of them.
 *
 * One colour per vertex, interpolated round the hoop, so the change from ink to
 * orange happens over a few centimetres instead of at a hard seam.
 */
export function paintRingOcclusion(
  geometry: THREE.BufferGeometry,
  factors: ArrayLike<number>,
): void {
  const position = geometry.getAttribute('position');
  const count = position.count;
  let colors = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!colors || colors.count !== count) {
    colors = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    geometry.setAttribute('color', colors);
  }
  const ink = new THREE.Color(AIM_RING_INK);
  const behind = new THREE.Color(AIM_RING_BEHIND_INK);
  const mixed = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const factor = THREE.MathUtils.clamp(factors[i] ?? 0, 0, 1);
    mixed.copy(ink).lerp(behind, factor);
    colors.setXYZ(i, mixed.r, mixed.g, mixed.b);
  }
  colors.needsUpdate = true;
}

/** Which parts of the aim gizmo are drawn this frame. */
export interface AimPartVisibility {
  ring: boolean;
  mouthDisc: boolean;
  ghost: boolean;
  bud: boolean;
  pierce: boolean;
  tipRing: boolean;
  trail: boolean;
  landing: boolean;
  drop: boolean;
}

/**
 * Visibility of every part of the gizmo.
 *
 * The mouth ring, its fill, the ghost and the bud are always drawn: the arc the
 * plant stands in front of is painted orange instead of being hidden (see
 * ringOcclusionFactors), and the ghost is the thing the player is steering, so
 * nothing about the plant may take it away.
 *
 * The two hoops that tie the shoot to the soil keep their own rule. The landing
 * hoop exists to say "the shoot ends in the air, here"; with the tip under the
 * soil it would be a ring of paint lying on the dirt, several centimetres from
 * the bud it is supposed to ring. The pierce hoop is the opposite: it marks where
 * the shoot enters the ground, so it is drawn only when the path actually
 * crosses - a sprout that leaves the seed upwards has no crossing to mark, and a
 * radicle that goes down from the seed has nothing but.
 */
export function aimPartVisibility(input: {
  tipClearOfGround: boolean;
  crossesSoil: boolean;
}): AimPartVisibility {
  return {
    ring: true,
    mouthDisc: true,
    ghost: true,
    bud: true,
    pierce: input.crossesSoil,
    tipRing: input.tipClearOfGround,
    // The trail is the ground half of the same aim, so it is never hidden while
    // the aim exists; the post only says something while the bud is in the air.
    trail: true,
    // The landing marker is the end of the aim projected onto the soil, and it is
    // drawn whether the bud is in the air or under it: from behind the seed the
    // marker is the only thing that says which way the shoot is leaving. The post
    // is the height half, so it exists only while the bud is above the ground.
    landing: true,
    // The post is the distance from the soil to the end, in either direction: a
    // bud under the ground is exactly the case where "how far down" is the whole
    // question, so hiding the post there hid the answer.
    drop: true,
  };
}

/** Pixel ratio and CSS box the overlay canvas has to draw at. */
export interface OverlayCanvasPlan {
  pixelRatio: number;
  width: number;
  height: number;
}

/**
 * Put the overlay's drawing buffer on the main renderer's.
 *
 * The overlay used to take `min(devicePixelRatio, 2)` for its own pixel ratio
 * while the main renderer is set to the quality band's effective ratio - a tier
 * base times the band's multiplier, which is not display density at all. On a
 * 1.425 display the gizmo was drawn at 1.425x over plants drawn at 1.0x, and a
 * band step that resized the main buffer left the overlay at the density of the
 * frame before it (G9). The main canvas's own buffer and CSS sizes are the only
 * honest reading of what the renderer is drawing at: they follow the tier, the
 * band and a resize without this module knowing about any of them.
 */
export function overlayCanvasPlan(input: {
  /** The main renderer's drawing buffer, in device pixels. */
  bufferWidth: number;
  /** The element box both canvases fill, in CSS pixels. */
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
}): OverlayCanvasPlan {
  const measured = input.cssWidth > 0 ? input.bufferWidth / input.cssWidth : Number.NaN;
  const pixelRatio =
    Number.isFinite(measured) && measured > 0
      ? measured
      : Math.min(input.devicePixelRatio > 0 ? input.devicePixelRatio : 1, 2);
  return {
    pixelRatio,
    width: input.cssWidth > 0 ? input.cssWidth : 1,
    height: input.cssHeight > 0 ? input.cssHeight : 1,
  };
}

export function createGrowthAimGizmo(ctx: AppContext, hooks: GrowthAimGizmoHooks): GrowthAimGizmo {
  let parts: GrowthAimParts | null = null;
  let overlay: THREE.WebGLRenderer | null = null;
  let overlayScene: THREE.Scene | null = null;

  /**
   * Match the overlay's buffer to the main canvas's, every frame.
   *
   * It shares the main camera's projection, so a stale buffer makes a
   * world-space gizmo drift away from the plant under the cursor, and a denser
   * one draws the arrow at a weight the scene it sits on does not have.
   */
  const syncOverlayCanvas = (renderer: THREE.WebGLRenderer): void => {
    const plan = overlayCanvasPlan({
      bufferWidth: ctx.canvas.width,
      cssWidth: ctx.canvas.clientWidth || window.innerWidth,
      cssHeight: ctx.canvas.clientHeight || window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    });
    if (Math.abs(renderer.getPixelRatio() - plan.pixelRatio) > 0.001) {
      renderer.setPixelRatio(plan.pixelRatio);
    }
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== plan.width || size.y !== plan.height) {
      renderer.setSize(plan.width, plan.height, false);
    }
  };

  const ensure = (): GrowthAimParts => {
    if (parts) return parts;
    const group = new THREE.Group();
    group.name = 'growth-aim-gizmo';
    group.visible = false;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.028, 6, 64),
      // One colour per vertex, so the hidden arc can be orange (U09).
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    ring.renderOrder = 1000;

    // The shoot as a ghost. Vertex alpha carries "this part is under the soil"
    // (see `buildGhostColours` in `main.ts`): one geometry, one draw call, and the
    // part of a radicle the eye cannot see fades instead of pretending to be in
    // the air. The canvas has no depth against the scene, so this is the only way
    // the gizmo can say "down there".
    const ghost = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: AIM_ARROW_INK,
        transparent: true,
        vertexColors: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ghost.renderOrder = 1001;

    // The bud the shoot ends in. A cone head said "more of the same this way",
    // which is not where a shoot ends; a bud is.
    const bud = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ color: AIM_BUD_INK, depthTest: false, depthWrite: false }),
    );
    bud.renderOrder = 1002;

    // Two handles, two jobs. The orange puck is the joint along the parent; the
    // green cone is the direction. They are deliberately different shapes and
    // colours so a press can never be ambiguous.
    const originPuck = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({
        color: AIM_ORIGIN_INK,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    );
    originPuck.renderOrder = 1003;
    const directionCone = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 10),
      new THREE.MeshBasicMaterial({
        color: AIM_ARROW_INK,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    );
    directionCone.renderOrder = 1003;

    // The mouth the part leaves from. A translucent fill makes the base ring read
    // as a hole in the part rather than a hoop floating near it.
    const mouthDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.MeshBasicMaterial({
        color: AIM_RING_INK,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mouthDisc.renderOrder = 999;

    // The two hoops that tie the shoot to the soil. Same ink as the ghost, so
    // they read as the same object: one where it goes in, one where it would end
    // in the air.
    const hoopMaterial = (opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        color: AIM_ARROW_INK,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
      });
    const tipRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 6, 48), hoopMaterial(0.9));
    tipRing.renderOrder = 1000;
    const pierce = new THREE.Mesh(new THREE.TorusGeometry(1, 0.022, 6, 40), hoopMaterial(0.55));
    pierce.renderOrder = 999;

    // The ground half of the aim: footprints on the soil under the shoot, the ring
    // it lands on, and the post that says how high a bud in the air ends. Drawn
    // under the ghost in z so a footprint never wins over the shoot itself.
    const trail = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: AIM_ARROW_INK,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    trail.renderOrder = 997;
    const landing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 40), hoopMaterial(0.6));
    landing.renderOrder = 997;
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), hoopMaterial(0.4));
    drop.renderOrder = 997;

    group.add(
      ring,
      mouthDisc,
      ghost,
      bud,
      originPuck,
      directionCone,
      tipRing,
      pierce,
      trail,
      landing,
      drop,
    );
    const scene = new THREE.Scene();
    scene.add(group);
    overlayScene = scene;

    // Its own canvas above the plant/ground one: geometry in the main scene is
    // covered by the ground the moment the arrow points below the surface
    // (roots, radicles).
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.domElement.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;visibility:hidden;';
    document.getElementById('app')?.appendChild(renderer.domElement);
    overlay = renderer;
    // Start on the main canvas's buffer rather than the window's; the render
    // loop keeps it there from the next frame.
    syncOverlayCanvas(renderer);

    parts = {
      group,
      ring,
      mouthDisc,
      ghost,
      bud,
      originPuck,
      directionCone,
      pierce,
      tipRing,
      trail,
      landing,
      drop,
    };
    return parts;
  };

  const hide = (): void => {
    if (parts) parts.group.visible = false;
    if (overlay) overlay.domElement.style.visibility = 'hidden';
  };

  const show = (): void => {
    ensure().group.visible = true;
    if (overlay) overlay.domElement.style.visibility = 'visible';
  };

  /** World points round the ring, reused every frame: the hoop has hundreds. */
  const ringPoints: THREE.Vector3[] = [];

  /**
   * Colour the ring where the plant stands in front of it, and hide only what
   * the gizmo's own rules say to hide.
   */
  const syncVisibility = (current: GrowthAimParts): void => {
    if (!current.group.visible) return;
    if (!hooks.getDrawingData()) return;
    // The ghost and both hoops are the same aim, so they wear the same two inks:
    // green for the direction being asked for, amber while a gene holds it.
    const ink = hooks.isAimHeldByGene?.() ? AIM_ARROW_HELD_INK : AIM_ARROW_INK;
    for (const part of [
      current.ghost,
      current.tipRing,
      current.pierce,
      current.trail,
      current.directionCone,
    ]) {
      const material = part.material as THREE.MeshBasicMaterial;
      if (material.color.getHex() !== ink) material.color.setHex(ink);
    }
    // The ring is drawn over the scene (its own canvas has no depth against the
    // plant), so its hidden arc has to be found rather than depth-tested: every
    // ring vertex is asked whether one of the player's parts stands between it
    // and the eye, and the answer is painted on.
    current.ring.updateWorldMatrix(true, false);
    const geometry = current.ring.geometry;
    const position = geometry.getAttribute('position');
    ringPoints.length = 0;
    for (let i = 0; i < position.count; i += 1) {
      ringPoints.push(
        new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(
          current.ring.matrixWorld,
        ),
      );
    }
    const factors = ringOcclusionFactors({
      cameraPosition: ctx.camera.position,
      points: ringPoints,
      occluders: hooks.occluders(),
    });
    paintRingOcclusion(geometry, factors);

    const visibility = aimPartVisibility({
      tipClearOfGround: hooks.isTipClearOfGround(),
      crossesSoil: hooks.crossesSoil(),
    });
    current.ring.visible = visibility.ring;
    current.mouthDisc.visible = visibility.mouthDisc;
    current.ghost.visible = visibility.ghost;
    current.bud.visible = visibility.bud;
    current.pierce.visible = visibility.pierce;
    current.tipRing.visible = visibility.tipRing;
    current.trail.visible = visibility.trail;
    current.landing.visible = visibility.landing;
    current.drop.visible = visibility.drop;
    const active = hooks.activeHandle?.() ?? null;
    current.originPuck.position.copy(hooks.ringAnchor);
    const puckScale = Math.max(
      0.015,
      Number(current.originPuck.userData.handleScale) || current.ring.scale.x * 0.5,
    );
    current.originPuck.scale.setScalar(active === 'origin' ? puckScale * 1.35 : puckScale);
    current.originPuck.visible = visibility.ring;
    current.directionCone.visible = visibility.ghost;
  };

  const render = (): void => {
    if (!overlay || !overlayScene || !parts?.group.visible) return;
    syncVisibility(parts);
    syncOverlayCanvas(overlay);
    overlay.render(overlayScene, ctx.camera);
  };

  return {
    ensure,
    hide,
    show,
    render,
    get parts() {
      return parts;
    },
  };
}
