import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DayNightConfig, WeatherConfig } from './weather.ts';
import {
  createWeatherStateMachine,
  weatherStateMachineGetBroadcast,
  weatherStateMachineGetLightMultiplier,
  weatherStateMachineGetMoistureGainPerS,
  weatherStateMachineGetNextState,
  weatherStateMachineGetTimeOfDay,
  weatherStateMachineGetWeatherState,
  weatherStateMachineIsDay,
  weatherStateMachineUpdate,
} from './weatherStateMachine.ts';

describe('T07 WeatherStateMachine', () => {
  const weatherConfig: WeatherConfig = {
    clearDurationMinS: 100,
    clearDurationMaxS: 200,
    rainDurationMinS: 80,
    rainDurationMaxS: 150,
    stormTelegraphDurationS: 20,
    stormActiveDurationS: 40,
    stormAftermathDurationS: 30,
    rainMoistureGainPerS: 0.8,
    stormMoistureGainPerS: 1.6,
    clearLightMultiplier: 1.0,
    rainLightMultiplier: 0.65,
    stormLightMultiplier: 0.35,
    stormWindDamageThreshold: 18.0,
    stormWindDamageRate: 1.5,
    lightningFrequencyPerMinute: 4.0,
    lightningDamageRadius: 6.0,
    lightningDamageAmount: 25.0,
    forecastWindowS: 180,
    biomeWeatherModifier: 1.0,
  };

  const dayNightConfig: DayNightConfig = {
    cycleLengthS: 1000,
    dayFraction: 0.66,
    dawnDuskTransitionS: 60,
    conditionMapping: {
      clear: 'sun',
      rain: 'rain',
      thunderstorm_telegraph: 'overcast',
      thunderstorm_active: 'storm',
      thunderstorm_aftermath: 'mist',
    },
  };

  it('initializes with clear weather and progresses time of day', () => {
    const machine = createWeatherStateMachine(weatherConfig, dayNightConfig);
    assert.equal(weatherStateMachineGetWeatherState(machine), 'clear');
    const initialTime = weatherStateMachineGetTimeOfDay(machine);

    // Advance 100 seconds (0.1 of 1000s cycle)
    weatherStateMachineUpdate(machine, 100);
    const updatedTime = weatherStateMachineGetTimeOfDay(machine);
    assert.ok(updatedTime > initialTime);
  });

  it('correctly reports day and night according to dayFraction', () => {
    const machine = createWeatherStateMachine(weatherConfig, dayNightConfig);
    // At 0.25 (morning), it should be day
    assert.equal(weatherStateMachineIsDay(machine), true);

    // Fast forward to night (e.g. 500s = +0.5 time of day -> 0.75 > 0.66)
    weatherStateMachineUpdate(machine, 500);
    assert.equal(weatherStateMachineIsDay(machine), false);
  });

  it('adjusts light multiplier and moisture deposit by weather state', () => {
    const machine = createWeatherStateMachine(weatherConfig, dayNightConfig);
    assert.equal(weatherStateMachineGetLightMultiplier(machine), 1.0);
    assert.equal(weatherStateMachineGetMoistureGainPerS(machine), 0.0);

    // Force updates to advance state
    for (let i = 0; i < 50; i++) {
      weatherStateMachineUpdate(machine, 100);
    }
    // Broadcast must provide full forecast payload
    const broadcast = weatherStateMachineGetBroadcast(machine);
    assert.ok(typeof broadcast.timeOfDay === 'number');
    assert.ok(typeof broadcast.sunIntensity === 'number');
    assert.ok(broadcast.conditionToken.length > 0);
    assert.ok(broadcast.forecast.nextWeatherState.length > 0);
  });

  it('keeps clear weather for its configured minimum duration', () => {
    const machine = createWeatherStateMachine(weatherConfig, dayNightConfig);

    // The clear minimum is 100s; a shorter step must not transition.
    weatherStateMachineUpdate(machine, 99);
    assert.equal(weatherStateMachineGetWeatherState(machine), 'clear');
  });

  it('uses the configured clear duration instead of a zero default', () => {
    const pinnedConfig: WeatherConfig = {
      ...weatherConfig,
      clearDurationMinS: 10,
      clearDurationMaxS: 10,
      rainDurationMinS: 10,
      rainDurationMaxS: 10,
    };
    const machine = createWeatherStateMachine(pinnedConfig, dayNightConfig);

    weatherStateMachineUpdate(machine, 9);
    assert.equal(weatherStateMachineGetWeatherState(machine), 'clear');

    weatherStateMachineUpdate(machine, 1);
    assert.notEqual(weatherStateMachineGetWeatherState(machine), 'clear');
  });

  it('broadcasts the state that the next transition actually enters', () => {
    const machine = createWeatherStateMachine(weatherConfig, dayNightConfig);
    const forecast = weatherStateMachineGetNextState(machine);

    // Advance past any possible clear duration.
    weatherStateMachineUpdate(machine, 201);

    assert.equal(weatherStateMachineGetWeatherState(machine), forecast);
  });

  it('reads light and moisture magnitudes from config', () => {
    const pinnedConfig: WeatherConfig = {
      ...weatherConfig,
      clearLightMultiplier: 1.2,
      rainLightMultiplier: 0.4,
      rainMoistureGainPerS: 0.9,
      stormMoistureGainPerS: 2.0,
      biomeWeatherModifier: 1.0,
    };
    const machine = createWeatherStateMachine(pinnedConfig, dayNightConfig);

    assert.equal(weatherStateMachineGetLightMultiplier(machine), 1.2);
    assert.equal(weatherStateMachineGetMoistureGainPerS(machine), 0.0);

    machine.currentState = 'rain';
    assert.equal(weatherStateMachineGetLightMultiplier(machine), 0.4);
    assert.equal(weatherStateMachineGetMoistureGainPerS(machine), 0.9);

    machine.currentState = 'thunderstorm_active';
    assert.equal(weatherStateMachineGetMoistureGainPerS(machine), 2.0);
  });
});
