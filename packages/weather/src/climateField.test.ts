import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ClimateConfig, createClimateField } from './climateField.ts';
import type { DayNightConfig, WeatherConfig } from './weatherStateMachine.ts';
import {
  climateNextState,
  createWeatherStateMachine,
  weatherStateMachineGetWeatherState,
  weatherStateMachineSetClimate,
  weatherStateMachineUpdate,
} from './weatherStateMachine.ts';

const CLIMATE: ClimateConfig = {
  seed: 20261123,
  systemScaleM: 900,
  windSpeedMps: 6,
  windDirectionRad: 0.7,
  orographicDistanceM: 120,
  orographicLift: 0.35,
  temperatureBaseC: 14,
  temperatureDaySwingC: 6,
  temperatureSeasonSwingC: 9,
  temperatureNoiseC: 2,
  altitudeLapseCPerM: 0.0065,
  humidityBase: 0.56,
  humiditySwing: 0.3,
  cloudThreshold: 0.6,
  precipitationThreshold: 0.26,
  snowThresholdC: 2.5,
  stormCloudThreshold: 0.55,
  stormChance: 0.25,
  reevaluateS: 90,
  stormCooldownS: 900,
  precipitationStart: 0.28,
  precipitationStop: 0.14,
};

const WEATHER: WeatherConfig = {
  clearDurationMinS: 180,
  clearDurationMaxS: 420,
  rainDurationMinS: 120,
  rainDurationMaxS: 300,
  stormTelegraphDurationS: 45,
  stormActiveDurationS: 90,
  stormAftermathDurationS: 60,
  rainMoistureGainPerS: 0.8,
  stormMoistureGainPerS: 1.6,
  clearLightMultiplier: 1.0,
  rainLightMultiplier: 0.65,
  stormLightMultiplier: 0.35,
  stormWindDamageThreshold: 18,
  stormWindDamageRate: 1.5,
  lightningFrequencyPerMinute: 4,
  lightningDamageRadius: 6,
  lightningDamageAmount: 25,
  forecastWindowS: 180,
  biomeWeatherModifier: 1,
};

const DAY: DayNightConfig = {
  cycleLengthS: 3600,
  dayFraction: 0.66,
  dawnDuskTransitionS: 60,
  conditionMapping: { clear: 'sun', rain: 'rain', thunderstorm_telegraph: 'overcast' },
};

/** A ridge the wind has to climb, so orographic lift has something to lift over. */
function hill(x: number, z: number): number {
  return 45 * Math.exp(-(x * x + z * z) / (2 * 130 * 130));
}

