/**
 * @plant-legacy/weather - Deterministic weather state machine.
 *
 * Weather state machine with seeded RNG, day/night cycle, sun intensity,
 * light multipliers per weather state, and moisture deposition rates.
 *
 * Dependencies: @plant-legacy/shared/math, @plant-legacy/shared/config
 */

export { loadDayNightConfig, loadWeatherConfig, WeatherSystem } from './weather.ts';
export {
  createWeatherStateMachine,
  type DayNightConfig,
  type WeatherBroadcast,
  type WeatherConfig,
  type WeatherStateMachine,
  type WeatherStateName,
  weatherStateMachineAdvance,
  weatherStateMachineGetBroadcast,
  weatherStateMachineGetLightMultiplier,
  weatherStateMachineGetMoistureGainPerS,
  weatherStateMachineGetNextState,
  weatherStateMachineGetTimeOfDay,
  weatherStateMachineGetWeatherState,
  weatherStateMachineIsDay,
  weatherStateMachineUpdate,
} from './weatherStateMachine.ts';
