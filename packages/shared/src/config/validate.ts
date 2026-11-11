import { violatesAccountBoundInvariant } from '../schemas/item.ts';
import type { ConfigFile, ValidationIssue } from './types.ts';
import { CONFIG_SCHEMA, CONFIG_VALUE_TYPES } from './types.ts';

type Push = (path: string, code: string, message: string) => void;

/**
 * RULE_20: the game does not surface item or gene rarity. Any schema field named
 * `rarity` (or `rarities`) is a bug, at any depth, in any config file.
 */
const FORBIDDEN_KEYS = new Set(['rarity', 'rarities']);

const SCHEMA_FIELD_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'enum',
]);

const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)?$/;
const TASK_ID_PATTERN = /^(?:T|C|O|H|D)\d+[A-Za-z]?$/;
const SYSTEM_PATTERN = /^[a-z][a-z0-9_]*$/;
const CONFIG_STATUSES = new Set(['stub', 'draft', 'active', 'deprecated']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Walks the whole document and enforces the rules that apply to any node:
 * the rarity ban and the `account_bound` flag invariant (RULE_23).
 */
export function auditTree(node: unknown, path: string, push: Push): void {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      auditTree(item, `${path}[${index}]`, push);
    }
    return;
  }
  if (!isRecord(node)) return;

  if (violatesAccountBoundInvariant(node)) {
    push(
      path || '.',
      'item_flags.account_bound_conflict',
      'account_bound=true must force tradeable, mailable and listable to false (RULE_23).',
    );
  }

  for (const [key, value] of Object.entries(node)) {
    const childPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.has(normalizeKey(key))) {
      push(
        childPath,
        'rarity.forbidden',
        `Field "${key}" is forbidden: no item or gene rarity may be surfaced (RULE_20).`,
      );
    }
    if (normalizeKey(key) === 'enum' && Array.isArray(value) && value.includes('rarity')) {
      push(
        childPath,
        'rarity.enum_member',
        'An enum member named "rarity" is forbidden (RULE_20).',
      );
    }
    auditTree(value, childPath, push);
  }
}

function validateMeta(systemName: string, meta: unknown, push: Push): void {
  if (!isRecord(meta)) {
    push('_meta', 'meta.missing', 'Config must have a "_meta" object.');
    return;
  }

  if (typeof meta.system !== 'string' || !SYSTEM_PATTERN.test(meta.system)) {
    push('_meta.system', 'meta.system_invalid', '"_meta.system" must be a snake_case string.');
  } else if (meta.system !== systemName) {
    push(
      '_meta.system',
      'meta.system_mismatch',
      `"_meta.system" is "${meta.system}" but the file is "${systemName}.json".`,
    );
  }

  if (typeof meta.version !== 'string' || !VERSION_PATTERN.test(meta.version)) {
    push('_meta.version', 'meta.version_invalid', '"_meta.version" must look like "1.0".');
  }

  if (meta.schema !== CONFIG_SCHEMA) {
    push(
      '_meta.schema',
      'meta.schema_invalid',
      `"_meta.schema" must be "${CONFIG_SCHEMA}" (found ${JSON.stringify(meta.schema)}).`,
    );
  }

  if (meta.owner_task !== undefined) {
    if (typeof meta.owner_task !== 'string' || !TASK_ID_PATTERN.test(meta.owner_task)) {
      push(
        '_meta.owner_task',
        'meta.owner_task_invalid',
        '"owner_task" must be a task id like "T01".',
      );
    }
  }

  if (meta.status !== undefined) {
    if (typeof meta.status !== 'string' || !CONFIG_STATUSES.has(meta.status)) {
      push(
        '_meta.status',
        'meta.status_invalid',
        '"status" must be one of stub, draft, active, deprecated.',
      );
    }
  }

  if (meta.notes !== undefined && typeof meta.notes !== 'string') {
    push('_meta.notes', 'meta.notes_invalid', '"notes" must be a string.');
  }
}

function validateNumberEntry(
  path: string,
  entry: Record<string, unknown>,
  integer: boolean,
  push: Push,
): void {
  const value = entry.value;
  const range = entry.range;

  if (integer) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      push(`${path}.value`, 'entry.value_invalid', 'Integer entry needs an integer "value".');
    }
  } else if (!isFiniteNumber(value)) {
    push(`${path}.value`, 'entry.value_invalid', 'Number entry needs a finite numeric "value".');
  }

  if (!Array.isArray(range) || range.length !== 2) {
    push(`${path}.range`, 'entry.range_invalid', 'Entry needs "range": [min, max].');
    return;
  }

  const [min, max] = range;
  if (!isFiniteNumber(min) || !isFiniteNumber(max)) {
    push(`${path}.range`, 'entry.range_invalid', '"range" must hold two finite numbers.');
    return;
  }
  if (min >= max) {
    push(
      `${path}.range`,
      'entry.range_empty',
      `"range" min (${min}) must be less than max (${max}).`,
    );
    return;
  }
  if (isFiniteNumber(value) && (value < min || value > max)) {
    push(
      `${path}.value`,
      'entry.value_out_of_range',
      `Default ${value} is outside the declared range [${min}, ${max}].`,
    );
  }
}

