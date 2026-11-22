/**
 * Guards the panels' half of A01, and one bug that hid behind a stylesheet.
 *
 * The dev, settings and shop panels build their styles in template strings, so
 * `styles.palette.test.ts` never sees them; they drifted into their own colour
 * system - hardcoded hexes and `rgba()` washes - while the HUD moved onto the
 * palette. Each file is held to the same rule: name a palette variable, never a
 * colour. Black and white are allowed because they are shadow and highlight, not
 * paint.
 *
 * The last test is the settings panel's open state. `setOpen` only toggles a
 * class, so the panel was "open" - and swallowed every Escape press - while a
 * missing CSS rule kept it at `display:none`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const paletteConfig = JSON.parse(read('../../../../config/palette.json')) as {
  values: {
    ramps: { value: { name: string; steps: { step: number }[] }[] };
    roles: { value: { name: string }[] };
  };
};

const paletteNames = new Set<string>([
  ...paletteConfig.values.ramps.value.flatMap((ramp) =>
    ramp.steps.map((step) => `--palette-${ramp.name}-${step.step}`),
  ),
  ...paletteConfig.values.roles.value.map((role) => `--palette-${role.name.replaceAll('_', '-')}`),
]);

const panels = [
  ['dev panel', './DevPanel.ts'],
  ['settings panel', './SettingsPanel.ts'],
  ['shop panel', './ShopPanel.ts'],
] as const;

const isWash = (colour: string) =>
  !/^rgba\(0,\s*0,\s*0,/.test(colour) && !/^rgba\(255,\s*255,\s*255,/.test(colour);

describe('the panel stylesheets', () => {
  for (const [name, path] of panels) {
    it(`${name} draws only in palette colours`, () => {
      const source = read(path);

      const hexes = source.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
      assert.deepEqual(hexes, [], `the ${name} still carries ${hexes.join(', ')}`);

      const washes = (source.match(/rgba\([^)]*\)/g) ?? []).filter(isWash);
      assert.deepEqual(washes, [], `the ${name} still carries ${washes.join(', ')}`);

      const named = [...source.matchAll(/var\((--palette-[a-z0-9-]+)/g)].map((m) => m[1]);
      assert.ok(named.length > 0, `the ${name} should be palette-led`);
      const unknown = [...new Set(named)].filter((variable) => !paletteNames.has(variable));
      assert.deepEqual(unknown, [], `unknown palette variables: ${unknown.join(', ')}`);
    });
  }

  it('shows the settings panel when it reports itself open', () => {
    const rule = read('./SettingsPanel.ts').match(/\.pl-settings-backdrop\.is-open\s*\{[^}]*\}/);
    assert.ok(rule, 'no .pl-settings-backdrop.is-open rule');
    assert.match(rule[0], /display:\s*(grid|flex|block)/);
  });
});
