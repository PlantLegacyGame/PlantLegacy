import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_BRANCH_ATTACH_FRACTION,
  getSeedBodyHeightRatio,
  nodeAttachmentPoint,
  nodeRenderRadius,
  placeSegment,
  resolveAttachFraction,
  resolveDrawnRadius,
  SEED_BODY_HEIGHT_RATIO,
  setGrowthGeometryTunables,
} from './index.ts';

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-12;

describe('nodeAttachmentPoint', () => {
  it('leaves a non-seed parent at its stored position', () => {
    const attach = nodeAttachmentPoint(
      { x: 1, y: 2, z: 3, nodeType: 'stem', radius: 0.026, biomass: 5 },
      { x: 0.5, y: 1, z: 0 },
    );
    assert.deepEqual(attach, { x: 1, y: 2, z: 3 });
  });

  it('starts a seed child on the coat along the growth direction', () => {
    const seedRadius = nodeRenderRadius('seed', 1);
    const seed = { x: 0, y: 0, z: 0, nodeType: 'seed', radius: seedRadius, biomass: 1 };

    const up = nodeAttachmentPoint(seed, { x: 0, y: 1, z: 0 });
    assert.ok(close(up.y, seedRadius * SEED_BODY_HEIGHT_RATIO + seedRadius));
    assert.ok(close(up.x, 0));

    const down = nodeAttachmentPoint(seed, { x: 0, y: -1, z: 0 });
    assert.ok(close(down.y, seedRadius * SEED_BODY_HEIGHT_RATIO - seedRadius));

    // Direction is normalised, so a longer vector lands on the same point.
    const side = nodeAttachmentPoint(seed, { x: 2, y: 0, z: 0 });
    assert.ok(close(side.x, seedRadius));
    assert.ok(close(side.y, seedRadius * SEED_BODY_HEIGHT_RATIO));
  });

  it('trusts a drawn server seed radius and ignores a legacy vessel radius', () => {
    const drawn = 0.09;
    const honest = nodeAttachmentPoint(
      { x: 0, y: 0, z: 0, nodeType: 'seed', radius: drawn, biomass: 1 },
      { x: 0, y: 1, z: 0 },
    );
    assert.ok(close(honest.y, drawn * SEED_BODY_HEIGHT_RATIO + drawn));

    const legacy = nodeAttachmentPoint(
      { x: 0, y: 0, z: 0, nodeType: 'seed', radius: 0.75, biomass: 1 },
      { x: 0, y: 1, z: 0 },
    );
    const fallback = resolveDrawnRadius('seed', 0.75, 1);
    assert.ok(close(legacy.y, fallback * SEED_BODY_HEIGHT_RATIO + fallback));
  });

  it('falls back to straight up for a zero-length direction', () => {
    const seedRadius = nodeRenderRadius('seed', 1);
    const attach = nodeAttachmentPoint(
      { x: 0, y: 0, z: 0, nodeType: 'seed', radius: seedRadius, biomass: 1 },
      { x: 0, y: 0, z: 0 },
    );
    assert.ok(close(attach.y, seedRadius * SEED_BODY_HEIGHT_RATIO + seedRadius));
  });
});

describe('placeSegment', () => {
  it('ends one length from a non-seed parent', () => {
    const placement = placeSegment(
      { x: 1, y: 2, z: 3, nodeType: 'stem', radius: 0.026, biomass: 5 },
      { x: 0.6, y: 0.8, z: 0 },
      0.4,
    );
    assert.deepEqual(placement.start, { x: 1, y: 2, z: 3 });
    const step = Math.hypot(
      placement.end.x - placement.start.x,
      placement.end.y - placement.start.y,
      placement.end.z - placement.start.z,
    );
    assert.ok(close(step, 0.4));
  });

  it('normalises the direction, so the step is the configured distance', () => {
    const placement = placeSegment(
      { x: 0, y: 0, z: 0, nodeType: 'root', radius: 0.02, biomass: 5 },
      { x: 0, y: -5, z: 0 },
      0.85,
    );
    assert.ok(close(placement.end.y, -0.85));
    assert.ok(close(placement.end.x, 0));
  });

  it('starts a seed child on the coat', () => {
    const seedRadius = nodeRenderRadius('seed', 1);
    const placement = placeSegment(
      { x: 0, y: 0, z: 0, nodeType: 'seed', radius: seedRadius, biomass: 1 },
      { x: 0, y: -1, z: 0 },
      0.5,
    );
    assert.ok(close(placement.start.y, seedRadius * SEED_BODY_HEIGHT_RATIO - seedRadius));
    assert.ok(close(placement.end.y, placement.start.y - 0.5));
  });

  it('falls back to straight up for a zero direction without producing NaN', () => {
    const placement = placeSegment(
      { x: 0, y: 0, z: 0, nodeType: 'stem', radius: 0.02, biomass: 5 },
      { x: 0, y: 0, z: 0 },
      0.3,
    );
    assert.ok(Number.isFinite(placement.end.x));
    assert.ok(Number.isFinite(placement.end.y));
    assert.ok(Number.isFinite(placement.end.z));
    assert.ok(close(placement.end.y, 0.3));
  });
});