function validateSchemaArrayEntry(path: string, entry: Record<string, unknown>, push: Push): void {
  const schema = entry.schema;
  if (!isRecord(schema)) {
    push(`${path}.schema`, 'entry.schema_missing', 'schema_array entry needs a "schema" object.');
    return;
  }

  const enumList = Array.isArray(schema.enum)
    ? schema.enum.filter((member): member is string => typeof member === 'string')
    : undefined;

  const fields = Object.entries(schema).filter(
    ([field, typeName]) => field !== 'enum' && typeof typeName === 'string',
  );
  if (fields.length === 0) {
    push(`${path}.schema`, 'entry.schema_empty', 'schema_array "schema" declares no fields.');
  }
  for (const [field, typeName] of fields) {
    if (!SCHEMA_FIELD_TYPES.has(typeName as string)) {
      push(
        `${path}.schema.${field}`,
        'entry.schema_field_type',
        `Unknown schema field type "${String(typeName)}".`,
      );
    }
  }

  const value = entry.value;
  if (!Array.isArray(value)) {
    push(`${path}.value`, 'entry.value_invalid', 'schema_array entry needs an array "value".');
    return;
  }

  value.forEach((item, index) => {
    const itemPath = `${path}.value[${index}]`;
    if (!isRecord(item)) {
      push(itemPath, 'entry.item_invalid', 'Each schema_array item must be an object.');
      return;
    }
    for (const [field, typeName] of fields) {
      const declared = typeName as string;
      if (!(field in item)) {
        push(`${itemPath}.${field}`, 'entry.item_missing_field', `Missing field "${field}".`);
        continue;
      }
      const fieldValue = item[field];
      if (declared === 'enum') {
        if (typeof fieldValue !== 'string') {
          push(`${itemPath}.${field}`, 'entry.item_field_type', `"${field}" must be a string.`);
        } else if (enumList && !enumList.includes(fieldValue)) {
          push(
            `${itemPath}.${field}`,
            'entry.item_enum_member',
            `"${fieldValue}" is not one of the declared enum values.`,
          );
        }
        continue;
      }
      if (!matchesSchemaType(fieldValue, declared)) {
        push(
          `${itemPath}.${field}`,
          'entry.item_field_type',
          `"${field}" must be of type ${declared}.`,
        );
      }
    }
  });
}

function matchesSchemaType(value: unknown, typeName: string): boolean {
  switch (typeName) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return isFiniteNumber(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    case 'enum':
      return typeof value === 'string';
    default:
      return false;
  }
}

