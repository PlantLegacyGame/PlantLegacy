import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

import { WorldDrops } from './WorldDrops.ts';

function make(
  groundY: (x: number, z: number) => number = () => 0,
  groundNormal?: (x: number, z: number) => { x: number; y: number; z: number },
) {
  const scene = new THREE.Scene();
  const drops = new WorldDrops({
    scene,
    groundY,
    ...(groundNormal ? { groundNormal } : {}),
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

  it('lies a contact shadow in the slope it sits on', () => {
    const normal = { x: 0.6, y: 0.8, z: 0 };
    const { drops, group } = make(
      () => 0,
      () => normal,
    );
    drops.spawn({ id: 'drop_slope', kind: 'dung', x: 0, y: 0, z: 0 });
    const shadow = group.children[1] as THREE.Mesh;
    const mapped = new THREE.Vector3(0, 0, 1).applyQuaternion(shadow.quaternion).normalize();
    assert.ok(
      mapped.distanceTo(new THREE.Vector3(normal.x, normal.y, normal.z).normalize()) < 1e-6,
      'the disc plane must be the ground plane',
    );
    // Lifted along the normal, not straight up: a flat lift leaves half the
    // disc buried on one side of a hill.
    assert.ok(shadow.position.x > 0.005, `shadow sits at x=${shadow.position.x}`);
  });

  it('turns each shadow with its own ground instead of one fixed angle', () => {
    const scene = new THREE.Scene();
    const drops = new WorldDrops({
      scene,
      groundY: () => 0,
      groundNormal: (x) => (x > 0 ? { x: 0.7, y: 0.7, z: 0 } : { x: 0, y: 1, z: 0 }),
      pickDistanceM: () => 6,
    });
    drops.spawn({ id: 'drop_a', kind: 'dung', x: 1, y: 0, z: 0 });
    drops.spawn({ id: 'drop_b', kind: 'dung', x: -1, y: 0, z: 0 });
    const shadows = (scene.children[0] as THREE.Group).children.filter(
      (child) => (child as THREE.Mesh).geometry instanceof THREE.CircleGeometry,
    ) as THREE.Mesh[];
    assert.equal(shadows.length, 2);
    const [first, second] = shadows;
    assert.ok(first && second, 'both drops drew a shadow');
    assert.ok(first.quaternion.angleTo(second.quaternion) > 0.1);
  });

  it('draws one body and pieces for a pile of remains, not four corpses', () => {
    const { drops, group } = make(() => 0);
    drops.spawn({ id: 'drop_body', kind: 'remains', x: 0, y: 0, z: 0 });
    drops.spawn({ id: 'drop_piece', kind: 'remains', x: 0.24, y: 0, z: 0.1 });
    assert.equal(drops.size(), 2);
    // The body has a root plate; the piece does not.
    const bodies = group.children.filter(
      (child) =>
        child instanceof THREE.Group &&
        child.name.startsWith('drop-') &&
        !!child.getObjectByName('husk-plate'),
    );
    assert.equal(bodies.length, 1);
    const piece = group.children.find(
      (child) => child instanceof THREE.Group && child.name === 'drop-drop_piece',
    ) as THREE.Group;
    const pieceModel = piece.children[0] as THREE.Group;
    assert.ok(pieceModel.scale.x < 1, 'a piece must be smaller than the body');
    // A piece casts no disc of its own: it lies inside the body's shade.
    assert.equal(
      group.children.filter(
        (child) => (child as THREE.Mesh).geometry instanceof THREE.CircleGeometry,
      ).length,
      1,
    );
  });

  it('lays a husk on its soil instead of hovering, and keeps its body joined', () => {
    const { drops, group } = make(() => 0);
    drops.spawn({ id: 'drop_husk', kind: 'remains', x: 0, y: 0, z: 0 });
    const root = group.children[0] as THREE.Group;
    const rest = root.position.y;
    assert.ok(rest > 0 && rest < 0.02, `husk rests ${rest.toFixed(3)} m up`);
    const heading = root.rotation.y;
    drops.update(500);
    drops.update(5_000);
    assert.equal(root.position.y, rest, 'a corpse must not bob');
    assert.equal(root.rotation.y, heading, 'a corpse must not spin');

    // One body: the plate and three stalk joints, and each leaf a child of the
    // joint it budded from. A leaf slung beside the stalk is a heap, not a plant.
    const model = root.children[0] as THREE.Group;
    const husk = model.children[0] as THREE.Group;
    const leaves = husk.getObjectsByProperty('name', 'husk-leaf');
    assert.equal(leaves.length, 2);
    for (const leaf of leaves) assert.equal(leaf.parent?.name, 'husk-joint');
    // Its lowest point is at or under the anchor - a husk built around its
    // centre would stand the plate in the air - and no lower than a leaf tip
    // lying in the soil.
    const box = new THREE.Box3().setFromObject(model);
    assert.ok(box.min.y <= rest + 0.002, `base at ${box.min.y}, anchor ${rest}`);
    assert.ok(box.min.y > rest - 0.04, `base at ${box.min.y} is under the world`);
    // A whole plant's corpse is a hand long; a twig does not read as a body.
    const length = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    assert.ok(length > 0.3, `body is only ${length.toFixed(2)} m long`);
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
