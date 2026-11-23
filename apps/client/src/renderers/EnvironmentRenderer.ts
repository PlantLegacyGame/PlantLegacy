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

import { riverPath, type TerrainVolumeParams } from '@plant-legacy/shared/world';
import * as THREE from 'three';
import type { RenderConfig } from '../config/clientConfig.js';
import type { ClientWeatherState, ClientWeatherStateMachine } from './ClientWeatherStateMachine.js';
import { type AtmosphereParams, atmosphereFromConfig } from './environment/atmosphere.js';
import { worldColour } from './worldPalette.ts';

/**
 * Sun + ambient + sky fill at midday, measured in-game (sun elevation 0.52 with
 * intensity 0.63, ambient 0.60, hemisphere 0.30). The dug wall's brightness is
 * scaled against this, so 1.0 means "as bright as it is at noon".
 */
const CAVITY_DAYLIGHT_REFERENCE = 1.08;

/** How much of the dusk palette the sky takes at the horizon crossing. */
const SKY_DUSK_MIX = 0.55;

/** How much of the night palette the sky takes once the sun is down. */
const SKY_NIGHT_MIX = 0.92;

/** Scratch colours for the sky's hour grade: one frame, no allocation. */
const skyDuskScratch = new THREE.Color();
const skyNightScratch = new THREE.Color();

import {
  CAVITY_CUT_OVERREACH,
  CAVITY_WATER_DRAIN_APERTURES,
  createCavityBowl,
  createCavitySkirt,
  setCavityBowlLight,
  updateCavityBowl,
  updateCavitySkirt,
} from './environment/cavity/index.ts';
import { CAVITY_PALETTE, type CavityPalette } from './environment/cavity/profile.ts';
import {
  applyCelestialLighting,
  type CelestialBodies,
  gradeExposure,
  stepAmbientLighting,
  sunWarmth,
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
import { createLightningBolt, type LightningBolt } from './environment/lightningBolt.js';
import { localSkyBrightness } from './environment/localBrightness.js';
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
import { createTerrainVolumeMesh } from './environment/terrainVolumeMesh.js';
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
import { advanceWorldClock, applyServerClock, withTimeOfDay } from './environment/worldClock.ts';
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
  /**
   * The dug wall's three strata and its sky fill (config/root_sight.json).
   * Omitted only by callers that are not the game - tests - which then get the
   * documented palette from `cavity/profile.ts`.
   */
  cavity?: CavityPalette;
  /**
   * The authored T56 volume region (config/terrain_volume.json). Omitted by
   * tests, which get no volume and exactly the world they had before.
   */
  volume?: TerrainVolumeParams;
}

export interface WeatherPayload {
  timeOfDay: number;
  isDay: boolean;
  sunIntensity: number;
  /** `weather.<state>_light_multiplier` as the server applied it. */
  lightMultiplier?: number;
  /** The world clock's dev freeze state, so every panel shows the server's value. */
  timePaused?: boolean;
  /** The world clock's dev speed multiplier. */
  timeScale?: number;
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
  private readonly bolt: LightningBolt;
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
  private terrainVolume: THREE.Mesh | null = null;
  private cavitySkirt: THREE.Mesh | null = null;
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
  private readonly underwaterTint = worldColour('water_deep');
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

  /**
   * How thick the earth's body is, in metres.
   *
   * The burrow depth is clamped to it: past the underside there is no earth at
   * all, and an eye down there saw the cavity's shell against open sky.
   */
  getSoilBodyDepthM(): number {
    return this.soilBodyDepthM;
  }

  // Root Sight: a camera-facing corridor cut through the soil.
  private readonly soilUniforms: RootSightUniforms;

  /** The pit's dug-earth palette; config owns the numbers. */
  private readonly cavityPalette: CavityPalette;
  /** How thick the earth's body is, metres; 0 until the ground is built. */
  private soilBodyDepthM = 0;

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
  /** Scratch colour for the drops, reused so a storm allocates nothing per frame. */
  private readonly rainTint = new THREE.Color();
  /** Eye below the drawn terrain: no rain is drawn inside the earth. */
  private eyeUnderSoil = false;
  /** The rain field samples the real terrain once the planet radius is known. */
  private terrainSamplerBound = false;
  private lightningIntensity = 0;
  /** How much of a strike's light reaches the eye, from its distance. */
  private lightningAttenuation = 1;

