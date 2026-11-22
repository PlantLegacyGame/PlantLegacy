import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clampBalance, earnSpores, spendSpores } from './spores.ts';

describe('spore purse', () => {
  it('starts and stays inside its bounds', () => {
    assert.equal(clampBalance(12, 100), 12);
    assert.equal(clampBalance(-5, 100), 0);
    assert.equal(clampBalance(500, 100), 100);
    assert.equal(clampBalance(Number.NaN, 100), 0);
  });

  it('earns whole spores and never passes the ceiling', () => {
    assert.equal(earnSpores(10, 5, 100), 15);
    assert.equal(earnSpores(99, 10, 100), 100);
    assert.equal(earnSpores(10, -5, 100), 10);
  });

  it('refuses a purchase it cannot pay for', () => {
    assert.equal(spendSpores(10, 30, 100), null);
    assert.equal(spendSpores(30, 30, 100), 0);
    assert.equal(spendSpores(100, 45, 100), 55);
  });

  it('refuses a nonsensical price rather than going negative', () => {
    assert.equal(spendSpores(100, -1, 100), null);
    assert.equal(spendSpores(100, Number.NaN, 100), null);
  });
});
