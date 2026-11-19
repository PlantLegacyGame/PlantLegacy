import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fetchWorldTime, parseWorldTime } from './worldTime.ts';

describe('world time', () => {
  it('reads the server clock', () => {
    assert.deepEqual(parseWorldTime({ timeOfDay: 0.25, isDay: true, paused: false, scale: 1 }), {
      timeOfDay: 0.25,
      isDay: true,
      paused: false,
      scale: 1,
    });
  });

  it('wraps a fraction that arrived out of range', () => {
    assert.equal(parseWorldTime({ timeOfDay: 1.25 })?.timeOfDay, 0.25);
    assert.equal(parseWorldTime({ timeOfDay: -0.25 })?.timeOfDay, 0.75);
  });

  it('refuses a payload without a usable time', () => {
    assert.equal(parseWorldTime({}), null);
    assert.equal(parseWorldTime({ timeOfDay: 'noon' }), null);
    assert.equal(parseWorldTime({ timeOfDay: Number.NaN }), null);
    assert.equal(parseWorldTime(null), null);
  });

  it('defaults the clock mode when the server omits it', () => {
    assert.deepEqual(parseWorldTime({ timeOfDay: 0.5 }), {
      timeOfDay: 0.5,
      isDay: false,
      paused: false,
      scale: 1,
    });
  });

  it('returns null instead of throwing when the server is down', async () => {
    const failing = async () => {
      throw new Error('offline');
    };
    assert.equal(await fetchWorldTime(failing, 'http://localhost:8080'), null);
  });

  it('returns null on a non-200 answer', async () => {
    const notFound = async () => ({
      ok: false,
      json: async () => ({}),
    });
    assert.equal(await fetchWorldTime(notFound, 'http://localhost:8080'), null);
  });

  it('reads a good answer from the route', async () => {
    const ok = async (url: string) => {
      assert.equal(url, 'http://localhost:8080/world/time');
      return {
        ok: true,
        json: async () => ({ timeOfDay: 0.75, isDay: false, paused: true, scale: 4 }),
      };
    };
    assert.deepEqual(await fetchWorldTime(ok, 'http://localhost:8080'), {
      timeOfDay: 0.75,
      isDay: false,
      paused: true,
      scale: 4,
    });
  });
});
