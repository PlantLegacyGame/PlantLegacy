/**
 * The tube every stem, branch and root is drawn as - and the line round it.
 *
 * These live outside the renderer so the shape can be tested without a scene:
 * the difference between the body's tube and its ink hull is the difference
 * between a plant whose outlines merge and one whose joints collide.
 */
import { getSegmentTaperExponent, segmentRadiusAt } from '@plant-legacy/shared/growth';
import * as THREE from 'three';

/** The slice of the mesh quality settings a tube's shape depends on. */
export interface TubeShapeConfig {
  tubeRadialSegments: number;
  tubeLengthSegments: number;
  /** The organ's morphology; omitted callers keep the old round tube. */
  tubeCrossSection?: 'round' | 'ribbed' | 'hollow' | 'flattened' | 'lobed';
  /** Radial sides from morphology; falls back to the quality setting. */
  tubeSides?: number;
}

/**
 * A shared-tube cache has to end somewhere. Once full, the oldest names are
 * forgotten rather than disposed: a finished segment may still be in the scene
 * holding that geometry, and deleting its buffers would be a hole in the plant.
 * The mesh owns its geometry until the plant rebuilds or is disposed.
 */
export const MAX_TUBE_CACHE = 1024;

/** A direction turned off the part's own axis, in the tube's own frame. */
export interface TubeTurn {
  /** How far off +Y the direction is. */
  angle: number;
  /** Which way round: an offset along local +X at azimuth 0. */
  azimuth: number;
}

/**
 * The turns a part makes into the parts it shares a joint with.
 *
 * The joints themselves never move - the base stays at the origin and the tip at
 * (0, length, 0) - so whichever end turns, the part that meets it still starts
 * exactly where the graph puts it. What bends is only the body that reaches the
 * joint, which is what turns two tubes crossing at a crease into one organism
 * (see `jointElbow.ts` for the angle itself).
 *
 * - `base`: this part leaves its parent mid-way along it, so it starts along
 *   the parent's own line and turns into its own - the branch collar a living
 *   root grows.
 * - `tip`: a child leaves this part's tip at an angle, so its last stretch turns
 *   to arrive facing that child instead of ending squared off.
 *
 * Both may be set: a lateral that leaves a parent mid-way and branches again at
 * its own tip is one curve with both ends turned.
 */
export interface TubeElbow {
  base?: TubeTurn;
  tip?: TubeTurn;
}

/** Where the bend begins to leave the axis, as a fraction of the length. */
const ELBOW_START_CONTROL = 0.45;
/** How far short of the tip the curve's second handle sits, as a fraction. */
const ELBOW_END_CONTROL = 0.3;

const UP = new THREE.Vector3(0, 1, 0);

/** A direction given as how far off +Y it is, and which way round. */
function offAxis(angle: number, azimuth: number): THREE.Vector3 {
  const sideways = Math.sin(angle);
  return new THREE.Vector3(
    Math.cos(azimuth) * sideways,
    Math.cos(angle),
    Math.sin(azimuth) * sideways,
  );
}

// Tube geometry cache: avoids rebuilding CylinderGeometry on every rebuild/growth
// frame when the same (radius0, radius1, length) recurs. Keys are rounded to
// 3 decimals so near-identical segments share geometry.
const tubeGeometryCache = new Map<string, THREE.BufferGeometry>();

function radialSides(quality: TubeShapeConfig): number {
  return Math.max(3, Math.min(24, Math.round(quality.tubeSides ?? quality.tubeRadialSegments)));
}

function tubeGeometryCacheKey(
  r0: number,
  r1: number,
  length: number,
  quality: TubeShapeConfig,
  taper: number,
): string {
  // The taper exponent is part of the shape: a cached tube built with a
  // different exponent is the wrong silhouette, not just a different number.
  return `${r0.toFixed(3)},${r1.toFixed(3)},${length.toFixed(3)},${radialSides(quality)}x${quality.tubeLengthSegments},${quality.tubeCrossSection ?? 'round'},${taper.toFixed(2)}`;
}

