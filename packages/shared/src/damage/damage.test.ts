import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlantNode } from '../growth/types.ts';
import {
  createTumbleImpulse,
  type DamageConfig,
  type DamageRecord,
  effectiveGustSpeed,
  gustTearsPlantFree,
  impactDamage,
  killCreditFor,
  plantHeight,
  rerootSettleStep,
  rerootSoilIsValid,
  rollFragment,
  rotatePointAroundAxis,
  selectDamageTarget,
  stepTumble,
  type TumblingConfig,
  type UprootConfig,
  uprootDamageThreshold,
} from './index.ts';

function node(partial: Partial<PlantNode> & Pick<PlantNode, 'id' | 'type'>): PlantNode {
  return {
    plantId: 'p1',
    layer: partial.type === 'leaf' || partial.type === 'cotyledon' ? 'canopy' : 'root',
    x: 0,
    y: 0,
    z: 0,
    biomass: 10,
    age: 0,
    parentId: null,
    children: [],
    statModifiers: {},
    resourceDrawWater: 0,
    resourceDrawNutrients: 0,
    resourceDrawMinerals: 0,
    upkeepBiomassPerSecond: 0,
    growthDirectionBias: 'upward',
    lastGrowthTick: 0,
    growthProgress: 1,
    isSeed: false,
    ...partial,
  } as PlantNode;
}

const uproot: UprootConfig = {
  damageThresholdHp: 120,
  rerootWindowS: 45,
  rerootSoilMinMoisture: 18,
  rerootSettleSeconds: 2.5,
  rerootCrawlSpeedMps: 1,
  uprootedBiomassDrainPerS: 0.8,
  detachedWateredDrainMultiplier: 0.2,
  detachedMinTileMoisture: 22,
  detachedPhotosynthesisMultiplier: 0.45,
  detachedDryGraceSeconds: 90,
  detachedGrowthEnabled: false,
  saturationMoisture: 92,
  saturationSeconds: 20,
  saturationCheckIntervalS: 1,
  gustThresholdMps: 22,
  gustHeightReferenceM: 2.5,
  collapseUprootRadiusM: 3,
  uprootLiftM: 0.25,
  uprootTiltDegrees: 72,
};

const tumbling: TumblingConfig = {
  impulseMinMps: 2.5,
  impulseMaxMps: 6.5,
  gravityMps2: 9.81,
  groundFrictionPerS: 3.5,
  bounceDamping: 0.35,
  maxTumbleSeconds: 6,
  impactDamagePerMps: 0.8,
  impactDamageMinSpeedMps: 5,
  rollSpeedMaxRadPerS: 3.2,
  settleSpeedMps: 0.4,
};

const damage: DamageConfig = {
  herbivoreSwarmAutoEnabled: false,
  weatherDamagePerS: 1.2,
  weatherMinBiomass: 0,
  weatherMaxBiomassFractionPerS: 1,
  lightningMaxBiomassFraction: 1,
  stormGustSpeedMps: 28,
  lightningDamageAmount: 18,
  herbivoreSwarmIntervalS: 240,
  herbivoreSwarmRadiusM: 35,
  herbivoreSwarmDurationS: 20,
  herbivoreSwarmDamagePerS: 2.5,
  herbivoreSwarmSpreadM: 60,
  toolDamagePerHit: 10,
  terrainCollapseDamage: 15,
  terrainCollapseRadiusM: 4,
  damageMemoryDecayPerS: 1.5,
  fragmentDropChance: 0.45,
  remainsFragmentCount: 4,
  fragmentLifetimeS: 900,
  dungPerDeath: 1,
  dungPerSwarm: 2,
  dungLifetimeS: 1800,
  killCreditWindowS: 60,
};

describe('damage target selection', () => {
  it('strips exposed foliage before it reaches a trunk or a seed', () => {
    const target = selectDamageTarget(
      [
        node({ id: 'seed', type: 'seed', isSeed: true }),
        node({ id: 'trunk', type: 'trunk', layer: 'canopy' }),
        node({ id: 'leaf-a', type: 'leaf' }),
        node({ id: 'leaf-b', type: 'leaf' }),
      ],
      () => 0.99,
    );
    assert.equal(target?.type, 'leaf');
  });

  it('falls back to the seed when it is all that is left', () => {
    const target = selectDamageTarget([node({ id: 'seed', type: 'seed', isSeed: true })]);
    assert.equal(target?.id, 'seed');
  });

  it('ignores parts that are already gone', () => {
    const target = selectDamageTarget([
      node({ id: 'dead-leaf', type: 'leaf', biomass: 0 }),
      node({ id: 'root', type: 'root' }),
    ]);
    assert.equal(target?.id, 'root');
  });
});

