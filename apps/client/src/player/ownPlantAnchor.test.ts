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
    const body = [{ id: 'a1b2c3d4:seed' }, { id: 'a1b2c3d4:seed.stem0' }, { id: 'deadbeef:seed' }];
    assert.deepEqual(
      ownBodyNodes(body, 'p_a1b2c3d4-1111-2222').map((node) => node.id),
      ['a1b2c3d4:seed', 'a1b2c3d4:seed.stem0'],
    );
    // Synthetic ids with no plant tag must not blank the plant.
    assert.equal(ownBodyNodes([{ id: 'node-1' }, { id: 'node-2' }], 'p_a1b2c3d4').length, 2);
    assert.equal(ownBodyNodes(body, null).length, 3);
  });
});
