/**
 * Key policy: the ship binding table must not fight the browser or the keyboard.
 *
 * The game used to claim `F3` for the operator readout and a bare `Shift` for the
 * metrics overlay. In Chrome F3 is the find bar and in Firefox quick-find, so the
 * key a player pressed to look at a readout opened a search box; Shift is held
 * constantly for selection and capitals, so the overlay toggled mid-drag. `F2`
 * opened a growth readout. All three are switches in the dev panel now.
 *
 * This pins the rule to the data, so a future binding cannot quietly reintroduce
 * one: no function keys, and no bare modifier as a binding of its own.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

interface BindingRow {
  action: string;
  keys: string[];
  mouse: string;
  mode: string;
  context: string;
}

const raw = JSON.parse(
  readFileSync(new URL('../../../../config/controls.json', import.meta.url), 'utf8'),
) as { values: { bindings_desktop: { value: BindingRow[] } } };
const rows = raw.values.bindings_desktop.value;

const FUNCTION_KEY = /^F\d{1,2}$/;
const MODIFIER_KEY = /^(Shift|Control|Alt|Meta)(Left|Right)?$/;

describe('key policy', () => {
  it('binds no function key', () => {
    const offenders = rows
      .filter((row) => row.keys.some((key) => FUNCTION_KEY.test(key)))
      .map((row) => `${row.action}: ${row.keys.join(',')}`);
    assert.deepEqual(offenders, [], 'function keys belong to the browser');
  });

  it('binds no bare modifier as an action of its own', () => {
    const offenders = rows
      .filter((row) => row.keys.some((key) => MODIFIER_KEY.test(key)))
      .map((row) => `${row.action}: ${row.keys.join(',')}`);
    assert.deepEqual(offenders, [], 'a modifier is held, not pressed as a toggle');
  });

  it('keeps the diagnostics out of the binding table entirely', () => {
    // These are dev-panel switches. If one comes back as a key it is because
    // someone re-added a hotkey instead of wiring a toggle.
    for (const action of ['debug_toggle']) {
      const row = rows.find((entry) => entry.action === action);
      assert.ok(row, `${action} should still exist as a declared action`);
      assert.deepEqual(row.keys, [], `${action} must not have a key`);
    }
  });

  it('leaves the every-session keys on plain letters', () => {
    const byAction = new Map(rows.map((row) => [row.action, row.keys]));
    assert.deepEqual(byAction.get('grow_mode_toggle'), ['KeyG']);
    assert.deepEqual(byAction.get('inventory_overview_toggle'), ['KeyI']);
    assert.deepEqual(byAction.get('root_sight_toggle'), ['KeyR']);
    assert.deepEqual(byAction.get('emote_wheel'), ['KeyE']);
    assert.deepEqual(byAction.get('hint_card_toggle'), ['KeyH']);
  });

  it('keeps movement off the letters a player types with, except WASD', () => {
    // Chat is a text box: letter bindings outside WASD are what make typing "hi"
    // toggle hints and the inventory. Movement is WASD and the arrows only.
    const pan = rows
      .filter((row) => row.action.startsWith('camera_pan_'))
      .flatMap((row) => row.keys);
    assert.deepEqual(pan.sort(), [
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'KeyA',
      'KeyD',
      'KeyS',
      'KeyW',
    ]);
  });
});
