import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_JOINT_FLARE_RATIO, setGrowthGeometryTunables } from '@plant-legacy/shared/growth';
import * as THREE from 'three';
import { type MutationLook, type MutationLookStack, NEUTRAL_STACK } from '../plant/mutations.ts';
import type { PlantNodeData } from '../plant/plantNodeData.ts';
import {
  buildPlantMesh,
  CHAIN_MAX_SAMPLES,
  CHAIN_MIN_SAMPLES,
  chainSampleCount,
  chainSampleFractions,
  measureDrawnPlant,
  resolveSegmentFrame,
  segmentControlPoint,
} from './PlantMeshBuilder.ts';

const FLOATS_PER_VERTEX = 19;

function node(
  overrides: Partial<PlantNodeData> & Pick<PlantNodeData, 'id' | 'position'>,
): PlantNodeData {
  return {
    type: 1,
    radius: 0.1,
    parentId: null,
    age: 0,
    health: 1,
    mutationFlags: 0,
    biomass: 1,
    growthProgress: 1,
    isOwnPlant: true,
    ...overrides,
  };
}

describe('plant mesh builder selected-node geometry', () => {
  it('keeps every index inside the vertex buffer and draws no selection marker', () => {
    const nodes: PlantNodeData[] = [
      node({
        id: 'seed',
        parentId: null,
        position: new THREE.Vector3(0, 0.4, 0),
        radius: 0.2,
        type: 0,
        nodeType: 'seed',
        isSeed: true,
        children: ['root'],
      }),
      node({
        id: 'root',
        parentId: 'seed',
        position: new THREE.Vector3(0.1, 0.1, 0),
        nodeType: 'root',
        layer: 'root',
        children: [],
      }),
    ];

    const built = buildPlantMesh(nodes, {
      leafSize: 0.2,
      leafCountPerNode: 1,
      tubeSides: 8,
      rootSides: 8,
      now: 1000,
      sunDirection: new THREE.Vector3(0, 1, 0),
    });

    const vertexCount = built.vertices.length / FLOATS_PER_VERTEX;
    assert.ok(vertexCount > 0);
    // No selection marker geometry is added; the old marker is what produced
    // the rainbow cone.
    for (let i = 0; i < built.indices.length; i += 1) {
      assert.ok(
        built.indices[i] < vertexCount,
        `index ${i} (${built.indices[i]}) points past ${vertexCount} vertices`,
      );
    }
  });

  it('builds the same mesh whether or not a node is selected', () => {
    const nodes: PlantNodeData[] = [
      node({
        id: 'seed',
        position: new THREE.Vector3(0, 0.4, 0),
        radius: 0.2,
        type: 0,
        nodeType: 'seed',
        isSeed: true,
        children: [],
      }),
    ];
    const built = buildPlantMesh(nodes, {
      leafSize: 0.2,
      leafCountPerNode: 1,
      tubeSides: 8,
      rootSides: 8,
      now: 1000,
      sunDirection: new THREE.Vector3(0, 1, 0),
    });
    assert.ok(built.indices.length > 0);
  });
});

