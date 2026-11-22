import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickNodeHit } from './nodePick.ts';

const seed = { nodeId: 'seed', parentId: null, distance: 5 };
const stem = { nodeId: 'stem', parentId: 'seed', distance: 5 };
const leaf = { nodeId: 'leaf', parentId: 'stem', distance: 5 };

describe('node pick', () => {
  it('returns nothing when the ray hits nothing', () => {
    assert.deepEqual(pickNodeHit([]), { nodeId: null, tieBroken: false });
  });

  it('takes the clearly nearest node', () => {
    const result = pickNodeHit([
      { ...seed, distance: 5 },
      { ...leaf, distance: 6 },
    ]);
    assert.equal(result.nodeId, 'seed');
    assert.equal(result.tieBroken, false);
  });

  it('prefers the child when a parent sphere covers it at the same place', () => {
    // The classic swallow: both spheres meet the ray at the same distance.
    const result = pickNodeHit([seed, stem, leaf], 0.02);
    assert.equal(result.nodeId, 'leaf');
    assert.equal(result.tieBroken, true);
  });

  it('does not break a tie for a node that is genuinely further away', () => {
    const result = pickNodeHit(
      [
        { ...seed, distance: 5 },
        { ...leaf, distance: 5.5 },
      ],
      0.02,
    );
    assert.equal(result.nodeId, 'seed');
  });

  it('breaks ties only inside the window', () => {
    const inside = pickNodeHit(
      [
        { ...seed, distance: 5 },
        { ...leaf, distance: 5.019 },
      ],
      0.02,
    );
    assert.equal(inside.nodeId, 'leaf');
    const outside = pickNodeHit(
      [
        { ...seed, distance: 5 },
        { ...leaf, distance: 5.021 },
      ],
      0.02,
    );
    assert.equal(outside.nodeId, 'seed');
  });

  it('stops walking a broken parent chain', () => {
    const loopA = { nodeId: 'a', parentId: 'b', distance: 5 };
    const loopB = { nodeId: 'b', parentId: 'a', distance: 5.01 };
    const result = pickNodeHit([loopA, loopB], 0.02);
    assert.equal(result.nodeId, 'a');
  });
});
