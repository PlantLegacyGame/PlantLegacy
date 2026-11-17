import fs from 'node:fs/promises';
import path from 'node:path';

type ConfigValues = Record<string, { value?: unknown }>;

/**
 * Read one `config/<system>.json` file and return its `values` map as-is: each
 * entry still wrapped as `{ value, type, range }`.
 *
 * For routes that need the entry itself — a default per key, or a value the
 * client reshapes — rather than a flat map of values.
 *
 * Returns null when the file is missing, malformed, or `system` is not a plain
 * filename fragment; the caller decides what the client gets instead.
 */
export async function readConfigValues(
  configDir: string,
  system: string,
): Promise<ConfigValues | null> {
  // Only plain system names: the value is a filename fragment, never a path.
  if (!/^[a-z0-9_]+$/.test(system)) return null;
  try {
    const raw = await fs.readFile(path.resolve(configDir, `${system}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { values?: ConfigValues };
    return parsed.values ?? {};
  } catch {
    return null;
  }
}

/**
 * The same file flattened to `{ key: value }`, which is what the static client
 * consumes. An entry with no `value` field is passed through as it is.
 *
 * The `/config/*` routes that existed before this helper each re-implemented
 * this flattening (or an explicit key-by-key mapping) inside `main.ts`. New
 * routes use this instead, so adding a client-readable system is one line.
 */
export async function readFlatConfig(
  configDir: string,
  system: string,
): Promise<Record<string, unknown> | null> {
  const values = await readConfigValues(configDir, system);
  if (!values) return null;
  const flat: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(values)) {
    flat[key] = entry?.value !== undefined ? entry.value : entry;
  }
  return flat;
}