/**
 * Push a cylinder's circular rings into the organ's cross-section. The profile
 * is applied in the tube's own X/Z plane, so it follows the spine and the
 * elbow instead of being baked into a world axis.
 */
function applyCrossSection(geometry: THREE.BufferGeometry, quality: TubeShapeConfig): void {
  const crossSection = quality.tubeCrossSection ?? 'round';
  if (crossSection === 'round') return;
  const sides = radialSides(quality);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const radius = Math.hypot(x, z);
    if (radius <= 1e-6) continue;
    const angle = Math.atan2(z, x);
    let scale = 1;
    if (crossSection === 'flattened') {
      scale = 0.58 + 0.42 * Math.abs(Math.cos(angle));
    } else if (crossSection === 'ribbed') {
      scale = 1 + 0.075 * Math.cos(sides * angle);
    } else if (crossSection === 'lobed') {
      scale = 1 + 0.14 * Math.cos(sides * angle);
    } else if (crossSection === 'hollow') {
      // A hollow culm reads as a thin ring in silhouette; the inner void is
      // open at each end, so the caps are left to the joint sphere.
      scale = 0.9 + 0.06 * Math.cos(sides * angle);
    }
    position.setX(i, x * scale);
    position.setZ(i, z * scale);
  }
  position.needsUpdate = true;
}

/**
 * Bend a cylinder's rings onto the shared segment profile.
 *
 * CylinderGeometry interpolates radius linearly from base to tip, which draws
 * every internode as a funnel. The neck belongs at the junction: rescale each
 * ring by `segmentRadiusAt / linear`, so the belly is at the joint and the shank
 * holds for the rest of the segment. The tube's own ends keep the radii it was
 * built with, so joints and tips are unchanged.
 */
export function applySegmentProfile(
  geometry: THREE.BufferGeometry,
  r0: number,
  r1: number,
  length: number,
  taper: number,
): void {
  const position = geometry.getAttribute('position');
  const span = Math.max(length, 1e-4);
  for (let i = 0; i < position.count; i += 1) {
    const t = THREE.MathUtils.clamp(position.getY(i) / span, 0, 1);
    const linear = r0 + (r1 - r0) * t;
    if (linear <= 1e-6) continue;
    const scale = segmentRadiusAt(r0, r1, t, taper) / linear;
    position.setX(i, position.getX(i) * scale);
    position.setZ(i, position.getZ(i) * scale);
  }
  position.needsUpdate = true;
}

/**
 * The spine of a part whose tip turns: a cubic that leaves the axis straight and
 * arrives at the joint along the direction the next part leaves in.
 *
 * Both ends are pinned - the base at the origin, the tip at (0, length, 0) - so a
 * bend here can never move the joint, only the body that reaches it. `t` runs
 * along the curve, not along its length; the rings are placed by it so the
 * profile still belongs to the same part.
 */
