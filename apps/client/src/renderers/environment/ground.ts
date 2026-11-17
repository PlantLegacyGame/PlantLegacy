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
import { type AtmosphereParams, DEFAULT_ATMOSPHERE, GLSL_ATMOSPHERE } from './atmosphere.js';
import { cavityDepthM } from './cavity/profile.ts';
import { applySoilFragmentShader, applySoilVertexShader } from './ground/shaderOverrides.ts';
import { createSoilSlab } from './planetSoilSlab.ts';
import { createPlanetBody, createTerrainPatches } from './planetSurface.js';
import type { RootSightUniforms } from './rootSightUniforms.js';

export interface Ground {
  mesh: THREE.Mesh | null;
  material: THREE.MeshStandardMaterial;
  /** Near-field LOD patches, exposed so physics collides with the drawn ground. */
  terrainMeshes: THREE.Mesh[];
}

/**
 * AL-04: ground fog is the shared atmosphere model, not `scene.fog`.
 *
 * The shader gets the model's uniforms and helpers, plus a height function:
 * this world is a sphere, so height above the surface is radial distance from
 * the planet centre, not world y.
 */
const ATMOSPHERE_FRAGMENT_PRELUDE = `
uniform vec3 uAtmoExtinction;
uniform float uAtmoScaleHeight;
uniform float uAtmoSunPhaseG;
uniform float uAtmoInScatter;
uniform float uAtmoHorizonBoost;
${GLSL_ATMOSPHERE}
float atmoHeightAboveGround(vec3 p) {
  if (uPlanetEnabled > 0.5) return max(0.0, length(p - uPlanetCenter) - uPlanetRadius);
  return max(0.0, p.y);
}
`;

/** Applied in linear space, just before the colour-space conversion. */
const ATMOSPHERE_APPLY = `
  {
    vec3 atmoDelta = vSoilWorldPos - cameraPosition;
    float atmoDist = length(atmoDelta);
    vec3 atmoView = atmoDist > 1e-4 ? atmoDelta / atmoDist : vec3(0.0, 1.0, 0.0);
    gl_FragColor.rgb = atmoApply(
      gl_FragColor.rgb,
      atmoView,
      normalize(uSunDir),
      atmoDist,
      atmoHeightAboveGround(vSoilWorldPos)
    );
  }
`;

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
/**
 * AL-04: point the ground at the shared atmosphere model. Safe to call before
 * the shader compiles: the values are cached on the material and the compiled
 * shader picks them up, so there is no window where the ground uses defaults.
 */
export function setGroundAtmosphere(
  material: THREE.MeshStandardMaterial,
  params: AtmosphereParams,
): void {
  material.userData.atmosphereParams = params;
  const uniforms = getGroundShader(material)?.uniforms;
  if (!uniforms?.uAtmoExtinction) return;
  (uniforms.uAtmoExtinction.value as THREE.Vector3).set(
    params.extinction[0],
    params.extinction[1],
    params.extinction[2],
  );
  uniforms.uAtmoScaleHeight.value = params.scaleHeightM;
  uniforms.uAtmoSunPhaseG.value = params.sunPhaseG;
  uniforms.uAtmoInScatter.value = params.inScatter;
  uniforms.uAtmoHorizonBoost.value = params.horizonBoost;
}

export function setGroundMoisture(material: THREE.MeshStandardMaterial, moisture: number): void {
  const uniforms = getGroundShader(material)?.uniforms;
  if (uniforms?.uSoilMoisture) uniforms.uSoilMoisture.value = moisture;
}

/**
 * Frame of the water-table height texture plus how strongly it darkens soil.
 *
 * The texture holds the same per-tile table the water surface is drawn from, as
 * an RGBA8 height ramp; the soil shader reads it in world XZ, so soil below the
 * table is waterlogged in pits and tunnels, not only where the puddle layer
 * happens to sit on the surface.
 */
export interface WaterTableDamping {
  texture: THREE.Texture;
  originX: number;
  originZ: number;
  cellSizeM: number;
  cells: number;
  minY: number;
  spanY: number;
  /** 0 leaves soil unchanged, 1 takes it to black under the water line. */
  strength: number;
  /** Metres above the table that stay visibly damp (capillary rise). */
  dampBandM: number;
}

/** River route mask for the soil shader's damp-bank tint. */
export interface RiverBankDamping {
  /** Baked mask: red marks the channel, green the damp band beside it. */
  mask: { texture: THREE.Texture; originX: number; originZ: number; sizeM: number };
  /** 0 leaves banks unchanged, 1 takes them to black. */
  strength: number;
}