describe('plant mesh builder mutation geometry', () => {
  /** A seedling with a stem, so there is a woody tube to thicken and bristle. */
  function stemNodes(): PlantNodeData[] {
    return [
      node({
        id: 'seed',
        parentId: null,
        position: new THREE.Vector3(0, 0.4, 0),
        radius: 0.12,
        type: 0,
        nodeType: 'seed',
        isSeed: true,
        children: ['stem'],
      }),
      node({
        id: 'stem',
        parentId: 'seed',
        position: new THREE.Vector3(0.02, 1.2, 0),
        radius: 0.06,
        nodeType: 'stem',
        layer: 'canopy',
        children: [],
      }),
    ];
  }

  const options = {
    leafSize: 0.2,
    leafCountPerNode: 1,
    tubeSides: 8,
    rootSides: 8,
    now: 1000,
    sunDirection: new THREE.Vector3(0, 1, 0),
  };

  const neutral: MutationLookStack = {
    ...NEUTRAL_STACK,
    looks: { ...NEUTRAL_STACK.looks },
    disc: NEUTRAL_STACK.disc,
  };

  function stackWith(woody: Partial<MutationLook>): MutationLookStack {
    return {
      ...neutral,
      looks: { ...neutral.looks, woody: { ...neutral.looks.woody, ...woody } },
    };
  }

  it('thickens woody tubes when bark is the look', () => {
    const plain = buildPlantMesh(stemNodes(), options);
    const thick = buildPlantMesh(stemNodes(), {
      ...options,
      lookForPlant: () => stackWith({ barkScale: 1.5 }),
    });
    // Same topology, wider tube: the radius is baked into positions, so the
    // bounds grow even though the vertex count does not.
    assert.equal(thick.vertices.length, plain.vertices.length);
    let plainMax = 0;
    let thickMax = 0;
    for (let i = 0; i < plain.vertices.length; i += FLOATS_PER_VERTEX) {
      plainMax = Math.max(plainMax, Math.abs(plain.vertices[i]));
      thickMax = Math.max(thickMax, Math.abs(thick.vertices[i]));
    }
    assert.ok(thickMax > plainMax, `bark should widen the tube (${plainMax} -> ${thickMax})`);
  });

  it('adds thorn geometry when the look bristles', () => {
    const plain = buildPlantMesh(stemNodes(), options);
    const spiny = buildPlantMesh(stemNodes(), {
      ...options,
      lookForPlant: () => stackWith({ spines: 1 }),
    });
    assert.ok(
      spiny.indices.length > plain.indices.length,
      'spines have to be real geometry, not a tint',
    );
    const vertexCount = spiny.vertices.length / FLOATS_PER_VERTEX;
    for (const index of spiny.indices) {
      assert.ok(index < vertexCount, 'spine indices stay inside the buffer');
    }
  });

  it('returns one composed look per plant, aligned with plant data', () => {
    const stack = stackWith({ barkScale: 1.4 });
    const built = buildPlantMesh(stemNodes(), {
      ...options,
      lookForPlant: () => stack,
    });
    assert.equal(built.plantData.length, 1);
    assert.equal(built.plantLooks.length, built.plantData.length);
    assert.equal(built.plantLooks[0].looks.woody.barkScale, 1.4);
  });
});

