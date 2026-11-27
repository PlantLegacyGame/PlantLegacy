/**
 * One home for the root aura radius.
 *
 * E19: `root_aura_radius` was declared in both `render.json` (6) and
 * `plant_renderer.json` (3), and neither reached a shader — both passes took a
 * compiled 3.0. The key now lives in `root_sight.json` alone, so this pins the
 * two halves of that: `root_sight` serves the radius, and the render loader has
 * no copy to drift from it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { loadRenderConfig, loadRootSightConfig } from './clientConfig.ts';

const ORIGIN = 'http://127.0.0.1:8080';
const originalFetch = globalThis.fetch;
const bodies: Record<string, unknown> = {
  '/config/render': { target_fps: 30, planet_radius_m: 42000 },
  '/config/root_sight': { aura_radius: 4.5, cutaway_radius: 9 },
};

before(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    const body = bodies[path];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      statusText: body === undefined ? 'Not Found' : 'OK',
      json: async () => body ?? { error: 'not_found' },
    } as unknown as Response;
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe('the root aura radius', () => {
  it('is served by root_sight', async () => {
    assert.equal((await loadRootSightConfig(ORIGIN)).auraRadius, 4.5);
  });

  it('has no second copy in render', async () => {
    const render = await loadRenderConfig(ORIGIN);
    // The stub answers, so this is the loader's shape and not a 404 fallback.
    assert.equal(render.targetFps, 30);
    assert.equal('rootAuraRadius' in render, false);
  });

  it('falls back to the shipped 3 m when root_sight is missing', async () => {
    const saved = bodies['/config/root_sight'];
    delete bodies['/config/root_sight'];
    try {
      assert.equal((await loadRootSightConfig(ORIGIN)).auraRadius, 3);
    } finally {
      bodies['/config/root_sight'] = saved;
    }
  });
});
