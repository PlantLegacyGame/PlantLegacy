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
import * as THREE from 'three';
import type { RenderConfig } from '../config/clientConfig.js';
import type { ClientWeatherState, ClientWeatherStateMachine } from './ClientWeatherStateMachine.js';
import { createCavityBowl, updateCavityBowl } from './environment/cavityBowl.js';
import {
  applyCelestialLighting,
  type CelestialBodies,
  updateCelestialBodies,
} from './environment/celestial.js';
import {
  createGround,
  getGroundShader,
  setGroundMoisture,
  updateGroundSun,
} from './environment/ground.js';
import { createSubsoil } from './environment/planetSurface.js';
import { createRainSystem, type RainSystem } from './environment/rainSystem.js';
import {
  createResourceGrid,
  DEFAULT_TILE_NORMALIZATION,
  type ResourceGrid,
  type ResourceTile,
  type TileNormalization,
} from './environment/resourceGrid.js';
import {
  createRootSightUniforms,
  type RootSightUniforms,
} from './environment/rootSightUniforms.js';
import { createSkyDome, type SkyDome } from './environment/skyDome.js';
import { createEnvironmentWeatherMachine } from './environment/weatherPresets.js';

export type { RootSightUniforms as EnvironmentUniforms } from './environment/rootSightUniforms.js';
export { createRootSightUniforms } from './environment/rootSightUniforms.js';

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
  // Dirt layer under the surface, shown only while Root Sight opens the ground.
  private subsoil: THREE.Mesh | null = null;
  /** Metre-scale ground patch, exposed so physics can collide with the relief. */
  terrainPatch: THREE.Mesh | null = null;
  // The cavity as real geometry: a dug bowl of earth under the opening.
  private cavityBowl: THREE.Mesh | null = null;
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

  // Lightning bookkeeping for the storm
  private lightningTimer = 0;

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
    soilUniforms: RootSightUniforms = createRootSightUniforms(),
    tuning: EnvironmentTuning = {},
  ) {
    this.scene = scene;
    this.camera = camera;
    this.config = config;
    this.tiles = tuning.tiles ?? DEFAULT_TILE_NORMALIZATION;
    this.dayLengthSeconds = tuning.dayLengthSeconds ?? DEFAULT_DAY_LENGTH_SECONDS;
    this.undergroundColor.set(config.undergroundViewColor);
    this.soilUniforms = soilUniforms;
    this.sunLight = sunLight;
    this.ambientLight = ambientLight;
    this.hemisphereLight = hemisphereLight;

    this.weatherMachine = createEnvironmentWeatherMachine(config);

    // 1. Sky dome, centred on the camera so it reads as infinite sky.
    this.sky = createSkyDome(scene, camera, config, this.bodies.sunDir, this.bodies.moonDir);

    // 1b. Root Sight: the cavity is drawn by the soil shader itself (marching
    //     the fused node bubbles), so all this layer keeps is the dug-earth
    //     colour it shades the interior wall and rim with.
    this.cavityWallColor.set(config.undergroundViewColor).multiplyScalar(1.9);
    this.soilUniforms.uRootSightWallColor.value.copy(this.cavityWallColor);

    // 2. Terrain and the Root Sight cutaway.
    const ground = createGround(scene, config, soilUniforms, tuning.showGround ?? true);
    this.groundMaterial = ground.material;
    this.groundMesh = ground.mesh;
    this.terrainPatch = (ground.mesh?.getObjectByName('planet-terrain') as THREE.Mesh) ?? null;

    // 2a. The earth inside the Root Sight opening. Real geometry instead of
    //     shading faked in the soil shader, so the pit has parallax and looks
    //     the same from every angle. Built once at unit radius, scaled per frame.
    if (tuning.showGround ?? true) {
      this.cavityBowl = createCavityBowl(
        new THREE.Color(config.soilWetColor).multiplyScalar(0.9),
        new THREE.Color(config.undergroundViewColor).multiplyScalar(1.6),
      );
      scene.add(this.cavityBowl);
    }
    // 2b. The dirt under the surface. A real sphere one soil depth down, so an
    //     opening lands on geometry rather than on a shaded hole; kept hidden
    //     until Root Sight needs it, which costs nothing while it is closed.
    if (config.planetRadiusM > 0 && (tuning.showGround ?? true)) {
      this.planetRadiusM = config.planetRadiusM;
      this.planetCenter.set(0, -config.planetRadiusM, 0);
      this.subsoil = createSubsoil(
        config.planetRadiusM,
        config.soilDepthM,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(config.soilWetColor).multiplyScalar(0.3),
          roughness: 1,
          metalness: 0,
        }),
      );
      scene.add(this.subsoil);
    }
    this.resourceGrid = createResourceGrid(() => getGroundShader(this.groundMaterial), this.tiles);

    // 3. Rain.
    this.rain = createRainSystem(scene, config, tuning.showRain ?? true);

    // Initial weather state and lighting, before the first render.
    this.weatherMachine.requestStateChange('clear');
    this.updateSunPosition();
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

  /** Per-frame render loop update. */
  public update(dt: number, devOverrideUntil = 0): void {
    const lerpRate = Math.min(1.0, dt * 2.5);

    // Advance client timeOfDay (server is authority, client interpolates) unless
    // a dev override is holding the clock.
    if (!this.timeFrozen && Date.now() >= devOverrideUntil) {
      this.timeOfDay = (this.timeOfDay + (dt * this.timeScale) / this.dayLengthSeconds) % 1.0;
    }

    const weatherTargets = this.weatherMachine.update(dt, this.timeOfDay, this.sunIntensity);

    this.updateSunPosition();

    // The sky dome is camera-centred, so it never warps as the camera moves.
    this.sky.mesh.position.copy(this.camera.position);

    // Root Sight is entirely a soil-shader effect: no backdrop sphere, no
    // separate cavity mesh, nothing to draw behind the terrain. The sky stays
    // on even under the surface — the ground encloses the camera, so the only
    // place sky can appear is through the opening, which is exactly what
    // looking up out of the hole should show.
    this.sky.mesh.visible = true;
    if (this.subsoil) {
      // Drawn whenever the eye is above the floor of the dirt layer, above the
      // surface or just under it. Measured radially from the planet centre so
      // it is correct anywhere on the planet, and never while the eye is at or
      // below the floor itself: from inside, that sphere's own surface would
      // wrap the whole view and read as a horizon (the dome that kept coming
      // back).
      const depthBelowSurface =
        this.planetRadiusM - this.camera.position.distanceTo(this.planetCenter);
      const eyeUnder = this.planetRadiusM > 0 && depthBelowSurface > 0.02;
      // Above the surface only: down there the eye is inside the soil layer and
      // this sphere is a plane a hand's width below it, which is exactly the
      // wall-to-wall dirt horizon that must not happen. The sky dome paints
      // earth below the horizon instead, so the view is enclosed without it.
      this.subsoil.visible = this.soilUniforms.uRootSightProgress.value > 0.01 && !eyeUnder;
      const skyUniforms = this.sky.material.uniforms;
      if (skyUniforms?.uEyeUnderGround) {
        skyUniforms.uEyeUnderGround.value = eyeUnder ? 1 : 0;
      }
    }
    if (this.cavityBowl) {
      updateCavityBowl(
        this.cavityBowl,
        this.soilUniforms.uRootSightCenter.value,
        this.soilUniforms.uRootSightRadius.value,
        this.soilUniforms.uRootSightProgress.value,
      );
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

    // 2. Atmospheric fog follows the horizon.
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = THREE.MathUtils.lerp(
        this.scene.fog.near,
        weatherTargets.fogNear,
        lerpRate,
      );
      this.scene.fog.far = THREE.MathUtils.lerp(
        this.scene.fog.far,
        weatherTargets.fogFar,
        lerpRate,
      );
      this.scene.fog.color.lerp(this.sky.horizonColor, lerpRate);
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
    setGroundMoisture(this.groundMaterial, this.soilMoisture);
    updateGroundSun(
      this.groundMaterial,
      this.bodies.sunDir,
      this.sunLight.color,
      this.sunLight.intensity,
    );

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

    // 6. Lightning: the weather machine emits intensity, this adds it as a flash.
    const lightningIntensity = weatherTargets.lightningIntensity;
    if (lightningIntensity > 0) {
      this.ambientLight.intensity += lightningIntensity * 0.5;
    }
    if (this.weatherMachine.getState() === 'thunderstorm_active') {
      this.lightningTimer += dt;
    }
  }

  /** Position the sun/moon and grade the sky for the current time of day. */
  private updateSunPosition(): void {
    const elevation = updateCelestialBodies(this.bodies, this.timeOfDay);
    applyCelestialLighting({
      config: this.config,
      sunLight: this.sunLight,
      ambientLight: this.ambientLight,
      skyMaterial: this.sky.material,
      bodies: this.bodies,
      elevation,
      sunIntensity: this.sunIntensity,
      sunOrbitalDistance: this.config.sunOrbitalDistance,
    });
  }

  /** The terrain mesh, or null when the ground is hidden. */
  public getGroundMesh(): THREE.Mesh | null {
    return this.groundMesh;
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
