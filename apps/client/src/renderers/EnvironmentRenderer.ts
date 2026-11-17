/**
 * C03 Environment Renderer
 *
 * The day/night and weather view of the world. This class owns the per-frame
 * update order and the public API; each piece of scenery lives in
 * `renderers/environment/`:
 *
 * - `skyDome.ts`           gradient dome, stars, clouds, sun and moon discs
 * - `rainSystem.ts`        instanced rain streaks
 * - `ground.ts`            terrain plane, soil shader, earth dome
 * - `resourceGrid.ts`      per-tile light/moisture/mineral texture
 * - `celestial.ts`         sun/moon path and lighting grade
 * - `weatherPresets.ts`    what each weather state looks like
 * - `rootSightUniforms.ts` the cutaway values shared with the plant renderer
 */

import { riverPath } from '@plant-legacy/shared/world';
import * as THREE from 'three';
import type { RenderConfig } from '../config/clientConfig.js';
import type { ClientWeatherState, ClientWeatherStateMachine } from './ClientWeatherStateMachine.js';
import { type AtmosphereParams, atmosphereFromConfig } from './environment/atmosphere.js';

/**
 * Sun + ambient + sky fill at midday, measured in-game (sun elevation 0.52 with
 * intensity 0.63, ambient 0.60, hemisphere 0.30). The dug wall's brightness is
 * scaled against this, so 1.0 means "as bright as it is at noon".
 */
const CAVITY_DAYLIGHT_REFERENCE = 1.08;

import {
  createCavityBowl,
  createCavitySeam,
  setCavityBowlLight,
  updateCavityBowl,
  updateCavitySeam,
} from './environment/cavity/index.ts';
import {
  applyCelestialLighting,
  type CelestialBodies,
  stepAmbientLighting,
  updateCelestialBodies,
} from './environment/celestial.js';
import {
  createGround,
  getGroundShader,
  setGroundAtmosphere,
  setGroundMoisture,
  setRiverBankDamping,
  setWaterTableDamping,
  updateGroundFill,
  updateGroundSun,
} from './environment/ground.js';
import { createOcean, type Ocean } from './environment/ocean.js';
import { planetTerrainY } from './environment/planetSurface.js';
import { createRainSystem, type RainSystem } from './environment/rainSystem.js';
import {
  createResourceGrid,
  DEFAULT_TILE_NORMALIZATION,
  type ResourceGrid,
  type ResourceTile,
  type TileNormalization,
} from './environment/resourceGrid.js';
import type { RootSightUniforms } from './environment/rootSightUniforms.js';
import { createSkyDome, type SkyDome } from './environment/skyDome.js';
import {
  sampleUnderwater,
  type UnderwaterState,
  underwaterFog,
  underwaterSunIntensity,
} from './environment/underwater.js';
import {
  createRiverMask,
  createWaterField,
  type WaterField,
  type WaterFieldTuning,
  type WaterTableField,
} from './environment/waterField.js';
import {
  DEFAULT_WATER_COLORS,
  DEFAULT_WATER_FIELD_TUNING,
} from './environment/waterFieldTuning.js';
import { createEnvironmentWeatherMachine } from './environment/weatherPresets.js';
import { getTerrainParams } from './terrain/terrainState.js';

export type { RootSightUniforms as EnvironmentUniforms } from './environment/rootSightUniforms.js';

/** Fallback day/night cycle when the server value could not be loaded. */
const DEFAULT_DAY_LENGTH_SECONDS = 3600;

/**
 * Everything the environment needs from config that is not in `render.json`.
 *
 * Grouped instead of added as more positional constructor arguments: the owner
 * (main.ts) loads these from their own config files.
 */
export interface EnvironmentTuning {
  showGround?: boolean;
  showRain?: boolean;
  /** Full day + night cycle in seconds (config/daynight.json cycle_length_s). */
  dayLengthSeconds?: number;
  /** Surface hydrology and groundwater field (config/water.json). */
  water?: Partial<WaterFieldTuning>;
  /** Tile ranges the soil shader normalises against (config/resources.json). */
  tiles?: TileNormalization;
}

export interface WeatherPayload {
  timeOfDay: number;
  isDay: boolean;
  sunIntensity: number;
  weatherState: string;
  conditionToken: string;
  stateTimeRemainingS: number;
  forecast?: {
    nextWeatherState: string;
    timeUntilNextStateS: number;
  };
}

export class EnvironmentRenderer {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private config: RenderConfig;

  // Weather state machine (explicit transitions)
  private weatherMachine: ClientWeatherStateMachine;

