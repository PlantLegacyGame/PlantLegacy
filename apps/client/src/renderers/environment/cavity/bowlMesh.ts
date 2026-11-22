/**
 * The bowl mesh and its shader.
 *
 * This module owns two things and nothing else: the ring geometry built from the
 * profile, and the GLSL that picks the strata per fragment and keeps the shell
 * inside the opening's silhouette. *Where* the bowl goes and how deep it is are
 * in `placement.ts`; what the eye may see is in `clip.ts`.
 */
import * as THREE from 'three';
import {
  CAVITY_CUT_OVERREACH,
  CAVITY_PALETTE,
  CAVITY_PROFILE_DEPTH,
  CAVITY_STRATA_BANDS,
  CAVITY_STRATA_SUBDIVISION,
} from './profile.ts';
import { buildStrataShell } from './strataShell.ts';

/**
 * Where the strata change, as a fraction of the wall's depth.
 *
 * Read from the same band table the geometry is built from, so a band edge in
 * the shader and a band edge in the ring table cannot disagree.
 */
const BAND_SUBSOIL_FROM = CAVITY_STRATA_BANDS[1]?.from ?? 0.24;
const BAND_DEEP_FROM = CAVITY_STRATA_BANDS[2]?.from ?? 0.58;

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
  /**
   * Sky-fill fractions, night and day: how much of the wall's own albedo
   * survives at each end of the light range. Config owns the numbers
   * (`root_sight.cavity_night_fill` / `cavity_day_fill`); the fallback is the
   * same palette the config file starts from.
   */
  fill: { night: number; day: number } = {
    night: CAVITY_PALETTE.nightFill,
    day: CAVITY_PALETTE.dayFill,
  },
): THREE.Mesh {
  // Built as a stack of bands, not one lathe. A single smooth funnel with a
  // colour gradient is exactly what the pit looked like: a bowl with dirt
  // painted on it. `strataShell` gives the wall courses of earth, a crease at
  // every stratum contact, and radial clod relief so the wall has real silhouette
  // and normals for the lit material below.
  const deep = deepSoil ?? subsoil.clone().multiplyScalar(0.78);
  // No colours: the shell is geometry, and the strata are chosen per fragment
  // below. The bands are passed so the ring table can put a crease at each
  // contact, which is the part of a stratum edge that survives any lighting.
  const shell = buildStrataShell({
    bands: CAVITY_STRATA_BANDS,
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
  geometry.computeVertexNormals();
  // The lip ring is a cut edge, not a surface: left with its own computed normals
  // it faced the sky and caught the light as an unbroken bright line round the
  // mouth - the seam the player saw as soon as the cavity grew. Borrowing the top
  // course's normals shades it as part of the wall, and the ground above it stops
  // looking like something the pit is pushed through.
  const normals = geometry.getAttribute('normal');
  for (let c = 0; c < shell.cols; c += 1) {
    const below = shell.cols + c;
    normals.setXYZ(c, normals.getX(below), normals.getY(below), normals.getZ(below));
  }
  normals.needsUpdate = true;

  // Lit, not painted. The old unlit material was the reason the wall had no
  // shading of its own: every shape cue had to be faked in the fragment shader,
  // and a funnel with fake shading is still a funnel. Real normals on real
  // relief catch the scene's light, which is what makes dug earth read as a
  // surface you could put a spade in.
  const material = new THREE.MeshStandardMaterial({
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
  // The floor under the wall's lit value, at each end of the light range. Clamped
  // and ordered here rather than in the shader: a night fill above the day fill
  // would make the pit brighter at midnight than at noon, and glsl mix does not
  // care - it would just do it.
  const clampFill = (value: number): number =>
    Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  // The wall's three colours, bound straight from the config's `THREE.Color`s.
  // Per-fragment strata need the colours as uniforms, not as baked vertex
  // colours: a vertex colour can only change at a polygon edge.
  const stratumUniforms = {
    topsoil: { value: topsoil },
    subsoil: { value: subsoil },
    deep: { value: deep },
  };
  material.userData.stratumUniforms = stratumUniforms;
  const nightFill = clampFill(fill.night);
  const fillUniforms = {
    night: { value: nightFill },
    day: { value: Math.max(nightFill, clampFill(fill.day)) },
  };
  material.userData.fillUniforms = fillUniforms;

  // The wall is lit geometry, so the shader adds only what light cannot know
  // about a hole: the strata's own colours (from config), the contact hairline
  // where two beds meet, the grain and clods that break up a flat fill, and the
  // lip's shadow. It paints the albedo outright rather than tinting a baked
  // vertex colour, so a stratum edge is a straight line at a depth, not a line
  // that follows the wall's relief.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBowlEye = clipUniforms.uBowlEye;
    shader.uniforms.uBowlCenter = clipUniforms.uBowlCenter;
    shader.uniforms.uBowlApertureCenter = clipUniforms.uBowlApertureCenter;
    shader.uniforms.uBowlApertureRadius = clipUniforms.uBowlApertureRadius;
    shader.uniforms.uBowlSurfaceY = clipUniforms.uBowlSurfaceY;
    shader.uniforms.uBowlClipMode = clipUniforms.uBowlClipMode;
    shader.uniforms.uBowlLight = lightUniform;
    shader.uniforms.uBowlFillNight = fillUniforms.night;
    shader.uniforms.uBowlFillDay = fillUniforms.day;
    shader.uniforms.uBowlTopsoilColor = stratumUniforms.topsoil;
    shader.uniforms.uBowlSubsoilColor = stratumUniforms.subsoil;
    shader.uniforms.uBowlDeepColor = stratumUniforms.deep;
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
// 1.03, not 0.98. The lip ring is built out to the *cut* width
// (CAVITY_CUT_OVERREACH = 1.02), so keeping only 98% of the mouth discarded the
// lip's outer two per cent - the sliver that reaches the soil's edge - and what
// showed through that annulus was the sky, as a pale dotted seam all the way
// round the pit. Keeping a little past the overreach stops clipping the one part
// of the wall that has to meet the soil.
//
// Measured on the live bowl (2026-11-17): the shell's widest vertex is at the
// cut radius itself, max radius / uBowlApertureRadius = 1.00000, so at 1.03 this
// cap never fires. It is a safety net, not the thing that holds the wall in the
// mouth - the geometry does that, and so does the column clip at the aperture.
// That is the answer to "does 1.03 let shell show beside the hole": nothing of
// the shell reaches past the cut, so there is nothing for it to keep. It must
// stay above CAVITY_CUT_OVERREACH all the same: below it, this rule eats the lip
// and the sky comes through the mouth's edge.
const float BOWL_MOUTH_KEEP_FRACTION = 1.03;
uniform float uBowlSurfaceY;
uniform float uBowlClipMode;
uniform float uBowlLight;
uniform float uBowlFillNight;
uniform float uBowlFillDay;
uniform vec3 uBowlTopsoilColor;
uniform vec3 uBowlSubsoilColor;
uniform vec3 uBowlDeepColor;
// Stratum edges, as a fraction of the wall's depth from the lip to the floor.
const float BOWL_BAND_SUBSOIL = ${BAND_SUBSOIL_FROM.toFixed(4)};
const float BOWL_BAND_DEEP = ${BAND_DEEP_FROM.toFixed(4)};
const float BOWL_PROFILE_DEPTH = ${CAVITY_PROFILE_DEPTH.toFixed(4)};
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
  // Strata, chosen per fragment from the fragment's own depth. They were chosen
  // per vertex, so the edge between two layers could only change at a polygon
  // edge and therefore followed the wall's clod relief: on a displaced wall the
  // boundary read as a ragged, hand-painted line instead of a bed's contact.
  // The colours come from config, not from the vertex buffer.
  float bowlStratum = bowlDepth / BOWL_PROFILE_DEPTH;
  vec3 stratum = uBowlTopsoilColor;
  if (bowlStratum >= BOWL_BAND_DEEP) {
    stratum = uBowlDeepColor;
  } else if (bowlStratum >= BOWL_BAND_SUBSOIL) {
    stratum = uBowlSubsoilColor;
  }
  // Packed earth at a contact: a hairline darker than either layer, so the
  // boundary is a contact between two beds and not a colour change in one.
  float bowlContact = max(
    1.0 - smoothstep(0.0, 0.006, abs(bowlStratum - BOWL_BAND_SUBSOIL)),
    1.0 - smoothstep(0.0, 0.006, abs(bowlStratum - BOWL_BAND_DEEP))
  );
  diffuseColor.rgb = stratum * (1.0 - 0.28 * bowlContact);
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
  // The floor is the configured cavity_night_fill of the albedo (0.38 by
  // default), not the 0.22 the shader used to hardcode: at the lower figure the deep band and the
  // humus over it both rounded to near-black after midnight and the pit became
  // one dark disc - the strata the cut exists to show were there and could not
  // be seen. A dug wall is lit by the sky above the mouth, and the sky does not
  // go out.
  gl_FragColor.rgb = max(
    gl_FragColor.rgb,
    diffuseColor.rgb * mix(uBowlFillNight, uBowlFillDay, clamp(uBowlLight, 0.0, 1.0))
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
  material.customProgramCacheKey = () => 'root-sight-bowl-dirt-v13';

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
