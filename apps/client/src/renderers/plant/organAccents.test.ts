import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ORGAN_DISPLAY_ORDER } from '@plant-legacy/shared/growth';
import * as THREE from 'three';
import { buildOrganAccents } from './organAccents.ts';

const options = { length: 0.4, radius: 0.03 };

describe('organ accents', () => {
  it('draws anatomy for all 19 node types', () => {
    for (const nodeType of ORGAN_DISPLAY_ORDER) {
      const group = buildOrganAccents(nodeType, options);
      assert.ok(group, `${nodeType} has no accent group`);
      assert.ok(group.children.length > 0, `${nodeType} has an empty accent group`);
      for (const child of group.children) {
        assert.equal(child.castShadow, true, `${nodeType} accent misses castShadow`);
        assert.equal(child.receiveShadow, true, `${nodeType} accent misses receiveShadow`);
      }
    }
  });

  it('cuts the floating-pad notch out of the silhouette', () => {
    const group = buildOrganAccents('floating_leaf', options);
    assert.ok(group);
    const pad = group.children.find(
      (child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.ShapeGeometry,
    );
    assert.ok(pad instanceof THREE.Mesh);
    // The notch is a concave wedge in the outline, not a raised stripe: the
    // shape has points on both sides of the missing centre sector.
    const position = pad.geometry.getAttribute('position');
    assert.ok(position.count > 20);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < position.count; i += 1) {
      minX = Math.min(minX, position.getX(i));
      maxX = Math.max(maxX, position.getX(i));
    }
    assert.ok(minX < 0 && maxX > 0);
  });

  it('gives flowers and spores appendages and a seed only its hilum', () => {
    for (const nodeType of ['flower', 'spore_sac']) {
      const group = buildOrganAccents(nodeType, options);
      assert.ok(group);
      assert.ok(group.children.length >= 2, `${nodeType} lacks its appendages`);
    }
    // The hilum is the seed's only detail. The old seam torus sat above the
    // coat and read as a halo, so exactly one child pins its removal as well
    // as the hilum it still needs.
    const seed = buildOrganAccents('seed', options);
    assert.ok(seed);
    assert.equal(seed.children.length, 1, 'seed has lost its hilum or regained a halo');
  });
});
