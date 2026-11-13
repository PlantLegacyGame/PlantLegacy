/**
 * C03 weather look: what each T07 weather state does to the sky, fog and soil.
 *
 * The state machine (`ClientWeatherStateMachine`) owns timing; this table owns
 * appearance. Keeping the numbers out of the renderer means a new weather state
 * is one entry here, and nobody has to read `EnvironmentRenderer` to know what
 * a storm looks like.
 */
import type { RenderConfig } from '../../config/clientConfig.js';
import {
  type ClientWeatherStateMachine,
  createClientWeatherStateMachine,
} from '../ClientWeatherStateMachine.js';

export function createEnvironmentWeatherMachine(config: RenderConfig): ClientWeatherStateMachine {
  return createClientWeatherStateMachine({
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
    // Two seconds read as the sky snapping dark, so the cross-fade is tuned in
    // render.json (weather_transition_ms) rather than compiled in.
    transitionDuration: config.weatherTransitionMs,
    lightning: {
      minDelay: config.lightningMinIntervalS,
      maxDelay: config.lightningMaxIntervalS,
      flashDuration: config.lightningFlashDurationMs / 1000,
      maxIntensity: config.lightningMaxIntensity,
    },
  });
}