  // Sky, rain, ground
  private readonly sky: SkyDome;
  private readonly rain: RainSystem;
  private readonly groundMaterial: THREE.MeshStandardMaterial;
  private groundMesh: THREE.Mesh | null;
  /** Metre-scale ground patches, exposed so physics can collide with the relief. */
  terrainMeshes: THREE.Mesh[] = [];
  /**
   * Coarse ground shells behind the detailed play-area patch: the distant planet
   * body and the outer LOD ring. A buried eye sees them as nested dark backfaces,
   * so they are hidden while underground; the detail patch and cavity bowl are
   * then the single dirt surface around the camera.
   */
  private readonly surfaceShells: THREE.Mesh[] = [];
  /** The base planet sphere; its detail patches are children and stay visible. */
  private planetBodyMesh: THREE.Mesh | null = null;
  private planetBodyDrawCount = 0;
  // The cavity as real geometry: a dug bowl of earth under the opening.
  private cavityBowl: THREE.Mesh | null = null;
  private cavitySeam: THREE.Mesh | null = null;
  // The soil's cut face at the aperture boundary, so the skin's edge is not a
  // see-through line with nothing behind it.
  /** Surface puddles and groundwater pools (config/water.json). */
  private waterField: WaterField | null = null;
  /** The planet-wide sea: one sphere at sea level, shared with the field's water. */
  private ocean: Ocean | null = null;
  private readonly waterTuning: Partial<WaterFieldTuning>;
  /** How full the local soil cavity is, 0 dry .. 1 saturated (from the server). */
  private groundwaterFraction = 0;
  /**
   * Being under a water surface, refreshed by the caller each frame. Water used
   * to be a surface effect only: the camera could swim through the river and see
   * the same air, fog and sun as on the bank.
   */
  private underwater: UnderwaterState | null = null;
  private readonly underwaterTint = new THREE.Color(0x0d2a33);
  /** Height ramp of the water table, read by the soil shader. */
  private waterTableTexture: THREE.DataTexture | null = null;
  private waterTableData: Uint8Array | null = null;
  /** Seconds since start, for ripple animation. */
  private elapsedSeconds = 0;
  private planetRadiusM = 0;
  private readonly planetCenter = new THREE.Vector3();
  private readonly resourceGrid: ResourceGrid;
  private readonly tiles: TileNormalization;
  private readonly dayLengthSeconds: number;
  /** Dev control: stop the clock so a set time stays put. */
  private timeFrozen = false;
  /** Dev control: multiplier on how fast the clock runs. */
  private timeScale = 1;

  private soilMoisture = 0.2;

  /**
   * AL-04: the one air model for this session. The ground shader reads it every
   * frame and the plant renderer is handed the same object, so both agree.
   */
  private readonly atmosphere: AtmosphereParams;

  /** Current soil moisture (0 dry .. 1 saturated) for passes that tint the ground. */
  getSoilMoisture(): number {
    return this.soilMoisture;
  }

  // Root Sight: a camera-facing corridor cut through the soil.
  private readonly soilUniforms: RootSightUniforms;

  private readonly undergroundColor = new THREE.Color('#241d16');
  // Dug-earth colour for the Root Sight cavity wall and rim. The cavity itself
  // is drawn by the soil shader, so this is the only cavity state left here.
  private readonly cavityWallColor = new THREE.Color();

  // Celestial lighting
  private readonly sunLight: THREE.DirectionalLight;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly hemisphereLight: THREE.HemisphereLight;
  private readonly bodies: CelestialBodies = {
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
  };

  // Lightning bookkeeping for the storm. The baseline is the ambient level the
  // day/night cycle smooths to; the strike is a separate per-frame addition so
  // it can never be lerped into the baseline and outlive the flash.
  private ambientBaseline = 0;
  private lightningIntensity = 0;

  // Time of day and sun intensity (client-side interpolation)
  private timeOfDay = 0.3;
  private sunIntensity = 1.0;

