/**
 * The title plate's drawing rules, ported to the mesh path.
 *
 * `ui/title/roots.ts` draws its roots from three numbers per organ - a width, a
 * tip and a taper exponent - plus two paint rules: a bark-to-pale-root ramp down
 * the soil, and an ink line under every root. None of that is an image, and none
 * of it is specific to 2D. This module is the 3D half:
 *
 * 1. **Per-organ taper.** `halfWidth(t) = w(1-t)^taper + tip*t` in the plate; the
 *    same exponent against a tube's start/end radii. A trunk necking under its
 *    parent and a lateral holding its body to two thirds of its length are
 *    different exponents, so the exponent is a function of the organ, not a
 *    global tunable.
 * 2. **Bark to root across the soil line.** The plate paints one shape with a
 *    gradient: darkest bark at the line, bark within a fifth of the plate, pale
 *    root below. A lit 3D organ cannot take a paint gradient, so the same ramp is
 *    evaluated in the shader from the vertex's world height and the ground under
 *    the part, as a multiplier on the material colour - which keeps whatever the
 *    mutation coloured that organ with.
 * 3. **Ink.** The plate's ink is the same outline thickened by 1.2 units and
 *    painted underneath. The 3D equivalent is an inverted hull: the same geometry
 *    with back faces only, pushed out along its normals by a constant world
 *    distance, so every organ carries a line of the same width whatever its size.
 *    Every woody organ takes it, not only the roots: the plate outlines the shoot
 *    as well, and above the soil a lit cylinder against a lit background has no
 *    edge of its own once the bark and the soil are the same value at noon.
 *
 * Everything here is uniforms and maths: no texture, no image, no atlas.
 */
import * as THREE from 'three';

/** Taper exponents, taken from the root plate's own table. */
const ORGAN_TAPER: Record<string, number> = {
  // The plate: the taproot is 1.0 (a trunk needs a hard neck), laterals 0.95 (a
  // root that thins to a hair for its last third has no visible body), feeders
  // 0.9. Above 1 a segment necks down just under its parent.
  taproot: 1.0,
  root: 1.0,
  radicle: 1.0,
  lateral_root: 0.95,
  rhizome: 0.95,
  tuber: 0.95,
  pneumatophore: 1.0,
  root_hair: 0.9,
  // Shoots keep the necked profile: a branch that is the same width where it
  // leaves the trunk as it is at its tip is a pipe.
  stem: 1.15,
  branch: 1.15,
  trunk: 1.15,
  culm: 1.05,
  vine: 1.05,
  stolon: 1.0,
  thorn: 1.15,
  // Foliage and bodies are drawn as their own primitives.
  leaf: 1,
  cotyledon: 1,
  flower: 1,
  flower_centre: 1,
  spore_sac: 1,
  seed: 1,
};

/** The taper exponent this organ is drawn with. */
export function organTaperExponent(nodeType: string, fallback: number): number {
  return ORGAN_TAPER[nodeType.toLowerCase()] ?? fallback;
}

const ROOT_TYPES = new Set([
  'root',
  'radicle',
  'lateral_root',
  'rhizome',
  'tuber',
  'pneumatophore',
  'root_hair',
]);
const WOODY_TYPES = new Set([
  'stem',
  'branch',
  'trunk',
  'culm',
  'vine',
  'stolon',
  'taproot',
  'root',
  'radicle',
  'lateral_root',
  'rhizome',
  'tuber',
  'pneumatophore',
  'root_hair',
  'seed',
]);

/** True for the organs the soil ramp applies to. */
export function usesSoilRamp(nodeType: string): boolean {
  return WOODY_TYPES.has(nodeType.toLowerCase());
}

/**
 * True when an organ is inked in its own pigment rather than the plate's root
 * brown.
 *
 * The plate draws its roots in one warm ink against pale flesh, and a shoot in the
 * colour of its own bark: a green stem outlined in root brown reads as a root that
 * grew upwards. Roots and the seed keep the plate's line; everything above ground
 * takes its own.
 */
export function usesOwnInkColour(nodeType: string): boolean {
  const type = nodeType.toLowerCase();
  return !ROOT_TYPES.has(type) && type !== 'seed';
}

/** Default depth the bark fades into pale root over, in metres. */
export const ROOT_RAMP_DEPTH_M = 0.32;

export interface SoilRampUniforms {
  soilY: { value: number };
  rootTint: { value: THREE.Color };
  barkTint: { value: THREE.Color };
  depth: { value: number };
}

/**
 * Give a material the plate's bark-to-root ramp.
 *
 * The ramp is a multiplier, not a replacement: `diffuseColor *= mix(white,
 * rootTint, ramp)`, so a mutation that painted the roots violet keeps violet
 * roots and only their *lightness* follows the soil.
 */
