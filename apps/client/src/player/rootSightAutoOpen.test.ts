import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideAutoOpenRootSight, isUndergroundPart } from './rootSightAutoOpen.ts';

describe('root sight auto-open', () => {
  it('treats every buried organ as underground, by type or by layer', () => {
    for (const type of ['radicle', 'root', 'lateral_root', 'rhizome', 'tuber', 'pneumatophore']) {
      assert.equal(isUndergroundPart(type), true, type);
    }
    assert.equal(isUndergroundPart('MYSTERY_ROOT', 'root'), true);
    for (const type of ['stem', 'leaf', 'cotyledon', 'branch', 'flower']) {
      assert.equal(isUndergroundPart(type), false, type);
    }
    // The layer tag beats the list, in both directions.
    assert.equal(isUndergroundPart('leaf', 'root'), true);
    assert.equal(isUndergroundPart('root', 'canopy'), false);
  });

  it('opens when a buried part starts and the view is closed', () => {
    for (const type of ['radicle', 'lateral_root', 'root']) {
      const decision = decideAutoOpenRootSight({
        type,
        autoOpenEnabled: true,
        alreadyOpen: false,
      });
      assert.deepEqual(decision, { open: true, reason: 'started-underground' }, type);
    }
  });

  it('never opens for canopy growth, a disabled rule, or an open view', () => {
    assert.equal(
      decideAutoOpenRootSight({ type: 'leaf', autoOpenEnabled: true, alreadyOpen: false }).open,
      false,
    );
    assert.equal(
      decideAutoOpenRootSight({ type: 'radicle', autoOpenEnabled: false, alreadyOpen: false }).open,
      false,
    );
    // Already open: re-opening would fight a transition that is still running.
    assert.equal(
      decideAutoOpenRootSight({ type: 'radicle', autoOpenEnabled: true, alreadyOpen: true }).open,
      false,
    );
  });

  it('does not open for a part whose layer is canopy even if the name looks buried', () => {
    assert.equal(
      decideAutoOpenRootSight({
        type: 'root',
        layer: 'canopy',
        autoOpenEnabled: true,
        alreadyOpen: false,
      }).open,
      false,
    );
  });
});
