/**
 * The bowl mesh and its shader.
 *
 * This module owns three things and nothing else: the ring geometry built from
 * the profile, the vertex colours that carry the strata, and the GLSL that keeps
 * the shell inside the opening's silhouette. *Where* the bowl goes and how deep
 * it is are in `placement.ts`; what the eye may see is in `clip.ts`.
 */
import * as THREE from 'three';
import { CAVITY_CUT_OVERREACH, CAVITY_STRATA_BANDS, CAVITY_STRATA_SUBDIVISION } from './profile.ts';
import { buildStrataShell } from './strataShell.ts';

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

/**
 * Build the bowl. Unit radius, opening upward: the eye is always inside the pit
 * looking at its wall.
 */
export function createCavityBowl(
  topsoil: THREE.Color,
  subsoil: THREE.Color,
  widthSegments = 96,
  _heightSegments = 24,
  /** The cold earth under the subsoil; defaults to the subsoil, darkened. */
  deepSoil?: THREE.Color,
): THREE.Mesh {
  // Built as a stack of bands, not one lathe. A single smooth funnel with a
  // colour gradient is exactly what the pit looked like: a bowl with dirt
  // painted on it. `strataShell` gives each layer its own colour, a hard edge at
  // every boundary, and radial clod relief so the wall has real silhouette and
  // normals for the lit material below.
  const deep = deepSoil ?? subsoil.clone().multiplyScalar(0.78);
  const shell = buildStrataShell({
    bands: CAVITY_STRATA_BANDS,
    // The lip ring is built out to the width the soil is cut at, not to the
    // mouth, so the lip and the cut share one boundary.
    colors: [
      [topsoil.r, topsoil.g, topsoil.b],
      [subsoil.r, subsoil.g, subsoil.b],
      [deep.r, deep.g, deep.b],
    ],
    cols: widthSegments,
    subdivision: CAVITY_STRATA_SUBDIVISION,
  });
  // Stretch only the lip ring to the cut width; the relief below it is already
  // in the shell's own numbers.
  for (let c = 0; c < shell.cols; c += 1) {
    const i = c * 3;
    shell.positions[i] *= CAVITY_CUT_OVERREACH;
    shell.positions[i + 2] *= CAVITY_CUT_OVERREACH;
  }
  const geometry = new THREE.BufferGeometry();
  // The column count is a property of the shell, not something to re-derive from
  // the vertex count: a consumer dividing by the profile's ring count got 320
  // columns instead of 96 once the wall had strata courses, and built its index
  // buffer out of vertices that were not its own.
  geometry.userData.cols = shell.cols;
  geometry.setIndex(new THREE.BufferAttribute(shell.indices, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(shell.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(shell.colors, 3));
  geometry.computeVertexNormals();

  // Lit, not painted. The old unlit material was the reason the wall had no
  // shading of its own: every shape cue had to be faked in the fragment shader,
  // and a funnel with fake shading is still a funnel. Real normals on real
  // relief catch the scene's light, which is what makes dug earth read as a
  // surface you could put a spade in.
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
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
// The shell may not stand above the mouth plane (plus this much slack for the
// rim's own conform) outside this fraction of the mouth's radius. Named because
// both numbers are decisions, not tolerances: they are what stops the bowl's back
// being drawn in the open beside the hole.
const float BOWL_SHELL_ABOVE_MOUTH_M = 0.02;
const float BOWL_MOUTH_KEEP_FRACTION = 0.98;
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
  float bowlNearShade = 1.0 - 0.1 * smoothstep(-0.6, 1.0, bowlNear);
  float bowlSeams = smoothstep(
    0.90,
    1.0,
    1.0 - abs(bowlNoise(vec2(bowlArc * 4.0, vBowlWorldPosition.y * 5.5) + 3.1) * 2.0 - 1.0)
  );
  // These are occlusion terms, not lighting: real normals on the clod relief now
  // catch the scene's light, so the wall no longer needs a normal dot-product
  // faked in the fragment shader. What is left is what light does not know about
  // a hole - the lip's shadow, the near wall between the eye and the cavity, and
  // the way grain and clods break up a flat fill. Every factor stays near 1.0 so
  // the strata colours survive them.
  diffuseColor.rgb *=
    (0.88 + 0.24 * bowlGrain) *
    (0.9 + 0.2 * bowlClods) *
    (1.0 - 0.12 * bowlSeams) *
    // 0.28 of depth darkening crushed the deepest band into the subsoil and
    // left the pit a single brown mass. Depth still reads, the strata survive it.
    (1.0 - 0.14 * bowlDepth) *
    (0.92 + 0.08 * bowlRimShadow) *
    bowlNearShade *
    // Daylight, but never to zero: a lit wall at night is lit by the sky it is
    // dug into, and going black would hide the strata the pit exists to show.
    mix(0.5, 1.0, uBowlLight);`,
      )
      .replace(
        '#include <colorspace_fragment>',
        `  // Sky from the mouth. A dug wall is lit by the open sky above it, not only by
  // the sun: with no sky term the inside of the pit was one dark brown mass at
  // every hour and at every angle the sun did not face, and the strata it is
  // built from vanished in the shade. The floor is a fraction of the wall's own
  // albedo, so the bands keep their hard edges and their relative values while
  // the wall stays readable after dark.
  //
  // **Before** the colour-space conversion, not after it. Injected after the
  // colorspace include this max compared a linear albedo against encoded
  // pixels, where the encoded value is always the larger number: the fill was
  // computed, did nothing, and the pit stayed black at night while the code
  // looked correct.
  //
  // The night floor is 0.38 of the albedo, not 0.14: at the lower figures the
  // deep band and the humus over it both rounded to near-black after midnight
  // and the pit became one dark disc - the strata the cut exists to show were
  // there and could not be seen. A dug wall is lit by the sky above the mouth,
  // and the sky does not go out.
  gl_FragColor.rgb = max(
    gl_FragColor.rgb,
    diffuseColor.rgb * mix(0.38, 0.52, clamp(uBowlLight, 0.0, 1.0))
  );
#include <colorspace_fragment>
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
    // Both faces, not just the exterior. The shell is a single funnel surface,
    // and from an eye off to one side the *inside* of the near wall is in front
    // of the far wall: dropping only front faces left it painting over the hole,
    // so the pit looked larger the further the camera orbited. The whole shell
    // is built inside the cut radius (the mouth is exactly the aperture), so a
    // strict plan-view cylinder here removes nothing the pit needs.
    //
    // The sightline-through-the-surface-plane rule was tried here and is wrong:
    // on a slope the mouth's plane is not the ground, so rays that legitimately
    // pass over the lowered lip were dropped and the pit's floor showed sky
    // through it. The ground's own depth test already hides the wall behind
    // intact soil.
    if (distance(vBowlWorldPosition.xz, uBowlApertureCenter) > uBowlApertureRadius) discard;
  }
  // Whatever the eye is doing, no part of the shell may stand above the mouth
  // plane outside the mouth. That is the bowl's own back, standing in the open
  // beside the hole: seen from an eye at the rim it is the dark band across the
  // far lip, and from a low angle it is wedges of shell lying on the soil. An eye
  // at the rim is classified as inside the cavity, so the modes above never
  // tested it.
  if (
    vBowlWorldPosition.y > uBowlSurfaceY + BOWL_SHELL_ABOVE_MOUTH_M &&
    distance(vBowlWorldPosition.xz, uBowlApertureCenter) >
      uBowlApertureRadius * BOWL_MOUTH_KEEP_FRACTION
  ) {
    discard;
  }`,
      );
  };
  material.customProgramCacheKey = () => 'root-sight-bowl-dirt-v10';

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
  const uniform = (bowl.material as THREE.Material).userData.lightUniform as
    | { value: number }
    | undefined;
  if (uniform) uniform.value = Math.max(0, level);
}
