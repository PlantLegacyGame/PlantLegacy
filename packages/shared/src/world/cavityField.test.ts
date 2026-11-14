import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCavityField,
  cavityContains,
  cavityDistance,
  cavityRayRange,
  coveringSphereOf,
  DEFAULT_CAVITY_OPTIONS,
} from './cavityField.ts';

function node(x: number, y: number, z: number, radius: number, id = `${x}:${y}:${z}`) {
  return { id, x, y, z, radius };
}

describe('cavity field', () => {
  it('returns an empty field when there is nothing underground', () => {
    const field = buildCavityField([], []);
    assert.equal(field.bubbles.length, 0);
    assert.equal(field.coveringSphere.radius, 0);
    assert.equal(cavityContains(field, { x: 0, y: 0, z: 0 }), false);
  });

  it('merges nearby nodes into one bubble', () => {
    const field = buildCavityField(
      [node(0, -1, 0, 0.2, 'a'), node(0.1, -1, 0.1, 0.2, 'b'), node(0.2, -1, 0.2, 0.2, 'c')],
      [],
      { mergeCellM: 0.6, minBubbleRadiusM: 0.1 },
    );
    assert.equal(field.bubbles.length, 1);
  });

  it('keeps distant nodes as separate bubbles', () => {
    const field = buildCavityField([node(0, -1, 0, 0.2), node(5, -1, 0, 0.2)], [], {
      mergeCellM: 0.6,
    });
    assert.equal(field.bubbles.length, 2);
  });

  it('never drops the own plant before a rival', () => {
    const own = Array.from({ length: 80 }, (_, i) => node(i * 2, -1, 0, 0.3, `own${i}`));
    const rivals = Array.from({ length: 80 }, (_, i) => node(i * 2, -1, 8, 0.9, `rival${i}`));
    const field = buildCavityField(own, rivals, {
      ...DEFAULT_CAVITY_OPTIONS,
      maxBubbles: 10,
      rivalBudget: 4,
      mergeCellM: 0.1,
    });
    assert.equal(field.bubbles.length, 10);
    // The own clusters are within a metre of z = -1 after burying; rivals sit
    // near z = 8. At least six of the ten slots must describe own roots.
    const ownBubbles = field.bubbles.filter((bubble) => Math.abs(bubble.z + 1) < 3).length;
    assert.ok(ownBubbles >= 6, `only ${ownBubbles} own bubbles survived`);
  });

  it('caps bubbles at maxBubbles and reports drops', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => node(i * 3, -1, 0, 0.2, `n${i}`));
    const field = buildCavityField(nodes, [], {
      ...DEFAULT_CAVITY_OPTIONS,
      maxBubbles: 8,
      mergeCellM: 0.1,
    });
    assert.ok(field.bubbles.length <= 8);
    assert.ok(field.dropped > 0);
  });

  it('fuses distances so the interior is negative and the outside positive', () => {
    const field = buildCavityField([node(0, -2, 0, 1)], [], { minBubbleRadiusM: 1 });
    const inside = cavityDistance(field, 0, -2, 0);
    const outside = cavityDistance(field, 5, -2, 0);
    assert.ok(inside < 0);
    assert.ok(outside > 0);
  });

  it('answers contains consistently with the soil shader fusion', () => {
    const field = buildCavityField([node(0, -2, 0, 1)], [], { minBubbleRadiusM: 1 });
    assert.equal(cavityContains(field, { x: 0, y: -2.2, z: 0 }), true);
    assert.equal(cavityContains(field, { x: 4, y: -2, z: 0 }), false);
  });

  it('covers every bubble with its covering sphere', () => {
    const field = buildCavityField(
      [node(0, -1, 0, 0.5), node(9, -2, -4, 0.8), node(-6, -1, 3, 0.3)],
      [],
      { mergeCellM: 0.2 },
    );
    const sphere = coveringSphereOf(field.bubbles);
    for (const bubble of field.bubbles) {
      const reach =
        Math.hypot(bubble.x - sphere.x, bubble.y - sphere.y, bubble.z - sphere.z) + bubble.radius;
      assert.ok(reach <= sphere.radius + 1e-6);
    }
  });

  it('finds a ray interval through the cavity', () => {
    const field = buildCavityField([node(0, -2, 0, 1)], [], { minBubbleRadiusM: 1 });
    const range = cavityRayRange(field, { x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 20);
    assert.ok(range);
    assert.ok(range.enter < range.exit);
  });

  it('returns null for a ray that misses', () => {
    const field = buildCavityField([node(0, -2, 0, 1)], [], { minBubbleRadiusM: 1 });
    assert.equal(cavityRayRange(field, { x: 20, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 20), null);
  });
});
