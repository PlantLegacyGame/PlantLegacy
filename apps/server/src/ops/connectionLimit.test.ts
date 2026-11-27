import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { admitsConnection, hasPlayerCapacity } from './connectionLimit.ts';

describe('connection admission', () => {
  it('admits addresses below the cap and refuses the cap', () => {
    assert.equal(admitsConnection(0, 32), true);
    assert.equal(admitsConnection(31, 32), true);
    assert.equal(admitsConnection(32, 32), false);
    assert.equal(admitsConnection(33, 32), false);
  });

  it('applies the same boundary to world player capacity', () => {
    assert.equal(hasPlayerCapacity(9_999, 10_000), true);
    assert.equal(hasPlayerCapacity(10_000, 10_000), false);
  });

  it('never turns a zero or broken maximum into an unlimited cap', () => {
    assert.equal(admitsConnection(0, 0), true);
    assert.equal(admitsConnection(1, 0), false);
    assert.equal(hasPlayerCapacity(1, Number.NaN), false);
  });
});
