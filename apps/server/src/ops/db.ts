import { Pool } from 'pg';
import type { DatabaseState } from './health.ts';

export interface DatabaseProbeOptions {
  max: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
}

/**
 * Thin reachability probe. T00/O01 only prove the server can reach Postgres;
 * real tables and row-locked transactions arrive with T03 and T08A.
 */
export class DatabaseProbe {
  readonly #pool: Pool | null;

  constructor(url: string | null, options: DatabaseProbeOptions) {
    this.#pool = url
      ? new Pool({
          connectionString: url,
          max: options.max,
          connectionTimeoutMillis: options.connectTimeoutMs,
          idleTimeoutMillis: options.idleTimeoutMs,
        })
      : null;

    // An idle client error must never take the process down.
    this.#pool?.on('error', () => undefined);
  }

  get configured(): boolean {
    return this.#pool !== null;
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
