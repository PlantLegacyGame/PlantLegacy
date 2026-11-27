import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isBladeOrgan,
  isHeadOrgan,
  isRootOrgan,
  isSoftOrgan,
  isWoodyOrgan,
  ORGAN_DISPLAY_ORDER,
  ORGAN_TRAITS,
  organTraitFor,
} from './organTraits.ts';
import type { NodeType } from './types.ts';

const EVERY_NODE_TYPE: NodeType[] = [
  'seed',
  'radicle',
  'root',
  'lateral_root',
  'stem',
  'branch',
  'trunk',
  'rhizome',
  'culm',
  'floating_leaf',
  'pneumatophore',
  'thorn',
  'stolon',
  'tuber',
  'vine',
  'leaf',
  'cotyledon',
  'flower',
  'spore_sac',
];

describe('the organ trait table', () => {
  it('covers every node type exactly once in display order', () => {
    assert.equal(ORGAN_DISPLAY_ORDER.length, EVERY_NODE_TYPE.length);
    assert.deepEqual(new Set(ORGAN_DISPLAY_ORDER), new Set(EVERY_NODE_TYPE));
    assert.equal(new Set(ORGAN_DISPLAY_ORDER).size, ORGAN_DISPLAY_ORDER.length);
  });

  it('keeps underground, soft, blade and head roles exhaustive', () => {
    for (const type of EVERY_NODE_TYPE) {
      assert.equal(ORGAN_TRAITS[type].family.length > 0, true, `${type} has no family`);
      assert.equal(typeof ORGAN_TRAITS[type].underground, 'boolean');
      assert.equal(typeof ORGAN_TRAITS[type].soft, 'boolean');
      assert.equal(typeof ORGAN_TRAITS[type].woody, 'boolean');
    }
    assert.equal(isRootOrgan('rhizome'), true);
    assert.equal(isRootOrgan('tuber'), true);
    assert.equal(isRootOrgan('pneumatophore'), true);
    assert.equal(isRootOrgan('stem'), false);
    assert.equal(isSoftOrgan('leaf'), true);
    assert.equal(isSoftOrgan('flower'), true);
    assert.equal(isSoftOrgan('stem'), false);
    assert.equal(isWoodyOrgan('trunk'), true);
    assert.equal(isWoodyOrgan('leaf'), false);
    assert.equal(isBladeOrgan('floating_leaf'), true);
    assert.equal(isHeadOrgan('spore_sac'), true);
  });

  it('falls back to the shoot role for old data', () => {
    assert.equal(organTraitFor('not_a_node').family, 'shoot');
    assert.equal(organTraitFor(undefined).family, 'shoot');
  });
});
