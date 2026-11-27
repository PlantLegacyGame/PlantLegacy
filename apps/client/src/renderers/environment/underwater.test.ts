import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AIR_STATE,
  DEFAULT_UNDERWATER_TUNING,
  sampleUnderwater,
  seaSurfaceHeightOver,
  underwaterFog,
  underwaterSunIntensity,
} from './underwater.ts';

const pond = [{ height: 10, kind: 'puddle' as const }];

describe('underwater state', () => {
  it('is air above the surface and on a wet film', () => {
    assert.equal(sampleUnderwater(12, pond).submerged, false);
    // An eye 5 mm under a puddle is not diving.
    assert.equal(sampleUnderwater(9.995, pond).submerged, false);
  });

  it('measures the water over the eye and absorbs light with depth', () => {
    const shallow = sampleUnderwater(9.5, pond);
    assert.equal(shallow.submerged, true);
    assert.equal(shallow.depthM, 0.5);
    assert.equal(shallow.kind, 'puddle');
    assert.ok(shallow.transmission > 0.4 && shallow.transmission < 0.5, 'exp(-0.8)');
    assert.ok(shallow.amount > 0 && shallow.amount < 1);

    const deep = sampleUnderwater(6, pond);
    assert.equal(deep.depthM, 4);
    assert.ok(deep.transmission < shallow.transmission);
    assert.equal(deep.amount, 1, 'saturates at the tint depth');
  });

  it('uses the deepest surface the eye is under, not the first one listed', () => {
    const surfaces = [
      { height: 10, kind: 'puddle' as const },
      { height: 14, kind: 'table' as const },
      { height: 18, kind: 'river' as const },
    ];
    const state = sampleUnderwater(9, surfaces);
    assert.equal(state.kind, 'river');
    assert.equal(state.depthM, 9);
  });

  it('ignores surfaces below the eye and non-finite data', () => {
    const surfaces = [
      { height: 5, kind: 'puddle' as const },
      { height: Number.NaN, kind: 'table' as const },
    ];
    assert.deepEqual(sampleUnderwater(9, surfaces), AIR_STATE);
  });

  it("reads the body's sphere for the sea past the local dome, not the dome's parabola", () => {
    // A hundred-kilometre body with a sea eight metres over its base radius, an
    // eye two kilometres up eighty kilometres from the pole. The dome's
    // parabola sags r²/2R, 32 km there, and the sphere sags 40 km: the parabola
    // puts the water eight kilometres over the eye's head, which is the shape of
    // the bug - a whole frame fogged as if it were underwater.
    const radius = 100_000;
    const seaRadius = 100_008;
    const x = 80_000;
    const z = 0;
    const parabola = -((x * x + z * z) / (2 * radius)) + 6;
    const sphere = seaSurfaceHeightOver({
      x,
      z,
      domeReachM: 6_200,
      planetSeaRadiusM: seaRadius,
      planetRadiusM: radius,
      domeSurfaceY: parabola,
    });
    assert.notEqual(sphere, null);
    const height = sphere as number;
    const exact = -radius + Math.sqrt(seaRadius * seaRadius - x * x - z * z);
    assert.ok(Math.abs(height - exact) < 1e-6, `height ${height} vs ${exact}`);
    assert.ok(exact < parabola - 300, 'the sphere is the lower answer out here');

    const eyeY = height + 2_000;
    assert.equal(sampleUnderwater(eyeY, [{ height, kind: 'sea' as const }]).submerged, false);
    // And the old answer would have drowned the eye: this is the shape of the bug.
    assert.equal(
      sampleUnderwater(eyeY, [{ height: parabola, kind: 'sea' as const }]).submerged,
      true,
    );
  });

  it("keeps the dome inside its own reach, and has no sea above the sphere's limb", () => {
    const inside = seaSurfaceHeightOver({
      x: 1_000,
      z: 0,
      domeReachM: 6_200,
      planetSeaRadiusM: 100_008,
      planetRadiusM: 100_000,
      domeSurfaceY: 1.5,
    });
    assert.equal(inside, 1.5, 'the dome is exact where it is drawn');

    const pastLimb = seaSurfaceHeightOver({
      x: 0,
      z: 140_000,
      domeReachM: 6_200,
      planetSeaRadiusM: 100_008,
      planetRadiusM: 100_000,
      domeSurfaceY: -80_000,
    });
    assert.equal(pastLimb, null, "no water over a column past the water sphere's horizon");

    // A flat world keeps the dome's answer; there is no sphere to read.
    assert.equal(
      seaSurfaceHeightOver({
        x: 50_000,
        z: 0,
        domeReachM: 6_200,
        planetSeaRadiusM: 0,
        planetRadiusM: 0,
        domeSurfaceY: 3,
      }),
      3,
    );
  });

  it('pulls fog in and dims the sun, and leaves both alone in air', () => {
    const air = { near: 60, far: 260 };
    assert.deepEqual(underwaterFog(air, AIR_STATE), air);
    assert.equal(underwaterSunIntensity(1.4, AIR_STATE), 1.4);

    const state = sampleUnderwater(8, pond);
    const fogged = underwaterFog(air, state);
    assert.ok(fogged.near < air.near && fogged.far < air.far);
    assert.ok(fogged.far >= fogged.near * 0.5, 'fog stays a range, never crosses over');
    const dimmed = underwaterSunIntensity(1.4, state);
    assert.ok(dimmed > 0 && dimmed < 1.4);

    // Depth 4 m sits past the saturation depth, so the fog is at its tightest.
    const deepFog = underwaterFog(air, sampleUnderwater(6, pond));
    assert.ok(deepFog.near < fogged.near + 1e-9);
    assert.ok(
      Math.abs(deepFog.far - air.far * DEFAULT_UNDERWATER_TUNING.fogFarScale) < 1e-6,
      'fully submerged fog follows fog_far_scale',
    );
  });
});
