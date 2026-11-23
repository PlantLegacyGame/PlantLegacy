/**
 * @plant-legacy/weather - WeatherSystem wrapper.
 *
 * High-level wrapper around the weather state machine that loads configuration
 * from the shared config system and exposes simple query methods.
 *
 * Dependencies: @plant-legacy/shared/config, @plant-legacy/shared/math
 */

import type { ConfigFile } from '@plant-legacy/shared/config';
import { readInteger, readNumber, readObject } from '@plant-legacy/shared/config';
import {
  type ClimateConfig,
  type ClimateField,
  type ClimateSample,
  type ClimateTerrain,
  createClimateField,
  sanitizeClimateConfig,
} from './climateField.ts';
import type {
  DayNightConfig,
  WeatherConfig,
  WeatherStateMachine,
  WeatherStateName,
} from './weatherStateMachine.ts';
import {
  createWeatherStateMachine,
  weatherStateMachineForceState,
  weatherStateMachineGetBroadcast,
  weatherStateMachineGetLightMultiplier,
  weatherStateMachineGetMoistureGainPerS,
  weatherStateMachineGetTimeOfDay,
  weatherStateMachineGetWeatherState,
  weatherStateMachineSetClimate,
  weatherStateMachineSetTimeOfDay,
  weatherStateMachineSetTimePaused,
  weatherStateMachineSetTimeScale,
  weatherStateMachineUpdate,
} from './weatherStateMachine.ts';

export type WeatherState = WeatherStateName;

export class WeatherSystem {
  private machine: WeatherStateMachine;
  /** Ease time for the light multiplier, from daynight.json dawn_dusk_transition_s. */
  private readonly lightTransitionS: number;
  private smoothedLightMultiplier: number;
  /** The field that decides the weather; null keeps the authored chain. */
  private field: ClimateField | null = null;
  private climateTerrain: ClimateTerrain | null = null;
  /** Where the weather is being observed: the world's own plant, usually. */
  private anchorX = 0;
  private anchorZ = 0;
  private seasonPhase = 0;

  constructor(
    weatherConfig: WeatherConfig,
    dayNightConfig: DayNightConfig,
    climateConfig?: ClimateConfig | null,
  ) {
    this.machine = createWeatherStateMachine(weatherConfig, dayNightConfig);
    this.lightTransitionS = Math.max(1, dayNightConfig.dawnDuskTransitionS);
    this.smoothedLightMultiplier = weatherStateMachineGetLightMultiplier(this.machine);
    if (climateConfig) this.connectClimate(climateConfig);
  }

  /** Connect a climate field, rebuilding it if the terrain sampler changes. */
  private connectClimate(config: ClimateConfig): void {
    const sanitized = sanitizeClimateConfig(config);
    this.field = createClimateField(sanitized, this.climateTerrain);
    weatherStateMachineSetClimate(this.machine, {
      sample: () => this.sampleClimate(),
      reevaluateS: sanitized.reevaluateS,
      precipitationStart: sanitized.precipitationStart,
      precipitationStop: sanitized.precipitationStop,
      stormCooldownS: sanitized.stormCooldownS,
      cooldownS: 0,
    });
  }

  private sampleClimate(): ClimateSample {
    // The binding is only connected alongside the field (see `connectClimate`);
    // the fallback keeps the type honest without a non-null assertion.
    const field = this.field;
    if (!field) {
      return {
        temperatureC: 0,
        humidity: 0,
        cloud: 0,
        precipitation: 0,
        kind: 'rain',
        storm: false,
      };
    }
    return field.sample(this.anchorX, this.anchorZ, {
      elapsedS: this.machine.totalElapsedS,
      dayFraction: this.machine.timeOfDay,
      seasonPhase: this.seasonPhase,
    });
  }

  /**
   * The field's reading at the anchor right now, for logs and diagnostics.
   * The state machine already reads through its binding; this is how an
   * operator can see what the sky was doing when it changed.
   */
  getClimateSample(): ClimateSample | null {
    return this.field ? this.sampleClimate() : null;
  }