  // Time of day and sun intensity (client-side interpolation)
  private timeOfDay = 0.3;
  /** True once the server has told us the hour; the boot estimate then stops. */
  private timeFromServer = false;
  /** Warmth of the light this frame (0 high sun, 1 on the horizon). */
  private sunWarmthNow = 0;
  private sunIntensity = 1.0;
  /** The weather's light multiplier, from the broadcast. */
  private lightMultiplier = 1;

  // Local tile light drives the sky grade. tile_light_base in
  // config/resources.json is 80, so 80 = full daylight and 0 = full shade. Null
  // until the first root readout: a seed has no covered tiles, and assuming
  // full daylight made its first packet move the sky in one visible step.
  private localTileLight: number | null = null;
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
    this.cavityPalette = tuning.cavity ?? CAVITY_PALETTE;
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
    // The bolt the server sends, drawn at its landing point.
    this.bolt = createLightningBolt(scene);

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
      } else if (object.name === 'planet-soil-slab') {
        // The earth's body stays drawn while the eye is buried: it *is* the
        // earth the eye is standing in. It was hidden with the coarse ring, and
        // the eye then had no earth below it at all - it saw the pit's shell
        // from outside, with the sky behind it. Its thickness is the datum that
        // keeps the eye inside the world (see `soilBodyDepthM`).
        this.soilBodyDepthM = Number(object.userData.bodyDepthM ?? 0);
      }
    });

    // 2a. The earth inside the Root Sight opening. Real geometry instead of
    //     shading faked in the soil shader, so the pit has parallax and looks
    //     the same from every angle. Built once at unit radius, scaled per frame.
    if (tuning.showGround ?? true) {
      // Three depths, not a gradient: the wall is built in strata, and each one
      // needs the colour the earth actually is at that depth. Different earths,
      // not one earth at three brightnesses - a spade through a bank shows dark
      // humus, warm ochre subsoil and cold pale deep earth, and the hue is what
      // the eye uses to separate them.
      //
      // The three colours and the sky-fill fractions are config
      // (`root_sight.cavity_*`), not values derived here: they were computed
      // from the surface's dry-soil tone plus a multiplier and a lerp, which put
      // the pit's appearance out of reach of the config file that is supposed to
      // own it and made every tuning pass a code change.
      const palette = this.cavityPalette;
      const dugTopsoil = new THREE.Color(palette.topsoilColor);
      const dugSubsoil = new THREE.Color(palette.subsoilColor);
      const dugDeep = new THREE.Color(palette.deepColor);
      this.cavityBowl = createCavityBowl(dugTopsoil, dugSubsoil, 96, 24, dugDeep, {
        night: palette.nightFill,
        day: palette.dayFill,
      });
      scene.add(this.cavityBowl);
      // Its own mesh, not extra rings in the bowl: ring counts drive the floor
      // depth, the rim indices and the vertex layout, and a hidden sixth ring in
      // that buffer quietly changed all three. As a child it still shares the
      // bowl's transform and material.
      // A shallow collar, not the full soil depth: it backs the ground sheet's
      // cut edge from below, and anything taller stands in front of the pit's
      // wall and covers the strata (see CAVITY_SKIRT_DEPTH_M).
      this.cavitySkirt = createCavitySkirt(this.cavityBowl);
      this.cavityBowl.add(this.cavitySkirt);
      // 2b. T56 slice 1: real volume, one authored region. The rest of the
      //     ground is still the T25 height field; here the field is a signed
      //     distance over a 3D grid and the surface is meshed by surface nets,
      //     so the body has an underside and an overhang instead of one skin.
      //     Seated on the drawn surface, not the bare sphere.
      if (tuning.volume) {
        // Rock is earth, not the mineral *accent* the soil shader sprinkles on
        // the ground: painting the arch with `soil_mineral_tint` made it a teal
        // slab in the first visual pass. It takes the dry soil colour pulled a
        // third of the way to the wet one, so it sits in the same earth family
        // as the hillside, darker where it has not dried out.
        const rockColour = new THREE.Color(config.soilDryColor)
          .lerp(new THREE.Color(config.soilWetColor), 0.25)
          // A trace of the mineral accent, not all of it: 6% cools the brown
          // towards stone where the first pass's 100% was a teal slab, and 15%
          // still read as concrete at noon.
          .lerp(new THREE.Color(config.soilMineralTint), 0.06);
        this.terrainVolume = createTerrainVolumeMesh(
          tuning.volume,
          (x, z) => planetTerrainY(config.planetRadiusM, x, z, getTerrainParams()),
          rockColour,
        );
        if (this.terrainVolume) scene.add(this.terrainVolume);
      }
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
      // `water_enabled` is the whole field: sheets, table, stream and sea. It is
      // off while the current water is replaced - a flat sheet draped over the
      // terrain floods slopes and covers the ground at eye level - and leaving the
      // meshes in the scene hidden would only make the next bug hide there.
      const waterEnabled = this.waterTuning.enabled ?? true;
      this.waterField = waterEnabled
        ? createWaterField(
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
          )
        : null;
      if (this.waterField) scene.add(this.waterField.group);
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
      if ((this.waterTuning.enabled ?? true) && (this.waterTuning.oceanEnabled ?? true)) {
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
  /**
   * Dev diagnostic: what the weather has left lying on the ground, 0..1 each.
   *
   * The patches are drawn by a shader, so "the ground never gets wet" cannot be
   * told from the outside by looking: the rules' own state is the number to read.
   */
  public groundCover(): { water: number; snow: number } {
    return this.rain.groundCover();
  }

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

  /** Pose the water cut around the opening was last sampled for, and its radius. */
  private waterCutKey = '';
  private waterCutRadiusM = 0;

  /**
   * How wide the water is cut around Root Sight's opening, in metres.
   *
   * The column cut clears the water inside the opening and nothing else. A sheet
   * standing just outside it is drawn above the mouth's plane wherever the
   * ground falls away, so on a slope the water between the eye and the pit is
   * higher than the pit's own mouth and hides its near wall: the floor reads as
   * water seen through the ground from level angles, while a view from above is
   * clean. The opening drains the hollow it sits in, so the cut follows that
   * hollow out to where its ground rises back to the mouth, up to
   * CAVITY_WATER_DRAIN_APERTURES apertures.
   */
  private cavityWaterCutRadius(
    centreX: number,
    centreZ: number,
    apertureM: number,
    terrain: ReturnType<typeof getTerrainParams>,
  ): number {
    const base = apertureM * CAVITY_CUT_OVERREACH;
    const limit = apertureM * CAVITY_WATER_DRAIN_APERTURES;
    if (!(apertureM > 0) || limit <= base) return Math.max(0, base);
    const key = `${centreX.toFixed(2)}|${centreZ.toFixed(2)}|${apertureM.toFixed(3)}`;
    if (key === this.waterCutKey) return this.waterCutRadiusM;
    const groundAt = (x: number, z: number) => planetTerrainY(this.planetRadiusM, x, z, terrain);
    // The mouth's plane sits on the highest ground beneath the lip: that is what
    // the bowl's rim is fitted to.
    let mouthY = groundAt(centreX, centreZ);
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      mouthY = Math.max(
        mouthY,
        groundAt(centreX + Math.cos(angle) * apertureM, centreZ + Math.sin(angle) * apertureM),
      );
    }
    const step = Math.max(0.15, apertureM * 0.2);
    let reach = base;
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      for (let r = base; r <= limit; r += step) {
        if (groundAt(centreX + dx * r, centreZ + dz * r) >= mouthY - 0.02) break;
        reach = Math.min(limit, Math.max(reach, r + step));
      }
    }
    this.waterCutKey = key;
    this.waterCutRadiusM = reach;
    return reach;
  }

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

  /**
   * One server-announced bolt. The server rolled it, damaged what stood in its
   * radius and sent the position; the renderer draws the strike there and paints
   * the light, so the flash and the bolt are the same event.
   */
  public flashLightning(x: number, z: number, radiusM = 6): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const y =
      this.planetRadiusM > 0 ? planetTerrainY(this.planetRadiusM, x, z, getTerrainParams()) : 0;
    this.bolt.strike(x, y, z, radiusM, this.camera.position);
    // Lightning lights the air it falls through, so a bolt a hundred metres away
    // cannot turn the sky beside this player white. The bolt and its light share
    // the same attenuation, so a distant strike is a distant flash.
    const distance = Math.hypot(x - this.camera.position.x, z - this.camera.position.z);
    this.lightningAttenuation = THREE.MathUtils.clamp(1.15 - distance / 70, 0.25, 1);
    this.weatherMachine.triggerLightning();
  }

  /**
   * Start the clock at the world's hour before the first frame.
   *
   * The renderer used to open at its own default hour and wait for the first
   * weather broadcast, so a player reloading at night saw a bright world for a
   * beat before it snapped dark. A broadcast always wins: if one has already
   * landed, this is a no-op.
   */
  public primeTimeOfDay(t: number): void {
    if (this.timeFromServer) return;
    this.timeOfDay = withTimeOfDay(
      { timeOfDay: this.timeOfDay, paused: false, scale: this.timeScale },
      t,
    ).timeOfDay;
  }

  /** Apply a server weather update. */
  public handleWeatherUpdate(payload: WeatherPayload): void {
    this.timeFromServer = true;
    // One clock policy (`environment/worldClock.ts`): the hour is taken as given,
    // and the freeze and the speed are the server's, so every client and every
    // dev panel agree. The old local freeze flag overrode the server's hour for
    // the rest of the session, which is why the two drifted apart.
    const clock = applyServerClock(
      { timeOfDay: this.timeOfDay, paused: this.timeFrozen, scale: this.timeScale },
      payload,
    );
    this.timeOfDay = clock.timeOfDay;
    this.timeFrozen = clock.paused;
    this.timeScale = clock.scale;
    this.sunIntensity = payload.sunIntensity;
    this.lightMultiplier = Number.isFinite(payload.lightMultiplier)
      ? Math.min(1, Math.max(0, payload.lightMultiplier as number))
      : 1;

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
  /**
   * Anchor the water and snow on the ground to the player's feet.
   *
   * The weather field follows the camera, but the cover it leaves behind must not:
   * zooming out moves the camera metres away, and the cover used to be rebuilt at
   * every such step, so the puddles slid along the slope. The caller passes the
   * orbit target, which stands still while the camera zooms.
   */
  public setGroundAnchor(x: number, z: number): void {
    this.rain.setGroundAnchor(x, z);
  }

  public update(dt: number, devOverrideUntil = 0): void {
    const lerpRate = Math.min(1.0, dt * 2.5);
    this.sampleUnderwaterView();

    // The hour is the server's; the client only fills the gap between broadcasts
    // (2 Hz) so the sun moves instead of stepping, and it stops when the server
    // says the clock is stopped. A dev override still pins it for its duration.
    if (Date.now() >= devOverrideUntil) {
      const advanced = advanceWorldClock(
        { timeOfDay: this.timeOfDay, paused: this.timeFrozen, scale: this.timeScale },
        dt,
        this.dayLengthSeconds,
      );
      this.timeOfDay = advanced.timeOfDay;
    }

    // `update` takes milliseconds (its fades and its strike decay are timed in
    // ms), while the render loop's dt is seconds. Passing seconds made a 6 s
    // weather cross-fade take 100 minutes and a 120 ms strike linger for two.
    const weatherTargets = this.weatherMachine.update(dt * 1000, this.timeOfDay, this.sunIntensity);

    // The weather machine emits a normalised, already-fading strike. Hand it to
    // the celestial pass, which composes baseline + flash in one assignment.
    // The strike lives on the machine, not in the interpolated targets: the
    // targets' own field was initialised to zero and never written, so the
    // flash read as clear skies.
    this.lightningIntensity = Math.max(
      0,
      this.weatherMachine.getLightningIntensity() * this.lightningAttenuation,
    );
    this.bolt.update(this.lightningIntensity);
    this.updateSunPosition(dt);

    // The sky dome is camera-centred, so it never warps as the camera moves.
    this.sky.mesh.position.copy(this.camera.position);
    // Cloud drift is a clock; the overcast follows the weather's own light
    // multiplier, which is already smoothed by the state machine's cross-fade, so
    // the ceiling thickens exactly as fast as the sky darkens.
    const cloudUniforms = this.sky.material.uniforms;
    if (cloudUniforms.uCloudTime) cloudUniforms.uCloudTime.value = this.elapsedSeconds;
    if (cloudUniforms.uStorm) {
      cloudUniforms.uStorm.value = THREE.MathUtils.clamp(1 - this.lightMultiplier, 0, 1);
    }

    // Root Sight is entirely a soil-shader effect: no backdrop sphere, no
    // separate cavity mesh, nothing to draw behind the terrain. The sky stays
    // on even under the surface — the ground encloses the camera, so the only
    // place sky can appear is through the opening, which is exactly what
    // looking up out of the hole should show.
    this.sky.mesh.visible = true;
    // Only the sky grade needs to know the eye went under the surface; the
    // ground and cavity bowl are the surrounding dirt. Measuring radially from
    // the planet centre keeps it correct anywhere on the planet.
    this.eyeUnderSoil = false;
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
      this.eyeUnderSoil = eyeUnder;
      // An eye standing in the open pit is below the ground's sheet but not
      // inside the earth: the mouth above it is real sky, and the ground around
      // it is lit hillside. Treated as buried, the sky dome paints its earth
      // cone in every direction below 35 degrees ("inside the earth") and the
      // ground shades itself as an enclosure that fades to a fifth of its light
      // with distance - together a wall of soil where the sky should be, at
      // exactly the height where a camera hovering over the pit ends up (R23).
      // The camera's own answer says which case this is: the flag is set while
      // it is buried *and* standing inside the opening's column.
      const eyeInPit = this.soilUniforms.uRootSightEyeInPit.value > 0.5;
      const eyeBuried = eyeUnder && !eyeInPit;
      const skyUniforms = this.sky.material.uniforms;
      if (skyUniforms?.uEyeUnderGround) {
        skyUniforms.uEyeUnderGround.value = eyeBuried ? 1 : 0;
      }
      const groundUniforms = this.groundMaterial.userData.shader?.uniforms;
      if (groundUniforms?.uEyeUnderGround) {
        groundUniforms.uEyeUnderGround.value = eyeBuried ? 1 : 0;
      }
      this.updatePlanetBodyVisibility(eyeBuried);
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
      if (this.cavitySkirt) {
        // After the bowl, from the bowl: the skirt's top edge is the rim the bowl
        // just conformed, so the two cannot disagree about where the hole is.
        updateCavitySkirt(this.cavitySkirt, this.cavityBowl);
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
        // The hole the *soil* actually cuts is the aperture a hair wider than
        // the lip (CAVITY_CUT_OVERREACH), and the water has to be removed at
        // that same radius. Clipped at the aperture instead, a ring of sheet two
        // percent wider than the hole survived and lapped over the pit's lip - a
        // teal collar around the opening from every angle. Past that, the cut
        // follows the hollow the opening drains, so no sheet is left standing
        // above the mouth between the eye and the dug earth.
        const cavityX = this.soilUniforms.uRootSightCenter.value.x;
        const cavityZ = this.soilUniforms.uRootSightCenter.value.z;
        this.waterField.setCavityClip(
          cavityX,
          cavityZ,
          cavityOpen
            ? this.cavityWaterCutRadius(
                cavityX,
                cavityZ,
                this.soilUniforms.uRootSightApertureRadius.value,
                terrain,
              )
            : 0,
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
    const localBrightness = localSkyBrightness({
      localTileLight: this.localTileLight,
      tileLightBase: this.tiles.tileLightBase,
      dayFactor: this.weatherMachine.getDayFactor(),
    });
    this.localZenithTarget.copy(weatherTargets.zenithColor).multiplyScalar(localBrightness);
    this.localHorizonTarget.copy(weatherTargets.horizonColor).multiplyScalar(localBrightness);
    this.gradeSkyTarget(
      this.localZenithTarget,
      this.config.skyZenithDusk,
      this.config.skyZenithNight,
    );
    this.gradeSkyTarget(
      this.localHorizonTarget,
      this.config.skyHorizonDusk,
      this.config.skyHorizonNight,
    );
    this.sky.zenithColor.lerp(this.localZenithTarget, lerpRate);
    this.sky.horizonColor.lerp(this.localHorizonTarget, lerpRate);
    // The sky shader's zenith/horizon uniforms hold these same Color instances,
    // so they follow the lerp without a second per-frame copy.
    // Skylight is blue; the earth is not. The fill light took the zenith colour
    // at full saturation and multiplies every upward-facing albedo, which is
    // what turned the Root Sight pit's grey deep stratum the colour of water and
    // made the blue of the old water sheets look like they were still there.
    // Half the saturation keeps the hour's hue on the terrain without repainting
    // the soil.
    this.hemisphereLight.color.copy(this.sky.zenithColor);
    const zenith = this.hemisphereLight.color;
    const luma = 0.2126 * zenith.r + 0.7152 * zenith.g + 0.0722 * zenith.b;
    const desaturation = THREE.MathUtils.clamp(this.config.skylightDesaturation, 0, 1);
    zenith.setRGB(
      THREE.MathUtils.lerp(zenith.r, luma, desaturation),
      THREE.MathUtils.lerp(zenith.g, luma, desaturation),
      THREE.MathUtils.lerp(zenith.b, luma, desaturation),
    );
    this.hemisphereLight.groundColor.copy(this.sky.horizonColor);
    // The fill light shares the ambient's budget. It kept Three's default
    // intensity through night and storm - only its colour followed the sky - so
    // the ground stayed lit while every other light dimmed.
    this.hemisphereLight.intensity = THREE.MathUtils.clamp(this.ambientLight.intensity, 0, 1);

    // 2. Atmospheric fog follows the horizon, pulled in when the camera is in
    //    the water: light scatters out within a couple of metres, so the far
    //    bank disappears while the surface overhead stays visible.
    const underwater = this.underwater;
    // Mist: with the sun on the horizon the air thickens, so dawn and dusk carry
    // a haze the same clear sky does not. One config ratio scales both distances.
    const mist = this.sunWarmthNow;
    const mistScale = THREE.MathUtils.lerp(
      1,
      THREE.MathUtils.clamp(this.config.fogHorizonMistScale, 0.1, 1),
      mist,
    );
    const baseFog = {
      near: weatherTargets.fogNear * mistScale,
      far: weatherTargets.fogFar * mistScale,
    };
    const fogTargets = underwater ? underwaterFog(baseFog, underwater) : baseFog;
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
    // The soil keeps its warm colour in every weather. Rain used to be blended
    // into the ground at 0.85, which greyed the whole hillside into flat mud;
    // what actually gets wet is drawn as water lying on top of the soil instead.
    setGroundMoisture(this.groundMaterial, Math.min(this.soilMoisture, 0.06));
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
    // What is already lying on the ground keeps filling or drying whether or not
    // anything is still falling.
    this.rain.advance(dt);
    const precipitating = weatherTargets.isRaining || weatherTargets.isSnowing;
    if (precipitating) {
      // Weather does not fall inside the earth. A shower drawn over the cavity and
      // through the soil face was the one thing that made Root Sight read as an
      // outdoor scene with a brown filter on it.
      this.rain.setVisible(!this.eyeUnderSoil);
      // A crown that landed on the surface is water on the wrong side of the
      // ground for an eye under it: the pass says so rather than drawing rings
      // in the roof of the pit.
      this.rain.setEyeUnderGround(this.eyeUnderSoil);
      this.rain.setMode(weatherTargets.isSnowing ? 'snow' : 'rain');
      // Every drop stops on the terrain under its own column, sampled from the
      // same height field the ground is drawn from.
      if (this.planetRadiusM > 0 && !this.terrainSamplerBound) {
        this.terrainSamplerBound = true;
        this.rain.setTerrainSampler((x, z) =>
          planetTerrainY(this.planetRadiusM, x, z, getTerrainParams()),
        );
      }
      this.rain.follow(this.camera.position);
      // The rings land on the drawn surface under the eye, not on a plane at zero.
      this.rain.setGround(
        this.planetRadiusM > 0
          ? planetTerrainY(
              this.planetRadiusM,
              this.camera.position.x,
              this.camera.position.z,
              getTerrainParams(),
            )
          : this.camera.position.y - 1.7,
      );
      // Rain does not fall into the cavity: the opening is air, and a streak over
      // it was the one thing that made the cut look like a decal on a solid plane.
      const aperture = this.soilUniforms.uRootSightApertureRadius.value;
      const apertureCentre = this.soilUniforms.uRootSightApertureCenter.value;
      this.rain.setCutaway(apertureCentre.x, apertureCentre.z, aperture);
      // Drops carry the light of the hour they fall through: sun or moon colour,
      // dimmed to the ambient level, so a night shower is a grey curtain in
      // moonlight rather than a glowing cyan sheet.
      // Sky, not sun: a drop reflects the air it falls through. Tinting with the
      // sun turned golden hour into amber rain and a noon storm warm, which is
      // exactly the "weird colour" rain had.
      this.rainTint.copy(this.sunLight.color).lerp(this.sky.horizonColor, 0.7);
      this.rain.setLight(
        this.rainTint,
        THREE.MathUtils.clamp(
          0.25 + this.ambientLight.intensity * 1.6 + this.sunLight.intensity * 0.25,
          0.2,
          1,
        ),
      );
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
    // The arch stands on the skin, so it is scenery of the surface: a buried
    // eye is inside the earth and sees none of it.
    if (this.terrainVolume) this.terrainVolume.visible = !eyeUnder;
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
    this.sunWarmthNow = sunWarmth(elevation.sunElev);
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
      lightMultiplier: this.lightMultiplier,
      sunOrbitalDistance: this.config.sunOrbitalDistance,
    });
  }

  /**
   * Give the sky its hour: the day, dusk and night palettes from the config.
   *
   * The weather palette is one set of colours per weather state, so a clear sky
   * was noon blue at midnight and held the noon hue all the way through sunset.
   * The sun's own height picks the palette instead: the weather's colours lead
   * in full day, the dusk palette warms the horizon as the sun crosses it, and
   * the night palette takes over once the sun is down, so midnight is a night
   * sky rather than a dimmed daytime one.
   *
   * The height is `bodies.sunDir.y`, the true sun. The sky dome keeps its own
   * copy of that vector (it blanks its uniform at night to hide the disc), so
   * reading the uniform here reported the sun as either overhead or straight
   * down - never near the horizon - which is how a 4 am sky came out warm red.
   */
  private gradeSkyTarget(target: THREE.Color, duskHex: string, nightHex: string): void {
    const sunHeight = this.bodies.sunDir.y;
    const day = THREE.MathUtils.smoothstep(sunHeight, 0.02, 0.32);
    const night = 1 - THREE.MathUtils.smoothstep(sunHeight, -0.22, -0.02);
    const dusk = Math.max(0, 1 - day - night);
    if (dusk > 0) {
      skyDuskScratch.set(duskHex);
      target.lerp(skyDuskScratch, dusk * SKY_DUSK_MIX);
    }
    if (night > 0) {
      // One night treatment, and this is all of it. The palette is the colour;
      // the weather's own light multiplier is the brightness, applied to the
      // palette and to whatever weather tint survives the blend, so a stormy
      // night is darker than a clear one everywhere in the sky instead of only
      // in the palette term. The floor keeps a black storm from erasing it.
      const weatherLight = THREE.MathUtils.clamp(
        Number.isFinite(this.lightMultiplier) ? this.lightMultiplier : 1,
        this.config.skyNightMinLight,
        1,
      );
      skyNightScratch.set(nightHex);
      target.lerp(skyNightScratch, night * SKY_NIGHT_MIX);
      target.multiplyScalar(THREE.MathUtils.lerp(1, weatherLight, night));
    }
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

  /** How warm the light is this frame: 0 high sun, 1 on the horizon. */
  public getSunWarmth(): number {
    return this.sunWarmthNow;
  }

  /** Renderer exposure for the current hour, from `render.json`. */
  public getExposureGrade(): number {
    return gradeExposure(this.bodies.sunDir.y, this.config);
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
    this.timeOfDay = withTimeOfDay(
      { timeOfDay: this.timeOfDay, paused: this.timeFrozen, scale: this.timeScale },
      t,
    ).timeOfDay;
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
