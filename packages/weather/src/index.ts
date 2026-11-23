/**
 * @plant-legacy/weather - Deterministic weather state machine.
 *
 * Weather state machine with seeded RNG, day/night cycle, sun intensity,
 * light multipliers per weather state, and moisture deposition rates.
 *
 * Dependencies: @plant-legacy/shared/math, @plant-legacy/shared/config
 */

export {
  type ClimateConfig,
  type ClimateField,
  type ClimateSample,
  type ClimateTerrain,
  createClimateField,
  sanitizeClimateConfig,
} from './climateField.ts';
export {
  loadClimateConfig,
  loadDayNightConfig,
  loadWeatherConfig,
  WeatherSystem,
} from './weather.ts';
export {
  type ClimateBinding,
  climateNextState,
  createWeatherStateMachine,
  type DayNightConfig,
  type WeatherBroadcast,
  type WeatherConfig,
  type WeatherStateMachine,
  type WeatherStateName,
  weatherStateMachineAdvance,
  weatherStateMachineForceState,
  weatherStateMachineGetBroadcast,
  weatherStateMachineGetLightMultiplier,
  weatherStateMachineGetMoistureGainPerS,
  weatherStateMachineGetNextState,
  weatherStateMachineGetTimeOfDay,
  weatherStateMachineGetWeatherState,
  weatherStateMachineIsDay,
  weatherStateMachineSetClimate,
  weatherStateMachineUpdate,
} from './weatherStateMachine.ts';
