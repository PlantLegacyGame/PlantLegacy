import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hoverTipPosition, partLabel, plantHoverText } from './PlantHoverTip.ts';

test("a part is named in the game's words, never as an id", () => {
  assert.equal(partLabel('stem'), 'Stem');
  assert.equal(partLabel('lateral_root'), 'Lateral root');
  assert.equal(partLabel(''), 'Part');
  assert.equal(partLabel('  '), 'Part');
});

test('in grow mode a click is the action the player is being taught', () => {
  assert.deepEqual(
    plantHoverText({ nodeType: 'stem', isOwnPlant: true, growMode: true, canGrow: true }),
    { title: 'Stem', action: 'Click to see what it can grow' },
  );
});

test('out of grow mode the tip names the key that changes that', () => {
  assert.deepEqual(
    plantHoverText({ nodeType: 'leaf', isOwnPlant: true, growMode: false, canGrow: true }),
    { title: 'Leaf', action: 'G \u2014 grow mode' },
  );
});

test('a part that cannot grow does not promise growth', () => {
  assert.deepEqual(
    plantHoverText({ nodeType: 'root', isOwnPlant: true, growMode: true, canGrow: false }),
    { title: 'Root', action: 'Nothing can grow from here yet' },
  );
});

test('another plant is a look, in both modes', () => {
  for (const growMode of [true, false]) {
    assert.deepEqual(
      plantHoverText({ nodeType: 'stem', isOwnPlant: false, growMode, canGrow: true }),
      { title: 'Another plant', action: 'Click to look' },
    );
  }
});

test('the tip follows the pointer and flips before it leaves the viewport', () => {
  const roomy = hoverTipPosition(100, 100, 120, 40, 1280, 800);
  assert.deepEqual(roomy, { left: 112, top: 112 });
  // Near the right edge it moves to the pointer's left.
  const rightEdge = hoverTipPosition(1250, 100, 120, 40, 1280, 800);
  assert.ok(rightEdge.left + 120 <= 1280 - 12, 'the tip stays inside the viewport');
  assert.ok(rightEdge.left < 1250, "the tip is on the pointer's other side");
  // Near the bottom it moves above the pointer.
  const bottom = hoverTipPosition(100, 790, 120, 40, 1280, 800);
  assert.ok(bottom.top + 40 <= 800 - 12);
  assert.ok(bottom.top < 790);
  // A viewport that cannot hold the tip still keeps it at the margin, never at a
  // negative offset. The tip is 400 wide against a 320 viewport, so the x axis
  // clamps; it fits vertically, so y follows the pointer as usual.
  const tiny = hoverTipPosition(5, 5, 400, 100, 320, 240);
  assert.equal(tiny.left, 12);
  assert.equal(tiny.top, 17);
});
