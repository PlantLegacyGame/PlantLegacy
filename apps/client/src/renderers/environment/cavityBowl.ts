/**
 * The cavity as real geometry: a dug bowl of earth under the opening.
 *
 * Root Sight used to fake the inside of the cavity in the soil shader, which
 * meant the "walls" had no parallax and every viewing angle had to be handled
 * as a special case — the dome, the flat disc, the horizon. This is the actual
 * pit: a single inverted bowl whose rim sits just under the surface opening, so
 * looking in from above, from the side or from a distance all show the same
 * dug earth with real depth.
 *
 * One geometry, reused: the mesh is built once at unit radius and scaled per
 * frame from the cavity radius, so opening and growing the cavity allocates
 * nothing. Vertex colours carry the strata (darker topsoil at the rim, paler
 * subsoil deeper down) with no textures.
 */
import * as THREE from 'three';

/** Height of the rim above the bowl's centre, as a fraction of its radius. */
export const CAVITY_BOWL_RIM_FRACTION = 0.3;

/**
 * Default radius of the bowl's mouth as a fraction of the Root Sight radius.
 * Only a fallback: callers pass `uRootSightApertureRadius`, the same value the
 * soil shader cuts, so the mouth matches the opening exactly. They used to be
 * computed separately, the shader clamping to 1.8 m while the bowl stayed at
 * `radius * 0.7` (4.9 m at the default cutaway), which buried the bowl's rim
 * under intact terrain and showed dirt in the hole at some angles.
 */
export const CAVITY_MOUTH_FRACTION = 0.7;

/** Rim tucked under the lip, as a fraction of the cavity radius. */
const RIM_BURY_FRACTION = 0.02;
/** Extra sink so the bowl rim cannot sit coplanar with the soil cut. */
export const CAVITY_RIM_SINK_M = 0.012;

interface CavityRimState {
  rimIndices?: number[];
  lastRimKey?: string;
}

/** Horizontal radius of the unit bowl's rim circle. */
const RIM_CIRCLE_RADIUS = Math.sqrt(1 - CAVITY_BOWL_RIM_FRACTION * CAVITY_BOWL_RIM_FRACTION);

const TOP_THETA = Math.acos(CAVITY_BOWL_RIM_FRACTION);

export interface CavityBowlPlacement {
  visible: boolean;
  horizontalScale: number;
  verticalScale: number;
  /** Rim height relative to the bowl's surface anchor (negative is below it). */
  rimOffsetY: number;
}

/** Where the bowl sits this frame, in world space. */
export interface CavityBowlFrame {
  x: number;
  y: number;
  z: number;
  horizontalScale: number;
  verticalScale: number;
}

/**
 * Is the eye inside the cavity, or above its rim?
 *
 * The bowl is the inside of a pit, so those are the two positions from which its
 * walls are meant to be seen as walls. A buried eye outside the pit (the normal
 * Root Sight camera, which sits in the soil beside the roots) must not see the
 * far wall through the opening: that is the dirt that filled the aperture from
 * some angles. `updateCavityBowl` handles that case by clipping fragments that
 * would be seen *through* the hole, which keeps the walls around the hole while
 * the hole itself shows sky.
 */
export function isEyeInsidePit(
  eye: { x: number; y: number; z: number },
  frame: CavityBowlFrame,
  rimFraction = CAVITY_BOWL_RIM_FRACTION,
): boolean {
  const sx = Math.max(1e-4, frame.horizontalScale);
  const sy = Math.max(1e-4, frame.verticalScale);
  const localX = (eye.x - frame.x) / sx;
  const localY = (eye.y - frame.y) / sy;
  const localZ = (eye.z - frame.z) / sx;
  if (localY > rimFraction) return true;
  return Math.sqrt(localX * localX + localY * localY + localZ * localZ) <= 1.02;
}

/**
 * Where the bowl sits for a cavity of `radius` opened to `progress`. Pure so the
 * mouth match can be tested without a GPU: the rim circle has to reach the
 * shader's cut at every size.
 *
 * `depthM` is the vertical space from the surface lip to the floor. It is passed
 * in from the live terrain because the cavity centre is the average of the root
 * bubbles and can sit well below the surface; anchoring the bowl to that centre
 * left the mouth underground and made the opening look like a flat disc.
 */
export function cavityBowlPlacement(
  radius: number,
  progress: number,
  depthM?: number,
  apertureRadius?: number,
): CavityBowlPlacement {
  const scale = radius * Math.max(progress, 0);
  const visible = scale > 0.05;
  const depth = Math.max(scale * 0.5, depthM ?? scale * 1.3);
  const verticalScale = depth / (1 + CAVITY_BOWL_RIM_FRACTION);
  // The mouth is the aperture, exactly. Both sides now read the same radius from
  // `uRootSightApertureRadius`; the fallback keeps old callers and tests on the
  // documented fraction. A wider mouth left a ring of bowl rim inside the hole.
  const openMouth = Math.max(0.05, apertureRadius ?? radius * CAVITY_MOUTH_FRACTION);
  const mouth = openMouth * Math.max(progress, 0);
  const horizontalScale = visible ? mouth / RIM_CIRCLE_RADIUS : 0;
  return {
    visible,
    horizontalScale,
    verticalScale,
    rimOffsetY: -(scale * RIM_BURY_FRACTION + verticalScale * CAVITY_BOWL_RIM_FRACTION),
  };
}