describe('kill credit', () => {
  function record(partial: Partial<DamageRecord>): DamageRecord {
    return { source: 'tool', amount: 1, tick: 0, ...partial };
  }

  it('credits the player with the most damage inside the window', () => {
    const credit = killCreditFor(
      [
        record({ playerId: 'a', amount: 10, tick: 90 }),
        record({ playerId: 'b', amount: 25, tick: 95 }),
        record({ playerId: 'b', amount: 5, tick: 99 }),
      ],
      100,
      10,
      60,
    );
    assert.deepEqual(credit, { kind: 'player', playerId: 'b', plantId: null, amount: 30 });
  });

  it('ignores damage older than the window', () => {
    const credit = killCreditFor(
      [
        record({ playerId: 'a', amount: 100, tick: 0 }),
        record({ playerId: 'b', amount: 4, tick: 100 }),
      ],
      100,
      10,
      5,
    );
    assert.equal(credit.playerId, 'b');
  });

  it('credits nobody when only weather or herbivores dealt damage', () => {
    const credit = killCreditFor(
      [
        record({ source: 'weather', amount: 50, tick: 99 }),
        record({ source: 'herbivore', amount: 50, tick: 99 }),
      ],
      100,
      10,
      60,
    );
    assert.deepEqual(credit, { kind: 'none', playerId: null, plantId: null, amount: 0 });
  });
});

describe('tumbling', () => {
  it('throws the body sideways with a little lift and deterministic direction', () => {
    const state = createTumbleImpulse(() => 0, tumbling);
    assert.ok(state.velocityX > 0);
    assert.ok(Math.hypot(state.velocityX, state.velocityZ) > 0);
    assert.ok(state.velocityY > 0);
    assert.equal(state.grounded, false);
  });

  it('replays exactly for the same input', () => {
    const a = stepTumble(
      createTumbleImpulse(() => 0.25, tumbling),
      1 / 20,
      tumbling,
    );
    const b = stepTumble(
      createTumbleImpulse(() => 0.25, tumbling),
      1 / 20,
      tumbling,
    );
    assert.deepEqual(a, b);
  });

  it('falls, lands, loses horizontal speed and settles', () => {
    let state = createTumbleImpulse(() => 0.5, tumbling);
    let settled = false;
    let landed = false;
    for (let i = 0; i < 400 && !settled; i += 1) {
      const result = stepTumble(state, 1 / 20, tumbling);
      state = result.state;
      if (result.impactSpeed > 0) {
        landed = true;
        assert.ok(result.impactSpeed > 0);
      }
      settled = result.settled;
    }
    assert.ok(landed);
    assert.ok(settled);
    assert.equal(state.offsetY, 0);
  });

  it('only damages a hard landing', () => {
    assert.equal(impactDamage(3, tumbling), 0);
    assert.ok(impactDamage(9, tumbling) > 0);
  });
});

describe('uproot causes', () => {
  it('scales wind with exposed height', () => {
    assert.ok(effectiveGustSpeed(2.5, 28, uproot) === 28);
    assert.ok(effectiveGustSpeed(0.5, 28, uproot) < 28);
    assert.ok(effectiveGustSpeed(6, 28, uproot) > 28);
  });

  it('does not tear a seedling out in an ordinary storm', () => {
    assert.equal(gustTearsPlantFree(0.3, damage.stormGustSpeedMps, uproot), false);
  });

  it('tears a tall plant out in the same storm', () => {
    assert.equal(gustTearsPlantFree(3.5, damage.stormGustSpeedMps, uproot), true);
  });

  it('caps the damage threshold at four fifths of a small plant', () => {
    assert.equal(uprootDamageThreshold(20, uproot), 16);
    assert.equal(uprootDamageThreshold(1000, uproot), 120);
  });

  it('agrees with the exported threshold helper', () => {
    assert.equal(uprootDamageThreshold(50, uproot), 40);
  });
});

describe('reroot', () => {
  it('needs the configured soil moisture', () => {
    assert.equal(rerootSoilIsValid(10, uproot), false);
    assert.equal(rerootSoilIsValid(30, uproot), true);
  });

  it('earns settle time only while on valid soil', () => {
    assert.equal(rerootSettleStep(false, 1, 2), 0);
    assert.equal(rerootSettleStep(true, 1, 2), 3);
  });
});

describe('drops and geometry', () => {
  it('rolls a fragment against the configured chance', () => {
    assert.equal(
      rollFragment(() => 0.1, 0.45),
      true,
    );
    assert.equal(
      rollFragment(() => 0.9, 0.45),
      false,
    );
  });

  it('measures exposed height from the root plate', () => {
    const height = plantHeight(
      [
        node({ id: 'root', type: 'root', y: 0 }),
        node({ id: 'stem', type: 'stem', y: 1.2 }),
        node({ id: 'leaf', type: 'leaf', y: 2 }),
      ],
      'root',
    );
    assert.equal(height, 2);
  });

  it('rotates a point a quarter turn about the Z axis', () => {
    const rotated = rotatePointAroundAxis({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, Math.PI / 2);
    assert.ok(Math.abs(rotated.x) < 1e-9);
    assert.ok(Math.abs(rotated.y - 1) < 1e-9);
    assert.ok(Math.abs(rotated.z) < 1e-9);
  });
});
