/**
 * Node names have to be unique across the world, not just inside one plant.
 *
 * `nodeName` builds a per-node suffix on a tag taken from the plant id, and the
 * server looks nodes up by id alone (`findPlantByNodeId` returns the first
 * match). An eight-character tag let two plants with a shared id prefix produce
 * the same names, so growing one could grow the other. The tag is sixteen now.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PlantNode } from '@plant-legacy/shared/growth';
import { nodeName } from './rules.ts';

/** A node as the naming rule sees it: id, children, and the type in the parent id. */
function node(id: string, children: string[] = []): PlantNode {
  return { id, children } as unknown as PlantNode;
}

const never = (): boolean => false;

describe('node naming (INV-GR-05)', () => {
  it('uses sixteen characters of the plant id in the seed name', () => {
    const name = nodeName('p_0123456789abcdef', null, 'seed', never);
    assert.equal(name, '0123456789abcdef:seed');
  });

  it('gives two plants that share an eight-character prefix different names', () => {
    // Same first eight characters, different next eight: the case the old tag
    // could not tell apart.
    const a = nodeName('p_01234567aaaabbbb', null, 'seed', never);
    const b = nodeName('p_01234567ccccdddd', null, 'seed', never);
    assert.notEqual(a, b);
  });

  it('extends the parent name rather than starting a new one', () => {
    const parent = node('0123456789abcdef:seed', ['a', 'b']);
    const child = nodeName('p_0123456789abcdef', parent, 'stem', never);
    assert.equal(child, '0123456789abcdef:seed.stem2');
  });

  it('never reuses a name an earlier sibling already took', () => {
    const seen = new Set<string>();
    const parent = node('0123456789abcdef:seed');
    const first = nodeName('p_0123456789abcdef', parent, 'stem', (id) => seen.has(id));
    seen.add(first);
    const second = nodeName('p_0123456789abcdef', parent, 'stem', (id) => seen.has(id));
    assert.equal(first, '0123456789abcdef:seed.stem0');
    assert.equal(second, '0123456789abcdef:seed.stem0~1');
  });
});
