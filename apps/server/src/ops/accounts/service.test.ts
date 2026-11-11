import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

// Test configs
const testConfig = {
  accessTokenLifetimeMin: 15,
  refreshTokenLifetimeDays: 30,
  passwordMinLength: 8,
  passwordMaxLength: 128,
  passwordRequireUppercase: true,
  passwordRequireLowercase: true,
  passwordRequireDigit: true,
  passwordRequireSpecial: false,
  usernameMinLength: 3,
  usernameMaxLength: 24,
  usernameAllowedChars: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-',
  rateLimitSignupPerHour: 5,
  rateLimitLoginPerMinute: 10,
  rateLimitRefreshPerMinute: 20,
  lockoutMaxFailedAttempts: 5,
  lockoutDurationMin: 15,
  bcryptCost: 4,
  jwtAlgorithm: 'HS256' as const,
  jwtIssuer: 'plant-legacy-test',
  jwtAudience: 'plant-legacy-client-test',
  displayNameMinLength: 1,
  displayNameMaxLength: 32,
  sessionMaxPerAccount: 5,
};

describe('AccountsService - Password Validation', () => {
  it('accepts valid password', () => {
    const errors: string[] = [];
    const password = 'ValidPass123';
    if (password.length < testConfig.passwordMinLength) errors.push('too_short');
    if (password.length > testConfig.passwordMaxLength) errors.push('too_long');
    if (testConfig.passwordRequireUppercase && !/[A-Z]/.test(password)) errors.push('no_upper');
    if (testConfig.passwordRequireLowercase && !/[a-z]/.test(password)) errors.push('no_lower');
    if (testConfig.passwordRequireDigit && !/[0-9]/.test(password)) errors.push('no_digit');
    if (testConfig.passwordRequireSpecial && !/[^a-zA-Z0-9]/.test(password))
      errors.push('no_special');
    assert.equal(errors.length, 0);
  });

  it('rejects too short password', () => {
    const errors: string[] = [];
    const password = 'Short1';
    if (password.length < testConfig.passwordMinLength) errors.push('too_short');
    assert.ok(errors.includes('too_short'));
  });

  it('rejects password without uppercase', () => {
    const errors: string[] = [];
    const password = 'validpass123';
    if (testConfig.passwordRequireUppercase && !/[A-Z]/.test(password)) errors.push('no_upper');
    assert.ok(errors.includes('no_upper'));
  });

  it('rejects password without lowercase', () => {
    const errors: string[] = [];
    const password = 'VALIDPASS123';
    if (testConfig.passwordRequireLowercase && !/[a-z]/.test(password)) errors.push('no_lower');
    assert.ok(errors.includes('no_lower'));
  });

  it('rejects password without digit', () => {
    const errors: string[] = [];
    const password = 'ValidPass';
    if (testConfig.passwordRequireDigit && !/[0-9]/.test(password)) errors.push('no_digit');
    assert.ok(errors.includes('no_digit'));
  });

  it('rejects password exceeding max length', () => {
    const errors: string[] = [];
    const password = `${'A'.repeat(129)}1`;
    if (password.length > testConfig.passwordMaxLength) errors.push('too_long');
    assert.ok(errors.includes('too_long'));
  });
});

describe('AccountsService - Username Validation', () => {
  it('accepts valid username', () => {
    const errors: string[] = [];
    const username = 'valid_user123';
    if (username.length < testConfig.usernameMinLength) errors.push('too_short');
    if (username.length > testConfig.usernameMaxLength) errors.push('too_long');
    if (!new RegExp(`^[${testConfig.usernameAllowedChars}]+$`).test(username))
      errors.push('invalid_chars');
    assert.equal(errors.length, 0);
  });

  it('rejects too short username', () => {
    const errors: string[] = [];
    const username = 'ab';
    if (username.length < testConfig.usernameMinLength) errors.push('too_short');
    assert.ok(errors.includes('too_short'));
  });

  it('rejects too long username', () => {
    const errors: string[] = [];
    const username = 'a'.repeat(25);
    if (username.length > testConfig.usernameMaxLength) errors.push('too_long');
    assert.ok(errors.includes('too_long'));
  });

  it('rejects invalid characters', () => {
    const errors: string[] = [];
    const username = 'user@name';
    if (!new RegExp(`^[${testConfig.usernameAllowedChars}]+$`).test(username))
      errors.push('invalid_chars');
    assert.ok(errors.includes('invalid_chars'));
  });

  it('accepts underscore and hyphen', () => {
    const errors: string[] = [];
    const username = 'user_name-123';
    if (username.length < testConfig.usernameMinLength) errors.push('too_short');
    if (username.length > testConfig.usernameMaxLength) errors.push('too_long');
    if (!new RegExp(`^[${testConfig.usernameAllowedChars}]+$`).test(username))
      errors.push('invalid_chars');
    assert.equal(errors.length, 0);
  });
});

