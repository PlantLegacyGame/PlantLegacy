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
  weatherStateMachineGetBroadcast,
  weatherStateMachineGetLightMultiplier,
  weatherStateMachineGetMoistureGainPerS,
  weatherStateMachineGetTimeOfDay,
  weatherStateMachineGetWeatherState,
  weatherStateMachineUpdate,
} from './weatherStateMachine.ts';

export type WeatherState = WeatherStateName;

export class WeatherSystem {
  private machine: WeatherStateMachine;

  constructor(weatherConfig: WeatherConfig, dayNightConfig: DayNightConfig) {
    this.machine = createWeatherStateMachine(weatherConfig, dayNightConfig);
  }

  update(dtSeconds: number): void {
    weatherStateMachineUpdate(this.machine, dtSeconds);
  }

  getBroadcast() {
    return weatherStateMachineGetBroadcast(this.machine);
  }

  getMoistureDepositPerSecond(): number {
    return weatherStateMachineGetMoistureGainPerS(this.machine);
  }

  getWeatherLightMultiplier(): number {
    return weatherStateMachineGetLightMultiplier(this.machine);
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
