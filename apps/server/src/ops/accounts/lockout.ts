/**
 * The lockout decision, as a pure function.
 *
 * It lived inline in `service.ts` and was *copied* into the test file, so the
 * test certified its own replica: the service could change the rule and the
 * test would keep passing. INV-AU-05 was one of those changes — a lock that runs
 * out now starts the count again, because the counter used to survive expiry and
 * one wrong password after a fifteen-minute lock re-locked the account at once.
 */

export interface LockoutState {
  /** Failed attempts counted so far. */
  attempts: number;
  /** When the current lock ends, or null when the account is not locked. */
  lockedUntil: Date | null;
}

export interface LockoutPolicy {
  maxAttempts: number;
  durationMs: number;
}

export interface FailedAttemptResult {
  attempts: number;
  lockedUntil: Date | null;
  /** True when this attempt leaves the account locked (now or still). */
  locked: boolean;
}

/**
 * One failed password. An attempt made *while* the account is locked extends the
 * lock without touching the count; an attempt made after the lock has run out
 * starts the count from zero.
 */
export function nextFailedAttempt(
  state: LockoutState,
  policy: LockoutPolicy,
  now: Date,
): FailedAttemptResult {
  const locked = state.lockedUntil !== null && state.lockedUntil > now;
  if (locked) {
    return {
      attempts: state.attempts + 1,
      lockedUntil: new Date(now.getTime() + policy.durationMs),
      locked: true,
    };
  }
  const attempts = 1;
  if (attempts >= policy.maxAttempts) {
    return { attempts, lockedUntil: new Date(now.getTime() + policy.durationMs), locked: true };
  }
  return { attempts, lockedUntil: null, locked: false };
}

/** A password that worked clears both the count and the lock. */
export function nextSuccessfulLogin(): LockoutState {
  return { attempts: 0, lockedUntil: null };
}

/** True while the account may not sign in, whatever the password. */
export function isLocked(state: LockoutState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil > now;
}
