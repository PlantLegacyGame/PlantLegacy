export type DatabaseState = 'ok' | 'down' | 'skipped';

export interface HealthInput {
  version: string;
  uptimeSeconds: number;
  database: DatabaseState;
  configFiles: number;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  uptime_s: number;
  checks: {
    config: 'ok';
    config_files: number;
    database: DatabaseState;
  };
}

/**
 * Liveness payload for `/health`. Pure so it can be unit-tested without a
 * socket or a database.
 *
 * `skipped` means no DATABASE_URL is configured (local dev). `down` means a
 * database was configured and did not answer; the process is still alive, so
 * `/health` reports `degraded` while `/ready` returns 503 when the deployment
 * requires a database.
 */
export function buildHealthReport(input: HealthInput): HealthReport {
  const degraded = input.database === 'down';
  return {
    status: degraded ? 'degraded' : 'ok',
    version: input.version,
    uptime_s: Math.max(0, Math.floor(input.uptimeSeconds)),
    checks: {
      config: 'ok',
      config_files: input.configFiles,
      database: input.database,
    },
  };
}

/**
 * Readiness: is this process able to serve players right now?
 *
 * A configured-but-down database only blocks readiness when the deployment
 * says it needs one. Local dev may run without Postgres entirely.
 */
export function isReady(report: HealthReport, requiresDb: boolean): boolean {
  if (!requiresDb) return true;
  return report.checks.database === 'ok';
}
