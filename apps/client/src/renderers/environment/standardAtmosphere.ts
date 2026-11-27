/**
 * AL-04: put the shared atmosphere model on an ordinary Three material.
 *
 * The ground shader is bespoke, so it takes the model directly. The mesh plants
 * are plain `MeshStandardMaterial`s, which Three fogs with `scene.fog` - a
 * second air that disagreed with the ground and the SDF plants. This patches
 * such a material in place: the scene fog is switched off, a world-space varying
 * is added in the vertex stage, and the model is applied in linear space just
 * before the colour-space conversion.
 *
 * Height above the reference level is the world y of the fragment. That is
 * correct in the authored play area, where the ground sits at y = 0; the ground
 * itself uses radial height because it spans the whole planet.
 */
import * as THREE from 'three';
import { type AtmosphereParams, DEFAULT_ATMOSPHERE, GLSL_ATMOSPHERE } from './atmosphere.ts';

const PRELUDE = `
varying vec3 vAtmoWorld;
uniform vec3 uAtmoExtinction;
uniform float uAtmoScaleHeight;
uniform float uAtmoSunPhaseG;
uniform float uAtmoInScatter;
uniform float uAtmoHorizonBoost;
uniform vec3 uAtmoSunDir;
${GLSL_ATMOSPHERE}
`;

const APPLY = `
  {
    vec3 atmoDelta = vAtmoWorld - cameraPosition;
    float atmoDist = length(atmoDelta);
    vec3 atmoView = atmoDist > 1e-4 ? atmoDelta / atmoDist : vec3(0.0, 1.0, 0.0);
    // The eye's own height is the half that was missing. With only the
    // fragment's height, a plant, an arch or a wall standing on the play area
    // was always fogged as sea-level air - so climbing to 40 km, where the air
    // is thin, still mixed every mesh with the horizon's white in-scatter.
    gl_FragColor.rgb = atmoApplyRay(
      gl_FragColor.rgb,
      atmoView,
      normalize(uAtmoSunDir),
      atmoDist,
      max(0.0, cameraPosition.y),
      max(0.0, vAtmoWorld.y)
    );
  }
`;

function writeUniforms(uniforms: Record<string, THREE.IUniform>, params: AtmosphereParams): void {
  const extinction = uniforms.uAtmoExtinction?.value as THREE.Vector3 | undefined;
  if (!extinction) return;
  extinction.set(params.extinction[0], params.extinction[1], params.extinction[2]);
  uniforms.uAtmoScaleHeight.value = params.scaleHeightM;
  uniforms.uAtmoSunPhaseG.value = params.sunPhaseG;
  uniforms.uAtmoInScatter.value = params.inScatter;
  uniforms.uAtmoHorizonBoost.value = params.horizonBoost;
}

/**
 * Attach the atmosphere to a standard material. Idempotent: the shader patch is
 * installed once, and later calls only update the uniform values. `sunDir` is
 * kept by reference, so the caller can keep rotating one vector.
 */
export function applyAtmosphereToStandardMaterial(
  material: THREE.MeshStandardMaterial,
  params: AtmosphereParams = DEFAULT_ATMOSPHERE,
  sunDir: THREE.Vector3 = new THREE.Vector3(0, 1, 0),
): void {
  material.userData.atmosphereParams = params;

  if (material.userData.atmosphereAttached !== true) {
    material.userData.atmosphereAttached = true;
    // The renderer's own fog is a second air; the model replaces it.
    material.fog = false;
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previous?.call(material, shader, renderer);
      const uniforms = shader.uniforms as Record<string, THREE.IUniform>;
      const current =
        (material.userData.atmosphereParams as AtmosphereParams | undefined) ?? DEFAULT_ATMOSPHERE;
      uniforms.uAtmoExtinction = { value: new THREE.Vector3() };
      uniforms.uAtmoScaleHeight = { value: current.scaleHeightM };
      uniforms.uAtmoSunPhaseG = { value: current.sunPhaseG };
      uniforms.uAtmoInScatter = { value: current.inScatter };
      uniforms.uAtmoHorizonBoost = { value: current.horizonBoost };
      const storedSun = material.userData.atmosphereSunDir;
      uniforms.uAtmoSunDir = {
        value: storedSun instanceof THREE.Vector3 ? storedSun : sunDir,
      };
      writeUniforms(uniforms, current);
      material.userData.atmosphereUniforms = uniforms;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vAtmoWorld;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  #ifdef USE_INSTANCING
    vAtmoWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vAtmoWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PRELUDE}`)
        .replace('#include <colorspace_fragment>', `${APPLY}\n#include <colorspace_fragment>`);
    };
    material.needsUpdate = true;
  }

  material.userData.atmosphereSunDir = sunDir;
  // Live uniform holders exist only after a compile. A copy of a patched
  // material would arrive with flattened ones, which `cloneStandaloneMaterial`
  // strips where the copy is made, so nothing non-uniform gets here.
  const compiled = material.userData.atmosphereUniforms as
    | Record<string, THREE.IUniform>
    | undefined;
  if (compiled) {
    compiled.uAtmoSunDir = { value: sunDir };
    writeUniforms(compiled, params);
  }
}

/**
 * A variant of a patched material that is safe to patch again.
 *
 * `Material.copy` clones `userData` through `JSON.stringify`, so a copy of a
 * patched material comes back claiming `atmosphereAttached` while its uniform
 * holders are plain `{ x, y, z }` literals. The patcher trusted that flag, the
 * copy's shader never got the varying, and the tail wrote to a literal - a
 * TypeError on every rebuild of a plant carrying a pigment variant, which is
 * how a joining rival's plant threw instead of appearing. Variants are made
 * here, so the snapshot is dropped here: the copy is unpatched again and the
 * patcher installs live uniforms on it.
 */
export function cloneStandaloneMaterial(
  base: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  const material = base.clone();
  delete material.userData.atmosphereAttached;
  delete material.userData.atmosphereUniforms;
  return material;
}
