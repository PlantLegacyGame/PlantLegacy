import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfigDir } from '../config/index.ts';
import { loadTerrainVolumeParams } from './terrainVolumeConfig.ts';

const configDir = fileURLToPath(new URL('../../../../config', import.meta.url));
const loaded = await loadConfigDir(configDir);
if (!loaded.ok) throw new Error('config load failed');

describe('the terrain volume params', () => {
  it('reads the shipped file, not a fallback table', () => {
    const params = loadTerrainVolumeParams(loaded.configs);
    assert.equal(params.enabled, true);
    assert.equal(params.centreXM, 21);
    assert.equal(params.centreZM, -11);
    assert.equal(params.bearingDeg, 63);
    assert.equal(params.spanM, 9);
    assert.equal(params.riseM, 2.8);
    assert.equal(params.voxelM, 0.28);
    assert.equal(params.seed, 20261123);
    assert.equal(params.strataBandM, 0.45);
  });

  it('throws on a missing key instead of inventing one', () => {
    const volume = loaded.configs.get('terrain_volume');
    assert.ok(volume);
    const values = { ...volume.values };
    delete values.span_m;
    const broken = new Map(loaded.configs).set('terrain_volume', { ...volume, values });
    assert.throws(() => loadTerrainVolumeParams(broken), /span_m/);
  });
});