function validateEntry(path: string, entry: unknown, push: Push): void {
  if (!isRecord(entry)) {
    push(path, 'entry.not_object', 'A value entry must be an object.');
    return;
  }

  const type = entry.type;
  if (typeof type !== 'string' || !(CONFIG_VALUE_TYPES as readonly string[]).includes(type)) {
    push(
      `${path}.type`,
      'entry.type_invalid',
      `Unknown entry type ${JSON.stringify(type)}. Allowed: ${CONFIG_VALUE_TYPES.join(', ')}.`,
    );
    return;
  }

  if (entry.notes !== undefined && typeof entry.notes !== 'string') {
    push(`${path}.notes`, 'entry.notes_invalid', '"notes" must be a string.');
  }

  switch (type as (typeof CONFIG_VALUE_TYPES)[number]) {
    case 'number':
      validateNumberEntry(path, entry, false, push);
      return;
    case 'integer':
      validateNumberEntry(path, entry, true, push);
      return;
    case 'boolean':
      if (typeof entry.value !== 'boolean') {
        push(`${path}.value`, 'entry.value_invalid', 'Boolean entry needs a boolean "value".');
      }
      return;
    case 'string': {
      if (typeof entry.value !== 'string') {
        push(`${path}.value`, 'entry.value_invalid', 'String entry needs a string "value".');
      }
      if (entry.max_length !== undefined) {
        if (!isFiniteNumber(entry.max_length)) {
          push(`${path}.max_length`, 'entry.max_length_invalid', '"max_length" must be a number.');
        } else if (typeof entry.value === 'string' && entry.value.length > entry.max_length) {
          push(
            `${path}.value`,
            'entry.value_too_long',
            `Default exceeds max_length ${entry.max_length}.`,
          );
        }
      }
      return;
    }
    case 'enum': {
      const members = entry.enum;
      if (!Array.isArray(members) || members.length === 0) {
        push(`${path}.enum`, 'entry.enum_missing', 'Enum entry needs a non-empty "enum" array.');
        return;
      }
      const strings = members.filter((member): member is string => typeof member === 'string');
      if (strings.length !== members.length) {
        push(`${path}.enum`, 'entry.enum_invalid', '"enum" members must all be strings.');
      }
      if (typeof entry.value !== 'string' || !strings.includes(entry.value)) {
        push(
          `${path}.value`,
          'entry.enum_value_invalid',
          `Default ${JSON.stringify(entry.value)} is not one of ${strings.join(', ')}.`,
        );
      }
      return;
    }
    case 'array':
      if (!Array.isArray(entry.value)) {
        push(`${path}.value`, 'entry.value_invalid', 'Array entry needs an array "value".');
      }
      return;
    case 'schema_array':
      validateSchemaArrayEntry(path, entry, push);
      return;
    case 'matrix': {
      const rows = entry.rows;
      const cols = entry.cols;
      const value = entry.value;
      if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(cols) || cols.length === 0) {
        push(`${path}`, 'entry.matrix_axes', 'Matrix entry needs non-empty "rows" and "cols".');
        return;
      }
      if (!Array.isArray(value) || value.length !== rows.length) {
        push(
          `${path}.value`,
          'entry.matrix_rows',
          `Matrix "value" must have ${rows.length} row(s).`,
        );
        return;
      }
      value.forEach((row, rowIndex) => {
        if (!Array.isArray(row) || row.length !== cols.length) {
          push(
            `${path}.value[${rowIndex}]`,
            'entry.matrix_cols',
            `Matrix row ${rowIndex} must have ${cols.length} column(s).`,
          );
          return;
        }
        row.forEach((cell, colIndex) => {
          if (!isFiniteNumber(cell)) {
            push(
              `${path}.value[${rowIndex}][${colIndex}]`,
              'entry.matrix_cell',
              'Matrix cells must be finite numbers.',
            );
          }
        });
      });
      return;
    }
    case 'color':
      if (typeof entry.value !== 'string' || !COLOR_PATTERN.test(entry.value)) {
        push(`${path}.value`, 'entry.color_invalid', 'Color entry needs "#rrggbb" or "#rrggbbaa".');
      }
      return;
    case 'object':
      if (!isRecord(entry.value)) {
        push(`${path}.value`, 'entry.value_invalid', 'Object entry needs an object "value".');
      }
      return;
  }
}

/**
 * Validates one config document against the extended-1 format.
 *
 * @param systemName File name without `.json`; must equal `_meta.system`.
 * @param raw Parsed JSON.
 */
export function validateConfig(systemName: string, raw: unknown): ValidationIssue[] {
  const file = `${systemName}.json`;
  const issues: ValidationIssue[] = [];
  const push: Push = (path, code, message) => {
    issues.push({ file, path, code, message, severity: 'error' });
  };

  if (!isRecord(raw)) {
    push('', 'config.not_object', 'Config root must be a JSON object.');
    return issues;
  }

  validateMeta(systemName, raw._meta, push);

  const values = raw.values;
  if (!isRecord(values)) {
    push('values', 'config.values_missing', 'Config must have an object "values".');
  } else {
    for (const [key, entry] of Object.entries(values)) {
      validateEntry(`values.${key}`, entry, push);
    }
  }

  auditTree(raw, '', push);

  return issues;
}

/** Human-readable one-line-per-issue rendering for the CLI. */
export function formatIssue(issue: ValidationIssue): string {
  const location = issue.path ? `${issue.file}:${issue.path}` : issue.file;
  return `${location}  [${issue.code}] ${issue.message}`;
}

/**
 * Cross-field validation over the set of loaded configs. These rules span
 * multiple config files (e.g. weather durations must be internally consistent,
 * resource maxima bound tile values, tier rates stay inside their config),
 * so they cannot be checked by the per-file `validateConfig`.
 *
 * @param configs All successfully loaded config documents, keyed by system name.
 * @returns Issues for any cross-file or inter-field violation (empty = ok).
 */
