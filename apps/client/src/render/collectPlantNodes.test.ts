import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectPlantNodes } from './collectPlantNodes.ts';

function nodes(count: number, prefix: string): Map<string, { id: string }> {
  const map = new Map<string, { id: string }>();
  for (let index = 0; index < count; index += 1) {
    const id = `${prefix}_${index}`;
    map.set(id, { id });
  }
  return map;
}

describe('collectPlantNodes', () => {
  it('puts the own plant first, then every rival', () => {
    const result = collectPlantNodes(nodes(2, 'own'), [nodes(2, 'rival')]);
    assert.deepEqual(
      result.map((node) => node.id),
      ['own_0', 'own_1', 'rival_0', 'rival_1'],
    );
  });

  it('reuses the target array instead of growing it every frame', () => {
    const target = [{ id: 'stale' }];
    const result = collectPlantNodes(nodes(1, 'own'), [], target);
    assert.equal(result, target);
    assert.deepEqual(
      result.map((node) => node.id),
      ['own_0'],
    );
  });

  it('collects 200k nodes without an argument-limit RangeError', () => {
    const result = collectPlantNodes(nodes(100_000, 'own'), [nodes(100_000, 'rival')]);
    assert.equal(result.length, 200_000);
    assert.equal(result[0]?.id, 'own_0');
    assert.equal(result[199_999]?.id, 'rival_99999');
  });
});
