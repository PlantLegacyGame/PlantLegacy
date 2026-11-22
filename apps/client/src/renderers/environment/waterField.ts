/**
 * The visible water of the world: rain puddles, the water table under them, and
 * the darker, damp ground they leave behind.
 *
 * Water used to exist only as one disc at the centre of the Root Sight cavity,
 * hidden whenever the cavity bowl was hidden. The rest of the ground was dry,
 * water never lay on the surface, and leaving Root Sight made it vanish.
 *
 * This field draws what the simulation already knows:
 *
 * - **The water table** arrives as a coarse per-tile height field from the
 *   server (`getWaterTableHeightAt`, sent as an `RESOURCE_UPDATE.waterTable`
 *   grid). Its surface is one continuous mesh, so nearby water connects, the
 *   level rises and falls with rain, and a plant draining its own tile lowers
 *   the water under itself while its neighbours stay wet. Where the table is
 *   below the ground, the terrain hides it; the Root Sight pit cuts that ground
 *   open and shows the same surface inside the cavity.
 * - **Rain puddles** are the local shallow-water sheet: rain adds depth, the
 *   solver runs it into hollows, and it soaks away. They are drawn only where
 *   the water table is still below the ground, so a puddle and the table never
 *   fight for the same surface. What soaks away recharges the local table.
 * - **Damp ground** is a dark stain that follows the water: everywhere the sheet
 *   is wet, and for a while after it dries, the soil under and around it is
 *   darker, as wet dirt is. Without it a puddle sat on unchanged dirt and read
 *   as a coloured decal.
 *
 * Every surface carries its water column in the `aWater` attribute, so the
 * shader darkens deep water and keeps shallow water clear.
 *
 * No disc is fitted to anything: both surfaces are fields, and the geometry
 * does the clipping.
 */
import {
  type RiverPath,
  type RiverStation,
  riverNearest,
  SurfaceWaterGrid,
} from '@plant-legacy/shared/world';
import * as THREE from 'three';
import { worldColour } from '../worldPalette.ts';
import type { WaterSurfaceOverPoint } from './underwater.js';
import {
  DEFAULT_WATER_COLORS,
  DEFAULT_WATER_FIELD_TUNING,
  sheetFadeRange,
  type WaterColors,
  type WaterFieldTuning,
} from './waterFieldTuning.js';
import { createWaterMaterial, type WaterMaterial } from './waterMaterial.js';

/**
 * How far the stream's surface sits above its bed, metres.
 *
 * Enough to beat depth precision against the terrain, small enough that the two
 * do not fight: the sheet used to ride the generic `surfaceLiftM` and, where it
 * came within a centimetre of the ground, the shoreline disappeared in patches.
 */
const RIVER_FILM_LIFT_M = 0.02;

/** Baked map of the surveyed route, used by the shaders. */
export interface RiverMask {
  texture: THREE.Texture;
  /** World position of the mask's (0, 0) texel corner. */
  originX: number;
  originZ: number;
  /** Side length of the square the mask covers, metres. */
  sizeM: number;
}

/**
 * The river, as the terrain field surveys it.
 *
 * The channel is carved into the shared ground field along a route taken from
 * the terrain's own drainage, so this only has to carry the water standing in
 * it: a surface level across the channel and monotone along it, which is what
 * makes the stream read as flowing downhill instead of climbing a hill.
 */
export interface RiverField {
  /** Surveyed centre line, with its monotone water surface. */
  stations: RiverStation[];
  /** Half the width the ribbon is drawn across, metres. */
  halfWidthM: number;
  /** Depth of the stream at the centre of the channel, metres. */
  waterDepthM: number;
  /** Downstream speed of the ripple field, metres per second. */
  flowMps: number;
  /** Route mask for clipping other water out of the channel. */
  mask: RiverMask | null;
}

/**
 * Bake the surveyed route into a texture the water and soil shaders can sample.
 *
 * Red marks the channel (expanded by `marginM`) and green the damp bank band, so
 * a fragment anywhere in the world can ask "am I in the river?" without the
 * survey being re-run in GLSL.
 */
export function createRiverMask(
  path: RiverPath,
  extentM = 180,
  cells = 512,
  marginM = 0.5,
): RiverMask {
  const size = Math.max(8, Math.round(cells));
  const span = Math.max(8, extentM) * 2;
  const reach = path.halfWidthM + path.apronM + marginM;
  const data = new Uint8Array(size * size * 4);
  const bankWidth = Math.max(1, path.halfWidthM * 0.9);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const x = -span / 2 + ((i + 0.5) / size) * span;
      const z = -span / 2 + ((j + 0.5) / size) * span;
      const hit = riverNearest(path, x, z, reach);
      if (!hit) continue;
      const k = (j * size + i) * 4;
      data[k] = hit.distanceM <= path.halfWidthM + marginM ? 255 : 0;
      const bank = Math.min(1, Math.max(0, 1 - (hit.distanceM - bankWidth) / bankWidth));
      data[k + 1] = Math.round(255 * bank);
      data[k + 2] = 0;
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { texture, originX: -span / 2, originZ: -span / 2, sizeM: span };
}

