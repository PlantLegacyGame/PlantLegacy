import * as THREE from 'three';
import type { RenderConfig } from '../config/clientConfig.js';

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

export interface EnvironmentUniforms {
  uRootSightProgress: { value: number };
  uRootSightCenter: { value: THREE.Vector3 };
  uRootSightRadius: { value: number };
  uRootSightSoilOpacity: { value: number };
}

/**
 * C03 Environment Renderer
 *
 * Implements:
 * 1. Continuous day/night sky dome with zenith/horizon atmospheric gradient & celestial arcs
 * 2. Sun & Moon orbital lighting grading dynamically responding to T07 weather states
 * 3. Atmospheric distance fog continuously blending with horizon colors and weather density
 * 4. Lightweight instanced/points rain particle system respecting phone budget
 * 5. Thunderstorm lightning flashes, telegraph ominous tint, and aftermath clearing
 * 6. Soil moisture and mineral tinting reusing & refining the T02 Root Sight cutaway shader
 */
export class EnvironmentRenderer {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private config: RenderConfig;

  // Sky dome
  private skyMesh: THREE.Mesh;
  private skyMaterial: THREE.ShaderMaterial;
  private currentZenithColor: THREE.Color = new THREE.Color();
  private currentHorizonColor: THREE.Color = new THREE.Color();
  private targetZenithColor: THREE.Color = new THREE.Color();
  private targetHorizonColor: THREE.Color = new THREE.Color();

  // Celestial lighting
  private sunLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private hemisphereLight: THREE.HemisphereLight;
  private sunDir: THREE.Vector3 = new THREE.Vector3();
  private moonDir: THREE.Vector3 = new THREE.Vector3();

  // Terrain / Ground mesh
  private groundMesh: THREE.Mesh;
  private groundMaterial: THREE.MeshStandardMaterial;
  private soilMoisture = 0.2;
  private targetSoilMoisture = 0.2;

  // Atmospheric fog
  private targetFogNear: number;
  private targetFogFar: number;

  // Rain particle system
  private rainPoints: THREE.Points;
  private rainGeometry: THREE.BufferGeometry;
  private rainPositions: Float32Array;
  private rainVelocities: Float32Array;
  private isRaining = false;

  // Lightning system for thunderstorm
  private lightningTimer = 0;
  private nextLightningDelay = 5.0;
  private lightningActive = false;
  private lightningTimeRemaining = 0;
  private lightningFlashIntensity = 0;

  // Weather state cache
  private currentWeatherState = 'clear';
  private timeOfDay = 0.3;
  private sunIntensity = 1.0;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    config: RenderConfig,
    sunLight: THREE.DirectionalLight,
    ambientLight: THREE.AmbientLight,
    hemisphereLight: THREE.HemisphereLight,
    soilUniforms: EnvironmentUniforms,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.config = config;
    this.sunLight = sunLight;
    this.ambientLight = ambientLight;
    this.hemisphereLight = hemisphereLight;

    this.targetFogNear = config.fogNearClear;
    this.targetFogFar = config.fogFarClear;