export function applySoilRamp(material: THREE.MeshStandardMaterial): void {
  if (material.userData.plSoilRamp) return;
  const uniforms: SoilRampUniforms = {
    soilY: { value: 0 },
    // Pale root: the plate's --pl-root, as a lightening factor rather than a
    // colour, so the organ's own pigment survives.
    rootTint: { value: new THREE.Color(1.55, 1.44, 1.22) },
    // Bark at the line: the plate's #432c15 against #6a4a2b is roughly a 0.7
    // multiplier per channel.
    barkTint: { value: new THREE.Color(0.74, 0.68, 0.6) },
    depth: { value: ROOT_RAMP_DEPTH_M },
  };
  material.userData.plSoilRamp = uniforms;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.plSoilY = uniforms.soilY;
    shader.uniforms.plRootTint = uniforms.rootTint;
    shader.uniforms.plBarkTint = uniforms.barkTint;
    shader.uniforms.plRampDepth = uniforms.depth;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float plSoilY;',
          'uniform float plRampDepth;',
          'varying float plSoilRamp;',
          'varying float plUnder;',
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '{',
          '  float plWorldY = (modelMatrix * vec4(transformed, 1.0)).y;',
          '  float plDepth = plSoilY - plWorldY;',
          '  float plBelow = clamp(plDepth / max(plRampDepth, 1e-4), 0.0, 1.0);',
          '  plSoilRamp = smoothstep(0.22, 1.0, plBelow);',
          '  plUnder = step(0.0, plDepth);',
          '}',
        ].join('\n'),
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform vec3 plRootTint;',
          'uniform vec3 plBarkTint;',
          'varying float plSoilRamp;',
          'varying float plUnder;',
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          // Pale root below the line, dark bark right at it, nothing above it.
          'diffuseColor.rgb *= mix(vec3(1.0), plRootTint, plSoilRamp);',
          'float plBark = plUnder * (1.0 - smoothstep(0.0, 0.42, plSoilRamp));',
          'diffuseColor.rgb *= mix(vec3(1.0), plBarkTint, plBark);',
        ].join('\n'),
      );
  };
  // A patched program is a different program: without this three reuses the
  // unpatched shader cached for the same defines.
  material.customProgramCacheKey = () => 'pl-soil-ramp-1';
}

/**
 * Point a part's ramp at the ground under it. Materials are shared between
 * segments, so this is called per draw (see `onBeforeRender` in the renderer)
 * rather than once at build time.
 */
export function setSoilLine(material: THREE.Material, soilY: number): void {
  const uniforms = material.userData.plSoilRamp as SoilRampUniforms | undefined;
  if (uniforms && Number.isFinite(soilY)) uniforms.soilY.value = soilY;
}

/** The ink hull's own material: back faces only, dark, pushed out along the normals. */
export function createInkMaterial(
  maxDistanceM: number,
  colour: THREE.ColorRepresentation = INK_COLOUR,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    // Ink, not black. The plate's line is a dark warm brown (#2e2014 against a
    // #f3e3c8 root), and it is painted *under* the body, so it never reads as an
    // absence of light. A near-black hull against sunlit soil was a hole in the
    // picture; this is a value below the bark, and the hull is lit like the organ
    // it wraps, so its shaded side still goes darker than its lit one.
    color: colour,
    roughness: 1,
    metalness: 0,
    side: THREE.BackSide,
  });
  const width = { value: maxDistanceM };
  material.userData.plInkWidth = width;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.plInkWidth = width;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float plInkWidth;')
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          // Constant world thickness, which is what makes it read as a drawn line
          // rather than a scaled copy: a thin root and a thick one get the same ink.
          'transformed += objectNormal * plInkWidth;',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'pl-ink-hull-1';
  return material;
}

/**
 * How wide the ink line is drawn, in metres (the plate's 1.2 units).
 *
 * Five millimetres. The first pass used sixteen, which swallowed a lateral root
 * (its radius is about fifteen millimetres) and made the whole system read as a
 * black thicket. The plate's line is a hairline at every scale, so this is sized
 * to the thinnest organ that carries it, not to the thickest.
 */
export const INK_WIDTH_M = 0.005;

/** The ink colour itself, shared by the hull and the blade pad. */
export const INK_COLOUR = 0x3b2c1e;

/**
 * The ink band around a blade, as a fraction of the blade's own size.
 *
 * A blade is a surface, not a tube, so the hull trick cannot outline it: pushing
 * a flat sheet along its normals gives two parallel sheets, both underneath the
 * leaf. A leaf's ink is a band built outward from the blade's own silhouette
 * instead, at the same depth, so it reads as the same 5 mm line the roots carry.
 */
export const BLADE_INK_FRACTION = 0.06;

export interface LeafTranslucencyUniforms {
  /** World-space direction towards the light (the sun by day, the moon at night). */
  dir: { value: THREE.Vector3 };
  colour: { value: THREE.Color };
  /** 0..1: how much light the blade lets through. */
  strength: { value: number };
}

