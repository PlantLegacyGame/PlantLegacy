import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clientNodeHealth,
  resolveDrawnProgress,
  tickProgressIsMeaningful,
} from './plantProgress.ts';

test('the server number wins when it sends one', () => {
  assert.equal(resolveDrawnProgress({ serverProgress: 0.42 }), 0.42);
  assert.equal(resolveDrawnProgress({ serverProgress: 1 }), 1);
  // Out of range is clamped, not passed through to a renderer.
  assert.equal(resolveDrawnProgress({ serverProgress: 3 }), 1);
  assert.equal(resolveDrawnProgress({ serverProgress: -2 }), 0);
});

test('tick arithmetic is only used when it can be answered', () => {
  assert.equal(tickProgressIsMeaningful(1000, 900), true);
  assert.equal(tickProgressIsMeaningful(1000, 1000), true);
  // A node that starts in the future, or a client with no tick yet, is unknown.
  assert.equal(tickProgressIsMeaningful(900, 1000), false);
  assert.equal(tickProgressIsMeaningful(0, 900), false);
  assert.equal(tickProgressIsMeaningful(Number.NaN, 900), false);
});

test('a node whose start tick is ahead of the client does not collapse the plant', () => {
  // The exact defect: elapsed ticks clamp to 0, every part drew at zero length.
  const progress = resolveDrawnProgress({
    serverTick: 900,
    growthStartTick: 1000,
    growthTimeSeconds: 1,
    previousProgress: 1,
  });
  assert.equal(progress, 1, 'a part that was whole stays whole');
  // Even for a node this client has never seen, a missing answer is not zero.
  assert.equal(
    resolveDrawnProgress({ serverTick: 900, growthStartTick: 1000, growthTimeSeconds: 1 }),
    1,
  );
});

test('a genuinely new node still draws from nothing', () => {
  const progress = resolveDrawnProgress({
    serverTick: 1050,
    growthStartTick: 1000,
    growthTimeSeconds: 5,
    previousProgress: 0,
  });
  // 50 ticks into 100 ticks: half grown, and it keeps its own floor.
  assert.ok(progress > 0 && progress < 0.6, `expected a partial growth, got ${progress}`);
});

test('tick arithmetic never un-grows a node the client already drew grown', () => {
  const progress = resolveDrawnProgress({
    serverTick: 1010,
    growthStartTick: 1000,
    growthTimeSeconds: 5,
    previousProgress: 1,
  });
  assert.equal(progress, 1);
});

test('a missing duration falls back to what was drawn, then to whole', () => {
  assert.equal(
    resolveDrawnProgress({ serverTick: 1100, growthStartTick: 1000, previousProgress: 0.5 }),
    0.5,
  );
  assert.equal(resolveDrawnProgress({}), 1);
});

test('a part reads the health the server sent, not a guess from its biomass', () => {
  // The defect: `biomass / 10` on a young stem (0.4 units) read 0.04, so every
  // part on a healthy plant was labelled Depleted in the inspect panel.
  assert.equal(clientNodeHealth({ health: 0.04 }), 0.04);
  assert.equal(clientNodeHealth({ health: 1 }), 1);
  assert.equal(clientNodeHealth({ health: 0 }), 0);
  // A missing field is not damage, and a bad one is not a number to draw with.
  assert.equal(clientNodeHealth({}), 1);
  assert.equal(clientNodeHealth({ health: Number.NaN }), 1);
  assert.equal(clientNodeHealth({ health: '0.2' }), 1);
});

// The same rule the file header states, now in every branch: growth is one-way.
test('never un-grows a part, even when the server sends a smaller number', () => {
  // Measured on a live plant: a growing radicle's mirror progress read 0.95 and
  // then 0.55 on a later packet, with the biomass jumping in step. The drawn root
  // snapped back to just over half, and the Root Sight cavity - sized from what
  // the parts have dug - collapsed with it and reopened: the reported "root sight
  // vanishes while growing".
  assert.equal(resolveDrawnProgress({ serverProgress: 0.9, previousProgress: 0.4 }), 0.9);
  assert.equal(resolveDrawnProgress({ serverProgress: 0.55, previousProgress: 0.95 }), 0.95);
  assert.equal(resolveDrawnProgress({ serverProgress: 0.55, previousProgress: 1 }), 1);
  // A part that is genuinely starting still starts: the floor is what this client
  // drew, not a minimum progress.
  assert.equal(resolveDrawnProgress({ serverProgress: 0.02 }), 0.02);
  assert.equal(resolveDrawnProgress({ serverProgress: 0, previousProgress: 0 }), 0);
  // And an unreadable previous value does not become a floor.
  assert.equal(resolveDrawnProgress({ serverProgress: 0.3, previousProgress: Number.NaN }), 0.3);
});