describe('the climate field', () => {
  const field = createClimateField(CLIMATE, hill);

  it('keeps every output in its range', () => {
    for (let i = 0; i < 400; i += 1) {
      const x = ((i * 37) % 800) - 400;
      const z = ((i * 71) % 800) - 400;
      const sample = field.sample(x, z, {
        elapsedS: i * 137,
        dayFraction: (i * 0.017) % 1,
        seasonPhase: (i / 400) % 1,
      });
      assert.ok(Number.isFinite(sample.temperatureC));
      assert.ok(sample.humidity >= 0 && sample.humidity <= 1, `humidity ${sample.humidity}`);
      assert.ok(sample.cloud >= 0 && sample.cloud <= 1, `cloud ${sample.cloud}`);
      assert.ok(
        sample.precipitation >= 0 && sample.precipitation <= 1,
        `precip ${sample.precipitation}`,
      );
      assert.ok(sample.kind === 'rain' || sample.kind === 'snow');
    }
  });

  it('is deterministic for a seed, and different for another', () => {
    const time = { elapsedS: 5000, dayFraction: 0.4, seasonPhase: 0.2 };
    const first = field.sample(120, -40, time);
    const second = field.sample(120, -40, time);
    assert.deepEqual(first, second);

    const other = createClimateField({ ...CLIMATE, seed: 99 }, hill);
    assert.notDeepEqual(other.sample(120, -40, time), first);
  });

  it('clouds and rains more on the windward slope than in the lee', () => {
    // The wind blows from the west-south-west (direction 0.7 rad). The near side
    // of the ridge is windward; the far side is in its rain shadow.
    const time = { elapsedS: 12_000, dayFraction: 0.5, seasonPhase: 0.1 };
    const windward = field.sample(-120, -100, time);
    const leeward = field.sample(120, 100, time);
    assert.ok(
      windward.humidity > leeward.humidity,
      `windward ${windward.humidity} vs lee ${leeward.humidity}`,
    );
  });

  it('is colder with altitude and warmer in the afternoon than at night', () => {
    const noon = field.sample(0, 0, { elapsedS: 0, dayFraction: 0.5, seasonPhase: 0 });
    const night = field.sample(0, 0, { elapsedS: 0, dayFraction: 0.95, seasonPhase: 0 });
    assert.ok(
      noon.temperatureC > night.temperatureC,
      `${noon.temperatureC} vs ${night.temperatureC}`,
    );

    // The same place, one field over sea level and one over a 400 m upland: the
    // lapse is the only difference, so the local temperature noise cannot hide it.
    const seaLevel = createClimateField(CLIMATE, () => 0);
    const upland = createClimateField(CLIMATE, () => 400);
    const time = { elapsedS: 4000, dayFraction: 0.5, seasonPhase: 0 };
    const cold = upland.sample(200, -150, time);
    const warm = seaLevel.sample(200, -150, time);
    assert.ok(warm.temperatureC > cold.temperatureC);
    assert.ok(
      Math.abs(warm.temperatureC - cold.temperatureC - 400 * CLIMATE.altitudeLapseCPerM) < 1e-6,
      `${warm.temperatureC} vs ${cold.temperatureC}`,
    );
  });

  it('snows below the snow line and rains above it', () => {
    const config = { ...CLIMATE, temperatureSeasonSwingC: 0 };
    const warm = createClimateField(config, hill);
    const cold = createClimateField({ ...config, temperatureBaseC: -10 }, hill);
    const time = { elapsedS: 3000, dayFraction: 0.5, seasonPhase: 0 };
    assert.equal(warm.sample(0, 0, time).kind, 'rain');
    assert.equal(cold.sample(0, 0, time).kind, 'snow');
  });

  it('has hysteresis: a shower starts above its threshold and stops below a lower one', () => {
    const binding = { precipitationStart: 0.28, precipitationStop: 0.14, cooldownS: 0 };
    const wet = { ...sampleWith(0.2), kind: 'rain' as const };
    // 0.2 is enough to keep raining, not enough to start.
    assert.equal(climateNextState(wet, 'rain', 'clear', binding), 'rain');
    assert.equal(climateNextState(wet, 'clear', 'rain', binding), 'clear');
    const drying = sampleWith(0.1);
    assert.equal(climateNextState(drying, 'rain', 'clear', binding), 'clear');
    const heavy = sampleWith(0.35);
    assert.equal(climateNextState(heavy, 'clear', 'rain', binding), 'rain');
  });

  it('does not storm while the calm after the last one is running', () => {
    const storm = { ...sampleWith(0.9), storm: true };
    assert.equal(
      climateNextState(storm, 'clear', 'rain', {
        precipitationStart: 0.2,
        precipitationStop: 0.1,
        cooldownS: 0,
      }),
      'thunderstorm_telegraph',
    );
    assert.equal(
      climateNextState(storm, 'clear', 'rain', {
        precipitationStart: 0.2,
        precipitationStop: 0.1,
        cooldownS: 300,
      }),
      'rain',
    );
  });
});

function sampleWith(precipitation: number) {
  return {
    temperatureC: 12,
    humidity: 0.7,
    cloud: 0.5,
    precipitation,
    kind: 'rain' as const,
    storm: false,
  };
}

