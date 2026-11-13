import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  encodeMutationMask,
  MUTATION_BIT,
  MUTATION_MASK_LIMIT,
  mutationMaskHas,
  nodeMutationMask,
} from './mutations.ts';

test('encodes each documented signature to its own bit', () => {
  assert.equal(encodeMutationMask(['bioluminescent']), 1);
  assert.equal(encodeMutationMask(['thick_bark']), 2);
  assert.equal(encodeMutationMask(['variegated']), 4);
  assert.equal(encodeMutationMask(['bioluminescent', 'variegated']), 5);
});

test('an empty or unknown mutation list is no mutation', () => {
  assert.equal(encodeMutationMask([]), 0);
  assert.equal(encodeMutationMask(['glowing_roots', 'unknown']), 0);
});

test('the encoded mask never leaves the three bits the vertex word carries', () => {
  const all = encodeMutationMask(['bioluminescent', 'thick_bark', 'variegated']);
  assert.equal(all, 7);
  assert.ok(all <= MUTATION_MASK_LIMIT);
});

test('a node mask merges the server bitmask with named ids', () => {
  assert.equal(nodeMutationMask({ mutationFlags: 0 }), 0);
  assert.equal(nodeMutationMask({}), 0);
  assert.equal(nodeMutationMask({ mutationFlags: MUTATION_BIT.thick_bark }), 2);
  assert.equal(
    nodeMutationMask({ mutationFlags: MUTATION_BIT.bioluminescent, mutations: ['variegated'] }),
    5,
  );
});

test('a stale bitmask is clamped to the signatures the shaders know', () => {
  assert.equal(nodeMutationMask({ mutationFlags: 0b1111_1111 }), MUTATION_MASK_LIMIT);
});

test('mutationMaskHas reads one signature without disturbing the others', () => {
  const mask = encodeMutationMask(['thick_bark']);
  assert.equal(mutationMaskHas(mask, 'thick_bark'), true);
  assert.equal(mutationMaskHas(mask, 'bioluminescent'), false);
});
