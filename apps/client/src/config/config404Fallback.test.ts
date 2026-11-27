/**
 * Every config loader, answering a 404.
 *
 * `/config/<system>` answers 404 for a file that is not there, rather than an
 * empty object, so each loader has to check the status before it reads a body.
 * This pins them together: none may throw, and none may treat a 404's
 * `{ error }` as a document whose every key is missing.
 *
 * `loadOnboardingConfig` lives in `main.ts`, is not exported, and guards the
 * same way (`if (response.ok)`); it cannot be called without booting the game.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_TERRAIN_VOLUME } from '@plant-legacy/shared/world';
import {
  loadChatConfig,
  loadControlsConfig,
  loadDayNightConfig,
  loadDevSettings,
  loadGrowthSegmentConfig,
  loadNetworkConfig,
  loadPaletteConfig,
  loadPhysicsConfig,
  loadRenderConfig,
  loadReportsConfig,
  loadResourceTileConfig,
  loadRootSightConfig,
  loadShopConfig,
  loadTerrainConfig,
  loadTerrainVolumeConfig,
  loadUIConfig,
} from './clientConfig.ts';
import { loadEmotesConfig } from './emotesConfig.ts';
import { loadGrowthGeometryConfig } from './growthGeometryConfig.ts';
import { loadMutationVisualsConfig } from './mutationVisuals.ts';
import { getPlantRendererConfig, loadPlantRendererConfig } from './plantRendererConfig.ts';
import { DEFAULT_WATER_TUNING, loadWaterTuning } from './waterConfig.ts';

const ORIGIN = 'http://127.0.0.1:8080';
const originalFetch = globalThis.fetch;
const requested: string[] = [];

before(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: 'not_found' }),
    } as unknown as Response;
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe('a config loader that meets a 404', () => {
  it('draws render settings from its fallback', async () => {
    const config = await loadRenderConfig(ORIGIN);
    assert.equal(config.targetFps, 60);
    assert.equal(config.cameraMaxDistance, 200);
    assert.equal(config.planetRadiusM, 100000);
  });

  it('offers no bindings and the default touch target', async () => {
    const config = await loadControlsConfig(ORIGIN);
    assert.deepEqual(config.bindings, {});
    assert.equal(config.touchMinTargetPx, 44);
  });

  it('leaves the palette empty', async () => {
    assert.deepEqual(await loadPaletteConfig(ORIGIN), { ramps: [], roles: [] });
  });

  it('keeps the document defaults for the UI', async () => {
    const config = await loadUIConfig(ORIGIN);
    assert.equal(config.textScale, 1);
    assert.equal(config.layers.hud, 100);
    assert.equal(config.displayNameMaxLength, 32);
  });

  it('falls back to the shipped Root Sight cutaway', async () => {
    const config = await loadRootSightConfig(ORIGIN);
    assert.equal(config.cutawayRadius, 7);
    assert.equal(config.soilOpacity, 0.45);
    assert.equal(config.maxCavityBubbles, 64);
  });

  it('builds the volume region from the shared default', async () => {
    assert.deepEqual(await loadTerrainVolumeConfig(ORIGIN), DEFAULT_TERRAIN_VOLUME);
  });

  it('keeps the documented terrain seed', async () => {
    assert.equal((await loadTerrainConfig(ORIGIN)).seed, 1337);
  });

  it('keeps the documented physics table', async () => {
    const config = await loadPhysicsConfig(ORIGIN);
    assert.equal(config.gravityMps2, 9.81);
    assert.equal(config.maxCollidersPerPlant, 192);
    assert.equal(config.leafColliderMode, 'cuboid');
  });

  it('keeps the client health thresholds', async () => {
    const config = await loadNetworkConfig(ORIGIN);
    assert.equal(config.slowRttMs, 1200);
    assert.equal(config.stallMs, 12000);
  });

  it('keeps the chat limits', async () => {
    const config = await loadChatConfig(ORIGIN);
    assert.equal(config.proximityRangePx, 150);
    assert.equal(config.worldRateMsgPerMin, 12);
  });

  it('keeps a usable emote wheel from the shipped definitions', async () => {
    const definitions = await loadEmotesConfig(ORIGIN);
    assert.equal(definitions.length, 8);
    assert.equal(
      definitions.find((definition) => definition.id === 'thumbs_up')?.label,
      'Thumbs Up',
    );
  });

  it('keeps a 60 minute day', async () => {
    assert.deepEqual(await loadDayNightConfig(ORIGIN), { cycleLengthS: 3600, dayFraction: 0.5 });
  });

  it('keeps the resource tile ranges', async () => {
    const config = await loadResourceTileConfig(ORIGIN);
    assert.equal(config.tileLightBase, 80);
    assert.equal(config.maxLight, 500);
    assert.equal(config.rates.groundwaterCapacity, 400);
  });

  it('keeps the report reasons and limits', async () => {
    const config = await loadReportsConfig(ORIGIN);
    assert.equal(config.reportReasons.length, 5);
    assert.equal(config.reportRateLimitPerMin, 5);
  });

  it('keeps the dev settings and benchmark poses', async () => {
    const config = await loadDevSettings(ORIGIN);
    assert.equal(config.seedSizeClass, 'normal');
    assert.equal(config.benchmarkPoseMs, 6000);
    assert.ok(config.benchmarkPoses.length > 0);
  });

  it('keeps the shop open with no catalogue', async () => {
    const config = await loadShopConfig(ORIGIN);
    assert.equal(config.enabled, true);
    assert.deepEqual(config.sections, []);
  });

  it('quotes the seed segment lengths', async () => {
    assert.deepEqual(await loadGrowthSegmentConfig(ORIGIN), {
      rootSegmentLength: 0.85,
      canopySegmentLength: 0.95,
      nodeLengths: {},
    });
  });

  it('keeps the water field defaults', async () => {
    assert.deepEqual(await loadWaterTuning(ORIGIN), DEFAULT_WATER_TUNING);
  });

  it('paints mutations from the wire rather than an empty style table', async () => {
    assert.deepEqual(await loadMutationVisualsConfig(ORIGIN), { styles: [], caps: {} });
  });

  it('leaves the plant renderer config untouched', async () => {
    const before = getPlantRendererConfig();
    const config = await loadPlantRendererConfig(ORIGIN);
    assert.deepEqual(config, before);
    assert.equal(config.maxNodesPerPlant, 1000);
  });

  it('leaves the growth geometry at its shared defaults', async () => {
    assert.equal(await loadGrowthGeometryConfig(ORIGIN), undefined);
  });

  it('asked every loader for a system under /config/ and nothing else', async () => {
    const systems = new Set(requested.map((url) => url.replace(`${ORIGIN}/config/`, '')));
    assert.deepEqual([...systems].sort(), [
      'chat',
      'controls',
      'daynight',
      'dev',
      'emotes',
      'growth',
      'mutation_visuals',
      'network',
      'palette',
      'physics',
      'plant_renderer',
      'render',
      'reports',
      'resources',
      'root_sight',
      'shop',
      'terrain',
      'terrain_volume',
      'ui',
      'water',
    ]);
    for (const url of requested) assert.ok(url.startsWith(`${ORIGIN}/config/`), url);
  });
});