  // Local tile light drives the sky grade. tile_light_base in
  // config/resources.json is 80, so 80 = full daylight and 0 = full shade.
  private localTileLight = 80;
  private readonly localZenithTarget: THREE.Color = new THREE.Color();
  private readonly localHorizonTarget: THREE.Color = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    config: RenderConfig,
    sunLight: THREE.DirectionalLight,
    ambientLight: THREE.AmbientLight,
    hemisphereLight: THREE.HemisphereLight,
    soilUniforms: RootSightUniforms,
    tuning: EnvironmentTuning = {},
  ) {
    this.scene = scene;
    this.atmosphere = atmosphereFromConfig(config);
    this.camera = camera;
    this.config = config;
    this.tiles = tuning.tiles ?? DEFAULT_TILE_NORMALIZATION;
    this.dayLengthSeconds = tuning.dayLengthSeconds ?? DEFAULT_DAY_LENGTH_SECONDS;
    this.waterTuning = tuning.water ?? {};
    this.undergroundColor.set(config.undergroundViewColor);
    this.soilUniforms = soilUniforms;
    this.sunLight = sunLight;
    this.ambientLight = ambientLight;
    this.hemisphereLight = hemisphereLight;
    // Start the smoother from the light's current value rather than from zero,
    // so the first frame does not dim the scene on its way to the target.
    this.ambientBaseline = ambientLight.intensity;

    this.weatherMachine = createEnvironmentWeatherMachine(config);

    // 1. Sky dome, centred on the camera so it reads as infinite sky.
    this.sky = createSkyDome(scene, camera, config, this.bodies.sunDir, this.bodies.moonDir);

    // 1b. Root Sight: the cavity is drawn by the soil shader itself (marching
    //     the fused node bubbles), so all this layer keeps is the dug-earth
    //     colour it shades the interior wall and rim with.
    // The earth inside the opening, in the bowl's own dug-soil palette. This was
    // `undergroundViewColor * 1.9`, a pale tan that the soil shader faded its rim
    // into: that is the light band that read as a ring around and inside the
    // cavity's lip from above, which no crater has.
    this.cavityWallColor.set(config.soilWetColor).multiplyScalar(0.9);
    this.soilUniforms.uRootSightWallColor.value.copy(this.cavityWallColor);

    // 2. Terrain and the Root Sight cutaway.
    const ground = createGround(scene, config, soilUniforms, tuning.showGround ?? true);
    this.groundMaterial = ground.material;
    this.groundMesh = ground.mesh;
    this.terrainMeshes = ground.terrainMeshes;
    ground.mesh?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.name === 'planet-surface') {
        // Do not put the body in surfaceShells and do not clear its layers:
        // the renderer stops traversing a mesh's children when the parent's
        // visibility/layers fail, which also hid planet-terrain-detail. Emptying
        // only the body's draw range leaves the child patch in the scene.
        this.planetBodyMesh = object;
        this.planetBodyDrawCount =
          object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0;
      } else if (object.name === 'planet-terrain-far') {
        this.surfaceShells.push(object);
      }
    });

    // 2a. The earth inside the Root Sight opening. Real geometry instead of
    //     shading faked in the soil shader, so the pit has parallax and looks
    //     the same from every angle. Built once at unit radius, scaled per frame.
    if (tuning.showGround ?? true) {
      // Dug earth is the *dry* soil the surface is made of, a shade into the
      // subsoil. This used to be the wet-soil tone (near black after rain)
      // multiplied down again, and the unlit bowl then read as a void rather
      // than as dirt someone had dug through.
      const dugTopsoil = new THREE.Color(config.soilDryColor).multiplyScalar(0.86);
      const dugSubsoil = new THREE.Color(config.soilDryColor).multiplyScalar(0.62);
      this.cavityBowl = createCavityBowl(dugTopsoil, dugSubsoil);
      scene.add(this.cavityBowl);
      // The seam collar: hangs off the bowl's own rim ring, at the ground, in the
      // bowl's own tone. Sharing that ring vertex for vertex is what leaves no
      // slot for sky to leak through at any angle. It is deliberately darker than
      // the wall: at the lip it should read as the shadow under the overhang, not
      // as the pale line it used to draw under the ground.
      this.cavitySeam = createCavitySeam(this.cavityBowl, dugTopsoil.clone().multiplyScalar(0.74));
      scene.add(this.cavitySeam);
      // Water is scenery, not a Root Sight effect: rain lands on the ground and
      // runs into hollows, and the soil holds pools in pockets of its own all
      // over the place. Both are built here from the tuned hydrology.
      const terrainParams = getTerrainParams();
      // The route is surveyed from the terrain itself (D8 flow accumulation), so
      // the river runs down the valleys the hills define. Client and server call
      // the same function on the same field, so the drawn bank is the carved bed.
      const surveyedRiver = terrainParams.riverEnabled ? riverPath(terrainParams) : null;
      const riverLengthM = Math.max(40, terrainParams.riverLengthM ?? 320);
      const riverMask = surveyedRiver
        ? createRiverMask(
            surveyedRiver,
            Math.min(320, riverLengthM * 0.5 + 60),
            512,
            this.waterTuning.riverClipMarginM ?? 0.5,
          )
        : null;
      if (riverMask) {
        setRiverBankDamping(this.groundMaterial, {
          mask: riverMask,
          strength: (this.waterTuning.wetGroundOpacity ?? 0.35) * 0.8,
        });
      }
      const planetRadius = config.planetRadiusM;
      // The terrain is drawn as two meshes, so the water's underground test uses
      // both: the detail patch's own cell size and radius near the player, and
      // the far ring's past its edge. These are the meshes, not a guess at them.
      const innerSegments = Math.max(16, config.terrainMeshSubdivisions || 256);
      const innerRadiusM = Math.min(180, terrainParams.patchRadiusM * 2);
      const innerCellM = (innerRadiusM * 2) / innerSegments;
      const farSegments = Math.max(24, Math.round(innerSegments * 0.6));
      const farCellM = (Math.max(20, terrainParams.patchRadiusM) * 2) / farSegments;
      this.waterField = createWaterField(
        (x, z) => planetTerrainY(planetRadius, x, z, getTerrainParams()),
        {
          ...this.waterTuning,
          groundTestCellM: farCellM,
          groundTestFineCellM: innerCellM,
          groundTestFineRadiusM: innerRadiusM,
        },
        // Wet ground is the same colour the soil shader uses for wetness, taken
        // a step darker: soil in contact with standing water is waterlogged.
        new THREE.Color(config.soilWetColor).multiplyScalar(0.55),
        surveyedRiver && riverMask
          ? {
              stations: surveyedRiver.stations,
              halfWidthM: surveyedRiver.halfWidthM,
              waterDepthM: surveyedRiver.waterDepthM,
              flowMps: Math.max(0, terrainParams.riverFlowSpeedMps ?? 0),
              mask: riverMask,
            }
          : null,
        // The water's own colours: body, shallow end, reflection. Data, so the
        // underwater tint and the sheet it comes from are one value.
        this.waterTuning.colors ?? DEFAULT_WATER_COLORS,
      );
      scene.add(this.waterField.group);
    }
    // The cavity bowl is the only underground backdrop. There used to be a
    // second, concentric "subsoil" sphere below the ground as well; from above
    // it showed through the opening as another shell, which is what made the
    // terrain read as layered onion paper instead of one mass of dirt.
    if (config.planetRadiusM > 0) {
      this.planetRadiusM = config.planetRadiusM;
      this.planetCenter.set(0, -config.planetRadiusM, 0);
      // 2b. The planet-wide sea, on the body's own centre so its level is one
      // sphere for the whole world. The puddles, the stream and the water table
      // are local detail on top of it; this is the water that has to be
      // somewhere, everywhere, with no edge.
      if (this.waterTuning.oceanEnabled ?? true) {
        this.ocean = createOcean(
          config.planetRadiusM,
          this.waterTuning.seaLevelM ?? DEFAULT_WATER_FIELD_TUNING.seaLevelM,
          this.waterTuning.colors ?? DEFAULT_WATER_COLORS,
          // Its own bed field, wide enough to cover the shore the player can see:
          // the water field's grids stop well inside the plateau rim.
          (x, z) => planetTerrainY(config.planetRadiusM, x, z, getTerrainParams()),
          this.waterTuning,
        );
        scene.add(this.ocean.mesh);
        this.waterField?.attachOcean(this.ocean.material);
      }
    }
    this.resourceGrid = createResourceGrid(() => getGroundShader(this.groundMaterial), this.tiles);

    // 3. Rain.
    this.rain = createRainSystem(scene, config, tuning.showRain ?? true);

    // Initial weather state and lighting, before the first render.
    this.weatherMachine.requestStateChange('clear');
    this.updateSunPosition();
  }

  /**
   * Dev diagnostic: the rain field's actual draw state. "It is raining but I
   * see nothing" is otherwise indistinguishable from "the field is hidden" and
   * from "the streaks are too small to see", and the three need different fixes.
   */
  public getRainDebug(): Record<string, number | boolean> {
    const geometry = this.rain.mesh.geometry as THREE.InstancedBufferGeometry;
    const lengths = geometry.getAttribute('aLength') as THREE.InstancedBufferAttribute | undefined;
    return {
      visible: this.rain.mesh.visible,
      inScene: this.rain.mesh.parent === this.scene,
      instances: geometry.instanceCount,
      width: this.rain.material.uniforms.uWidth?.value ?? -1,
      opacity: this.rain.material.uniforms.uOpacity?.value ?? -1,
      slant: this.rain.material.uniforms.uSlant?.value ?? -1,
      firstLength: lengths ? lengths.getX(0) : -1,
      time: this.rain.material.uniforms.uTime?.value ?? -1,
      machineRaining: this.weatherMachine.isRaining(),
      transitioning: this.weatherMachine.isTransitioning(),
    };
  }

  /** Terrain identity of the last water-sheet sample, so a late config reload
   *  re-seats the water on the ground that is actually drawn. */
  private waterTerrainKey = '';

  /** Dev: flood the surface sheet so the water rendering can be inspected. */
  public debugFillSurface(depthM: number): void {
    this.waterField?.fillSurface(depthM);
  }

  /** Dev diagnostic: how much water the world currently shows. */
  public getWaterDebug(): Record<string, number | boolean> {
    if (!this.waterField) return { enabled: false };
    const table = this.waterField.waterTableRange();
    return {
      enabled: true,
      surfaceVolumeM3: this.waterField.surfaceVolumeM3(),
      tableMinY: table.min,
      tableMaxY: table.max,
      groundwaterFraction: this.groundwaterFraction,
      rootSightProgress: this.soilUniforms.uRootSightProgress.value,
    };
  }

  /** Apply the server's per-tile water-table height field. */
  public setWaterTable(field: WaterTableField): void {
    // The server's table is a subsurface field, and nothing stops it standing
    // above the local ground. Drawn as-is, that put a sheet 0.6 m under the
    // terrain across the whole play area and painted every slope as waterlogged:
    // from above it read as an ocean that flickered in and out. The *displayed*
    // table is clamped just under the terrain; the simulation keeps its own
    // heights, and standing water is the surface sheet's job.
    const clamped = this.clampTableToTerrain(field);
    this.waterField?.setWaterTable(clamped);
    this.pushWaterTableToSoil(clamped);
  }

  /** A copy of the table with every cell pulled just under the drawn ground. */
  private clampTableToTerrain(field: WaterTableField): WaterTableField {
    const cells = Math.round(field.cells);
    if (cells <= 0 || field.heights.length < cells * cells) return field;
    const terrain = getTerrainParams();
    const heights = new Float32Array(field.heights.length);
    let clampedAny = false;
    for (let i = 0; i < heights.length; i += 1) {
      const x = field.originX + (i % cells) * field.cellSizeM;
      const z = field.originZ + Math.floor(i / cells) * field.cellSizeM;
      const ceiling = planetTerrainY(this.planetRadiusM, x, z, terrain) - 0.05;
      const height = field.heights[i];
      if (height > ceiling) {
        heights[i] = ceiling;
        clampedAny = true;
      } else {
        heights[i] = height;
      }
    }
    return clampedAny ? { ...field, heights } : field;
  }

  /**
   * Rebuild the soil shader's water-table height ramp.
   *
   * Heights become an 8-bit ramp over the field's own range (about 3 cm per
   * step), which filters linearly and keeps the waterline smooth where a pit
   * wall crosses it. The soil shader darkens everything below that line, so the
   * wet ground follows the water into pits and tunnels as well as across the
   * surface.
   */
  private pushWaterTableToSoil(field: WaterTableField): void {
    const cells = Math.round(field.cells);
    if (cells <= 0 || field.heights.length < cells * cells) return;

    let min = Infinity;
    let max = -Infinity;
    for (const height of field.heights) {
      if (height < min) min = height;
      if (height > max) max = height;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    // Padding keeps the extremes off the ends of the ramp, so a table that sits
    // exactly at the field's minimum is still distinguishable from "no sample".
    const pad = Math.max(0.25, (max - min) * 0.05);
    min -= pad;
    const spanY = Math.max(0.5, max + pad - min);

    if (!this.waterTableTexture || this.waterTableData?.length !== cells * cells * 4) {
      this.waterTableData = new Uint8Array(cells * cells * 4);
      const texture = new THREE.DataTexture(
        this.waterTableData,
        cells,
        cells,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      this.waterTableTexture = texture;
    }

    const data = this.waterTableData;
    const texture = this.waterTableTexture;
    if (!data || !texture) return;
    for (let i = 0; i < cells * cells; i += 1) {
      const normalised = Math.max(0, Math.min(1, (field.heights[i] - min) / spanY));
      data[i * 4] = Math.round(normalised * 255);
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }
    texture.needsUpdate = true;

    setWaterTableDamping(this.groundMaterial, {
      texture,
      originX: field.originX,
      originZ: field.originZ,
      cellSizeM: field.cellSizeM,
      cells,
      minY: min,
      spanY,
      strength: this.waterTuning.wetGroundOpacity ?? 0.35,
      dampBandM: this.waterTuning.wetBandAboveTableM ?? 0.6,
    });
  }

  /** How full the local soil cavity is (0 dry .. 1 saturated). */
  public setGroundwaterLevel(fraction: number): void {
    if (!Number.isFinite(fraction)) return;
    this.groundwaterFraction = Math.min(1, Math.max(0, fraction));
  }

  /**
   * Dev control: change the weather now. The server is the authority and pushes
   * the same state to every client on its next broadcast; this only removes the
   * round-trip so the select does not look inert.
   */
  public setWeatherState(state: string): void {
    this.weatherMachine.requestStateChange(state as ClientWeatherState);
  }

  /** Set the full resource grid from the server for per-tile ground lighting. */
  public setResourceGrid(
    tiles: ResourceTile[],
    width: number,
    height: number,
    tileSize: number,
  ): void {
    if (!this.groundMesh) return;
    this.resourceGrid.setFull(tiles, width, height, tileSize);
  }

  /** Update only changed (dirty) tiles in the resource grid. */
  public updateResourceGrid(tiles: ResourceTile[]): void {
    if (!this.groundMesh) return;
    this.resourceGrid.updateDirty(tiles);
  }

  /**
   * Apply a whole-grid update sent as a base64 buffer of three 0-255 channels
   * (light, moisture, minerals) per tile, row-major over the grid.
   */
  public updateResourceGridQuantized(
    base64: string,
    width: number,
    height: number,
    tileSize: number,
  ): void {
    if (!this.groundMesh) return;
    this.resourceGrid.setQuantized(base64, width, height, tileSize);
  }

  /**
   * Feed the average light of the plant's local tiles into the sky grade.
   * Called from RESOURCE_UPDATE with the averaged root-tile light.
   */
  public setLocalTileLight(light: number): void {
    if (!Number.isFinite(light)) return;
    this.localTileLight = Math.max(0, light);
  }

  /** Apply a server weather update. */
  public handleWeatherUpdate(payload: WeatherPayload): void {
    // A held clock must not be dragged back to the server's time on every
    // broadcast: the dev panel's Time field looked like it did nothing because
    // the next weather update (about once a second) reverted it immediately.
    if (!this.timeFrozen) this.timeOfDay = payload.timeOfDay;
    this.sunIntensity = payload.sunIntensity;

    this.weatherMachine.requestStateChange(payload.weatherState as ClientWeatherState);
  }

  /**
   * Tell the renderer how much water is over the camera, and what colour it is.
   *
   * Sampling stays with the caller (the water field owns the surfaces); this
   * only applies the consequences: tinted, shortened fog and dimmed sunlight.
   */
  public setUnderwater(state: UnderwaterState | null, tint?: THREE.Color): void {
    this.underwater = state?.submerged ? state : null;
    if (tint) this.underwaterTint.copy(tint);
  }

  /** The water state currently applied, for the dev readout. */
  public getUnderwater(): UnderwaterState | null {
    return this.underwater;
  }

  /**
   * Sample the water over the camera and adopt it as this frame's view.
   *
   * The water field owns the surfaces and the camera owns the eye, so the answer
   * has to be taken here rather than hand-assembled by the caller. A camera that
   * is merely damp - standing in a puddle up to the ankles - is above the
   * surface and stays in air.
   */
  private sampleUnderwaterView(): void {
    const field = this.waterField;
    if (!field) {
      this.underwater = null;
      return;
    }
    const eye = this.camera.position;
    const surfaces = field.waterSurfacesAt(eye.x, eye.z);
    // The sea is the one surface the field does not own: it is the planet's
    // curvature, not a sheet on the ground, so it is sampled here and appended
    // to the same list. Without it a step into the ocean read as a walk, with
    // clear air and a sky instead of water over the eye.
    if (this.ocean) {
      surfaces.push({ height: this.ocean.seaSurfaceYAt(eye.x, eye.z), kind: 'sea' });
    }
    const state = sampleUnderwater(eye.y, surfaces);
    if (!state.submerged) {
      this.underwater = null;
      return;
    }
    this.underwater = state;
    this.underwaterTint.copy(field.waterColor());
  }

  /** Per-frame render loop update. */
  public update(dt: number, devOverrideUntil = 0): void {
    const lerpRate = Math.min(1.0, dt * 2.5);
    this.sampleUnderwaterView();

    // Advance client timeOfDay (server is authority, client interpolates) unless
    // a dev override is holding the clock.
    if (!this.timeFrozen && Date.now() >= devOverrideUntil) {
      this.timeOfDay = (this.timeOfDay + (dt * this.timeScale) / this.dayLengthSeconds) % 1.0;
    }

    const weatherTargets = this.weatherMachine.update(dt, this.timeOfDay, this.sunIntensity);

    // The weather machine emits a normalised, already-fading strike. Hand it to
    // the celestial pass, which composes baseline + flash in one assignment.
    this.lightningIntensity = Math.max(0, weatherTargets.lightningIntensity);
    this.updateSunPosition(dt);

    // The sky dome is camera-centred, so it never warps as the camera moves.
    this.sky.mesh.position.copy(this.camera.position);

    // Root Sight is entirely a soil-shader effect: no backdrop sphere, no
    // separate cavity mesh, nothing to draw behind the terrain. The sky stays
    // on even under the surface — the ground encloses the camera, so the only
    // place sky can appear is through the opening, which is exactly what
    // looking up out of the hole should show.
    this.sky.mesh.visible = true;
    // Only the sky grade needs to know the eye went under the surface; the
    // ground and cavity bowl are the surrounding dirt. Measuring radially from
    // the planet centre keeps it correct anywhere on the planet.
    if (this.planetRadiusM > 0) {
      // Compare with the drawn terrain height, not the bare sphere. The relief
      // can be metres above the sphere, so a camera below a hill was still
      // classified as above ground: the sky painted under it and every ground
      // shell stayed visible, producing the nested "layers of hell".
      const terrain = getTerrainParams();
      const surfaceY = planetTerrainY(
        this.planetRadiusM,
        this.camera.position.x,
        this.camera.position.z,
        terrain,
      );
      const eyeUnder = this.camera.position.y < surfaceY - 0.02;
      const skyUniforms = this.sky.material.uniforms;
      if (skyUniforms?.uEyeUnderGround) {
        skyUniforms.uEyeUnderGround.value = eyeUnder ? 1 : 0;
      }
      const groundUniforms = this.groundMaterial.userData.shader?.uniforms;
      if (groundUniforms?.uEyeUnderGround) {
        groundUniforms.uEyeUnderGround.value = eyeUnder ? 1 : 0;
      }
      this.updatePlanetBodyVisibility(eyeUnder);
    }
    this.elapsedSeconds += dt;
    if (this.cavityBowl) {
      const terrain = getTerrainParams();
      // Deepest root bubble the cavity has to hold. Each node carries its own
      // radius in w, so the bottom of a root is y - w * progress; the bowl's
      // floor is placed below it rather than at a fraction of the mouth.
      const cavityNodes = this.soilUniforms.uRootSightNodes.value;
      const cavityProgress = this.soilUniforms.uRootSightProgress.value;
      const cavityNodeCount = Math.min(
        cavityNodes.length,
        Math.max(0, this.soilUniforms.uRootSightNodeCount.value),
      );
      let deepestRootY: number | undefined;
      for (let i = 0; i < cavityNodeCount; i += 1) {
        const bottom = cavityNodes[i].y - cavityNodes[i].w * cavityProgress;
        if (deepestRootY === undefined || bottom < deepestRootY) deepestRootY = bottom;
      }
      updateCavityBowl(
        this.cavityBowl,
        this.soilUniforms.uRootSightCenter.value,
        this.soilUniforms.uRootSightRadius.value,
        this.soilUniforms.uRootSightProgress.value,
        (x, z) => planetTerrainY(this.planetRadiusM, x, z, terrain),
        this.camera.position,
        this.soilUniforms.uRootSightApertureRadius.value,
        deepestRootY,
      );
      if (this.cavitySeam) {
        // After the bowl, from the bowl: the collar hangs off the rim ring the
        // bowl just conformed, so the two cannot disagree about the mouth.
        updateCavitySeam(this.cavitySeam, this.cavityBowl, (x, z) =>
          planetTerrainY(this.planetRadiusM, x, z, terrain),
        );
      }
      // Water inside the opening would cover the roots with a dark disc, and
      // the water table stands above the cavity floor. Root Sight is a
      // cut-away, so water is clipped out of the same volume the soil shader
      // removes - not by a separate guess: the water shader reads these three
      // uniforms directly, so water and soil cannot disagree about the opening.
      if (this.waterField) {
        // The plan column only. Height is deliberately not part of it: the cut
        // is a cut-away, so any water surface inside the opening hides the roots
        // and reads as water seen through the ground - including a lake lapping
        // above a shore pit, and the water table standing below the pit floor.
        //
        // Only while the cavity is actually open: this ran whenever a bowl
        // existed, so with Root Sight shut the water still lost a disc the size
        // of the aperture around the plant - a silhouette of the opening cut out
        // of any lake the player stood beside.
        const cavityOpen = this.soilUniforms.uRootSightProgress.value > 0.001;
        this.waterField.setCavityClip(
          this.soilUniforms.uRootSightCenter.value.x,
          this.soilUniforms.uRootSightCenter.value.z,
          cavityOpen ? this.soilUniforms.uRootSightApertureRadius.value : 0,
        );
      }
      // Water is environment, not a Root Sight ornament: the surface sheet and
      // the soil pools run their own hydrology here, so leaving Root Sight no
      // longer leaves the world dry.
      if (this.waterField) {
        // `/config/terrain` arrives after the renderer is built. Until then the
        // sheet was sampled from the default field and floated (or sank) the
        // moment the real relief loaded, so the water showed up as dark blotches
        // instead of a surface. Re-sample once per terrain identity.
        const terrainKey = `${terrain.seed}|${terrain.amplitudeM}|${terrain.baseFrequency}|${terrain.octaves}`;
        if (terrainKey !== this.waterTerrainKey) {
          this.waterTerrainKey = terrainKey;
          this.waterField.resample((x, z) => planetTerrainY(this.planetRadiusM, x, z, terrain));
        }
        this.waterField.update({
          dt,
          elapsedSeconds: this.elapsedSeconds,
          raining: weatherTargets.isRaining,
          sunDir: this.bodies.sunDir,
          sunColor: this.sunLight.color,
          skyColor: this.sky.horizonColor,
        });
      }
    }
    this.soilUniforms.uRootSightCamera.value.copy(this.camera.position);

    // 1. Interpolate sky colours from the weather targets, graded by the light
    //    actually reaching the plant's local tiles.
    //    0 light = deep shade/night, 80 (tile_light_base) = full daylight.
    const localLight01 = THREE.MathUtils.clamp(
      this.localTileLight / this.tiles.tileLightBase,
      0,
      1.5,
    );
    const localBrightness =
      0.55 + 0.45 * Math.min(1, localLight01) + Math.max(0, localLight01 - 1) * 0.25;
    this.localZenithTarget.copy(weatherTargets.zenithColor).multiplyScalar(localBrightness);
    this.localHorizonTarget.copy(weatherTargets.horizonColor).multiplyScalar(localBrightness);
    this.sky.zenithColor.lerp(this.localZenithTarget, lerpRate);
    this.sky.horizonColor.lerp(this.localHorizonTarget, lerpRate);
    // The sky shader's zenith/horizon uniforms hold these same Color instances,
    // so they follow the lerp without a second per-frame copy.
    this.hemisphereLight.color.copy(this.sky.zenithColor);
    this.hemisphereLight.groundColor.copy(this.sky.horizonColor);

    // 2. Atmospheric fog follows the horizon, pulled in when the camera is in
    //    the water: light scatters out within a couple of metres, so the far
    //    bank disappears while the surface overhead stays visible.
    const underwater = this.underwater;
    const fogTargets = underwater
      ? underwaterFog({ near: weatherTargets.fogNear, far: weatherTargets.fogFar }, underwater)
      : { near: weatherTargets.fogNear, far: weatherTargets.fogFar };
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = THREE.MathUtils.lerp(this.scene.fog.near, fogTargets.near, lerpRate);
      this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, fogTargets.far, lerpRate);
      this.scene.fog.color.lerp(this.sky.horizonColor, lerpRate);
      if (underwater) this.scene.fog.color.lerp(this.underwaterTint, underwater.amount * 0.55);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(this.sky.horizonColor, lerpRate);
    }

    // 3. Soil moisture tint and the sun frame fed to the soil shader.
    this.soilMoisture = THREE.MathUtils.lerp(
      this.soilMoisture,
      weatherTargets.soilMoisture,
      dt * 0.5,
    );
    // AL-04: distance fog comes from one model, shared with the plant shader.
    setGroundAtmosphere(this.groundMaterial, this.atmosphere);
    setGroundMoisture(this.groundMaterial, this.soilMoisture);
    updateGroundSun(
      this.groundMaterial,
      this.bodies.sunDir,
      this.sunLight.color,
      this.sunLight.intensity,
    );
    updateGroundFill(
      this.groundMaterial,
      this.hemisphereLight.color,
      Math.max(0.38, this.hemisphereLight.intensity * 0.9),
    );
    this.updateCavityLight();

    // 4. Root Sight envelope nodes are uploaded by the main loop (it owns the
    //    plant mirrors); this layer only sizes and places the dirt backdrop.

    // 5. Rain: instance positions come from the vertex shader, so the CPU only
    //    advances the clock and keeps the field around the viewer.
    if (weatherTargets.isRaining) {
      this.rain.setVisible(true);
      this.rain.follow(this.camera.position);
      this.rain.advance(dt);
    } else {
      this.rain.setVisible(false);
    }

    // 6. Lightning is composed into the ambient baseline by updateSunPosition,
    //    so there is no per-frame accumulation here.
  }

  /**
   * Show the planet body and the far LOD ring only when the eye is above soil.
   *
   * Keep the detailed play-area patch visible as the dirt ceiling around a
   * buried eye. The base sphere draws no triangles from below, but its children
   * are still traversed, so the detail patch remains the enclosing dirt. The
   * outer LOD ring is hidden normally because it has no children.
   *
   * One helper, called once per frame: the draw range and the shell visibility
   * used to be two separate statements that a later edit could leave disagreeing,
   * which shows up as a hollow horizon under a burrowed camera.
   */
  private updatePlanetBodyVisibility(eyeUnder: boolean): void {
    if (this.planetBodyMesh) {
      this.planetBodyMesh.geometry.setDrawRange(0, eyeUnder ? 0 : this.planetBodyDrawCount);
    }
    for (const shell of this.surfaceShells) shell.visible = !eyeUnder;
  }

  /**
   * Follow the scene's light with the dug wall's brightness.
   *
   * The pit is unlit geometry, so without this it keeps its noon brightness at
   * midnight and becomes the brightest thing in the frame. The level is the
   * scene's own light - sun weighted by how high it stands, plus ambient and a
   * little sky fill - as a fraction of the daylight reference, so the dug wall is
   * as much dimmer at night as the ground beside it. The 0.2 floor keeps it
   * readable as dirt in the dark instead of a hole that disappears.
   */
  private updateCavityLight(): void {
    if (!this.cavityBowl) return;
    const sunUp = Math.max(0, this.bodies.sunDir.y);
    const total =
      sunUp * this.sunLight.intensity +
      this.ambientLight.intensity +
      this.hemisphereLight.intensity * 0.5;
    const level = THREE.MathUtils.clamp(total / CAVITY_DAYLIGHT_REFERENCE, 0.2, 1);
    setCavityBowlLight(this.cavityBowl, level);
  }

  /**
   * Position the sun/moon and grade the sky for the current time of day.
   *
   * The ambient fade is a time constant, not a per-frame fraction: a fixed
   * 0.3-per-frame step closed the same distance three times faster at 144 fps
   * than at 50, so dusk arrived at a different hour on different hardware.
   */
  private updateSunPosition(dtSeconds = 0, snap = false): void {
    const elevation = updateCelestialBodies(this.bodies, this.timeOfDay);
    // Underwater the beam is eaten by the water: the sun's own 1.4 turns a
    // shallow dive into a white-out, so the same state that shortens the fog
    // also dims what the water lets through to the ambient level.
    const sunIntensity = this.underwater
      ? underwaterSunIntensity(this.sunIntensity, this.underwater)
      : this.sunIntensity;
    const ambient = stepAmbientLighting({
      currentBaseline: this.ambientBaseline,
      config: this.config,
      elevation,
      sunIntensity,
      lightningIntensity: this.lightningIntensity,
      alpha: snap
        ? 1
        : 1 - Math.exp(-Math.max(0, dtSeconds) / Math.max(1e-3, this.config.ambientFadeTauS)),
    });
    this.ambientBaseline = ambient.baseline;
    applyCelestialLighting({
      config: this.config,
      sunLight: this.sunLight,
      ambientLight: this.ambientLight,
      skyMaterial: this.sky.material,
      bodies: this.bodies,
      elevation,
      ambientIntensity: ambient.intensity,
      sunOrbitalDistance: this.config.sunOrbitalDistance,
    });
  }

  /** The terrain mesh, or null when the ground is hidden. */
  public getGroundMesh(): THREE.Mesh | null {
    return this.groundMesh;
  }

  /**
   * Dev: what the water surfaces actually are, so a suspicious sheet can be
   * identified instead of guessed at. Reports every water mesh with its
   * visibility, vertex count, geometry type and the box it covers in world
   * space - enough to tell the rain film from the water table, the river and
   * the damp-ground stain.
   */
  public describeWaterSurfaces(): Array<Record<string, unknown>> {
    const field = this.waterField;
    if (!field) return [];
    const entries: Array<[string, THREE.Mesh | null]> = [
      ['surface', field.surfaceMesh],
      ['groundwater', field.groundwaterMesh],
      ['river', field.riverMesh],
      ['wetGround', field.wetGroundMesh],
    ];
    return entries.map(([name, mesh]) => {
      if (!mesh) return { name, present: false };
      const geometry = mesh.geometry as THREE.BufferGeometry;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      const bbox = box ? new THREE.Box3().copy(box).applyMatrix4(mesh.matrixWorld) : null;
      const round = (value: number): number => Math.round(value * 100) / 100;
      return {
        name,
        present: true,
        visible: mesh.visible,
        renderOrder: mesh.renderOrder,
        geometry: geometry.type,
        vertices: geometry.getAttribute('position')?.count ?? 0,
        material: (mesh.material as THREE.Material).type,
        worldBox: bbox
          ? {
              min: [round(bbox.min.x), round(bbox.min.y), round(bbox.min.z)],
              max: [round(bbox.max.x), round(bbox.max.y), round(bbox.max.z)],
            }
          : null,
      };
    });
  }

  /**
   * Dev: what is actually drawn at a screen point, nearest first. A pixel that
   * should be soil or root but reads black can be traced to the exact mesh,
   * material and distance instead of being guessed at; `x`/`y` are normalized
   * device coordinates, the same space as a click (-1..1, y up).
   */
  public describeAtScreen(x: number, y: number): Array<Record<string, unknown>> {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hits = raycaster.intersectObject(this.scene, true);
    return hits.slice(0, 8).map((hit) => {
      const object = hit.object as THREE.Mesh;
      const held = object.material as THREE.Material | THREE.Material[] | undefined;
      const material = Array.isArray(held) ? held[0] : held;
      const round = (value: number): number => Math.round(value * 1000) / 1000;
      return {
        object: hit.object.name || hit.object.type,
        // The raycaster ignores the visible flag, so a hidden mesh still shows
        // up here; report it or a parked bowl reads as one that is drawn.
        visible: hit.object.visible,
        geometry: object.geometry?.type ?? null,
        material: material?.type ?? null,
        side: (material as { side?: number } | undefined)?.side ?? null,
        distance: round(hit.distance),
        point: [round(hit.point.x), round(hit.point.y), round(hit.point.z)],
        normal: hit.face
          ? [round(hit.face.normal.x), round(hit.face.normal.y), round(hit.face.normal.z)]
          : null,
      };
    });
  }

  /** Current normalized time of day [0, 1). */
  public getTimeOfDay(): number {
    return this.timeOfDay;
  }

  /**
   * Jump the clock and hold it there. A dev jump is meant to stay put, so it
   * also freezes the clock; the Freeze Time toggle releases it again.
   */
  public setTimeOfDay(t: number): void {
    this.timeOfDay = t % 1.0;
    if (this.timeOfDay < 0) this.timeOfDay += 1.0;
    this.timeFrozen = true;
  }

  /** Freeze or resume the day/night clock (dev control). */
  public setTimeFrozen(frozen: boolean): void {
    this.timeFrozen = frozen;
  }

  public isTimeFrozen(): boolean {
    return this.timeFrozen;
  }

  /** Multiplier on the clock's advance (dev control). */
  public setTimeScale(scale: number): void {
    if (!Number.isFinite(scale)) return;
    this.timeScale = Math.min(100, Math.max(0, scale));
  }

  public getTimeScale(): number {
    return this.timeScale;
  }

  /** Current solar/celestial light intensity multiplier. */
  public getSunIntensity(): number {
    return this.sunIntensity;
  }

  /** Current sun direction (normalized, pointing FROM the origin TOWARD the sun). */
  /** AL-04: the shared atmosphere model, so plants fade into the same air. */
  public getAtmosphere(): AtmosphereParams {
    return this.atmosphere;
  }

  public getSunDirection(): THREE.Vector3 {
    return this.bodies.sunDir.clone();
  }

  /** Current sun color. */
  public getSunColor(): THREE.Color {
    return this.sunLight.color.clone();
  }

  /** Current weather state (for dev controls). */
  public getWeatherState(): string {
    return this.weatherMachine.getState();
  }
}
