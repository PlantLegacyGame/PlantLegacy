/**
 * One owner for the lightning strike.
 *
 * E20: `weather.json` carried its own `lightning_damage_amount` (25) that nothing
 * read while the damage pipeline billed `damage.json`'s 8, so a tuner editing
 * weather made storms no deadlier. This reads the two shipped files and pins the
 * number to the file the pipeline actually bills.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { ConfigFile } from '@plant-legacy/shared/config';
import { loadDamageConfig } from './config.ts';

function readShipped(system: string): ConfigFile {
  const url = new URL(`../../../../../config/${system}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as ConfigFile;
}

describe('the lightning strike amount', () => {
  it('is billed from damage.json', () => {
    const damage = readShipped('damage');
    const shipped = (damage.values.lightning_damage_amount as { value: number }).value;
    const config = loadDamageConfig(new Map<string, ConfigFile>([['damage', damage]]));
    assert.ok(shipped > 0);
    assert.equal(config.lightningDamageAmount, shipped);
  });

  it('has no second copy in weather.json', () => {
    assert.equal('lightning_damage_amount' in readShipped('weather').values, false);
  });
});
