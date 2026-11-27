import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigEntry, ConfigFile } from '@plant-legacy/shared/config';
import { loadSpawnConfig } from './spawnConfig.ts';

const archetype = {
  id: 'verdant',
  name: 'Verdant',
  description: 'Balanced',
  color: '#8fc45a',
  seed_scale: 1,
  growth_speed: 1.08,
  water_capacity: 1,
  mineral_capacity: 1,
  photosynthesis: 1.06,
  upkeep: 1,
  mutation_bias: 'leaf',
};

const area = {
  id: 'sunmeadow',
  name: 'Sunmeadow',
  description: 'Open ground',
  center_latitude_deg: 89.82,
  center_longitude_deg: 0,
  radius_m: 70,
  cost: 30,
};

function configs(overrides: {
  definitions?: unknown[];
  areas?: unknown[];
  enabled?: boolean;
  startBalance?: number;
}): Map<string, ConfigFile> {
  const file = (system: string, values: Record<string, ConfigEntry>): ConfigFile => ({
    _meta: { system, version: '1.0.0', schema: 'extended-1', status: 'active' },
    values,
  });
  return new Map<string, ConfigFile>([
    [
      'archetypes',
      file('archetypes', {
        definitions: {
          type: 'array',
          item_type: 'object',
          value: overrides.definitions ?? [archetype],
        },
      }),
    ],
    [
      'paid_spawn',
      file('paid_spawn', {
        enabled: { type: 'boolean', value: overrides.enabled ?? true },
        play_radius_m: { type: 'number', value: 620, range: [50, 1200] },
        spawn_spacing_m: { type: 'number', value: 5, range: [1, 40] },
        exact_coordinate_cost: { type: 'integer', value: 40, range: [0, 100_000] },
        named_areas: {
          type: 'array',
          item_type: 'object',
          value: overrides.areas ?? [area],
        },
      }),
    ],
    [
      'render',
      file('render', {
        planet_radius_m: { type: 'number', value: 100_000, range: [1, 10_000_000] },
      }),
    ],
  ]);
}

describe('spawn config', () => {
  it('loads the shipped archetypes and named areas', async () => {
    const { loadRuntimeConfig } = await import('../core/config.ts');
    const { configs: shipped } = await loadRuntimeConfig({ CONFIG_DIR: '../../config' });
    const bundle = loadSpawnConfig(shipped);
    assert.equal(bundle.archetypes.length, 4);
    assert.deepEqual(
      bundle.archetypes.map((entry) => entry.id),
      ['verdant', 'deeproot', 'sunspire', 'stoneheart'],
    );
    assert.equal(bundle.paid.enabled, true);
    assert.equal(bundle.paid.playRadiusM, 620);
    assert.equal(bundle.paid.namedAreas.length, 4);
    assert.ok(bundle.paid.namedAreas.every((entry) => entry.cost > 0));
    assert.equal(bundle.planetRadiusM, 100_000);
  });

  it('converts config multipliers and prices into typed values', () => {
    const bundle = loadSpawnConfig(configs({ enabled: false }));
    const [seed] = bundle.archetypes;
    assert.equal(seed?.growthSpeed, 1.08);
    assert.equal(seed?.waterCapacity, 1);
    assert.equal(seed?.mutationBias, 'leaf');
    assert.equal(bundle.paid.exactCoordinateCost, 40);
    assert.equal(bundle.paid.namedAreas[0]?.cost, 30);
    assert.equal(bundle.paid.enabled, false);
  });

  it('rejects duplicate archetype ids and duplicate area ids', () => {
    assert.throws(
      () => loadSpawnConfig(configs({ definitions: [archetype, archetype] })),
      /duplicate archetype id "verdant"/,
    );
    assert.throws(
      () => loadSpawnConfig(configs({ areas: [area, area] })),
      /duplicate named spawn area "sunmeadow"/,
    );
  });

  it('rejects an area centre outside the playable disk at boot', () => {
    assert.throws(
      () =>
        loadSpawnConfig(
          configs({
            areas: [{ ...area, center_latitude_deg: 88.5 }],
          }),
        ),
      /outside the 620 m playable disk/,
    );
  });

  it('rejects an archetype multiplier outside its allowed range', () => {
    assert.throws(
      () =>
        loadSpawnConfig(
          configs({
            definitions: [{ ...archetype, growth_speed: 9 }],
          }),
        ),
      /growth_speed.*0.25\.\.4/,
    );
  });
});
