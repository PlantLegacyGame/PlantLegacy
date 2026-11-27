import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ORGAN_DISPLAY_ORDER, organMorphologyFor } from '@plant-legacy/shared/growth';
import { allOrganMeshSpecs, organMeshSpecFor } from './organMeshSpec.ts';
import {
  buildTubeGeometry,
  clearTubeGeometryCache,
  MAX_TUBE_CACHE,
  tubeGeometryCacheSize,
} from './tubeShape.ts';

describe('the organ mesh spec', () => {
  it('covers all 19 organs and carries every morphology field', () => {
    const specs = allOrganMeshSpecs();
    assert.equal(specs.length, 19);
    assert.deepEqual(
      specs.map((spec) => spec.nodeType),
      [...ORGAN_DISPLAY_ORDER],
    );
    for (const spec of specs) {
      const morphology = organMorphologyFor(spec.nodeType);
      assert.equal(spec.sides, morphology.sides, `${spec.nodeType} lost its sides`);
      assert.equal(spec.crossSection, morphology.crossSection);
      assert.equal(spec.tip, morphology.tip);
      assert.deepEqual(spec.appendages, morphology.appendages);
      assert.equal(spec.stageLabels.length, 4);
      assert.ok(spec.tipShape.length > 0);
    }
  });

  it('joins the root, soft and woody roles to the morphology', () => {
    assert.equal(organMeshSpecFor('rhizome').root, true);
    assert.equal(organMeshSpecFor('tuber').root, true);
    assert.equal(organMeshSpecFor('pneumatophore').root, true);
    assert.equal(organMeshSpecFor('flower').soft, true);
    assert.equal(organMeshSpecFor('trunk').woody, true);
    assert.equal(organMeshSpecFor('floating_leaf').tipShape, 'notch');
    assert.equal(organMeshSpecFor('spore_sac').tipShape, 'operculum');
    assert.equal(organMeshSpecFor('root').tipShape, 'cap');
    assert.equal(organMeshSpecFor('flower').has('stigma'), true);
  });
});

describe('the shared tube cache', () => {
  it('uses morphology sides and cross-section in its key', () => {
    clearTubeGeometryCache();
    const quality = { tubeRadialSegments: 8, tubeLengthSegments: 3 };
    const round = buildTubeGeometry(0.1, 0.1, 1, quality);
    const ribbed = buildTubeGeometry(0.1, 0.1, 1, {
      ...quality,
      tubeSides: 6,
      tubeCrossSection: 'ribbed',
    });
    assert.notEqual(round, ribbed);
    assert.equal(buildTubeGeometry(0.1, 0.1, 1, quality), round);
    clearTubeGeometryCache();
  });

  it('caps the number of shared tubes', () => {
    clearTubeGeometryCache();
    const quality = { tubeRadialSegments: 6, tubeLengthSegments: 2 };
    for (let i = 0; i < MAX_TUBE_CACHE + 8; i += 1) {
      buildTubeGeometry(0.1 + i * 0.002, 0.1, 1, quality);
    }
    assert.equal(tubeGeometryCacheSize(), MAX_TUBE_CACHE);
    clearTubeGeometryCache();
  });
});