/**
 * Damp the soil along the river banks.
 *
 * The carved banks sit above the water table, so the table lookup alone leaves
 * them looking dry right up to the stream. Ground near a channel is damp from
 * the water it carries, so this tints the band the surveyed route bakes into its
 * mask — the band bends with the valley instead of following an authored curve.
 */
export function setRiverBankDamping(
  material: THREE.MeshStandardMaterial,
  banks: RiverBankDamping | null,
): void {
  const uniforms = getGroundShader(material)?.uniforms;
  if (!uniforms) return;
  if (!banks) {
    if (uniforms.uRiverMaskAvailable) uniforms.uRiverMaskAvailable.value = 0.0;
    return;
  }
  if (uniforms.uRiverMask) uniforms.uRiverMask.value = banks.mask.texture;
  if (uniforms.uRiverMaskOrigin)
    (uniforms.uRiverMaskOrigin.value as THREE.Vector2).set(banks.mask.originX, banks.mask.originZ);
  if (uniforms.uRiverMaskSize) uniforms.uRiverMaskSize.value = banks.mask.sizeM;
  if (uniforms.uRiverDampStrength) uniforms.uRiverDampStrength.value = banks.strength;
  if (uniforms.uRiverMaskAvailable) uniforms.uRiverMaskAvailable.value = 1.0;
}

