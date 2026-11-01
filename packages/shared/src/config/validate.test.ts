import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateConfig } from './validate.ts';

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
});
