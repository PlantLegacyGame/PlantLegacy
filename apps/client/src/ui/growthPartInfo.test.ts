import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ORGAN_DISPLAY_ORDER } from '@plant-legacy/shared/growth';
import { GROWTH_PART_INFO, growthTypeOrder } from './growthPartInfo.ts';

describe('growth card copy', () => {
  it('covers every organ in the display order', () => {
    const order = growthTypeOrder();
    assert.deepEqual(Object.keys(order), [...ORGAN_DISPLAY_ORDER]);
    for (const type of ORGAN_DISPLAY_ORDER) {
      assert.ok(GROWTH_PART_INFO[type], `${type} has no card copy`);
      assert.equal(order[type] >= 0, true);
    }
    assert.equal(Object.keys(GROWTH_PART_INFO).length, ORGAN_DISPLAY_ORDER.length);
  });
});
