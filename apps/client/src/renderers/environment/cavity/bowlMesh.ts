/**
 * The bowl mesh and its shader.
 *
 * This module owns three things and nothing else: the ring geometry built from
 * the profile, the vertex colours that carry the strata, and the GLSL that keeps
 * the shell inside the opening's silhouette. *Where* the bowl goes and how deep
 * it is are in `placement.ts`; what the eye may see is in `clip.ts`.
 */
import * as THREE from 'three';
import { CAVITY_PROFILE, CAVITY_PROFILE_DEPTH } from './profile.ts';

/** The clip uniforms, written per frame by `updateCavityBowl`. */
export interface CavityClipUniforms {
  uBowlEye: { value: THREE.Vector3 };
  uBowlCenter: { value: THREE.Vector3 };
  uBowlApertureCenter: { value: THREE.Vector2 };
  uBowlApertureRadius: { value: number };
  uBowlSurfaceY: { value: number };
  /** 0 none, 1 mouth column, 2 buried (sightline + near half). See `clip.ts`. */
  uBowlClipMode: { value: number };
}

function hash(angle: number, ring: number): number {
  const s = Math.sin(angle * 12.9898 + ring * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Build the bowl. Unit radius, opening upward: the eye is always inside the pit
 * looking at its wall.
 */
export function createCavityBowl(
  topsoil: THREE.Color,
  subsoil: THREE.Color,
  widthSegments = 96,
  _heightSegments = 24,
): THREE.Mesh {
  // Built from a ring profile rather than a sphere. A sphere's rim is a slope,
  // so pulling one vertex down to the terrain also pulled it inwards: the lower
  // lip could not follow a hillside and looked hard-capped. These rings are a
  // vertical wall under a rim that is the topmost ring.
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  const rings = CAVITY_PROFILE.length;
  // 48 segments left the rim 4 mm inside the cut at the chord midpoints, which
  // is a one-pixel line of sky/water around the mouth. 96 halves that, and the
  // rim ring is *circumscribed* on top of it: its vertices sit a hair outside the
  // cut circle (1/cos(pi/n) wider, 0.05% at 96) so every chord stays outside the
  // hole instead of dipping inside it. The overshoot is under the soil - the rim
  // is buried by CAVITY_RIM_SINK_M - so nothing of it shows.
  const cols = Math.max(8, widthSegments);
  const rimOvershoot = 1 / Math.cos(Math.PI / cols);
  for (let ring = 0; ring < rings; ring += 1) {
    const { y, r } = CAVITY_PROFILE[ring];
    const ringRadius = ring === 0 ? r * rimOvershoot : r;
    for (let c = 0; c < cols; c += 1) {
      const angle = (c / cols) * Math.PI * 2;
      positions.push(Math.cos(angle) * ringRadius, y, Math.sin(angle) * ringRadius);
      // 0 at the rim, 1 at the deepest point of the bowl.
      const depth = THREE.MathUtils.clamp(-y / CAVITY_PROFILE_DEPTH, 0, 1);
      const grit = hash(angle, ring);
      color.copy(topsoil).lerp(subsoil, depth);
      // Dug earth, not a void. The vertex layer carries the strata and only a
      // gentle depth falloff: the shader below adds grain and a near-wall shadow
      // on top, and stacking two dark multipliers here was what turned the pit
      // almost black in the first place.
      const shade = (1.0 - 0.1 * depth) * (0.96 + 0.08 * grit);
      colors.push(color.r * shade, color.g * shade, color.b * shade);
    }
  }
  for (let ring = 0; ring < rings - 1; ring += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = ring * cols + c;
      const b = ring * cols + ((c + 1) % cols);
      const next = a + cols;
      const nextNext = b + cols;
      // Wound so the inner surface is the front face of a BackSide material.
      indices.push(a, next, b, b, next, nextNext);
    }
  }
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  // Unlit: the bowl is a pit, not a surface that catches the sky. Lighting the
  // inside made the same geometry a flat disc at one time of day and a black
  // hole at another; the vertex colours already carry the strata and depth.
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    // Both skins, then the one between the eye and the cavity is cut away in the
    // shader. A single-sided shell was culled from exactly the angle that needed
    // it.
    side: THREE.DoubleSide,
    // The mouth shares an edge with the shader-cut soil. Without a depth bias
    // the two surfaces alternate in front of each other along that edge.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -6,
  });
  const clipUniforms: CavityClipUniforms = {
    uBowlEye: { value: new THREE.Vector3() },
    uBowlCenter: { value: new THREE.Vector3() },
    uBowlApertureCenter: { value: new THREE.Vector2() },
    uBowlApertureRadius: { value: 1 },
    uBowlSurfaceY: { value: 0 },
    uBowlClipMode: { value: 0 },
  };
  material.userData.clipUniforms = clipUniforms;
  // How much of the scene's light reaches the dug wall. The shell is unlit so
  // that the pit reads as dirt at any hour, but an unlit surface that never
  // dims becomes the brightest thing on screen at night. The renderer writes
  // this from the sun, ambient and sky fill each frame.
  const lightUniform = { value: 1 };
  material.userData.lightUniform = lightUniform;

  // Vertex colours alone made the cavity a flat brown funnel. Modulate them
  // with the same kind of world-space grain the surface uses, plus a depth
  // gradient, so the cut wall reads as undisturbed dirt rather than a painted
  // backing shell.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBowlEye = clipUniforms.uBowlEye;
    shader.uniforms.uBowlCenter = clipUniforms.uBowlCenter;
    shader.uniforms.uBowlApertureCenter = clipUniforms.uBowlApertureCenter;
    shader.uniforms.uBowlApertureRadius = clipUniforms.uBowlApertureRadius;
    shader.uniforms.uBowlSurfaceY = clipUniforms.uBowlSurfaceY;
    shader.uniforms.uBowlClipMode = clipUniforms.uBowlClipMode;
    shader.uniforms.uBowlLight = lightUniform;
    material.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vBowlWorldPosition;\nvarying vec3 vBowlLocal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvBowlLocal = position;\nvBowlWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBowlWorldPosition;
