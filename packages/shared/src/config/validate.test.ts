import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigFile } from './types.ts';
import { validateConfig, validateCrossFieldRules } from './validate.ts';

function codes(system: string, raw: unknown): string[] {
  return validateConfig(system, raw).map((issue) => issue.code);
}

function base(values: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _meta: { system: 'sample', version: '1.0', schema: 'extended-1', owner_task: 'T00' },
    values,
  };
}

describe('extended-1 config validation', () => {
  it('accepts a well-formed config', () => {
    const issues = validateConfig('sample', base());
    assert.deepEqual(issues, []);
  });

  it('rejects a missing or wrong schema tag', () => {
    const raw = { _meta: { system: 'sample', version: '1.0', schema: 'v1' }, values: {} };
    assert.ok(codes('sample', raw).includes('meta.schema_invalid'));
  });

  it('rejects a system name that does not match the file name', () => {
    const raw = base();
    (raw._meta as Record<string, unknown>).system = 'other';
    assert.ok(codes('sample', raw).includes('meta.system_mismatch'));
  });

  it('rejects a rarity field at any depth (RULE_20)', () => {
    const raw = base({
      item_definitions: {
        type: 'schema_array',
        schema: { id: 'string', rarity: 'string' },
        value: [],
      },
    });
    assert.ok(codes('sample', raw).includes('rarity.forbidden'));
  });

  it('rejects a rarity enum member', () => {
    const raw = base({
      tiers: { type: 'enum', enum: ['common', 'rarity'], value: 'common' },
    });
    assert.ok(codes('sample', raw).includes('rarity.enum_member'));
  });

  it('rejects a default outside its declared range', () => {
    const raw = base({ speed: { type: 'number', value: 12, range: [0, 10] } });
    assert.ok(codes('sample', raw).includes('entry.value_out_of_range'));
  });

  it('requires a range on numeric entries', () => {
    const raw = base({ speed: { type: 'number', value: 5 } });
    assert.ok(codes('sample', raw).includes('entry.range_invalid'));
  });

  it('rejects an enum default that is not a member', () => {
    const raw = base({ mode: { type: 'enum', enum: ['a', 'b'], value: 'c' } });
    assert.ok(codes('sample', raw).includes('entry.enum_value_invalid'));
  });

  it('rejects matrix dimensions that do not match its axes', () => {
    const raw = base({
      matrix: {
        type: 'matrix',
        rows: ['day', 'night'],
        cols: ['sun', 'rain', 'storm'],
        value: [
          [1, 1, 1],
          [1, 1],
        ],
      },
    });
    assert.ok(codes('sample', raw).includes('entry.matrix_cols'));
  });

  it('enforces account_bound forcing the other three flags false (RULE_23)', () => {
    const raw = base({
      item_definitions: {
        type: 'schema_array',
        schema: {
          id: 'string',
          category: 'enum',
          enum: ['starter_pack'],
          tradeable: 'boolean',
          mailable: 'boolean',
          listable: 'boolean',
          account_bound: 'boolean',
        },
        value: [
          {
            id: 'starter_pack_1',
            category: 'starter_pack',
            tradeable: true,
            mailable: false,
            listable: false,
            account_bound: true,
          },
        ],
      },
    });
    assert.ok(codes('sample', raw).includes('item_flags.account_bound_conflict'));
  });

  it('rejects an unknown entry type', () => {
    const raw = base({ weird: { type: 'mystery', value: 1 } });
    assert.ok(codes('sample', raw).includes('entry.type_invalid'));
  });

  it('rejects schema_array items with wrong field types', () => {
    const raw = base({
      rows: {
        type: 'schema_array',
        schema: { id: 'string', weight: 'number' },
        value: [{ id: 'x', weight: 'heavy' }],
      },
    });
    assert.ok(codes('sample', raw).includes('entry.item_field_type'));
  });

  describe('validateCrossFieldRules', () => {
    function wrapRecord(record: Record<string, unknown>): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        out[key] = { type: 'number', value };
      }
      return out;
    }

    function configs(
      weather: Record<string, unknown> = {},
      resources: Record<string, unknown> = {},
      growth: Record<string, unknown> = {},
      netProto: Record<string, unknown> = {},
    ): Map<string, ConfigFile> {
      const map = new Map<string, ConfigFile>();
      if (weather)
        map.set('weather', {
          _meta: { system: 'weather', version: '1.0', schema: 'extended-1' },
          values: wrapRecord(weather),
        } as ConfigFile);
      if (resources)
        map.set('resources', {
          _meta: { system: 'resources', version: '1.0', schema: 'extended-1' },
          values: wrapRecord(resources),
        } as ConfigFile);
      if (growth)
        map.set('growth', {
          _meta: { system: 'growth', version: '1.0', schema: 'extended-1' },
          values: wrapRecord(growth),
        } as ConfigFile);
      if (netProto)
        map.set('net_proto', {
          _meta: { system: 'net_proto', version: '1.0', schema: 'extended-1' },
          values: wrapRecord(netProto),
        } as ConfigFile);
      return map;
    }

    it('accepts well-formed weather durations', () => {
      const issues = validateCrossFieldRules(
        configs({
          clear_duration_min_s: 180,
          clear_duration_max_s: 420,
          rain_duration_min_s: 120,
          rain_duration_max_s: 300,
          storm_telegraph_duration_s: 45,
          storm_active_duration_s: 90,
        }),
      );
      assert.deepEqual(issues, []);
    });

    it('rejects min > max for a weather state', () => {
      const issues = validateCrossFieldRules(
        configs({
          clear_duration_min_s: 500,
          clear_duration_max_s: 420,
        }),
      );
      assert.ok(issues.some((i) => i.code === 'weather.durations_min_exceeds_max'));
    });

    it('rejects telegraph >= active storm duration', () => {
      const issues = validateCrossFieldRules(
        configs({
          storm_telegraph_duration_s: 90,
          storm_active_duration_s: 90,
        }),
      );
      assert.ok(issues.some((i) => i.code === 'weather.telegraph_exceeds_active'));
    });

    it('accepts valid resource maxima (all maxima above base)', () => {
      const issues = validateCrossFieldRules(
        configs({
          max_light: 500,
          tile_light_base: 80,
          max_moisture: 500,
          tile_moisture_base: 50,
          max_minerals: 500,
          tile_minerals_base: 30,
        }),
      );
      assert.deepEqual(issues, []);
    });

    it('rejects max_light below tile_light_base', () => {
      const issues = validateCrossFieldRules(
        configs(
          {},
          {
            max_light: 500,
            tile_light_base: 600,
          },
        ),
      );
      assert.ok(issues.some((i) => i.code === 'resources.max_light_below_base'));
    });

    it('accepts valid tier rate within max velocity', () => {
      const issues = validateCrossFieldRules(
        configs({}, {}, { root_growth_speed: 0.85 }, { max_velocity_units_per_tick: 5 }),
      );
      assert.deepEqual(issues, []);
    });

    it('rejects root growth speed exceeding max velocity', () => {
      const issues = validateCrossFieldRules(
        configs({}, {}, { root_growth_speed: 8 }, { max_velocity_units_per_tick: 5 }),
      );
      assert.ok(issues.some((i) => i.code === 'growth.root_speed_exceeds_max_velocity'));
    });
  });
});
