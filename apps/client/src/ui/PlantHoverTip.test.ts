import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hoverTipPosition, plantHoverText } from './PlantHoverTip.ts';
import { partLabel, plantNodeInfo } from './PlantNodeInfo.ts';

test("a part is named in the game's words, never as an id", () => {
  assert.equal(partLabel('stem'), 'Stem');
  assert.equal(partLabel('lateral_root'), 'Lateral root');
  assert.equal(partLabel(''), 'Part');
  assert.equal(partLabel('  '), 'Part');
});

const plant = [
  { id: 'seed_1', nodeType: 'seed', parentId: null },
  { id: 'stem_2', nodeType: 'stem', parentId: 'seed_1' },
  { id: 'leaf_3', nodeType: 'leaf', parentId: 'stem_2' },
  { id: 'leaf_4', nodeType: 'leaf', parentId: 'stem_2' },
];

test('parts are numbered by the order their plant grew them', () => {
  const stem = plantNodeInfo('stem_2', plant);
  assert.equal(stem?.label, 'Stem #1');
  assert.equal(stem?.parent, 'Seed #1');
  assert.deepEqual(stem?.children, ['Leaf #1', 'Leaf #2']);
  const secondLeaf = plantNodeInfo('leaf_4', plant);
  assert.equal(secondLeaf?.label, 'Leaf #2');
  assert.equal(secondLeaf?.parent, 'Stem #1');
  assert.deepEqual(secondLeaf?.children, []);
});

test('the first part is attached to the soil, not to a phantom parent', () => {
  assert.equal(plantNodeInfo('seed_1', plant)?.parent, null);
});

test('children come from parentId, so a mirrored list that lags still names them', () => {
  const lagging = [
    { id: 'stem_2', nodeType: 'stem', parentId: null, children: [] },
    { id: 'leaf_3', nodeType: 'leaf', parentId: 'stem_2' },
  ];
  assert.deepEqual(plantNodeInfo('stem_2', lagging)?.children, ['Leaf #1']);
});

test('in grow mode a click is the action the player is being taught', () => {
  const text = plantHoverText({
    nodeType: 'stem',
    isOwnPlant: true,
    growMode: true,
    canGrow: true,
    info: plantNodeInfo('stem_2', plant),
    totalParts: 4,
    growable: 3,
  });
  assert.equal(text.title, 'Stem #1');
  assert.equal(text.action, 'Click to see what it can grow');
  assert.deepEqual(text.details, [
    'Parts on this plant: 4',
    'Growable from here: 3',
    'Attached to: Seed #1',
    'Grown from here: Leaf #1, Leaf #2',
  ]);
});

test('a part with no available options never promises growth', () => {
  const text = plantHoverText({
    nodeType: 'leaf',
    isOwnPlant: true,
    growMode: true,
    canGrow: true,
    info: plantNodeInfo('leaf_4', plant),
    totalParts: 4,
    growable: 0,
  });
  assert.equal(text.action, 'Nothing can grow from here yet');
  assert.ok(text.details.includes('Growable from here: 0'));
});

test('before the server answers, grow mode still offers the click', () => {
  const text = plantHoverText({
    nodeType: 'stem',
    isOwnPlant: true,
    growMode: true,
    canGrow: true,
    growable: null,
  });
  assert.equal(text.title, 'Stem');
  assert.equal(text.action, 'Click to see what it can grow');
});

test('out of grow mode the tip names the key that changes that', () => {
  const text = plantHoverText({
    nodeType: 'leaf',
    isOwnPlant: true,
    growMode: false,
    canGrow: true,
    growable: 2,
  });
  assert.equal(text.action, 'G \u2014 grow mode');
  assert.deepEqual(text.details, ['Growable from here: 2']);
});

test('a part that cannot grow does not promise growth', () => {
  const text = plantHoverText({
    nodeType: 'root',
    isOwnPlant: true,
    growMode: true,
    canGrow: false,
  });
  assert.equal(text.action, 'Nothing can grow from here yet');
});

test('another plant is a look, in both modes', () => {
  for (const growMode of [true, false]) {
    assert.deepEqual(
      plantHoverText({ nodeType: 'stem', isOwnPlant: false, growMode, canGrow: true }),
      { title: 'Another plant', action: 'Click to look', details: [] },
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
