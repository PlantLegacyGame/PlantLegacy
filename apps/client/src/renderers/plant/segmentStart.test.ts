import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { segmentStartFor } from './segmentStart.ts';

describe('segmentStartFor', () => {
  it('starts at the server attach point when one was sent', () => {
    const start = segmentStartFor({
      attach: { x: 1, y: 2, z: 3 },
      parentPosition: { x: 9, y: 9, z: 9 },
      growsUp: true,
    });
    assert.deepEqual(start, { x: 1, y: 2, z: 3 });
  });

  it('leaves a seed from the top of its coat when growing up', () => {
    const start = segmentStartFor({
      parentPosition: { x: 4, y: 0.5, z: -2 },
      seedCoatTopY: 1.02,
      growsUp: true,
    });
    assert.deepEqual(start, { x: 4, y: 1.02, z: -2 });
  });

  it('leaves a seed from its buried contact point when growing down', () => {
    const start = segmentStartFor({
      parentPosition: { x: 4, y: 0.5, z: -2 },
      seedCoatTopY: 1.02,
      growsUp: false,
    });
    assert.deepEqual(start, { x: 4, y: 0.5, z: -2 });
  });

  it('continues from the parent end for ordinary nodes', () => {
    const start = segmentStartFor({
      parentPosition: { x: -1, y: 2.5, z: 0.25 },
      growsUp: true,
    });
    assert.deepEqual(start, { x: -1, y: 2.5, z: 0.25 });
  });
});
