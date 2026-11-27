import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * The store bars are a green ramp, not a white one.
 *
 * The vitals fill and the structure (health) bar used to run from --leaf-700 to
 * --leaf-300. --leaf-300 is the foliage-100 step - a near-white yellow-green -
 * and on a four-pixel bar the light half of the gradient read as a white smear,
 * so a full water bar looked empty rather than healthy. Both bars now share one
 * four-stop green ramp: pale, light green, green, deep green.
 */
const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');

const BARS: Record<string, string> = {
  'the vitals store bar': read('../main.ts'),
  'the structure bar': read('./PlantStatusHud.ts'),
};

function storeGradient(source: string): string {
  const match = source.match(/linear-gradient\(90deg,[^;']*\)/);
  assert.ok(match, 'no store bar gradient found');
  return match[0].replace(/\s+/g, ' ').trim();
}

describe('the colour of a store bar', () => {
  it('runs pale green to deep green, never through the near-white step', () => {
    for (const [name, source] of Object.entries(BARS)) {
      const gradient = storeGradient(source);
      assert.equal(
        gradient.includes('--leaf-300'),
        false,
        `${name} still passes through --leaf-300, the near-white foliage step`,
      );
      const stops = [...gradient.matchAll(/--leaf-(\d{3})/g)].map((m) => Number(m[1]));
      assert.ok(stops.length >= 3, `${name} has ${stops.length} stops`);
      // Pale first, then greener as the bar fills.
      assert.deepEqual(
        stops,
        [...stops].sort((a, b) => a - b),
        `${name} runs dark to pale`,
      );
      assert.ok(stops.includes(500), `${name} has no mid green`);
    }
  });

  it('is the same ramp in both bars, so they cannot drift apart', () => {
    const [vitals, structure] = Object.values(BARS).map(storeGradient);
    assert.equal(vitals, structure);
  });
});
