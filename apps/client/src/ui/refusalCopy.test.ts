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
    assert.equal(
      refusalCopy('item_not_usable'),
      'That item cannot be used yet - open the inventory to read why.',
    );
    assert.equal(refusalCopy('item_gone'), 'That item is already gone.');
  });

  it('covers the growth refusals, including sentence-style reasons', () => {
    assert.equal(refusalCopy('insufficient_biomass_for_node'), 'Insufficient biomass to grow.');
    assert.equal(
      refusalCopy('insufficient_energy_for_germination'),
      'Not enough energy to germinate.',
    );
    assert.equal(
      refusalCopy('Roots must grow downward'),
      'Root direction too shallow/horizontal - trace a route that ends clearly below the node (it can arc near the surface).',
    );
    assert.equal(refusalCopy('plant_mismatch'), 'Plant mismatch - refresh to sync.');
  });

  it('covers dev-command and server error codes', () => {
    assert.equal(refusalCopy('no_plant'), 'There is no plant to act on.');
    assert.equal(refusalCopy('grant_failed'), 'That item could not be granted.');
    assert.equal(refusalCopy('bad_tile'), 'That tile is not valid.');
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
