import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allOrganMorphologies,
  ORGAN_MORPHOLOGY,
  ORGAN_STAGE_BOUNDARIES,
  organMorphologyFor,
  organStageFrame,
  organStageIndex,
  organStageLabel,
  organStageName,
  setOrganMorphologyOverrides,
} from './organMorphology.ts';
import type { NodeType } from './types.ts';

const EVERY_NODE_TYPE: NodeType[] = [
  'seed',
  'radicle',
  'root',
  'lateral_root',
  'stem',
  'branch',
  'trunk',
  'rhizome',
  'culm',
  'floating_leaf',
  'pneumatophore',
  'thorn',
  'stolon',
  'tuber',
  'vine',
  'leaf',
  'cotyledon',
  'flower',
  'spore_sac',
];

describe('the organ morphology registry', () => {
  it('describes every node type', () => {
    assert.equal(allOrganMorphologies().length, EVERY_NODE_TYPE.length);
    for (const type of EVERY_NODE_TYPE) {
      assert.equal(ORGAN_MORPHOLOGY[type].type, type);
    }
  });

  it('gives each organ four finite, monotone growth stages', () => {
    for (const morphology of allOrganMorphologies()) {
      assert.equal(morphology.stages.length, 4);
      assert.equal(morphology.stageLabels.length, 4);
      for (let i = 0; i < 4; i += 1) {
        const stage = morphology.stages[i];
        assert.ok(Number.isFinite(stage.length));
        assert.ok(Number.isFinite(stage.width));
        assert.ok(Number.isFinite(stage.detail));
        assert.ok(stage.width > 0);
        if (i > 0) {
          assert.ok(stage.length >= morphology.stages[i - 1].length);
          // A seed husk and a senescing cotyledon lose width at maturity; every
          // other organ only thickens. Shape is allowed to recede where botany
          // says the organ empties or withers.
          if (morphology.type !== 'seed' && morphology.type !== 'cotyledon') {
            assert.ok(stage.width >= morphology.stages[i - 1].width);
          }
          assert.ok(stage.detail >= morphology.stages[i - 1].detail);
        }
        assert.ok(morphology.stageLabels[i].length > 0);
      }
    }
  });

  it('does not collapse distinct organs into one silhouette family', () => {
    assert.equal(ORGAN_MORPHOLOGY.tuber.crossSection, 'lobed');
    assert.equal(ORGAN_MORPHOLOGY.culm.crossSection, 'hollow');
    assert.equal(ORGAN_MORPHOLOGY.floating_leaf.crossSection, 'flattened');
    assert.equal(ORGAN_MORPHOLOGY.rhizome.crossSection, 'ribbed');
    assert.equal(ORGAN_MORPHOLOGY.stem.crossSection, 'ribbed');
    assert.equal(ORGAN_MORPHOLOGY.thorn.crossSection, 'round');
    assert.notEqual(ORGAN_MORPHOLOGY.tuber.visualType, ORGAN_MORPHOLOGY.trunk.visualType);
  });

  it('has a safe fallback for old or unknown node data', () => {
    assert.equal(organMorphologyFor('not_a_node').type, 'stem');
    assert.equal(organMorphologyFor(undefined).type, 'stem');
  });

  it('takes config overrides and ignores malformed entries', () => {
    try {
      setOrganMorphologyOverrides({
        tuber: {
          family: 'storage',
          cross_section: 'ribbed',
          sides: 12,
          taper_exponent: 1.4,
          bend: 0.3,
          tip: 'config eye',
          appendages: ['eyes', 'corky skin'],
          visual_type: 9,
          stage_labels: ['one', 'two', 'three', 'four'],
          stages: [
            [0.2, 0.3, 0.1],
            [0.5, 0.6, 0.4],
            [0.8, 0.9, 0.7],
            [1, 1, 1],
          ],
        },
        not_a_node: { sides: 99 },
        root: { stages: [[0, 0, 0]], family: 'not-a-family', sides: 99, visual_type: -2 },
      });
      const tuber = organMorphologyFor('tuber');
      assert.equal(tuber.crossSection, 'ribbed');
      assert.equal(tuber.sides, 12);
      assert.equal(tuber.taperExponent, 1.4);
      assert.equal(tuber.family, 'storage');
      assert.equal(tuber.tip, 'config eye');
      assert.deepEqual(tuber.appendages, ['eyes', 'corky skin']);
      assert.equal(tuber.visualType, 9);
      assert.deepEqual(tuber.stageLabels, ['one', 'two', 'three', 'four']);
      assert.equal(tuber.stages[0].width, 0.3);
      // A bad stage table leaves the compiled frames in place, not an empty
      // organ; an unknown type is ignored rather than added to the registry.
      assert.deepEqual(organMorphologyFor('root').stages, ORGAN_MORPHOLOGY.root.stages);
      assert.equal(allOrganMorphologies().length, EVERY_NODE_TYPE.length);
    } finally {
      setOrganMorphologyOverrides(undefined);
    }
    assert.equal(organMorphologyFor('tuber').crossSection, 'lobed');
  });
});

describe('organ growth bands', () => {
  it('names the four bands at their boundaries', () => {
    assert.equal(organStageName(0), 'initiation');
    assert.equal(organStageName(0.14), 'initiation');
    assert.equal(organStageName(0.15), 'juvenile');
    assert.equal(organStageName(0.44), 'juvenile');
    assert.equal(organStageName(0.45), 'expansion');
    assert.equal(organStageName(0.79), 'expansion');
    assert.equal(organStageName(0.8), 'mature');
    assert.equal(organStageName(1.5), 'mature');
  });

  it('interpolates continuously and clamps outside 0..1', () => {
    const atStart = organStageFrame('tuber', -1);
    const atEnd = organStageFrame('tuber', 2);
    assert.deepEqual(atStart, ORGAN_MORPHOLOGY.tuber.stages[0]);
    assert.deepEqual(atEnd, ORGAN_MORPHOLOGY.tuber.stages[3]);
    const middle = organStageFrame('tuber', 0.5);
    assert.ok(middle.width > atStart.width && middle.width < atEnd.width);
  });

  it('uses the same 15/45/80 boundaries for frames and labels', () => {
    assert.deepEqual(ORGAN_STAGE_BOUNDARIES, [0, 0.15, 0.45, 0.8, 1]);
    for (const boundary of [0, 0.15, 0.45, 0.8, 1]) {
      const frame = organStageFrame('stem', boundary);
      const expected = ORGAN_MORPHOLOGY.stem.stages[organStageIndex(boundary)];
      assert.deepEqual(frame, expected, `frame at ${boundary} disagrees with its band`);
      assert.equal(
        organStageLabel('stem', boundary),
        ORGAN_MORPHOLOGY.stem.stageLabels[organStageIndex(boundary)],
      );
    }
  });

  it('uses the stage labels a player would recognise', () => {
    assert.equal(organStageLabel('seed', 0.1), 'imbibed');
    assert.equal(organStageLabel('cotyledon', 0.9), 'yellow and shed');
    assert.equal(organStageLabel('spore_sac', 1), 'rupture and release');
    assert.equal(organStageIndex(0.5), 2);
  });
});
