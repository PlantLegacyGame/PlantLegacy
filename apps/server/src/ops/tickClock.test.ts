import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createTickClock,
  tickClockGetConfig,
  tickClockGetTick,
  tickClockStart,
  tickClockStop,
} from './tickClock.ts';

describe('TickClock', () => {
  it('initializes with tick 0 and not running', () => {
    const clock = createTickClock({
      tickRateHz: 20,
      maxFrameTimeMs: 100,
      onTick: () => {},
    });

    assert.equal(tickClockGetTick(clock), 0);
    assert.equal(clock.running, false);
    assert.equal(tickClockGetConfig(clock).tickRateHz, 20);
    assert.equal(tickClockGetConfig(clock).maxFrameTimeMs, 100);
  });

  it('runs tick callback and increments tick count', async () => {
    let tickCount = 0;
    const clock = createTickClock({
      tickRateHz: 100, // fast ticks for test
      maxFrameTimeMs: 100,
      onTick: (tick, dt) => {
        tickCount = tick;
        assert.ok(dt > 0);
      },
    });

    tickClockStart(clock);
    assert.equal(clock.running, true);

    // Wait 50ms (at 100Hz = 10ms per tick, should produce multiple ticks)
    await new Promise((resolve) => setTimeout(resolve, 50));

    tickClockStop(clock);
    assert.equal(clock.running, false);
    assert.ok(tickCount >= 2, `Expected at least 2 ticks, got ${tickCount}`);
    assert.equal(tickClockGetTick(clock), tickCount);
  });

  it('handles error in onTick callback without crashing', async () => {
    let errorCaught = false;
    const clock = createTickClock({
      tickRateHz: 100,
      maxFrameTimeMs: 100,
      onTick: () => {
        throw new Error('test tick error');
      },
      onError: (err) => {
        errorCaught = true;
        assert.equal(err.message, 'test tick error');
      },
    });

    tickClockStart(clock);
    await new Promise((resolve) => setTimeout(resolve, 30));
    tickClockStop(clock);

    assert.equal(errorCaught, true);
  });
});
