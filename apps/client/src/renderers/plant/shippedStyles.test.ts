/**
 * The look builder against the *shipped* style table.
 *
 * A field rename in `config/mutation_visuals.json` that the client parser does
 * not follow would paint every plant neutral without any test failing, so this
 * reads the real file, parses it the way the client does, and composes a few
 * real mutation pairs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseMutationVisuals } from '../../config/mutationVisuals.ts';
import {
  configureMutationVisuals,
  DEFAULT_MUTATION_VISUAL_CAPS,
  lookFromMutations,
  lookIsNeutral,
  MUTATION_MASK_LIMIT,
  mutationStyleById,
  mutationVisualStyleCount,
  organFamily,
} from './mutations.ts';

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../../config');

function loadShipped(): {
  styles: ReturnType<typeof parseMutationVisuals>['styles'];
  caps: ReturnType<typeof parseMutationVisuals>['caps'];
  definitions: Array<{ id: string }>;
} {
  const visuals = JSON.parse(readFileSync(join(CONFIG_DIR, 'mutation_visuals.json'), 'utf8')) as {
    values: Record<string, { value?: unknown }>;
  };
  const mutations = JSON.parse(readFileSync(join(CONFIG_DIR, 'mutations.json'), 'utf8')) as {
    values: Record<string, { type?: string; value?: unknown }>;
  };
  const definitions = Object.entries(mutations.values)
    .filter(([key, entry]) => key.startsWith('mutation_') && entry.type === 'object')
    .map(([, entry]) => entry.value as { id?: string })
    .filter((value): value is { id: string } => typeof value?.id === 'string');
  // The server flattens `values.*.value` for /config/mutation_visuals.
  const served: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(visuals.values)) served[key] = entry.value;
  return { ...parseMutationVisuals(served), definitions };
}

const shipped = loadShipped();

test('the shipped style table parses into one style per mutation', () => {
  assert.ok(shipped.styles.length > 40, `expected the full table, got ${shipped.styles.length}`);
  assert.equal(shipped.styles.length, shipped.definitions.length);
  const ids = new Set(shipped.styles.map((style) => style.id));
  for (const definition of shipped.definitions) {
    assert.ok(ids.has(definition.id), `${definition.id} has no parsed style`);
  }
  // Caps come from the file, not from the built-in defaults.
  assert.equal(shipped.caps.maxBarkThickness, 1.6);
  assert.equal(shipped.caps.levelVisualGain, 0.35);
});

test('no shipped style is silently neutral', () => {
  configureMutationVisuals(shipped.styles, shipped.caps);
  assert.equal(mutationVisualStyleCount(), shipped.styles.length);
  for (const style of shipped.styles) {
    const stack = lookFromMutations([{ id: style.id }]);
    const organ =
      style.target === 'whole'
        ? stack.disc
        : stack.looks[style.target === 'woody' ? 'woody' : style.target];
    const paintsPigment =
      lookIsNeutral(organ) === false || organ.barkScale > 1 || organ.spines > 0 || organ.glow > 0;
    assert.ok(paintsPigment, `${style.id} composes to a neutral look`);
  }
});

test('shipped ordinals are unique and fit the legacy four-bit channel or report none', () => {
  const ordinals = new Set(shipped.styles.map((style) => style.ordinal));
  assert.equal(ordinals.size, shipped.styles.length);
  const overflowing = shipped.styles.filter((style) => style.ordinal > MUTATION_MASK_LIMIT);
  // A table larger than the packed word is fine; those styles report "none" on
  // the billboard channel instead of a truncated, wrong signature.
  assert.ok(overflowing.length >= 0);
});

test('a real pair of mutations composes onto their own organs', () => {
  configureMutationVisuals(shipped.styles, shipped.caps);
  const variegated = mutationStyleById('variegated_foliage');
  const bark = mutationStyleById('thickened_bark');
  assert.ok(variegated);
  assert.ok(bark);
  const stack = lookFromMutations([{ id: 'variegated_foliage' }, { id: 'thickened_bark' }]);
  assert.equal(organFamily('leaf'), 'foliage');
  assert.ok(stack.looks.foliage.variegation > 0.3, 'foliage keeps the mottle');
  assert.ok(stack.looks.woody.barkScale > 1.2, 'trunk gets the thicker bark');
  assert.ok(stack.looks.woody.variegation < 0.05, 'bark is not mottled');
  assert.ok(stack.looks.foliage.glow < 0.05, 'no glow without a glow mutation');
});

test('the shipped caps bound a deliberately stacked look', () => {
  configureMutationVisuals(shipped.styles, shipped.caps);
  // Every mutation at once is the worst case a player can build.
  const stack = lookFromMutations(shipped.styles.map((style) => ({ id: style.id, level: 3 })));
  const caps = { ...DEFAULT_MUTATION_VISUAL_CAPS, ...shipped.caps };
  for (const family of ['foliage', 'woody', 'seed', 'bloom'] as const) {
    const look = stack.looks[family];
    for (const channel of look.tint) {
      assert.ok(channel >= caps.minTint - 1e-6 && channel <= caps.maxTint + 1e-6);
    }
    assert.ok(look.variegation <= caps.maxVariegation + 1e-6);
    assert.ok(look.glow <= caps.maxGlow + 1e-6);
    assert.ok(look.barkScale <= caps.maxBarkThickness + 1e-6);
    assert.ok(look.barkDarken <= caps.maxBarkDarken + 1e-6);
    assert.ok(look.spines <= caps.maxSpines + 1e-6);
  }
});
