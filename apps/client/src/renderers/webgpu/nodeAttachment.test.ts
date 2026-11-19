import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import type { PlantNodeData } from '../plant/plantNodeData.ts';
import { resolveSegmentFrame } from './PlantMeshBuilder.ts';

/**
 * Where children leave their parents, checked against the geometry that is
 * actually drawn.
 *
 * The server places every part one segment from a point on its parent and ships
 * that point (`parentAttach*` / `attachFraction`). The mesh pass has to start the
 * child there, on the parent's *drawn* body — not at a point recomputed from a
 * different frame. When the two disagreed, a stem was drawn from the seed's coat
 * surface while its branches attached at fractions of a segment that began thirty
 * centimetres lower, so every branch hung in the air below the stem it belonged
 * to. These numbers are a real grown seedling, straight from the server.
 */

// growth.json: seed_body_height_ratio 1.35; the seed's drawn radius is 0.0766 m.
const SEED_RADIUS = 0.0766;
const SEED_RATIO = 1.35;

function node(
  id: string,
  parentId: string | null,
  position: [number, number, number],
  extra: Partial<PlantNodeData> = {},
): PlantNodeData {
  return {
    id,
    parentId,
    position: new THREE.Vector3(...position),
    type: 1,
    radius: 0.1,
    age: 0,
    health: 1,
    mutationFlags: 0,
    biomass: 1,
    growthProgress: 1,
    isOwnPlant: true,
    ...extra,
  } as PlantNodeData;
}

function realSeedling(): PlantNodeData[] {
  return [
    node('seed', null, [0, 0, 0], {
      nodeType: 'seed',
      isSeed: true,
      radius: SEED_RADIUS,
      type: 0,
    }),
    node('radicle', 'seed', [0, -0.82, 0], {
      nodeType: 'radicle',
      radius: 0.028,
      parentAttachX: 0,
      parentAttachY: 0.03,
      parentAttachZ: 0,
      attachFraction: 1,
    }),
    node('cotyledon1', 'seed', [0.12, 0.23, 0], {
      nodeType: 'cotyledon',
      radius: 0.03,
      parentAttachX: 0.05,
      parentAttachY: 0.16,
      parentAttachZ: 0,
      attachFraction: 1,
    }),
    node('stem', 'seed', [0.02, 0.53, 0], {
      nodeType: 'stem',
      radius: 0.06,
      parentAttachX: 0,
      parentAttachY: 0.18,
      parentAttachZ: 0,
      attachFraction: 1,
    }),
    node('leaf0', 'stem', [0.08, 0.57, 0.02], {
      nodeType: 'leaf',
      radius: 0.04,
      parentAttachX: 0.02,
      parentAttachY: 0.53,
      parentAttachZ: 0,
      attachFraction: 1,
    }),
    node('branch1', 'stem', [0.27, 0.52, 0.07], {
      nodeType: 'branch',
      radius: 0.05,
      parentAttachX: 0.01,
      parentAttachY: 0.39,
      parentAttachZ: 0,
      attachFraction: 0.6,
    }),
    node('lateral0', 'radicle', [0.27, -0.77, 0.07], {
      nodeType: 'lateral_root',
      radius: 0.04,
      parentAttachX: 0,
      parentAttachY: -0.48,
      parentAttachZ: 0,
      attachFraction: 0.6,
    }),
  ];
}

const ORDER = ['seed', 'radicle', 'cotyledon1', 'stem', 'leaf0', 'branch1', 'lateral0'];

function resolveAll(nodes: PlantNodeData[]) {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const frames = new Map<string, ReturnType<typeof resolveSegmentFrame>>();
  for (const id of ORDER) {
    const entry = mustGet(byId, id);
    const parent = entry.parentId ? mustGet(byId, entry.parentId) : undefined;
    if (!parent) {
      frames.set(id, {
        start: entry.position.clone(),
        target: entry.position.clone(),
        animated: entry.position.clone(),
        branch: new THREE.Vector3(),
        startRadius: SEED_RADIUS,
        endRadius: SEED_RADIUS,
        growthEase: 1,
      });
      continue;
    }
    frames.set(id, resolveSegmentFrame(entry, parent, nodes, mustGet(frames, parent.id).animated));
  }
  return { byId, frames };
}

/** Map lookup that fails loudly instead of returning undefined. */
function mustGet<T>(map: Map<string, T>, id: string): T {
  const value = map.get(id);
  if (value === undefined) throw new Error(`missing ${id}`);
  return value;
}

function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

