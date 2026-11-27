import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import type { AccountsConfig } from './config.ts';
import { AccountsService } from './service.ts';

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

const ACCOUNT_ROW = {
  id: 'acct_1',
  username: 'grower',
  display_name: 'New Name',
  password_hash: 'x',
  role: 'player',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
  last_login_at: null,
  failed_login_attempts: 0,
  locked_until: null,
};

function service(attemptCount: number) {
  const rateLimitArgs: unknown[][] = [];
  let accountWrites = 0;
  const client = {
    query: async (_text: string, values: unknown[] = []) => {
      rateLimitArgs.push(values);
      return { rows: [{ attempt_count: attemptCount }] };
    },
    release: () => {},
  };
  const pool = {
    connect: async () => client,
    query: async () => {
      accountWrites += 1;
      return { rows: [ACCOUNT_ROW] };
    },
  } as unknown as Pool;
  return { service: new AccountsService(pool, config), rateLimitArgs, writes: () => accountWrites };
}

describe('AccountsService - display-name rate limit', () => {
  it('keys the rate limit by account and endpoint before writing the name', async () => {
    const { service: accounts, rateLimitArgs, writes } = service(1);

    const result = await accounts.changeDisplayName('acct_1', 'New Name');

    assert.ok(!('error' in result), 'a change inside the limit should succeed');
    assert.equal(writes(), 1);
    assert.equal(rateLimitArgs.length, 1);
    assert.equal(rateLimitArgs[0]?.[1], 'acct_1');
    assert.equal(rateLimitArgs[0]?.[2], 'display_name');
  });

  it('refuses the sixth change in a minute without touching the accounts row', async () => {
    const { service: accounts, writes } = service(6);

    const result = await accounts.changeDisplayName('acct_1', 'New Name');

    assert.ok('error' in result);
    assert.match(result.error, /Too many display name changes/);
    assert.equal(writes(), 0, 'a refused change must not reach the UPDATE');
  });
});
