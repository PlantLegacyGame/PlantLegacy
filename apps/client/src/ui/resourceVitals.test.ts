import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clockChip,
  formatEta,
  formatVital,
  rateText,
  vitalRow,
  weatherChip,
} from './resourceVitals.ts';

describe('vitals rows', () => {
  it('draws a bar only where a capacity exists', () => {
    assert.equal(vitalRow({ id: 'b', label: 'Biomass', value: 1 }).fraction, null);
    assert.equal(
      vitalRow({ id: 'w', label: 'Water', value: 20, capacity: 40, precision: 0 }).fraction,
      0.5,
    );
  });

  it('writes a store against its capacity, not a bare float', () => {
    assert.equal(
      vitalRow({ id: 'w', label: 'Water', value: 20, capacity: 40 }).valueText,
      '20.0/40',
    );
    assert.equal(vitalRow({ id: 'n', label: 'Nodes', value: 3, precision: 0 }).valueText, '3');
  });

  it('grades low and critical stores', () => {
    const options = { lowFraction: 0.25, criticalFraction: 0.1 };
    assert.equal(
      vitalRow({ id: 'w', label: 'Water', value: 30, capacity: 40 }, options).tone,
      'ok',
    );
    assert.equal(
      vitalRow({ id: 'w', label: 'Water', value: 9, capacity: 40 }, options).tone,
      'low',
    );
    assert.equal(
      vitalRow({ id: 'w', label: 'Water', value: 3, capacity: 40 }, options).tone,
      'critical',
    );
  });

  it('treats an unusable capacity as unbounded instead of dividing by zero', () => {
    for (const capacity of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(vitalRow({ id: 'w', label: 'Water', value: 5, capacity }).fraction, null);
    }
  });

  it('clamps a store that overflows its own capacity', () => {
    assert.equal(vitalRow({ id: 'w', label: 'Water', value: 90, capacity: 40 }).fraction, 1);
  });

  it('keeps whole numbers whole', () => {
    assert.equal(formatVital(40.4, 0), '40');
    assert.equal(formatVital(1.04, 1), '1.0');
  });
});

describe('rates', () => {
  it('says nothing when nothing is happening', () => {
    assert.equal(rateText(0), '');
    assert.equal(rateText(0.01), '');
    assert.equal(rateText(null), '');
    assert.equal(rateText(undefined), '');
    assert.equal(rateText(Number.NaN), '');
  });

  it('signs a real change', () => {
    assert.equal(rateText(1.24), '+1.2/s');
    assert.equal(rateText(-0.36), '-0.4/s');
  });
});

describe('clock chip', () => {
  const format = (seconds: number): string => `${Math.round(seconds / 3600)} h`;

  it('puts the season, day and hour on one line', () => {
    assert.equal(
      clockChip({ season: 1, day: 3, time: '11:44', seasonRemainingS: 3600 * 5 }, format).main,
      'Season 1 \u00B7 Day 3 \u00B7 11:44',
    );
  });

  it('keeps the season countdown in the sub-line and the tooltip', () => {
    const chip = clockChip({ season: 2, day: 7, time: '22:05', seasonRemainingS: 7200 }, format);
    assert.equal(chip.sub, 'Season ends in 2 h');
    assert.match(chip.title, /Season 2, day 7, 22:05/);
    assert.match(chip.title, /2 h/);
  });

  it('says nothing about a season it does not know', () => {
    const chip = clockChip({ season: 1, day: 1, time: '06:00' }, format);
    assert.equal(chip.sub, '');
  });
});

describe('weather chip', () => {
  it('stays calm on a clear sky', () => {
    const chip = weatherChip({
      state: 'clear',
      label: 'Clear',
      nextLabel: 'Rain',
      nextState: 'rain',
      secondsUntilNext: 400,
    });
    assert.equal(chip.tone, 'calm');
    assert.equal(chip.urgent, false);
  });

  it('announces an approaching change', () => {
    const chip = weatherChip({
      state: 'clear',
      label: 'Clear',
      nextLabel: 'Storm approaching',
      nextState: 'thunderstorm_telegraph',
      secondsUntilNext: 193,
    });
    assert.equal(chip.eta, 'Storm approaching in 3:13');
    assert.equal(chip.tone, 'notice');
  });

  it('turns urgent inside the last minute', () => {
    const chip = weatherChip({
      state: 'clear',
      label: 'Clear',
      nextLabel: 'Storm approaching',
      nextState: 'thunderstorm_telegraph',
      secondsUntilNext: 42,
    });
    assert.equal(chip.urgent, true);
  });

  it('marks weather that is already happening', () => {
    const chip = weatherChip({
      state: 'thunderstorm_active',
      label: 'Thunderstorm',
      nextLabel: 'Clearing',
      nextState: 'thunderstorm_aftermath',
      secondsUntilNext: 30,
    });
    assert.equal(chip.tone, 'warning');
  });

  it('drops a countdown to the same state and never goes negative', () => {
    const same = weatherChip({
      state: 'rain',
      label: 'Rain',
      nextLabel: 'Rain',
      nextState: 'rain',
      secondsUntilNext: 100,
    });
    assert.equal(same.eta, '');
    assert.equal(formatEta(-9), '0:00');
  });
});
