import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatSeasonChip, formatSeasonRemaining } from './seasonLabel.ts';

describe('season label', () => {
  it('reads in days for most of a season', () => {
    assert.equal(formatSeasonRemaining(36 * 86_400), '36 d 0 h');
    assert.equal(formatSeasonRemaining(2 * 86_400 + 4 * 3_600), '2 d 4 h');
  });

  it('drops to hours, then minutes, then seconds', () => {
    assert.equal(formatSeasonRemaining(5 * 3_600 + 30 * 60), '5 h 30 m');
    assert.equal(formatSeasonRemaining(9 * 60 + 15), '9 m');
    assert.equal(formatSeasonRemaining(42), '42 s');
  });

  it('never renders a negative or NaN countdown', () => {
    assert.equal(formatSeasonRemaining(-1), '0 s');
    assert.equal(formatSeasonRemaining(Number.NaN), '0 s');
  });

  it('builds the whole chip from one season number and a countdown', () => {
    assert.equal(formatSeasonChip(3, 86_400), 'Season 3   1 d 0 h');
  });
});
