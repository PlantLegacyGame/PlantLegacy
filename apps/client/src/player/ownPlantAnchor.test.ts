import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ownBodyNodes, resolveOwnAnchor } from './ownPlantAnchor.ts';

describe('own plant anchor', () => {
  it('takes the server-named root crown even when another node is listed first', () => {
    const mirror = new Map<string, never>();
    // A leftover crown from an earlier position is inserted first, exactly the
    // order that made the camera fly back to the old spot.
    mirror.set('old:seed', {
      id: 'old:seed',
      position: { x: 99, y: 0, z: 99 },
      parentId: null,
    } as never);
    mirror.set('crown', { id: 'crown', position: { x: 4, y: 0, z: 6 }, parentId: null } as never);
    const anchor = resolveOwnAnchor(mirror, 'crown');
    assert.deepEqual(anchor, { x: 4, y: 0, z: 6 });
  });

  it('falls back to a seed, then to any parentless node', () => {
    const withSeed = new Map<string, never>();
    withSeed.set('stem', { id: 'stem', position: { x: 1, y: 1, z: 1 }, parentId: 'seed' } as never);
    withSeed.set('seed', {
      id: 'seed',
      position: { x: 2, y: 0, z: 2 },
      parentId: null,
      isSeed: true,
    } as never);
    assert.deepEqual(resolveOwnAnchor(withSeed, null), { x: 2, y: 0, z: 2 });

    const orphan = new Map<string, never>();
    orphan.set('crown', { id: 'crown', position: { x: 3, y: 0, z: 0 }, parentId: null } as never);
    assert.deepEqual(resolveOwnAnchor(orphan, undefined), { x: 3, y: 0, z: 0 });
  });

  it('falls back to the last streamed position when the mirror is empty', () => {
    const streamed = { x: 12, y: 0.25, z: -3 };
    assert.deepEqual(resolveOwnAnchor(new Map(), null, streamed), streamed);
    assert.equal(resolveOwnAnchor(new Map(), null, null), null);
    assert.equal(resolveOwnAnchor(undefined, undefined, null), null);
  });

  it('filters the body to nodes that belong to this plant', () => {
    // The ids here are the shape the server mints: sixteen characters of the
    // plant id, then a colon, then the part's own name (INV-GR-05). An earlier
    // version of this test used eight-character tags, and the client kept that
    // shorter rule long after minting moved on - see ownBodyNodes.
    const plantId = 'p_a1b2c3d4-1111-2222-3333-444455556666';
    const body = [
      { id: 'a1b2c3d4-1111-22:seed' },
      { id: 'a1b2c3d4-1111-22:seed.stem0' },
      { id: 'deadbeef-9999-88:seed' },
    ];
    assert.deepEqual(
      ownBodyNodes(body, plantId).map((node) => node.id),
      ['a1b2c3d4-1111-22:seed', 'a1b2c3d4-1111-22:seed.stem0'],
    );
    // The eight-character prefix alone must not be enough: that is the shape the
    // client accepted for a while, and it also matches a colliding plant.
    assert.deepEqual(
      ownBodyNodes([{ id: 'a1b2c3d4:seed' }], plantId).map((node) => node.id),
      ['a1b2c3d4:seed'],
      'an id it cannot read is kept, not dropped: an empty body is worse than a stale node',
    );
    // Synthetic ids with no plant tag must not blank the plant.
    assert.equal(ownBodyNodes([{ id: 'node-1' }, { id: 'node-2' }], plantId).length, 2);
    assert.equal(ownBodyNodes(body, null).length, 3);
  });
});