describe('plant mesh builder junction geometry', () => {
  /**
   * A trunk with a branch, a sub-branch and a leaf.
   *
   * The junction rules are the 3D form of the title screen's root rules: a limb
   * leaves as a knuckle a little wider than its own shank, capped by the trunk
   * that carries it, and it leaves along the trunk's own direction instead of
   * meeting it at an angle. Both used to be wrong - the base was the parent's
   * full radius, so a branch was a cone 2.65x its own thickness.
   */
  function forkedPlant(): PlantNodeData[] {
    return [
      node({
        id: 'seed',
        parentId: null,
        position: new THREE.Vector3(0, 0.4, 0),
        radius: 0.075,
        type: 0,
        nodeType: 'seed',
        isSeed: true,
        children: ['trunk'],
      }),
      node({
        id: 'trunk',
        parentId: 'seed',
        position: new THREE.Vector3(0.01, 0.9, 0),
        radius: 0.045,
        nodeType: 'stem',
        children: ['trunk2'],
      }),
      node({
        id: 'trunk2',
        parentId: 'trunk',
        position: new THREE.Vector3(0.02, 1.35, 0),
        radius: 0.04,
        nodeType: 'stem',
        children: ['branch'],
      }),
      node({
        id: 'branch',
        parentId: 'trunk2',
        position: new THREE.Vector3(0.32, 1.55, 0.02),
        radius: 0.017,
        nodeType: 'branch',
        attachFraction: 0.6,
        parentAttachX: 0.014,
        parentAttachY: 1.17,
        parentAttachZ: 0,
        children: ['twig'],
      }),
      node({
        id: 'twig',
        parentId: 'branch',
        position: new THREE.Vector3(0.55, 1.7, 0.03),
        radius: 0.012,
        nodeType: 'branch',
        children: ['leaf'],
      }),
      node({
        id: 'leaf',
        parentId: 'twig',
        position: new THREE.Vector3(0.7, 1.82, 0.03),
        radius: 0.008,
        type: 3,
        nodeType: 'leaf',
        layer: 'canopy',
        children: [],
      }),
    ];
  }

  it('draws a woody junction as a knuckle, never as a cone of the parent', () => {
    const metrics = measureDrawnPlant(forkedPlant());
    assert.ok(
      metrics.maxJointToShankRatio > 1,
      'a junction should still be wider than its own shank',
    );
    assert.ok(
      metrics.maxJointToShankRatio <= DEFAULT_JOINT_FLARE_RATIO + 1e-6,
      `junction drew ${metrics.maxJointToShankRatio.toFixed(2)}x its shank; the rule caps it at ${DEFAULT_JOINT_FLARE_RATIO}`,
    );
  });

  it('leaves a soft organ the width of its own shank', () => {
    const nodes = forkedPlant();
    const twig = nodes.find((n) => n.id === 'twig');
    const leaf = nodes.find((n) => n.id === 'leaf');
    assert.ok(twig && leaf);
    const frame = resolveSegmentFrame(leaf, twig, nodes);
    assert.equal(frame.startRadius, frame.endRadius);
  });

  it('never meets a joint at the angle of the straight chords it joins', () => {
    const metrics = measureDrawnPlant(forkedPlant());
    assert.ok(
      metrics.maxAngleDiscontinuityDeg > 25,
      'the fixture must be a real fork, not a straight chain',
    );
    assert.ok(
      metrics.maxTangentKinkDeg < metrics.maxAngleDiscontinuityDeg * 0.75,
      `the drawn curve turns ${metrics.maxTangentKinkDeg.toFixed(1)} degrees at a joint, the chords ${metrics.maxAngleDiscontinuityDeg.toFixed(1)}`,
    );
  });

  it('leaves a continuation along its parent and a fork only part of the way', () => {
    // One parent ending straight up, and three children: a continuation, a
    // slight bend, and a wide fork. The continuation must be C1 - leaving along
    // any other direction makes every node in a chain a visible kink - and the
    // wide fork must turn by no more than about half the angle it forked,
    // otherwise its start tangent points along the trunk and the branch hooks.
    const parentEnd = new THREE.Vector3(0.02, 0.4, 0);
    const parent = {
      position: parentEnd,
      control: new THREE.Vector3(0.01, 0.2, 0),
    };
    const arrival = parentEnd.clone().sub(parent.control).normalize();
    const startKinkDeg = (target: THREE.Vector3, withParent: boolean): number => {
      const child = node({ id: 'child', position: new THREE.Vector3() });
      const control = segmentControlPoint(
        child,
        parentEnd,
        target,
        withParent ? parent : undefined,
      );
      const outgoing = control.clone().sub(parentEnd).normalize();
      return (Math.acos(Math.min(1, Math.max(-1, outgoing.dot(arrival)))) * 180) / Math.PI;
    };

    const straight = parentEnd.clone().addScaledVector(arrival, 0.3);
    assert.ok(startKinkDeg(straight, true) < 3, 'a continuation leaves along its parent');

    const slight = straight.clone().add(new THREE.Vector3(0.05, 0, 0));
    assert.ok(
      startKinkDeg(slight, true) < startKinkDeg(slight, false) / 2,
      'knowing the parent halves the turn even on a slight bend',
    );

    const wide = parentEnd.clone().add(new THREE.Vector3(0.3, 0.05, 0));
    const forkAngle =
      (Math.acos(Math.min(1, Math.max(-1, wide.clone().sub(parentEnd).normalize().dot(arrival)))) *
        180) /
      Math.PI;
    assert.ok(
      startKinkDeg(wide, true) < forkAngle * 0.55,
      'a wide fork bends by about half its fork angle, not by the whole of it',
    );
  });

  it('honours the configured flare instead of the compiled default', () => {
    try {
      setGrowthGeometryTunables({ jointFlareRatio: 1.5 });
      const metrics = measureDrawnPlant(forkedPlant());
      assert.equal(Math.round(metrics.maxJointToShankRatio * 100) / 100, 1.5);
    } finally {
      setGrowthGeometryTunables();
    }
  });
});