varying vec3 vBowlLocal;
uniform vec3 uBowlEye;
uniform vec3 uBowlCenter;
uniform vec2 uBowlApertureCenter;
uniform float uBowlApertureRadius;
uniform float uBowlSurfaceY;
uniform float uBowlClipMode;
uniform float uBowlLight;
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
  // Three layers of dirt: millimetre grit, hand-sized clods, and the packed
  // subsoil. They are sampled in *cylindrical* coordinates, not world xz: a
  // vertical wall has almost no xz variation along it, so the old sample
  // stretched the grain into long vertical streaks down the wall - the "stretched
  // texture". Arc length around the pit (angle x radius) and world height share
  // the same scale, so the grain stays isotropic wherever it lands.
  vec2 bowlAway = vBowlWorldPosition.xz - uBowlCenter.xz;
  float bowlRadius = max(length(bowlAway), 1e-3);
  // Unwrapped at the *mouth* radius, not the fragment's own: angle x local
  // radius spirals as the wall narrows towards the floor, and the grain came out
  // as concentric rings. A fixed chart radius is a plain cylinder unwrap, so the
  // same clod keeps its size from lip to floor.
  float bowlArc = atan(bowlAway.y, bowlAway.x) * max(uBowlApertureRadius, 0.05);
  vec2 bowlWall = vec2(bowlArc, vBowlWorldPosition.y);
  float bowlGrain = bowlNoise(bowlWall * 24.0);
  float bowlClods = bowlNoise(bowlWall * 3.4 + 7.3);
  // Depth gradient instead of the old horizontal banding. The sin(y * 22)
  // rings read as contour lines on a plate, which is what the cavity looked
  // like from above.
  float bowlDepth = clamp(-vBowlLocal.y, 0.0, 1.0);
  // Rim shade: a little darker just under the lip, where the overhang cuts the
  // sky away, lighter on the floor that still catches it.
  float bowlRimShadow = smoothstep(0.0, 0.30, bowlDepth);
  // Near-wall shadow. The side of the pit between the eye and the cavity is the
  // face the lip shades, and it is what tells the eye it is looking into a hole
  // rather than at a brown patch. Works from any direction because it compares
  // the eye's horizontal offset with the wall's.
  vec2 eyeAway = uBowlEye.xz - uBowlCenter.xz;
  float bowlNear = 0.0;
  if (length(eyeAway) > 1e-4) {
    bowlNear = dot(bowlAway / bowlRadius, normalize(eyeAway));
  }
  // Gentle, and spread over a wide arc: at 0.55 over (-0.2 .. 0.85) the term cut
  // the pit in two along a hard horizontal line, so it read as a ball with its
  // lower half painted on rather than as one cavity.
  float bowlNearShade = 1.0 - 0.2 * smoothstep(-0.6, 1.0, bowlNear);
  float bowlSeams = smoothstep(
    0.90,
    1.0,
    1.0 - abs(bowlNoise(vec2(bowlArc * 4.0, vBowlWorldPosition.y * 5.5) + 3.1) * 2.0 - 1.0)
  );
  // Real relief: the wall's own surface normal, lit from above. Without this
  // the cavity is one flat brown cone. The bowl is a bowl, so its normal is its
  // local position - no derivatives needed (dFdx/dFdy are not available in the
  // shader version three emits here, and asking for them made the program
  // invalid).
  vec3 bowlWallNormal = -normalize(vBowlLocal);
  float bowlLit = 0.82 + 0.12 * clamp(dot(bowlWallNormal, vec3(0.32, 0.9, 0.3)), 0.0, 1.0);
  // Every term is a shade around 1.0, never a second darkening pass: the wall
  // lands near 0.72 of the dug-soil colour and the floor a little darker. Dark
  // enough to read as a pit with the lip shading it, light enough that it is
  // earth rather than a hole punched in the hillside.
  diffuseColor.rgb *=
    (0.84 + 0.32 * bowlGrain) *
    (0.88 + 0.24 * bowlClods) *
    (1.0 - 0.14 * bowlSeams) *
    bowlLit *
    (1.0 - 0.35 * bowlDepth) *
    (0.9 + 0.1 * bowlRimShadow) *
    bowlNearShade *
    uBowlLight;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
  // Seen from a buried eye beside the pit, the bowl may only be visible where
  // the line of sight actually leaves through the opening. Follow the ray from
  // the eye to this fragment; where it crosses the surface plane it must land
  // inside the aperture, otherwise solid ground is in front of the fragment and
  // drawing it paints the hole with dirt.
  // One mode, three situations (see clip.ts). Buried: the shell is between the
  // eye and the cavity, so paint only where the line of sight leaves through the
  // opening and never the near half, which would hide the roots.
  if (uBowlClipMode > 1.5) {
    // abs(dy), not dy: an eye *above* the surface sees every bowl fragment below
    // it, so requiring dy > 0 skipped the test in exactly the views that spill.
    // The plane is between eye and fragment in both directions, and t is positive
    // either way.
    float dy = vBowlWorldPosition.y - uBowlEye.y;
    if (abs(dy) > 1e-4) {
      float t = (uBowlSurfaceY - uBowlEye.y) / dy;
      if (t > 0.0 && t < 1.0) {
        vec2 hit = mix(uBowlEye.xz, vBowlWorldPosition.xz, t);
        if (distance(hit, uBowlApertureCenter) > uBowlApertureRadius) discard;
      }
    }
    vec3 bowlToEye = uBowlEye - uBowlCenter;
    if (dot(vBowlWorldPosition - uBowlCenter, bowlToEye) > 0.0) discard;
  }
  // Above the ground: the shell may only show inside the mouth's vertical column,
  // and only its outside. Anything else is the bowl standing in the open beside
  // the hole - the brown dome over the far rim from any camera that is not
  // straight overhead. Only the exterior is dropped (front faces are the outside:
  // a FrontSide render showed the ribbed dome), because the pit's wall is just as
  // far outside the mouth and must stay.
  else if (uBowlClipMode > 0.5) {
    if (gl_FrontFacing && distance(vBowlWorldPosition.xz, uBowlApertureCenter) > uBowlApertureRadius) discard;
  }`,
      );
  };
  material.customProgramCacheKey = () => 'root-sight-bowl-dirt-v4';

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'root-sight-bowl';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.visible = false;
  return mesh;
}

/**
 * Scale the dug wall and floor with the scene's own light level.
 *
 * The shell is unlit on purpose - a lit pit was a flat disc at noon and a black
 * hole at midnight - but an unlit surface that never dims is the brightest thing
 * on screen at night. The renderer calls this per frame with a level derived from
 * the sun, ambient and sky fill.
 */
export function setCavityBowlLight(bowl: THREE.Mesh, level: number): void {
  const uniform = (bowl.material as THREE.MeshBasicMaterial).userData.lightUniform as
    | { value: number }
    | undefined;
  if (uniform) uniform.value = Math.max(0, level);
}
