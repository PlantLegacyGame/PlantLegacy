import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyCare,
  CARE_STAGES,
  careStage,
  emptyCare,
  POINTS_PER_STAGE,
  reachedTreasures,
  TREASURE_ASPECT,
  TREASURE_MAX_HEIGHT,
  TREASURES,
  treasureArt,
  treasureHeightPercent,
} from './treasures.ts';

test('stages start at a seed and never run past the last find', () => {
  assert.equal(careStage(0), 0);
  assert.equal(careStage(POINTS_PER_STAGE - 1), 0, 'half a stage is still a seed');
  assert.equal(careStage(POINTS_PER_STAGE), 1, 'a sprout');
  assert.equal(careStage(POINTS_PER_STAGE * 2), 2, 'a young plant, and its first root run');
  assert.equal(careStage(999), CARE_STAGES - 1);
  assert.equal(careStage(-5), 0);
  assert.equal(CARE_STAGES, TREASURES.length + 2);
  assert.equal(POINTS_PER_STAGE, 2, 'a stage costs two props');
});

test('care is not rationed: every action counts', () => {
  let care = emptyCare();
  for (let i = 1; i <= 40; i += 1) {
    care = applyCare(care, i % 2 ? 'water' : 'feed');
    assert.equal(care.points, i);
  }
  // Feeding and watering are interchangeable, and neither is ever refused.
  assert.equal(applyCare(care, 'water').points, 41);
});

test('a seed and a sprout reach nothing, then one find per stage', () => {
  assert.deepEqual(reachedTreasures(0), []);
  assert.deepEqual(reachedTreasures(POINTS_PER_STAGE * 2 - 1), []);
  const first = reachedTreasures(POINTS_PER_STAGE * 2);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.id, 'worm');
  const full = POINTS_PER_STAGE * CARE_STAGES;
  assert.equal(reachedTreasures(full).length, TREASURES.length);
  assert.equal(reachedTreasures(999).length, TREASURES.length);
});

test('the buried pieces never overlap each other', () => {
  // The overlap bug came from placing by width alone: the ground is wider than it
  // is tall, so a 7.5% wide chest is 22% of the band's height. Checked at three
  // pane shapes, because the aspect of the ground changes with the window.
  for (const stageAspect of [2.2, 3.3, 4.6]) {
    const boxes = TREASURES.map((t) => {
      // The CSS caps a piece's width in vh, which caps its height here at about
      // 20% of the band whatever the pane's shape.
      const h = Math.min(treasureHeightPercent(t.width, stageAspect), TREASURE_MAX_HEIGHT);
      return {
        id: t.id,
        left: t.x - t.width / 2,
        right: t.x + t.width / 2,
        top: t.y,
        bottom: t.y + h,
      };
    });
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        assert.ok(
          overlapX <= 0 || overlapY <= 0,
          `${a.id} and ${b.id} overlap at aspect ${stageAspect}`,
        );
      }
    }
  }
});

test('every piece stays inside the ground, tilted, and has its own art', () => {
  const arts = new Set<string>();
  for (const treasure of TREASURES) {
    const h = Math.min(treasureHeightPercent(treasure.width), TREASURE_MAX_HEIGHT);
    assert.ok(treasure.y >= 0 && treasure.y + h <= 101, `${treasure.id} is cut off`);
    assert.ok(treasure.x - treasure.width / 2 >= 0, `${treasure.id} runs off the left`);
    assert.ok(treasure.x + treasure.width / 2 <= 100, `${treasure.id} runs off the right`);
    assert.ok(Math.abs(treasure.tilt) > 2, `${treasure.id} is not tilted`);
    arts.add(treasureArt(treasure.kind));
  }
  assert.equal(arts.size, TREASURES.length, 'two pieces share art');
  assert.ok(TREASURE_ASPECT > 0.5 && TREASURE_ASPECT < 1);
});
