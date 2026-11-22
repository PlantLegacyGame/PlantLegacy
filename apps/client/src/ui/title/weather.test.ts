import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { landingBucket, weatherAt, weatherBetween, weatherFromState } from './weather.ts';

describe('title weather', () => {
  it('gives the same weather for the same hour every time', () => {
    for (const phase of [0, 0.13, 0.4, 0.77, 0.99]) {
      assert.deepEqual(weatherAt(phase, 3), weatherAt(phase, 3));
    }
  });

  it('changes over a day rather than staying one thing', () => {
    const kinds = new Set<string>();
    for (let hour = 0; hour < 8; hour += 1) kinds.add(weatherAt(hour / 8, 12).kind);
    assert.ok(kinds.size >= 2, `only saw ${[...kinds].join(', ')}`);
  });

  it('is mostly fair weather, not a permanent storm', () => {
    let wet = 0;
    for (let day = 0; day < 40; day += 1) {
      for (let hour = 0; hour < 8; hour += 1) {
        if (weatherAt(hour / 8, day).rain > 0) wet += 1;
      }
    }
    const share = wet / (40 * 8);
    assert.ok(share > 0.02 && share < 0.3, `rain on ${(share * 100).toFixed(1)}% of hours`);
  });

  it('keeps every value in range, rain included', () => {
    for (let day = 0; day < 12; day += 1) {
      for (let hour = 0; hour < 8; hour += 1) {
        const w = weatherBetween(hour / 8, day);
        for (const value of [w.cloudiness, w.rain, w.fog, w.wind]) {
          assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
        }
        assert.ok(w.kind.length > 0);
      }
    }
  });

  it('wraps a phase rather than returning nothing', () => {
    assert.deepEqual(weatherAt(-0.5, 1), weatherAt(0.5, 1));
    assert.deepEqual(weatherAt(1.5, 1), weatherAt(0.5, 1));
    assert.equal(weatherAt(Number.NaN).kind, 'clear');
  });

  it("reads the world's weather token so the title matches the game", () => {
    assert.equal(weatherFromState('rain')?.kind, 'rain');
    assert.equal(weatherFromState('Thunderstorm')?.kind, 'rain');
    assert.equal(weatherFromState('clear')?.kind, 'clear');
    assert.equal(weatherFromState('Clear Sky')?.kind, 'clear');
    assert.equal(weatherFromState('overcast')?.kind, 'overcast');
    assert.equal(weatherFromState('fog')?.kind, 'fog');
    assert.equal(weatherFromState('breezy')?.kind, 'breezy');
  });

  it('refuses a token it does not know, so the clock can take over', () => {
    assert.equal(weatherFromState('aurora'), null);
    assert.equal(weatherFromState(''), null);
    assert.equal(weatherFromState(null), null);
    assert.equal(weatherFromState(undefined), null);
  });

  it('eases into the next hour instead of cutting', () => {
    const blended = weatherBetween(0.25, 2);
    const current = weatherAt(0.25, 2);
    const before = weatherAt(0.25 - 1 / 8, 2);
    assert.ok(blended.rain >= Math.min(before.rain, current.rain));
    assert.ok(blended.rain <= Math.max(before.rain, current.rain));
  });
});

describe('landing buckets', () => {
  // The weights are rates, never shares: a field's columns add up to dozens. The
  // pick used to be compared to those raw rates, so the first wet column took almost
  // every draw and every splash ring landed in the leftmost few per cent.
  it('spreads picks across the field in proportion to the rates', () => {
    const weights = [0, 0, 4, 0, 4, 0, 0, 0];
    const hits = new Array(8).fill(0);
    for (let i = 0; i < 100; i += 1) hits[landingBucket(weights, i / 100)] += 1;
    assert.ok(hits[2] > 30 && hits[2] < 70, `column 2 took ${hits[2]} of 100`);
    assert.ok(hits[4] > 30 && hits[4] < 70, `column 4 took ${hits[4]} of 100`);
    assert.equal(hits[0] + hits[1] + hits[3], 0);
  });

  it('falls back to the first column when nothing lands', () => {
    assert.equal(landingBucket([0, 0, 0], 0.9), 0);
    assert.equal(landingBucket([], 0.5), 0);
  });
});