describe('mid-segment attachment', () => {
  const stem = {
    x: 0,
    y: 1,
    z: 0,
    nodeType: 'stem',
    radius: 0.026,
    biomass: 5,
    segmentStart: { x: 0, y: 0, z: 0 },
  };

  it('leaves part-way along the parent segment', () => {
    const attach = nodeAttachmentPoint(stem, { x: 1, y: 0, z: 0 }, 0.5);
    assert.ok(close(attach.y, 0.5));

    const placement = placeSegment(stem, { x: 1, y: 0, z: 0 }, 0.3, 0.5);
    assert.ok(close(placement.start.y, 0.5));
    assert.ok(close(placement.end.x, 0.3), 'the step still has its own length');
    assert.ok(close(placement.end.y, 0.5));
  });

  it('uses the parent end at a full fraction or when the parent has no segment', () => {
    assert.deepEqual(nodeAttachmentPoint(stem, { x: 1, y: 0, z: 0 }, 1), {
      x: 0,
      y: 1,
      z: 0,
    });
    const noStart = { ...stem, segmentStart: undefined };
    assert.deepEqual(nodeAttachmentPoint(noStart, { x: 1, y: 0, z: 0 }, 0.4), {
      x: 0,
      y: 1,
      z: 0,
    });
  });

  it('clamps a fraction into the segment', () => {
    assert.ok(close(nodeAttachmentPoint(stem, { x: 0, y: 1, z: 0 }, 4).y, 1));
    assert.ok(close(nodeAttachmentPoint(stem, { x: 0, y: 1, z: 0 }, 0).y, 0.05));
  });

  it('ignores the fraction for a seed, which always leaves the coat', () => {
    const seedRadius = nodeRenderRadius('seed', 1);
    const seed = { x: 0, y: 0, z: 0, nodeType: 'seed', radius: seedRadius, biomass: 1 };
    const half = nodeAttachmentPoint(seed, { x: 0, y: 1, z: 0 }, 0.5);
    const end = nodeAttachmentPoint(seed, { x: 0, y: 1, z: 0 }, 1);
    assert.deepEqual(half, end);
    assert.ok(close(half.y, seedRadius * SEED_BODY_HEIGHT_RATIO + seedRadius));
  });
});

describe('resolveAttachFraction', () => {
  it('buds branching types part-way along and continues everything else', () => {
    assert.equal(resolveAttachFraction('lateral_root', undefined), 0.6);
    assert.equal(resolveAttachFraction('branch', undefined), 0.6);
    assert.equal(resolveAttachFraction('vine', undefined), 0.6);
    assert.equal(resolveAttachFraction('stem', undefined), 1);
    assert.equal(resolveAttachFraction('leaf', undefined), 1);
    assert.equal(DEFAULT_BRANCH_ATTACH_FRACTION, 0.6);
  });

  it('reads the fraction from the applied geometry, so config is the only source', () => {
    try {
      setGrowthGeometryTunables({ branchAttachFraction: 0.25 });
      assert.equal(resolveAttachFraction('lateral_root', undefined), 0.25);
    } finally {
      setGrowthGeometryTunables();
    }
  });

  it('lets an explicit request win and clamps it', () => {
    assert.equal(resolveAttachFraction('stem', 0.3), 0.3);
    assert.equal(resolveAttachFraction('branch', 0.01), 0.05);
    assert.equal(resolveAttachFraction('branch', 9), 1);
  });
});

describe('configurable geometry', () => {
  it('applies a configured seed aspect and radius table', () => {
    try {
      setGrowthGeometryTunables({
        seedBodyHeightRatio: 2,
        nodeRadiusProfiles: { seed: { nominalBiomass: 1, radius: 0.05, min: 0.05, max: 0.05 } },
      });
      assert.equal(getSeedBodyHeightRatio(), 2);
      assert.equal(nodeRenderRadius('seed', 1), 0.05);

      const attach = nodeAttachmentPoint(
        { x: 0, y: 0, z: 0, nodeType: 'seed', radius: 0.05, biomass: 1 },
        { x: 0, y: 1, z: 0 },
      );
      assert.ok(close(attach.y, 0.05 * 2 + 0.05));
    } finally {
      setGrowthGeometryTunables();
    }
    assert.equal(getSeedBodyHeightRatio(), SEED_BODY_HEIGHT_RATIO);
  });

  it('ignores an invalid profile instead of breaking every radius', () => {
    try {
      setGrowthGeometryTunables({
        nodeRadiusProfiles: {
          stem: { nominalBiomass: 5, radius: -1, min: 0.01, max: 0.04 },
        },
      });
      assert.ok(nodeRenderRadius('stem', 5) > 0);
    } finally {
      setGrowthGeometryTunables();
    }
  });
});
