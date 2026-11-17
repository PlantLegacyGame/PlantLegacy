import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canCrossLayer,
  clampGrowthDirectionByGene,
  type GrowthConfig,
  getAvailableGrowthTypes,
  getLayerForNodeType,
  getNodeTypeDefinition,
  NODE_GROWTH_CONSTRAINTS,
  type NodeTypeDefinition,
} from './index.ts';

function def(id: string): NodeTypeDefinition {
  return {
    id,
    biomassCost: 1,
    resourceDrawWater: 0,
    resourceDrawNutrients: 0,
    resourceDrawMinerals: 0,
    upkeepBiomassPerSecond: 0,
    statModifiers: {},
    growthDirectionBias: 'upward',
    growthTimeSeconds: 1,
    segmentLength: 0.1,
  } as unknown as NodeTypeDefinition;
}

const config = {
  trunkNode: def('trunk'),
  rhizomeNode: def('rhizome'),
  culmNode: def('culm'),
  floatingLeafNode: def('floating_leaf'),
  pneumatophoreNode: def('pneumatophore'),
  thornNode: def('thorn'),
  stolonNode: def('stolon'),
  tuberNode: def('tuber'),
} as unknown as GrowthConfig;

describe('new growth types', () => {
  it('puts rhizomes underground and the three shoots above', () => {
    assert.equal(getLayerForNodeType('rhizome'), 'root');
    assert.equal(getLayerForNodeType('trunk'), 'canopy');
    assert.equal(getLayerForNodeType('culm'), 'canopy');
    assert.equal(getLayerForNodeType('floating_leaf'), 'canopy');
  });

  it('keeps breathing roots and tubers underground and runners above', () => {
    assert.equal(getLayerForNodeType('pneumatophore'), 'root');
    assert.equal(getLayerForNodeType('thorn'), 'canopy');
    assert.equal(getLayerForNodeType('tuber'), 'root');
    assert.equal(getLayerForNodeType('stolon'), 'canopy');
  });

  it('lets a stolon root at a node and raise a shoot there', () => {
    assert.equal(canCrossLayer('stolon', 'root'), true, 'runners root at their nodes');
    assert.equal(canCrossLayer('branch', 'root'), false, 'ordinary branches do not root');
    const offered = getAvailableGrowthTypes('stolon', config);
    assert.ok(offered.includes('root'), 'a rooted node can start a root');
    assert.ok(offered.includes('stem'), 'a rooted node can raise a shoot');
    assert.ok(offered.includes('stolon'), 'a runner can keep running');
    // Eyes of a tuber are buds: a tuber may raise a shoot of its own.
    assert.ok(getAvailableGrowthTypes('tuber', config).includes('stem'));
  });

  it('lets a breathing root surface into a shoot like any other root crown', () => {
    assert.equal(canCrossLayer('pneumatophore', 'stem'), true);
    assert.ok(getAvailableGrowthTypes('pneumatophore', config).includes('stem'));
    assert.ok(getAvailableGrowthTypes('pneumatophore', config).includes('pneumatophore'));
  });

  it('resolves the new definitions and keeps thorns out of base menus', () => {
    assert.equal(getNodeTypeDefinition(config, 'pneumatophore'), config.pneumatophoreNode);
    assert.equal(getNodeTypeDefinition(config, 'thorn'), config.thornNode);
    assert.equal(getNodeTypeDefinition(config, 'stolon'), config.stolonNode);
    assert.equal(getNodeTypeDefinition(config, 'tuber'), config.tuberNode);
    for (const parent of ['stem', 'branch', 'trunk', 'culm', 'root'] as const) {
      assert.ok(!getAvailableGrowthTypes(parent, config).includes('thorn'));
      assert.ok(!getAvailableGrowthTypes(parent, config).includes('pneumatophore'));
      assert.ok(!getAvailableGrowthTypes(parent, config).includes('stolon'));
      assert.ok(!getAvailableGrowthTypes(parent, config).includes('tuber'));
    }
  });

  it('clamps a straight-up intent into the sector, including the horizontal share', () => {
    for (const type of [
      'radicle',
      'root',
      'stem',
      'rhizome',
      'floating_leaf',
      'leaf',
      'pneumatophore',
      'thorn',
      'stolon',
      'tuber',
    ] as const) {
      const clamped = clampGrowthDirectionByGene(type, {
        x: 0,
        y: type === 'radicle' ? 1 : 1,
        z: 0,
      });
      const constraints = NODE_GROWTH_CONSTRAINTS[type];
      const horizontal = Math.hypot(clamped.x, clamped.z);
      assert.ok(
        clamped.y >= constraints.minY - 1e-3 && clamped.y <= constraints.maxY + 1e-3,
        `${type} y ${clamped.y} inside [${constraints.minY}, ${constraints.maxY}]`,
      );
      assert.ok(
        horizontal >= constraints.minHorizontal - 1e-3 &&
          horizontal <= constraints.maxHorizontal + 1e-3,
        `${type} horizontal ${horizontal} inside [${constraints.minHorizontal}, ${constraints.maxHorizontal}]`,
      );
    }
  });

  it('keeps mutation-only tissues out of the base growth menu', () => {
    for (const parent of ['stem', 'branch', 'vine', 'root', 'radicle', 'lateral_root'] as const) {
      const offered = getAvailableGrowthTypes(parent, config);
      assert.ok(!offered.includes('trunk'), `${parent} must not offer trunk by default`);
      assert.ok(!offered.includes('culm'), `${parent} must not offer culm by default`);
      assert.ok(!offered.includes('rhizome'), `${parent} must not offer rhizome by default`);
      assert.ok(
        !offered.includes('floating_leaf'),
        `${parent} must not offer floating_leaf by default`,
      );
    }
  });

  it('lets an unlocked tissue continue once it exists', () => {
    assert.deepEqual(getAvailableGrowthTypes('rhizome', config), [
      'rhizome',
      'lateral_root',
      'stem',
      // A runner leaves the rhizome and travels under the surface. Without this
      // the `stolon` organ was unlockable and un-growable.
      'stolon',
    ]);
    assert.ok(getAvailableGrowthTypes('trunk', config).includes('branch'));
    assert.ok(getAvailableGrowthTypes('culm', config).includes('culm'));
  });

  it('lets a rhizome surface into the canopy', () => {
    assert.equal(canCrossLayer('rhizome', 'stem'), true);
    assert.equal(canCrossLayer('rhizome', 'rhizome'), true);
    // Canopy tissue never descends into the root layer.
    assert.equal(canCrossLayer('stem', 'root'), false);
  });

  it('resolves each new definition from config', () => {
    assert.equal(getNodeTypeDefinition(config, 'trunk'), config.trunkNode);
    assert.equal(getNodeTypeDefinition(config, 'rhizome'), config.rhizomeNode);
    assert.equal(getNodeTypeDefinition(config, 'culm'), config.culmNode);
    assert.equal(getNodeTypeDefinition(config, 'floating_leaf'), config.floatingLeafNode);
  });

  it('keeps rhizomes shallow and pads flat', () => {
    const rhizome = clampGrowthDirectionByGene('rhizome', { x: 0, y: -1, z: 0 });
    assert.ok(rhizome.y >= NODE_GROWTH_CONSTRAINTS.rhizome.minY);
    const pad = clampGrowthDirectionByGene('floating_leaf', { x: 0, y: 1, z: 0 });
    assert.ok(pad.y <= NODE_GROWTH_CONSTRAINTS.floating_leaf.maxY);
  });
});
