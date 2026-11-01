import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildHealthReport, isReady } from './health.ts';

const base = {
  version: '0.1.0',
  uptimeSeconds: 12.9,
  configFiles: 73,
};

describe('health report', () => {
  it('is ok when the database answers', () => {
    const report = buildHealthReport({ ...base, database: 'ok' });
    assert.equal(report.status, 'ok');
    assert.equal(report.checks.database, 'ok');
    assert.equal(report.uptime_s, 12);
    assert.equal(report.checks.config, 'ok');
  });

  it('is ok when no database is configured (local dev)', () => {
    const report = buildHealthReport({ ...base, database: 'skipped' });
    assert.equal(report.status, 'ok');
    assert.equal(report.checks.database, 'skipped');
  });

  it('degrades but stays alive when a configured database is down', () => {
    const report = buildHealthReport({ ...base, database: 'down' });
    assert.equal(report.status, 'degraded');
    assert.equal(report.checks.database, 'down');
  });

  it('is ready when the database is skipped and not required', () => {
    const report = buildHealthReport({ ...base, database: 'skipped' });
    assert.equal(isReady(report, false), true);
    assert.equal(isReady(report, true), false);
  });

  it('is not ready while a required database is down', () => {
    const report = buildHealthReport({ ...base, database: 'down' });
    assert.equal(isReady(report, true), false);
    assert.equal(isReady(report, false), true);
  });
});