function spinePointBetween(
  t: number,
  length: number,
  from: THREE.Vector3,
  to: THREE.Vector3,
): { position: THREE.Vector3; tangent: THREE.Vector3 } {
  const p0 = new THREE.Vector3(0, 0, 0);
  const p3 = new THREE.Vector3(0, length, 0);
  const p1 = p0.clone().addScaledVector(from, length * ELBOW_START_CONTROL);
  const p2 = p3.clone().addScaledVector(to, -length * ELBOW_END_CONTROL);
  const u = 1 - t;
  const position = new THREE.Vector3()
    .addScaledVector(p0, u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
  // The derivative's scale is irrelevant to a direction, and its own length at
  // the ends is what makes both directions exact.
  const tangent = new THREE.Vector3()
    .addScaledVector(p1.clone().sub(p0), 3 * u * u)
    .addScaledVector(p2.clone().sub(p1), 6 * u * t)
    .addScaledVector(p3.clone().sub(p2), 3 * t * t);
  return { position, tangent: tangent.normalize() };
}

export function elbowSpinePoint(
  t: number,
  length: number,
  angle: number,
  azimuth: number,
): { position: THREE.Vector3; tangent: THREE.Vector3 } {
  return spinePointBetween(t, length, UP, offAxis(angle, azimuth));
}

/**
 * The spine of a part that leaves its parent along the parent's own line.
 *
 * The mirror of `elbowSpinePoint`: the base arrives turned, the tip is the
 * part's own +Y. Both ends stay pinned, so the collar never moves the joint -
 * it only makes the tissue flow out of the parent instead of meeting it at a
 * crease.
 */
export function collarSpinePoint(
  t: number,
  length: number,
  angle: number,
  azimuth: number,
): { position: THREE.Vector3; tangent: THREE.Vector3 } {
  return spinePointBetween(t, length, offAxis(angle, azimuth), UP);
}

/** The spine of an elbow, whichever end it belongs to. */
export function elbowSpineAt(
  t: number,
  length: number,
  elbow: TubeElbow,
): { position: THREE.Vector3; tangent: THREE.Vector3 } {
  const from = elbow.base ? offAxis(elbow.base.angle, elbow.base.azimuth) : UP;
  const to = elbow.tip ? offAxis(elbow.tip.angle, elbow.tip.azimuth) : UP;
  return spinePointBetween(t, length, from, to);
}

/**
 * Wrap a tube built on +Y onto the elbow spine, rings and all.
 *
 * A vertex keeps its place round the tube and its place along it; what changes
 * is where that ring sits on the curve, and which way it faces. Rings near the
 * tip turn with it, so the end cap comes out square to the part that leaves.
 */
function bendOntoElbow(geo: THREE.BufferGeometry, length: number, elbow: TubeElbow): void {
  const span = Math.max(length, 1e-4);
  const position = geo.getAttribute('position');
  const radial = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  for (let i = 0; i < position.count; i += 1) {
    const t = THREE.MathUtils.clamp(position.getY(i) / span, 0, 1);
    const spine = elbowSpineAt(t, length, elbow);
    // The ring keeps its place round the tube; only which way it faces changes,
    // so the open end comes out square to whatever it meets.
    radial
      .set(position.getX(i), 0, position.getZ(i))
      .applyQuaternion(rotation.setFromUnitVectors(UP, spine.tangent));
    position.setXYZ(
      i,
      spine.position.x + radial.x,
      spine.position.y + radial.y,
      spine.position.z + radial.z,
    );
  }
  position.needsUpdate = true;
}

/** Put a built cylinder on the growth axis and give it the organ's own shape. */
export function shapeTubeGeometry(
  geo: THREE.BufferGeometry,
  r0: number,
  r1: number,
  length: number,
  bend: number,
  taper: number,
  elbow: TubeElbow | null = null,
): void {
  // CylinderGeometry is centred on its Y axis. Move the base to the origin and
  // keep +Y as the growth axis; the old rotateX made the geometry run along Z
  // while the mesh was aligned from +X, so every tube was off-axis.
  geo.translate(0, length / 2, 0);
  applySegmentProfile(geo, r0, r1, length, taper);
  if (Math.abs(bend) > 1e-5) {
    const position = geo.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      const t = THREE.MathUtils.clamp(position.getY(i) / Math.max(length, 1e-4), 0, 1);
      // Bow the middle while keeping both endpoints on the parent/joint, so
      // roots wander without detaching from the graph.
      position.setX(i, position.getX(i) + bend * Math.sin(Math.PI * t));
    }
    position.needsUpdate = true;
  }
  if (elbow && elbowHasTurn(elbow)) {
    bendOntoElbow(geo, length, elbow);
  }
  geo.computeVertexNormals();
}

/** The elbow as a cache key: two parts at the same angle and side share a tube. */
function elbowHasTurn(elbow: TubeElbow | null | undefined): boolean {
  if (!elbow) return false;
  return (elbow.base?.angle ?? 0) > 1e-3 || (elbow.tip?.angle ?? 0) > 1e-3;
}

function elbowKey(elbow: TubeElbow | null | undefined): string {
  if (!elbowHasTurn(elbow) || !elbow) return '';
  const one = (turn: TubeTurn | undefined) =>
    turn && turn.angle > 1e-3 ? `${turn.angle.toFixed(3)}@${turn.azimuth.toFixed(3)}` : '';
  return `|b${one(elbow.base)}|t${one(elbow.tip)}`;
}

