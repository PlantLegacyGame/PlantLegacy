import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Binding } from '@plant-legacy/input';
import {
  CONTROL_OVERRIDES_KEY,
  loadControlOverrides,
  mergeControlOverrides,
  parseControlOverrides,
  rebindAction,
  saveControlOverrides,
} from './controlOverrides.ts';

const binding = (keys: string[]): Binding => ({
  keys,
  mouse: '',
  mode: 'press',
  context: 'gameplay',
});

const table = (): Record<string, Binding> => ({
  inventory_overview_toggle: binding(['KeyI']),
  camera_pan_left: binding(['KeyA', 'ArrowLeft']),
  camera_pan_right: binding(['KeyD', 'ArrowRight']),
});

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe('mergeControlOverrides', () => {
  it('replaces only the actions the player changed', () => {
    const merged = mergeControlOverrides(table(), { inventory_overview_toggle: ['KeyJ'] });
    assert.deepEqual(merged.inventory_overview_toggle?.keys, ['KeyJ']);
    assert.deepEqual(merged.camera_pan_left?.keys, ['KeyA', 'ArrowLeft']);
  });

  it('ignores an override whose action the config dropped', () => {
    const merged = mergeControlOverrides(table(), { retired_action: ['KeyZ'] });
    assert.equal('retired_action' in merged, false);
  });
});

describe('rebindAction', () => {
  it('replaces the keys and takes the key from every other action', () => {
    const result = rebindAction(table(), 'inventory_overview_toggle', 'KeyA');
    assert.ok(result);
    assert.deepEqual(result.bindings.inventory_overview_toggle?.keys, ['KeyA']);
    assert.deepEqual(result.bindings.camera_pan_left?.keys, ['ArrowLeft']);
    assert.deepEqual(result.displaced, ['camera_pan_left']);
    assert.deepEqual(result.changes, {
      inventory_overview_toggle: ['KeyA'],
      camera_pan_left: ['ArrowLeft'],
    });
  });

  it('refuses an action the config does not have', () => {
    assert.equal(rebindAction(table(), 'not_an_action', 'KeyQ'), null);
    assert.equal(rebindAction(table(), 'inventory_overview_toggle', ''), null);
  });
});

describe('stored overrides', () => {
  it('round-trips a saved map', () => {
    const storage = fakeStorage();
    saveControlOverrides(storage, { inventory_overview_toggle: ['KeyJ'] });
    assert.deepEqual(loadControlOverrides(storage), { inventory_overview_toggle: ['KeyJ'] });
  });

  it('drops the key entirely when nothing is overridden', () => {
    const storage = fakeStorage({ [CONTROL_OVERRIDES_KEY]: '{"x":["KeyJ"]}' });
    saveControlOverrides(storage, {});
    assert.equal(storage.getItem(CONTROL_OVERRIDES_KEY), null);
  });

  it('ignores malformed storage instead of throwing', () => {
    assert.deepEqual(parseControlOverrides('not json'), {});
    assert.deepEqual(parseControlOverrides('["KeyJ"]'), {});
    assert.deepEqual(parseControlOverrides('{"x":[1]}'), {});
  });
});
