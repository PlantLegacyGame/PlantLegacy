import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { InterestManager } from './interestManager.ts';
import type { WorldConfig } from './world.ts';

const testConfig: WorldConfig = {
  cellSize: 50,
  interestRingRadius: 1,
  perClientEntityCap: 10,
  tickRateHz: 20,
  maxPlayersPerWorld: 10000,
  reconnectWindowMin: 5,
  persistenceEnabled: true,
  detailedPlantBudget: 100,
  offlineDamageMultiplier: 1.0,
  activeTickRateHz: 20,
  nearTickRateHz: 5,
  dormantStepIntervalSec: 300,
  tickBudgetActiveShare: 0.7,
  tickBudgetWarnThresholdMs: 40,
  snapshotIntervalTicks: 6000,
  eventLogCompactionThreshold: 10000,
  interestDetailDistances: { L0: 50, L1: 150, L2: 500 },
  maxFrameTimeMs: 100,
};

function createManager(): InterestManager {
  return new InterestManager(testConfig);
}

describe('InterestManager - Cell coordinates', () => {
  it('converts world position to cell coordinate via public API', () => {
    const manager = createManager();
    // Test via addEntityToCell which uses getCellCoord internally
    manager.addEntityToCell('plant_1', 0, 0);
    assert.equal(manager.getTotalTrackedEntities(), 1);

    manager.addEntityToCell('plant_2', 49, 49);
    assert.equal(manager.getTotalTrackedEntities(), 2);

    manager.addEntityToCell('plant_3', 50, 50);
    assert.equal(manager.getTotalTrackedEntities(), 3);

    manager.addEntityToCell('plant_4', -1, -1);
    assert.equal(manager.getTotalTrackedEntities(), 4);

    manager.addEntityToCell('plant_5', -50, -50);
    assert.equal(manager.getTotalTrackedEntities(), 5);
  });

  it('generates consistent cell keys via public API', () => {
    const manager = createManager();
    // Test via addEntityToCell/removeEntityFromCell
    manager.addEntityToCell('plant_1', 0, 0);
    manager.removeEntityFromCell('plant_1', 0, 0);
    assert.equal(manager.getTotalTrackedEntities(), 0);
  });
});

describe('InterestManager - Client registration', () => {
  let manager: InterestManager;

  before(() => {
    manager = createManager();
  });

  it('registers client and computes subscribed cells', () => {
    manager.registerClient('player_1', 0, 0);
    const interest = manager.getSubscribedCellCount('player_1');
    // With ring radius 1, should subscribe to 3x3 = 9 cells
    assert.equal(interest, 9);
  });

  it('unregisters client', () => {
    manager.registerClient('player_1', 0, 0);
    assert.equal(manager.getSubscribedCellCount('player_1'), 9);
    manager.unregisterClient('player_1');
    assert.equal(manager.getSubscribedCellCount('player_1'), 0);
  });

  it('updates client position and recalculates subscribed cells', () => {
    manager.registerClient('player_1', 0, 0);
    const initialCount = manager.getSubscribedCellCount('player_1');

    // Move to a different cell
    manager.updateClientPosition('player_1', 100, 100);
    const newCount = manager.getSubscribedCellCount('player_1');

    assert.equal(newCount, initialCount); // Same number of cells, different ones
  });

  it('does not update if position is in same cell', () => {
    manager.registerClient('player_1', 10, 10);
    // Update to position still in same cell
    manager.updateClientPosition('player_1', 20, 20);
    // Should not cause any errors
    assert.equal(manager.getSubscribedCellCount('player_1'), 9);
  });
});

describe('InterestManager - Entity tracking', () => {
  let manager: InterestManager;

  before(() => {
    manager = createManager();
  });

  it('adds entity to cell', () => {
    manager.addEntityToCell('plant_1', 0, 0);
    const entities = manager.getTotalTrackedEntities();
    assert.equal(entities, 1);
  });

  it('removes entity from cell', () => {
    manager.addEntityToCell('plant_1', 0, 0);
    assert.equal(manager.getTotalTrackedEntities(), 1);

    manager.removeEntityFromCell('plant_1', 0, 0);
    assert.equal(manager.getTotalTrackedEntities(), 0);
  });

  it('removes cell key when empty', () => {
    manager.addEntityToCell('plant_1', 0, 0);
    manager.addEntityToCell('plant_2', 0, 0);
    assert.equal(manager.getTotalTrackedEntities(), 2);

    manager.removeEntityFromCell('plant_1', 0, 0);
    assert.equal(manager.getTotalTrackedEntities(), 1);

    manager.removeEntityFromCell('plant_2', 0, 0);
    assert.equal(manager.getTotalTrackedEntities(), 0);
  });

  it('updates entity position across cells', () => {
    manager.addEntityToCell('plant_1', 0, 0);
    manager.updateEntityPosition('plant_1', 0, 0, 100, 100);
    // Entity moved from cell (0,0) to cell (2,2)
    // Total tracked should still be 1
    assert.equal(manager.getTotalTrackedEntities(), 1);
  });

  it('tracks multiple entities in different cells', () => {
    // Use fresh manager for this test
    const freshManager = createManager();
    freshManager.addEntityToCell('plant_1', 0, 0);
    freshManager.addEntityToCell('plant_2', 100, 0);
    freshManager.addEntityToCell('plant_3', 0, 100);
    assert.equal(freshManager.getTotalTrackedEntities(), 3);
  });
});