function hash(angle: number, ring: number): number {
  const s = Math.sin(angle * 12.9898 + ring * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Build the bowl. Unit radius, opening upward, inside faces only: the eye is
 * always inside the pit looking at its wall.
 */
export function createCavityBowl(
  topsoil: THREE.Color,
  subsoil: THREE.Color,
  widthSegments = 48,
  heightSegments = 24,
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(
    1,
    widthSegments,
    heightSegments,
    0,
    Math.PI * 2,
    TOP_THETA,
    Math.PI - TOP_THETA,
  );
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  const depthSpan = 1 + CAVITY_BOWL_RIM_FRACTION;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    // 0 at the rim, 1 at the deepest point of the bowl.
    const depth = THREE.MathUtils.clamp((CAVITY_BOWL_RIM_FRACTION - y) / depthSpan, 0, 1);
    const grit = hash(Math.atan2(z, x), Math.round(y * 8));
    color.copy(topsoil).lerp(subsoil, depth);
    // Bake the fall of light into the bowl. Relying on scene lighting made the
    // cavity read as a flat dark patch at night and as a bright disc in day;
    // the vertex gradient keeps the rim dirt readable and the floor dark from
    // any angle, which is what makes the opening look like a pit.
    const shade = (0.9 - 0.45 * depth) * (0.82 + 0.36 * grit);
    colors[i * 3] = color.r * shade;
    colors[i * 3 + 1] = color.g * shade;
    colors[i * 3 + 2] = color.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Unlit: the bowl is a pit, not a surface that catches the sky. Lighting the
  // inside made the same geometry a flat disc at one time of day and a black
  // hole at another; the vertex colours already carry the strata and depth.
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    // The eye looks at the inside of the bowl, so render inner faces.
    side: THREE.BackSide,
    // The mouth shares an edge with the shader-cut soil. Without a depth bias
    // the two surfaces alternate in front of each other along that edge.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  // Where the eye is, and the hole it is looking through. A buried eye beside
  // the pit must not see the far wall *across the opening*: that is the dirt
  // that filled the aperture from some angles. Fragments whose line of sight
  // from the eye passes through the aperture disc are dropped, so the hole stays
  // sky while the walls around it keep their parallax.
  const clipUniforms = {
    uBowlEye: { value: new THREE.Vector3() },
    uBowlApertureCenter: { value: new THREE.Vector2() },
    uBowlApertureRadius: { value: 1 },
    uBowlSurfaceY: { value: 0 },
    uBowlClipThroughHole: { value: 0 },
  };
  material.userData.clipUniforms = clipUniforms;

  // Vertex colours alone made the cavity a flat brown funnel. Modulate them
  // with the same kind of world-space grain the surface uses, plus a faint
  // depth banding, so the cut wall reads as undisturbed dirt rather than a
  // painted backing shell.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBowlEye = clipUniforms.uBowlEye;
    shader.uniforms.uBowlApertureCenter = clipUniforms.uBowlApertureCenter;
    shader.uniforms.uBowlApertureRadius = clipUniforms.uBowlApertureRadius;
    shader.uniforms.uBowlSurfaceY = clipUniforms.uBowlSurfaceY;
    shader.uniforms.uBowlClipThroughHole = clipUniforms.uBowlClipThroughHole;
    material.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBowlWorldPosition;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvBowlWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBowlWorldPosition;
uniform vec3 uBowlEye;
uniform vec2 uBowlApertureCenter;
uniform float uBowlApertureRadius;
uniform float uBowlSurfaceY;
uniform float uBowlClipThroughHole;
float bowlHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float bowlNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(bowlHash(i), bowlHash(i + vec2(1.0, 0.0)), f.x),
    mix(bowlHash(i + vec2(0.0, 1.0)), bowlHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float bowlGrain = bowlNoise(vBowlWorldPosition.xz * 28.0 + vBowlWorldPosition.y * 7.0);
  float bowlClods = bowlNoise(vBowlWorldPosition.xz * 3.2 + vBowlWorldPosition.y * 2.1);
  float bowlBands = 0.88 + 0.12 * sin(vBowlWorldPosition.y * 16.0 + bowlClods * 4.0);
  diffuseColor.rgb *= (0.72 + 0.42 * bowlGrain) * (0.86 + 0.22 * bowlClods) * bowlBands;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
  // Seen from a buried eye beside the pit, the bowl may only be visible where
  // the line of sight actually leaves through the opening. Follow the ray from
  // the eye to this fragment; where it crosses the surface plane it must land
  // inside the aperture, otherwise solid ground is in front of the fragment and
  // drawing it paints the hole with dirt (the "filled with dirt, or half filled
  // depending on the angle" bug). Fragments seen *through* the hole stay, so
  // the far wall still gives the pit its depth.
  if (uBowlClipThroughHole > 0.5) {
    float dy = vBowlWorldPosition.y - uBowlEye.y;
    if (dy > 1e-4) {
      float t = (uBowlSurfaceY - uBowlEye.y) / dy;
      if (t > 0.0 && t < 1.0) {
        vec2 hit = mix(uBowlEye.xz, vBowlWorldPosition.xz, t);
        if (distance(hit, uBowlApertureCenter) > uBowlApertureRadius) discard;
      }
    }
  }`,
      );
  };
  material.customProgramCacheKey = () => 'root-sight-bowl-dirt-v1';

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'root-sight-bowl';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.visible = false;
  return mesh;
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
): void {
  const surfaceY = surfaceHeight ? surfaceHeight(centre.x, centre.z) : centre.y;
  // The floor is below both the root-bubble centre and the surface. This keeps
  // deep roots inside the bowl while still catching the surface lip.
  const bottomY = Math.min(centre.y - radius * 1.3, surfaceY - radius * 2.0);
  const placement = cavityBowlPlacement(
    radius,
    progress,
    Math.max(0.1, surfaceY - bottomY),
    apertureRadius,
  );
  bowl.visible = placement.visible;
  if (!bowl.visible) return;

  bowl.scale.set(placement.horizontalScale, placement.verticalScale, placement.horizontalScale);
  bowl.position.set(centre.x, surfaceY, centre.z);
  bowl.position.y += placement.rimOffsetY;

  // The bowl is always drawn; what changes with the eye is whether its wall may
  // be seen *through the opening*. A buried eye outside the pit would otherwise
  // look at the far wall across the hole (dirt, half dirt, angle-dependent).
  // Clipping only those fragments keeps the cavity visible from underground and
  // the hole open to the sky - hiding the whole bowl, the earlier fix, removed
  // the cavity from the normal Root Sight camera instead.
  const bowlMaterial = bowl.material as THREE.MeshBasicMaterial;
  const clip = bowlMaterial.userData.clipUniforms as
    | {
        uBowlEye: { value: THREE.Vector3 };
        uBowlApertureCenter: { value: THREE.Vector2 };
        uBowlApertureRadius: { value: number };
        uBowlSurfaceY: { value: number };
        uBowlClipThroughHole: { value: number };
      }
    | undefined;
  if (eye && clip) {
    const frame: CavityBowlFrame = {
      x: bowl.position.x,
      y: bowl.position.y,
      z: bowl.position.z,
      horizontalScale: placement.horizontalScale,
      verticalScale: placement.verticalScale,
    };
    const buried = eye.y < surfaceY - 0.02;
    const inside = isEyeInsidePit(eye, frame);
    const mouthRadius = Math.max(
      0.05,
      (apertureRadius ?? radius * CAVITY_MOUTH_FRACTION) * Math.max(progress, 0),
    );
    clip.uBowlEye.value.copy(eye);
    clip.uBowlApertureCenter.value.set(centre.x, centre.z);
    clip.uBowlApertureRadius.value = mouthRadius;
    clip.uBowlSurfaceY.value = surfaceY;
    clip.uBowlClipThroughHole.value = buried && !inside ? 1 : 0;
  }

  if (!surfaceHeight) return;
  const state = bowl.userData as CavityRimState;
  const geometry = bowl.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  if (!state.rimIndices) {
    state.rimIndices = [];
    for (let i = 0; i < position.count; i += 1) {
      if (Math.abs(position.getY(i) - CAVITY_BOWL_RIM_FRACTION) < 1e-4) {
        state.rimIndices.push(i);
      }
    }
  }

  const rimKey = `${centre.x.toFixed(3)}|${centre.z.toFixed(3)}|${surfaceY.toFixed(3)}|${placement.horizontalScale.toFixed(3)}|${placement.verticalScale.toFixed(3)}`;
  if (state.lastRimKey === rimKey) return;
  state.lastRimKey = rimKey;

  for (const index of state.rimIndices) {
    const worldX = centre.x + position.getX(index) * placement.horizontalScale;
    const worldZ = centre.z + position.getZ(index) * placement.horizontalScale;
    const rimWorldY = surfaceHeight(worldX, worldZ) - CAVITY_RIM_SINK_M;
    const localY = (rimWorldY - bowl.position.y) / placement.verticalScale;
    position.setY(index, Math.max(-0.5, Math.min(1.2, localY)));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}
