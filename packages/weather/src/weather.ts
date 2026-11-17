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
  weatherStateMachineSetTimeOfDay,
  weatherStateMachineUpdate,
} from './weatherStateMachine.ts';

export type WeatherState = WeatherStateName;

export class WeatherSystem {
  private machine: WeatherStateMachine;
  /** Ease time for the light multiplier, from daynight.json dawn_dusk_transition_s. */
  private readonly lightTransitionS: number;
  private smoothedLightMultiplier: number;

  constructor(weatherConfig: WeatherConfig, dayNightConfig: DayNightConfig) {
    this.machine = createWeatherStateMachine(weatherConfig, dayNightConfig);
    this.lightTransitionS = Math.max(1, dayNightConfig.dawnDuskTransitionS);
    this.smoothedLightMultiplier = weatherStateMachineGetLightMultiplier(this.machine);
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
