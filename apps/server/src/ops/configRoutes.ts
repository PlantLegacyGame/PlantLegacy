import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Read one `config/<system>.json` file and return its `values` map as-is: each
 * entry still wrapped as `{ value, type, range }`.
 *
 * For routes that need the entry itself (a default per key, or a value that is
 * an object the client reshapes), rather than a flat map of values.
 */
export async function readConfigEntries(
  configDir: string,
  system: string,
): Promise<Record<string, { value?: unknown }> | null> {
  // Only plain system names: the value is a filename fragment, never a path.
  if (!/^[a-z0-9_]+$/.test(system)) return null;
  try {
    const raw = await fs.readFile(path.resolve(configDir, `${system}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { values?: Record<string, { value?: unknown }> };
    return parsed.values ?? {};
  } catch {
    return null;
  }
}

/**
 * Read one `config/<system>.json` file and flatten its `values` map into
 * `{ key: value }`, which is what the static client consumes.
 *
 * The `/config/*` routes that existed before this helper each re-implemented
 * this flattening (or an explicit key-by-key mapping) inside `main.ts`. New
 * routes use this instead, so adding a client-readable system is one line.
 *
 * Returns null when the file is missing or malformed; the caller decides the
 * response (an empty object keeps the client's own defaults in play).
 */
export async function readFlatConfig(
  configDir: string,
  system: string,
): Promise<Record<string, unknown> | null> {
  // Only plain system names: the value is a filename fragment, never a path.
  if (!/^[a-z0-9_]+$/.test(system)) return null;
  try {
    const raw = await fs.readFile(path.resolve(configDir, `${system}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { values?: Record<string, unknown> };
    const values = parsed.values ?? {};
    const flat: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(values)) {
      const value = (entry as { value?: unknown })?.value;
      flat[key] = value !== undefined ? value : entry;
    }
    return flat;
  } catch {
    return null;
  }
}
