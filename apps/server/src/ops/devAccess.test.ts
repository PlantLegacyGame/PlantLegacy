/**
 * Dev tools must not reachable by a random player (D01).
 *
 * The failure this guards against is not subtle: with `NODE_ENV` unset the old
 * gate reported `local`, and a public server then handed every player the dev
 * surface. These cases pin the three answers that matter - refused by
 * environment, open locally, and admin-or-allowlist elsewhere.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveDevAccess, resolveDevEnvironment } from './devAccess.ts';

describe('dev access', () => {
  it('refuses dev tools in an environment the config does not name', () => {
    assert.deepEqual(resolveDevEnvironment('production', ['local']), {
      allowed: false,
      reason: 'environment',
    });
    assert.deepEqual(resolveDevEnvironment('staging', ['local']), {
      allowed: false,
      reason: 'environment',
    });
  });

  it('never falls back to local when the list is empty', () => {
    assert.equal(resolveDevEnvironment('production', []).allowed, false);
    assert.equal(resolveDevEnvironment('local', []).allowed, true);
  });

  it('refuses a production player even when they claim admin', () => {
    const decision = resolveDevAccess({
      environment: 'production',
      allowedEnvironments: ['local'],
      adminAccounts: [],
      accountId: 'acct_1',
      role: 'admin',
    });
    assert.deepEqual(decision, { allowed: false, reason: 'environment' });
  });

  it('stays open on a local run, where the panel is the point', () => {
    const decision = resolveDevAccess({
      environment: 'local',
      allowedEnvironments: ['local'],
      adminAccounts: [],
    });
    assert.equal(decision.allowed, true);
  });

  it('requires an admin or an allowlisted account outside local', () => {
    const base = {
      environment: 'staging',
      allowedEnvironments: ['local', 'staging'],
      adminAccounts: ['acct_dev'],
    };
    assert.deepEqual(resolveDevAccess({ ...base, accountId: 'acct_player', role: 'player' }), {
      allowed: false,
      reason: 'not_admin',
    });
    assert.equal(resolveDevAccess({ ...base, role: 'admin' }).allowed, true);
    assert.equal(resolveDevAccess({ ...base, accountId: 'acct_dev' }).allowed, true);
    // An anonymous connection has nothing to check, so it is not a dev.
    assert.equal(resolveDevAccess({ ...base }).allowed, false);
  });

  it('can be closed locally by asking for admin everywhere', () => {
    const decision = resolveDevAccess({
      environment: 'local',
      allowedEnvironments: ['local'],
      adminAccounts: [],
      openLocally: false,
    });
    assert.deepEqual(decision, { allowed: false, reason: 'not_admin' });
  });
});
