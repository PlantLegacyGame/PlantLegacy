import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatClock,
  formatCountdown,
  phaseLabel,
  structureFraction,
  weatherLabel,
} from './PlantStatusHud.ts';

describe('plant status HUD rules', () => {
  it('names every phase', () => {
    assert.equal(phaseLabel('rooted'), 'Rooted');
    assert.equal(phaseLabel('uprooted'), 'Uprooted');
    assert.equal(phaseLabel('tumbling'), 'Tumbling');
    assert.equal(phaseLabel('rerooting'), 'Rerooting');
  });

  it('reads the day fraction as a 24-hour clock', () => {
    assert.equal(formatClock(0), '00:00');
    assert.equal(formatClock(0.5), '12:00');
    assert.equal(formatClock(0.25), '06:00');
    assert.equal(formatClock(0.99999), '23:59');
    assert.equal(formatClock(Number.NaN), '00:00');
  });

  it('formats the reroot window as m:ss and never goes negative', () => {
    assert.equal(formatCountdown(45), '0:45');
    assert.equal(formatCountdown(9.2), '0:10');
    assert.equal(formatCountdown(-3), '0:00');
    assert.equal(formatCountdown(Number.NaN), '0:00');
  });

  it('measures structure against the uproot ceiling', () => {
    assert.equal(structureFraction({ damageHp: 0, threshold: 120 }), 1);
    assert.equal(structureFraction({ damageHp: 60, threshold: 120 }), 0.5);
    assert.equal(structureFraction({ damageHp: 240, threshold: 120 }), 0);
    assert.equal(structureFraction({ damageHp: -5, threshold: 120 }), 1);
  });

  it('treats an unusable threshold as intact rather than dividing by zero', () => {
    assert.equal(structureFraction({ damageHp: 10, threshold: 0 }), 1);
    assert.equal(structureFraction({ damageHp: 10, threshold: Number.NaN }), 1);
  });

  it('uses plain words for weather states', () => {
    assert.equal(weatherLabel('clear'), 'Clear');
    assert.equal(weatherLabel('thunderstorm_telegraph'), 'Storm approaching');
    assert.equal(weatherLabel('something_new'), 'something new');
  });
});
