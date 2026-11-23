/**
 * Per-frame placement of the bowl mesh: the only module here that mutates a
 * mesh. All of its arithmetic lives in `placement.ts`, `clip.ts` and
 * `profile.ts`; this file wires those answers onto geometry and uniforms.
 */
import type * as THREE from 'three';
import type { CavityClipUniforms } from './bowlMesh.ts';
import { CAVITY_CLIP_MODE_VALUE, cavityClipPolicy, isEyeInsideCavity } from './clip.ts';
import { bowlVerticalScale, cavityBowlPlacement, fitRimToGround } from './placement.ts';
import {
  CAVITY_CUT_OVERREACH,
  CAVITY_MOUTH_FRACTION,
  CAVITY_PROFILE,
  CAVITY_RIM_RING,
  cavityDepthM,
} from './profile.ts';

interface CavityRimState {
  rimIndices?: number[];
  rimFlags?: Uint8Array;
  lastRimKey?: string;
}

/**
 * Place the bowl for this frame: its mouth is anchored to the terrain surface
 * (not to the root-bubble centre), it is deep enough to hold the cavity, and its
 * rim vertices are lifted or lowered to the terrain height at each angle.
 *
 * That last part is what stops the opening ending on a flat horizontal ring.
 * On a slope the downhill lip is lower than the uphill lip, so a horizontal rim
 * either floats above the ground on one side or leaves a void below it on the
 * other. The shader itself cuts fragments, so its edge already follows the
 * terrain; the bowl has to follow the same contour to stay behind it.
 */
