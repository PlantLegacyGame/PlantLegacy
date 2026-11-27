import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { footprintKey, plantFootprints } from './PlantContactShadows.ts';

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

  it('takes the soil it is given as the soil, so a drawn bank hides its roots', () => {
    // The same node, 10.1 m up: standing on a soil at 10, buried in a drawn
    // triangle at 10.5. The caller passes the drawn height, so the second case
    // must not produce a foot from a root tip - that was the patch sliding up a
    // hill that stood half a metre over the field.
    const standing = plantFootprints([node(0, 0.1, 0)], () => 10);
    assert.equal(standing.length, 1);
    const buried = plantFootprints([node(0, 0.1, 0)], () => 10.5);
    assert.equal(buried.length, 0);
  });

  it('keeps a seed-sized floor for a one-node plant', () => {
    const feet = plantFootprints([node(0, 0, 0)], flat);
    assert.equal(feet[0]?.radius, 0.16);
  });
});

describe('the footprint key', () => {
  const foot = (over: Partial<{ x: number; z: number; radius: number; groundY: number }> = {}) => ({
    plantId: 'p1',
    x: 0,
    z: 0,
    radius: 0.5,
    groundY: 10,
    ...over,
  });

  it('is the same for a foot that has not moved on screen', () => {
    // The renderer only re-lays the contact patches when this string changes,
    // and a plant update arrives a dozen times a second while a part grows.
    assert.equal(footprintKey([foot()]), footprintKey([foot()]));
    // Sub-centimetre drift is under a patch's pixel: still the same shade.
    assert.equal(footprintKey([foot()]), footprintKey([foot({ x: 0.004, z: -0.004 })]));
  });

  it('changes when the plant it belongs to, its foot or its spread changes', () => {
    const base = footprintKey([foot()]);
    assert.notEqual(base, footprintKey([foot({ x: 0.5 })]), 'the foot moved');
    assert.notEqual(base, footprintKey([foot({ radius: 0.9 })]), 'the plant spread');
    assert.notEqual(base, footprintKey([{ ...foot(), plantId: 'p2' }]), 'another plant');
    assert.notEqual(base, footprintKey([foot(), { ...foot(), plantId: 'p2' }]), 'a second patch');
    assert.equal(footprintKey([]), '', 'a plant with no body casts nothing');
  });
});