describe('child attachment to the drawn parent', () => {
  it('starts every child on or inside the body its parent is drawn as', () => {
    const nodes = realSeedling();
    const { byId, frames } = resolveAll(nodes);
    for (const id of ORDER) {
      const entry = mustGet(byId, id);
      if (!entry.parentId) continue;
      const parent = mustGet(byId, entry.parentId);
      const parentFrame = mustGet(frames, parent.id);
      const frame = mustGet(frames, id);
      const fraction = entry.attachFraction ?? 1;

      if ((parent.nodeType ?? '') === 'seed') {
        // The seed is an ovoid lifted off its stored contact point; measure the
        // start against that body, not against the contact point.
        const centreY = parent.position.y + SEED_RADIUS * SEED_RATIO;
        const halfHeight = SEED_RADIUS * SEED_RATIO;
        const dx = (frame.start.x - parent.position.x) / SEED_RADIUS;
        const dy = (frame.start.y - centreY) / halfHeight;
        const dz = (frame.start.z - parent.position.z) / SEED_RADIUS;
        const outside = Math.sqrt(dx * dx + dy * dy + dz * dz);
        assert.ok(outside <= 1.02, `${id} starts outside the seed coat (${outside.toFixed(3)})`);
        continue;
      }

      const radiusAtJoint =
        parentFrame.startRadius + (parentFrame.endRadius - parentFrame.startRadius) * fraction;
      const radial = distanceToSegment(frame.start, parentFrame.start, parentFrame.animated);
      assert.ok(
        radial <= radiusAtJoint + 0.005,
        `${id} floats ${(radial - radiusAtJoint).toFixed(3)} m off its parent`,
      );
    }
  });

  it('keeps the first stem inside the seed coat but out of its way', () => {
    // The stem must leave the coat (its start is inside the seed body, which is
    // opaque) and then rise clear of it, or the whole first internode - and the
    // leaves and branches attached to it - would be hidden inside the seed.
    const nodes = realSeedling();
    const { byId, frames } = resolveAll(nodes);
    const seed = mustGet(byId, 'seed');
    const stem = mustGet(frames, 'stem');
    const centreY = seed.position.y + SEED_RADIUS * SEED_RATIO;
    assert.ok(
      stem.start.y < centreY + SEED_RADIUS * SEED_RATIO,
      'the stem leaves the seed from inside the coat',
    );
    assert.ok(
      stem.target.y > seed.position.y + SEED_RADIUS * SEED_RATIO + 0.05,
      'the stem rises clear of the seed',
    );
  });

  it('puts a mid-segment branch on the parent axis, not below it', () => {
    // The regression: the branch's attach point is a fraction of the *server's*
    // segment (0.18 -> 0.53). Measuring it against a parent that is drawn from a
    // different start (the coat surface, 0.47) put the branch below every drawn
    // joint. The drawn start and the shipped attach must be the same segment.
    const nodes = realSeedling();
    const { byId, frames } = resolveAll(nodes);
    const stemFrame = mustGet(frames, 'stem');
    assert.ok(
      Math.abs(stemFrame.start.y - (mustGet(byId, 'stem').parentAttachY ?? 0)) < 1e-6,
      'the stem is drawn from its shipped attach point',
    );
    const branch = mustGet(frames, 'branch1');
    const radial = distanceToSegment(branch.start, stemFrame.start, stemFrame.animated);
    const radiusAtJoint =
      stemFrame.startRadius + (stemFrame.endRadius - stemFrame.startRadius) * 0.6;
    assert.ok(radial <= radiusAtJoint + 0.005, `branch radial ${radial.toFixed(3)}`);
  });

  it('pulls a child back onto its parent when the shipped attach point is stale', () => {
    // The server ships an attach point once. A mutation that re-masses the plant,
    // an uproot, or a resync can move the parent under that point afterwards, and
    // the child then started in mid-air beside its own stem - the "unattached
    // part" look. The drawn start is clamped to the parent's drawn body.
    const nodes = realSeedling();
    const { byId, frames } = resolveAll(nodes);
    const stem = mustGet(byId, 'stem');
    const stemFrame = mustGet(frames, 'stem');
    const branch = mustGet(byId, 'branch1');
    const stale = {
      ...branch,
      parentAttachX: (branch.parentAttachX ?? 0) + 3,
      parentAttachY: (branch.parentAttachY ?? 0) + 2,
      parentAttachZ: (branch.parentAttachZ ?? 0) - 2,
    };
    const frame = resolveSegmentFrame(
      stale,
      stem,
      byId.values(),
      stemFrame.animated,
      stemFrame.startRadius,
    );
    const fraction = stale.attachFraction ?? 1;
    const radiusAtJoint =
      stemFrame.startRadius + (stemFrame.endRadius - stemFrame.startRadius) * fraction;
    const radial = distanceToSegment(frame.start, stemFrame.start, stemFrame.animated);
    assert.ok(
      radial <= radiusAtJoint + 0.005,
      `a stale attach left the child ${(radial - radiusAtJoint).toFixed(3)} m off its parent`,
    );
  });
});