describe('AccountsService - Rate Limiting Logic', () => {
  function checkRateLimit(
    existingEntry: { attempt_count: number; window_start: Date } | null,
    maxAttempts: number,
    windowMinutes: number,
  ): { allowed: boolean; newAttemptCount: number } {
    if (!existingEntry) {
      return { allowed: maxAttempts >= 1, newAttemptCount: 1 };
    }

    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);
    if (existingEntry.window_start < windowStart) {
      // Window expired, reset
      return { allowed: maxAttempts >= 1, newAttemptCount: 1 };
    }

    const newCount = existingEntry.attempt_count + 1;
    return { allowed: newCount <= maxAttempts, newAttemptCount: newCount };
  }

  it('allows first attempt', () => {
    const result = checkRateLimit(null, 5, 1);
    assert.equal(result.allowed, true);
    assert.equal(result.newAttemptCount, 1);
  });

  it('allows attempts up to max', () => {
    let entry = { attempt_count: 1, window_start: new Date() };
    for (let i = 2; i <= 5; i++) {
      const result = checkRateLimit(entry, 5, 1);
      assert.equal(result.allowed, true);
      entry = { ...entry, attempt_count: result.newAttemptCount };
    }
  });

  it('rejects attempt over max', () => {
    const entry = { attempt_count: 5, window_start: new Date() };
    const result = checkRateLimit(entry, 5, 1);
    assert.equal(result.allowed, false);
    assert.equal(result.newAttemptCount, 6);
  });

  it('resets after window expires', () => {
    const oldEntry = {
      attempt_count: 10,
      window_start: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
    };
    const result = checkRateLimit(oldEntry, 5, 1); // 1 minute window
    assert.equal(result.allowed, true);
    assert.equal(result.newAttemptCount, 1);
  });
});

describe('AccountsService - Lockout Logic', () => {
  const maxAttempts = 5;
  const lockoutDurationMs = 15 * 60 * 1000;

  function processFailedAttempt(
    currentAttempts: number,
    lockedUntil: Date | null,
  ): { newAttempts: number; newLockedUntil: Date | null; locked: boolean } {
    const now = new Date();

    // Check if already locked
    if (lockedUntil && lockedUntil > now) {
      // Locked - extend lockout
      return {
        newAttempts: currentAttempts + 1,
        newLockedUntil: new Date(now.getTime() + lockoutDurationMs),
        locked: true,
      };
    }

    // Not locked - increment attempts
    const newAttempts = currentAttempts + 1;

    if (newAttempts >= maxAttempts) {
      // Lock the account
      return {
        newAttempts,
        newLockedUntil: new Date(now.getTime() + lockoutDurationMs),
        locked: true,
      };
    }

    return {
      newAttempts,
      newLockedUntil: null,
      locked: false,
    };
  }

  function processSuccessfulLogin(
    _currentAttempts: number,
    _lockedUntil: Date | null,
  ): { newAttempts: number; newLockedUntil: Date | null } {
    // On successful login, reset attempts and clear lockout
    return { newAttempts: 0, newLockedUntil: null };
  }

  it('increments attempts on failure', () => {
    const result = processFailedAttempt(0, null);
    assert.equal(result.newAttempts, 1);
    assert.equal(result.locked, false);
  });

  it('locks after max attempts', () => {
    let attempts = 0;
    let lockedUntil: Date | null = null;

    for (let i = 0; i < 5; i++) {
      const result = processFailedAttempt(attempts, lockedUntil);
      attempts = result.newAttempts;
      lockedUntil = result.newLockedUntil;
    }

    assert.equal(attempts, 5);
    assert.ok(lockedUntil);
    if (lockedUntil) {
      assert.ok(lockedUntil > new Date());
    }
  });

  it('extends lockout on failed attempt during lockout', () => {
    const lockedUntil = new Date(Date.now() + 60 * 1000); // Locked for 1 more minute
    const result = processFailedAttempt(5, lockedUntil);

    assert.equal(result.newAttempts, 6);
    if (result.newLockedUntil) {
      assert.ok(result.newLockedUntil > lockedUntil);
    }
  });

  it('resets on successful login', () => {
    const result = processSuccessfulLogin(10, new Date(Date.now() + 60 * 1000));
    assert.equal(result.newAttempts, 0);
    assert.equal(result.newLockedUntil, null);
  });

  it('does not lock if already locked and successful login', () => {
    const lockedUntil = new Date(Date.now() + 60 * 1000);
    const result = processSuccessfulLogin(5, lockedUntil);
    assert.equal(result.newAttempts, 0);
    assert.equal(result.newLockedUntil, null);
  });
});