    // 1. Sky Dome Geometry & Shader
    const skyRadius = Math.max(300, config.terrainRadius * 1.5);
    const skyGeo = new THREE.SphereGeometry(skyRadius, 32, 16);
    this.currentZenithColor.set(config.skyZenithDay);
    this.currentHorizonColor.set(config.skyHorizonDay);

    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uZenithColor: { value: this.currentZenithColor },
        uHorizonColor: { value: this.currentHorizonColor },
        uSunDir: { value: this.sunDir },
        uSunColor: { value: new THREE.Color(config.sunColorDay) },
        uSunIntensity: { value: config.sunIntensityDay },
        uMoonDir: { value: this.moonDir },
        uMoonColor: { value: new THREE.Color(config.sunColorNight) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        uniform vec3 uZenithColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uSunIntensity;
        uniform vec3 uMoonDir;
        uniform vec3 uMoonColor;

        void main() {
          vec3 dir = normalize(vWorldPosition);
          float h = clamp(dir.y, 0.0, 1.0);
          float grad = pow(1.0 - h, 2.2);
          vec3 sky = mix(uZenithColor, uHorizonColor, grad);

          // Solar disc and corona
          if (uSunDir.y > -0.1) {
            float sunDot = max(0.0, dot(dir, normalize(uSunDir)));
            float sunCore = pow(sunDot, 512.0) * 1.8;
            float sunHalo = pow(sunDot, 24.0) * 0.35;
            sky += uSunColor * (sunCore + sunHalo) * clamp(uSunIntensity, 0.0, 1.5);
          }

          // Lunar disc and soft glow
          if (uMoonDir.y > -0.1) {
            float moonDot = max(0.0, dot(dir, normalize(uMoonDir)));
            float moonCore = pow(moonDot, 384.0) * 0.9;
            float moonHalo = pow(moonDot, 20.0) * 0.15;
            sky += uMoonColor * (moonCore + moonHalo);
          }

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.skyMesh.renderOrder = -100;
    this.scene.add(this.skyMesh);

    // 2. Terrain Ground Mesh & Soil Shader (Refines T02 Root Sight Cutaway)
    const groundGeo = new THREE.CircleGeometry(
      config.terrainRadius,
      config.terrainMeshSubdivisions,
    );
    this.groundMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config.soilDryColor),
      roughness: 0.95,
      metalness: 0.02,
      transparent: true,
    });

    const soilDry = new THREE.Color(config.soilDryColor);
    const soilWet = new THREE.Color(config.soilWetColor);
    const soilMineral = new THREE.Color(config.soilMineralTint);

    this.groundMaterial.onBeforeCompile = (shader) => {
      this.groundMaterial.userData.shader = shader;
      shader.uniforms.uRootSightProgress = soilUniforms.uRootSightProgress;
      shader.uniforms.uRootSightCenter = soilUniforms.uRootSightCenter;
      shader.uniforms.uRootSightRadius = soilUniforms.uRootSightRadius;
      shader.uniforms.uRootSightSoilOpacity = soilUniforms.uRootSightSoilOpacity;
      shader.uniforms.uSoilDryColor = { value: soilDry };
      shader.uniforms.uSoilWetColor = { value: soilWet };
      shader.uniforms.uSoilMineralColor = { value: soilMineral };
      shader.uniforms.uSoilMoisture = { value: this.soilMoisture };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSoilWorldPos;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvSoilWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vSoilWorldPos;
uniform float uRootSightProgress;
uniform vec3 uRootSightCenter;
uniform float uRootSightRadius;
uniform float uRootSightSoilOpacity;
uniform vec3 uSoilDryColor;
uniform vec3 uSoilWetColor;
uniform vec3 uSoilMineralColor;
uniform float uSoilMoisture;`,
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
// C03: Soil moisture darkening & subtle mineral accents
vec3 dynamicSoil = mix(uSoilDryColor, uSoilWetColor, clamp(uSoilMoisture, 0.0, 1.0));
float mineralNoise = fract(sin(dot(vSoilWorldPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
dynamicSoil = mix(dynamicSoil, uSoilMineralColor, mineralNoise * 0.08);
gl_FragColor.rgb = mix(dynamicSoil, gl_FragColor.rgb, 0.35);

// T02 Root Sight cutaway preservation & refinement
float soilDist = distance(vSoilWorldPos, uRootSightCenter);
float soilCut = 1.0 - smoothstep(uRootSightRadius * 0.85, uRootSightRadius, soilDist);
gl_FragColor.a = mix(1.0, uRootSightSoilOpacity, soilCut * uRootSightProgress);`,
        );
    };
    this.groundMaterial.customProgramCacheKey = () => 'c03-environment-ground-v1';

    this.groundMesh = new THREE.Mesh(groundGeo, this.groundMaterial);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = -0.03;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    // 3. Rain Particle System (Phone budget friendly: single Points draw call)
    const count = config.rainParticleCount;
    this.rainPositions = new Float32Array(count * 3);
    this.rainVelocities = new Float32Array(count);

    const h = config.rainBoxHeight;
    for (let i = 0; i < count; i++) {
      this.rainPositions[i * 3 + 0] = (Math.random() - 0.5) * config.rainBoxWidth;
      this.rainPositions[i * 3 + 1] = Math.random() * h;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * config.rainBoxWidth;
      this.rainVelocities[i] = config.rainParticleSpeed * (0.85 + Math.random() * 0.3);
    }

    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));

    const rainMat = new THREE.PointsMaterial({
      color: 0x90b4ce,
      size: config.rainParticleSize,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });

    this.rainPoints = new THREE.Points(this.rainGeometry, rainMat);
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);

    // Initial weather state setup
    this.applyWeatherState('clear', 0.3, 1.0);
  }

  /**
   * Called whenever server broadcasts WEATHER_UPDATE (type 21)
   */
  public handleWeatherUpdate(payload: WeatherPayload): void {
    this.currentWeatherState = payload.weatherState;
    this.timeOfDay = payload.timeOfDay;
    this.sunIntensity = payload.sunIntensity;

    this.applyWeatherState(payload.weatherState, payload.timeOfDay, payload.sunIntensity);
  }

  /**
   * Interpolates colors, fog targets, and lights based on diurnal cycle and weather
   */
  private applyWeatherState(state: string, timeOfDay: number, sunIntensity: number): void {
    const cfg = this.config;

    // 1. Calculate Day / Dusk / Night base colors
    // Sun orbital elevation angle: 0 at sunrise, 1 at noon, 0 at sunset, negative at night
    const sunAngle = timeOfDay * Math.PI * 2 - Math.PI / 2;
    const sunElev = Math.sin(sunAngle);

    // Calculate celestial directions
    this.sunDir.set(Math.cos(sunAngle) * 0.8, sunElev, Math.sin(sunAngle) * 0.4).normalize();
    this.moonDir.set(-this.sunDir.x, -this.sunDir.y, -this.sunDir.z).normalize();

    // Diurnal factor: 1.0 = full midday, 0.0 = night, in-between = dawn/dusk
    const dayFactor = THREE.MathUtils.smoothstep(sunElev, -0.05, 0.35);
    const duskFactor = (1.0 - Math.abs(sunElev * 3.0)) * (1.0 - dayFactor);

    const baseZenith = new THREE.Color(cfg.skyZenithNight).lerp(
      new THREE.Color(cfg.skyZenithDay),
      dayFactor,
    );
    if (duskFactor > 0.05) {
      baseZenith.lerp(new THREE.Color(cfg.skyZenithDusk), duskFactor * 0.7);
    }

    const baseHorizon = new THREE.Color(cfg.skyHorizonNight).lerp(
      new THREE.Color(cfg.skyHorizonDay),
      dayFactor,
    );
    if (duskFactor > 0.05) {
      baseHorizon.lerp(new THREE.Color(cfg.skyHorizonDusk), duskFactor * 0.85);
    }

    // 2. Weather Overrides
    if (state === 'rain') {
      this.targetZenithColor.copy(baseZenith).lerp(new THREE.Color(cfg.skyZenithRain), 0.75);
      this.targetHorizonColor.copy(baseHorizon).lerp(new THREE.Color(cfg.skyHorizonRain), 0.8);
      this.targetFogNear = cfg.fogNearRain;
      this.targetFogFar = cfg.fogFarRain;
      this.isRaining = true;
      this.targetSoilMoisture = 0.85;
    } else if (state === 'thunderstorm_telegraph') {
      this.targetZenithColor.copy(baseZenith).lerp(new THREE.Color(cfg.skyZenithTelegraph), 0.85);
      this.targetHorizonColor
        .copy(baseHorizon)
        .lerp(new THREE.Color(cfg.skyHorizonTelegraph), 0.85);
      this.targetFogNear = (cfg.fogNearClear + cfg.fogNearRain) * 0.5;
      this.targetFogFar = (cfg.fogFarClear + cfg.fogFarRain) * 0.5;
      this.isRaining = false;
      this.targetSoilMoisture = 0.4;
    } else if (state === 'thunderstorm_active') {
      this.targetZenithColor.copy(baseZenith).lerp(new THREE.Color(cfg.skyZenithStorm), 0.9);
      this.targetHorizonColor.copy(baseHorizon).lerp(new THREE.Color(cfg.skyHorizonStorm), 0.9);
      this.targetFogNear = cfg.fogNearStorm;
      this.targetFogFar = cfg.fogFarStorm;
      this.isRaining = true;
      this.targetSoilMoisture = 1.0;
    } else if (state === 'thunderstorm_aftermath') {
      this.targetZenithColor.copy(baseZenith).lerp(new THREE.Color(cfg.skyZenithRain), 0.3);
      this.targetHorizonColor.copy(baseHorizon).lerp(new THREE.Color(cfg.skyHorizonDay), 0.6);
      this.targetFogNear = cfg.fogNearRain * 1.5;
      this.targetFogFar = cfg.fogFarRain * 1.6;
      this.isRaining = false;
      this.targetSoilMoisture = 0.7;
    } else {
      // Clear
      this.targetZenithColor.copy(baseZenith);
      this.targetHorizonColor.copy(baseHorizon);
      this.targetFogNear = cfg.fogNearClear;
      this.targetFogFar = cfg.fogFarClear;
      this.isRaining = false;
      this.targetSoilMoisture = 0.25;
    }

    // 3. Directional sun/moon position & intensity
    const sunOrbitalDist = 120;
    if (sunElev >= -0.1) {
      // Sun active
      this.sunLight.position.set(
        this.sunDir.x * sunOrbitalDist,
        Math.max(8, this.sunDir.y * sunOrbitalDist),
        this.sunDir.z * sunOrbitalDist,
      );
      const sunBaseColor =
        duskFactor > 0.2 ? new THREE.Color(cfg.sunColorDusk) : new THREE.Color(cfg.sunColorDay);
      this.sunLight.color.copy(sunBaseColor);
      this.sunLight.intensity = Math.max(
        0.05,
        cfg.sunIntensityDay * sunIntensity * Math.max(0.2, sunElev),
      );
    } else {
      // Moon active
      this.sunLight.position.set(
        this.moonDir.x * sunOrbitalDist,
        Math.max(12, this.moonDir.y * sunOrbitalDist),
        this.moonDir.z * sunOrbitalDist,
      );
      this.sunLight.color.set(cfg.sunColorNight);
      this.sunLight.intensity = cfg.sunIntensityNight;
    }

    // Ambient & Hemisphere lighting
    const ambInt =
      dayFactor > 0.1 ? cfg.ambientIntensityDay * sunIntensity : cfg.ambientIntensityNight;
    this.ambientLight.intensity = THREE.MathUtils.lerp(
      this.ambientLight.intensity,
      Math.max(0.1, ambInt),
      0.3,
    );
  }

  /**
   * Per-frame render loop update
   */
  public update(dt: number): void {
    const lerpRate = Math.min(1.0, dt * 2.5);

    // 1. Smoothly interpolate sky dome colors
    this.currentZenithColor.lerp(this.targetZenithColor, lerpRate);
    this.currentHorizonColor.lerp(this.targetHorizonColor, lerpRate);
    this.hemisphereLight.color.copy(this.currentZenithColor);
    this.hemisphereLight.groundColor.copy(this.currentHorizonColor);

    // 2. Smoothly adjust atmospheric fog
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = THREE.MathUtils.lerp(this.scene.fog.near, this.targetFogNear, lerpRate);
      this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, this.targetFogFar, lerpRate);
      this.scene.fog.color.lerp(this.currentHorizonColor, lerpRate);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(this.currentHorizonColor, lerpRate);
    }

    // 3. Smoothly adjust soil moisture tint
    this.soilMoisture = THREE.MathUtils.lerp(this.soilMoisture, this.targetSoilMoisture, dt * 0.5);
    const shader = this.groundMaterial.userData.shader as
      | { uniforms?: Record<string, { value: unknown }> }
      | undefined;
    if (shader?.uniforms?.uSoilMoisture) {
      shader.uniforms.uSoilMoisture.value = this.soilMoisture;
    }

    // 4. Update Rain Particles
    if (this.isRaining) {
      this.rainPoints.visible = true;
      const count = this.config.rainParticleCount;
      const camPos = this.camera.position;
      const h = this.config.rainBoxHeight;

      const pos = this.rainPositions;
      const vel = this.rainVelocities;

      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        pos[i3 + 1] -= vel[i] * dt;

        // Wrap around camera bounding box
        if (pos[i3 + 1] < camPos.y - 5.0) {
          pos[i3 + 1] = camPos.y + h - 5.0;
          pos[i3 + 0] = camPos.x + (Math.random() - 0.5) * this.config.rainBoxWidth;
          pos[i3 + 2] = camPos.z + (Math.random() - 0.5) * this.config.rainBoxWidth;
        }
      }
      this.rainGeometry.attributes.position.needsUpdate = true;
    } else {
      this.rainPoints.visible = false;
    }

    // 5. Thunderstorm Lightning System
    if (this.currentWeatherState === 'thunderstorm_active') {
      this.lightningTimer += dt;
      if (!this.lightningActive && this.lightningTimer >= this.nextLightningDelay) {
        // Trigger lightning flash
        this.lightningActive = true;
        this.lightningTimer = 0;
        this.lightningTimeRemaining = this.config.lightningFlashDurationMs / 1000;
        this.nextLightningDelay = THREE.MathUtils.randFloat(
          this.config.lightningMinIntervalS,
          this.config.lightningMaxIntervalS,
        );
      }

      if (this.lightningActive) {
        this.lightningTimeRemaining -= dt;
        if (this.lightningTimeRemaining <= 0) {
          this.lightningActive = false;
          this.lightningFlashIntensity = 0;
        } else {
          // Rapid flicker/strobe intensity
          this.lightningFlashIntensity =
            (0.6 + Math.random() * 0.4) * this.config.lightningIntensityBoost;
          this.ambientLight.intensity += this.lightningFlashIntensity * 0.5;
        }
      }
    }
  }

  /**
   * Get the ground mesh reference
   */
  public getGroundMesh(): THREE.Mesh {
    return this.groundMesh;
  }

  /**
   * Current normalized time of day [0, 1)
   */
  public getTimeOfDay(): number {
    return this.timeOfDay;
  }

  /**
   * Current solar/celestial light intensity multiplier
   */
  public getSunIntensity(): number {
    return this.sunIntensity;
  }
}
