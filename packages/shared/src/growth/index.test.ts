import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyMutationShapeBias,
  clampGrowthDirectionByGene,
  getSeedBodyHeightRatio,
  NODE_GROWTH_CONSTRAINTS,
  type NodeType,
  seedBodyCentreY,
  seedBodyHalfHeight,
} from './index.ts';

describe('clampGrowthDirectionByGene', () => {
  it('clamps radicle and root directions downward within gene cone', () => {
    // Attempting to grow a radicle upward into the air must clamp downward
    const upwardAttempt = clampGrowthDirectionByGene('radicle', { x: 0, y: 1, z: 0 });
    assert(upwardAttempt.y <= -0.25, `Radicle Y (${upwardAttempt.y}) should be clamped <= -0.25`);
    const len1 = Math.hypot(upwardAttempt.x, upwardAttempt.y, upwardAttempt.z);
    assert(Math.abs(len1 - 1.0) < 1e-4, 'Clamped vector must be normalized');

    // Horizontal attempt must still trend downward
    const horizontalAttempt = clampGrowthDirectionByGene('radicle', { x: 1, y: 0, z: 0 });
    assert(
      horizontalAttempt.y <= -0.25,
      `Radicle Y (${horizontalAttempt.y}) should trend downward`,
    );
    assert(horizontalAttempt.x > 0, 'Horizontal bias should be preserved');

    // Downward attempt should be preserved
    const downwardAttempt = clampGrowthDirectionByGene('radicle', { x: 0, y: -1, z: 0 });
    assert.equal(downwardAttempt.y, -1);
  });

  it('clamps stem directions upward within apical cone', () => {
    // Attempting to grow stem into the ground must clamp upward
    const downwardAttempt = clampGrowthDirectionByGene('stem', { x: 0, y: -1, z: 0 });
    assert(downwardAttempt.y >= 0.35, `Stem Y (${downwardAttempt.y}) should be >= 0.35`);
    const len = Math.hypot(downwardAttempt.x, downwardAttempt.y, downwardAttempt.z);
    assert(Math.abs(len - 1.0) < 1e-4, 'Clamped vector must be normalized');

    // Upward attempt preserved
    const upward = clampGrowthDirectionByGene('stem', { x: 0.1, y: 0.95, z: 0 });
    assert(upward.y >= 0.35);
  });

  it('clamps lateral root directions with spreading angle', () => {
    const lateral = clampGrowthDirectionByGene('lateral_root', { x: 1, y: 0.2, z: 0 });
    assert(lateral.y <= -0.15, `Lateral root Y (${lateral.y}) must trend downward`);
    assert(lateral.x > 0, 'Lateral spread should be preserved');
  });

  it('clamps leaves and cotyledons outward for sun exposure', () => {
    const leaf = clampGrowthDirectionByGene('leaf', { x: 0, y: -1, z: 0 });
    assert(leaf.y >= 0.15, 'Leaf should not grow downward');
    assert(leaf.y <= 0.75, 'Leaf should spread outward, not straight up');
  });

  it('handles zero/degenerate input vector gracefully with gene default', () => {
    const zeroRadicle = clampGrowthDirectionByGene('radicle', { x: 0, y: 0, z: 0 });
    assert(zeroRadicle.y <= -0.25, 'Zero vector for radicle defaults to downward');
    const len1 = Math.hypot(zeroRadicle.x, zeroRadicle.y, zeroRadicle.z);
    assert(Math.abs(len1 - 1.0) < 1e-4);

    const zeroStem = clampGrowthDirectionByGene('stem', { x: 0, y: 0, z: 0 });
    assert(zeroStem.y >= 0.35, 'Zero vector for stem defaults to upward');
    const len2 = Math.hypot(zeroStem.x, zeroStem.y, zeroStem.z);
    assert(Math.abs(len2 - 1.0) < 1e-4);
  });

  it('defines valid gene reach and angle constraints for all standard node types', () => {
    const allTypes: NodeType[] = [
      'seed',
      'radicle',
      'root',
      'lateral_root',
      'stem',
      'branch',
      'vine',
      'leaf',
      'cotyledon',
      'flower',
      'spore_sac',
    ];
    for (const t of allTypes) {
      const c = NODE_GROWTH_CONSTRAINTS[t];
      assert(c != null, `Constraints should exist for ${t}`);
      assert(c.maxReach > 0, `maxReach must be positive for ${t}`);
      assert(c.minY <= c.maxY, `minY <= maxY for ${t}`);
      assert(c.minY >= -1.0 && c.maxY <= 1.0, `Y bounds within [-1, 1] for ${t}`);
    }
  });
});

describe('seed body placement', () => {
  it('lifts the drawn seed centre by its own half-height', () => {
    const radius = 0.075;
    assert.equal(seedBodyHalfHeight(radius), radius * getSeedBodyHeightRatio());
    assert.equal(seedBodyCentreY(0, radius), seedBodyHalfHeight(radius));
    assert.equal(seedBodyCentreY(-2, radius), -2 + seedBodyHalfHeight(radius));
  });

  it('leaves the contact point on the ground when the body is not a real radius', () => {
    assert.equal(seedBodyHalfHeight(0), 0);
    assert.equal(seedBodyHalfHeight(-1), 0);
    assert.equal(seedBodyCentreY(3, Number.NaN), 3);
  });
});

describe('applyMutationShapeBias', () => {
  it('a columnar habit lifts a lateral branch without breaking the gene cone', () => {
    const lateral = clampGrowthDirectionByGene('branch', { x: 1, y: 0.2, z: 0 });
    const upright = applyMutationShapeBias(
      'branch',
      lateral,
      { vertical: 0.6, droop: 0 },
      'canopy',
    );
    assert.ok(upright.y > lateral.y, `bias should raise Y (${lateral.y} -> ${upright.y})`);
    const length = Math.hypot(upright.x, upright.y, upright.z);
    assert.ok(Math.abs(length - 1) < 1e-4, 'still a unit direction');
    const constraints = NODE_GROWTH_CONSTRAINTS.branch;
    assert.ok(upright.y >= constraints.minY && upright.y <= constraints.maxY);
  });

  it('drooping fronds bend a leaf down to the lowest legal angle', () => {
    const leaf = clampGrowthDirectionByGene('leaf', { x: 0.4, y: 0.7, z: 0 });
    const drooped = applyMutationShapeBias('leaf', leaf, { vertical: 0, droop: 0.55 }, 'canopy');
    assert.ok(drooped.y < leaf.y, `droop should lower Y (${leaf.y} -> ${drooped.y})`);
    assert.ok(drooped.y >= NODE_GROWTH_CONSTRAINTS.leaf.minY);
    const length = Math.hypot(drooped.x, drooped.y, drooped.z);
    assert.ok(Math.abs(length - 1) < 1e-4, 'still a unit direction');
  });

  it('does nothing without a bias and never touches roots', () => {
    const intent = { x: 0.6, y: 0.7, z: 0.2 };
    assert.deepEqual(applyMutationShapeBias('stem', intent, undefined, 'canopy'), intent);
    // Roots have no columnar habit: the bias is ignored, not applied downward.
    assert.deepEqual(
      applyMutationShapeBias('stem', intent, { vertical: 0.9, droop: 0 }, 'root'),
      intent,
    );
  });
});
