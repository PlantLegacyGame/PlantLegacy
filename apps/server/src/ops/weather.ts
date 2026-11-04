import type { ConfigFile } from '@plant-legacy/shared/config';
import { readInteger, readNumber, readObject } from '@plant-legacy/shared/config';

export type WeatherState =
  | 'clear'
  | 'rain'
  | 'thunderstorm_telegraph'
  | 'thunderstorm_active'
  | 'thunderstorm_aftermath';

export interface WeatherConfig {
  clearDurationMinS: number;
  clearDurationMaxS: number;
  rainDurationMinS: number;
  rainDurationMaxS: number;
  stormTelegraphDurationS: number;
  stormActiveDurationS: number;
  stormAftermathDurationS: number;
  rainMoistureGainPerS: number;
  stormMoistureGainPerS: number;
  clearLightMultiplier: number;
  rainLightMultiplier: number;
  stormLightMultiplier: number;
  stormWindDamageThreshold: number;
  stormWindDamageRate: number;
  lightningFrequencyPerMinute: number;
  lightningDamageRadius: number;
  lightningDamageAmount: number;
  forecastWindowS: number;
  biomeWeatherModifier: number;
}

export interface DayNightConfig {
  cycleLengthS: number;
  dayFraction: number;
  dawnDuskTransitionS: number;
  conditionMapping: Record<string, string>;
}

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

export interface WeatherBroadcast {
  timeOfDay: number; // 0.0 - 1.0
  isDay: boolean;
  sunIntensity: number; // 0.0 - 1.0 (combined astronomical + weather light)
  weatherState: WeatherState;
  conditionToken: string; // "sun" | "rain" | "storm" | "overcast" | "mist"
  stateTimeRemainingS: number;
  forecast: {
    nextWeatherState: WeatherState;
    timeUntilNextStateS: number;
  };
}

export class WeatherSystem {
  private weatherConfig: WeatherConfig;
  private dayNightConfig: DayNightConfig;

  private currentState: WeatherState = 'clear';
  private stateTimerS = 0;
  private currentDurationS = 180;

  private timeOfDay = 0.25; // Start at sunrise/morning
  private totalElapsedS = 0;

  constructor(weatherConfig: WeatherConfig, dayNightConfig: DayNightConfig) {
    this.weatherConfig = weatherConfig;
    this.dayNightConfig = dayNightConfig;
    this.currentDurationS = this.getRandomDuration('clear');
  }

  private getRandomDuration(state: WeatherState): number {
    switch (state) {
      case 'clear': {
        const min = this.weatherConfig.clearDurationMinS;
        const max = this.weatherConfig.clearDurationMaxS;
        return min + Math.random() * (max - min);
      }
      case 'rain': {
        const min = this.weatherConfig.rainDurationMinS;
        const max = this.weatherConfig.rainDurationMaxS;
        return min + Math.random() * (max - min);
      }
      case 'thunderstorm_telegraph':
        return this.weatherConfig.stormTelegraphDurationS;
      case 'thunderstorm_active':
        return this.weatherConfig.stormActiveDurationS;
      case 'thunderstorm_aftermath':
        return this.weatherConfig.stormAftermathDurationS;
    }
  }

  private advanceState(): void {
    switch (this.currentState) {
      case 'clear':
        // 50% chance rain, 50% chance thunderstorm sequence
        this.currentState = Math.random() < 0.5 ? 'rain' : 'thunderstorm_telegraph';
        break;
      case 'rain':
        // Rain transitions to clear or intensifies into a storm
        this.currentState = Math.random() < 0.65 ? 'clear' : 'thunderstorm_telegraph';
        break;
      case 'thunderstorm_telegraph':
        this.currentState = 'thunderstorm_active';
        break;
      case 'thunderstorm_active':
        this.currentState = 'thunderstorm_aftermath';
        break;
      case 'thunderstorm_aftermath':
        this.currentState = 'clear';
        break;
    }

    this.stateTimerS = 0;
    this.currentDurationS = this.getRandomDuration(this.currentState);
  }

  public getNextStateForecast(): WeatherState {
    switch (this.currentState) {
      case 'clear':
        return 'rain';
      case 'rain':
        return 'clear';
      case 'thunderstorm_telegraph':
        return 'thunderstorm_active';
      case 'thunderstorm_active':
        return 'thunderstorm_aftermath';
      case 'thunderstorm_aftermath':
        return 'clear';
    }
  }

  public update(dtSeconds: number): void {
    this.totalElapsedS += dtSeconds;
    this.stateTimerS += dtSeconds;

    // Astronomical day/night cycle progression [0.0, 1.0)
    const cycleLength = Math.max(1, this.dayNightConfig.cycleLengthS);
    this.timeOfDay = (this.timeOfDay + dtSeconds / cycleLength) % 1.0;

    if (this.stateTimerS >= this.currentDurationS) {
      this.advanceState();
    }
  }

  public getTimeOfDay(): number {
    return this.timeOfDay;
  }

  public isDay(): boolean {
    return this.timeOfDay < this.dayNightConfig.dayFraction;
  }

  public getWeatherState(): WeatherState {
    return this.currentState;
  }

  public getWeatherLightMultiplier(): number {
    switch (this.currentState) {
      case 'clear':
        return this.weatherConfig.clearLightMultiplier;
      case 'rain':
        return this.weatherConfig.rainLightMultiplier;
      case 'thunderstorm_telegraph':
        return (
          (this.weatherConfig.clearLightMultiplier + this.weatherConfig.rainLightMultiplier) * 0.5
        );
      case 'thunderstorm_active':
        return this.weatherConfig.stormLightMultiplier;
      case 'thunderstorm_aftermath':
        return (
          (this.weatherConfig.rainLightMultiplier + this.weatherConfig.clearLightMultiplier) * 0.5
        );
    }
  }

  public getMoistureDepositPerSecond(): number {
    switch (this.currentState) {
      case 'rain':
        return this.weatherConfig.rainMoistureGainPerS * this.weatherConfig.biomeWeatherModifier;
      case 'thunderstorm_active':
        return this.weatherConfig.stormMoistureGainPerS * this.weatherConfig.biomeWeatherModifier;
      default:
        return 0.0;
    }
  }

  public getBroadcast(): WeatherBroadcast {
    const isDayTime = this.isDay();
    const condition = this.dayNightConfig.conditionMapping[this.currentState] ?? 'sun';
    const remainingS = Math.max(0, this.currentDurationS - this.stateTimerS);

    // Compute sun intensity from time of day curve + weather multiplier
    const dayFraction = this.dayNightConfig.dayFraction;
    let dayCurve = 0.0;
    if (this.timeOfDay < dayFraction) {
      // Sinusoidal arc peaking at mid-day
      dayCurve = Math.sin((this.timeOfDay / dayFraction) * Math.PI);
    }
    const sunIntensity = dayCurve * this.getWeatherLightMultiplier();

    return {
      timeOfDay: this.timeOfDay,
      isDay: isDayTime,
      sunIntensity,
      weatherState: this.currentState,
      conditionToken: condition,
      stateTimeRemainingS: Math.round(remainingS),
      forecast: {
        nextWeatherState: this.getNextStateForecast(),
        timeUntilNextStateS: Math.round(remainingS),
      },
    };
  }
}
