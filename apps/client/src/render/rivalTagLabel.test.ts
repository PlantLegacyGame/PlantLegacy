import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ownerCaption, rivalTagLabel } from './rivalTagLabel.ts';

describe('the tag over a rival plant', () => {
  it("uses the owner's display name, not an id slice", () => {
    assert.equal(rivalTagLabel('p_7f3a91c0', 'Fern Test', undefined), ' · Fern Test');
    assert.equal(rivalTagLabel('p_7f3a91c0', 'Fern Test', ['Glowcap']), 'Glowcap · Fern Test');
  });

  it('falls back to the id only when the owner has no name to send', () => {
    // An offline plant's row carries no display name.
    assert.equal(rivalTagLabel('p_7f3a91c0', undefined, undefined), ' · p_7f3a');
    assert.equal(rivalTagLabel('p_7f3a91c0', '   ', undefined), ' · p_7f3a');
  });

  it('names a gallery plant after its mutation alone', () => {
    assert.equal(rivalTagLabel('gallery:glow', 'Gallery', ['Glowcap']), 'Glowcap');
    assert.equal(rivalTagLabel('gallery:glow', undefined, undefined), '');
  });

  it('takes the first mutation when a plant expresses several', () => {
    assert.equal(rivalTagLabel('p_1', 'Moss', ['Glowcap', 'Thorned']), 'Glowcap · Moss');
  });
});

describe('the owner line in Inspect', () => {
  it('prints the display name, trimmed, and never an id', () => {
    assert.equal(ownerCaption('Fern Test'), 'Fern Test');
    assert.equal(ownerCaption('  Moss Keeper  '), 'Moss Keeper');
  });

  it('says there is no name rather than inventing one from an owner id', () => {
    assert.equal(ownerCaption(undefined), 'Unnamed plant');
    assert.equal(ownerCaption(''), 'Unnamed plant');
    assert.equal(ownerCaption('   '), 'Unnamed plant');
  });
});