function makeTube(
  r0: number,
  r1: number,
  length: number,
  quality: TubeShapeConfig,
  bend: number,
  taper: number,
  openEnded: boolean,
  elbow: TubeElbow | null = null,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(
    r0,
    r1,
    length,
    radialSides(quality),
    quality.tubeLengthSegments,
    openEnded,
  );
  applyCrossSection(geo, quality);
  shapeTubeGeometry(geo, r0, r1, length, bend, taper, elbow);
  return geo;
}

function sharedTube(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = tubeGeometryCache.get(key);
  if (!geo) {
    geo = build();
    tubeGeometryCache.set(key, geo);
    while (tubeGeometryCache.size > MAX_TUBE_CACHE) {
      const oldest = tubeGeometryCache.keys().next().value;
      if (oldest === undefined) break;
      tubeGeometryCache.delete(oldest);
    }
  }
  return geo;
}

/** The body of a part: a capped tube, base at the origin, growing along +Y. */
export function buildTubeGeometry(
  r0: number,
  r1: number,
  length: number,
  quality: TubeShapeConfig,
  bend = 0,
  /** The organ's own taper exponent: roots hold their body, shoots neck. */
  taper = getSegmentTaperExponent(),
  elbow: TubeElbow | null = null,
): THREE.BufferGeometry {
  const key = `${tubeGeometryCacheKey(r0, r1, length, quality, taper)}|${bend.toFixed(3)}${elbowKey(elbow)}`;
  return sharedTube(key, () => makeTube(r0, r1, length, quality, bend, taper, false, elbow));
}

/**
 * The body of a part that is still growing: built fresh, never cached.
 *
 * A part mid-growth has a new shape every frame, so every frame's tube is a
 * cache key nothing will ever ask for again - and a cached entry is kept
 * forever, on the GPU too. The frame that asks for a live shape owns it, and it
 * is its to dispose; a finished part goes back to the shared tube.
 */
export function buildLiveTubeGeometry(
  r0: number,
  r1: number,
  length: number,
  quality: TubeShapeConfig,
  bend = 0,
  taper = getSegmentTaperExponent(),
  elbow: TubeElbow | null = null,
): THREE.BufferGeometry {
  return makeTube(r0, r1, length, quality, bend, taper, false, elbow);
}

/**
 * The ink hull's tube: the body's own shape, without its end caps.
 *
 * The hull is the body pushed out along its normals, and a cap's normal points
 * along the tube. A capped hull is therefore pushed the ink's width *past* each
 * end, so at a joint one segment's dark disc was driven through the part it grew
 * into and drew a band across it: the two outlines did not merge, they collided.
 * An open tube has no cap to push, so the line runs round the body and stops at
 * the end the next part continues from.
 */
export function buildInkHullGeometry(
  r0: number,
  r1: number,
  length: number,
  quality: TubeShapeConfig,
  bend = 0,
  taper = getSegmentTaperExponent(),
  elbow: TubeElbow | null = null,
): THREE.BufferGeometry {
  const key = `ink|${tubeGeometryCacheKey(r0, r1, length, quality, taper)}|${bend.toFixed(3)}${elbowKey(elbow)}`;
  return sharedTube(key, () => makeTube(r0, r1, length, quality, bend, taper, true, elbow));
}

/** The hull of a growing part: the open tube, fresh, and owned by the caller. */
export function buildLiveInkHullGeometry(
  r0: number,
  r1: number,
  length: number,
  quality: TubeShapeConfig,
  bend = 0,
  taper = getSegmentTaperExponent(),
  elbow: TubeElbow | null = null,
): THREE.BufferGeometry {
  return makeTube(r0, r1, length, quality, bend, taper, true, elbow);
}

/** How many shared tubes exist; a test hook for the cache's own bookkeeping. */
export function tubeGeometryCacheSize(): number {
  return tubeGeometryCache.size;
}

/** Drop every shared tube. Only for tests and a full teardown. */
export function clearTubeGeometryCache(): void {
  for (const geo of tubeGeometryCache.values()) geo.dispose();
  tubeGeometryCache.clear();
}
