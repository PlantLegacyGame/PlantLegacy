import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type DayNightConfig, type WeatherConfig, WeatherSystem } from './weather.ts';

describe('T07 WeatherSystem', () => {
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
    const weather = new WeatherSystem(weatherConfig, dayNightConfig);
    assert.equal(weather.getWeatherState(), 'clear');
    const initialTime = weather.getTimeOfDay();

    // Advance 100 seconds (0.1 of 1000s cycle)
    weather.update(100);
    const updatedTime = weather.getTimeOfDay();
    assert.ok(updatedTime > initialTime);
  });

  it('correctly reports day and night according to dayFraction', () => {
    const weather = new WeatherSystem(weatherConfig, dayNightConfig);
    // At 0.25 (morning), it should be day
    assert.equal(weather.isDay(), true);

    // Fast forward to night (e.g. 500s = +0.5 time of day -> 0.75 > 0.66)
    weather.update(500);
    assert.equal(weather.isDay(), false);
  });

  it('adjusts light multiplier and moisture deposit by weather state', () => {
    const weather = new WeatherSystem(weatherConfig, dayNightConfig);
    assert.equal(weather.getWeatherLightMultiplier(), 1.0);
    assert.equal(weather.getMoistureDepositPerSecond(), 0.0);

    // Force updates to advance state
    for (let i = 0; i < 50; i++) {
      weather.update(100);
    }
    // Broadcast must provide full forecast payload
    const broadcast = weather.getBroadcast();
    assert.ok(typeof broadcast.timeOfDay === 'number');
    assert.ok(typeof broadcast.sunIntensity === 'number');
    assert.ok(broadcast.conditionToken.length > 0);
    assert.ok(broadcast.forecast.nextWeatherState.length > 0);
  });
});
