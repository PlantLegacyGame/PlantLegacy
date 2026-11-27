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
  setCavityBowlLight,
  setCavityBowlSun,
  updateCavityBowl,
} from './environment/cavity/index.ts';
import { CAVITY_PALETTE, type CavityPalette } from './environment/cavity/profile.ts';
import {
  applyCelestialLighting,
  type CelestialBodies,
  createMoonBody,
  gradeExposure,
  type MoonBody,
  placeMoonBody,
  stepAmbientLighting,
  sunWarmth,
  updateCelestialBodies,
} from './environment/celestial.js';
import { createFarReliefMesh, FAR_RELIEF_DETAIL } from './environment/farReliefMesh.js';
import {
  createGround,
  getGroundShader,
  setGroundAtmosphere,
  setGroundMoisture,
  setRiverBankDamping,
  setSurfaceWater,
  setWaterTableDamping,
  updateGroundFill,
  updateGroundPixelAngle,
  updateGroundSun,
} from './environment/ground.js';
import { createLightningBolt, type LightningBolt } from './environment/lightningBolt.js';
import { localSkyBrightness } from './environment/localBrightness.js';
import {
  createOcean,
  createPlanetSea,
  OCEAN_DOME_REACH_M,
  type Ocean,
  type PlanetSea,
} from './environment/ocean.js';
import {
  createOrbitalShell,
  ORBITAL_SHELL_FADE_START_M,
  type OrbitalShell,
  orbitalShellFadeForAltitude,
} from './environment/orbitalShell.js';
import {
  type PlanetReliefParams,
  planetReliefAt,
  planetSurfaceReliefAt,
} from './environment/planetRelief.js';
import {
  createSurfaceRing,
  planetSurfaceY,
  planetTerrainY,
  TERRAIN_SKIN_M,
  terrainRelief,
} from './environment/planetSurface.js';
import { createRainSystem, type RainSystem } from './environment/rainSystem.js';
import {
  createResourceGrid,
  DEFAULT_TILE_NORMALIZATION,
  type ResourceGrid,
  type ResourceTile,
  type TileNormalization,
} from './environment/resourceGrid.js';
import { createRiverMask, type WaterTableField } from './environment/riverMask.js';
import type { RootSightUniforms } from './environment/rootSightUniforms.js';
import { createSkyDome, type SkyDome } from './environment/skyDome.js';
import {
  createSurfaceWaterField,
  DEFAULT_SURFACE_WATER_FIELD,
  type SurfaceWaterField,
} from './environment/surfaceWaterField.js';
import { createSurfaceWaterMesh, type SurfaceWaterMesh } from './environment/surfaceWaterMesh.js';
import { createTerrainVolumeMesh } from './environment/terrainVolumeMesh.js';
import {
  sampleUnderwater,
  seaSurfaceHeightOver,
  type UnderwaterState,
  underwaterFog,
  underwaterSunIntensity,
  type WaterSurfaceOverPoint,
} from './environment/underwater.js';
import { airDensityAt, cloudCoverAbove, fogReachAt } from './environment/verticalAtmosphere.js';
import {
  DEFAULT_WATER_COLORS,
  DEFAULT_WATER_FIELD_TUNING,
  type WaterFieldTuning,
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

/**
 * The dug wall's strata, from the palette's soil ramp.
 *
 * `config/root_sight.json` used to hold three hexes for this, so the face the
 * player cut and the ground it was cut from drifted into two different browns.
 * The wall is now the same family as the ground and the aperture body:
 * `soil_shade` at the lip (its role is "ground under the canopy or in a pit"),
 * `soil_mid` on the wall, `soil_shade` at the floor. Two mappings were tried and
 * are worth not repeating: `soil_lit` at the floor, at which albedo the bowl's
 * own facets and specular turned it into polished ceramic (a light soil is a
 * *sunlit surface* tone, not the floor of a hole three metres down), and
 * `soil_wet` there, which is so dark under the fill that the pit read as a void
 * with no bottom. The day and night fills stay tunable: they are light, not paint.
 *
 * The lip used to be `soil_wet` (`#2c1e16`, relative luminance 0.015) while the
 * ground it opens in is `soil_mid` (`#a27553`, 0.21): the top quarter of the wall,
 * the part an eye above the rim always sees, was fourteen times darker than the
 * earth beside it, so every opening wore a near-black collar and its topsoil
 * read as burnt rather than damp. `soil_shade` (`#66442c`, 0.071) keeps the
 * topsoil darker than the subsoil - which is what a spade shows - without
 * leaving the surface's own earth: 3.0x the lip it had, and a third of the
 * ground around it. The floor shares that role on purpose: the bowl's own depth
 * falloff and the sky fill darken it far past the lip in the frame, and a
 * separate step for "deep earth" does not exist in the soil ramp.
 */
export function cavityPaletteFromWorld(fill: {
  nightFill: number;
  dayFill: number;
}): CavityPalette {
  return {
    topsoilColor: worldColour('soil_shade').getStyle(),
    subsoilColor: worldColour('soil_mid').getStyle(),
    deepColor: worldColour('soil_shade').getStyle(),
    nightFill: fill.nightFill,
    dayFill: fill.dayFill,
  };
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

/** The static globe sits a few metres under the play disc so the two never z-fight. */
const FAR_RELIEF_FALLBACK_SINK_M = 5;
/**
 * The ring that joins the play disc to the globe. It starts on the disc rim and
 * reaches the planet-wide field well before the eye can see its outer edge.
 */
const HORIZON_RING_OUTER_M = 20_000;
const HORIZON_RING_BLEND_M = 1_800;
const HORIZON_RING_LIP_M = 8;
/** Polar arc where the coarse globe must not draw; the ring covers well past it. */
const FAR_RELIEF_CUT_M = 18_000;
/** Arc distance that still counts as the detailed near pole, metres. */
const NEAR_POLE_ARC_M = 6_200;

export class EnvironmentRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
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
  /** The base planet sphere; the play disc is its child and stays visible. */
  private planetBodyMesh: THREE.Mesh | null = null;
  /** The near-ground detail patch, a child of the body. */
  private planetDetailMesh: THREE.Object3D | null = null;
  /** The planet's face at orbital range; see environment/orbitalShell. */
  private orbitalShell: OrbitalShell | null = null;
  /**
   * The static globe: one mesh, built once, never re-tessellated or rebuilt as
   * the camera climbs. It is the backdrop outside the play disc.
   */
  private farReliefMesh: THREE.Mesh | null = null;
  /** The disc-to-globe transition, built once from the play disc's own rim. */
  private horizonRing: THREE.Mesh | null = null;
  private reliefParams: PlanetReliefParams | null = null;
  /** Scratch direction for the far side's relief read. */
  private readonly reliefScratch = new THREE.Vector3();
  /** The sea over the whole body, at planet scale: everywhere the dome cannot reach. */
  private planetSea: PlanetSea | null = null;
  /** Sea level the body's water stands at, metres of relief. */
  private planetSeaLevelM = 0;
  /** The moon as an object in space, not only the dome's disc. */
  private moonBody: MoonBody | null = null;
  /** The body's axial spin this frame, radians. */
  private planetSpinRad = 0;
  /** Unspun direction for `reliefAtDirection`; the field is planet-fixed. */
  private readonly reliefSpinScratch = new THREE.Vector3();
  /** Scratch target for the clear colour as the air thins to vacuum. */
  private readonly backgroundTarget = new THREE.Color();

  /** Built once, on the first frame the shell covers the world. */
  private orbitalFarMask: THREE.DataTexture | null = null;
  private planetBodyDrawCount = 0;
  // The cavity as real geometry: a dug bowl of earth under the opening.
  private cavityBowl: THREE.Mesh | null = null;
  private terrainVolume: THREE.Mesh | null = null;
  // The soil's cut face at the aperture boundary, so the skin's edge is not a
  // see-through line with nothing behind it.
  /**
   * Standing water: rain depth solved around the player and packed into a
   * texture (see surfaceWaterField.ts). The soil shader draws the wet ground
   * from it, and `surfaceWaterMesh` draws the water's own top.
   */
  private surfaceWater: SurfaceWaterField | null = null;
  /** The same field as a surface: its level in geometry, not a tint. */
  private surfaceWaterMesh: SurfaceWaterMesh | null = null;
  /** The cave river's own surface, two metres under the ground's. */
  private undergroundWaterMesh: SurfaceWaterMesh | null = null;
  /** Throttle for copying the field into the mesh's vertices. */
  private surfaceWaterSync = 0;
  /** Seconds the water surface has been running, for ripples and rain rings. */
  private surfaceWaterTime = 0;
  /** Where the water on the ground belongs: the player's feet, not the eye. */
  private groundAnchorX = Number.NaN;
  private groundAnchorZ = Number.NaN;
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
  private rainLightLevel = 1;
  /** Eye below the drawn terrain: no rain is drawn inside the earth. */
  private eyeUnderSoil = false;
  /**
   * True while the camera orbits the whole body in planet view.
   *
   * The buried test below compares the eye's y to the terrain height, which is
   * right for a camera standing on the pole's tangent plane and wrong for an
   * orbit: the whole lower hemisphere of the orbit is below y = 0, so the body,
   * every shell and the orbital face were switched off as "buried" and looking
   * at the planet from under it showed empty space. In an orbit the eye is never
   * inside the earth, whatever its y.
   */
  private planetViewActive = false;
  /**
   * Metres the eye stands above the drawn terrain under it. Read by the sky
   * (the air overhead is the sky, and there is none in space) and by the fog
   * (the same air seen along the ground, which stops hiding the planet once
   * the eye is above most of it).
   */
  private eyeAltitudeM = 0;
  /** Smoothed share of the air column still overhead, 1 at the soil, 0 in space. */
  private airDensity = 1;
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
    camera: THREE.PerspectiveCamera,
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
    // The same role the bowl's lip band uses (`cavityPaletteFromWorld`): the two
    // paths draw one cut face, so a darker number here than there is a seam where
    // the meshed bowl meets the shader's cavity. It was `soil_wet` x 0.9, which
    // with the bowl's own `soil_wet` lip made the whole mouth near-black.
    this.cavityWallColor.copy(worldColour('soil_shade'));
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
        this.planetDetailMesh = object.getObjectByName('planet-play-disk') ?? null;
        this.planetBodyDrawCount =
          object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0;
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
        const rockColour = worldColour('soil_mid')
          .lerp(worldColour('soil_wet'), 0.25)
          // A trace of the dark earth, not all of it: 6% cools the brown towards
          // stone, while a heavier mix reads as concrete at noon.
          .lerp(worldColour('soil_shade'), 0.06);
        this.terrainVolume = createTerrainVolumeMesh(
          tuning.volume,
          (x, z) => planetTerrainY(config.planetRadiusM, x, z, getTerrainParams()),
          rockColour,
          this.groundMaterial,
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
      }
      // 2c. The same world at orbital range. Two metres above the body, hidden
      //     until the play patch is subpixel, so it can never be mistaken for
      //     the ground a plant is growing on.
      // The same palette roles the ground uses, and the same land cover it
      // paints: the shell's green is the ground's own `uSoilCoverColor` (the
      // foliage shade pulled 45% into dry soil), so orbit and the dirt under the
      // player's feet are one world at two scales.
      this.orbitalShell = createOrbitalShell(
        config.planetRadiusM,
        {
          soilLow: worldColour('soil_shade'),
          // `soil_mid` is the ground shader's own dry colour, so the planet's base
          // tone is the tone of the dirt in front of the player, not a paler step.
          soilHigh: worldColour('soil_mid'),
          // Kept as a neutral soil step so nothing can tint the globe green
          // while the world has no vegetation.
          vegetation: worldColour('soil_lit'),
          haze: worldColour('sky_horizon'),
          // The same darkened deep role the ocean uses (see createOcean), so the
          // shell's sea and the dome's sea are the same body at the fade.
          seaDeep: worldColour('water_deep').multiplyScalar(0.62),
          seaShallow: worldColour('water_shallow'),
        },
        // The shell is a smooth ball, so it has to clear the *highest* ground,
        // not sit two metres over the mean. At a 50 m offset every hill above
        // 50 m punched through it as a sharp lozenge - the diamond lattice over
        // the disc in planet view. One amplitude plus a margin is the honest
        // floor; the extra 120 m hides the relief's own interpolation overshoot.
        Math.max(50, (config.planetReliefAmplitudeM ?? 0) + 120),
      );
      scene.add(this.orbitalShell.mesh);
      // S35: the sea survives the climb. Up here the ocean dome is subpixel and
      // the shell is opaque, so the shell paints the sea from the far relief
      // field (see ensureOrbitalFarMask). One field for the whole face: a second,
      // fine bed over the middle used to meet it with a square seam.

      // 2d. The whole body's relief. The authored patches own six kilometres of
      //     a 100 km radius; every other square metre of the planet used to be
      //     the bare sphere, which is why planet view could only be zoomed into
      //     near the play area: everywhere else the body was a painted ball. One
      //     field now covers the globe, faded to exactly zero inside the radius
      //     the patches own, so the globe and the play area are one surface.
      const reliefField = getTerrainParams();
      this.reliefParams = {
        amplitudeM: Math.max(0, config.planetReliefAmplitudeM ?? 0),
        seed: reliefField.seed,
        surfaceRadiusM: config.planetRadiusM,
        // The far field's own square. The holdoff is measured on the square's
        // max axis, so both fields are zero on that exact line and the handoff
        // has no corner for one to poke through the other. Four kilometres of
        // ramp lets the global hills grow from the bare sphere instead of
        // standing up as a ring wall just past the play area.
        // The holdoff is the authored *ring's* outer edge, not the horizon's.
        // The horizon is rebuilt below with this same field, so the global hills
        // begin where the ring ends and reach full height by the chunk cap. The
        // six-kilometre holdoff left the horizon flat right up to the square edge
        // while the chunks outside stood on full hills: that edge was the square
        // shade seen from ten kilometres.
        holdoffM: 620,
        rampM: 2_380,
      };
      if (this.reliefParams.amplitudeM > 0) {
        this.ensureFarRelief(this.reliefParams);
        this.ensureHorizonRing(this.reliefParams);
        // 2e. The planet-wide sea, when the world is wet. Off by default now:
        //     the world is land, and a second water sphere at a fixed level
        //     painted the whole horizon and every basin as ocean.
        if (this.waterTuning.oceanEnabled ?? true) {
          this.planetSeaLevelM = this.waterTuning.seaLevelM ?? DEFAULT_WATER_FIELD_TUNING.seaLevelM;
          this.planetSea = createPlanetSea(
            config.planetRadiusM,
            this.planetSeaLevelM,
            (direction) => planetReliefAt(direction, this.reliefParams as PlanetReliefParams),
            this.waterTuning.colors ?? DEFAULT_WATER_COLORS,
          );
          scene.add(this.planetSea.mesh);
        }
      }
      // 2f. The moon, as a body. The dome draws its disc for an eye on the
      //     ground; from planet view the same body has to exist out there, or
      //     the sky is a sun and nothing else.
      this.moonBody = createMoonBody(config.planetRadiusM, worldColour('soil_lit'));
      scene.add(this.moonBody.mesh);
      // The authored cave opening is not part of the shipped ground. A shaft
      // made of cylinders, rings and cones is scenery dressed as a cave; the
      // depth has to come from a signed-distance volume meshed with surface nets
      // (T56), not from primitives cut into the ground sheet.
    }
    this.resourceGrid = createResourceGrid(() => getGroundShader(this.groundMaterial), this.tiles);

    // 3. Rain.
    this.rain = createRainSystem(scene, config, tuning.showRain ?? true);

    // 4. Standing water. The rain lays it down, the solver runs it into hollows,
    // and the soil shader draws it: a puddle is where the ground is below the
    // water, not a quad laid on top of it. Its cells are the resolution of the
    // shoreline, so it is the one number that decides how round a pool is.
    this.surfaceWater = createSurfaceWaterField({
      cells: this.waterTuning.surfaceCells ?? DEFAULT_SURFACE_WATER_FIELD.cells,
      extentM: this.waterTuning.surfaceExtentM ?? DEFAULT_SURFACE_WATER_FIELD.extentM,
      flowRatePerS: this.waterTuning.flowRatePerS ?? DEFAULT_SURFACE_WATER_FIELD.flowRatePerS,
      infiltrationPerS:
        this.waterTuning.infiltrationPerS ?? DEFAULT_SURFACE_WATER_FIELD.infiltrationPerS,
      evaporationPerS:
        this.waterTuning.evaporationPerS ?? DEFAULT_SURFACE_WATER_FIELD.evaporationPerS,
      maxDepthM: this.waterTuning.maxDepthM ?? DEFAULT_SURFACE_WATER_FIELD.maxDepthM,
      rainDepthPerS: this.waterTuning.rainDepthPerS ?? DEFAULT_SURFACE_WATER_FIELD.rainDepthPerS,
      dampOpacity: this.waterTuning.wetGroundOpacity ?? DEFAULT_SURFACE_WATER_FIELD.dampOpacity,
      dampDryPerS: this.waterTuning.wetGroundDryPerS ?? DEFAULT_SURFACE_WATER_FIELD.dampDryPerS,
      dampHaloCells:
        this.waterTuning.wetGroundHaloCells ?? DEFAULT_SURFACE_WATER_FIELD.dampHaloCells,
    });
    this.surfaceWater.setTerrainSampler((x, z) =>
      planetTerrainY(this.planetRadiusM, x, z, getTerrainParams()),
    );
    // 4b. The same field as a surface. The soil shader can paint water into the
    // ground, but a tint has no top: this mesh is the water's level in geometry,
    // so the pool has a surface that reflects the sky and a shoreline that ends
    // where the solve says the column does.
    if (this.waterTuning.enabled ?? true) {
      this.surfaceWaterMesh = createSurfaceWaterMesh({
        cells: this.surfaceWater.cells,
        extentM: this.surfaceWater.options.extentM,
        colors: this.waterTuning.colors ?? DEFAULT_WATER_COLORS,
        shoreDepthM: this.waterTuning.minVisibleDepthM ?? 0.01,
      });
      scene.add(this.surfaceWaterMesh.mesh);

      // The cave river is a second body on a lower bed, not a second tint: it
      // has its own level, its own flow and its own texture. The ground is what
      // hides it - the mesh is under the terrain, so the only place it can be
      // seen is a hole cut through that terrain, which is exactly where a river
      // running under the world should become visible.
      if (this.surfaceWater.underground) {
        this.undergroundWaterMesh = createSurfaceWaterMesh({
          cells: this.surfaceWater.cells,
          extentM: this.surfaceWater.options.extentM,
          colors: this.waterTuning.colors ?? DEFAULT_WATER_COLORS,
          shoreDepthM: this.waterTuning.minVisibleDepthM ?? 0.01,
          opacity: 0.82,
          name: 'undergroundWater',
        });
        this.undergroundWaterMesh.mesh.renderOrder = 1;
        scene.add(this.undergroundWaterMesh.mesh);
      }
    }

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
    const coverage = this.surfaceWater?.coverage() ?? 0;
    const snowing = this.surfaceWater?.mode() === 'snow';
    return snowing ? { water: 0, snow: coverage } : { water: coverage, snow: 0 };
  }

  /**
   * Dev readout: what each stacked body of water is holding.
   *
   * "Water above and below" is otherwise unverifiable from a screenshot - a
   * cave river is hidden by the ground it runs under - so the solve reports its
   * own volumes and the two numbers can be watched move independently.
   */
  public waterLayers(): { surfaceM3: number; undergroundM3: number; underground: boolean } {
    return {
      surfaceM3: this.surfaceWater?.volumeM3() ?? 0,
      undergroundM3: this.surfaceWater?.underground?.volumeM3() ?? 0,
      underground: Boolean(this.surfaceWater?.underground),
    };
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

  /**
   * Dev: pour water on the ground so the water rendering can be inspected.
   *
   * It goes into the rain field the soil shader draws from, which is the water
   * the game has: the old sheet pipeline is retired, so filling it would change
   * nothing on screen.
   */
  public debugFillSurface(depthM: number): void {
    this.surfaceWater?.addRain(depthM);
  }

  /** Dev diagnostic: how much water the world currently shows. */
  public getWaterDebug(): Record<string, number | boolean> {
    const field = this.surfaceWater;
    if (!field) return { enabled: false };
    let depthMax = 0;
    let depthSum = 0;
    const count = field.cells * field.cells;
    for (let i = 0; i < count; i += 1) {
      const depth = field.depthAt(
        field.originX + ((i % field.cells) + 0.5) * field.cellSizeM,
        field.originZ + (Math.floor(i / field.cells) + 0.5) * field.cellSizeM,
      );
      depthSum += depth;
      depthMax = Math.max(depthMax, depth);
    }
    return {
      enabled: true,
      surfaceVolumeM3: field.volumeM3(),
      surfaceDepthMaxM: Math.round(depthMax * 1000) / 1000,
      surfaceDepthMeanM: Math.round((depthSum / count) * 100000) / 100000,
      surfaceMeshCells: this.surfaceWaterMesh ? count : 0,
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
    const eye = this.camera.position;
    const surfaces: WaterSurfaceOverPoint[] = [];
    // The standing water is wherever the solved column is positive; its top is
    // the ground under that point plus the column it carries.
    const depth = this.surfaceWater?.depthAt(eye.x, eye.z) ?? 0;
    if (depth > 0) {
      surfaces.push({
        height:
          planetTerrainY(this.planetRadiusM, eye.x, eye.z, getTerrainParams()) + depth + 0.005,
        kind: 'puddle',
      });
    }
    // The sea is the one surface the field does not own: it is the planet's
    // curvature, not a sheet on the ground, so it is sampled here and appended
    // to the same list. Without it a step into the ocean read as a walk, with
    // clear air and a sky instead of water over the eye.
    //
    // Which sea depends on where the eye is. The local dome is a tangent grid
    // around the pole and its own parabola is the exact surface over that cap;
    // past the cap the water is the body's sphere, and the parabola is metres
    // out - a hundred at ten kilometres, four hundred at forty. Sampled with the
    // parabola, an eye two kilometres over open water on the far side read as
    // nine kilometres *under* it, so the whole frame was underwater: fog at a
    // twelfth of its reach, the horizon washed grey, and the sea's swell with
    // nothing left to be seen through.
    if (this.ocean) {
      const height = seaSurfaceHeightOver({
        x: eye.x,
        z: eye.z,
        domeReachM: OCEAN_DOME_REACH_M,
        planetSeaRadiusM: this.planetSea?.radiusM ?? 0,
        planetRadiusM: this.planetRadiusM,
        domeSurfaceY: this.ocean.seaSurfaceYAt(eye.x, eye.z),
      });
      if (height !== null) surfaces.push({ height, kind: 'sea' });
    }
    const state = sampleUnderwater(eye.y, surfaces);
    if (!state.submerged) {
      this.underwater = null;
      return;
    }
    this.underwater = state;
    this.underwaterTint.copy(
      worldColour(this.waterTuning.colors?.deep ?? DEFAULT_WATER_COLORS.deep),
    );
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
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.groundAnchorX = x;
    this.groundAnchorZ = z;
  }

  public update(dt: number, devOverrideUntil = 0, viewportHeightPx = 0): void {
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
      const eyeUnderNearPole = this.camera.position.y < surfaceY - 0.02;
      // How much air is between the eye and space. Everything above the soil is
      // a shell with a scale height of a few kilometres: a hill is still the
      // ground floor of the sky, a kilometre up is thin, and past the top of the
      // shell the eye is outside the atmosphere looking at a rock in vacuum.
      // Height is measured from the planet's centre, not straight up from
      // whatever sits under the eye on the pole's plane. A point 273 km from the
      // pole is not 273 km above the soil at that (x, z) - the body's own
      // curvature has dropped away from it - and the flat reading put an eye
      // 223 km up at 123 km, so the air, the far plane and the sky were all
      // sized for an altitude the eye was not at. Close to the surface, relief
      // still matters and the ground reading is the exact one.
      const centreY = -this.planetRadiusM;
      const offsetX = this.camera.position.x;
      const offsetY = this.camera.position.y - centreY;
      const offsetZ = this.camera.position.z;
      const radialDistance = Math.hypot(offsetX, offsetY, offsetZ);
      const radialAlt = radialDistance - this.planetRadiusM;
      const surfaceAlt = this.camera.position.y - surfaceY;
      // Which surface the eye is over.
      //
      // Inside the far field the authored patches own the ground and their own
      // height is the truth. Past it the body is the surface, and the flat
      // (x, z) reading is not: seventy kilometres from the pole that plane is
      // thirty kilometres under the eye, so an eye sixty metres above the far
      // side was classified as buried - the planet's skin was hidden, the sky
      // was told the eye was underground, and the LOD believed the eye was on
      // the ground. Measured radially, everything is already right.
      const arcFromPoleM =
        Math.acos(THREE.MathUtils.clamp(offsetY / Math.max(1e-6, radialDistance), -1, 1)) *
        this.planetRadiusM;
      const nearPole = arcFromPoleM < NEAR_POLE_ARC_M;
      const eyeUnder = nearPole ? eyeUnderNearPole : radialAlt < -0.5;
      this.eyeUnderSoil = eyeUnder;
      const reliefUnderEye = nearPole
        ? 0
        : Math.max(
            0,
            this.reliefAtDirection(this.reliefScratch.set(offsetX, offsetY, offsetZ).normalize()),
          );
      this.eyeAltitudeM = Math.max(
        0,
        nearPole && radialAlt <= 2_000 ? surfaceAlt : radialAlt - reliefUnderEye,
      );
      // The far plane is a hillside's reach at the soil. From a kilometre up the
      // planet is the thing in view, and from orbit it is a 100 km body 200 km
      // away: a 2.5 km far plane clipped the whole world out of the sky and left
      // the eye floating in gradient. The near plane rises with the far one so the
      // depth range stays usable instead of losing every metre to z-fighting.
      const horizonFar = THREE.MathUtils.clamp(
        2_500 * (1 + this.eyeAltitudeM / 60),
        2_500,
        // Planet view frames the body and the moon beside it; six planet radii
        // is the moon's orbit, and a far plane at four clipped it out of the
        // sky exactly when the player had climbed far enough to see it.
        Math.max(2_500, (this.planetViewActive ? 10 : 4) * this.planetRadiusM),
      );
      const horizonNear = Math.max(0.1, this.eyeAltitudeM * 0.002);
      if (
        Math.abs(this.camera.far - horizonFar) > 1 ||
        Math.abs(this.camera.near - horizonNear) > 0.01
      ) {
        this.camera.far = horizonFar;
        this.camera.near = horizonNear;
        this.camera.updateProjectionMatrix();
      }
      const airTarget = airDensityAt(this.eyeAltitudeM);
      // Eased, so climbing at a walk does not pop the sky from blue to black in
      // one frame and a fast climb still reads as passing through the air.
      this.airDensity += (airTarget - this.airDensity) * Math.min(1, dt * 4);
      const skyAir = this.sky.material.uniforms;
      if (skyAir.uAirDensity) skyAir.uAirDensity.value = this.airDensity;
      if (skyAir.uCloudAbove) {
        skyAir.uCloudAbove.value = cloudCoverAbove(this.eyeAltitudeM);
      }
      // The planet's limb, in dome coordinates: from the eye the horizon dips
      // by arccos(R / (R + altitude)), and that dip is where the last of the
      // air is seen edge-on and glows. From the soil it is zero: the edge of the
      // world is the horizon.
      if (skyAir.uLimbY) {
        const dip = Math.acos(
          THREE.MathUtils.clamp(
            this.planetRadiusM / (this.planetRadiusM + this.eyeAltitudeM),
            -1,
            1,
          ),
        );
        skyAir.uLimbY.value = Math.sin(dip);
      }
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
      const eyeBuried = eyeUnder && !eyeInPit && !this.planetViewActive;
      const skyUniforms = this.sky.material.uniforms;
      if (skyUniforms?.uEyeUnderGround) {
        skyUniforms.uEyeUnderGround.value = eyeBuried ? 1 : 0;
      }
      // The eye in the opening is under the sheet too. Its sky overhead is real
      // (the mouth is open), but nothing below its horizon is: that half of the
      // dome painted the pale below-horizon air straight through the cavity,
      // which is the frame where the sky sits along the bottom of the screen
      // with the ground along the top. One flag per half: the cone for an eye
      // buried away from the opening, the floor for an eye standing in it.
      if (skyUniforms?.uEyeInPit) {
        skyUniforms.uEyeInPit.value = eyeUnder && eyeInPit && !this.planetViewActive ? 1 : 0;
      }
      const groundUniforms = this.groundMaterial.userData.shader?.uniforms;
      if (groundUniforms?.uEyeUnderGround) {
        groundUniforms.uEyeUnderGround.value = eyeBuried ? 1 : 0;
      }
      this.updatePlanetBodyVisibility(eyeBuried);
      // The planet's own face at orbital range. The soil shader is a plot
      // shader - from 50 km up it averages into one brown disc - so above the
      // altitude where the play patch is subpixel a shell paints the world's
      // provinces, terminator and air instead (see environment/orbitalShell).
      if (this.orbitalShell) {
        this.orbitalShell.setSunDir(this.bodies.sunDir);
        this.orbitalShell.setTime(this.elapsedSeconds);
        // The weather's own cloudiness, the same number that thickens the sky's
        // overcast: orbit shows the sky the player is standing under, so a clear
        // day has no veil on the disc at all.
        this.orbitalShell.setCloudCover(
          THREE.MathUtils.clamp((1 - this.lightMultiplier) * 1.3, 0, 1),
        );
        this.orbitalShell.setFade(eyeBuried ? 0 : orbitalShellFadeForAltitude(this.eyeAltitudeM));
        // The coarse far sea is only worth building once the shell starts to
        // cover the real world; before that the ocean dome is what is on screen.
        // The mask is baked terrain, not a per-frame effect, and the shell
        // begins blending in at 25 km: build it now, or the first frames of the
        // climb paint the land flat brown (the far branch has no mask yet).
        if (this.eyeAltitudeM > ORBITAL_SHELL_FADE_START_M - 3000) this.ensureOrbitalFarMask();
      }
      // The whole body: which relief level is drawn, the body's own spin and
      // the moon's place on its orbit.
      this.updatePlanetSurfaces();
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
      // Water inside the opening would cover the roots with a dark disc, and
      // the water table stands above the cavity floor. Root Sight is a
      // cut-away, so water is clipped out of the same volume the soil shader
      // removes - not by a separate guess: the water shader reads these three
      // uniforms directly, so water and soil cannot disagree about the opening.
      if (this.surfaceWaterMesh) {
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
        this.surfaceWaterMesh.setCavityClip(
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
    // The same gas, looked through from above it. At the soil this is a 320 m
    // view; a kilometre up it is kilometres, and from orbit the whole planet has
    // to be visible instead of sitting in the haze of its own ground floor.
    const reach = fogReachAt(baseFog.far, this.eyeAltitudeM) / Math.max(1e-3, baseFog.far);
    const airFog = { near: baseFog.near * reach, far: baseFog.far * reach };
    const fogTargets = underwater ? underwaterFog(airFog, underwater) : airFog;
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = THREE.MathUtils.lerp(this.scene.fog.near, fogTargets.near, lerpRate);
      this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, fogTargets.far, lerpRate);
      this.scene.fog.color.lerp(this.sky.horizonColor, lerpRate);
      // And above the air the fog is not blue any more: from orbit the planet
      // hangs in black, so distance has to reach space, not a blue floor.
      if (this.airDensity < 0.999) {
        this.scene.fog.color.multiplyScalar(0.04 + 0.96 * this.airDensity);
      }
      if (underwater) this.scene.fog.color.lerp(this.underwaterTint, underwater.amount * 0.55);
    }
    if (this.scene.background instanceof THREE.Color) {
      // The clear colour is only ever seen where the sky dome is not - and from
      // altitude that is space. It was lerped to the horizon colour at every
      // altitude, so any frame the dome did not cover in orbit was pale
      // sky-violet in vacuum: the "purple instead of black" above the planet.
      // It now goes to black as the air thins, on the same density that dims
      // the fog, so the two cannot disagree at the limb.
      const vacuum = 0.04 + 0.96 * THREE.MathUtils.clamp(this.airDensity, 0, 1);
      this.backgroundTarget.copy(this.sky.horizonColor).multiplyScalar(vacuum);
      this.scene.background.lerp(this.backgroundTarget, lerpRate);
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
    // The soil's detail fade must follow the eye, not the LOD triangle. The
    // caller passes the drawing-buffer height (not the CSS size): device-pixel
    // ratio changes how many samples a metre gets and when fine detail aliases.
    updateGroundPixelAngle(this.groundMaterial, this.camera, viewportHeightPx);
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
    // Where the ground is, and what it holds, does not depend on the shower. The
    // cover lingers and dries for half a minute after the last drop, so it is
    // anchored to the player every frame: baking it only while rain fell left
    // yesterday's puddles behind the moment the player walked away from them.
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
    // A landing and a puddle both stand on the height field the ground is drawn
    // from, not on a plane at zero.
    if (this.planetRadiusM > 0 && !this.terrainSamplerBound) {
      this.terrainSamplerBound = true;
      this.rain.setTerrainSampler((x, z) =>
        planetTerrainY(this.planetRadiusM, x, z, getTerrainParams()),
      );
    }
    // Rain does not fall into the cavity: the opening is air, and a streak over
    // it was the one thing that made the cut look like a decal on a solid plane.
    {
      const aperture = this.soilUniforms.uRootSightApertureRadius.value;
      const apertureCentre = this.soilUniforms.uRootSightApertureCenter.value;
      this.rain.setCutaway(apertureCentre.x, apertureCentre.z, aperture);
    }
    // The hour lights what the shower left behind as much as the shower itself: a
    // puddle that keeps noon's colour after dusk is a sticker on the ground.
    this.rainTint.copy(this.sunLight.color).lerp(this.sky.horizonColor, 0.7);
    this.rainLightLevel = THREE.MathUtils.clamp(
      0.25 + this.ambientLight.intensity * 1.6 + this.sunLight.intensity * 0.25,
      0.2,
      1,
    );
    this.rain.setLight(this.rainTint, this.rainLightLevel);

    const precipitating = weatherTargets.isRaining || weatherTargets.isSnowing;
    const snowing = weatherTargets.isSnowing;
    if (precipitating) {
      // Weather does not fall inside the earth. A shower drawn over the cavity and
      // through the soil face was the one thing that made Root Sight read as an
      // outdoor scene with a brown filter on it.
      this.rain.setVisible(!this.eyeUnderSoil);
      this.rain.setMode(snowing ? 'snow' : 'rain');
    } else {
      this.rain.setVisible(false);
    }

    // 6. Standing water. It is solved around the player and drawn by the soil
    //    shader, so it is fed every frame - after the shower has stopped too, or
    //    the puddles would freeze at the depth they had when the rain left.
    if (this.surfaceWater) {
      this.surfaceWaterTime += dt;
      this.surfaceWater.setMode(snowing ? 'snow' : 'rain');
      const anchorX = Number.isFinite(this.groundAnchorX)
        ? this.groundAnchorX
        : this.camera.position.x;
      const anchorZ = Number.isFinite(this.groundAnchorZ)
        ? this.groundAnchorZ
        : this.camera.position.z;
      // Falling is only what is landing now; what has already landed keeps
      // draining even when the sky is clear.
      const falling = precipitating ? this.rain.intensity() : 0;
      // Rain is weather on the surface, not a function of the eye. Gating it on
      // `!eyeUnderSoil` meant a player who looked underground dried the whole
      // surface world out until they came back up.
      this.surfaceWater.update(dt, anchorX, anchorZ, falling);
      if (Number.isFinite(this.surfaceWater.originX)) {
        setSurfaceWater(this.groundMaterial, {
          texture: this.surfaceWater.texture,
          originX: this.surfaceWater.originX,
          originZ: this.surfaceWater.originZ,
          cellSizeM: this.surfaceWater.cellSizeM,
          cells: this.surfaceWater.cells,
          dampOpacity: this.waterTuning.wetGroundOpacity ?? 0.5,
          absorptionPerM: this.waterTuning.absorptionPerM ?? 1.6,
          time: this.surfaceWaterTime,
          rainStrength: precipitating && !snowing ? 1 : 0,
          snow: snowing,
        });
      }
      // The visible surface. It copies the solve's level and column at the
      // field's own upload rate rather than per frame: the solve only changes a
      // few times a second, and rewriting thirty-six thousand vertices to show
      // the same water is work for nothing.
      const mesh = this.surfaceWaterMesh;
      if (mesh && Number.isFinite(this.surfaceWater.originX)) {
        this.surfaceWaterSync += dt;
        // The solve uploads its texture at 10 Hz, and the contour is rebuilt at
        // 5 Hz: a shoreline moving in half-metre cells does not need a new
        // mesh every upload, and each rebuild is a full pass over the field.
        if (this.surfaceWaterSync >= 0.2) {
          this.surfaceWaterSync = 0;
          mesh.sync({
            texture: this.surfaceWater.texture,
            cells: this.surfaceWater.cells,
            cellSizeM: this.surfaceWater.cellSizeM,
            originX: this.surfaceWater.originX,
            originZ: this.surfaceWater.originZ,
          });
          const cave = this.undergroundWaterMesh;
          const caveSource = this.surfaceWater.underground;
          // A cave river can only be seen through a Root Sight opening. While
          // the cut is closed its contour was rebuilt in full every upload and
          // then drawn under opaque terrain, which was a pure loss.
          const caveVisible = this.soilUniforms.uRootSightProgress.value > 0.01;
          if (cave && caveSource) cave.mesh.visible = caveVisible;
          if (cave && caveSource && caveVisible) {
            cave.sync({
              texture: caveSource.texture,
              cells: this.surfaceWater.cells,
              cellSizeM: this.surfaceWater.cellSizeM,
              originX: this.surfaceWater.originX,
              originZ: this.surfaceWater.originZ,
            });
          }
        }
        mesh.updateLighting({
          timeSeconds: this.surfaceWaterTime,
          sunDir: this.bodies.sunDir,
          sunColor: this.sunLight.color,
          skyColor: this.sky.horizonColor,
          atmosphere: this.atmosphere,
        });
        const cave = this.undergroundWaterMesh;
        const caveSource = this.surfaceWater.underground;
        if (cave && caveSource) {
          cave.updateLighting({
            timeSeconds: this.surfaceWaterTime,
            sunDir: this.bodies.sunDir,
            sunColor: this.sunLight.color,
            skyColor: this.sky.horizonColor,
            atmosphere: this.atmosphere,
          });
        }
      }
    }

    // The sea is built once, so its light and its clock have to be fed like the
    // local sheet's: without this the ocean kept noon's colours through dusk,
    // its sky reflection was the palette's fixed horizon, and its waves did not
    // move at all (uTime stayed at zero).
    if (this.ocean) {
      const uniforms = this.ocean.material.material.uniforms;
      uniforms.uTime.value = this.surfaceWaterTime;
      (uniforms.uSunDir.value as THREE.Vector3).copy(this.bodies.sunDir);
      (uniforms.uSunColor.value as THREE.Color).copy(this.sunLight.color);
      (uniforms.uSkyColor.value as THREE.Color).copy(this.sky.horizonColor);
    }
    // The planet-wide sea is the same water and must be lit like it: without
    // this its waves would stand still and it would keep noon's colour after
    // dusk.
    if (this.planetSea) {
      const uniforms = this.planetSea.material.material.uniforms;
      uniforms.uTime.value = this.surfaceWaterTime;
      (uniforms.uSunDir.value as THREE.Vector3).copy(this.bodies.sunDir);
      (uniforms.uSunColor.value as THREE.Color).copy(this.sunLight.color);
      (uniforms.uSkyColor.value as THREE.Color).copy(this.sky.horizonColor);
      // The sea's wave trains retire by distance, and how far that is depends on
      // how high the eye is: a sixty-metre eye resolves a ripple for a few
      // hundred metres, a two-kilometre one for kilometres. Nothing wrote this
      // uniform, so the shader read zero and the sea kept a ground eye's reach
      // from any altitude.
      if (uniforms.uEyeAltitudeM) uniforms.uEyeAltitudeM.value = this.eyeAltitudeM;
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
  /** Told by the camera rig when the planet orbit opens or closes. */
  setPlanetViewActive(active: boolean): void {
    this.planetViewActive = active;
  }

  /** The body's axial spin this frame, radians. */
  getPlanetSpinRad(): number {
    return this.planetSpinRad;
  }

  /**
   * The body's own life: the static globe's visibility, axial spin, and the
   * moon's place.
   *
   * The spin is the hour angle of the planet, not of the camera. The sky's sun
   * direction already turns with the clock; the surface used to stay still under
   * it, so from orbit the world was a fixed picture with a moving light. The
   * whole surface now turns about its pole, which is the planet's axis and the
   * play area's own point - so the ground a plant stands on does not move while
   * the far side rotates through day and night. A dev time change therefore
   * rotates the face of the planet under the sun rather than only moving a light.
   */
  private updatePlanetSurfaces(): void {
    const params = this.reliefParams;
    if (!params) return;
    // One globe, always the same tessellation. The only surfaces that change
    // with the eye are the play disc and the transition ring (hidden under the
    // soil or in planet view). The globe itself stays on: the ring now covers
    // the old disc-to-globe step at every altitude, so hiding the globe below a
    // kilometre is no longer needed.
    const globe = this.ensureFarRelief(params);
    // The globe is the planet. It used to be hidden in planet view, which left
    // the zoomed-out camera looking at empty space until the separate orbital
    // shell appeared. Only soil can hide it now; the ring is still a surface-
    // view detail and gives way to the whole globe at planet scale.
    globe.visible = !this.eyeUnderSoil;
    if (this.horizonRing) {
      this.horizonRing.visible = !this.eyeUnderSoil && !this.planetViewActive;
    }
    // The globe's coarsest triangles span more than the play cap, so at ground
    // level one can bridge overhead as a brown ceiling. Cut them out under the
    // fine ring; planet view has no ring and needs the complete globe.
    const farCut = getGroundShader(this.groundMaterial)?.uniforms?.uFarReliefCutRadius;
    if (farCut) {
      farCut.value = this.horizonRing && !this.planetViewActive ? FAR_RELIEF_CUT_M : 0;
    }
    for (const mesh of this.terrainMeshes) {
      mesh.visible = !this.eyeUnderSoil && !this.planetViewActive;
    }
    // The terrain is world-fixed. It used to be turned by the hour, but only
    // the far levels and the shell were turned: the authored six-kilometre
    // square stayed where it was. At noon that is a half-turn, so the far
    // ground was the *south* terrain while the square under the player was the
    // north one - two different surfaces meeting at the square's edge, in two
    // different shades. The sun already moves through the sky and lights the
    // one surface; rotating the ground as well is what made the seam.
    this.planetSpinRad = 0;
    if (this.farReliefMesh) this.farReliefMesh.rotation.y = this.planetSpinRad;
    if (this.planetSea) this.planetSea.mesh.rotation.y = this.planetSpinRad;
    if (this.orbitalShell) this.orbitalShell.mesh.rotation.y = this.planetSpinRad;
    if (this.moonBody) {
      // The dome's disc is for an eye on the ground; a body 600 km out over the
      // same sky would be a second moon. It is drawn once the eye is high enough
      // that the dome's disc is no longer the thing being looked at.
      this.moonBody.mesh.visible = this.planetViewActive || this.eyeAltitudeM > 20_000;
      placeMoonBody(this.moonBody, this.planetCenter, this.bodies.moonDir, this.planetRadiusM);
    }
  }

  /**
   * Join the play disc to the planet, in one ring.
   *
   * The disc is a local relief cap raised above the global field. Its rim wall
   * hides the seam from a ground eye, but from a kilometre up the cap reads as
   * a circular plate: the rim is a step down to the globe. The ring starts on
   * that same rim, slopes the local cap into the global field over 1.8 km, and
   * then follows the global field itself, so there is one continuous surface
   * from the player's ground to the far side of the planet.
   */
  private ensureHorizonRing(params: PlanetReliefParams): THREE.Mesh | null {
    if (this.horizonRing) return this.horizonRing;
    const disk = this.planetDetailMesh ?? this.scene.getObjectByName('planet-play-disk');
    const inner = Number(disk?.userData.playRadiusM);
    if (!(inner > 0) || !(this.planetRadiusM > 0)) return null;
    const segments = Number(disk?.userData.playDiskSegments) || 512;
    const radius = this.planetRadiusM;
    const direction = new THREE.Vector3();
    const outer = Math.max(inner + HORIZON_RING_BLEND_M, HORIZON_RING_OUTER_M);
    const heightAt = (x: number, z: number): number => {
      const r = Math.hypot(x, z);
      const surface = planetSurfaceY(radius, x, z);
      const local = surface + TERRAIN_SKIN_M;
      const t = Math.min(1, Math.max(0, (r - inner) / HORIZON_RING_BLEND_M));
      if (t <= 0) return local;
      const blend = t * t * (3 - 2 * t);
      // The global field is measured from the body's centre, not the tangent
      // plane, so the sample direction has to include the surface's curvature.
      direction.set(x, surface + radius, z).normalize();
      const global = surface + planetReliefAt(direction, params) - FAR_RELIEF_FALLBACK_SINK_M;
      return local + (global - local) * blend;
    };
    const ring = createSurfaceRing({
      innerRadiusM: inner,
      outerRadiusM: outer,
      segments,
      rows: 48,
      heightAt,
      material: this.groundMaterial,
      lipDepthM: HORIZON_RING_LIP_M,
      name: 'planet-horizon-ring',
    });
    this.scene.add(ring);
    this.horizonRing = ring;
    return ring;
  }

  private ensureFarRelief(params: PlanetReliefParams): THREE.Mesh {
    if (this.farReliefMesh) return this.farReliefMesh;
    this.farReliefMesh = createFarReliefMesh({
      radiusM: this.planetRadiusM,
      material: this.groundMaterial,
      // The globe uses the planet-wide field only. The authored six-kilometre
      // far field is a square from the retired LOD pipeline: drawing it on a
      // coarse globe recreated its stamped-block edge and its vertical facets.
      // The play disc owns the authored ground; outside it the globe is one
      // continuous field, with no square to find from any altitude.
      reliefAt: (direction) => planetReliefAt(direction, params) - FAR_RELIEF_FALLBACK_SINK_M,
      detail: FAR_RELIEF_DETAIL,
    });
    this.scene.add(this.farReliefMesh);
    return this.farReliefMesh;
  }

  private updatePlanetBodyVisibility(eyeUnder: boolean): void {
    if (this.planetDetailMesh) {
      // The detail patch is a child of the body, so the body's zero draw range
      // does not hide it. From orbit it was the small bright speck showing
      // through the night side (S37); the orbital face owns the view there.
      this.planetDetailMesh.visible = !eyeUnder && !this.planetViewActive;
    }
    if (this.planetBodyMesh) {
      // The body is a bare sphere at the mean radius. It is not a backdrop: its
      // surface is *above* every basin in the relief, so wherever the ground
      // dips below zero the body punched through it in coarse sphere facets -
      // the diamond lattice that covered the disc from orbit. With the relief
      // field on, the whole sphere is covered by a real surface (the authored
      // cap, the chunk tree, or a whole-sphere relief level), so the body is
      // never the thing being seen and must not draw at all. A dry world made
      // this visible: the sea used to hide the body's top half.
      const reliefCovers = (this.reliefParams?.amplitudeM ?? 0) > 0;
      this.planetBodyMesh.geometry.setDrawRange(
        0,
        eyeUnder || reliefCovers ? 0 : this.planetBodyDrawCount,
      );
    }
    // The arch stands on the skin, so it is scenery of the surface: a buried
    // eye is inside the earth and sees none of it.
    if (this.terrainVolume) this.terrainVolume.visible = !eyeUnder;
  }

  /**
   * Keep the aperture soil body in step with the cavity. The shaft is part of the
   * opening whenever it is open, not only while an eye is buried: from above it
   * gives the pit a real inward-facing wall and floor under the bowl, and from
   * below it is the earth the buried eye sees. Rebuilt when the aperture changes
   * size or moves, which is a Root Sight open or a reroot, not a per-frame event.
   */
  /**
   * Bake the shell's planet-wide sea mask, once.
   *
   * The ocean's bed texture is 6.4 km across: enough to carry the real coast and
   * the near islands through the shell's fade, but the ground beyond it is the
   * bare body, which lies under sea level everywhere. Without this the shell
   * painted land to the limb over an ocean. Heights here are relief above the
   * sphere, so the sea level is one number and the shader needs no curvature
   * term. Only the drawn world (the 12 km far field) contributes relief; past
   * that the body itself is the bed. The radial sqrt warp spends texels on the
   * land at the pole instead of on open water.
   */
  private ensureOrbitalFarMask(): void {
    if (this.orbitalFarMask || !this.orbitalShell) return;
    const width = 512;
    const height = 256;
    const field = getTerrainParams();
    const relief = this.reliefParams;
    const seaLevelM = this.waterTuning.seaLevelM ?? DEFAULT_WATER_FIELD_TUNING.seaLevelM;
    const heights = new Float32Array(width * height);
    const direction = new THREE.Vector3();
    let minM = Number.POSITIVE_INFINITY;
    let maxM = Number.NEGATIVE_INFINITY;
    const latitudeStep = Math.PI / height;
    const longitudeStep = (Math.PI * 2) / width;
    // Four samples a texel, at the quarter points. Even with the short octaves
    // filtered out the 2 km hills are barely two texels wide, so one point per
    // texel picked a different hill on every row and the disc grew a moire.
    // Averaging is what a kilometre-wide look at the ground physically is.
    const offsets = [-0.25, 0.25];
    const sampleAt = (latitude: number, longitude: number): number => {
      const cosLat = Math.cos(latitude);
      direction.set(cosLat * Math.cos(longitude), Math.sin(latitude), cosLat * Math.sin(longitude));
      return relief
        ? terrainRelief(direction.x * this.planetRadiusM, direction.z * this.planetRadiusM, field) +
            planetReliefAt(direction, relief, 1_000)
        : terrainRelief(direction.x * this.planetRadiusM, direction.z * this.planetRadiusM, field);
    };
    for (let j = 0; j < height; j += 1) {
      const latitude = (0.5 - (j + 0.5) / height) * Math.PI;
      for (let i = 0; i < width; i += 1) {
        const longitude = ((i + 0.5) / width - 0.5) * Math.PI * 2;
        let value = 0;
        for (const dLat of offsets) {
          const lat = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, latitude + dLat * latitudeStep));
          for (const dLon of offsets) {
            value += sampleAt(lat, longitude + dLon * longitudeStep);
          }
        }
        value *= 0.25;
        heights[j * width + i] = value;
        if (value < minM) minM = value;
        if (value > maxM) maxM = value;
      }
    }
    if (!Number.isFinite(minM) || !Number.isFinite(maxM)) {
      minM = -1;
      maxM = 1;
    }
    const spanM = Math.max(0.001, maxM - minM);
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < heights.length; i += 1) {
      const value = Math.round(Math.min(1, Math.max(0, (heights[i] - minM) / spanM)) * 255);
      const at = i * 4;
      data[at] = value;
      data[at + 1] = value;
      data[at + 2] = value;
      data[at + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    // The mask wraps around the planet's axis, and its texels are metres apart
    // at the limb: a mip chain is what stops the coast from crawling there.
    texture.wrapS = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    this.orbitalFarMask = texture;
    this.orbitalShell.setFarLandMask(texture, {
      extentM: this.planetRadiusM,
      minM,
      spanM,
      seaLevelM,
    });
    // The mask carries the relief either way; with no sea it must not paint a
    // waterline or coastal foam, or a dry world still has blue shores to orbit.
    this.orbitalShell.setSeaEnabled(this.planetSea !== null);
    // The mask is 512 columns around the body, so one texel is this many metres
    // of arc: the relief shading turns its height gradient into a real slope
    // with it.
    this.orbitalShell.setReliefTexelArc((2 * Math.PI * this.planetRadiusM) / 512);
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
    // The rim's shadow needs the same sun the ground and the sky use, so the
    // dark side of the pit is the side the light is not on.
    setCavityBowlSun(this.cavityBowl, this.bodies.sunDir);
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
   * Dev: what the water surfaces actually are. There is one now - the level
   * surface built from the rain field - so the report says whether it exists,
   * what it is made of and the box it covers in world space.
   */
  public describeWaterSurfaces(): Array<Record<string, unknown>> {
    const entries: Array<[string, THREE.Mesh | null]> = [
      ['surface', this.surfaceWaterMesh?.mesh ?? null],
      ['underground', this.undergroundWaterMesh?.mesh ?? null],
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

  /**
   * The tint and dimming the weather's drops take from the sky this frame.
   *
   * The WebGPU rain has to use the same values the three.js drops do, or it
   * keeps its own colour while the sun sets: a hardcoded grey is white at dusk
   * and a grey bar at midnight.
   */
  public getRainLight(): { color: THREE.Color; level: number } {
    return { color: this.rainTint, level: this.rainLightLevel };
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

  /**
   * The drawn relief at a direction on the sphere, metres above the base radius.
   *
   * Same function the ground, the relief shells and the orbital face read, so a
   * camera clearance taken from it is a clearance over the surface that is
   * actually there - not over the mean sphere.
   */
  public reliefAtDirection(direction: THREE.Vector3): number {
    if (this.planetRadiusM <= 0) return 0;
    const field = getTerrainParams();
    // The body turns by its hour angle and the field is planet-fixed, so the
    // height under a world direction has to be read from the direction *before*
    // the turn. Without this the camera's floor came from the far side of the
    // planet: at noon the eye could be dropped straight through the ground it was
    // looking at and end up under it, staring at the inside of the shell. This is
    // the one place the two frames meet, so the unspin lives here.
    const dir = this.reliefSpinScratch.copy(direction);
    const spin = this.planetSpinRad;
    if (Math.abs(spin) > 1e-9) {
      const c = Math.cos(spin);
      const s = Math.sin(spin);
      dir.set(direction.x * c - direction.z * s, direction.y, direction.x * s + direction.z * c);
    }
    if (this.reliefParams) {
      return planetSurfaceReliefAt(dir, this.planetRadiusM, field, this.reliefParams);
    }
    return terrainRelief(dir.x * this.planetRadiusM, dir.z * this.planetRadiusM, field);
  }

  /** Current sun color. */
  public getSunColor(): THREE.Color {
    return this.sunLight.color.clone();
  }

  /** Current weather state (for dev controls). */
  public getWeatherState(): string {
    return this.weatherMachine.getState();
  }

  /**
   * Release the meshes and textures this renderer created. The ground material
   * is shared with the terrain relief, so it is not disposed here; everything
   * below is this class's own.
   */
  public dispose(): void {
    this.surfaceWater?.dispose();
    this.surfaceWater = null;
    if (this.surfaceWaterMesh) {
      this.scene.remove(this.surfaceWaterMesh.mesh);
      this.surfaceWaterMesh.dispose();
      this.surfaceWaterMesh = null;
    }
    if (this.undergroundWaterMesh) {
      this.scene.remove(this.undergroundWaterMesh.mesh);
      this.undergroundWaterMesh.dispose();
      this.undergroundWaterMesh = null;
    }
    if (this.terrainVolume) {
      this.scene.remove(this.terrainVolume);
      this.terrainVolume.geometry.dispose();
      (this.terrainVolume.material as THREE.Material).dispose();
      this.terrainVolume = null;
    }
    if (this.cavityBowl) {
      this.scene.remove(this.cavityBowl);
      this.cavityBowl.geometry.dispose();
      (this.cavityBowl.material as THREE.Material).dispose();
      this.cavityBowl = null;
    }
  }
}
