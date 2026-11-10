import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampGrowthDirectionByGene, NODE_GROWTH_CONSTRAINTS, type NodeType } from './index.ts';

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