describe('plant mesh builder chain sampling', () => {
  it('gives a short segment more rings when it bends', () => {
    // Length alone would floor a 10 cm segment at the minimum, so the bend has
    // to be what lifts it - a strongly curved twig needs the rings.
    const straight = chainSampleCount(0.1, 0);
    const bent = chainSampleCount(0.1, 0.5);
    assert.equal(straight, CHAIN_MIN_SAMPLES);
    assert.ok(bent > straight, `a bent twig got ${bent} rings, a straight one ${straight}`);
  });

  it('gives a longer segment more rings and never runs away', () => {
    assert.ok(chainSampleCount(0.6, 0) > chainSampleCount(0.12, 0));
    assert.equal(chainSampleCount(50, 0), CHAIN_MAX_SAMPLES);
    assert.equal(chainSampleCount(1, 90), CHAIN_MAX_SAMPLES);
  });

  it('answers with a usable count when a caller has no length or bend', () => {
    assert.equal(chainSampleCount(0, Number.NaN), CHAIN_MIN_SAMPLES);
    assert.equal(chainSampleCount(Number.NaN, 0), CHAIN_MIN_SAMPLES);
    assert.equal(chainSampleCount(0.2, 0, Number.NaN, Number.NaN), CHAIN_MIN_SAMPLES);
  });

  it('keeps the sag off the curve inside the configured tolerance', () => {
    // Every count it returns must draw the curve within tolerance, or the count
    // is not doing the job the tolerance was given.
    const tolerance = 0.0015;
    for (const bend of [0.01, 0.05, 0.2, 0.5]) {
      const count = chainSampleCount(1.2, bend, 0.05, tolerance);
      const sag = bend / (8 * count * count);
      assert.ok(sag <= tolerance, `bend ${bend} with ${count} rings sags ${sag}`);
    }
  });

  it('puts the rings where the neck is, and keeps both ends exact', () => {
    const fractions = chainSampleFractions(8);
    assert.equal(fractions[0], 0);
    assert.equal(fractions[fractions.length - 1], 1);
    for (let i = 1; i < fractions.length; i += 1) {
      assert.ok(fractions[i] > fractions[i - 1], `fractions not increasing at ${i}`);
    }
    // Half the rings belong to the first ~30% of the segment, where the radius
    // rule finishes most of its necking.
    const half = fractions[Math.floor(fractions.length / 2)];
    assert.ok(half < 0.35, `half the rings cover ${half.toFixed(2)} of the segment`);
    assert.ok(half > 0.1, 'the rings must not all crowd the joint either');
  });

  it('falls back to even spacing when the taper is a straight cone', () => {
    const fractions = chainSampleFractions(4, 1);
    assert.deepEqual(
      fractions.map((t) => Math.round(t * 100) / 100),
      [0, 0.25, 0.5, 0.75, 1],
    );
  });

  it('draws more rings than the old fixed spacing did on a real internode', () => {
    // A 12 cm internode was given four rings: ceil(0.12 / 0.05) = 3, clamped up
    // to 4. With the flare at the joint that draws the neck as three facets.
    const oldCount = Math.max(4, Math.min(12, Math.ceil(0.12 / 0.05)));
    assert.equal(oldCount, 4);
    const now = chainSampleCount(0.12, 0.08);
    assert.ok(now > oldCount, `short internode now gets ${now} rings`);
    // And the rings land where the neck is, not evenly.
    const fractions = chainSampleFractions(now);
    assert.ok(fractions[2] < 0.2, `third ring sits at ${fractions[2].toFixed(2)}`);
  });
});
