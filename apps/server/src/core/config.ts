import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import type { ConfigFile } from '@plant-legacy/shared/config';
import {
  loadConfigDir,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
} from '@plant-legacy/shared/config';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface RuntimeConfig {
  nodeEnv: string;
  port: number;
  host: string;
  logLevel: LogLevel;
  configDir: string;
  corsOrigins: string[];
  healthPath: string;
  readinessPath: string;
  /** Empty disables the tick metrics route. */
  metricsPath: string;
  /** Environments where dev tools may exist (ops.dev_allowed_environments). */
  devAllowedEnvironments: string[];
  /** Accounts allowed to use dev tools outside a local run. */
  devAdminAccounts: string[];
  metricsWindowTicks: number;
  /** Longest accepted display name (ui.display_name_max_length). */
  displayNameMaxLength: number;
  readinessRequiresDb: boolean;
  trustProxy: boolean;
  dbPoolMax: number;
  dbConnectTimeoutMs: number;
  dbIdleTimeoutMs: number;
  databaseUrl: string | null;
  shutdownGraceMs: number;
}

export interface LoadedRuntime {
  runtime: RuntimeConfig;
  configs: Map<string, ConfigFile>;
  configFileCount: number;
}

function asLogLevel(value: string): LogLevel {
  const match = LOG_LEVELS.find((level) => level === value);
  if (!match) throw new Error(`log_level must be one of ${LOG_LEVELS.join(', ')} (got "${value}")`);
  return match;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

/**
 * Finds the config directory when CONFIG_DIR is not set.
 *
 * `pnpm start` runs the server from `apps/server`, while the tunables live at
 * the repo root. Walk up until a `config/_meta/schema.json` is found so the
 * same code works locally, in tests, and in the container.
 */
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

/**
 * Loads every config file, validates it, and merges the `ops` tunables with
 * environment overrides. Throws if any config is invalid — a server that cannot
 * read its own tunables must not start (T00 acceptance).
 */
export async function loadRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<LoadedRuntime> {
  const configDir = env.CONFIG_DIR ? resolve(process.cwd(), env.CONFIG_DIR) : defaultConfigDir();
  const result = await loadConfigDir(configDir);

  if (!result.ok) {
    const detail = result.issues
      .map((issue) => `${issue.file}:${issue.path} [${issue.code}] ${issue.message}`)
      .join('\n  ');
    throw new Error(`Invalid config in ${configDir}:\n  ${detail}`);
  }

  const configs = result.configs;
  const ops = configs.get('ops');
  if (!ops) throw new Error('Missing config file: ops.json');

  // `PORT=0` means "pick an ephemeral port" to the OS, but this server is
  // reached by a fixed client URL and rejects 0. Some launchers export PORT=0
  // globally just to mean "unset", which used to crash every startup; treat an
  // empty or zero override as unset and fall back to ops.port.
  const rawPort = env.PORT?.trim();
  const portOverride = rawPort && rawPort !== '0' ? Number.parseInt(rawPort, 10) : Number.NaN;
  const portEntry = ops.values.port;
  if (!portEntry || (portEntry.type !== 'number' && portEntry.type !== 'integer')) {
    throw new Error('Config "ops.port" is missing or not numeric.');
  }
  const port = Number.isFinite(portOverride) ? portOverride : portEntry.value;
  if (port < portEntry.range[0] || port > portEntry.range[1]) {
    throw new Error(
      `PORT must be between ${portEntry.range[0]} and ${portEntry.range[1]} (got ${port})`,
    );
  }

  const nodeEnv = env.NODE_ENV ?? 'local';
  const environments = readStringArray(configs, 'ops', 'environments');
  if (!environments.includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be one of ${environments.join(', ')} (got "${nodeEnv}")`);
  }

  const runtime: RuntimeConfig = {
    nodeEnv,
    port,
    host: env.HOST ?? readString(configs, 'ops', 'host'),
    logLevel: asLogLevel(env.LOG_LEVEL ?? readString(configs, 'ops', 'log_level')),
    configDir,
    corsOrigins: env.CORS_ORIGINS
      ? env.CORS_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0)
      : readStringArray(configs, 'ops', 'cors_origins'),
    healthPath: readString(configs, 'ops', 'health_path'),
    readinessPath: readString(configs, 'ops', 'readiness_path'),
    metricsPath: readString(configs, 'ops', 'metrics_path'),
    devAllowedEnvironments: readStringArray(configs, 'ops', 'dev_allowed_environments'),
    devAdminAccounts: readStringArray(configs, 'ops', 'dev_admin_accounts'),
    metricsWindowTicks: readNumber(configs, 'ops', 'metrics_window_ticks'),
    displayNameMaxLength: readNumber(configs, 'ui', 'display_name_max_length'),
    readinessRequiresDb: parseBoolean(
      env.READINESS_REQUIRES_DB,
      readBoolean(configs, 'ops', 'readiness_requires_db'),
    ),
    trustProxy: readBoolean(configs, 'ops', 'trust_proxy'),
    dbPoolMax: readNumber(configs, 'ops', 'db_pool_max'),
    dbConnectTimeoutMs: readNumber(configs, 'ops', 'db_connect_timeout_ms'),
    dbIdleTimeoutMs: readNumber(configs, 'ops', 'db_idle_timeout_ms'),
    databaseUrl: env.DATABASE_URL && env.DATABASE_URL.length > 0 ? env.DATABASE_URL : null,
    shutdownGraceMs: readNumber(configs, 'ops', 'shutdown_grace_ms'),
  };

  return { runtime, configs, configFileCount: result.files.length };
}