  /** Where the weather is read: a plant's root, so a ridge has its own sky. */
  setClimateAnchor(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.anchorX = x;
    this.anchorZ = z;
  }

  /** The terrain the wind lifts over. Reconnects the field around new terrain. */
  setTerrainSampler(terrain: ClimateTerrain | null): void {
    this.climateTerrain = terrain;
    if (this.field) this.connectClimate(this.field.config);
  }

  /** 0..1 through the year, for the seasonal temperature swing. */
  setSeasonPhase(phase: number): void {
    if (!Number.isFinite(phase)) return;
    this.seasonPhase = ((phase % 1) + 1) % 1;
  }

  update(dtSeconds: number): void {
    weatherStateMachineUpdate(this.machine, dtSeconds);
    // Per-state light multipliers are step values, so feeding them straight to
    // the resource grid dropped daylight from 80 to 52 in a single tick when
    // rain started. Ease toward the new multiplier instead, so sky and light
    // readings change gradually over the same window as a dawn/dusk.
    const target = weatherStateMachineGetLightMultiplier(this.machine);
    const blend = 1 - Math.exp(-dtSeconds / this.lightTransitionS);
    this.smoothedLightMultiplier += (target - this.smoothedLightMultiplier) * blend;
  }

  /**
   * Dev control: make this the authoritative weather now. The smoothed light
   * follows on the next update, so the sky and the tile lighting change together
   * instead of one of them snapping.
   */
  forceState(state: WeatherStateName, durationS?: number): void {
    weatherStateMachineForceState(this.machine, state, durationS);
  }

  /**
   * Dev control: jump the clock to a fraction of the day so screenshots can be
   * taken in daylight. The sun is server-authoritative, so this is the only way
   * to brighten the world on demand - a client-side set is overwritten by the
   * next broadcast.
   */
  setTimeOfDay(timeOfDay: number): void {
    weatherStateMachineSetTimeOfDay(this.machine, timeOfDay);
  }

  /** Dev control: hold the world clock still, or release it. */
  setTimePaused(paused: boolean): void {
    weatherStateMachineSetTimePaused(this.machine, paused);
  }

  /** Dev control: how fast the world clock runs, as a multiplier on real time. */
  setTimeScale(scale: number): void {
    weatherStateMachineSetTimeScale(this.machine, scale);
  }

  getBroadcast() {
    return weatherStateMachineGetBroadcast(this.machine);
  }

  getMoistureDepositPerSecond(): number {
    return weatherStateMachineGetMoistureGainPerS(this.machine);
  }

  getWeatherLightMultiplier(): number {
    return this.smoothedLightMultiplier;
  }

  getTimeOfDay(): number {
    return weatherStateMachineGetTimeOfDay(this.machine);
  }

  getWeatherState(): WeatherState {
    return weatherStateMachineGetWeatherState(this.machine);
  }
}

export type { ClimateConfig, ClimateSample } from './climateField.ts';
export { createClimateField, sanitizeClimateConfig } from './climateField.ts';
export type {
  DayNightConfig,
  WeatherBroadcast,
  WeatherConfig,
  WeatherStateMachine,
  WeatherStateName,
} from './weatherStateMachine.js';

