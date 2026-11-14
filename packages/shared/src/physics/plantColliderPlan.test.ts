import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ColliderNodeInput, planPlantColliders } from './plantColliderPlan.ts';

function chain(count: number) {
  const nodes: ColliderNodeInput[] = [];
  for (let i = 0; i < count; i += 1) {
    nodes.push({
      id: `n${i}`,
      parentId: i === 0 ? null : `n${i - 1}`,
      x: 0,
      y: i * 0.5,
      z: 0,
      radius: 0.02,
      type: i === 0 ? 'seed' : 'stem',
      growthProgress: 1,
    });
  }
  return nodes;
}

describe('plant collider plan', () => {
  it('turns a node chain into capsules plus a root ball', () => {
    const plan = planPlantColliders(chain(4), { includeLeafBlades: false });
    assert.equal(plan.colliders.filter((c) => c.kind === 'capsule').length, 3);
    assert.equal(plan.colliders.filter((c) => c.kind === 'ball').length, 1);
    assert.equal(plan.totalSegments, 3);
    assert.equal(plan.mergedAway, 0);
  });

  it('respects the collider budget by merging degree-2 runs', () => {
    const plan = planPlantColliders(chain(20), {
      maxColliders: 5,
      includeLeafBlades: false,
    });
    assert.ok(plan.colliders.length <= 5, `got ${plan.colliders.length}`);
    assert.ok(plan.mergedAway > 0);
    assert.equal(plan.truncated, false);
  });

  it('drops leaf blades before structural capsules', () => {
    const nodes = chain(4);
    nodes.push({
      id: 'leaf0',
      parentId: 'n3',
      x: 0,
      y: 1.5,
      z: 0.2,
      radius: 0.01,
      type: 'leaf',
      growthProgress: 1,
    });
    const plan = planPlantColliders(nodes, { maxColliders: 4 });
    assert.equal(
      plan.colliders.some((c) => c.kind === 'cuboid'),
      false,
    );
    assert.equal(plan.colliders.filter((c) => c.kind === 'capsule').length, 3);
  });

  it('adds a thin blade for a leaf at close range', () => {
    const nodes = chain(2);
    nodes.push({
      id: 'leaf0',
      parentId: 'n1',
      x: 0,
      y: 0.5,
      z: 0.2,
      radius: 0.02,
      type: 'leaf',
      growthProgress: 1,
    });
    const plan = planPlantColliders(nodes, { maxColliders: 64 });
    const blade = plan.colliders.find((c) => c.kind === 'cuboid');
    assert.ok(blade);
    if (blade.kind === 'cuboid') assert.ok(blade.halfExtents.y < 0.01);
  });

  it('skips segments that are still growing', () => {
    const nodes = chain(3);
    const last = nodes[2];
    if (last) last.growthProgress = 0.1;
    const plan = planPlantColliders(nodes, { minGrowthProgress: 0.35, includeLeafBlades: false });
    assert.equal(plan.colliders.filter((c) => c.kind === 'capsule').length, 1);
  });

  it('uses the parent attachment point for a mid-segment bud', () => {
    const nodes = chain(2);
    nodes.push({
      id: 'bud',
      parentId: 'n1',
      x: 0,
      y: 0.25,
      z: 0.4,
      radius: 0.01,
      type: 'branch',
      parentAttachX: 0,
      parentAttachY: 0.25,
      parentAttachZ: 0,
      growthProgress: 1,
    });
    const plan = planPlantColliders(nodes, { includeLeafBlades: false });
    const bud = plan.colliders.find((c) => c.kind === 'capsule' && c.nodeId === 'bud');
    assert.ok(bud);
    if (bud.kind === 'capsule') {
      assert.deepEqual(bud.a, { x: 0, y: 0.25, z: 0 });
    }
  });

  it('returns an empty plan for an empty plant', () => {
    const plan = planPlantColliders([]);
    assert.equal(plan.colliders.length, 0);
    assert.equal(plan.truncated, false);
  });
});
