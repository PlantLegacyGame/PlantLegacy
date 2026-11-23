/**
 * Draws the T56 aperture soil body: the ground under Root Sight as a volume.
 *
 * The shared field builds the block and its shaft; this file turns the arrays
 * into a `BufferGeometry`, bands the vertices by depth in the dug wall's own
 * palette, and lights it. Nothing here decides the aperture's size: the caller
 * passes the mouth the tuned bowl was placed at, and the body is cut two
 * centimetres wider so the bowl remains the surface the player sees.
 *
 * It is drawn inside-out as well as outside-in (`DoubleSide`). A buried eye is
 * inside the block, and the surfaces it has to see - the underside of the
 * ground, the shaft's wall, the floor - are the back faces of the same body the
 * surface view sees from outside.
 */
import {
  type ApertureSoilParams,
  buildApertureSoilMesh,
  type GroundHeight,
} from '@plant-legacy/shared/world';
import * as THREE from 'three';
import { CAVITY_CUT_OVERREACH, CAVITY_STRATA_BANDS } from './cavity/profile.ts';
import { SOIL_NEAR_CUT_M } from './ground/shaderOverrides.ts';

/**
 * The bubble the body drops around a buried eye. One number for the sheet and
 * the earth under it, so the two cannot open different holes.
 */
export const APERTURE_SOIL_NEAR_CUT_M = SOIL_NEAR_CUT_M;

/**
 * The body's size, as distances rather than fractions of the aperture.
 *
 * Extent and depth have floors so even a seedling's 22 cm mouth has a body a
 * buried eye can be inside of; both grow with a wide aperture. The voxel is
 * finer than the arch's 0.28 m because this body is small and its shaft is the
 * detail the buried view is for.
 */
export const APERTURE_SOIL_EXTENT_M = 3.6;
export const APERTURE_SOIL_MIN_DEPTH_M = 3.4;
export const APERTURE_SOIL_TOP_INSET_M = 0.03;
export const APERTURE_SOIL_VOXEL_M = 0.26;
/** Clearance between the bowl's mouth and the soil's shaft wall. */
export const APERTURE_SOIL_GAP_M = 0.02;
/**
 * How far inside the body's footprint a buried eye is kept.
 *
 * One number for the two halves of the same promise: the renderer draws the body
 * only inside `extentM - this`, and the camera hold pulls a buried eye to
 * `extentM - this`, so an eye that is under the surface always has the body in
 * front of it instead of the back of the ground's sheet.
 */
export const APERTURE_SOIL_EYE_HOLD_M = 0.3;
/**
 * A frame's worth of slack past that hold, for the draw test alone.
 *
 * The camera clamp runs once per frame, before the render pass; a held eye sits
 * exactly on the limit, and a float or a frame of travel past it must not be the
 * reason the body stops being drawn. The clamp still keeps the eye inside; this
 * only stops the two halves arguing over the boundary.
 */
export const APERTURE_SOIL_HOLD_SLACK_M = 0.05;
/** How far below the bowl's floor the body's own floor sits. */
export const APERTURE_SOIL_BELOW_FLOOR_M = 1.2;

export interface ApertureSoilPalette {
  topsoil: THREE.Color;
  subsoil: THREE.Color;
  deep: THREE.Color;
}

/**
 * The field's parameters for an aperture of `mouthRadiusM` opened to
 * `depthM` below its lip.
 *
 * The mouth is the bowl's own mouth (the aperture times the bowl's cut
 * overreach), not the shader's cut radius: the bowl's rim is the visible edge of
 * the hole and the soil has to sit just behind it, never through it.
 */
/**
 * The plan radius a buried eye is held inside, for an aperture of `apertureRadiusM`.
 *
 * Takes the aperture's own radius (not the bowl's mouth) so the caller cannot
 * forget the cut overreach the body is built from; the result is the body's
 * footprint less the eye's keep-out margin.
 */
export function apertureSoilHoldRadiusM(apertureRadiusM: number): number {
  const aperture = Number.isFinite(apertureRadiusM) ? Math.max(0.05, apertureRadiusM) : 0.05;
  const extent = apertureSoilParamsFor({
    centreX: 0,
    centreZ: 0,
    mouthRadiusM: aperture * CAVITY_CUT_OVERREACH,
    depthM: 0,
  }).extentM;
  return Math.max(0.1, extent - APERTURE_SOIL_EYE_HOLD_M);
}

export function apertureSoilParamsFor(input: {
  centreX: number;
  centreZ: number;
  mouthRadiusM: number;
  depthM: number;
}): ApertureSoilParams {
  const mouth = Math.max(0.05, input.mouthRadiusM);
  return {
    centreXM: input.centreX,
    centreZM: input.centreZ,
    voidRadiusM: mouth + APERTURE_SOIL_GAP_M,
    extentM: Math.max(APERTURE_SOIL_EXTENT_M, mouth + 1.2),
    depthM: Math.max(APERTURE_SOIL_MIN_DEPTH_M, input.depthM),
    topInsetM: APERTURE_SOIL_TOP_INSET_M,
    voxelM: APERTURE_SOIL_VOXEL_M,
    marginM: 0.9,
  };
}

/** Band edges, taken from the bowl's own strata so the two walls agree. */
const BAND_SUBSOIL_FROM = CAVITY_STRATA_BANDS[1]?.from ?? 0.24;
const BAND_DEEP_FROM = CAVITY_STRATA_BANDS[2]?.from ?? 0.58;

