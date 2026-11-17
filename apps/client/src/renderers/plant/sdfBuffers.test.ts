import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { segmentStartFor } from './segmentStart.ts';

/**
 * The SDF and CPU mesh paths both start a child at `segmentStartFor`. These
 * cases pin the attachment surface down without importing the renderer (which
 * needs the browser Three.js module and is covered by the build instead).
 */
describe('node attachment start', () => {
  it('uses the server attach point on the parent surface', () => {
    const start = segmentStartFor({
      attach: { x: 0.04, y: 1.2, z: -0.03 },
      parentPosition: { x: 0, y: 1, z: 0 },
      growsUp: true,
    });
    assert.deepEqual(start, { x: 0.04, y: 1.2, z: -0.03 });
  });

  it('lets an explicit attach point win over the seed fallback', () => {
    const start = segmentStartFor({
      attach: { x: 0, y: 0, z: 0 },
      parentPosition: { x: 0, y: 0, z: 0 },
      seedCoatTopY: 0.2,
      growsUp: true,
    });
    // An explicit attach point wins; the seed fallback is only for payloads
    // that predate attach metadata.
    assert.deepEqual(start, { x: 0, y: 0, z: 0 });
  });

  it('uses the coat top when the server sent no attach point', () => {
    const start = segmentStartFor({
      parentPosition: { x: 3, y: 0, z: 4 },
      seedCoatTopY: 0.2,
      growsUp: true,
    });
    assert.deepEqual(start, { x: 3, y: 0.2, z: 4 });
  });
});
