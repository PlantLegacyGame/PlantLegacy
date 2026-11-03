import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type { DatabaseState } from './health.ts';
import { runMigrations } from './persistence/migrate.ts';

export interface DatabaseProbeOptions {
  max: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
}

export class DatabaseProbe {
  readonly #pool: Pool | null;
  readonly #migrationsDir: string;

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

    // An idle client error must never take the process down.
    this.#pool?.on('error', () => undefined);
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