export function validateCrossFieldRules(configs: Map<string, ConfigFile>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (system: string, path: string, code: string, message: string) => {
    issues.push({ file: `${system}.json`, path, code, message, severity: 'error' });
  };

  // --- Weather durations (weather.json) -----------------------------------
  // Each weather state has a min and a max duration; min must not exceed max.
  const weather = configs.get('weather');
  if (weather) {
    const v = weather.values as Record<string, unknown> | undefined;
    const duration = (key: string): number | undefined => {
      const entry = v?.[key];
      if (typeof entry !== 'object' || entry === null) return undefined;
      const raw = (entry as Record<string, unknown>).value;
      return typeof raw === 'number' ? raw : undefined;
    };
    const min = (k: string) => duration(`${k}_duration_min_s`);
    const max = (k: string) => duration(`${k}_duration_max_s`);
    const states = ['clear', 'rain', 'storm_telegraph', 'storm_active'] as const;
    for (const state of states) {
      const lo = min(state);
      const hi = max(state);
      if (typeof lo === 'number' && typeof hi === 'number' && lo > hi) {
        push(
          'weather',
          `${state}_duration_min_s`,
          'weather.durations_min_exceeds_max',
          `weather.${state}_duration_min_s (${lo}) must not exceed _max_s (${hi}).`,
        );
      }
    }
    // Telegraph must be shorter than the active storm phase.
    const telegraph = duration('storm_telegraph_duration_s');
    const active = duration('storm_active_duration_s');
    if (typeof telegraph === 'number' && typeof active === 'number' && telegraph >= active) {
      push(
        'weather',
        'storm_telegraph_duration_s',
        'weather.telegraph_exceeds_active',
        `storm_telegraph_duration_s (${telegraph}) must be shorter than storm_active_duration_s (${active}).`,
      );
    }
  }

  // --- Resource maxima: tile values are clamped to maxLight/maxMoisture/   ---
  // --- maxMinerals (resources.json) ----------------------------------------
  const resources = configs.get('resources');
  if (resources) {
    const v = resources.values as Record<string, unknown> | undefined;
    const num = (key: string): number | undefined => {
      const entry = v?.[key];
      if (typeof entry !== 'object' || entry === null) return undefined;
      const raw = (entry as Record<string, unknown>).value;
      return typeof raw === 'number' ? raw : undefined;
    };
    const maxKey = (k: string): number | undefined => num(`max_${k}`);
    const baseKey = (k: string): number | undefined => num(`tile_${k}_base`);
    const lightMax = maxKey('light');
    const moistureMax = maxKey('moisture');
    const mineralsMax = maxKey('minerals');
    const light = baseKey('light');
    const moisture = baseKey('moisture');
    const minerals = baseKey('minerals');
    if (light !== undefined && typeof lightMax === 'number' && lightMax < light) {
      push(
        'resources',
        'max_light',
        'resources.max_light_below_base',
        `max_light (${lightMax}) must not be below tile_light_base (${light}).`,
      );
    }
    if (moisture !== undefined && typeof moistureMax === 'number' && moistureMax < moisture) {
      push(
        'resources',
        'max_moisture',
        'resources.max_moisture_below_base',
        `max_moisture (${moistureMax}) must not be below tile_moisture_base (${moisture}).`,
      );
    }
    if (minerals !== undefined && typeof mineralsMax === 'number' && mineralsMax < minerals) {
      push(
        'resources',
        'max_minerals',
        'resources.max_minerals_below_base',
        `max_minerals (${mineralsMax}) must not be below tile_minerals_base (${minerals}).`,
      );
    }
  }

  // --- Tier rates consistency (growth.json <-> net_proto.json / plant_renderer.json)
  // Tier rates in growth.json (germination, etc.) must be within net_proto's
  // allowed velocity/time bounds and non-negative.
  const growth = configs.get('growth');
  const netProto = configs.get('net_proto');
  if (growth && netProto) {
    const g = growth.values as Record<string, unknown> | undefined;
    const n = netProto.values as Record<string, unknown> | undefined;
    const numG = (key: string): number | undefined => {
      const entry = g?.[key];
      if (typeof entry !== 'object' || entry === null) return undefined;
      const raw = (entry as Record<string, unknown>).value;
      return typeof raw === 'number' ? raw : undefined;
    };
    const numN = (key: string): number | undefined => {
      const entry = n?.[key];
      if (typeof entry !== 'object' || entry === null) return undefined;
      const raw = (entry as Record<string, unknown>).value;
      return typeof raw === 'number' ? raw : undefined;
    };
    const rate = numG('root_growth_speed');
    const maxVel = numN('max_velocity_units_per_tick');
    if (typeof rate === 'number' && typeof maxVel === 'number' && maxVel > 0 && rate > maxVel) {
      push(
        'growth',
        'root_growth_speed',
        'growth.root_speed_exceeds_max_velocity',
        `root_growth_speed (${rate}) exceeds net_proto.max_velocity_units_per_tick (${maxVel}).`,
      );
    }
  }

  return issues;
}
