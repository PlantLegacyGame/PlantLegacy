import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

import { WorldDrops } from './WorldDrops.ts';

function make(groundY: (x: number, z: number) => number = () => 0) {
  const scene = new THREE.Scene();
  const drops = new WorldDrops({
    scene,
    groundY,
    pickDistanceM: () => 6,
  });
  const group = scene.children[0] as THREE.Group;
  return { scene, drops, group };
}

/** A ray straight down onto a world position. */
function rayDown(x: number, y: number, z: number): THREE.Raycaster {
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0));
  raycaster.far = 10;
  return raycaster;
}

describe('world drops', () => {
  it('draws one marker per spawn and ignores a duplicate id', () => {
    const { drops, group } = make();
    drops.spawn({ id: 'drop_1', kind: 'dung', x: 1, y: 0, z: 2 });
    drops.spawn({ id: 'drop_1', kind: 'dung', x: 1, y: 0, z: 2 });
    assert.equal(drops.size(), 1);
    // One marker root in the group, plus one shadow on the ground.
    assert.equal(group.children.length, 2);
  });

  it('hovers a ground drop just above the soil, never inside it', () => {
    const { drops, group } = make(() => 1.5);
    drops.spawn({ id: 'drop_dung', kind: 'dung', x: 0, y: 0, z: 0 });
    const root = group.children[0] as THREE.Group;
    assert.ok(root.position.y > 1.5 + 0.2, `hovered to ${root.position.y}`);
    drops.update(0);
    drops.update(900);
    assert.ok(root.position.y > 1.5, 'a bob must not sink into the ground');
  });

  it('keeps a fragment at the height it fell from, above the soil under it', () => {
    const { drops, group } = make(() => 2);
    drops.spawn({ id: 'drop_frag', kind: 'fragment', x: 0, y: 1.4, z: 0 });
    const root = group.children[0] as THREE.Group;
    // Its own height plus a hover of a few centimetres, never the surface itself.
    const above = root.position.y - (2 + 1.4);
    assert.ok(above > 0.2 && above < 0.6, `rests ${above.toFixed(2)} m above its height`);
  });

  it('leaves a buried drop underground instead of lifting it to the surface', () => {
    const { drops, group } = make(() => 3);
    drops.spawn({ id: 'drop_deep', kind: 'remains', x: 0, y: -1.2, z: 0 });
    const root = group.children[0] as THREE.Group;
    assert.ok(root.position.y < 3, `a buried drop surfaced at ${root.position.y}`);
    // A drop with no surface above it gets no shadow on the grass either.
    assert.equal(group.children.length, 1);
  });

  it('does not rise when it is dropped under water', () => {
    // The pond floor is the ground here; a drop at y = 0 is on it and floats its
    // own hover height, which is centimetres, not the depth of the water.
    const { drops, group } = make(() => -1.4);
    drops.spawn({ id: 'drop_wet', kind: 'fragment', x: 0, y: 0, z: 0 });
    const root = group.children[0] as THREE.Group;
    assert.ok(root.position.y < -1, `a submerged drop climbed to ${root.position.y}`);
  });

  it('names the drop under the pointer, including its parts', () => {
    const { drops } = make();
    drops.spawn({ id: 'drop_1', kind: 'dung', x: 1, y: 0, z: 2 });
    assert.equal(drops.pick(rayDown(1, 5, 2)), 'drop_1');
  });

  it('misses when the ray is elsewhere or too far away', () => {
    const { drops } = make();
    drops.spawn({ id: 'drop_1', kind: 'dung', x: 1, y: 0, z: 2 });
    assert.equal(drops.pick(rayDown(9, 5, 9)), null);
    const far = new THREE.Raycaster(new THREE.Vector3(1, 20, 2), new THREE.Vector3(0, -1, 0));
    far.far = 40;
    assert.equal(drops.pick(far), null);
  });

  it('fades a drop before it decays and clears it when the server says so', () => {
    const { drops, group } = make();
    drops.spawn({ id: 'drop_1', kind: 'dung', x: 1, y: 0, z: 2, expiresAtMs: 20_000 });
    drops.update(19_800);
    assert.equal(drops.size(), 1);
    drops.remove('drop_1');
    assert.equal(group.children.length, 0);
    assert.equal(drops.pick(rayDown(1, 5, 2)), null);
    drops.clear();
  });
});
