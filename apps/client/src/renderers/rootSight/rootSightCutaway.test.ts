import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import type { PlantNodeData } from '../plant/plantNodeData.js';
import { plantExtent, plantLateralExtent, resolveCutawayRadius } from './rootSightCutaway.ts';

function node(
  id: string,
  type: number,
  position: { x: number; y: number; z: number },
  overrides: Partial<PlantNodeData> = {},
): PlantNodeData {
  return {
    id,
    type,
    position: new THREE.Vector3(position.x, position.y, position.z),
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

describe('root sight cutaway sizing', () => {
  it('ignores canopy growth when sizing the root cavity', () => {
    const seed = node('seed', 4, { x: 0, y: 0, z: 0 });
    const roots = [node('r1', 0, { x: 2, y: -1, z: 0 }, { parentId: 'seed' })];
    const canopy = [
      node('s1', 1, { x: 0, y: 8, z: 0 }, { parentId: 'seed' }),
      node('l1', 3, { x: 4, y: 12, z: 0 }, { parentId: 's1' }),
    ];

    const rootOnly = plantExtent([seed, ...roots]);
    const withCanopy = plantExtent([seed, ...roots, ...canopy]);
    assert.ok(Math.abs(withCanopy - rootOnly) < 1e-9);
    assert.ok(withCanopy < 3, `canopy widened the root extent to ${withCanopy}`);
  });

  it('measures the mouth from lateral spread, not from root depth', () => {
    // A taproot 1.7 m down and 0.1 m across: the cavity wants the 3D reach, but
    // the hole in the ground is a circle in plan and must hug the spread.
    const seed = node('seed', 4, { x: 0, y: 0, z: 0 });
    const deep = node('r1', 0, { x: 0.1, y: -1.7, z: 0 }, { parentId: 'seed' });
    const lateral = plantLateralExtent([seed, deep]);
    assert.ok(Math.abs(lateral - (0.1 + 0.1)) < 1e-9, `lateral ${lateral}`);
    assert.ok(plantExtent([seed, deep]) > 1.7, 'the cavity still gets the 3D reach');
  });

  it('reports the seed only when there are no underground parts yet', () => {
    assert.equal(plantExtent([node('seed', 4, { x: 0, y: 0, z: 0 })]), 0.05);
  });

  it('grows with the farthest root tip, not the node count', () => {
    const seed = node('seed', 4, { x: 0, y: 0, z: 0 });
    const near = [
      node('a', 0, { x: 1, y: -0.5, z: 0 }, { parentId: 'seed' }),
      node('b', 0, { x: 0, y: -0.5, z: 1 }, { parentId: 'seed' }),
      node('c', 0, { x: -1, y: -0.5, z: 0 }, { parentId: 'seed' }),
    ];
    const far = node('d', 0, { x: 0, y: -0.5, z: 3 }, { parentId: 'seed' });
    const nearExtent = plantExtent([seed, ...near]);
    const farExtent = plantExtent([seed, ...near, far]);
    assert.ok(farExtent > nearExtent);
    assert.ok(Math.abs(farExtent - (Math.hypot(0, -0.5, 3) + 0.1)) < 1e-9);
  });

  it('does not open for a node until it has actually grown', () => {
    const seed = node('seed', 4, { x: 0, y: 0, z: 0 });
    const starting = node(
      'new-root',
      0,
      { x: 0, y: -4, z: 0 },
      { parentId: 'seed', growthProgress: 0 },
    );
    const half = { ...starting, growthProgress: 0.5 };
    const done = { ...starting, growthProgress: 1 };
    assert.equal(plantExtent([seed, starting]), 0.05);
    assert.ok(plantExtent([seed, half]) < plantExtent([seed, done]));
  });

  it('stays small while opening and respects the configured cap', () => {
    assert.equal(resolveCutawayRadius(0.05, 0, 7), 7);
    assert.equal(resolveCutawayRadius(0.05, 1, 7), 0.7);
    assert.equal(resolveCutawayRadius(10, 1, 7), 7);
    assert.ok(resolveCutawayRadius(2, 1, 7) < 3.5);
  });
});

describe('the pit is sized from the roots that are in the soil', () => {
  const seed = node('seed', 4, { x: 0, y: 0, z: 0 });
  const buried = node('r1', 0, { x: 1, y: -1, z: 0 }, { parentId: 'seed' });
  // A root by type, in the air: crossing an open tunnel, or lying on the surface.
  const inAir = node('r2', 0, { x: 9, y: 6, z: 0 }, { parentId: 'seed' });
  const inSoil = (candidate: PlantNodeData): boolean => candidate.id !== 'r2';

  it('ignores a root that is above the soil', () => {
    // The node type says root; only the height frame says buried. A tip in the
    // air has no soil to open, and sizing the hole from it widened the pit for a
    // root the player could see.
    const withAir = plantExtent([seed, buried, inAir], undefined, inSoil);
    const soilOnly = plantExtent([seed, buried]);
    assert.ok(Math.abs(withAir - soilOnly) < 1e-9, 'the airborne root still widened the cavity');
    assert.ok(
      plantLateralExtent([seed, buried, inAir], undefined, inSoil) <
        plantLateralExtent([seed, buried, inAir]),
    );
    // Without the test it still counts, so the test is what makes the difference.
    assert.ok(plantExtent([seed, buried, inAir]) > soilOnly);
  });

  it('falls back to every underground part when the test rejects them all', () => {
    // A wrong height frame must not pin the pit at its minimum: the same rescue
    // the cavity envelope makes.
    const none = plantExtent([seed, buried], undefined, () => false);
    assert.ok(Math.abs(none - plantExtent([seed, buried])) < 1e-9);
  });
});

describe('the soil test reaches both extents', () => {
  it('sizes the cavity and the mouth with the same predicate', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'main.ts'),
      'utf8',
    );
    assert.match(
      source,
      /plantExtent\(plantNodes\.values\(\), rootSightConfig, atOrBelowTheSoil\)/,
    );
    assert.match(
      source,
      /plantLateralExtent\(plantNodes\.values\(\), rootSightConfig, atOrBelowTheSoil\)/,
    );
  });
});
