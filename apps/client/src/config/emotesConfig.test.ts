import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_EMOTE_DEFINITIONS,
  loadEmotesConfig,
  normalizeEmoteDefinitions,
} from './emotesConfig.ts';

describe('emote config', () => {
  it('reads labels and ids from the config array', () => {
    const definitions = normalizeEmoteDefinitions([
      { id: 'WAVE', label: '  Salute  ' },
      { id: 'thumbs_up', label: 'Nice' },
    ]);
    assert.deepEqual(definitions, [
      { id: 'wave', label: 'Salute' },
      { id: 'thumbs_up', label: 'Nice' },
    ]);
  });

  it('skips malformed and duplicate entries instead of drawing dead wedges', () => {
    const definitions = normalizeEmoteDefinitions([
      null,
      { id: 'wave' },
      { id: 'WAVE', label: 'Second wave' },
      { id: '  ', label: 'No id' },
      { id: 'cheer', label: '' },
      'not an entry',
    ]);
    assert.deepEqual(definitions, [
      { id: 'wave', label: 'wave' },
      { id: 'cheer', label: 'cheer' },
    ]);
  });

  it('falls back to the shipped catalog when the route is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    try {
      assert.deepEqual(await loadEmotesConfig('http://127.0.0.1:8080'), [
        ...DEFAULT_EMOTE_DEFINITIONS,
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses the route response, including a label edited in config', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ emote_definitions: [{ id: 'wave', label: 'Hello' }] }),
    })) as unknown as typeof fetch;
    try {
      assert.deepEqual(await loadEmotesConfig('http://127.0.0.1:8080'), [
        { id: 'wave', label: 'Hello' },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
