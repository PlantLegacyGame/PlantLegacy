import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { keepCapacity } from './vitalsCapacity.ts';

describe('the capacity a vitals row is drawn against', () => {
  it('survives a repaint that did not mention the capacity', () => {
    // A growth message carries the store and not its limit; the row must keep
    // the bar and the /limit the last full state gave it.
    const first = keepCapacity(null, 40);
    assert.equal(first, 40);
    assert.equal(keepCapacity(first, undefined), 40);
    assert.equal(keepCapacity(40, null), 40);
  });

  it('follows the capacity when a message does carry one', () => {
    assert.equal(keepCapacity(40, 55), 55);
    assert.equal(keepCapacity(55, 40), 40);
  });

  it('drops the bar for a store that has no capacity', () => {
    // Zero, a negative or a NaN is an answer - there is no store to fill - and
    // must not leave a full bar drawn over nothing.
    assert.equal(keepCapacity(40, 0), null);
    assert.equal(keepCapacity(40, -5), null);
    assert.equal(keepCapacity(40, Number.NaN), null);
    assert.equal(keepCapacity(null, Number.POSITIVE_INFINITY), null);
  });
});
