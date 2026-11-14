import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plantRootPosition, selectVisiblePlants } from './plantVisibility.ts';

interface FakePlant {
  id: string;
  rootNodeId?: string | null;
  nodes: Map<string, { x: number; z: number }>;
}

function plant(id: string, x: number, z: number): FakePlant {
  return {
    id,
    rootNodeId: `${id}_root`,
    nodes: new Map([[`${id}_root`, { x, z }]]),
  };
}

/** Only x matters here: a player at the origin sees things within 150 units. */
function inRange(_playerId: string, x: number, _z: number): boolean {
  return Math.abs(x) <= 150;
}

describe('selectVisiblePlants', () => {
  it('includes an offline plant that is inside the interest range', () => {
    const dormant = plant('dormant_1', 20, 0);
    const visible = selectVisiblePlants({
      plants: [dormant],
      playerId: 'p1',
      ownPlantId: 'p1_plant',
      isInRange: inRange,
    });
    assert.deepEqual(
      visible.map((p) => p.id),
      ['dormant_1'],
      'a plant whose owner is offline is still part of the world',
    );
  });

  it('excludes plants outside the interest range', () => {
    const visible = selectVisiblePlants({
      plants: [plant('far', 900, 0)],
      playerId: 'p1',
      ownPlantId: 'p1_plant',
      isInRange: inRange,
    });
    assert.equal(visible.length, 0);
  });

  it('always keeps the player own plant, in range or not', () => {
    const own = plant('p1_plant', 5000, 0);
    const visible = selectVisiblePlants({
      plants: [own],
      playerId: 'p1',
      ownPlantId: 'p1_plant',
      isInRange: inRange,
    });
    assert.deepEqual(
      visible.map((p) => p.id),
      ['p1_plant'],
    );
  });

  it('can exclude the own plant, which announcements do', () => {
    const visible = selectVisiblePlants({
      plants: [plant('p1_plant', 0, 0), plant('other', 10, 0)],
      playerId: 'p1',
      ownPlantId: 'p1_plant',
      isInRange: inRange,
      includeOwn: false,
    });
    assert.deepEqual(
      visible.map((p) => p.id),
      ['other'],
    );
  });

  it('skips a plant whose root node cannot be resolved', () => {
    const broken: FakePlant = { id: 'broken', rootNodeId: 'missing', nodes: new Map() };
    const noRoot: FakePlant = { id: 'no_root', rootNodeId: null, nodes: new Map() };
    const visible = selectVisiblePlants({
      plants: [broken, noRoot],
      playerId: 'p1',
      ownPlantId: null,
      isInRange: inRange,
    });
    assert.equal(visible.length, 0);
  });

  it('resolves the root position from the root node, not the first node', () => {
    const p: FakePlant = {
      id: 'p',
      rootNodeId: 'root',
      nodes: new Map([
        ['branch', { x: 999, z: 999 }],
        ['root', { x: 5, z: -7 }],
      ]),
    };
    assert.deepEqual(plantRootPosition(p), { x: 5, z: -7 });
  });
});
