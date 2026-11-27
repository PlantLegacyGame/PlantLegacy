import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import type { AccountsConfig } from './config.ts';
import { AccountsService } from './service.ts';

// These tests import the real service. The older auth suites in
// service.test.ts re-implement the validation rules inline, so they cannot
// catch defects in service.ts itself.

const SECRET = 'test-secret-for-token-type-binding';

const config: AccountsConfig = {
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
  rateLimitDisplayNamePerMinute: 5,
  lockoutMaxFailedAttempts: 5,
  lockoutDurationMin: 15,
  lockoutMaxDurationMin: 60,
  argon2MemoryKib: 8192,
  argon2TimeCost: 1,
  argon2Parallelism: 1,
  bcryptCost: 4,
  requestBodyMaxBytes: 16384,
  jwtAlgorithm: 'HS256',
  jwtIssuer: 'plant-legacy-test',
  jwtAudience: 'plant-legacy-client-test',
  displayNameMinLength: 1,
  displayNameMaxLength: 32,
  sessionMaxPerAccount: 5,
};

const ACCOUNT_ROW: Record<string, unknown> = {
  id: 'acct_1',
  username: 'grower',
  display_name: 'Grower',
  password_hash: 'x',
  role: 'player',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
  last_login_at: null,
  failed_login_attempts: 0,
  locked_until: null,
};

function createService(row: Record<string, unknown> | null = ACCOUNT_ROW): AccountsService {
  // verifyAccessToken loads the account (INV-AU-03), so the stub answers the one
  // query it makes. `null` means "no such account": a valid signature for an
  // account that has since been deleted.
  const rows = row === null ? [] : [row];
  const pool = { query: async () => ({ rows }) } as unknown as Pool;
  return new AccountsService(pool, config);
}

function sign(claims: Record<string, unknown>, expiresIn: jwt.SignOptions['expiresIn']): string {
  return jwt.sign(claims, SECRET, {
    algorithm: 'HS256',
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    expiresIn,
  });
}

describe('AccountsService - access token type binding', () => {
  it('accepts an access token', async () => {
    process.env.JWT_SECRET = SECRET;
    const service = createService();
    const token = sign({ sub: 'acct_1', role: 'player', type: 'access' }, '15m');

    const result = await service.verifyAccessToken(token);

    assert.ok(!('error' in result), 'access token should verify');
    if ('error' in result) return;
    assert.equal(result.accountId, 'acct_1');
    assert.equal(result.role, 'player');
  });

  it('rejects a refresh token presented as a bearer token', async () => {
    process.env.JWT_SECRET = SECRET;
    const service = createService();
    // Refresh tokens live 30 days; accepting one as an access token would
    // extend a 15-minute credential to a month.
    const token = sign({ sub: 'acct_1', type: 'refresh' }, '30d');

    const result = await service.verifyAccessToken(token);

    assert.ok('error' in result, 'refresh token must not verify as an access token');
  });

  it('rejects a token that carries no type claim', async () => {
    process.env.JWT_SECRET = SECRET;
    const service = createService();
    const token = sign({ sub: 'acct_1', role: 'player' }, '15m');

    const result = await service.verifyAccessToken(token);

    assert.ok('error' in result, 'untyped token must not verify as an access token');
  });

  it('rejects a token for an account that no longer exists', async () => {
    process.env.JWT_SECRET = SECRET;
    const service = createService(null);
    const token = sign({ sub: 'acct_1', role: 'player', type: 'access' }, '15m');

    const result = await service.verifyAccessToken(token);

    assert.ok('error' in result, 'a token outliving its account must not verify');
  });

  it('rejects a token for an account locked after the token was issued', async () => {
    process.env.JWT_SECRET = SECRET;
    const service = createService({
      ...ACCOUNT_ROW,
      locked_until: new Date(Date.now() + 60_000),
    });
    const token = sign({ sub: 'acct_1', role: 'player', type: 'access' }, '15m');

    const result = await service.verifyAccessToken(token);

    assert.ok('error' in result, 'lockout must apply to tokens already minted');
  });

  it('rejects a token whose role no longer matches the account', async () => {
    process.env.JWT_SECRET = SECRET;
    const service = createService({ ...ACCOUNT_ROW, role: 'admin' });
    const token = sign({ sub: 'acct_1', role: 'player', type: 'access' }, '15m');

    const result = await service.verifyAccessToken(token);

    assert.ok('error' in result, 'a demoted account must not keep admin claims');
  });
});
