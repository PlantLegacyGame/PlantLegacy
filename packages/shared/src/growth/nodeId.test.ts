import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nodeBelongsToPlant, PLANT_NODE_TAG_LENGTH, plantNodeTag } from './nodeId.ts';

/**
 * A node id is minted from the plant's tag, and the client reads ids back to
 * decide what belongs to the plant it is drawing. It used to read them with its
 * own copy of the rule, at eight characters, while INV-GR-05 had moved minting
 * to sixteen. Every node the server made failed the client's test, so the first
 * growth event pruned the whole mirror: the plant disappeared and Root Sight's
 * cavity closed with it, then both came back when the next sync arrived.
 */
describe('node ids', () => {
  const plantId = 'p_7de297df-8304-4a1b-9c2d-0123456789ab';

  it('mints a tag the client can read back', () => {
    // Sixteen characters of the uuid: 8 + hyphen + 4 + hyphen + 2. This is the
    // tag the live server's nodes actually carry.
    assert.equal(plantNodeTag(plantId), '7de297df-8304-4a');
    assert.equal(plantNodeTag(plantId).length, PLANT_NODE_TAG_LENGTH);
    assert.equal(PLANT_NODE_TAG_LENGTH, 16);
    // The two shapes the server actually produces.
    assert.equal(nodeBelongsToPlant('7de297df-8304-4a:seed', plantId), true);
    assert.equal(nodeBelongsToPlant('7de297df-8304-4a:seed.radicle0', plantId), true);
  });

  it('does not claim another plant, however close its id looks', () => {
    assert.equal(nodeBelongsToPlant('11111111-2222-3333-4444:seed', plantId), false);
    // The eight-character prefix alone is not enough: this is the exact shape the
    // client used to accept, and accepting it would claim a colliding plant.
    assert.equal(nodeBelongsToPlant('7de297df:seed', plantId), false);
    assert.equal(nodeBelongsToPlant('', plantId), false);
  });

  it('answers for a plant id that is not a generated id', () => {
    assert.equal(plantNodeTag('abc'), 'abc');
    assert.equal(nodeBelongsToPlant('abc:seed', 'abc'), true);
    assert.equal(plantNodeTag('p_'), '');
    assert.equal(nodeBelongsToPlant('anything:seed', 'p_'), false);
  });
});