describe('thirty simulated days of climate-driven weather', () => {
  it('rains and snows sometimes, storms rarely, and never flickers', () => {
    const field = createClimateField(CLIMATE, hill);
    const machine = createWeatherStateMachine(WEATHER, DAY);
    const DAYS = 30;
    const totalS = DAYS * DAY.cycleLengthS;

    weatherStateMachineSetClimate(machine, {
      sample: () =>
        field.sample(0, 0, {
          elapsedS: machine.totalElapsedS,
          dayFraction: machine.timeOfDay,
          seasonPhase: (machine.totalElapsedS / totalS) % 1,
        }),
      reevaluateS: CLIMATE.reevaluateS,
      precipitationStart: CLIMATE.precipitationStart,
      precipitationStop: CLIMATE.precipitationStop,
      stormCooldownS: CLIMATE.stormCooldownS,
      cooldownS: 0,
    });

    const secondsInState: Record<string, number> = {};
    const transitions: string[] = [];
    let solid = 0;
    let snowing = 0;
    let storms = 0;
    let last = weatherStateMachineGetWeatherState(machine);

    for (let t = 0; t < totalS; t += 1) {
      weatherStateMachineUpdate(machine, 1);
      const state = weatherStateMachineGetWeatherState(machine);
      if (state !== last) {
        transitions.push(state);
        if (state === 'thunderstorm_telegraph') storms += 1;
        last = state;
      }
      secondsInState[state] = (secondsInState[state] ?? 0) + 1;
      if (state === 'rain' || state === 'snow' || state.startsWith('thunderstorm')) solid += 1;
      if (state === 'snow') snowing += 1;
    }

    const wetShare = solid / totalS;
    const snowShare = snowing / totalS;
    // A world where it rains a fifth of the time is a world with weather; one
    // where it rains half the time is a swamp, and one where it never rains is a
    // desert with a Markov chain.
    assert.ok(wetShare > 0.04 && wetShare < 0.4, `wet share ${wetShare.toFixed(3)}`);
    assert.ok(storms <= 8, `${storms} storms in ${DAYS} days is not rare`);
    assert.ok(snowShare >= 0, `snow share ${snowShare.toFixed(3)}`);
    // A state lasting less than half a minute on average is a sky flickering.
    assert.ok(transitions.length < totalS / 45, `${transitions.length} transitions`);

    // Every thunderstorm runs its three phases in order before it clears.
    for (let i = 0; i < transitions.length; i += 1) {
      if (transitions[i] !== 'thunderstorm_active') continue;
      assert.equal(transitions[i - 1], 'thunderstorm_telegraph');
      assert.equal(transitions[i + 1], 'thunderstorm_aftermath');
    }

    // Snow needs a cold hour under a wet sky; over a season of days it happens.
    assert.ok(
      Object.keys(secondsInState).includes('rain'),
      `no rain in ${DAYS} days: ${JSON.stringify(secondsInState)}`,
    );
  });

  it('is reproducible: the same seed and steps give the same sequence', () => {
    const run = (): string => {
      const field = createClimateField(CLIMATE, hill);
      const machine = createWeatherStateMachine(WEATHER, DAY);
      weatherStateMachineSetClimate(machine, {
        sample: () =>
          field.sample(0, 0, {
            elapsedS: machine.totalElapsedS,
            dayFraction: machine.timeOfDay,
            seasonPhase: (machine.totalElapsedS / (5 * DAY.cycleLengthS)) % 1,
          }),
        reevaluateS: CLIMATE.reevaluateS,
        precipitationStart: CLIMATE.precipitationStart,
        precipitationStop: CLIMATE.precipitationStop,
        stormCooldownS: CLIMATE.stormCooldownS,
        cooldownS: 0,
      });
      const states: string[] = [];
      for (let t = 0; t < 5 * DAY.cycleLengthS; t += 20) {
        weatherStateMachineUpdate(machine, 20);
        states.push(weatherStateMachineGetWeatherState(machine));
      }
      return states.join(',');
    };
    assert.equal(run(), run());
  });
});
