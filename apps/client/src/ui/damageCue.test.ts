import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { damageCueDue, MIN_DAMAGE_CUE_GAP_MS } from './damageCue.ts';

const due = (overrides: Partial<Parameters<typeof damageCueDue>[0]> = {}) =>
  damageCueDue({
    nowMs: 5_000,
    lastPulseAtMs: 0,
    pulseMs: 420,
    running: false,
    ...overrides,
  });

describe('damageCueDue', () => {
  it('never starts a second pulse while one is running', () => {
    assert.equal(due({ running: true, lastPulseAtMs: 0 }), false);
  });

  it('refuses a pulse inside the gap', () => {
    // 10 Hz damage broadcast: a message every 100 ms must not restart the fade.
    assert.equal(due({ lastPulseAtMs: 4_900 }), false);
    assert.equal(due({ lastPulseAtMs: 4_200, nowMs: 5_000, pulseMs: 420 }), false);
  });

  it('allows one pulse per gap', () => {
    assert.equal(due({ lastPulseAtMs: 4_000 }), true);
    assert.equal(due({ lastPulseAtMs: 3_900 }), true);
  });

  it('floors the gap at one second even for a short fade', () => {
    assert.equal(due({ pulseMs: 120, lastPulseAtMs: 4_500 }), false);
    assert.equal(due({ pulseMs: 120, lastPulseAtMs: 5_000 - MIN_DAMAGE_CUE_GAP_MS }), true);
  });

  it('honours a fade longer than the floor', () => {
    assert.equal(due({ pulseMs: 1_800, lastPulseAtMs: 3_400 }), false);
    assert.equal(due({ pulseMs: 1_800, lastPulseAtMs: 3_100 }), true);
  });

  it('pulses on the first damage of a session', () => {
    assert.equal(due({ lastPulseAtMs: Number.NEGATIVE_INFINITY }), true);
  });
});
