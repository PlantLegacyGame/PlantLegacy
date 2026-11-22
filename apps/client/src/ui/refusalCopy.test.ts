import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { refusalCopy } from './refusalCopy.ts';

describe('refusalCopy', () => {
  it('turns shop refusals into a sentence', () => {
    assert.equal(refusalCopy('insufficient_spores'), 'Not enough spores for that.');
    assert.equal(refusalCopy('inventory_full'), 'Your pouch has no room for that.');
    assert.equal(refusalCopy('unknown_item'), 'That item is no longer in the shop.');
  });

  it('covers the item-use refusals too', () => {
    assert.equal(refusalCopy('item_not_usable'), 'That item cannot be used yet.');
    assert.equal(refusalCopy('item_gone'), 'That item is already gone.');
  });

  it('never returns a bare machine reason, even for an unknown one', () => {
    const copy = refusalCopy('some_new_reason');
    assert.equal(copy, 'That action was refused: some new reason.');
    assert.doesNotMatch(copy, /_/);
  });

  it('does not start a sentence with an empty reason', () => {
    assert.equal(refusalCopy(''), 'That action was refused: unknown reason.');
  });
});