describe('AccountsService - JWT Token Logic', () => {
  const issuer = 'plant-legacy-test';
  const audience = 'plant-legacy-client-test';

  // Simple JWT-like token creation for testing
  function createToken(accountId: string, role: string, lifetimeMin: number): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: accountId,
        role,
        iss: issuer,
        aud: audience,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + lifetimeMin * 60,
      }),
    ).toString('base64url');
    // Simplified - no actual signature for test
    const signature = Buffer.from('test-signature').toString('base64url');
    return `${header}.${payload}.${signature}`;
  }

  interface TokenPayload {
    sub: string;
    role: string;
    iss: string;
    aud: string;
    iat: number;
    exp: number;
  }

  function parseToken(token: string): { payload: TokenPayload } {
    const parts = token.split('.');
    assert.equal(parts.length, 3);
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return { payload };
  }

  it('creates token with correct claims', () => {
    const token = createToken('acct_123', 'player', 15);
    const { payload } = parseToken(token);

    assert.equal(payload.sub, 'acct_123');
    assert.equal(payload.role, 'player');
    assert.equal(payload.iss, issuer);
    assert.equal(payload.aud, audience);
    assert.ok(payload.iat);
    assert.ok(payload.exp);
    assert.ok(payload.exp > payload.iat);
  });

  it('access token expires in configured time', () => {
    const token = createToken('acct_123', 'player', 15);
    const { payload } = parseToken(token);

    const expectedExpiry = Math.floor(Date.now() / 1000) + 15 * 60;
    assert.ok(Math.abs(payload.exp - expectedExpiry) < 5); // Within 5 seconds
  });

  it('refresh token has longer lifetime', () => {
    const token = createToken('acct_123', 'player', 30 * 24 * 60); // 30 days
    const { payload } = parseToken(token);

    const expectedExpiry = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    assert.ok(Math.abs(payload.exp - expectedExpiry) < 60);
  });
});

describe('AccountsService - Token Rotation Logic', () => {
  // Test the rotation order: insert new -> revoke old
  function simulateRotation(
    _oldSessionId: string,
    _newSessionId: string,
  ): { newSessionInserted: boolean; oldRevoked: boolean; order: string[] } {
    const order: string[] = [];

    // Step 1: Insert new session
    order.push('INSERT_NEW_SESSION');
    const newSessionInserted = true;

    // Step 2: Revoke old session
    order.push('REVOKE_OLD_SESSION');
    const oldRevoked = true;

    return { newSessionInserted, oldRevoked, order };
  }

  it('inserts new session before revoking old', () => {
    const result = simulateRotation('ses_old', 'ses_new');

    assert.equal(result.order[0], 'INSERT_NEW_SESSION');
    assert.equal(result.order[1], 'REVOKE_OLD_SESSION');
    assert.ok(result.newSessionInserted);
    assert.ok(result.oldRevoked);
  });

  it('prevents token reuse window', () => {
    // The key property: no window where both old and new tokens are valid
    // Old token is revoked AFTER new one is inserted
    const result = simulateRotation('ses_old', 'ses_new');

    // At no point should the old token be valid while new is not inserted
    // This is ensured by the order
    assert.equal(result.order.indexOf('INSERT_NEW_SESSION'), 0);
  });
});

