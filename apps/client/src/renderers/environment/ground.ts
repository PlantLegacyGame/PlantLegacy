/**
 * C03 terrain: the ground surface and its soil shader, including the Root Sight
 * cavity that opens the soil towards the camera.
 *
 * The ground is one opaque surface — the whole planet, not a local cap over a
 * body — so there is no seam, no second ground layer and no edge to walk off.
 * Root Sight does not fade it to a translucent sheet: the soil shader shades the
 * cavity inside it, so depth writes stay on and solid terrain behaves like
 * solid terrain.
 */
import * as THREE from 'three';
import type { RenderConfig } from '../../config/clientConfig.js';
import { getTerrainParams } from '../terrain/terrainState.js';
import { createPlanetBody, createTerrainPatches } from './planetSurface.js';
import type { RootSightUniforms } from './rootSightUniforms.js';

export interface Ground {
  mesh: THREE.Mesh | null;
  material: THREE.MeshStandardMaterial;
  /** Near-field LOD patches, exposed so physics collides with the drawn ground. */
  terrainMeshes: THREE.Mesh[];
}

/** Uniform bag the soil shader exposes after it compiles. */
export interface GroundShaderUniforms {
  uniforms?: Record<string, { value: unknown }>;
}

/** Read the live shader object three.js built for the ground material. */
export function getGroundShader(
  material: THREE.MeshStandardMaterial,
): GroundShaderUniforms | undefined {
  return material.userData.shader as GroundShaderUniforms | undefined;
}

