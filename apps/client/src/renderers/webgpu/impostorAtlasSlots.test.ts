import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ImpostorAtlasSlots } from './impostorAtlasSlots.ts';

describe('ImpostorAtlasSlots', () => {
  it('hands out row-major tiles up to capacity', () => {
    const slots = new ImpostorAtlasSlots(3, 2);
    assert.equal(slots.capacity, 6);
    const granted = ['a', 'b', 'c', 'd'].map((id) => slots.acquire(id, 1));
    assert.deepEqual(
      granted.map((grant) => [grant?.column, grant?.row]),
      [
        [0, 0],
        [1, 0],
        [2, 0],
        [0, 1],
      ],
    );
    assert.equal(
      granted.every((grant) => grant?.assigned),
      true,
    );
  });

  it('reuses the tile a plant already holds instead of taking a second one', () => {
    const slots = new ImpostorAtlasSlots(2, 2);
    const first = slots.acquire('a', 10);
    const again = slots.acquire('a', 20);
    assert.deepEqual(again, { column: first?.column, row: first?.row, assigned: false });
    assert.equal(slots.size, 1);
  });

  it('keeps each plant in its own tile when the plant order changes', () => {
    // This is the regression the id keys exist for: with index keys, plant 'b'
    // inherited plant 'a' s tile when 'a' vanished from the frame's array.
    const slots = new ImpostorAtlasSlots(4, 1);
    slots.acquire('a', 1);
    slots.acquire('b', 2);
    slots.retain(new Set(['b']));

    assert.equal(slots.slotOf('a'), undefined);
    assert.deepEqual(slots.slotOf('b'), { column: 1, row: 0 });
  });

  it('evicts the least recently used plant when the atlas is full', () => {
    const slots = new ImpostorAtlasSlots(2, 1);
    slots.acquire('a', 1);
    slots.acquire('b', 2);
    slots.acquire('a', 3); // 'a' is now the fresher one

    const grant = slots.acquire('c', 4);

    assert.equal(grant?.evictedPlantId, 'b');
    assert.equal(grant?.assigned, true);
    assert.deepEqual(slots.slotOf('a'), { column: 0, row: 0 });
    assert.deepEqual(slots.slotOf('c'), { column: 1, row: 0 });
    assert.equal(slots.slotOf('b'), undefined);
  });

  it('reuses a released tile before evicting anyone', () => {
    const slots = new ImpostorAtlasSlots(2, 1);
    slots.acquire('a', 1);
    slots.acquire('b', 2);

    const released = slots.retain(new Set(['b']));
    assert.deepEqual(released, ['a']);

    const grant = slots.acquire('c', 3);
    assert.equal(grant?.evictedPlantId, undefined);
    assert.deepEqual(grant, { column: 0, row: 0, assigned: true });
  });

  it('releases every plant that is not retained, and forgets everything on clear', () => {
    const slots = new ImpostorAtlasSlots(3, 1);
    for (const id of ['a', 'b', 'c']) slots.acquire(id, 1);

    assert.deepEqual(slots.retain(new Set(['c'])), ['a', 'b']);
    assert.equal(slots.size, 1);

    slots.clear();
    assert.equal(slots.size, 0);
    assert.equal(slots.acquire('a', 2)?.column, 0);
  });
});
