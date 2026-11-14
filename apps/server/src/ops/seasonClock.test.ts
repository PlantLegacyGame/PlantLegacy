import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSeasonClock,
  restoreSeasonClock,
  seasonClockAdvance,
  seasonEndsAtTick,
  seasonLengthTicks,
  seasonRemainingSeconds,
  seasonSnapshot,
  seasonUpdatePayload,
} from './seasonClock.ts';

describe('season clock', () => {
  it('measures a season in ticks, not wall time', () => {
    // 36 real days at 20 Hz.
    assert.equal(seasonLengthTicks(36, 20), 36 * 86_400 * 20);
    assert.equal(seasonLengthTicks(1, 20), 1_728_000);
  });

  it('clamps a nonsense length to one tick instead of dividing by zero', () => {
    assert.equal(seasonLengthTicks(0, 20), 1);
    assert.equal(seasonLengthTicks(-5, 20), 1);
    assert.equal(seasonLengthTicks(Number.NaN, 20), 1);
    assert.equal(seasonLengthTicks(1, 0), 86_400);
  });

  it('does not advance before the season ends', () => {
    const clock = createSeasonClock(1, 20);
    const before = seasonEndsAtTick(clock) - 1;
    const result = seasonClockAdvance(clock, before);
    assert.equal(result.seasonsPassed, 0);
    assert.equal(result.clock, clock);
    assert.equal(result.clock.season, 1);
  });

  it('rolls to the next season at the boundary and keeps the same length', () => {
    const clock = createSeasonClock(1, 20);
    const result = seasonClockAdvance(clock, seasonEndsAtTick(clock));
    assert.equal(result.seasonsPassed, 1);
    assert.equal(result.clock.season, 2);
    assert.equal(result.clock.startedTick, clock.lengthTicks);
    assert.equal(result.clock.lengthTicks, clock.lengthTicks);
  });

  it('counts every season crossed by a long pause', () => {
    const clock = createSeasonClock(1, 20);
    const result = seasonClockAdvance(clock, clock.lengthTicks * 3 + 5);
    assert.equal(result.seasonsPassed, 3);
    assert.equal(result.clock.season, 4);
    assert.equal(result.clock.startedTick, clock.lengthTicks * 3);
    // The fifth season's countdown is the remainder of the fourth's span.
    assert.equal(
      seasonRemainingSeconds(result.clock, clock.lengthTicks * 3 + 5, 20),
      (clock.lengthTicks - 5) / 20,
    );
  });

  it('saves and restores the season with the same time left', () => {
    const clock = createSeasonClock(1, 20, 4);
    const tick = 1_000;
    const saved = seasonSnapshot(clock, tick, 1_700_000_000_000);
    assert.equal(saved.season, 4);
    assert.equal(saved.remainingTicks, clock.lengthTicks - tick);
    assert.equal(saved.lastCalamityAt, 1_700_000_000_000);

    // A restart sets the tick counter back to zero; the saved remainder must
    // still be the remainder, not a fresh season.
    const restored = restoreSeasonClock(1, 20, saved);
    assert.equal(restored.season, 4);
    assert.equal(seasonRemainingSeconds(restored, 0, 20), saved.remainingTicks / 20);
    assert.equal(seasonClockAdvance(restored, saved.remainingTicks - 1).seasonsPassed, 0);
    assert.equal(seasonClockAdvance(restored, saved.remainingTicks).seasonsPassed, 1);
  });

  it('clamps a corrupt saved season instead of trusting it', () => {
    const length = seasonLengthTicks(1, 20);
    const over = restoreSeasonClock(1, 20, {
      season: 0,
      remainingTicks: length * 10,
      lastCalamityAt: null,
    });
    assert.equal(over.season, 1);
    assert.equal(seasonEndsAtTick(over), length);

    const negative = restoreSeasonClock(1, 20, {
      season: 2.9,
      remainingTicks: -50,
      lastCalamityAt: null,
    });
    assert.equal(negative.season, 2);
    // Nothing left means the season is over, not that it gets a full one.
    assert.equal(seasonEndsAtTick(negative), 0);
    assert.equal(seasonClockAdvance(negative, 0).seasonsPassed, 1);
  });

  it('reports whole remaining seconds for the client countdown', () => {
    const clock = createSeasonClock(1, 20);
    const payload = seasonUpdatePayload(clock, 20 * 100, 20);
    assert.equal(payload.season, 1);
    assert.equal(payload.remainingSeconds, 86_400 - 100);
    assert.equal(payload.calamity, false);

    const calamity = seasonUpdatePayload(clock, seasonEndsAtTick(clock), 20, true);
    assert.equal(calamity.remainingSeconds, 0);
    assert.equal(calamity.calamity, true);
  });
});
