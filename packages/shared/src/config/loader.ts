import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConfigFile, ValidationIssue } from './types.ts';
import { validateConfig } from './validate.ts';

export interface ConfigLoadResult {
  /** Directory that was read. */
  dir: string;
  /** Config system names (file names without `.json`), sorted. */
  files: string[];
  /** Only configs that passed validation. */
  configs: Map<string, ConfigFile>;
  issues: ValidationIssue[];
  ok: boolean;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads and validates every top-level `*.json` file in a config directory.
 * Subdirectories (such as `_meta/`) are ignored.
 *
 * The server calls this at startup: a config that fails validation keeps the
 * process from serving traffic (T00 acceptance).
 */
export async function loadConfigDir(dir: string): Promise<ConfigLoadResult> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort();

  const issues: ValidationIssue[] = [];
  const configs = new Map<string, ConfigFile>();

  for (const name of names) {
    const file = `${name}.json`;
    const raw = await readFile(join(dir, file), 'utf8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      issues.push({
        file,
        path: '',
        code: 'config.invalid_json',
        message: `Not valid JSON: ${describeError(error)}`,
        severity: 'error',
      });
      continue;
    }

    const fileIssues = validateConfig(name, parsed);
    issues.push(...fileIssues);
    if (fileIssues.length === 0) {
      configs.set(name, parsed as ConfigFile);
    }
  }

  return { dir, files: names, configs, issues, ok: issues.length === 0 };
}

function requireConfig(configs: Map<string, ConfigFile>, system: string): ConfigFile {
  const config = configs.get(system);
  if (!config) throw new Error(`Config "${system}" is not loaded.`);
  return config;
}

function requireEntry(configs: Map<string, ConfigFile>, system: string, key: string) {
  const entry = requireConfig(configs, system).values[key];
  if (!entry) throw new Error(`Config "${system}" has no value "${key}".`);
  return entry;
}

export function readNumber(configs: Map<string, ConfigFile>, system: string, key: string): number {
  const entry = requireEntry(configs, system, key);
  if (entry.type !== 'number' && entry.type !== 'integer') {
    throw new Error(`Config "${system}.${key}" is not numeric.`);
  }
  return entry.value;
}

export function readBoolean(
  configs: Map<string, ConfigFile>,
  system: string,
  key: string,
): boolean {
  const entry = requireEntry(configs, system, key);
  if (entry.type !== 'boolean') throw new Error(`Config "${system}.${key}" is not boolean.`);
  return entry.value;
}

export function readString(configs: Map<string, ConfigFile>, system: string, key: string): string {
  const entry = requireEntry(configs, system, key);
  if (entry.type !== 'string' && entry.type !== 'enum') {
    throw new Error(`Config "${system}.${key}" is not a string.`);
  }
  return entry.value;
}

export function readStringArray(
  configs: Map<string, ConfigFile>,
  system: string,
  key: string,
): string[] {
  const entry = requireEntry(configs, system, key);
  if (entry.type !== 'array') throw new Error(`Config "${system}.${key}" is not an array.`);
  if (!entry.value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Config "${system}.${key}" must contain only strings.`);
  }
  return [...entry.value];
}
