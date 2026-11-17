/**
 * Client-side Weather Visual State Machine
 *
 * Manages explicit weather visual transitions with interpolation states.
 * Replaces implicit boolean flags (isRaining, lightningActive) with
 * explicit state machine that handles smooth transitions.
 */

import * as THREE from 'three';

export type ClientWeatherState =
  | 'clear'
  | 'rain'
  | 'thunderstorm_telegraph'
  | 'thunderstorm_active'
  | 'thunderstorm_aftermath'
  | 'transitioning';

export interface WeatherVisualTargets {
  zenithColor: THREE.Color;
  horizonColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  soilMoisture: number;
  isRaining: boolean;
  lightningIntensity: number;
  lightningTimer: number;
}

export interface ClientWeatherConfig {
  clear: {
    zenithColor: string;
    horizonColor: string;
    fogNear: number;
    fogFar: number;
    soilMoisture: number;
  };
  rain: {
    zenithColor: string;
    horizonColor: string;
    fogNear: number;
    fogFar: number;
    soilMoisture: number;
  };
  thunderstorm_telegraph: {
    zenithColor: string;
    horizonColor: string;
    fogNear: number;
    fogFar: number;
    soilMoisture: number;
  };
  thunderstorm_active: {
    zenithColor: string;
    horizonColor: string;
    fogNear: number;
    fogFar: number;
    soilMoisture: number;
  };
  thunderstorm_aftermath: {
    zenithColor: string;
    horizonColor: string;
    fogNear: number;
    fogFar: number;
    soilMoisture: number;
  };
  transitionDuration: number; // ms for visual transitions
  lightning: {
    /** How long a strike takes to fade; the server schedules the strikes. */
    flashDuration: number; // seconds
    maxIntensity: number;
  };
}

export class ClientWeatherStateMachine {
  private config: ClientWeatherConfig;
  private state: ClientWeatherState = 'clear';
  private transitionProgress = 0; // 0 to 1
  private transitionDuration = 0;
  private lightningIntensity = 0;
  private timeOfDay = 0;
  private sunElev = 0;
  private dayFactor = 0;

  // Current visual targets (interpolated during transitions)
  private currentTargets: WeatherVisualTargets = {
    zenithColor: new THREE.Color(),
    horizonColor: new THREE.Color(),
    fogNear: 0,
    fogFar: 0,
    soilMoisture: 0,
    isRaining: false,
    lightningIntensity: 0,
    lightningTimer: 0,
  };

  // Target visual values for current state
  private targetTargets: WeatherVisualTargets = {
    zenithColor: new THREE.Color(),
    horizonColor: new THREE.Color(),
    fogNear: 0,
    fogFar: 0,
    soilMoisture: 0,
    isRaining: false,
    lightningIntensity: 0,
    lightningTimer: 0,
  };

  constructor(config: ClientWeatherConfig) {
    this.config = config;
    this.transitionDuration = config.transitionDuration;
    this.initializeTargets();
  }

  private initializeTargets(): void {
    this.setTargetsForState('clear');
    this.currentTargets = { ...this.targetTargets };
  }

  private setTargetsForState(state: ClientWeatherState): void {
    const cfg = this.config[state as keyof ClientWeatherConfig] as
      | ClientWeatherConfig['clear']
      | ClientWeatherConfig['rain']
      | ClientWeatherConfig['thunderstorm_telegraph']
      | ClientWeatherConfig['thunderstorm_active']
      | ClientWeatherConfig['thunderstorm_aftermath'];

    if (!cfg) return;

    this.targetTargets.zenithColor.set(cfg.zenithColor);
    this.targetTargets.horizonColor.set(cfg.horizonColor);
    this.targetTargets.fogNear = cfg.fogNear;
    this.targetTargets.fogFar = cfg.fogFar;
    this.targetTargets.soilMoisture = cfg.soilMoisture;
    this.targetTargets.isRaining = state === 'rain' || state === 'thunderstorm_active';
  }

  /**
   * Request a weather state change. Begins transition if different from current.
   */
  requestStateChange(newState: ClientWeatherState): boolean {
    // The same state is already the destination, whether the transition into it
    // finished or is still running. Restarting the fade on a repeat request made
    // a weather broadcast (about once a second) reset it forever: progress never
    // passed the 0.5 mark where isRaining flips, so a storm never drew rain.
    if (newState === this.state) return false;

    this.state = newState;
    this.transitionProgress = 0;
    // Set new targets
    this.setTargetsForState(newState);

    return true;
  }