/** Hand the soil shader the water table so it can darken the soil it touches. */
export function setWaterTableDamping(
  material: THREE.MeshStandardMaterial,
  damping: WaterTableDamping | null,
): void {
  const uniforms = getGroundShader(material)?.uniforms;
  if (!uniforms) return;
  if (!damping) {
    if (uniforms.uWaterTableAvailable) uniforms.uWaterTableAvailable.value = 0.0;
    return;
  }
  if (uniforms.uWaterTable) uniforms.uWaterTable.value = damping.texture;
  if (uniforms.uWaterTableOrigin)
    (uniforms.uWaterTableOrigin.value as THREE.Vector2).set(damping.originX, damping.originZ);
  if (uniforms.uWaterTableCell) uniforms.uWaterTableCell.value = damping.cellSizeM;
  if (uniforms.uWaterTableCells) uniforms.uWaterTableCells.value = damping.cells;
  if (uniforms.uWaterTableRange)
    (uniforms.uWaterTableRange.value as THREE.Vector2).set(damping.minY, damping.spanY);
  if (uniforms.uWaterDampStrength) uniforms.uWaterDampStrength.value = damping.strength;
  if (uniforms.uWaterDampBandM) uniforms.uWaterDampBandM.value = damping.dampBandM;
  if (uniforms.uWaterTableAvailable) uniforms.uWaterTableAvailable.value = 1.0;
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
    // the cavity wall and the backdrop.
    transparent: false,
    depthWrite: true,
    // The opening's edge is resolved per multisample: the shader writes the cut
    // mask to alpha and coverage turns it into a smooth boundary instead of a
    // stair-stepped discard. Coverage of a hole, not colour, so the material
    // stays opaque and depth-correct.
    alphaToCoverage: true,
    // Root Sight puts the camera under the surface. A single-sided cap leaves
    // the hole floating against the sky; the shader already flips the normal
    // for back faces, so the ground renders from below as the surrounding soil.
    side: THREE.DoubleSide,
    // AL-04: distance is handled by the shared atmosphere model below, so the
    // renderer's own scene fog would be a second, disagreeing air out here.
    fog: false,
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
    shader.uniforms.uRootSightApertureTopY = soilUniforms.uRootSightApertureTopY;
    shader.uniforms.uRootSightApertureBottomY = soilUniforms.uRootSightApertureBottomY;
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
    shader.uniforms.uSoilCrackStrength = { value: config.soilCrackStrength };
    shader.uniforms.uSoilPebbleStrength = { value: config.soilPebbleStrength };
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
    shader.uniforms.uWaterTable = { value: null };
    shader.uniforms.uWaterTableOrigin = { value: new THREE.Vector2(0, 0) };
    shader.uniforms.uWaterTableCell = { value: 2 };
    shader.uniforms.uWaterTableCells = { value: 0 };
    shader.uniforms.uWaterTableRange = { value: new THREE.Vector2(0, 1) };
    shader.uniforms.uWaterTableAvailable = { value: 0.0 };
    shader.uniforms.uWaterDampStrength = { value: 0.35 };
    shader.uniforms.uWaterDampBandM = { value: 0.6 };
    shader.uniforms.uRiverMask = { value: null };
    shader.uniforms.uRiverMaskOrigin = { value: new THREE.Vector2(0, 0) };
    shader.uniforms.uRiverMaskSize = { value: 1 };
    shader.uniforms.uRiverMaskAvailable = { value: 0.0 };
    shader.uniforms.uRiverDampStrength = { value: 0.3 };
    shader.uniforms.uPlanetCenter = {
      value: new THREE.Vector3(0, -Math.max(planetRadius, 0), 0),
    };
    shader.uniforms.uPlanetRadius = { value: planetRadius };
    shader.uniforms.uPlanetEnabled = { value: onPlanet ? 1.0 : 0.0 };
    const atmoParams =
      (material.userData.atmosphereParams as AtmosphereParams | undefined) ?? DEFAULT_ATMOSPHERE;
    shader.uniforms.uAtmoExtinction = {
      value: new THREE.Vector3().fromArray(atmoParams.extinction as unknown as number[]),
    };
    shader.uniforms.uAtmoScaleHeight = { value: atmoParams.scaleHeightM };
    shader.uniforms.uAtmoSunPhaseG = { value: atmoParams.sunPhaseG };
    shader.uniforms.uAtmoInScatter = { value: atmoParams.inScatter };
    shader.uniforms.uAtmoHorizonBoost = { value: atmoParams.horizonBoost };

    shader.vertexShader = applySoilVertexShader(shader.vertexShader);
    shader.fragmentShader = applySoilFragmentShader(shader.fragmentShader, {
      prelude: ATMOSPHERE_FRAGMENT_PRELUDE,
      apply: ATMOSPHERE_APPLY,
    });
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
      // The body is cut as well. It is the same ground at its coarsest, and
      // where the relief dips below the mean sphere this smooth shell stands
      // *above* the detail patch - so an uncut body filled every Root Sight
      // opening with a bare brown disc and the cavity walls never appeared.
      // Measured 2026-11-16: `aSurfaceCut` was 1 on `planet-terrain-detail` and
      // 0 here, the hole showed this sphere, and a camera under the soil - which
      // hides the body outright - saw the cavity normally. The cut is a
      // per-fragment position test, so cutting the body costs only the aperture
      // inside it. Every soil patch is cut for the same reason.
      setSurfaceCut(mesh, true);
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
        // The outer ring is cut too. It is the same ground, and leaving it
        // solid meant a pit opened past the detail patch's ±88 m edge was
        // covered by the ring standing a few millimetres above the body: Root
        // Sight worked at spawn and silently stopped working after a reroot.
        // The cut is a per-fragment position test, so a patch with nothing near
        // the aperture pays only for that test.
        setSurfaceCut(patches.outer, true);
        terrainMeshes.push(patches.inner, patches.outer);
        // The soil has thickness. The patch is a sheet: without walls and an
        // underside, opening the ground revealed the back of that sheet and the
        // empty space behind it. The slab lines the patch with the depth the
        // config already claimed the soil had, and takes the same aperture cut,
        // so the cut faces are earth and not a place the sky shows through.
        // The body has to be at least as deep as the cavity that will be cut
        // into it. It was the configured topsoil depth, 1.6 m - and the pit is
        // 1.9 mouth radii deep, so a 1.24 m mouth is a 2.4 m pit whose floor hung
        // out of the bottom of the world. The underside had to be perforated to
        // let the pit through, and an eye below the body saw the pit's own shell
        // from outside with the sky behind it: that is the "cave walls" the
        // underground view showed. The widest cut the config allows sets the
        // thickness, so the body already contains the pit at any aperture.
        const widestMouthM = Math.max(
          soilUniforms.uRootSightRadius.value,
          soilUniforms.uRootSightApertureRadius.value,
        );
        const bodyDepthM = Math.max(config.soilDepthM, cavityDepthM(widestMouthM) + 0.6);
        const slab = createSoilSlab({
          radius: planetRadius,
          field: getTerrainParams(),
          material,
          segments: Math.max(16, Math.round(config.terrainMeshSubdivisions * 0.75)),
          extentM: Math.min(180, Math.max(20, getTerrainParams().patchRadiusM) * 2),
          skinM: 0.02,
          depthM: Math.max(0.2, bodyDepthM),
          // No hole: the underside now sits below the deepest floor the bowl can
          // reach, so the sheet no longer crosses the cavity. The option stays
          // because it is how the old body is reproduced for comparison.
          holeRadiusM: 0,
        });
        slab.userData.bodyDepthM = Math.max(0.2, bodyDepthM);
        mesh.add(slab);
        setSurfaceCut(slab, true);
        // Deliberately NOT in `terrainMeshes`: that list becomes the physics
        // trimesh. The slab is the earth's own body - walls and an underside -
        // and colliding it would seal the ground into a closed box, so everything
        // under the surface would be inside a solid and "is this root in soil"
        // would stop meaning anything. Physics keeps the surface patches.
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
