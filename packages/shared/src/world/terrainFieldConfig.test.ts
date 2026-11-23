import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfigDir } from '../config/index.ts';
import { loadTerrainFieldParams } from './terrainFieldConfig.ts';

const configDir = fileURLToPath(new URL('../../../../config', import.meta.url));
const loaded = await loadConfigDir(configDir);
if (!loaded.ok) throw new Error('config load failed');

describe('the terrain field params', () => {
  it('reads the shipped file, not a fallback table', () => {
    const params = loadTerrainFieldParams(loaded.configs);
    // The numbers the two hand-written copies disagreed with: the server said
    // 6 m of relief and a 7 m river, the climate tool 7 m and 1.2 m of soil.
    assert.equal(params.amplitudeM, 26);
    assert.equal(params.seed, 1337);
    assert.equal(params.riverWidthM, 12);
    assert.equal(params.riverCenterZM, 24);
    assert.equal(params.soilDepthM, 1.6);
  });

  it('throws on a missing key instead of inventing one', () => {
    const terrain = loaded.configs.get('terrain');
    assert.ok(terrain);
    const values = { ...terrain.values };
    delete values.river_width_m;
    const broken = new Map(loaded.configs).set('terrain', { ...terrain, values });
    assert.throws(() => loadTerrainFieldParams(broken), /river_width_m/);
  });
});