/** Coarse water-table grid as the server sends it. */
export interface WaterTableField {
  originX: number;
  originZ: number;
  cellSizeM: number;
  cells: number;
  /** Absolute world Y of the table per cell, row-major. */
  heights: Float32Array;
}

// Tuning and colours live in their own module so config loaders (and their
// tests under the plain Node runner) do not pull Three.js and the water shader
// in through this file. Re-exported here because WaterField consumes them.
export {
  DEFAULT_WATER_COLORS,
  DEFAULT_WATER_FIELD_TUNING,
  type WaterColors,
  type WaterFieldTuning,
} from './waterFieldTuning.js';

export interface WaterFieldUpdate {
  dt: number;
  elapsedSeconds: number;
  raining: boolean;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyColor: THREE.Color;
}

export interface WaterField {
  group: THREE.Group;
  surfaceMesh: THREE.Mesh;
  groundwaterMesh: THREE.Mesh;
  wetGroundMesh: THREE.Mesh;
  riverMesh: THREE.Mesh | null;
  surfaceGrid: SurfaceWaterGrid;
  surfaceVolumeM3(): number;
  /** Lowest/highest table height currently held, for diagnostics. */
  waterTableRange(): { min: number; max: number };
  /**
   * Every drawn water surface over a world point, highest first.
   *
   * The eye has to know what it is under: a puddle sheet, the river, or the
   * water table. Reading it from the same arrays the meshes are built from keeps
   * the answer the shader's answer instead of a second, drifting model.
   */
  waterSurfacesAt(x: number, z: number): WaterSurfaceOverPoint[];
  /** The colour the shader calls deep water, for tinting the view under it. */
  waterColor(): THREE.Color;
  /**
   * Hide water inside Root Sight's opening so the cavity shows dirt and roots.
   *
   * One volume, the same one the soil shader cuts: the mouth's plan radius,
   * its top plane and the cavity floor. There is no separate sightline guess,
   * so water outside the opening is never clipped wherever the eye is.
   */
  setCavityClip(x: number, z: number, radiusM: number): void;
  /** Dev: pour a layer of water onto the whole sheet, to inspect the rendering. */
  fillSurface(depthM: number): void;
  /** Re-sample the ground under the sheet after the terrain config changes. */
  resample(surfaceYAt: (x: number, z: number) => number): void;
  /** Apply a fresh water-table grid from the server. */
  setWaterTable(field: WaterTableField): void;
  /**
   * Share this field's ground grids and per-frame water uniforms with the
   * planet-wide sea, which needs the same sampling to know its depth and the
   * same sun, sky and Root Sight clip as every other body of water.
   */
  attachOcean(material: WaterMaterial): void;
  update(params: WaterFieldUpdate): void;
}

/** Cell spacing at which the damp stain is fully opaque. */
const WET_FULL_DEPTH_M = 0.02;

