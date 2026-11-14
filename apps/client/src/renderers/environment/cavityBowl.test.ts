import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  CAVITY_BOWL_RIM_FRACTION,
  CAVITY_MOUTH_FRACTION,
  CAVITY_RIM_SINK_M,
  cavityBowlPlacement,
  createCavityBowl,
  isEyeInsidePit,
  updateCavityBowl,
} from './cavityBowl.ts';

/** Horizontal radius of the built bowl's rim circle at unit scale. */
function rimCircleRadius(): number {
  return Math.sqrt(1 - CAVITY_BOWL_RIM_FRACTION * CAVITY_BOWL_RIM_FRACTION);
}

describe('cavityBowlPlacement', () => {
  it('mouths exactly the radius the soil shader cuts, at every size and stage', () => {
    for (const radius of [1, 2.06, 4.9, 8]) {
      const aperture = Math.max(0.28, radius * CAVITY_MOUTH_FRACTION);
      for (const progress of [0.1, 0.25, 0.5, 0.75, 1]) {
        const { horizontalScale } = cavityBowlPlacement(radius, progress, undefined, aperture);
        const rimRadius = horizontalScale * rimCircleRadius();
        const expected = aperture * progress;
        assert.ok(
          Math.abs(rimRadius - expected) < 1e-9,
          `radius ${radius} progress ${progress}: rim ${rimRadius.toFixed(4)} m vs aperture ${expected.toFixed(4)} m`,
        );
      }
    }
  });

  it('has no wider fallback mouth either', () => {
    const radius = 2.06;
    const { horizontalScale } = cavityBowlPlacement(radius, 1);
    const rimRadius = horizontalScale * rimCircleRadius();
    const mouthRadius = radius * CAVITY_MOUTH_FRACTION;
    assert.ok(
      Math.abs(rimRadius - mouthRadius) < 1e-9,
      `rim ${rimRadius.toFixed(3)} m does not match the ${mouthRadius.toFixed(3)} m mouth`,
    );
  });

  it('keeps the rim under the surface at every opening stage', () => {
    for (const progress of [0.05, 0.5, 1]) {
      const { rimOffsetY } = cavityBowlPlacement(2.06, progress);
      assert.ok(rimOffsetY < 0, `rim ${rimOffsetY.toFixed(3)} m is not below the centre`);
    }
  });

  it('opens from nothing: the bowl is hidden at zero progress', () => {
    const { visible, horizontalScale } = cavityBowlPlacement(2.06, 0);
    assert.equal(visible, false);
    assert.equal(horizontalScale, 0);
  });
});

describe('isEyeInsidePit', () => {
  const frame = {
    x: 0,
    y: 0,
    z: 0,
    horizontalScale: 1,
    verticalScale: 1,
  };

  it('treats an eye above the rim as looking into the pit', () => {
    assert.equal(isEyeInsidePit({ x: 4, y: 0.5, z: 0 }, frame), true);
  });

  it('treats an eye within the bowl volume as inside the pit', () => {
    assert.equal(isEyeInsidePit({ x: 0, y: -0.5, z: 0 }, frame), true);
    assert.equal(isEyeInsidePit({ x: 0.6, y: -0.4, z: 0.2 }, frame), true);
  });

  it('treats an eye buried beside the pit as outside it', () => {
    assert.equal(isEyeInsidePit({ x: 2.4, y: -0.6, z: 0 }, frame), false);
    assert.equal(isEyeInsidePit({ x: 0, y: -1.5, z: 3 }, frame), false);
  });
});

describe('terrain-conforming cavity rim', () => {
  it('places every rim vertex just under the terrain instead of one flat height', () => {
    const bowl = createCavityBowl(new THREE.Color('#3a2a1c'), new THREE.Color('#6a5440'), 16, 8);
    const centre = new THREE.Vector3(0, 0, 0);
    const surface = (x: number, z: number): number => 0.5 * x - 0.2 * z;
    updateCavityBowl(bowl, centre, 2, 1, surface);

    const rim: number[] = bowl.userData.rimIndices as number[];
    assert.ok(rim.length > 0);
    const position = bowl.geometry.getAttribute('position');
    let min = Infinity;
    let max = -Infinity;
    for (const index of rim) {
      const worldX = centre.x + position.getX(index) * bowl.scale.x;
      const worldZ = centre.z + position.getZ(index) * bowl.scale.z;
      const worldY = bowl.position.y + position.getY(index) * bowl.scale.y;
      const expected = surface(worldX, worldZ) - CAVITY_RIM_SINK_M;
      assert.ok(
        Math.abs(worldY - expected) < 1e-6,
        `rim vertex ${index} is ${(worldY - expected).toFixed(3)} m off its buried lip`,
      );
      min = Math.min(min, worldY);
      max = Math.max(max, worldY);
    }
    assert.ok(max - min > 0.1, `rim stayed flat: ${(max - min).toFixed(3)} m of relief`);
  });
});
