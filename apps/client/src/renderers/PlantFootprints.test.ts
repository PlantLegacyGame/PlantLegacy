import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { plantFootprints } from './PlantContactShadows.ts';

/** A node a few centimetres above a flat soil at y = 10. */
function node(x: number, y: number, z: number, plantId = 'p1') {
  return { plantId, isOwnPlant: true, position: { x, y: y + 10, z } };
}

const flat = () => 10;

describe('plant footprints', () => {
  it('sizes the footprint from the plant above the soil, not from its roots', () => {
    const feet = plantFootprints(
      [
        node(0, 0, 0),
        // A canopy a metre out and up.
        node(1, 0.8, 0),
        node(-1, 0.6, 0),
        // A root tip a metre down and two metres away must not count.
        node(2, -1, 0),
      ],
      flat,
    );
    assert.equal(feet.length, 1);
    const foot = feet[0];
    assert.ok(foot);
    assert.equal(foot.radius.toFixed(2), (1 * 0.55).toFixed(2));
    assert.ok(Math.abs(foot.x) < 1e-6 && Math.abs(foot.z) < 1e-6);
  });

  it('puts one footprint under each plant, apart', () => {
    const feet = plantFootprints(
      [node(0, 0, 0, 'p1'), node(0.4, 0.5, 0, 'p1'), node(30, 0, 0, 'p2'), node(31, 0.6, 0, 'p2')],
      flat,
    );
    assert.equal(feet.length, 2);
    const ids = feet.map((f) => f.plantId).sort();
    assert.deepEqual(ids, ['p1', 'p2']);
  });

  it('gives no shadow to a body that is airborne', () => {
    // Uprooted: the whole body is lifted a metre.
    const feet = plantFootprints([node(0, 1, 0), node(0.4, 1.4, 0)], flat);
    assert.equal(feet.length, 0);
  });

  it('keeps a seed-sized floor for a one-node plant', () => {
    const feet = plantFootprints([node(0, 0, 0)], flat);
    assert.equal(feet[0]?.radius, 0.16);
  });
});