/** Push the sun's frame into the soil shader (position of the light is derived). */
export function updateGroundSun(
  material: THREE.MeshStandardMaterial,
  sunDir: THREE.Vector3,
  sunColor: THREE.Color,
  sunIntensity: number,
): void {
  const uniforms = getGroundShader(material)?.uniforms;
  if (!uniforms) return;
  (uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
  (uniforms.uSunColor.value as THREE.Color).copy(sunColor);
  uniforms.uSunIntensity.value = sunIntensity;
}

/** Push the sky fill into the soil shader so slopes read without direct sun. */
export function updateGroundFill(
  material: THREE.MeshStandardMaterial,
  skyColor: THREE.Color,
  intensity: number,
): void {
  const uniforms = getGroundShader(material)?.uniforms;
  if (!uniforms) return;
  const color = uniforms.uGroundSkyColor?.value as THREE.Color | undefined;
  if (color) color.copy(skyColor);
  if (uniforms.uGroundSkyIntensity) uniforms.uGroundSkyIntensity.value = intensity;
}

/** Set the soil moisture the shader tints with, 0 dry .. 1 saturated. */
export function setGroundMoisture(material: THREE.MeshStandardMaterial, moisture: number): void {
  const uniforms = getGroundShader(material)?.uniforms;
  if (uniforms?.uSoilMoisture) uniforms.uSoilMoisture.value = moisture;
}

const SOIL_PATCH_MARKER = 'c03-environment-ground-v2';

export function createGround(
  scene: THREE.Scene,
  config: RenderConfig,
  soilUniforms: RootSightUniforms,
  showGround = true,
): Ground {
  // The world is the planet itself: the ground is the whole sphere, so there is
  // no cap to end at, no seam against a body underneath, and the player can walk
  // anywhere on it. planet_radius_m = 0 keeps a flat plane for tests and for any
  // config that has not moved to a planet yet.
  const planetRadius = config.planetRadiusM;
  const onPlanet = planetRadius > 0;
  const geometry = onPlanet
    ? null
    : new THREE.PlaneGeometry(
        config.terrainRadius * 2,
        config.terrainRadius * 2,
        config.terrainMeshSubdivisions,
        config.terrainMeshSubdivisions,
      );

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(config.soilDryColor),
    roughness: 0.95,
    metalness: 0.02,
    // Opaque on purpose: a transparent ground moves the whole terrain into the
    // transparent pass, where it sorts after opaque geometry and fights rain,
    // the cavity wall and the backdrop. The Root Sight rim is smoothed by
    // colour instead of alpha, so the material stays opaque and depth-correct.
    transparent: false,
    depthWrite: true,
    // Root Sight puts the camera under the surface. A single-sided cap leaves
    // the hole floating against the sky; the shader already flips the normal
    // for back faces, so the ground renders from below as the surrounding soil.
    side: THREE.DoubleSide,
  });

  const soilDry = new THREE.Color(config.soilDryColor);
  const soilWet = new THREE.Color(config.soilWetColor);
  const soilMineral = new THREE.Color(config.soilMineralTint);

  material.onBeforeCompile = (shader) => {
    material.userData.shader = shader;
    // Root Sight values are shared by reference with the transition update.
    shader.uniforms.uRootSightProgress = soilUniforms.uRootSightProgress;
    shader.uniforms.uRootSightCenter = soilUniforms.uRootSightCenter;
    shader.uniforms.uRootSightApertureCenter = soilUniforms.uRootSightApertureCenter;
    shader.uniforms.uRootSightRadius = soilUniforms.uRootSightRadius;
    shader.uniforms.uRootSightApertureRadius = soilUniforms.uRootSightApertureRadius;
    shader.uniforms.uRootSightWallColor = soilUniforms.uRootSightWallColor;
    shader.uniforms.uRootSightCamera = soilUniforms.uRootSightCamera;
    shader.uniforms.uRootSightNodes = soilUniforms.uRootSightNodes;
    shader.uniforms.uRootSightNodeCount = soilUniforms.uRootSightNodeCount;
    // Set from the camera's height above the actual displaced terrain, not from
    // the bare planet sphere. Relief can put the eye below a hill while it is
    // still outside the mean sphere, which left this shader in surface mode.
    shader.uniforms.uEyeUnderGround = { value: 0.0 };
    shader.uniforms.uSoilDryColor = { value: soilDry };
    shader.uniforms.uSoilWetColor = { value: soilWet };
    shader.uniforms.uSoilMineralColor = { value: soilMineral };
    shader.uniforms.uSoilGrainStrength = { value: config.soilGrainStrength };
    shader.uniforms.uSoilMineralStrength = { value: config.soilMineralStrength };
    shader.uniforms.uSoilMoisture = { value: 0.2 };
    shader.uniforms.uSunDir = { value: new THREE.Vector3(0, 1, 0) };
    shader.uniforms.uSunColor = { value: new THREE.Color(0xffffee) };
    shader.uniforms.uSunIntensity = { value: 1.0 };
    // A sky fill keeps slopes readable when the sun is low or below the
    // horizon; without it the hills flatten into one dark sheet at night.
    shader.uniforms.uGroundSkyColor = { value: new THREE.Color(0x70879a) };
    shader.uniforms.uGroundSkyIntensity = { value: 0.4 };
    // Resource grid uniforms for per-tile ground lighting
    shader.uniforms.uResourceGrid = { value: null };
    shader.uniforms.uResourceGridSize = { value: new THREE.Vector2(1, 1) };
    shader.uniforms.uTileSize = { value: 1.0 };
    shader.uniforms.uResourceGridAvailable = { value: 0.0 };
    // Tile sampling frame: the world is a surface at this radius, so the grid
    // is read in arc-length coordinates from the pole rather than in the
    // sphere's projected x/z, which compresses near the rim.
    shader.uniforms.uPlanetCenter = {
      value: new THREE.Vector3(0, -Math.max(planetRadius, 0), 0),
    };
    shader.uniforms.uPlanetRadius = { value: planetRadius };
    shader.uniforms.uPlanetEnabled = { value: onPlanet ? 1.0 : 0.0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aSurfaceCut;\nvarying float vSurfaceCut;\nvarying vec3 vSoilWorldPos;\nvarying vec3 vSoilNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSurfaceCut = aSurfaceCut;\nvSoilWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvSoilNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSoilWorldPos;
varying vec3 vSoilNormal;
varying float vSurfaceCut;
uniform float uRootSightProgress;
uniform vec3 uRootSightCenter;
uniform vec3 uRootSightApertureCenter;
uniform float uRootSightRadius;
uniform float uRootSightApertureRadius;
uniform vec3 uRootSightWallColor;
uniform vec3 uRootSightCamera;
// T02 organic envelope: every subterranean root node, fused with a smooth
// minimum so the cut follows the branching root paths instead of one sphere.
uniform vec4 uRootSightNodes[64];
uniform int uRootSightNodeCount;
uniform float uEyeUnderGround;
uniform vec3 uSoilDryColor;
uniform vec3 uSoilWetColor;
uniform vec3 uSoilMineralColor;
uniform float uSoilMoisture;
uniform float uSoilGrainStrength;
uniform float uSoilMineralStrength;
// Sun uniforms for ground lighting
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uGroundSkyColor;
uniform float uGroundSkyIntensity;
// Resource grid for per-tile lighting
uniform sampler2D uResourceGrid;
uniform vec2 uResourceGridSize;
uniform float uTileSize;
uniform float uResourceGridAvailable;
uniform vec3 uPlanetCenter;
uniform float uPlanetRadius;
uniform float uPlanetEnabled;

// --- Procedural soil -------------------------------------------------------
// Every grain, clod and stone is generated from world position. There are no
// image textures in this material: the dirt is synthesised from noise so it
// works at any distance on a 100 km planet without tiling or stretching.
float soilHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float soilNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(soilHash21(i), soilHash21(i + vec2(1.0, 0.0)), f.x),
    mix(soilHash21(i + vec2(0.0, 1.0)), soilHash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float soilFbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += soilNoise(p) * amp;
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// Micro-relief: tilt the normal by the local noise gradient so clods catch the
// light instead of the ground reading as a flat sheet of colour.
vec3 soilBumpNormal(vec3 normal, vec2 uv, float strength) {
  float e = 0.15;
  float dx = soilNoise(uv + vec2(e, 0.0)) - soilNoise(uv - vec2(e, 0.0));
  float dz = soilNoise(uv + vec2(0.0, e)) - soilNoise(uv - vec2(0.0, e));
  return normalize(normal + vec3(dx, 0.0, dz) * strength);
}
`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
  // T02 Root Sight cutaway: the earth peels back along the subterranean root
  // system. Each underground node contributes an envelope sphere and the whole
  // set is fused with a smooth minimum, so the opening follows branching root
  // paths as one organic cavity instead of a generic flat circle or a
  // camera-facing cone.
  float cutMask = 0.0;
  float envelope = 1e6;
  // Marched interior wall of the bubble, applied after the surface lighting so
  // the dug earth inside stays readable at night instead of going pure black.
  // Is the eye buried? Decides whether this is a surface view or a view from
  // inside the earth, which need completely different shading.
  bool eyeIsUnder = uEyeUnderGround > 0.5;
  if (vSurfaceCut > 0.5 && uRootSightProgress > 0.01) {
    // Each node supplies its own bubble radius (w), so the cavity is sized by
    // the underground elements themselves rather than one global sphere.
    // The whole bubble is cut, not one camera-facing half: a half-cut bubble
    // put the opening off to one side of the plant and made the cavity slide
    // around as the camera moved. The interior is dirt anyway — the shader
    // marches its far wall — so the full sphere is what reads as a bubble.
    // A fixed fraction of the cavity radius made the fused surface bulge far
    // past the roots; keep the soft blend to a hand-sized fillet instead.
    float sminK = clamp(uRootSightRadius * 0.12, 0.06, 0.32);
    for (int i = 0; i < 64; i++) {
      if (i >= uRootSightNodeCount) break;
      vec4 node = uRootSightNodes[i];
      float nodeRadius = node.w * uRootSightProgress;
      if (nodeRadius < 0.001) continue;
      float d = distance(vSoilWorldPos, node.xyz) - nodeRadius;
      // Polynomial smooth minimum, the same fuse the plant SDF uses.
      float h = clamp(0.5 + 0.5 * (d - envelope) / sminK, 0.0, 1.0);
      envelope = mix(d, envelope, h) - sminK * h * (1.0 - h);
    }
    // Inside the fused envelope the soil is gone; outside it the rim darkens
    // into packed earth so the cavity reads as a dug cavity, not a cut-out.
    float bubbleMask = 1.0 - smoothstep(-sminK * 0.35, sminK * 0.35, envelope);

    // A root bubble can sit wholly below the surface, especially a deep root
    // system or a seed that settled into a divot. Cutting only the bubbles then
    // leaves Root Sight closed from above, so the view has to be lowered until
    // the camera itself is underground. This aperture is cut in the terrain
    // surface around the seed, in plan view: every fragment keeps its own
    // terrain height, so the visible lip follows slopes and dips instead of
    // being a horizontal disc. The cavity bowl sits underneath it.
    // One radius, owned by the client and handed to both this shader and the
    // bowl. It used to be recomputed here with a hard 1.8 m cap while the bowl
    // used the full cutaway radius: a 1.8 m hole over a 4.9 m mouth left the
    // bowl's buried rim crossing the sightline through the opening, which is
    // what painted dirt across the hole from some angles.
    float apertureRadius = max(0.05, uRootSightApertureRadius);
    // Open with the transition. The bowl is scaled by the same progress; a
    // full-size aperture over a half-size bowl leaves a void ring around the
    // opening for the first frames.
    apertureRadius *= clamp(uRootSightProgress, 0.0, 1.0);
    float apertureDist = distance(vSoilWorldPos.xz, uRootSightApertureCenter.xz);
    float apertureMask =
      1.0 - smoothstep(apertureRadius * 0.82, apertureRadius, apertureDist);
    // The aperture is the only hole in the surface. Cutting the root bubbles
    // here as well opened sky outside the bowl whenever a bubble reached past
    // the bowl mouth; the bowl is real geometry and already exposes the roots.
    cutMask = apertureMask;
  }

  // Surface coordinates: metres of arc from the planet's pole, in the azimuth
  // direction. On a flat world this is just the world x/z; on the planet it is
  // what keeps tiles square and evenly spaced all the way around the body.
  vec2 soilSurface = vSoilWorldPos.xz;
  if (uPlanetEnabled > 0.5) {
    vec3 rel = vSoilWorldPos - uPlanetCenter;
    float len = max(length(rel), 0.0001);
    float polar = acos(clamp(rel.y / len, -1.0, 1.0));
    float azimuth = atan(rel.z, rel.x);
    float arc = polar * uPlanetRadius;
    soilSurface = vec2(cos(azimuth), sin(azimuth)) * arc;
  }

  // C03: Soil moisture darkening. The old per-pixel hash read as grain sitting
  // on top of the dirt; the Root Sight dome shows the smooth colour the ground
  // should have, so the grain and mineral tint are config strengths now.
  vec3 dynamicSoil = mix(uSoilDryColor, uSoilWetColor, clamp(uSoilMoisture, 0.0, 1.0));
  float mineralNoise = fract(sin(dot(soilSurface, vec2(12.9898, 78.233))) * 43758.5453);
  dynamicSoil = mix(dynamicSoil, uSoilMineralColor, mineralNoise * uSoilGrainStrength);

  // Sample resource grid for per-tile lighting (with fallback)
  float tileLight = 1.0;
  float tileMoisture = uSoilMoisture;
  float tileMinerals = 0.0;

  if (uResourceGridAvailable > 0.5) {
    vec2 gridUV = (soilSurface / uTileSize + uResourceGridSize * 0.5) / uResourceGridSize;
    vec4 resourceData = texture2D(uResourceGrid, gridUV);
    tileLight = resourceData.r;
    tileMoisture = resourceData.g;
    tileMinerals = resourceData.b;
  }

  // Soil colour comes from the physical state (dry/wet/mineral) and then from
  // three scales of structure: metre-scale clods, several-metre damp patches,
  // and millimetre grit, plus sparse buried stones.
  dynamicSoil = mix(uSoilDryColor, uSoilWetColor, clamp(tileMoisture, 0.0, 1.0));

  // Detail is sampled in world metres, not in arc-length coordinates: the arc
  // coordinate runs to ~157 km on the 100 km planet, and float precision there
  // turned the noise into aliased mush that shaded almost black.
  vec2 soilDetail = vSoilWorldPos.xz;
  float clods = soilFbm(soilDetail * 1.6);
  float patches = soilFbm(soilDetail * 0.22 + 11.7);
  float grit = soilNoise(soilDetail * 12.0);
  dynamicSoil *= 0.78 + 0.44 * clods;
  dynamicSoil = mix(dynamicSoil, dynamicSoil * 1.22, smoothstep(0.45, 0.82, patches));
  dynamicSoil *= 0.90 + 0.20 * grit;

  // Buried grit stones: small, sparse and only slightly greyer than the matrix.
  // At low frequency they read as puddles, so they are kept fine and subtle.
  float stones = smoothstep(0.86, 0.96, soilNoise(soilDetail * 24.0 + 17.3));
  dynamicSoil = mix(dynamicSoil, uSoilMineralColor * 0.6, stones * 0.22);

  dynamicSoil = mix(
    dynamicSoil,
    uSoilMineralColor,
    mineralNoise * uSoilGrainStrength + tileMinerals * uSoilMineralStrength
  );

  // Apply lighting to ground (use existing normal from standard material)
  vec3 macroNormal = normalize(vSoilNormal);
  if (!gl_FrontFacing) macroNormal = -macroNormal;
  // Clod-scale relief, strongest on bare soil: this is what makes the surface
  // read as loose dirt rather than a coloured plane.
  vec3 groundNormal = soilBumpNormal(macroNormal, vSoilWorldPos.xz * 3.2, 0.55);
  // uSunDir points FROM the ground TOWARD the sun, so use it directly.
  float NdotL = max(dot(groundNormal, normalize(uSunDir)), 0.0);
  // Sky fill and the hill-shading curve use the macro normal, not the bump
  // normal: the bump is deliberately mostly vertical, so using it here erased
  // every slope and left the terrain looking flat no matter how it was lit.
  vec3 skyFill =
    uGroundSkyColor *
    uGroundSkyIntensity *
    (0.35 + 0.65 * clamp(macroNormal.y, 0.0, 1.0));
  // Existing relief is gentle (a metre over ten), so plain Lambert barely
  // separates a slope from the flat. A steep power curve on the up component
  // makes those small normal changes read as hills without moving geometry.
  float slopeLight = mix(0.65, 1.12, pow(clamp(macroNormal.y, 0.0, 1.0), 24.0));
  vec3 lightColor = (uSunColor * uSunIntensity * NdotL + skyFill) * slopeLight;

  // Modulate light intensity by tile light level
  lightColor *= mix(0.3, 1.0, tileLight);

  // Output in the renderer's color space. The soil/sun uniforms are linear
  // (Three.js converts colors on upload), so convert back to sRGB here instead
  // of writing linear values directly, which rendered the ground near-black.
  // Earthen rim: soil just outside the cavity fades into the exact colour of
  // the cavity wall, so the opening blends instead of ending on a hard edge.
  // Root Sight is drawn as a cavity in the same surface, not as a hole plus a
  // separate sphere. The soil inside the bubble is shaded as the dug interior —
  // darkest at the bubble centre, easing back into surface soil at the rim — so
  // the opening, the dirt behind it and the edge all come from one surface and
  // nothing can leak sky or a second ground layer.
  if (vSurfaceCut > 0.5 && uRootSightProgress > 0.01) {
    // The earthen rim belongs to the surface view. Seen from under the soil it
    // drew a bright ring around the opening, which is half of what made the cut
    // read as a lit dome instead of a hole.
    float rim = eyeIsUnder
      ? 0.0
      : 1.0 - smoothstep(0.0, max(0.4, uRootSightRadius * 0.6), envelope);
    dynamicSoil = mix(dynamicSoil, uRootSightWallColor, rim);

    // A second camera-to-root corridor used to be cut through this same surface.
    // Because the ground is a skin, that corridor exposed the sky behind it and
    // appeared as gaps between the surface and the bowl. The aperture (backed by
    // the solid bowl) is now the only opening; side views see dirt, and the sky
    // is visible only by looking up through the aperture.
    float cavityMask = cutMask;
    // The opening is a hole, and the earth inside it is real geometry (the
    // cavity bowl), so the surface has nothing left to shade here: it simply
    // stops. Faking the inside in this shader is what produced the dome, the
    // flat disc and every other angle-dependent artefact.
    if (cavityMask > 0.02) discard;
  }

  // The bubble interior keeps its own lighting; only the surface soil is
  // multiplied by the scene light.
  vec3 finalSoil = dynamicSoil * (0.35 + 0.65 * lightColor);
  // Seen from underneath, the ground is the inside of the earth: no sunlight
  // reaches it, so it must not read as a sunlit surface while underground.
  if (!gl_FrontFacing) finalSoil *= 0.45;
  // Buried, the earth has to enclose the camera. Without this the underside of
  // the thin ground shell reads as a lit plain running to a horizon, and the
  // opening above it looks like a dome standing on that plain. Fading soil to
  // black with distance leaves a dark burrow with a lit opening overhead.
  if (eyeIsUnder) {
    float depthFromEye = distance(vSoilWorldPos, uRootSightCamera);
    float enclosure = 1.0 - smoothstep(2.0, 9.0, depthFromEye);
    finalSoil *= mix(0.04, 0.6, enclosure);
  }
  gl_FragColor = linearToOutputTexel(vec4(finalSoil, 1.0));`,
      );
  };
  material.customProgramCacheKey = () => SOIL_PATCH_MARKER;

  // The cutaway is a property of the surface patch, not every mesh that uses
  // the soil material. A per-vertex flag keeps the planet and outer ring solid
  // without relying on draw order: onBeforeRender cannot safely switch a
  // uniform on a material shared by several meshes, and from below the stale
  // value left the opening covered by dirt.
  const setSurfaceCut = (target: THREE.Mesh, enabled: boolean): void => {
    const count = target.geometry.getAttribute('position')?.count ?? 0;
    const values = new Float32Array(count);
    if (enabled) values.fill(1);
    target.geometry.setAttribute('aSurfaceCut', new THREE.BufferAttribute(values, 1));
  };

  let mesh: THREE.Mesh | null = null;
  const terrainMeshes: THREE.Mesh[] = [];
  if (showGround) {
    if (onPlanet) {
      mesh = createPlanetBody(planetRadius, material);
      setSurfaceCut(mesh, false);
      // The planet's own vertices are kilometres apart, so the play area gets
      // two metre-scale patches that carry the relief: a detailed inner patch
      // and a coarser outer one out to the configured radius. A child of the
      // planet mesh shares its local space, so the surfaces line up by
      // construction. 500 m of walking sees real hills instead of the smooth
      // ball that used to begin 90 m from the seed.
      if (config.terrainAmplitudeM > 0) {
        const patches = createTerrainPatches(
          planetRadius,
          getTerrainParams(),
          material,
          config.terrainMeshSubdivisions,
        );
        mesh.add(patches.inner);
        mesh.add(patches.outer);
        setSurfaceCut(patches.inner, true);
        setSurfaceCut(patches.outer, false);
        terrainMeshes.push(patches.inner, patches.outer);
      }
    } else {
      mesh = new THREE.Mesh(geometry as THREE.BufferGeometry, material);
      setSurfaceCut(mesh, true);
    }
    // Only the fallback plane has to be laid down from its default XY
    // orientation; the planet body is already built around its own centre.
    if (!onPlanet) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0;
      terrainMeshes.push(mesh);
    }
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  return { mesh, material, terrainMeshes };
}
