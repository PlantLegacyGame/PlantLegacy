import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ConfigFile } from '@plant-legacy/shared/config';
import { loadMutationsConfig } from './config.ts';

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../../config');

function loadRepoConfigs(): Map<string, ConfigFile> {
  const configs = new Map<string, ConfigFile>();
  for (const file of readdirSync(CONFIG_DIR)) {
    if (!file.endsWith('.json')) continue;
    configs.set(
      file.replace(/\.json$/, ''),
      JSON.parse(readFileSync(join(CONFIG_DIR, file), 'utf8')) as ConfigFile,
    );
  }
  return configs;
}

describe('real mutations config (T04)', () => {
  const config = loadMutationsConfig(loadRepoConfigs());

  it('parses the level and over-form rules from the shipped file', () => {
    assert.ok(config.levelUp.maxLevel >= 2, 'mutations can be levelled');
    assert.ok(config.levelUp.cardsPerOffer >= 2, 'a level-up is a choice');
    assert.ok(config.oversizeWiltPerS > 0, 'lost size drains over time');
    assert.ok(config.oversizeLeakPerS > 0, 'lost capacity leaks over time');
    // Snake-case config keys must reach the simulation as effect keys.
    assert.equal(typeof config.levelUp.cardSteps.sizeMultiplier, 'number');
    assert.equal(typeof config.levelUp.cardSteps.energyUpkeepMultiplier, 'number');
    assert.ok(
      typeof config.levelUp.cardLabels.sizeMultiplier === 'string',
      'cards have player-facing words',
    );
  });

  it('gives every mutation exactly one style, and no style is orphaned', () => {
    const styles = config.visualStyles ?? {};
    const ids = new Set(config.definitions.map((definition) => definition.id));
    for (const definition of config.definitions) {
      const style = styles[definition.id];
      assert.ok(style, `${definition.id} has no style`);
      assert.equal(definition.visualStyle.id, definition.id);
      assert.ok(style.ordinal >= 1, `${definition.id} has no ordinal`);
      assert.ok(
        ['foliage', 'woody', 'seed', 'bloom', 'whole'].includes(style.target),
        `${definition.id} targets an unknown family`,
      );
    }
    for (const id of Object.keys(styles)) {
      assert.ok(ids.has(id), `style "${id}" names no mutation`);
    }
  });

  it('ships a distinct style per mutation and a distinct ordinal per style', () => {
    const ordinals = new Set<number>();
    const fingerprints = new Map<string, string>();
    for (const definition of config.definitions) {
      const style = definition.visualStyle;
      assert.ok(!ordinals.has(style.ordinal), `ordinal ${style.ordinal} is used twice`);
      ordinals.add(style.ordinal);
      const fingerprint = JSON.stringify([
        style.target,
        style.pattern,
        style.patternScale,
        style.tint,
        style.tintStrength,
        style.variegation,
        style.variegationColor,
        style.glow,
        style.glowColor,
        style.barkThickness,
        style.barkDarken,
        style.spines,
      ]);
      const clash = fingerprints.get(fingerprint);
      assert.equal(
        clash,
        undefined,
        `${definition.id} looks exactly like ${clash}: a name has to mean something`,
      );
      fingerprints.set(fingerprint, definition.id);
    }
    assert.equal(ordinals.size, config.definitions.length);
  });

  it('gives every mutation at least one card it can grow into', () => {
    for (const definition of config.definitions) {
      const cards = Object.keys(config.levelUp.cardSteps).filter(
        (key) =>
          key === 'energyUpkeepMultiplier' ||
          (definition.effects as Record<string, unknown>)[key] !== undefined,
      );
      assert.ok(cards.length >= 1, `${definition.id} deals no cards`);
    }
  });
});
