import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type { DatabaseState } from './health.ts';
import { runMigrations } from './persistence/migrate.ts';

export interface Logger {
  error: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface DatabaseProbeOptions {
  max: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
  logger?: Logger;
}

export class DatabaseProbe {
  readonly #pool: Pool | null;
  readonly #migrationsDir: string;
  readonly #logger: Logger | undefined;

  constructor(url: string | null, options: DatabaseProbeOptions) {
    this.#pool = url
      ? new Pool({
          connectionString: url,
          max: options.max,
          connectionTimeoutMillis: options.connectTimeoutMs,
          idleTimeoutMillis: options.idleTimeoutMs,
        })
      : null;

    this.#migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'persistence');
    this.#logger = options.logger;

    // Pool errors must not crash the process, but should be logged
    this.#pool?.on('error', (err) => {
      this.#logger?.error('unexpected pool error', { error: err.message });
    });
  }

  get configured(): boolean {
    return this.#pool !== null;
  }

  get pool(): Pool | null {
    return this.#pool;
  }

  async initialize(): Promise<void> {
    if (this.#pool) {
      await runMigrations(this.#pool, this.#migrationsDir);
    }
  }

  async ping(): Promise<DatabaseState> {
    if (!this.#pool) return 'skipped';
    try {
      await this.#pool.query('select 1');
      return 'ok';
    } catch {
      return 'down';
    }
  }

  async close(): Promise<void> {
    if (this.#pool) await this.#pool.end();
  }
}
