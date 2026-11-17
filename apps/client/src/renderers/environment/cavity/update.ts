/**
 * Per-frame placement of the bowl mesh: the only module here that mutates a
 * mesh. All of its arithmetic lives in `placement.ts`, `clip.ts` and
 * `profile.ts`; this file wires those answers onto geometry and uniforms.
 */
import type * as THREE from 'three';
import type { CavityClipUniforms } from './bowlMesh.ts';
import { CAVITY_CLIP_MODE_VALUE, cavityClipPolicy, isEyeInsideCavity } from './clip.ts';
import { cavityBowlPlacement, fitRimToGround } from './placement.ts';
import {
  CAVITY_CUT_OVERREACH,
  CAVITY_MOUTH_FRACTION,
  CAVITY_PROFILE,
  CAVITY_RIM_RING,
  CAVITY_RIM_WALL_BASE,
  cavityDepthM,
} from './profile.ts';

interface CavityRimState {
  rimIndices?: number[];
  /** The shell's own height per vertex, before any floor clamp. */
  baseY?: Float32Array;
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
    const policy = cavityClipPolicy(eye.y, surfaceY, inside);
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
    clip.uBowlSurfaceY.value = surfaceY;
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
    state.baseY = new Float32Array(position.count);
    state.rimFlags = new Uint8Array(position.count);
    // The rim is the profile's y = 0 ring, wherever the shell sits this frame.
    const rimY = CAVITY_PROFILE[CAVITY_RIM_RING].y;
    for (let i = 0; i < position.count; i += 1) {
      state.baseY[i] = position.getY(i);
      if (Math.abs(position.getY(i) - rimY) < 1e-4) {
        state.rimIndices.push(i);
        state.rimFlags[i] = 1;
      }
    }
  }
  const baseY = state.baseY as Float32Array;
  const rimFlags = state.rimFlags as Uint8Array;
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
  // The rim is buried by the same sink the mouth plane carries, so on level
  // ground every rim vertex lands exactly on its own terrain height.
  for (let i = 0; i < ground.length; i += 1) ground[i] += placement.rimOffsetY;

  const fit = fitRimToGround(ground, placement.verticalScale, depthM);
  // The mouth plane is the ground at the plant, not the highest ground under
  // the rim. Anchoring to the highest sample put the whole opening above the
  // plant on a slope: the seed sat at the bottom of a well and the camera looked
  // at its uphill wall. Rim vertices still follow their own terrain, so the
  // uphill lip is buried in the hillside and the downhill lip stretches to the
  // ground below it - a pit dug into a slope, instead of a level ring lifted to
  // the top of the hill.
  bowl.position.y = surfaceY + placement.rimOffsetY;
  placement.verticalScale = fit.verticalScale;
  bowl.scale.y = fit.verticalScale;
  applyClip();

  const rimKey = `${centre.x.toFixed(2)}|${centre.z.toFixed(2)}|${placement.horizontalScale.toFixed(2)}|${fit.verticalScale.toFixed(3)}|${fit.floorScale.toFixed(3)}|${fit.highestGround.toFixed(2)}|${fit.lowestGround.toFixed(2)}`;
  if (state.lastRimKey === rimKey) return;
  state.lastRimKey = rimKey;

  for (let i = 0; i < position.count; i += 1) {
    if (rimFlags[i] === 0) position.setY(i, baseY[i] * fit.floorScale);
  }
  for (let k = 0; k < rim.length; k += 1) {
    const localY = (ground[k] - bowl.position.y) / fit.verticalScale;
    // Positive is uphill and allowed. Clamping every rim vertex to the mouth
    // plane kept the lip level while the shader's cut follows the hillside, so
    // the uphill side of the opening was a strip of cut-away soil with no bowl
    // behind it: a pale band the colour of the sky. Each rim vertex sits on its
    // own ground instead, exactly like the cut it backs.
    position.setY(rim[k], Math.max(CAVITY_RIM_WALL_BASE, localY));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}