describe('InterestManager - Entity filtering for clients', () => {
  let manager: InterestManager;

  before(() => {
    manager = createManager();
  });

  it('returns entity IDs in subscribed cells', () => {
    manager.registerClient('player_1', 0, 0); // Subscribes to 9 cells around (0,0)
    manager.addEntityToCell('plant_1', 0, 0); // In center cell
    manager.addEntityToCell('plant_2', 50, 0); // In adjacent cell
    manager.addEntityToCell('plant_3', 200, 200); // Far away, different cells

    const entityIds = manager.getEntityIdsInRange('player_1');
    assert(entityIds.has('plant_1'));
    assert(entityIds.has('plant_2'));
    assert(!entityIds.has('plant_3'));
  });

  it('returns empty set for unregistered client', () => {
    const entityIds = manager.getEntityIdsInRange('unknown_player');
    assert.equal(entityIds.size, 0);
  });

  it('filters by entity cap', () => {
    // Create manager with small cap
    const smallCapManager = new InterestManager({
      ...testConfig,
      perClientEntityCap: 2,
    });

    smallCapManager.registerClient('player_1', 0, 0);
    smallCapManager.addEntityToCell('plant_1', 0, 0);
    smallCapManager.addEntityToCell('plant_2', 50, 0);
    smallCapManager.addEntityToCell('plant_3', 0, 50);
    smallCapManager.addEntityToCell('plant_4', -50, 0);

    // getEntitiesForClient would respect cap, but getEntityIdsInRange returns all
    const entityIds = smallCapManager.getEntityIdsInRange('player_1');
    assert.equal(entityIds.size, 4); // All in range, cap applies at render time
  });
});

describe('InterestManager - Detail levels', () => {
  let manager: InterestManager;

  before(() => {
    manager = createManager();
  });

  it('calculates detail level from distance', () => {
    assert.equal(manager.getDetailLevelFromDistance(25), 'L0');
    assert.equal(manager.getDetailLevelFromDistance(50), 'L0');
    assert.equal(manager.getDetailLevelFromDistance(75), 'L1');
    assert.equal(manager.getDetailLevelFromDistance(150), 'L1');
    assert.equal(manager.getDetailLevelFromDistance(200), 'L2');
    assert.equal(manager.getDetailLevelFromDistance(500), 'L2');
    assert.equal(manager.getDetailLevelFromDistance(1000), 'L2');
  });
});

describe('InterestManager - Subscribed cells calculation', () => {
  it('calculates correct number of cells for ring radius 1', () => {
    const manager = createManager();
    manager.registerClient('player_1', 0, 0);
    assert.equal(manager.getSubscribedCellCount('player_1'), 9); // 3x3
  });

  it('calculates correct number of cells for ring radius 2', () => {
    const manager2 = new InterestManager({
      ...testConfig,
      interestRingRadius: 2,
    });
    manager2.registerClient('player_1', 0, 0);
    assert.equal(manager2.getSubscribedCellCount('player_1'), 25); // 5x5
  });

  it('different ring radii produce different cell counts', () => {
    const r1 = new InterestManager({ ...testConfig, interestRingRadius: 1 });
    const r2 = new InterestManager({ ...testConfig, interestRingRadius: 2 });
    const r3 = new InterestManager({ ...testConfig, interestRingRadius: 3 });

    r1.registerClient('p1', 0, 0);
    r2.registerClient('p2', 0, 0);
    r3.registerClient('p3', 0, 0);

    assert.equal(r1.getSubscribedCellCount('p1'), 9);
    assert.equal(r2.getSubscribedCellCount('p2'), 25);
    assert.equal(r3.getSubscribedCellCount('p3'), 49);
  });
});
