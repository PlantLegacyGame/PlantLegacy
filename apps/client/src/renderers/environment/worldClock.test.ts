/**
 * The client clock follows the server; it never decides the hour itself.
 *
 * These tests cover the two failures that made the dev time controls look like
 * they worked: a local freeze the next broadcast overrode, and an hour that kept
 * advancing after the server had stopped it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advanceWorldClock,
  applyServerClock,
  clockCatchUpRate,
  DEFAULT_WORLD_CLOCK,
  shortestDayDelta,
  withTimeOfDay,
  wrapDayFraction,
} from './worldClock.ts';

describe('world clock', () => {
  it('advances a full day in exactly one cycle length', () => {
    // An 8 s cycle in 1 s steps: every increment is exactly representable, so
    // the seam can be asserted instead of approximated.
    let clock = { ...DEFAULT_WORLD_CLOCK, timeOfDay: 0 };
    for (let i = 0; i < 8; i += 1) {
      clock = advanceWorldClock(clock, 1, 8);
    }
    assert.equal(clock.timeOfDay, 0);
  });

  it('holds the hour while the server says it is paused', () => {
    const paused = { timeOfDay: 0.5, paused: true, scale: 1 };
    const after = advanceWorldClock(paused, 10, 600);
    assert.equal(after.timeOfDay, 0.5);
  });

  it('applies the server speed multiplier to the local advance', () => {
    const fast = { timeOfDay: 0, paused: false, scale: 10 };
    const after = advanceWorldClock(fast, 6, 600);
    assert.ok(Math.abs(after.timeOfDay - 0.1) < 1e-9);
  });

  it('takes the hour and the mode from a broadcast', () => {
    const clock = applyServerClock(DEFAULT_WORLD_CLOCK, {
      timeOfDay: 0.75,
      timePaused: true,
      timeScale: 30,
    });
    assert.equal(clock.timeOfDay, 0.75);
    assert.equal(clock.paused, true);
    assert.equal(clock.scale, 30);
  });

  it('leaves mode alone for a payload that only carries the hour', () => {
    const clock = applyServerClock({ timeOfDay: 0, paused: true, scale: 4 }, { timeOfDay: 0.4 });
    assert.equal(clock.timeOfDay, 0.4);
    assert.equal(clock.paused, true, 'an older server must not release a freeze');
    assert.equal(clock.scale, 4);
  });

  it('keeps a dev jump from freezing the clock on its own', () => {
    const jumped = withTimeOfDay({ ...DEFAULT_WORLD_CLOCK, paused: false }, 1.25);
    assert.ok(Math.abs(jumped.timeOfDay - 0.25) < 1e-9);
    assert.equal(jumped.paused, false);
  });

  it('wraps negative and non-finite hours instead of drawing a wrong sky', () => {
    assert.ok(Math.abs(wrapDayFraction(-0.25) - 0.75) < 1e-9);
    assert.equal(wrapDayFraction(Number.NaN), 0);
    const clock = applyServerClock(DEFAULT_WORLD_CLOCK, { timeOfDay: Number.NaN });
    assert.equal(clock.timeOfDay, DEFAULT_WORLD_CLOCK.timeOfDay);
  });
});

describe('chasing the server clock', () => {
  it('measures the gap the short way round the day', () => {
    assert.ok(Math.abs(shortestDayDelta(0.2, 0.25) - 0.05) < 1e-9);
    assert.ok(Math.abs(shortestDayDelta(0.25, 0.2) + 0.05) < 1e-9);
    // A client at 0.999 and a server at 0.001 are seconds apart, not a day.
    assert.ok(Math.abs(shortestDayDelta(0.999, 0.001)) < 0.01);
    assert.ok(Math.abs(shortestDayDelta(0.001, 0.999)) < 0.01);
  });

  it('closes a gap over the catch-up window instead of teleporting', () => {
    // The server is behind by half a minute of a one-hour day: the local clock
    // slows and still runs forward, which is the whole point.
    const behind = clockCatchUpRate(-(30 / 3600), 3600, 5);
    assert.ok(behind < 1, 'a clock that ran ahead slows down');
    assert.ok(behind > 0, 'it never runs backwards');
    // Ahead: it speeds up, bounded.
    const ahead = clockCatchUpRate(30 / 3600, 3600, 5);
    assert.ok(ahead > 1);
    assert.ok(ahead <= 6);
  });

  it('keeps pace when the two agree, and cannot spin the sky', () => {
    assert.equal(clockCatchUpRate(0, 3600, 5), 1);
    assert.equal(clockCatchUpRate(Number.NaN, 3600, 5), 1);
    assert.equal(clockCatchUpRate(0.01, 0, 5), 1);
    // Half a day out is a jump, not drift: clamp rather than race.
    assert.equal(clockCatchUpRate(0.5, 3600, 5), 6);
    assert.equal(clockCatchUpRate(-0.5, 3600, 5), 0.05);
  });
});