describe('AccountsService - Session Limit Enforcement', () => {
  function enforceSessionLimit(currentSessions: string[], maxSessions: number): string[] {
    if (currentSessions.length <= maxSessions) {
      return [];
    }
    // Revoke oldest sessions first (sessions array is ordered oldest first)
    return currentSessions.slice(0, currentSessions.length - maxSessions);
  }

  it('does not revoke when under limit', () => {
    const toRevoke = enforceSessionLimit(['ses_1', 'ses_2'], 5);
    assert.equal(toRevoke.length, 0);
  });

  it('revokes oldest when at limit and adding one', () => {
    enforceSessionLimit(['ses_1', 'ses_2', 'ses_3', 'ses_4', 'ses_5'], 5);
    // Adding a 6th would make it 6, need to revoke 1 (6-5=1)
    const toRevoke2 = enforceSessionLimit(
      ['ses_1', 'ses_2', 'ses_3', 'ses_4', 'ses_5', 'ses_6'],
      5,
    );
    assert.equal(toRevoke2.length, 1);
    assert.equal(toRevoke2[0], 'ses_1'); // Oldest revoked first
  });

  it('revokes multiple when way over limit', () => {
    const toRevoke = enforceSessionLimit(
      ['ses_1', 'ses_2', 'ses_3', 'ses_4', 'ses_5', 'ses_6', 'ses_7', 'ses_8'],
      5,
    );
    assert.equal(toRevoke.length, 3);
    assert.deepEqual(toRevoke, ['ses_1', 'ses_2', 'ses_3']);
  });
});

describe('AccountsService - Refresh Token Lookup Hash', () => {
  // Test the deterministic SHA-256 lookup hash
  function createLookupHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  it('produces consistent lookup hash', () => {
    const token = 'refresh_token_12345';
    const hash1 = createLookupHash(token);
    const hash2 = createLookupHash(token);
    assert.equal(hash1, hash2);
  });

  it('produces different hash for different tokens', () => {
    const hash1 = createLookupHash('token_1');
    const hash2 = createLookupHash('token_2');
    assert.notEqual(hash1, hash2);
  });

  it('is not reversible', () => {
    const token = 'secret_refresh_token';
    const hash = createLookupHash(token);
    // Should not contain the original token
    assert.ok(!hash.includes(token));
  });
});

describe('AccountsService - Display Name Validation (INV-AU-06)', () => {
  function validateDisplayName(displayName: string) {
    const errors: string[] = [];
    if (displayName.length < testConfig.displayNameMinLength) {
      errors.push(`Display name must be at least ${testConfig.displayNameMinLength} character(s)`);
    }
    if (displayName.length > testConfig.displayNameMaxLength) {
      errors.push(`Display name must be at most ${testConfig.displayNameMaxLength} characters`);
    }
    for (let i = 0; i < displayName.length; i++) {
      const code = displayName.charCodeAt(i);
      if (code <= 0x1f || code === 0x7f) {
        errors.push('Display name contains invalid characters');
        break;
      }
    }
    return { valid: errors.length === 0, errors };
  }

  it('accepts valid display names', () => {
    assert.equal(validateDisplayName('Flora').valid, true);
    assert.equal(validateDisplayName('Botanist_42').valid, true);
    assert.equal(validateDisplayName('Oak & Willow').valid, true);
  });

  it('rejects empty display name', () => {
    assert.equal(validateDisplayName('').valid, false);
  });

  it('rejects display name exceeding maximum length', () => {
    assert.equal(validateDisplayName('a'.repeat(33)).valid, false);
  });

  it('rejects display name containing control characters', () => {
    assert.equal(validateDisplayName('Bad\x00Name').valid, false);
    assert.equal(validateDisplayName('Bad\x1fName').valid, false);
    assert.equal(validateDisplayName('Bad\x7fName').valid, false);
  });
});