export function createWaterField(
  surfaceYAt: (x: number, z: number) => number,
  tuning: Partial<WaterFieldTuning> = {},
  /** Colour of damp, waterlogged soil. */
  wetGroundColor: THREE.Color = worldColour('soil_wet'),
  /** The stream carved into the terrain field, if the world has one. */
  river: RiverField | null = null,
  /** Body/shallow/sky colours; `config/water.json` owns them. */
  colors: WaterColors = DEFAULT_WATER_COLORS,
): WaterField {
  const config: WaterFieldTuning = { ...DEFAULT_WATER_FIELD_TUNING, ...tuning };
  const cells = Math.max(8, Math.round(config.surfaceCells));
  const extent = Math.max(4, config.surfaceExtentM);
  const cellSize = (extent * 2) / (cells - 1);

  // The sea is outside this field but shares its ground sampling, lighting and
  // Root Sight clip, so every loop below that touches the waters is one list.
  let oceanMaterial: WaterMaterial | null = null;
  const allWaters = (): WaterMaterial[] =>
    [surfaceWater, groundwater, riverWater, oceanMaterial].filter(
      (water): water is WaterMaterial => water !== null,
    );

  // Static heights: the sheet is centred on the play area, so the terrain under
  // it never moves and the expensive height sampling happens once.
  const heights = new Float32Array(cells * cells);
  for (let z = 0; z < cells; z += 1) {
    for (let x = 0; x < cells; x += 1) {
      heights[z * cells + x] = surfaceYAt(-extent + x * cellSize, -extent + z * cellSize);
    }
  }
  const grid = new SurfaceWaterGrid(heights, cells, cells, cellSize);

  // The ground under the water near the player, sampled at the detail patch's
  // own cell size and out to its own radius: that is the ground the eye sees
  // there, and testing water against anything else compares it with a surface
  // that is not on screen.
  const fineRadiusM = Math.max(extent, config.groundTestFineRadiusM);
  const fineCellM = Math.max(0.5, config.groundTestFineCellM);
  const fineCells = Math.min(768, Math.max(8, Math.round((fineRadiusM * 2) / fineCellM) + 1));
  const fineStep = (fineRadiusM * 2) / (fineCells - 1);
  const fineHeights = new Float32Array(fineCells * fineCells);
  for (let z = 0; z < fineCells; z += 1) {
    for (let x = 0; x < fineCells; x += 1) {
      fineHeights[z * fineCells + x] = surfaceYAt(
        (x - (fineCells - 1) * 0.5) * fineStep,
        (z - (fineCells - 1) * 0.5) * fineStep,
      );
    }
  }

  // The ground under the water, sampled at the *far ring's* cell size. Past the
  // detail patch the ground on screen is that coarse mesh: its triangles are a
  // linear interpolation of the field across metres of relief, so they sit below
  // the field wherever it is convex. A sheet that is genuinely underground then
  // stands in front of the drawn hill. Reading this grid back with linear
  // filtering reproduces the drawn surface closely enough for the water's
  // underground test (the material takes the lower of the two grounds).
  // The fine grid above only covers the surface sheet (±`extent`). The water
  // table is a server grid that reaches much further, and out there the drawn
  // ground is the coarse ring, so the ground test has to cover the table's own
  // range too. It is one texture of that whole range at the ring's spacing.
  const coarseCellM = Math.max(1, config.groundTestCellM);
  const coarseRadiusM = Math.max(extent, config.groundTestRadiusM);
  const coarseCells = Math.min(768, Math.max(8, Math.round((coarseRadiusM * 2) / coarseCellM) + 1));
  const coarseStep = (coarseRadiusM * 2) / (coarseCells - 1);
  const coarseHeights = new Float32Array(coarseCells * coarseCells);
  for (let z = 0; z < coarseCells; z += 1) {
    for (let x = 0; x < coarseCells; x += 1) {
      coarseHeights[z * coarseCells + x] = surfaceYAt(
        -coarseRadiusM + x * coarseStep,
        -coarseRadiusM + z * coarseStep,
      );
    }
  }

  /**
   * The ground under the water, as a texture the water shaders can compare
   * against. Without it a water surface standing above the soil is still drawn,
   * and that is not a depth-precision artefact to be biased away: it is a flood
   * over the whole valley, which is what the water table did whenever it stood
   * above the terrain, and what filled the Root Sight cavity with a dark disc.
   */
  let groundTexture: THREE.DataTexture | null = null;
  let coarseGroundTexture: THREE.DataTexture | null = null;
  const rebuildGroundTexture = (): void => {
    const n = fineCells;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const height of fineHeights) {
      if (height < min) min = height;
      if (height > max) max = height;
    }
    const span = Math.max(0.001, max - min);
    const data = new Uint8Array(n * n * 4);
    for (let i = 0; i < fineHeights.length; i += 1) {
      const value = Math.round(((fineHeights[i] - min) / span) * 255);
      data[i * 4] = value;
      data[i * 4 + 1] = value;
      data[i * 4 + 2] = value;
      data[i * 4 + 3] = 255;
    }
    groundTexture?.dispose();
    groundTexture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    groundTexture.minFilter = THREE.LinearFilter;
    groundTexture.magFilter = THREE.LinearFilter;
    groundTexture.needsUpdate = true;

    // The same field at the coarse ring's spacing, packed the same way.
    let coarseMin = Number.POSITIVE_INFINITY;
    let coarseMax = Number.NEGATIVE_INFINITY;
    for (const height of coarseHeights) {
      if (height < coarseMin) coarseMin = height;
      if (height > coarseMax) coarseMax = height;
    }
    const coarseSpan = Math.max(0.001, coarseMax - coarseMin);
    const coarseData = new Uint8Array(coarseCells * coarseCells * 4);
    for (let i = 0; i < coarseHeights.length; i += 1) {
      const value = Math.round(((coarseHeights[i] - coarseMin) / coarseSpan) * 255);
      coarseData[i * 4] = value;
      coarseData[i * 4 + 1] = value;
      coarseData[i * 4 + 2] = value;
      coarseData[i * 4 + 3] = 255;
    }
    coarseGroundTexture?.dispose();
    coarseGroundTexture = new THREE.DataTexture(
      coarseData,
      coarseCells,
      coarseCells,
      THREE.RGBAFormat,
    );
    coarseGroundTexture.minFilter = THREE.LinearFilter;
    coarseGroundTexture.magFilter = THREE.LinearFilter;
    coarseGroundTexture.needsUpdate = true;

    // The sea is not in this loop: it carries its own bed field out to 900 m,
    // because these grids stop at 180 m and 560 m and the shore most players see
    // is past both of them.
    for (const water of [surfaceWater, groundwater]) {
      const uniforms = water.material.uniforms;
      uniforms.uGroundHeight.value = groundTexture;
      uniforms.uGroundHeightAvailable.value = 1;
      (uniforms.uGroundHeightOrigin.value as THREE.Vector2).set(-fineRadiusM, -fineRadiusM);
      uniforms.uGroundHeightSize.value = fineRadiusM * 2;
      (uniforms.uGroundHeightRange.value as THREE.Vector2).set(min, span);
      uniforms.uGroundCoarse.value = coarseGroundTexture;
      uniforms.uGroundCoarseAvailable.value = 1;
      (uniforms.uGroundCoarseOrigin.value as THREE.Vector2).set(-coarseRadiusM, -coarseRadiusM);
      uniforms.uGroundCoarseSize.value = coarseRadiusM * 2;
      (uniforms.uGroundCoarseRange.value as THREE.Vector2).set(coarseMin, coarseSpan);
      // The detail patch is drawn from the fine field, so the coarse ring only
      // takes over past its edge. Without this a puddle on a bump beside the
      // player could be thrown away by a ring triangle 180 m away.
      uniforms.uGroundCoarseInnerRadiusM.value = fineRadiusM * 0.97;
    }
  };

  const geometry = new THREE.PlaneGeometry(extent * 2, extent * 2, cells - 1, cells - 1);
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const depthAttr = new THREE.BufferAttribute(new Float32Array(positionAttr.count), 1);
  geometry.setAttribute('aWater', depthAttr);

  /** Paint one material with the configured water roles. */
  const paintWater = (water: WaterMaterial): void => {
    water.deepColor.copy(worldColour(colors.deep));
    water.shallowColor.copy(worldColour(colors.shallow));
    water.skyColor.copy(worldColour(colors.sky));
  };

  // Where the square grids end. The surface sheet spans `extent` around the
  // origin; the water table is a server grid, so its centre is recomputed from
  // whatever it sent. Both fade out radially, because a straight sheet edge is
  // visible from a high camera as a square of water in the middle of the world.
  const setSheetFade = (
    water: WaterMaterial,
    centreX: number,
    centreZ: number,
    radiusM: number,
  ): void => {
    const range = sheetFadeRange(radiusM, config.sheetEdgeFade);
    (water.material.uniforms.uSheetCenter.value as THREE.Vector2).set(centreX, centreZ);
    (water.material.uniforms.uSheetFade.value as THREE.Vector2).set(range.startM, range.endM);
  };

  const surfaceWater: WaterMaterial = createWaterMaterial({ edgeFade: true });
  paintWater(surfaceWater);
  setSheetFade(surfaceWater, 0, 0, extent);
  surfaceWater.material.uniforms.uOpacity.value = 0.85;
  surfaceWater.material.uniforms.uAbsorption.value = config.absorptionPerM;
  // The film is centimetres above the soil; a depth bias keeps the tessellated
  // ground from cutting through it (that is what made puddles read as blotches).
  surfaceWater.material.polygonOffset = true;
  surfaceWater.material.polygonOffsetFactor = -4;
  // Polygon offset is measured in depth-buffer units, so it scales with the
  // buffer's own precision: a clip-space bias did not, and pulled the sheet
  // towards the camera by more metres the further out it was, which is what
  // made water appear out of the ground as the view pulled back.
  // Small: polygon offset is in depth-buffer units, and the buffer's resolution
  // at a few hundred metres turns a large unit count into a metre-scale pull
  // towards the camera, which floated the film over hills from a bird's eye.
  surfaceWater.material.polygonOffsetUnits = -4;
  // Beyond this range the film is faded out entirely, so the fine sheet and the
  // coarse distant ground never disagree in front of the camera.
  surfaceWater.material.uniforms.uFadeRange.value.set(
    config.puddleFadeStartM,
    config.puddleFadeEndM,
  );
  const surfaceMesh = new THREE.Mesh(geometry, surfaceWater.material);
  surfaceMesh.name = 'surface-water';
  surfaceMesh.rotation.x = -Math.PI / 2;
  surfaceMesh.renderOrder = 4;
  surfaceMesh.frustumCulled = false;
  surfaceMesh.visible = false;

  // The water table mesh is built to whatever grid the server last sent.
  const groundwater: WaterMaterial = createWaterMaterial();
  paintWater(groundwater);
  setSheetFade(groundwater, 0, 0, extent);
  // The table is the water body a bird's-eye view sees most of; without a bias
  // it fought the soil along every shoreline it crossed.
  groundwater.material.polygonOffset = true;
  groundwater.material.polygonOffsetFactor = -2;
  groundwater.material.polygonOffsetUnits = -4;
  groundwater.material.uniforms.uOpacity.value = 0.92;
  groundwater.material.uniforms.uFadeRange.value.set(config.tableFadeStartM, config.tableFadeEndM);
  groundwater.material.uniforms.uAbsorption.value = config.absorptionPerM;

  // How far above the *drawn* ground each sheet may stand before it is thrown
  // away. The table is a subsurface sheet: even a couple of centimetres of
  // clearance is a defect, because the drawn hill above it is not there to hide
  // it, and that is how slivers of water appeared on slopes. The film lies on
  // the ground by design, so its allowance is wide - the tight value tore brown
  // holes in every puddle wider than a terrain cell, where the sheet's own
  // triangulation stood a few centimetres above the detail mesh.
  groundwater.material.uniforms.uWaterSubmergeM.value = 0.02;
  surfaceWater.material.uniforms.uWaterSubmergeM.value = 0.35;

  // The stream is the only water allowed in its channel. Puddles and the water
  // table clip themselves out of it per fragment, so overlapping translucent
  // surfaces cannot stack their alpha inside the river.
  if (river?.mask) {
    for (const water of [surfaceWater, groundwater]) {
      const uniforms = water.material.uniforms;
      uniforms.uRiverClip.value = 1;
      uniforms.uChannelMask.value = river.mask.texture;
      (uniforms.uChannelMaskOrigin.value as THREE.Vector2).set(
        river.mask.originX,
        river.mask.originZ,
      );
      uniforms.uChannelMaskSize.value = river.mask.sizeM;
      uniforms.uChannelMaskAvailable.value = 1;
    }
  }
  const tableGeometry = new THREE.BufferGeometry();
  const groundwaterMesh = new THREE.Mesh(tableGeometry, groundwater.material);
  groundwaterMesh.name = 'groundwater-table';
  groundwaterMesh.renderOrder = 3;
  groundwaterMesh.frustumCulled = false;
  groundwaterMesh.visible = false;

  // Damp ground: the same grid as the sheet, flat on the soil, darkening where
  // water is standing and for a fading while after it soaks away.
  const wetGeometry = new THREE.PlaneGeometry(extent * 2, extent * 2, cells - 1, cells - 1);
  const wetPositionAttr = wetGeometry.getAttribute('position') as THREE.BufferAttribute;
  const wetAttr = new THREE.BufferAttribute(new Float32Array(wetPositionAttr.count), 1);
  wetGeometry.setAttribute('aWet', wetAttr);
  const wetMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: wetGroundColor },
      uOpacity: { value: config.wetGroundOpacity },
      // The stain follows the sheet, so it has the same square grid and needs
      // the same radial end: a dark square of damp earth is as wrong as a square
      // of water when the camera pulls back.
      uSheetFade: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader: /* glsl */ `
      attribute float aWet;
      varying float vWet;
      varying vec2 vWetWorld;
      void main() {
        vWet = aWet;
        vWetWorld = (modelMatrix * vec4(position, 1.0)).xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform vec2 uSheetFade;
      varying float vWet;
      varying vec2 vWetWorld;
      void main() {
        float alpha = uOpacity * vWet;
        if (uSheetFade.y > 0.0) {
          alpha *= 1.0 - smoothstep(
            uSheetFade.x,
            uSheetFade.y,
            distance(vWetWorld, vec2(0.0))
          );
        }
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -8,
  });
  const wetGroundMesh = new THREE.Mesh(wetGeometry, wetMaterial);
  (wetMaterial.uniforms.uSheetFade.value as THREE.Vector2).set(
    sheetFadeRange(extent, config.sheetEdgeFade).startM,
    extent,
  );
  wetGroundMesh.name = 'wet-ground';
  wetGroundMesh.rotation.x = -Math.PI / 2;
  wetGroundMesh.renderOrder = 2;
  wetGroundMesh.frustumCulled = false;
  wetGroundMesh.visible = false;

  // The stream in the carved channel: one ribbon strung along the surveyed
  // centre line, level across the channel and monotone along it. Each vertex
  // carries its distance downstream and its lateral position, which is the frame
  // the ripple field is sampled in — the streaks then follow the valley.
  let riverMesh: THREE.Mesh | null = null;
  let riverWater: WaterMaterial | null = null;
  const stations = river?.stations ?? [];
  if (river && stations.length >= 2) {
    const across = 4;
    const columns = across + 1;
    // Slightly narrower than the carved channel: the terrain then cuts the
    // water where the banks rise, so the stream has a real shoreline instead of
    // a ribbon edge floating over the slope.
    const halfWidth = Math.max(0.5, river.halfWidthM * 0.92);
    // Two rows per surveyed gap, on the bed between stations. One row per
    // station drew a straight ribbon that cut under the carved bed wherever the
    // channel bent or rose between two stations, and the stream appeared as
    // disconnected patches of water with soil between them.
    const subSteps = 2;
    const rows = (stations.length - 1) * subSteps + 1;
    const positions = new Float32Array(rows * columns * 3);
    const depths = new Float32Array(rows * columns);
    const flowUV = new Float32Array(rows * columns * 2);
    for (let i = 0; i < rows; i += 1) {
      const segment = Math.min(stations.length - 2, Math.floor(i / subSteps));
      const from = stations[segment];
      const to = stations[segment + 1];
      const fraction = (i - segment * subSteps) / subSteps;
      // The centre line at this row, interpolated between the two stations that
      // bracket it, so every row sits on the surveyed route.
      const centreX = from.x + (to.x - from.x) * fraction;
      const centreZ = from.z + (to.z - from.z) * fraction;
      const alongM = from.alongM + (to.alongM - from.alongM) * fraction;
      let tangentX = to.x - from.x;
      let tangentZ = to.z - from.z;
      const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
      tangentX /= tangentLength;
      tangentZ /= tangentLength;
      for (let j = 0; j <= across; j += 1) {
        // -1 .. 1 across the channel, so the shader has the lateral offset in
        // the same units wherever the ribbon is.
        const across01 = -1 + (j / across) * 2;
        const x = centreX - tangentZ * halfWidth * across01;
        const z = centreZ + tangentX * halfWidth * across01;
        // The stream sits in the channel the terrain actually carved. Two fixes
        // stacked here: first the height came from a relief-only water level and
        // floated 1.5 m over the soil, then it came from the bed *plus the
        // surveyed depth*, which is a slab up to 0.6 m proud of its banks - and
        // wherever Root Sight opened in that reach the slab ran across the
        // opening instead of being cut by it. The geometry is a film on the bed;
        // the surveyed depth still drives the water column (`aWater`), so the
        // stream keeps its colour and absorption without standing above ground.
        const bed = surfaceYAt(x, z);
        const y = bed + RIVER_FILM_LIFT_M;
        const v = i * columns + j;
        positions[v * 3] = x;
        positions[v * 3 + 1] = y;
        positions[v * 3 + 2] = z;
        // The column the shader darkens by is the surveyed depth, not the 4 cm
        // the surface geometry sits at, or every stream would read as a puddle.
        depths[v] = Math.max(0.02, river.waterDepthM);
        flowUV[v * 2] = alongM;
        flowUV[v * 2 + 1] = across01;
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < rows - 1; i += 1) {
      for (let j = 0; j < across; j += 1) {
        const a = i * columns + j;
        const b = a + 1;
        const c = a + columns;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const riverGeometry = new THREE.BufferGeometry();
    riverGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    riverGeometry.setAttribute('aWater', new THREE.BufferAttribute(depths, 1));
    riverGeometry.setAttribute('aFlowUV', new THREE.BufferAttribute(flowUV, 2));
    riverGeometry.setIndex(indices);
    riverGeometry.computeVertexNormals();
    riverGeometry.computeBoundingSphere();

    riverWater = createWaterMaterial();
    paintWater(riverWater);
    riverWater.material.uniforms.uOpacity.value = 0.9;
    riverWater.material.uniforms.uAbsorption.value = config.absorptionPerM;
    riverWater.material.uniforms.uFlow.value.set(river.flowMps, 0);
    // The river's own channel frame, for the wave field.
    riverWater.material.uniforms.uRiverFlow.value = 1;
    riverWater.material.uniforms.uRiverWidthM.value = halfWidth * 2;
    // Stretch the ripple field along the flow so the stream shows streaks
    // running downstream, not a tidy pond surface sliding sideways.
    riverWater.material.uniforms.uRippleScale.value.set(0.55, 2.6);
    riverWater.material.uniforms.uRippleStrength.value = 2.4;
    riverWater.material.uniforms.uStreakStrength.value = 1;
    // The stream is a film on its bed, not a subsurface sheet: the same wide
    // allowance the surface film uses, so the banks never tear it into patches.
    riverWater.material.uniforms.uWaterSubmergeM.value = 0.35;
    riverWater.material.polygonOffset = true;
    riverWater.material.polygonOffsetFactor = -3;
    riverWater.material.polygonOffsetUnits = -12;
    riverMesh = new THREE.Mesh(riverGeometry, riverWater.material);
    riverMesh.name = 'river-water';
    riverMesh.renderOrder = 4;
    riverMesh.frustumCulled = false;
  }

  const group = new THREE.Group();
  group.name = 'water-field';
  if (riverMesh) group.add(riverMesh);
  group.add(wetGroundMesh);
  group.add(groundwaterMesh);
  // Bind the ground field once everything it is bound to exists.
  rebuildGroundTexture();
  group.add(surfaceMesh);

  let table: WaterTableField | null = null;
  let surfaceVolume = 0;
  /** Per-vertex dampness, 0 dry .. 1 soaked; decays after the water leaves. */
  const dampness = new Float32Array(cells * cells);
  /** Scratch buffer for the spread pass. */
  const wetSpread = new Float32Array(cells * cells);
  const haloCells = Math.max(0, Math.round(config.wetGroundHaloCells));

  const rebuildTableMesh = (): void => {
    if (!table) return;
    const n = table.cells;
    const positions = new Float32Array(n * n * 3);
    const depths = new Float32Array(n * n);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const v = j * n + i;
        const y = table.heights[v];
        const wx = table.originX + i * table.cellSizeM;
        const wz = table.originZ + j * table.cellSizeM;
        // The table is a subsurface surface. Where the aquifer stands above the
        // ground the water would be a lake, and the rain sheet is what draws
        // standing water; letting the table poke through here painted the whole
        // play area with flat blue patches every time it was fully recharged.
        const ground = surfaceYAt(wx, wz);
        positions[v * 3] = wx;
        // The table is a subsurface sheet, so it is always drawn under the soil.
        // Drawing it at its own height where that was above the ground turned
        // the field into an ocean over the play area, and clamping it five
        // centimetres under the surface left it flickering through the terrain.
        // It sinks deep enough that a coarse triangle cannot poke through, and
        // the surface puddle sheet is what stands above ground.
        positions[v * 3 + 1] = Math.min(y, ground - config.drySinkM);
        positions[v * 3 + 2] = wz;
        // How far under the ground this water lies: the light reaching it
        // travels down through that much soil and water.
        depths[v] = Math.max(0, ground - y);
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < n - 1; j += 1) {
      for (let i = 0; i < n - 1; i += 1) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    tableGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    tableGeometry.setAttribute('aWater', new THREE.BufferAttribute(depths, 1));
    tableGeometry.setIndex(indices);
    tableGeometry.computeVertexNormals();
    tableGeometry.computeBoundingSphere();
    // The table is its own grid, so its square boundary moves with whatever the
    // server sent. Fade it out radially from that grid's centre, or a bird's-eye
    // view shows a rectangle of water standing in the world.
    const halfSize = ((n - 1) * table.cellSizeM) / 2;
    setSheetFade(groundwater, table.originX + halfSize, table.originZ + halfSize, halfSize);
  };

  /** Place the damp layer on the ground and spread it past the water's edge. */
  const updateWetGround = (dt: number): void => {
    const dryRate = Math.max(0, config.wetGroundDryPerS) * dt;
    let anyDamp = false;
    for (let i = 0; i < dampness.length; i += 1) {
      const wetNow = Math.min(1, grid.depth[i] / WET_FULL_DEPTH_M);
      dampness[i] = Math.max(wetNow, dampness[i] - dryRate);
      if (dampness[i] > 0.004) anyDamp = true;
    }
    // Dry everywhere: the stain has nothing to draw, so skip the spread pass
    // (and the per-vertex writes) instead of rebuilding an invisible layer.
    if (!anyDamp) {
      if (wetGroundMesh.visible) {
        (wetAttr.array as Float32Array).fill(0);
        wetAttr.needsUpdate = true;
        wetGroundMesh.visible = false;
      }
      return;
    }

    wetSpread.fill(0);
    for (let z = 0; z < cells; z += 1) {
      for (let x = 0; x < cells; x += 1) {
        const here = dampness[z * cells + x];
        if (here <= 0) continue;
        // A wet cell darkens itself fully and its neighbours by less, so the
        // stain has a damp margin around the water instead of a hard outline.
        for (let dz = -haloCells; dz <= haloCells; dz += 1) {
          const nz = z + dz;
          if (nz < 0 || nz >= cells) continue;
          for (let dx = -haloCells; dx <= haloCells; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= cells) continue;
            const distance = Math.hypot(dx, dz);
            if (distance > haloCells) continue;
            const falloff = 1 - distance / (haloCells + 0.5);
            const value = here * falloff;
            const at = nz * cells + nx;
            if (value > wetSpread[at]) wetSpread[at] = value;
          }
        }
      }
    }

    const wetArray = wetAttr.array as Float32Array;
    let anyWet = false;
    for (let i = 0; i < heights.length; i += 1) {
      const value = wetSpread[i];
      wetArray[i] = value;
      if (value > 0.01) anyWet = true;
      wetPositionAttr.array[i * 3 + 2] = heights[i] + 0.012;
    }
    wetPositionAttr.needsUpdate = true;
    wetAttr.needsUpdate = true;
    wetGroundMesh.visible = anyWet;
  };

  return {
    group,
    surfaceMesh,
    groundwaterMesh,
    wetGroundMesh,
    riverMesh,
    surfaceGrid: grid,
    surfaceVolumeM3: () => surfaceVolume,
    attachOcean: (material: WaterMaterial) => {
      oceanMaterial = material;
      material.material.uniforms.uMinVisibleDepth.value = config.minVisibleDepthM;
      material.material.uniforms.uAbsorption.value = config.absorptionPerM;
    },
    setCavityClip: (x: number, z: number, radiusM: number) => {
      for (const water of allWaters()) {
        if (!water) continue;
        (water.material.uniforms.uCavityCenter.value as THREE.Vector2).set(x, z);
        water.material.uniforms.uCavityRadius.value = Math.max(0, radiusM);
      }
    },
    waterSurfacesAt: (x: number, z: number): WaterSurfaceOverPoint[] => {
      const surfaces: WaterSurfaceOverPoint[] = [];
      const insideSheet =
        Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) <= extent && Math.abs(z) <= extent;
      if (insideSheet) {
        const i = Math.min(cells - 1, Math.max(0, Math.round((x + extent) / cellSize)));
        const j = Math.min(cells - 1, Math.max(0, Math.round((z + extent) / cellSize)));
        const at = j * cells + i;
        if ((grid.depth[at] ?? 0) > config.minVisibleDepthM) {
          surfaces.push({ height: heights[at] + config.surfaceLiftM, kind: 'puddle' });
        }
        const tableY = tableAt(x, z);
        if (tableY !== null && tableY < heights[at] - config.drySinkM * 0.5) {
          surfaces.push({ height: tableY, kind: 'table' });
        }
      }
      const station = nearestRiverStation(x, z);
      if (station && river) {
        // The surface the eye can stand in, not the surveyed depth: the ribbon's
        // geometry is a film on the bed (`RIVER_FILM_LIFT_M`), so reporting
        // bed + 0.6 m made the camera "submerged" 0.58 m before it reached the
        // water and pushed the cavity clip's top that far above the rim.
        surfaces.push({
          height: surfaceYAt(x, z) + RIVER_FILM_LIFT_M,
          kind: 'river',
        });
      }
      // Highest first: the eye only cares about the surface directly over it.
      return surfaces.sort((a, b) => b.height - a.height);
    },
    waterColor: () => surfaceWater.deepColor,
    waterTableRange: () => {
      if (!table || table.heights.length === 0) return { min: 0, max: 0 };
      let min = Infinity;
      let max = -Infinity;
      for (const h of table.heights) {
        if (h < min) min = h;
        if (h > max) max = h;
      }
      return { min, max };
    },
    fillSurface: (depthM: number) => {
      grid.addRain(depthM, config);
    },
    resample: (sample: (x: number, z: number) => number) => {
      for (let z = 0; z < cells; z += 1) {
        for (let x = 0; x < cells; x += 1) {
          heights[z * cells + x] = sample(-extent + x * cellSize, -extent + z * cellSize);
        }
      }
      grid.clear();
      dampness.fill(0);
      rebuildGroundTexture();
      if (table) rebuildTableMesh();
    },
    setWaterTable: (field: WaterTableField) => {
      table = field;
      rebuildTableMesh();
      groundwaterMesh.visible = true;
    },
    update(params: WaterFieldUpdate): void {
      const { dt, elapsedSeconds } = params;
      if (!(dt > 0)) return;

      if (params.raining) grid.addRain(config.rainDepthPerS * dt, config);
      grid.step(dt, config);
      surfaceVolume = grid.totalVolumeM3();

      // Rain puddles: only where the water table is still under the ground, so
      // the standing table and the film never share a surface.
      const depthArray = depthAttr.array as Float32Array;
      let maxDepth = 0;
      // Dry cells sink well below the soil instead of sitting half a centimetre
      // under it: a coplanar sheet is exactly what the coarse grid produced, and
      // it flickered wherever a terrain triangle crossed it.

      for (let i = 0; i < heights.length; i += 1) {
        const ground = heights[i];
        const wx = -extent + (i % cells) * cellSize;
        const wz = -extent + Math.floor(i / cells) * cellSize;
        const tableY = tableAt(wx, wz);
        const tableBelow = tableY === null || tableY < ground - 0.05;
        const depth = tableBelow ? grid.depth[i] : 0;
        // A constant lift, not a per-vertex depth offset. Moving wet vertices up
        // and dry ones down made every triangle between them a slope that poked
        // through the soil as grid-shaped blue shards; the sheet now stays a
        // level film above the sampled ground and the fragment shader discards
        // the cells with no water in them.
        positionAttr.array[i * 3 + 2] = ground + config.surfaceLiftM;
        depthArray[i] = depth;
        if (depth > maxDepth) maxDepth = depth;
      }
      positionAttr.needsUpdate = true;
      depthAttr.needsUpdate = true;
      // Hysteresis on the depth actually present, not on a volume that hovers
      // around a threshold while the last puddle dries: that threshold made the
      // whole sheet blink in and out.
      const showAboveM = 0.004;
      const hideBelowM = 0.0015;
      surfaceMesh.visible = surfaceMesh.visible ? maxDepth > hideBelowM : maxDepth > showAboveM;

      updateWetGround(dt);

      for (const water of allWaters()) {
        if (!water) continue;
        water.material.uniforms.uNearDiscard.value = config.nearDiscardM;
        water.material.uniforms.uMinVisibleDepth.value = config.minVisibleDepthM;
        water.material.uniforms.uTime.value = elapsedSeconds;
        (water.material.uniforms.uSunDir.value as THREE.Vector3).copy(params.sunDir);
        (water.material.uniforms.uSunColor.value as THREE.Color).copy(params.sunColor);
        // The sky a puddle reflects here is pale even under rain. Reflecting the
        // raw storm horizon turned every puddle into a near-black stain; half a
        // step towards a fixed sky tint keeps water reading as water while it
        // still darkens with the weather.
        (water.material.uniforms.uSkyColor.value as THREE.Color)
          .copy(params.skyColor)
          .lerp(skyTintColor(), 0.4);
      }
    },
  };

  /**
   * River station nearest a world point, when that point is actually in the
   * channel. The ribbon is only drawn within half its width of the centre line,
   * so a point further out is on the bank, not under the stream.
   */
  function nearestRiverStation(x: number, z: number): RiverStation | null {
    if (!river || river.stations.length === 0) return null;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    let best: RiverStation | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const station of river.stations) {
      const dx = station.x - x;
      const dz = station.z - z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = station;
      }
    }
    if (!best) return null;
    const reach = Math.max(0.5, river.halfWidthM * 0.92);
    return Math.sqrt(bestDistance) <= reach ? best : null;
  }

  /** Nearest table height, or null when the sample is outside the grid. */
  function tableAt(x: number, z: number): number | null {
    if (!table) return null;
    const i = Math.floor((x - table.originX) / table.cellSizeM);
    const j = Math.floor((z - table.originZ) / table.cellSizeM);
    if (i < 0 || j < 0 || i >= table.cells || j >= table.cells) return null;
    return table.heights[j * table.cells + i];
  }
}

/** Colour water is lifted towards, so overcast reflections stay legible. */
let skyTint: THREE.Color | null = null;
const skyTintColor = () => (skyTint ??= worldColour('water_shallow'));