  /**
   * Update the state machine with delta time.
   * Returns current visual targets (interpolated during transitions).
   */
  update(deltaMs: number, timeOfDay: number, _sunIntensity: number): WeatherVisualTargets {
    this.timeOfDay = timeOfDay;

    // Calculate sun elevation and day factor
    const sunAngle = timeOfDay * Math.PI * 2 - Math.PI / 2;
    this.sunElev = Math.sin(sunAngle);
    this.dayFactor = THREE.MathUtils.smoothstep(this.sunElev, -0.05, 0.35);

    // Handle transition interpolation. Progress is advanced by the frame's own
    // delta, not read off the wall clock: a paused or slowed game clock must not
    // keep fading the sky, and the fade has to be reproducible in a test.
    if (this.transitionProgress < 1) {
      this.transitionProgress = Math.min(
        1,
        this.transitionProgress + Math.max(0, deltaMs) / Math.max(1, this.transitionDuration),
      );

      // Smooth interpolation using ease-in-out
      const t = THREE.MathUtils.smoothstep(this.transitionProgress, 0, 1);

      this.lerpTargets(this.currentTargets, this.targetTargets, t);
    } else {
      this.currentTargets = { ...this.targetTargets };
    }

    // Update lightning
    this.updateLightning(deltaMs);

    return { ...this.currentTargets };
  }

  private lerpTargets(
    current: WeatherVisualTargets,
    target: WeatherVisualTargets,
    t: number,
  ): void {
    current.zenithColor.lerp(target.zenithColor, t);
    current.horizonColor.lerp(target.horizonColor, t);
    current.fogNear = THREE.MathUtils.lerp(current.fogNear, target.fogNear, t);
    current.fogFar = THREE.MathUtils.lerp(current.fogFar, target.fogFar, t);
    current.soilMoisture = THREE.MathUtils.lerp(current.soilMoisture, target.soilMoisture, t);
    current.isRaining = t > 0.5 ? target.isRaining : current.isRaining;
  }

  /**
   * Draw one strike. The server owns the bolt: it damages plants and sends the
   * position, and this only paints the light. The client used to roll its own
   * strikes on a 3.5-9 s timer while the server rolled damage on its own, so a
   * flash and a hit were two unrelated events.
   */
  triggerLightning(): void {
    this.lightningIntensity = Math.max(0, this.config.lightning.maxIntensity);
  }

  private updateLightning(deltaMs: number): void {
    if (this.lightningIntensity <= 0) return;
    const flashDuration = Math.max(0.016, this.config.lightning.flashDuration);
    this.lightningIntensity = Math.max(0, this.lightningIntensity - deltaMs / 1000 / flashDuration);
  }

  /**
   * Get current visual targets for rendering
   */
  getCurrentTargets(): WeatherVisualTargets {
    return { ...this.currentTargets };
  }

  /**
   * Get current weather state
   */
  getState(): ClientWeatherState {
    return this.state;
  }

  /**
   * Check if currently in a transition
   */
  isTransitioning(): boolean {
    return this.transitionProgress < 1;
  }

  /**
   * Check if currently raining (for particle systems)
   */
  isRaining(): boolean {
    return this.currentTargets.isRaining;
  }

  /**
   * Get current lightning intensity (0-1)
   */
  getLightningIntensity(): number {
    return this.lightningIntensity;
  }

  /**
   * Get sun elevation (-1 to 1)
   */
  getSunElevation(): number {
    return this.sunElev;
  }

  /**
   * Get day factor (0 = night, 1 = day)
   */
  getDayFactor(): number {
    return this.dayFactor;
  }

  /**
   * Get sun direction vector
   */
  getSunDirection(out: THREE.Vector3): void {
    const sunAngle = this.timeOfDay * Math.PI * 2 - Math.PI / 2;
    out.set(Math.cos(sunAngle) * 0.8, this.sunElev, Math.sin(sunAngle) * 0.4).normalize();
  }

  /**
   * Get moon direction vector
   */
  getMoonDirection(out: THREE.Vector3): void {
    const sunAngle = this.timeOfDay * Math.PI * 2 - Math.PI / 2;
    out.set(-Math.cos(sunAngle) * 0.8, -this.sunElev, -Math.sin(sunAngle) * 0.4).normalize();
  }
}

export function createClientWeatherStateMachine(
  config: ClientWeatherConfig,
): ClientWeatherStateMachine {
  return new ClientWeatherStateMachine(config);
}