export function loadWeatherConfig(configs: Map<string, ConfigFile>): WeatherConfig {
  return {
    clearDurationMinS: readInteger(configs, 'weather', 'clear_duration_min_s'),
    clearDurationMaxS: readInteger(configs, 'weather', 'clear_duration_max_s'),
    rainDurationMinS: readInteger(configs, 'weather', 'rain_duration_min_s'),
    rainDurationMaxS: readInteger(configs, 'weather', 'rain_duration_max_s'),
    stormTelegraphDurationS: readInteger(configs, 'weather', 'storm_telegraph_duration_s'),
    stormActiveDurationS: readInteger(configs, 'weather', 'storm_active_duration_s'),
    stormAftermathDurationS: readInteger(configs, 'weather', 'storm_aftermath_duration_s'),
    rainMoistureGainPerS: readNumber(configs, 'weather', 'rain_moisture_gain_per_s'),
    stormMoistureGainPerS: readNumber(configs, 'weather', 'storm_moisture_gain_per_s'),
    clearLightMultiplier: readNumber(configs, 'weather', 'clear_light_multiplier'),
    rainLightMultiplier: readNumber(configs, 'weather', 'rain_light_multiplier'),
    stormLightMultiplier: readNumber(configs, 'weather', 'storm_light_multiplier'),
    stormWindDamageThreshold: readNumber(configs, 'weather', 'storm_wind_damage_threshold'),
    stormWindDamageRate: readNumber(configs, 'weather', 'storm_wind_damage_rate'),
    lightningFrequencyPerMinute: readNumber(configs, 'weather', 'lightning_frequency_per_minute'),
    lightningDamageRadius: readNumber(configs, 'weather', 'lightning_damage_radius'),
    lightningDamageAmount: readNumber(configs, 'weather', 'lightning_damage_amount'),
    forecastWindowS: readInteger(configs, 'weather', 'forecast_window_s'),
    biomeWeatherModifier: readNumber(configs, 'weather', 'biome_weather_modifier'),
  };
}

/**
 * The climate field's numbers, from `config/climate.json`.
 *
 * Sanitising happens once, in `WeatherSystem.connectClimate`, which is the only
 * thing that builds a field: a zero system scale or a NaN seed would make it
 * sample one point forever, and the weather would stop being weather.
 */
export function loadClimateConfig(configs: Map<string, ConfigFile>): ClimateConfig {
  return {
    seed: readInteger(configs, 'climate', 'seed'),
    systemScaleM: readNumber(configs, 'climate', 'system_scale_m'),
    windSpeedMps: readNumber(configs, 'climate', 'wind_speed_mps'),
    windDirectionRad: readNumber(configs, 'climate', 'wind_direction_rad'),
    orographicDistanceM: readNumber(configs, 'climate', 'orographic_distance_m'),
    orographicLift: readNumber(configs, 'climate', 'orographic_lift'),
    temperatureBaseC: readNumber(configs, 'climate', 'temperature_base_c'),
    temperatureDaySwingC: readNumber(configs, 'climate', 'temperature_day_swing_c'),
    temperatureSeasonSwingC: readNumber(configs, 'climate', 'temperature_season_swing_c'),
    temperatureNoiseC: readNumber(configs, 'climate', 'temperature_noise_c'),
    altitudeLapseCPerM: readNumber(configs, 'climate', 'altitude_lapse_c_per_m'),
    humidityBase: readNumber(configs, 'climate', 'humidity_base'),
    humiditySwing: readNumber(configs, 'climate', 'humidity_swing'),
    cloudThreshold: readNumber(configs, 'climate', 'cloud_threshold'),
    precipitationThreshold: readNumber(configs, 'climate', 'precipitation_threshold'),
    snowThresholdC: readNumber(configs, 'climate', 'snow_threshold_c'),
    stormCloudThreshold: readNumber(configs, 'climate', 'storm_cloud_threshold'),
    stormChance: readNumber(configs, 'climate', 'storm_chance'),
    reevaluateS: readNumber(configs, 'climate', 'reevaluate_s'),
    stormCooldownS: readNumber(configs, 'climate', 'storm_cooldown_s'),
    precipitationStart: readNumber(configs, 'climate', 'precipitation_start'),
    precipitationStop: readNumber(configs, 'climate', 'precipitation_stop'),
  };
}

export function loadDayNightConfig(configs: Map<string, ConfigFile>): DayNightConfig {
  const conditionMapping = readObject(configs, 'daynight', 'condition_mapping') as Record<
    string,
    string
  >;
  return {
    cycleLengthS: readInteger(configs, 'daynight', 'cycle_length_s'),
    dayFraction: readNumber(configs, 'daynight', 'day_fraction'),
    dawnDuskTransitionS: readInteger(configs, 'daynight', 'dawn_dusk_transition_s'),
    conditionMapping,
  };
}
