import * as THREE from 'three';
import type { RenderConfig } from '../config/clientConfig.js';
import {
  type ClientWeatherState,
  type ClientWeatherStateMachine,
  createClientWeatherStateMachine,
} from './ClientWeatherStateMachine.js';

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

  // Weather state machine (Phase 1.6: explicit transitions)
  private weatherMachine: ClientWeatherStateMachine;

  // Sky dome
  private skyMesh: THREE.Mesh;
  private skyMaterial: THREE.ShaderMaterial;
  private currentZenithColor: THREE.Color = new THREE.Color();
  private currentHorizonColor: THREE.Color = new THREE.Color();

  // Celestial lighting
  private sunLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private hemisphereLight: THREE.HemisphereLight;
  private sunDir: THREE.Vector3 = new THREE.Vector3();
  private moonDir: THREE.Vector3 = new THREE.Vector3();

  // Terrain / Ground mesh
  private groundMesh: THREE.Mesh | null;
  private groundMaterial: THREE.MeshStandardMaterial;
  private soilMoisture = 0.2;
  private targetSoilMoisture = 0.2;

  // Rain particle system
  private rainPoints: THREE.Points;
  private rainGeometry: THREE.BufferGeometry;
  private rainPositions: Float32Array;
  private rainVelocities: Float32Array;

  // Lightning system for thunderstorm
  private lightningTimer = 0;

  // Time of day and sun intensity (client-side interpolation)
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
    showGround: boolean = true,
    showRain: boolean = true,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.config = config;
    this.sunLight = sunLight;
    this.ambientLight = ambientLight;
    this.hemisphereLight = hemisphereLight;

    // Initialize client weather state machine (Phase 1.6)
    this.weatherMachine = createClientWeatherStateMachine({
      clear: {
        zenithColor: config.skyZenithDay,
        horizonColor: config.skyHorizonDay,
        fogNear: config.fogNearClear,
        fogFar: config.fogFarClear,
        soilMoisture: 0.25,
      },
      rain: {
        zenithColor: config.skyZenithRain,
        horizonColor: config.skyHorizonRain,
        fogNear: config.fogNearRain,
        fogFar: config.fogFarRain,
        soilMoisture: 0.85,
      },
      thunderstorm_telegraph: {
        zenithColor: config.skyZenithTelegraph,
        horizonColor: config.skyHorizonTelegraph,
        fogNear: (config.fogNearClear + config.fogNearRain) * 0.5,
        fogFar: (config.fogFarClear + config.fogFarRain) * 0.5,
        soilMoisture: 0.4,
      },
      thunderstorm_active: {
        zenithColor: config.skyZenithStorm,
        horizonColor: config.skyHorizonStorm,
        fogNear: config.fogNearStorm,
        fogFar: config.fogFarStorm,
        soilMoisture: 1.0,
      },
      thunderstorm_aftermath: {
        zenithColor: config.skyZenithRain,
        horizonColor: config.skyHorizonDay,
        fogNear: config.fogNearRain * 1.5,
        fogFar: config.fogFarRain * 1.6,
        soilMoisture: 0.7,
      },
      transitionDuration: 2000, // 2 second transitions
      lightning: {
        minDelay: 3.0,
        maxDelay: 8.0,
        flashDuration: 0.15,
        maxIntensity: 1.0,
      },
    });

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
      depthTest: true,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.skyMesh.renderOrder = -100;
    this.scene.add(this.skyMesh);

    // Sky dome follows camera but stays above ground to avoid intersection
    this.skyMesh.position.set(
      this.camera.position.x,
      this.camera.position.y + 50,
      this.camera.position.z,
    );

    // 2. Terrain Ground Mesh & Soil Shader (Refines T02 Root Sight Cutaway)
    // Simple PlaneGeometry - flat, single-sided, opaque. Root Sight cutaway
    // handled via alphaTest in shader (not transparency) to avoid depth issues.
    const groundGeo = new THREE.PlaneGeometry(
      config.terrainRadius * 2,
      config.terrainRadius * 2,
      config.terrainMeshSubdivisions,
      config.terrainMeshSubdivisions,
    );
    this.groundMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config.soilDryColor),
      roughness: 0.95,
      metalness: 0.02,
      transparent: false,
      alphaTest: 0.01,
      depthWrite: true,
      side: THREE.FrontSide,
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
      shader.uniforms.uSunDir = { value: new THREE.Vector3(0, 1, 0) };
      shader.uniforms.uSunColor = { value: new THREE.Color(0xffffee) };
      shader.uniforms.uSunIntensity = { value: 1.0 };

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
uniform float uSoilMoisture;
// Sun uniforms for ground lighting
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;`,
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
  // C03: Soil moisture darkening & subtle mineral accents
  vec3 dynamicSoil = mix(uSoilDryColor, uSoilWetColor, clamp(uSoilMoisture, 0.0, 1.0));
  float mineralNoise = fract(sin(dot(vSoilWorldPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
  dynamicSoil = mix(dynamicSoil, uSoilMineralColor, mineralNoise * 0.08);
  
  // Apply lighting to ground (use existing normal from standard material)
  // Flip normal for back faces when using DoubleSide
  vec3 groundNormal = normalize(vNormal);
  if (!gl_FrontFacing) groundNormal = -groundNormal;
  float NdotL = max(dot(groundNormal, normalize(-uSunDir)), 0.0);
  vec3 lightColor = uSunColor * uSunIntensity * NdotL;
  gl_FragColor.rgb = dynamicSoil * (0.35 + 0.65 * lightColor);
  
  // Root Sight: Soil remains fully visible as terrain background
  // No individual node cutaways - roots are highlighted via SDF aura in PlantRenderer
  gl_FragColor.a = 1.0;`,
        );
    };
    this.groundMaterial.customProgramCacheKey = () => 'c03-environment-ground-v1';

    if (showGround) {
      this.groundMesh = new THREE.Mesh(groundGeo, this.groundMaterial);
      this.groundMesh.rotation.x = -Math.PI / 2;
      this.groundMesh.position.y = 0;
      this.groundMesh.receiveShadow = true;
      this.scene.add(this.groundMesh);
    } else {
      this.groundMesh = null;
    }

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
    if (showRain) {
      this.scene.add(this.rainPoints);
    }

    // Initial weather state setup
    this.weatherMachine.requestStateChange('clear');
    // Initialize sun position and lighting before first render
    this.updateSunPosition();
  }

  /**
   * Called whenever server broadcasts WEATHER_UPDATE (type 21)
   */
  public handleWeatherUpdate(payload: WeatherPayload): void {
    this.timeOfDay = payload.timeOfDay;
    this.sunIntensity = payload.sunIntensity;

    // Request state change in weather machine (Phase 1.6)
    this.weatherMachine.requestStateChange(payload.weatherState as ClientWeatherState);
  }

  /**
   * Per-frame render loop update
   */
  public update(dt: number, devOverrideUntil = 0): void {
    const lerpRate = Math.min(1.0, dt * 2.5);

    // Advance client timeOfDay (server is authority, but client interpolates)
    // Only advance if not in dev override mode
    if (Date.now() >= devOverrideUntil) {
      this.timeOfDay = (this.timeOfDay + dt / 1800) % 1.0; // 1800s cycle
    }

    // Update weather state machine (Phase 1.6)
    const weatherTargets = this.weatherMachine.update(dt, this.timeOfDay, this.sunIntensity);

    // Update sun/moon position based on current timeOfDay
    this.updateSunPosition();

    // Sky dome follows camera but stays above ground to avoid intersection
    this.skyMesh.position.set(
      this.camera.position.x,
      this.camera.position.y + 50,
      this.camera.position.z,
    );

    // 1. Smoothly interpolate sky dome colors using weather machine targets
    this.currentZenithColor.lerp(weatherTargets.zenithColor, lerpRate);
    this.currentHorizonColor.lerp(weatherTargets.horizonColor, lerpRate);
    this.hemisphereLight.color.copy(this.currentZenithColor);
    this.hemisphereLight.groundColor.copy(this.currentHorizonColor);

    // Update sky shader uniforms
    this.skyMaterial.uniforms.uZenithColor.value.copy(this.currentZenithColor);
    this.skyMaterial.uniforms.uHorizonColor.value.copy(this.currentHorizonColor);

    // 2. Smoothly adjust atmospheric fog
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
      this.scene.fog.color.lerp(this.currentHorizonColor, lerpRate);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(this.currentHorizonColor, lerpRate);
    }

    // 3. Smoothly adjust soil moisture tint
    this.targetSoilMoisture = weatherTargets.soilMoisture;
    this.soilMoisture = THREE.MathUtils.lerp(this.soilMoisture, this.targetSoilMoisture, dt * 0.5);
    const shader = this.groundMaterial.userData.shader as
      | { uniforms?: Record<string, { value: THREE.Vector3 | THREE.Color | number }> }
      | undefined;
    if (shader?.uniforms?.uSoilMoisture) {
      shader.uniforms.uSoilMoisture.value = this.soilMoisture;
      (shader.uniforms.uSunDir.value as THREE.Vector3).copy(this.sunDir);
      (shader.uniforms.uSunColor.value as THREE.Color).copy(this.sunLight.color);
      shader.uniforms.uSunIntensity.value = this.sunLight.intensity;
    }

    // Update ground material sun uniforms
    const groundShader = this.groundMaterial.userData.shader as
      | { uniforms?: Record<string, { value: THREE.Vector3 | THREE.Color | number }> }
      | undefined;
    if (groundShader?.uniforms?.uSunDir) {
      (groundShader.uniforms.uSunDir.value as THREE.Vector3).copy(this.sunDir);
      (groundShader.uniforms.uSunColor.value as THREE.Color).copy(this.sunLight.color);
      groundShader.uniforms.uSunIntensity.value = this.sunLight.intensity;
    }

    // 4. Update Rain Particles (use weather machine's isRaining)
    if (weatherTargets.isRaining) {
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

    // 5. Thunderstorm Lightning System (use weather machine's lightning intensity)
    const lightningIntensity = weatherTargets.lightningIntensity;
    if (lightningIntensity > 0) {
      this.ambientLight.intensity += lightningIntensity * 0.5;
    }

    // Update lightning timer for next flash scheduling (weather machine handles actual timing)
    if (this.weatherMachine.getState() === 'thunderstorm_active') {
      this.lightningTimer += dt;
    }
  }

  /**
   * Update sun/moon position and sky colors based on current timeOfDay
   */
  private updateSunPosition(): void {
    const cfg = this.config;
    const sunAngle = this.timeOfDay * Math.PI * 2 - Math.PI / 2;
    const sunElev = Math.sin(sunAngle);

    this.sunDir.set(Math.cos(sunAngle) * 0.8, sunElev, Math.sin(sunAngle) * 0.4).normalize();
    this.moonDir.set(-this.sunDir.x, -this.sunDir.y, -this.sunDir.z).normalize();

    // Update sun light position and intensity
    // For directional light: position = direction FROM light TO origin
    // Visual sun is at sunDir (origin TO sun), so light position = -sunDir * distance
    const sunOrbitalDist = 120;
    if (sunElev >= -0.1) {
      this.sunLight.position.set(
        -this.sunDir.x * sunOrbitalDist,
        -Math.max(8, this.sunDir.y * sunOrbitalDist),
        -this.sunDir.z * sunOrbitalDist,
      );
      const duskFactor = (1.0 - Math.abs(sunElev * 3.0)) * 0.5;
      const sunBaseColor =
        duskFactor > 0.2 ? new THREE.Color(cfg.sunColorDusk) : new THREE.Color(cfg.sunColorDay);
      this.sunLight.color.copy(sunBaseColor);
      this.sunLight.intensity = Math.max(0.05, cfg.sunIntensityDay * Math.max(0.2, sunElev));
      this.skyMaterial.uniforms.uSunDir.value.copy(this.sunDir);
      this.skyMaterial.uniforms.uSunColor.value.copy(sunBaseColor);
      this.skyMaterial.uniforms.uSunIntensity.value = this.sunLight.intensity;
      this.skyMaterial.uniforms.uMoonDir.value.set(0, -1, 0);
    } else {
      this.sunLight.position.set(
        -this.moonDir.x * sunOrbitalDist,
        -Math.max(12, this.moonDir.y * sunOrbitalDist),
        -this.moonDir.z * sunOrbitalDist,
      );
      this.sunLight.color.set(cfg.sunColorNight);
      this.sunLight.intensity = cfg.sunIntensityNight;
      this.skyMaterial.uniforms.uSunDir.value.set(0, -1, 0);
      this.skyMaterial.uniforms.uMoonDir.value.copy(this.moonDir);
      this.skyMaterial.uniforms.uSunColor.value.set(cfg.sunColorNight);
      this.skyMaterial.uniforms.uSunIntensity.value = this.sunLight.intensity;
    }

    // Update day/night factor for sky colors
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

    // Update hemisphere light
    const ambInt =
      dayFactor > 0.1 ? cfg.ambientIntensityDay * this.sunIntensity : cfg.ambientIntensityNight;
    this.ambientLight.intensity = THREE.MathUtils.lerp(
      this.ambientLight.intensity,
      Math.max(0.1, ambInt),
      0.3,
    );
  }

  /**
   * Current normalized time of day [0, 1)
   */
  public getGroundMesh(): THREE.Mesh | null {
    return this.groundMesh;
  }

  /**
   * Current normalized time of day [0, 1)
   */
  public getTimeOfDay(): number {
    return this.timeOfDay;
  }

  /**
   * Set time of day (for dev controls)
   */
  public setTimeOfDay(t: number): void {
    this.timeOfDay = t % 1.0;
    if (this.timeOfDay < 0) this.timeOfDay += 1.0;
  }

  /**
   * Current solar/celestial light intensity multiplier
   */
  public getSunIntensity(): number {
    return this.sunIntensity;
  }

  /**
   * Current sun direction (normalized, pointing FROM sun TO origin)
   */
  public getSunDirection(): THREE.Vector3 {
    return this.sunDir.clone();
  }

  /**
   * Current sun color
   */
  public getSunColor(): THREE.Color {
    return this.sunLight.color.clone();
  }

  /**
   * Current weather state (for dev controls)
   */
  public getWeatherState(): string {
    return this.weatherMachine.getState();
  }
}
