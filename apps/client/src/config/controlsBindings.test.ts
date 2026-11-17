/**
 * The controls table has two shapes and only one of them is allowed to matter.
 *
 * `config/controls.json` declares the desktop keys as a schema array; the
 * `/config/controls` route serves them as a record keyed by action. A client
 * that understood only one shape produced an empty binding table from the
 * other, and an empty table is not an error the player can see: R, Space, G and
 * every other named action simply stop existing. These pin both shapes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeBindings } from './controlsBindings.ts';

const ROOT_SIGHT = {
  action: 'root_sight_toggle',
  keys: ['KeyR'],
  mouse: '',
  mode: 'toggle' as const,
  context: '',
};

describe('normalizeBindings', () => {
  it('reads the file’s schema-array table into one entry per action', () => {
    const bindings = normalizeBindings({ bindings_desktop: [ROOT_SIGHT] });
    assert.ok(bindings, 'the array shape produced no binding table');
    assert.deepEqual(Object.keys(bindings), ['root_sight_toggle']);
    assert.deepEqual(bindings.root_sight_toggle?.keys, ['KeyR']);
    assert.equal(bindings.root_sight_toggle?.mode, 'toggle');
  });

  it('keeps the record the route serves', () => {
    const bindings = normalizeBindings({ bindings: { root_sight_toggle: ROOT_SIGHT } });
    assert.deepEqual(Object.keys(bindings ?? {}), ['root_sight_toggle']);
  });

  it('reports nothing when the file carries no table, so a fallback can apply', () => {
    assert.equal(normalizeBindings({}), undefined);
    assert.equal(normalizeBindings({ bindings: {} }), undefined);
  });

  it('treats an unreadable array as missing instead of as an empty keymap', () => {
    // An array of junk is a broken file, not "no keys are bound": returning {}
    // would leave every action dead with nothing to fall back to.
    const bindings = normalizeBindings({
      bindings_desktop: [{ keys: ['KeyR'] } as unknown as typeof ROOT_SIGHT],
    });
    assert.equal(bindings, undefined);
  });
});
