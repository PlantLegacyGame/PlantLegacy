import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextFailedAttempt, nextSuccessfulLogin } from './lockout.ts';

const MINUTE = 60 * 1000;
const policy = {
  maxAttempts: 5,
  durationMs: 15 * MINUTE,
  maxDurationMs: 60 * MINUTE,
};

describe('nextFailedAttempt', () => {
  it('starts a lock at the configured duration', () => {
    const now = new Date('2026-11-27T00:00:00Z');
    const result = nextFailedAttempt({ attempts: 4, lockedUntil: null }, policy, now);
    assert.equal(result.attempts, 5);
    assert.equal(result.locked, true);
    assert.equal(result.lockedUntil?.getTime(), now.getTime() + 15 * MINUTE);
  });

  it('extends the existing lock rather than restarting it from now', () => {
    const now = new Date('2026-11-27T00:00:00Z');
    const lockedUntil = new Date(now.getTime() + 10 * MINUTE);
    const result = nextFailedAttempt({ attempts: 5, lockedUntil }, policy, now);
    assert.equal(result.attempts, 6);
    assert.equal(result.lockedUntil?.getTime(), lockedUntil.getTime() + 15 * MINUTE);
  });

  it('caps repeated extensions at the maximum remaining lock window', () => {
    const now = new Date('2026-11-27T00:00:00Z');
    const lockedUntil = new Date(now.getTime() + 59 * MINUTE);
    const result = nextFailedAttempt({ attempts: 12, lockedUntil }, policy, now);
    assert.equal(result.lockedUntil?.getTime(), now.getTime() + 60 * MINUTE);
  });

  it('locks after the configured number of ordinary failures', () => {
    const now = new Date('2026-11-27T00:00:00Z');
    let state = { attempts: 0, lockedUntil: null as Date | null };
    for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
      state = nextFailedAttempt(state, policy, now);
    }
    assert.equal(state.attempts, policy.maxAttempts);
    assert.equal(state.lockedUntil?.getTime(), now.getTime() + 15 * MINUTE);
  });

  it('starts the count over after the previous lock has expired', () => {
    const now = new Date('2026-11-27T00:00:00Z');
    const expired = new Date(now.getTime() - MINUTE);
    const result = nextFailedAttempt({ attempts: 5, lockedUntil: expired }, policy, now);
    assert.equal(result.attempts, 1);
    assert.equal(result.locked, false);
    assert.equal(result.lockedUntil, null);
  });

  it('clears both the count and the lock after a successful login', () => {
    assert.deepEqual(nextSuccessfulLogin(), { attempts: 0, lockedUntil: null });
  });
});
