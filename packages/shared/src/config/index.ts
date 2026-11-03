export type { ConfigLoadResult } from './loader.ts';
export {
  loadConfigDir,
  readBoolean,
  readInteger,
  readNumber,
  readNumberArray,
  readObject,
  readString,
  readStringArray,
} from './loader.ts';
export type {
  ArrayEntry,
  BooleanEntry,
  ColorEntry,
  ConfigEntry,
  ConfigFile,
  ConfigMeta,
  ConfigStatus,
  ConfigValueType,
  EnumEntry,
  MatrixEntry,
  NumberEntry,
  ObjectEntry,
  SchemaArrayEntry,
  SchemaFieldMap,
  SchemaFieldType,
  StringEntry,
  ValidationIssue,
  ValidationResult,
} from './types.ts';
export { CONFIG_SCHEMA, CONFIG_VALUE_TYPES } from './types.ts';

export { auditTree, formatIssue, validateConfig } from './validate.ts';
