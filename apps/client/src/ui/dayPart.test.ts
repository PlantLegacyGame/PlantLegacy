import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dayPartAt } from './dayPart.ts';

describe('day part', () => {
  it('names the four parts at their own hours', () => {
    assert.equal(dayPartAt(0.5).word, 'Day');
    assert.equal(dayPartAt(0.25).word, 'Dawn');
    assert.equal(dayPartAt(0.75).word, 'Dusk');
    assert.equal(dayPartAt(0).word, 'Night');
    assert.equal(dayPartAt(0.95).word, 'Night');
  });

  it('turns over exactly on the hour that starts the part', () => {
    // 05:00 dawn, 08:00 day, 17:00 dusk, 20:00 night.
    assert.equal(dayPartAt(4.99 / 24).word, 'Night');
    assert.equal(dayPartAt(5 / 24).word, 'Dawn');
    assert.equal(dayPartAt(7.99 / 24).word, 'Dawn');
    assert.equal(dayPartAt(8 / 24).word, 'Day');
    assert.equal(dayPartAt(16.99 / 24).word, 'Day');
    assert.equal(dayPartAt(17 / 24).word, 'Dusk');
    assert.equal(dayPartAt(19.99 / 24).word, 'Dusk');
    assert.equal(dayPartAt(20 / 24).word, 'Night');
  });

  it('carries a sun or a moon, and wraps a clock past midnight', () => {
    assert.equal(dayPartAt(0.5).glyph, '\u2600');
    assert.equal(dayPartAt(0.05).glyph, '\u263E');
    assert.equal(dayPartAt(1.5).word, 'Day', 'a fraction past 1 wraps to the same hour');
    assert.equal(dayPartAt(-0.5).word, 'Day', 'a negative fraction wraps forwards');
  });

  it('treats a missing clock as midnight rather than throwing', () => {
    assert.equal(dayPartAt(Number.NaN).word, 'Night');
  });
});
