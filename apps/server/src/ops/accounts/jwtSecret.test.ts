import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEV_JWT_SECRET,
  isLocalEnvironment,
  MIN_JWT_SECRET_LENGTH,
  resolveJwtSecret,
} from './jwtSecret.ts';

const STRONG = 'a'.repeat(MIN_JWT_SECRET_LENGTH);

describe('resolveJwtSecret', () => {
  it('uses the fixed fallback only in local/test or when NODE_ENV is unset', () => {
    assert.equal(resolveJwtSecret(undefined, undefined), DEV_JWT_SECRET);
    assert.equal(resolveJwtSecret('local', undefined), DEV_JWT_SECRET);
    assert.equal(resolveJwtSecret('test', undefined), DEV_JWT_SECRET);
  });

  it('refuses a missing secret in staging and production', () => {
    assert.throws(() => resolveJwtSecret('staging', undefined), /JWT_SECRET/);
    assert.throws(() => resolveJwtSecret('production', undefined), /JWT_SECRET/);
  });

  it('refuses a short secret outside local/test', () => {
    assert.throws(() => resolveJwtSecret('staging', 'short'), /at least 32/);
    assert.throws(() => resolveJwtSecret('production', 'short'), /at least 32/);
  });

  it('accepts a strong secret anywhere', () => {
    assert.equal(resolveJwtSecret('local', STRONG), STRONG);
    assert.equal(resolveJwtSecret('staging', STRONG), STRONG);
    assert.equal(resolveJwtSecret('production', STRONG), STRONG);
  });

  it('names only local and test as local environments', () => {
    assert.equal(isLocalEnvironment(undefined), true);
    assert.equal(isLocalEnvironment('local'), true);
    assert.equal(isLocalEnvironment('test'), true);
    assert.equal(isLocalEnvironment('staging'), false);
    assert.equal(isLocalEnvironment('production'), false);
  });
});
