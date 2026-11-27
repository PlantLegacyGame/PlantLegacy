import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type PaidSpawnConfig, resolveSpawn, type SeedArchetype } from './spawn.ts';

const archetype: SeedArchetype = {
  id: 'verdant',
  name: 'Verdant',
  description: 'Balanced',
  color: '#7db83d',
  seedScale: 1,
  growthSpeed: 1,
  waterCapacity: 1,
  mineralCapacity: 1,
  photosynthesis: 1,
  upkeep: 1,
  mutationBias: 'balanced',
};

const config: PaidSpawnConfig = {
  enabled: true,
  playRadiusM: 620,
  spacingM: 5,
  exactCoordinateCost: 40,
  namedAreas: [
    {
      id: 'sunmeadow',
      name: 'Sunmeadow',
      description: 'Open ground',
      centerLatitudeDeg: 89.8,
      centerLongitudeDeg: 0,
      radiusM: 60,
      cost: 25,
    },
  ],
};

const base = {
  archetypes: [archetype],
  config,
  radiusM: 100_000,
  occupied: [],
  terrainHeightAt: () => 7,
  random: () => 0.5,
};

describe('spawn selection', () => {
  it('random spawn is free and inside the playable disc', () => {
    const result = resolveSpawn({ ...base, selection: {} });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.cost, 0);
    assert.ok(Math.hypot(result.x, result.z) <= config.playRadiusM);
    assert.equal(result.altitudeM, 7);
  });

  it('charges for a named area and exact coordinates', () => {
    const area = resolveSpawn({ ...base, selection: { areaId: 'sunmeadow' } });
    assert.equal(area.ok, true);
    if (area.ok) assert.equal(area.cost, 25);
    const exact = resolveSpawn({
      ...base,
      selection: { latitudeDeg: 89.9, longitudeDeg: 0.1 },
    });
    assert.equal(exact.ok, true);
    if (exact.ok) assert.equal(exact.cost, 40);
  });

  it('refuses an exact coordinate outside the playable disc', () => {
    const result = resolveSpawn({
      ...base,
      selection: { latitudeDeg: 88, longitudeDeg: 0 },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'outside_play_area');
  });

  it('refuses a point another plant already occupies', () => {
    const result = resolveSpawn({
      ...base,
      selection: { latitudeDeg: 90, longitudeDeg: 0 },
      occupied: [{ x: 0, z: 0 }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'spawn_too_close');
  });

  it('refuses an unknown archetype only when there is no fallback', () => {
    const result = resolveSpawn({
      ...base,
      archetypes: [],
      selection: { archetypeId: 'missing' },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'unknown_archetype');
  });
});