/**
 * Build the aperture body, or `null` when the region meshes to nothing.
 *
 * `ground` is the drawn surface (with the skin), so the body's top is the sheet
 * minus the inset: the sheet stays the visible surface from above, and the body
 * is the earth a buried eye sees in front of that sheet from below.
 */
export function createApertureSoilMesh(
  params: ApertureSoilParams,
  ground: GroundHeight,
  palette: ApertureSoilPalette,
): THREE.Mesh | null {
  const body = buildApertureSoilMesh(ground, params);
  if (!body) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(body.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(body.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(body.indices, 1));

  const colours = new Float32Array(body.vertices * 3);
  const colour = new THREE.Color();
  for (let v = 0; v < body.vertices; v += 1) {
    const stratum = body.strata[v];
    colour.copy(
      stratum >= BAND_DEEP_FROM
        ? palette.deep
        : stratum >= BAND_SUBSOIL_FROM
          ? palette.subsoil
          : palette.topsoil,
    );
    // The same deterministic per-vertex grain the arch uses: one colour per
    // vertex, coarse on purpose, enough to stop a band reading as paint.
    const x = body.positions[v * 3];
    const y = body.positions[v * 3 + 1];
    const z = body.positions[v * 3 + 2];
    const grain = 0.93 + 0.14 * Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719));
    colours[v * 3] = colour.r * grain;
    colours[v * 3 + 1] = colour.g * grain;
    colours[v * 3 + 2] = colour.b * grain;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
    // A buried eye is inside this body; the walls it must see are back faces.
    side: THREE.DoubleSide,
    // Sky fill, scaled per frame with the scene's light by
    // `setApertureSoilLight`, so the inside of the earth is not black at night.
    // One tinted fill, the topsoil's own colour. A per-vertex fill - a white
    // emissive multiplied by `vColor` - was tried for the bands and cut: on the
    // buried view it moved the frame by at most 6 of 255 levels, because the
    // three bands sit too close in luminance for the fill to carry them. The
    // bands ride the lit surfaces' vertex colours, as they do on the pit wall.
    emissive: palette.topsoil.clone(),
    emissiveIntensity: 0.34,
  });
  // The near-side cut (T56/C21-C). The body is solid earth around the shaft, so
  // an eye that is inside it looks at a brown wall whichever way it turns - the
  // pit can be a stride away and still hidden. The shader drops a hand-sized
  // bubble of the body around the eye, the same bubble the soil sheet uses, so
  // the opening and the roots can be seen from any eye position.
  const nearCut = {
    eye: { value: new THREE.Vector3() },
    radius: { value: APERTURE_SOIL_NEAR_CUT_M },
    enabled: { value: 0 },
  };
  material.userData.nearCut = nearCut;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uApertureEye = nearCut.eye;
    shader.uniforms.uApertureNearCut = nearCut.radius;
    shader.uniforms.uApertureNearCutOn = nearCut.enabled;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vApertureWorld;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvApertureWorld = (modelMatrix * vec4(position, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
varying vec3 vApertureWorld;
uniform vec3 uApertureEye;
uniform float uApertureNearCut;
uniform float uApertureNearCutOn;`,
    );
    // Before the lit path: a discarded fragment costs nothing after it.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
  if (uApertureNearCutOn > 0.5 && distance(vApertureWorld, uApertureEye) < uApertureNearCut) {
    discard;
  }`,
    );
  };
  material.customProgramCacheKey = () => 'aperture-soil-near-cut';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'aperture-soil-volume';
  // It is the earth beside the pit, not an overlay: it receives the scene's
  // light, and its own faces are the only shadow casters down there.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.fillColour = palette.topsoil.clone();
  mesh.userData.fillStrength = 0.34;
  mesh.userData.nearCut = nearCut;
  return mesh;
}

/**
 * Enable the near-side cut around this frame's eye.
 *
 * Only the eye's position is written; the radius is the shared constant. The
 * cut is off for an eye above the ground, where the body is not drawn at all but
 * a stale bubble would still be baked into the next program.
 */
export function setApertureSoilEye(
  mesh: THREE.Mesh,
  eye: { x: number; y: number; z: number },
  buried: boolean,
): void {
  const nearCut = mesh.userData.nearCut as
    | { eye: { value: THREE.Vector3 }; enabled: { value: number } }
    | undefined;
  if (!nearCut) return;
  nearCut.eye.value.set(eye.x, eye.y, eye.z);
  nearCut.enabled.value = buried ? 1 : 0;
}

/**
 * Does the near cut drop this point? The shader's test, as a function.
 *
 * Kept beside the GLSL so the one number that decides what a buried eye can see
 * is testable without a GPU.
 */
export function nearCutHides(
  eye: { x: number; y: number; z: number },
  point: { x: number; y: number; z: number },
  radius = APERTURE_SOIL_NEAR_CUT_M,
): boolean {
  return Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z) < radius;
}

/**
 * Scale the body's sky fill with the scene's light level (0.2..1).
 *
 * The pit's wall has had this fill since R23; a body of earth beside it without
 * it went black in the same frame, which read as a hole in the pit's wall.
 */
export function setApertureSoilLight(mesh: THREE.Mesh, level: number): void {
  const material = mesh.material as THREE.MeshStandardMaterial;
  const fill = mesh.userData.fillColour as THREE.Color | undefined;
  const strength = Number(mesh.userData.fillStrength ?? 0.16);
  if (!fill || !material.emissive) return;
  material.emissive.copy(fill).multiplyScalar(strength * Math.min(1, Math.max(0, level)));
}
