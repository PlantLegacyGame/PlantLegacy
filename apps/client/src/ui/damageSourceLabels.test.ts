import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DamageSource } from '@plant-legacy/shared/damage';
import { DAMAGE_SOURCE_LABELS, damageSourceLabel } from './damageSourceLabels.ts';

describe('the damage toast source', () => {
  it('names every source with prose, not the internal name', () => {
    const sources: DamageSource[] = ['weather', 'tool', 'herbivore', 'terrain', 'starvation'];
    for (const source of sources) {
      assert.match(DAMAGE_SOURCE_LABELS[source], /\S/, `${source} has no label`);
    }
    assert.equal(damageSourceLabel('tool'), 'a tool');
  });

  it('names upkeep loss as its own upkeep', () => {
    // E18: this loss is the plant failing to pay for itself, so the cue says so
    // instead of repeating the internal source name back to the player.
    assert.equal(damageSourceLabel('starvation'), 'its own upkeep');
  });

  it('still renders a source a newer server might send', () => {
    assert.equal(damageSourceLabel('fire'), 'damage');
    assert.equal(damageSourceLabel(undefined), 'damage');
  });
});
