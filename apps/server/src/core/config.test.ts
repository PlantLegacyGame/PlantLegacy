import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadRuntimeConfig } from './config.ts';

/** Tests run from `apps/server`, so the repo config is two levels up. */
const base = { CONFIG_DIR: '../../config' };

describe('runtime config', () => {
  it('loads ops defaults and merges environment overrides', async () => {
    const { runtime, configFileCount } = await loadRuntimeConfig({
      ...base,
      PORT: '9001',
      NODE_ENV: 'staging',
      CORS_ORIGINS: 'https://a.example, https://b.example',
    });

    assert.equal(configFileCount, 77);
    assert.equal(runtime.nodeEnv, 'staging');
    assert.equal(runtime.port, 9001);
    assert.deepEqual(runtime.corsOrigins, ['https://a.example', 'https://b.example']);
    assert.equal(runtime.healthPath, '/health');
    assert.equal(runtime.readinessPath, '/ready');
    assert.equal(runtime.databaseUrl, null);
  });

  it('rejects an environment outside ops.environments', async () => {
    await assert.rejects(
      () => loadRuntimeConfig({ ...base, NODE_ENV: 'development' }),
      /NODE_ENV must be one of/,
    );
  });

  it('rejects a port outside the configured range', async () => {
    await assert.rejects(() => loadRuntimeConfig({ ...base, PORT: '80' }), /PORT must be between/);
  });
});