/**
 * Light through a leaf, the way a torch shines through paper.
 *
 * A standard material lights a surface by the angle between its normal and the
 * light, so a leaf with the moon behind it is simply unlit: the face the camera
 * sees points away from its only light. Paper does not behave that way. Thin
 * material is brightest when the eye, the sheet and the light are in a line, and
 * that is the whole model here: the transmission is the alignment of the view ray
 * with the light ray through the surface, strongest when the camera looks towards
 * the light and the lit side of the blade is the one facing away.
 *
 * Added to the emissive term rather than replacing anything, so a blade is still
 * shaded normally; the glow is what sits on top of that where the light is
 * actually behind it. The colour is the light's own, so it is honey at sunset and
 * cold silver under the moon without a second set of numbers.
 */
export function applyLeafTranslucency(material: THREE.MeshStandardMaterial): void {
  if (material.userData.plLeafTranslucency) return;
  const uniforms: LeafTranslucencyUniforms = {
    dir: { value: new THREE.Vector3(0, 1, 0) },
    colour: { value: new THREE.Color(0xdfe9ff) },
    strength: { value: 0 },
  };
  material.userData.plLeafTranslucency = uniforms;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.plLightDir = uniforms.dir;
    shader.uniforms.plLightColour = uniforms.colour;
    shader.uniforms.plThrough = uniforms.strength;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        ['#include <common>', 'varying vec3 plWorldNormal;', 'varying vec3 plWorldPosition;'].join(
          '\n',
        ),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'plWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
          'plWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        ].join('\n'),
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform vec3 plLightDir;',
          'uniform vec3 plLightColour;',
          'uniform float plThrough;',
          'varying vec3 plWorldNormal;',
          'varying vec3 plWorldPosition;',
        ].join('\n'),
      )
      .replace(
        '#include <lights_fragment_end>',
        [
          '#include <lights_fragment_end>',
          '{',
          '  vec3 plView = normalize(cameraPosition - plWorldPosition);',
          // How much of the view ray is the light ray: full when the eye looks
          // straight at the disc through the blade, none when it looks across it.
          '  float plAim = clamp(dot(-plView, plLightDir), 0.0, 1.0);',
          // And the light has to be on the far side of this face, or the blade is
          // simply lit from the front and already has its light.
          '  float plAway = clamp(-dot(normalize(plWorldNormal), plLightDir), 0.0, 1.0);',
          '  float plSheet = pow(plAim, 2.5) * (0.2 + 0.8 * plAway);',
          '  totalEmissiveRadiance += plLightColour * plThrough * plSheet;',
          '}',
        ].join('\n'),
      );
  };
  // A patched program is a different program (three reuses the cached shader for
  // the same defines otherwise).
  material.customProgramCacheKey = () => 'pl-leaf-through-1';
}

/** Point a blade's transmission at the light, and set how much gets through. */
export function setLeafBacklight(
  material: THREE.Material,
  dir: THREE.Vector3,
  colour: THREE.Color,
  strength: number,
): void {
  const uniforms = material.userData.plLeafTranslucency as LeafTranslucencyUniforms | undefined;
  if (!uniforms) return;
  uniforms.dir.value.copy(dir);
  uniforms.colour.value.copy(colour);
  uniforms.strength.value = Math.max(0, Math.min(0.75, strength));
}

/**
 * The ink colour for one organ, from that organ's own colour.
 *
 * The plate's ink is never a black line: it is the organ's own pigment taken down
 * to its deepest value, so a green leaf is outlined in a dark green and a brown
 * root in umber. A single warm brown across every organ made foliage look stamped
 * on, and true black read as a hole in the picture.
 */
export function inkColourFor(base: THREE.Color, target = new THREE.Color()): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  // Same hue, a little more saturated, and dark enough to be a line without being
  // an absence of light. The floor keeps the hue visible at night.
  // Deep enough to read as a line against the organ's own lit body: a leaf at a
  // third lightness takes a line at a twelfth of it, which is a dark green rather
  // than a black, and stays under the bark's value at any hour.
  return target.setHSL(
    hsl.h,
    Math.min(1, hsl.s * 1.32 + 0.1),
    Math.max(0.05, Math.min(0.13, hsl.l * 0.26)),
  );
}

/**
 * The band drawn under a leaf or cotyledon.
 *
 * Lit, like the hulls, and attached to the same atmosphere by the renderer: the
 * band is a line, but it is inside the picture, so at dusk it takes the hour's
 * light instead of staying a fixed brown. It has no thickness - it lies in the
 * blade's own plane and only reaches outward - so it reads as a drawn outline
 * rather than as a rim of solid geometry.
 */
export function createBladeInkMaterial(
  colour: THREE.ColorRepresentation,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    // Coplanar with the blade it sits under: pushed away from the camera in the
    // depth buffer, so the leaf itself always wins the shared pixels and only the
    // rim the scale adds shows.
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
    transparent: false,
    depthWrite: true,
  });
}

export function setInkWidth(material: THREE.Material, metres: number): void {
  const width = material.userData.plInkWidth as { value: number } | undefined;
  if (width && Number.isFinite(metres)) width.value = metres;
}
