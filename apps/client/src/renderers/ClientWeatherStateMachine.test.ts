import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type ClientWeatherConfig,
  type ClientWeatherState,
  createClientWeatherStateMachine,
} from './ClientWeatherStateMachine.ts';

const SKY = { zenithColor: '#101010', horizonColor: '#202020', fogNear: 10, fogFar: 100 };

const CONFIG: ClientWeatherConfig = {
  clear: { ...SKY, soilMoisture: 0.2 },
  rain: { ...SKY, soilMoisture: 0.8 },
  thunderstorm_telegraph: { ...SKY, soilMoisture: 0.6 },
  thunderstorm_active: { ...SKY, soilMoisture: 1 },
  thunderstorm_aftermath: { ...SKY, soilMoisture: 0.7 },
  transitionDuration: 6000,
  lightning: { flashDuration: 0.12, maxIntensity: 1 },
};

const machine = (state: ClientWeatherState = 'thunderstorm_active') => {
  const created = createClientWeatherStateMachine(CONFIG);
  created.requestStateChange(state);
  return created;
};

/** Feed `seconds` of frames at 60 fps and return the peak seen. */
function run(m: ReturnType<typeof machine>, seconds: number): number {
  let peak = 0;
  const frames = Math.round(seconds * 60);
  for (let frame = 0; frame < frames; frame += 1) {
    m.update(1000 / 60, 0.5, 1);
    peak = Math.max(peak, m.getLightningIntensity());
  }
  return peak;
}

describe('client lightning', () => {
  it('never strikes on its own, however long a storm runs', () => {
    // The client used to roll its own bolts every 3.5-9 s while the server
    // rolled damage on a separate schedule, so a flash rarely matched a hit.
    const storm = machine();
    assert.equal(run(storm, 60), 0, 'a storm with no WEATHER_STRIKE must stay dark');
  });

  it('flashes when the server strike arrives', () => {
    const storm = machine();
    storm.triggerLightning();
    assert.equal(storm.getLightningIntensity(), CONFIG.lightning.maxIntensity);
  });

  it('fades one flash to nothing within the configured duration', () => {
    const storm = machine();
    storm.triggerLightning();
    storm.update(1000 / 60, 0.5, 1);
    const afterOneFrame = storm.getLightningIntensity();
    assert.ok(afterOneFrame < CONFIG.lightning.maxIntensity);
    assert.ok(afterOneFrame > 0);

    run(storm, CONFIG.lightning.flashDuration + 0.1);
    assert.equal(storm.getLightningIntensity(), 0);
  });

  it('does not restart a transition when the same state is requested again', () => {
    // A broadcast about once a second repeats the state; restarting the fade on
    // each one kept progress below the point where rain flips on.
    const sky = machine('clear');
    sky.requestStateChange('rain');
    sky.update(3000, 0.5, 1);
    sky.requestStateChange('rain');
    sky.update(3001, 0.5, 1);
    assert.equal(sky.isTransitioning(), false, 'the fade ran to the end, not back to zero');
  });

  it('does not flash when the weather changes state', () => {
    const clear = createClientWeatherStateMachine(CONFIG);
    clear.requestStateChange('thunderstorm_active');
    assert.equal(clear.getLightningIntensity(), 0);
  });
});
