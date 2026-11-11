import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';
import type { ConfigEntry } from '@plant-legacy/shared/config';
import { loadConfigDir } from '@plant-legacy/shared/config';
import { createLogger } from '../ops/log.ts';

const log = createLogger('debug');
const isProduction = process.env.NODE_ENV === 'production';

function defaultConfigDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, 'config');
    if (existsSync(resolve(candidate, '_meta', 'schema.json'))) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), 'config');
}

/** Validates a value against its config entry schema declaration (type, range, enum). */
export function validateConfigValue(
  entry: ConfigEntry,
  val: unknown,
): { ok: boolean; reason?: string } {
  if (entry.type === 'number' || entry.type === 'integer') {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return { ok: false, reason: 'Value must be a finite number' };
    }
    if (entry.type === 'integer' && !Number.isInteger(val)) {
      return { ok: false, reason: 'Value must be an integer' };
    }
    if (entry.range) {
      const [min, max] = entry.range;
      if (val < min || val > max) {
        return { ok: false, reason: `Value ${val} is outside allowed range [${min}, ${max}]` };
      }
    }
    return { ok: true };
  }

  if (entry.type === 'boolean') {
    if (typeof val !== 'boolean') {
      return { ok: false, reason: 'Value must be a boolean' };
    }
    return { ok: true };
  }

  if (entry.type === 'string') {
    if (typeof val !== 'string') {
      return { ok: false, reason: 'Value must be a string' };
    }
    return { ok: true };
  }

  if (entry.type === 'enum') {
    if (typeof val !== 'string' || !entry.enum.includes(val)) {
      return { ok: false, reason: `Value must be one of: ${entry.enum.join(', ')}` };
    }
    return { ok: true };
  }

  if (entry.type === 'object' || entry.type === 'array' || entry.type === 'matrix') {
    if (typeof val !== 'object' || val === null) {
      return { ok: false, reason: 'Value must be an object or array' };
    }
    return { ok: true };
  }

  return { ok: true };
}

/** Safely parses JSON request body with a 1MB limit. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Loads dev.json config and returns flattened key-value map. */
export async function loadDevConfig(): Promise<Map<string, ConfigEntry>> {
  const configDir = defaultConfigDir();
  const result = await loadConfigDir(configDir);
  const devFile = result.configs.get('dev.json');
  if (!devFile?.values) {
    return new Map();
  }
  const map = new Map<string, ConfigEntry>();
  for (const [key, entry] of Object.entries(devFile.values)) {
    map.set(key, entry as ConfigEntry);
  }
  return map;
}

/** Serializes dev config to flat JSON for client consumption. */
export function serializeDevConfig(configs: Map<string, ConfigEntry>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of configs) {
    out[key] = entry.value;
  }
  return out;
}

/** Handles GET /dev/config - returns current dev settings. */
export async function handleGetDevConfig(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (isProduction) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  try {
    const configs = await loadDevConfig();
    const body = JSON.stringify({ ok: true, config: serializeDevConfig(configs) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  } catch (error) {
    log.error('Failed to load dev config', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
}

/** Handles POST /dev/config - updates dev settings (non-production only). */
export async function handlePostDevConfig(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (isProduction) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    if (typeof body !== 'object' || body === null) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_payload' }));
      return;
    }

    const configs = await loadDevConfig();
    const updated: Record<string, unknown> = {};
    const errors: string[] = [];

    for (const [key, value] of Object.entries(body)) {
      const entry = configs.get(key);
      if (!entry) {
        errors.push(`Unknown config key: ${key}`);
        continue;
      }
      const validation = validateConfigValue(entry, value);
      if (!validation.ok) {
        errors.push(`${key}: ${validation.reason}`);
        continue;
      }
      updated[key] = value;
      // Update in-memory value for immediate effect
      entry.value = value;
    }

    if (errors.length > 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, errors, updated: Object.keys(updated) }));
      return;
    }

    // TODO: Optionally persist to disk (D01 scope is runtime only)
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, updated: Object.keys(updated) }));
  } catch (error) {
    log.error('Failed to update dev config', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
}

/** Dev action types sent from client (type 99 payload). */
export type DevActionType =
  | 'dev_set_resources'
  | 'dev_reset_resources'
  | 'dev_set_tile'
  | 'dev_set_growth'
  | 'dev_fill_energy'
  | 'dev_fill_biomass'
  | 'dev_kill_plant'
  | 'dev_set_tick_rate'
  | 'dev_pause_simulation'
  | 'dev_resume_simulation'
  | 'dev_step_simulation'
  | 'dev_set_simulation'
  | 'dev_force_save'
  | 'dev_clear_persistence'
  | 'dev_log_plants'
  | 'dev_log_resources'
  | 'dev_log_network'
  | 'dev_toggle_webgpu'
  | 'dev_reinit_renderer'
  | 'dev_dump_shaders'
  | 'dev_stress_test'
  | 'dev_regenerate_plant';

export interface DevActionPayload {
  type: DevActionType;
  [key: string]: unknown;
}

/** Type guard for dev action payload. */
export function isDevActionPayload(payload: unknown): payload is DevActionPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'type' in payload &&
    typeof payload.type === 'string'
  );
}