export function updateCavityBowl(
  bowl: THREE.Mesh,
  centre: THREE.Vector3,
  radius: number,
  progress: number,
  surfaceHeight?: (x: number, z: number) => number,
  eye?: THREE.Vector3,
  apertureRadius?: number,
  /** World Y of the deepest root the cavity has to hold. */
  deepestRootY?: number,
): void {
  const surfaceY = surfaceHeight ? surfaceHeight(centre.x, centre.z) : centre.y;
  const mouthRadius = Math.max(0.05, apertureRadius ?? radius * CAVITY_MOUTH_FRACTION);
  const rootDepthM =
    deepestRootY === undefined || !Number.isFinite(deepestRootY)
      ? 0
      : Math.max(0, surfaceY - deepestRootY);
  const depthM = cavityDepthM(mouthRadius, rootDepthM);
  const placement = cavityBowlPlacement(radius, progress, Math.max(0.1, depthM), apertureRadius);
  bowl.visible = placement.visible;
  if (!bowl.visible) return;

  bowl.scale.set(placement.horizontalScale, placement.verticalScale, placement.horizontalScale);
  bowl.position.set(centre.x, surfaceY, centre.z);
  bowl.position.y += placement.rimOffsetY;

  const clip = (bowl.material as THREE.Material).userData.clipUniforms as
    | CavityClipUniforms
    | undefined;

  // The plane the shell's mouth is actually on. The bowl is anchored on the
  // lowest ground under the rim (`fit.lowestGround`, below), so on a slope the
  // mouth is not the ground at the cavity's centre: it can be a metre lower. The
  // clip used the centre's ground for both tests that read a plane - the buried
  // eye's sightline, and "nothing above the mouth outside the mouth" - so the
  // uphill lip and the wall under it counted as above the mouth and were thrown
  // away, leaving the cut open to the sky along the uphill rim. One plane, the
  // one the geometry is drawn on.
  let mouthPlaneY = surfaceY;

  // The bowl is always drawn; what changes with the eye is whether its wall may
  // be seen *through the opening*. A buried eye outside the pit would otherwise
  // look at the far wall across the hole. Clipping only those fragments keeps
  // the cavity visible from underground and the hole open to the sky.
  const applyClip = (): void => {
    if (!eye || !clip) return;
    const inside = isEyeInsideCavity(eye, {
      x: bowl.position.x,
      y: bowl.position.y,
      z: bowl.position.z,
      horizontalScale: placement.horizontalScale,
      verticalScale: placement.verticalScale,
    });
    // The eye's *own* ground answers "is the eye under the surface", not the
    // mouth's plane. The mouth sits on the lowest ground under the rim, so on a
    // slope or in a hollow an eye standing in the open is below that plane while
    // still metres above the ground it stands on. Measured against the plane it
    // was classified buried, and the buried clip drops the shell's near half and
    // every fragment whose sightline leaves the plane outside the aperture: the
    // pit's edges opened onto the water and the sky from level angles. Measured
    // against its own ground the same eye is what it is - outside and above.
    const eyeGroundY = surfaceHeight ? surfaceHeight(eye.x, eye.z) : surfaceY;
    const policy = cavityClipPolicy(eye.y, eyeGroundY, inside);
    clip.uBowlEye.value.copy(eye);
    clip.uBowlCenter.value.copy(bowl.position);
    clip.uBowlApertureCenter.value.set(centre.x, centre.z);
    // The bowl's own mouth, not the shader's cut: clipping to the cut discarded
    // the wall's rim ring and left a thin crescent of sky between the lip and
    // the far wall.
    // The opening's plan radius as the *soil* cuts it. The bowl's rim ring is
    // built out to the same width, so this is also the widest part of the shell:
    // at the mouth radius instead, the clip culled the outer sliver of the lip -
    // the sliver that reaches the soil's edge - and left a ring of sky between
    // the bowl and the hole it was supposed to line.
    clip.uBowlApertureRadius.value = Math.max(
      0.05,
      placement.horizontalScale * CAVITY_CUT_OVERREACH,
    );
    // The shell's own mouth plane, so the sightline test asks where the ray
    // leaves the opening the wall is built around rather than a plane the wall
    // does not sit on.
    clip.uBowlSurfaceY.value = mouthPlaneY;
    clip.uBowlClipMode.value = CAVITY_CLIP_MODE_VALUE[policy.mode];
  };

  if (!surfaceHeight) {
    applyClip();
    return;
  }
  const state = bowl.userData as CavityRimState;
  const geometry = bowl.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  if (!state.rimIndices) {
    state.rimIndices = [];
    state.rimFlags = new Uint8Array(position.count);
    // The rim is the profile's y = 0 ring, wherever the shell sits this frame.
    const rimY = CAVITY_PROFILE[CAVITY_RIM_RING].y;
    for (let i = 0; i < position.count; i += 1) {
      if (Math.abs(position.getY(i) - rimY) < 1e-4) {
        state.rimIndices.push(i);
        state.rimFlags[i] = 1;
      }
    }
  }
  const rim = state.rimIndices;

  // Every rim vertex follows the ground it cuts through. The shader's cut is
  // per-fragment, so it follows the hillside exactly; a level ring left the lip
  // floating over the downhill side of a slope and buried on the uphill side.
  const ground: number[] = [];
  for (const index of rim) {
    const worldX = centre.x + position.getX(index) * placement.horizontalScale;
    const worldZ = centre.z + position.getZ(index) * placement.horizontalScale;
    ground.push(surfaceHeight(worldX, worldZ));
  }
  const fit = fitRimToGround(ground);
  // The mouth plane is the *lowest* ground under the rim, not the highest and
  // not a stretched average. Anchored here, every rim vertex reaches its own
  // ground by moving up, and the wall between the lip and the floor is never
  // squashed to make room: the uphill lip is a shallow pit and the downhill lip
  // a deep one, which is what digging into a bank does. Anchoring on the ground
  // at the plant instead made the lip float over the downhill side and forced
  // the stretch-and-clamp pair that flattened the cut wall into a dish.
  // The rim's own travel is height the wall must not also spend: the budget is
  // the pit's *rim-to-floor* depth, not its mouth-plane depth (`bowlVerticalScale`).
  // Without this the floor dropped below the budget wherever the mouth spanned a
  // slope, and sat under the floor of the earth body the pit is cut into.
  placement.verticalScale = bowlVerticalScale(depthM, fit.highestGround - fit.lowestGround);
  bowl.scale.y = placement.verticalScale;
  bowl.position.y = fit.lowestGround + placement.rimOffsetY;
  mouthPlaneY = fit.lowestGround;
  applyClip();

  const rimKey = `${centre.x.toFixed(2)}|${centre.z.toFixed(2)}|${placement.horizontalScale.toFixed(2)}|${placement.verticalScale.toFixed(3)}|${fit.highestGround.toFixed(2)}|${fit.lowestGround.toFixed(2)}`;
  if (state.lastRimKey === rimKey) return;
  state.lastRimKey = rimKey;

  for (let k = 0; k < rim.length; k += 1) {
    // Positive is uphill and allowed. Clamping every rim vertex to the mouth
    // plane kept the lip level while the shader's cut follows the hillside, so
    // the uphill side of the opening was a strip of cut-away soil with no bowl
    // behind it: a pale band the colour of the sky. Each rim vertex sits on its
    // own ground instead, exactly like the cut it backs.
    const localY = (ground[k] + placement.rimOffsetY - bowl.position.y) / placement.verticalScale;
    position.setY(rim[k], Math.max(0, localY));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  // The lip ring is a cut edge, not a surface. Each rim vertex has just been
  // moved onto its own ground, so the ring is no longer flat and its computed
  // normals turn to face the sky - which lit it as an unbroken bright line round
  // the mouth. That line is the seam the player saw whenever the cavity grew: the
  // growth changes the scale, this refit changes the rim heights, and the normals
  // were rebuilt with them. Borrowing the top course's normals shades the lip as
  // part of the wall it belongs to.
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const cols = geometry.userData.cols as number | undefined;
  if (normals && cols) {
    for (const index of rim) {
      const below = index + cols;
      if (below >= normals.count) continue;
      normals.setXYZ(index, normals.getX(below), normals.getY(below), normals.getZ(below));
    }
    normals.needsUpdate = true;
  }
}
