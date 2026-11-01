/**
 * Shapes for the `extended-1` config format (DESIGN.md Part 6.1).
 *
 * Every tunable lives in `config/<system>.json`. The `value` of an entry IS the
 * default; `range` bounds it. Nothing here is a game rule — this file only
 * describes how a tunable is declared.
 */

/** Schema tag every config file must carry. */
export const CONFIG_SCHEMA = 'extended-1';

/** Entry types the extended-1 format supports (RULE_3). */
export const CONFIG_VALUE_TYPES = [
  'number',
  'integer',
  'boolean',
  'string',
  'enum',
  'array',
  'schema_array',
  'matrix',
  'color',
  'object',
] as const;

export type ConfigValueType = (typeof CONFIG_VALUE_TYPES)[number];

export type ConfigStatus = 'stub' | 'draft' | 'active' | 'deprecated';

export interface ConfigMeta {
  /** Must match the config file name without `.json`. */
  system: string;
  version: string;
  schema: typeof CONFIG_SCHEMA;
  /** Task that owns this file, e.g. "T01". */
  owner_task?: string;
  /** `stub` = declared but not yet populated by its owning task. */
  status?: ConfigStatus;
  notes?: string;
}

export interface NumberEntry {
  type: 'number' | 'integer';
  value: number;
  range: [number, number];
  notes?: string;
}

export interface BooleanEntry {
  type: 'boolean';
  value: boolean;
  notes?: string;
}

export interface StringEntry {
  type: 'string';
  value: string;
  max_length?: number;
  notes?: string;
}

export interface EnumEntry {
  type: 'enum';
  enum: readonly string[];
  value: string;
  notes?: string;
}

export interface ArrayEntry {
  type: 'array';
  value: readonly unknown[];
  item_type?: 'string' | 'number' | 'integer' | 'boolean' | 'object';
  notes?: string;
}

export type SchemaFieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'enum';

/**
 * Field map for a `schema_array` entry. `enum` is a special sibling key holding
 * the allowed values for every field declared as type `enum`
 * (see DESIGN.md Part 6.1, `item_definitions`).
 */
export interface SchemaFieldMap {
  [field: string]: SchemaFieldType | readonly string[];
}

export interface SchemaArrayEntry {
  type: 'schema_array';
  schema: SchemaFieldMap;
  value: readonly Record<string, unknown>[];
  notes?: string;
}

export interface MatrixEntry {
  type: 'matrix';
  rows: readonly string[];
  cols: readonly string[];
  /** `value[rowIndex][colIndex]`, dimensions must match `rows` x `cols`. */
  value: readonly (readonly number[])[];
  notes?: string;
}

export interface ColorEntry {
  type: 'color';
  value: string;
  notes?: string;
}

export interface ObjectEntry {
  type: 'object';
  value: Record<string, unknown>;
  notes?: string;
}

export type ConfigEntry =
  | NumberEntry
  | BooleanEntry
  | StringEntry
  | EnumEntry
  | ArrayEntry
  | SchemaArrayEntry
  | MatrixEntry
  | ColorEntry
  | ObjectEntry;

export interface ConfigFile {
  _meta: ConfigMeta;
  values: Record<string, ConfigEntry>;
}

/** A single validation problem, addressed by file + JSON path. */
export interface ValidationIssue {
  file: string;
  /** Dotted path into the document, e.g. `values.growth_rate.value`. */
  path: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}
