import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  bowlVerticalScale,
  CAVITY_BOWL_RIM_FRACTION,
  CAVITY_DEPTH_TO_MOUTH,
  CAVITY_FLOOR_CLEARANCE_M,
  CAVITY_MOUTH_FRACTION,
  CAVITY_MOUTH_OVERHANG,
  CAVITY_PROFILE_DEPTH,
  CAVITY_RIM_SINK_M,
  cavityBowlPlacement,
  createCavityBowl,
  isEyeInsideCavity,
  silhouetteKeepsFragment,
  updateCavityBowl,
} from './cavity/index.ts';

/** Horizontal radius of the built bowl's rim circle at unit scale. */
function rimCircleRadius(): number {
  return Math.sqrt(1 - CAVITY_BOWL_RIM_FRACTION * CAVITY_BOWL_RIM_FRACTION);
}

describe('cavityBowlPlacement', () => {
  it('matches the radius the soil shader cuts, at every size and stage', () => {
    for (const radius of [1, 2.06, 4.9, 8]) {
      const aperture = Math.max(0.28, radius * CAVITY_MOUTH_FRACTION);
      for (const progress of [0.1, 0.25, 0.5, 0.75, 1]) {
        const { horizontalScale } = cavityBowlPlacement(radius, progress, undefined, aperture);
        const rimRadius = horizontalScale * rimCircleRadius();
        const cut = aperture * progress;
        // Exactly the cut: a wider mouth showed as a second ring outside the
        // hole when the camera looked straight down into the cavity.
        assert.ok(
          Math.abs(rimRadius - cut) < 1e-9,
          `radius ${radius} progress ${progress}: rim ${rimRadius.toFixed(4)} m vs cut ${cut.toFixed(4)} m`,
        );
      }
    }
  });

  it('matches the fallback mouth the same way', () => {
    const radius = 2.06;
    const { horizontalScale } = cavityBowlPlacement(radius, 1);
    const rimRadius = horizontalScale * rimCircleRadius();
    const mouthRadius = radius * CAVITY_MOUTH_FRACTION;
    assert.ok(
      Math.abs(rimRadius - mouthRadius * CAVITY_MOUTH_OVERHANG) < 1e-9,
      `rim ${rimRadius.toFixed(3)} m does not match the ${mouthRadius.toFixed(3)} m mouth`,
    );
  });

  it('holds the rim flush with the surface, never under it', () => {
    // Never above the cut: a rim above the hole is a lip standing over its own
    // work. And never *under* it either - that was 2 cm, and the 2 cm was the
    // pale dotted seam along the pit's edge: the soil is a sheet with no
    // thickness, so a sunk lip left a slot between the sheet's cut edge and the
    // wall, and from any low angle the sky behind the mouth showed through it.
    // Flush, the bowl's rim (a hair outside the cut, biased towards the camera
    // by the material's polygon offset) covers the sheet's edge instead.
    for (const progress of [0.05, 0.5, 1]) {
      const { rimOffsetY } = cavityBowlPlacement(2.06, progress);
      assert.ok(rimOffsetY <= 0, `rim ${rimOffsetY.toFixed(3)} m is above the centre`);
      assert.equal(rimOffsetY, -CAVITY_RIM_SINK_M);
    }
    assert.equal(CAVITY_RIM_SINK_M, 0, 'a sunk rim opens a slot of sky at the mouth');
  });

  it('opens from nothing: the bowl is hidden at zero progress', () => {
    const { visible, horizontalScale } = cavityBowlPlacement(2.06, 0);
    assert.equal(visible, false);
    assert.equal(horizontalScale, 0);
  });
});

describe('isEyeInsideCavity', () => {
  const frame = {
    x: 0,
    y: 0,
    z: 0,
    horizontalScale: 1,
    verticalScale: 1,
  };

  it('excludes an eye above the rim, even one hovering over the opening', () => {
    // Above the lip the eye is outside the pit, and the shell still has to be
    // held to the opening's silhouette from up there.
    assert.equal(isEyeInsideCavity({ x: 0, y: 0.2, z: 0 }, frame), false);
    assert.equal(isEyeInsideCavity({ x: 4, y: 0.5, z: 0 }, frame), false);
  });

  it('includes an eye within the bowl volume', () => {
    assert.equal(isEyeInsideCavity({ x: 0, y: -0.5, z: 0 }, frame), true);
    assert.equal(isEyeInsideCavity({ x: 0.6, y: -0.4, z: 0.2 }, frame), true);
  });

  it('excludes an eye buried beside the pit', () => {
    assert.equal(isEyeInsideCavity({ x: 2.4, y: -0.6, z: 0 }, frame), false);
  });
});

describe('opening-silhouette clip', () => {
  interface ClipUniforms {
    uBowlCenter: { value: THREE.Vector3 };
    uBowlClipMode: { value: number };
  }
  const clipOf = (
    eye: THREE.Vector3,
    surface: (x: number, z: number) => number = () => 0,
  ): { bowl: THREE.Mesh; clip: ClipUniforms } => {
    const bowl = createCavityBowl(new THREE.Color('#3a2a1c'), new THREE.Color('#6a5440'), 24, 12);
    updateCavityBowl(bowl, new THREE.Vector3(0, 0, 0), 2, 1, surface, eye, 1.2);
    const clip = (bowl.material as THREE.MeshBasicMaterial).userData.clipUniforms as ClipUniforms;
    return { bowl, clip };
  };

  it('is on only for a buried eye beside the pit', () => {
    // An eye above the ground must NOT be clipped. It was, to stop the shell
    // painting past the opening, and that clipped the ground instead: from any
    // camera that was not straight above the pit, a fragment just inside the
    // mouth crossed the surface plane outside the aperture and was discarded, so
    // the player looked straight through the hillside beside it.
    // 1 = mouth column (eye above ground), 2 = buried (sightline + near half).
    assert.equal(clipOf(new THREE.Vector3(0, 5, 0)).clip.uBowlClipMode.value, 1);
    assert.equal(clipOf(new THREE.Vector3(2.4, -0.7, 0)).clip.uBowlClipMode.value, 2);
  });

  it('is off for an eye inside the pit, where the walls surround it', () => {
    const inside = clipOf(new THREE.Vector3(0, -0.3, 0));
    // No clip at all: the eye is surrounded by wall and needs all of it.
    assert.equal(inside.clip.uBowlClipMode.value, 0);
  });

  it('sits its mouth on the lowest ground, so every lip vertex rises to its own', () => {
    // Three rules tried before this one, and each broke something. Lifting the
    // mouth to the highest ground stood the plant at the bottom of a well. The
    // ground at the crown left the downhill lip hanging over the hillside. The
    // stretch-and-clamp pair that followed kept the lip on the hill by squashing
    // the wall's height profile, which turned a cut through earth into a dish.
    // The lowest ground is the one anchor that lets every rim vertex reach its
    // own ground by moving up - no stretch, no clamp, no dish.
    const surface = (x: number): number => 0.5 * x;
    const { bowl, clip } = clipOf(new THREE.Vector3(0, 5, 0), surface);
    const position = bowl.geometry.getAttribute('position');
    const columns = bowl.geometry.userData.cols as number;
    assert.ok(columns > 0, 'the bowl did not publish its column count');
    let above = 0;
    for (let i = 0; i < columns; i += 1) {
      const worldX = bowl.position.x + position.getX(i) * bowl.scale.x;
      const worldY = position.getY(i) * bowl.scale.y + bowl.position.y;
      assert.ok(
        Math.abs(worldY - (surface(worldX) - CAVITY_RIM_SINK_M)) < 1e-6,
        `lip vertex is ${(worldY - surface(worldX)).toFixed(3)} m off its ground`,
      );
      if (worldY > bowl.position.y + 0.05) above += 1;
      assert.ok(position.getY(i) >= 0, 'a lip vertex was pushed below the mouth');
    }
    assert.ok(above > 0, 'the rim never rose up the bank, so it is a level ring again');
    assert.equal(clip.uBowlCenter.value.y, bowl.position.y);
  });
});

describe('cavity depth', () => {
  const depthOf = (deepestRootY?: number): number => {
    const bowl = createCavityBowl(new THREE.Color('#3a2a1c'), new THREE.Color('#6a5440'), 24, 12);
    const centre = new THREE.Vector3(0, 0, 0);
    updateCavityBowl(bowl, centre, 2, 1, () => 0, undefined, 1.2, deepestRootY);
    // Measured from the mouth plane, not from the lowest vertex: on a slope the
    // rim is the lowest part of the shell.
    return floorDepthOf(bowl);
  };

  it('reaches below the deepest root, not just below the mouth', () => {
    const depth = depthOf(-7.4);
    assert.ok(
      depth >= 7.4 + CAVITY_FLOOR_CLEARANCE_M - 1e-6,
      `floor at ${depth.toFixed(2)} m does not clear a root at 7.4 m`,
    );
  });

  it('keeps the dug-pit proportion when the roots are shallow', () => {
    const depth = depthOf(-0.2);
    assert.ok(
      Math.abs(depth - 1.2 * CAVITY_DEPTH_TO_MOUTH) < 1e-6,
      `shallow roots shrank the pit to ${depth.toFixed(2)} m`,
    );
  });
});

describe('silhouetteKeepsFragment', () => {
  const centre = { x: 0, z: 0 };
  const surfaceY = 0;

  it('drops a far-wall fragment whose sightline surfaces outside the hole', () => {
    // Eye 6 m up: the ray to a fragment 2 m down and 3 m beyond the axis crosses
    // the surface plane 2.25 m out, well outside a 1 m opening.
    assert.equal(
      silhouetteKeepsFragment({ x: 0, y: 6, z: 0 }, { x: 0, y: -2, z: -3 }, surfaceY, centre, 1),
      false,
    );
  });

  it('keeps a fragment the eye reaches through the opening', () => {
    assert.equal(
      silhouetteKeepsFragment({ x: 0, y: 6, z: 0 }, { x: 0, y: -2, z: -0.5 }, surfaceY, centre, 1),
      true,
    );
  });

  it('drops the far wall from a low eye beside the pit, which is what hid the water', () => {
    // Eye 7 m out and only 1.2 m up. The shell's silhouette used to paint past
    // the rim; this ray surfaces 1.57 m beyond the axis, outside the 1 m hole.
    assert.equal(
      silhouetteKeepsFragment(
        { x: 0, y: 1.2, z: -7 },
        { x: 0, y: -0.2, z: 3 },
        surfaceY,
        centre,
        1,
      ),
      false,
    );
  });
});

describe('the shell never stands above the mouth', () => {
  it('drops fragments above the mouth plane outside the mouth, in every mode', () => {
    // An eye at the rim counts as inside the cavity, so the mode-based clips above
    // never ran and the shell painted its own back in the open beside the hole.
    // From the rim that is the dark band across the far lip. The rule is stated
    // with named constants so neither number can drift back into a literal.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'cavity', 'bowlMesh.ts'),
      'utf8',
    );
    assert.ok(source.includes('BOWL_SHELL_ABOVE_MOUTH_M = 0.02'), 'the slack is named');
    // Past the cut's overreach, not short of it. At 0.98 the cap discarded the
    // lip's outer two per cent - the sliver that reaches the soil's edge - and
    // the sky behind it showed as a pale dotted seam around the pit.
    assert.ok(source.includes('BOWL_MOUTH_KEEP_FRACTION = 1.03'), 'the keep radius is named');
    const rule = /vBowlWorldPosition\.y > uBowlSurfaceY \+ BOWL_SHELL_ABOVE_MOUTH_M/;
    assert.match(source, rule, 'the shell is no longer capped at the mouth plane');
    assert.match(
      source,
      /distance\(vBowlWorldPosition\.xz, uBowlApertureCenter\) >\s*uBowlApertureRadius \* BOWL_MOUTH_KEEP_FRACTION/,
      'the cap no longer spares the opening',
    );
  });
});

describe('silhouette clip in the shader', () => {
  it('tests the ray on both sides of the surface plane', () => {
    // GLSL cannot be unit-tested here, so guard the one character that decided
    // the side view: with `dy > 0` every fragment below an eye above the ground
    // skipped the test, and the wall painted past the rim over the water behind.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'cavity', 'bowlMesh.ts'),
      'utf8',
    );
    assert.ok(
      source.includes('if (abs(dy) > 1e-4)'),
      'the silhouette clip skips eyes above the surface again - the wall will paint past the rim',
    );
  });
});

describe('the pit reads as a shaft from above', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'cavity', 'bowlMesh.ts'),
    'utf8',
  );

  it('blends the grain to a plane on the floor, so the axis has no spokes', () => {
    // The grain chart is a cylinder: angle x the mouth radius. At the centre the
    // angle sweeps a full turn within centimetres, so the noise there was 96
    // radial spokes converging on the floor - a grey plate with a spoke pattern,
    // measured straight down at 2.5 m and 4.9 m mouths.
    assert.match(source, /float bowlAxis = smoothstep\(0\.10, 0\.55, bowlRadius/);
    assert.match(
      source,
      /mix\(\s*vBowlWorldPosition\.xz,\s*vec2\(bowlArc, vBowlWorldPosition\.y\),\s*bowlAxis\s*\)/,
      'the floor is charted cylindrically again - the spokes are back',
    );
    // Both charts are metres, so the clods keep their size across the join.
    assert.match(
      source,
      /float bowlArc = atan\(bowlAway\.y, bowlAway\.x\) \* max\(uBowlApertureRadius/,
    );
  });

  it('darkens the pit with its depth, below the lit rim', () => {
    // Every term in this shader is in the shell's own units, so 14 % of darkening
    // spread over the whole profile changed nothing over the 5.7-9.5 m of wall an
    // eye above the lip can see: the disc read flat at every mouth size.
    assert.ok(source.includes('const BOWL_DEPTH_FALLOFF = 0.45'), 'the falloff is named');
    assert.match(
      source,
      /\(1\.0 - BOWL_DEPTH_FALLOFF \* smoothstep\(0\.10, 1\.0, bowlDepth\)\)/,
      'the depth falloff is flat again - the floor will read as a plate',
    );
    assert.match(
      source,
      /const float BOWL_DEPTH_FALLOFF = \$\{BOWL_DEPTH_FALLOFF\.toFixed\(3\)\};/,
    );
  });
});

describe("the rim casts the pit's own shadow", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'cavity', 'bowlMesh.ts'),
    'utf8',
  );

  it('follows the sun ray to the mouth and shadows where it leaves outside it', () => {
    // Analytic, no shadow map: from a fragment in the pit, walk towards the sun
    // to the mouth's plane; if that point is outside the opening, the soil round
    // the mouth is between it and the sun.
    assert.match(source, /uniform vec3 uBowlSun;/);
    assert.match(source, /if \(uBowlSun\.y > 0\.03\)/);
    assert.match(
      source,
      /vec2 bowlExit = vBowlWorldPosition\.xz \+ uBowlSun\.xz \* \(bowlRise \/ uBowlSun\.y\);/,
    );
    assert.match(
      source,
      /float bowlExitGap = distance\(bowlExit, uBowlApertureCenter\) - uBowlApertureRadius;/,
    );
    assert.match(source, /\(1\.0 - BOWL_LIP_SHADOW \* bowlLipShadow\)/);
  });

  it('takes the sun the ground and the sky take', () => {
    // One sun: the renderer writes the bowl's uniform from `bodies.sunDir`, the
    // same vector the sky dome and the ground read, so the shadow cannot fall on
    // the sunward side.
    const renderer = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'EnvironmentRenderer.ts'),
      'utf8',
    );
    assert.match(renderer, /setCavityBowlSun\(this\.cavityBowl, this\.bodies\.sunDir\)/);
  });
});

describe('which bowl skin the eye sees', () => {
  const bowlAt = (eye: THREE.Vector3): THREE.MeshBasicMaterial => {
    const bowl = createCavityBowl(new THREE.Color('#3a2a1c'), new THREE.Color('#6a5440'), 24, 12);
    updateCavityBowl(bowl, new THREE.Vector3(0, 0, 0), 2, 1, () => 0, eye, 1.2);
    return bowl.material as THREE.MeshBasicMaterial;
  };

  it('draws both skins, so no view angle loses the wall', () => {
    // A single-sided shell was culled from whichever direction the eye happened
    // to be: the walls only showed when the camera was moved down and pointed
    // up at the one skin that faced it.
    for (const eye of [
      new THREE.Vector3(0, 5, 0),
      new THREE.Vector3(0, -0.3, 0),
      new THREE.Vector3(2.4, -0.7, 0),
    ]) {
      assert.equal(bowlAt(eye).side, THREE.DoubleSide);
    }
  });

  it('cuts away the half of the shell between the eye and the cavity', () => {
    // Both skins minus the near half is what makes the far wall the inside of
    // the cavity from every angle; without it the near wall hides the pit.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'cavity', 'bowlMesh.ts'),
      'utf8',
    );
    assert.match(source, /vec3 bowlToEye = uBowlEye - uBowlCenter;/);
    assert.match(
      source,
      /if \(dot\(vBowlWorldPosition - uBowlCenter, bowlToEye\) > 0\.0\) discard;/,
    );
  });
});

/** How far the floor sits below the mouth plane, metres. */
function floorDepthOf(bowl: THREE.Mesh): number {
  const position = bowl.geometry.getAttribute('position');
  let floorY = bowl.position.y;
  for (let i = 0; i < position.count; i += 1) {
    if (Math.abs(position.getY(i)) < 1e-4) continue; // rim ring: not the floor
    floorY = Math.min(floorY, bowl.position.y + position.getY(i) * bowl.scale.y);
  }
  return bowl.position.y - floorY;
}

/** Lowest point of the shell, in its own local units. */
function lowestLocalY(bowl: THREE.Mesh): number {
  const position = bowl.geometry.getAttribute('position');
  let lowest = 0;
  for (let i = 0; i < position.count; i += 1) lowest = Math.min(lowest, position.getY(i));
  return lowest;
}

/** World height of a rim vertex, and the ground it should be buried in. */
function rimSamples(
  bowl: THREE.Mesh,
  centre: THREE.Vector3,
  surface: (x: number, z: number) => number,
) {
  const rim: number[] = bowl.userData.rimIndices as number[];
  assert.ok(rim.length > 0, 'the bowl has no rim vertices');
  const position = bowl.geometry.getAttribute('position');
  return rim.map((index) => {
    const worldX = centre.x + position.getX(index) * bowl.scale.x;
    const worldZ = centre.z + position.getZ(index) * bowl.scale.z;
    const worldY = bowl.position.y + position.getY(index) * bowl.scale.y;
    return {
      localY: position.getY(index),
      worldY,
      ground: surface(worldX, worldZ) - CAVITY_RIM_SINK_M,
    };
  });
}

describe('the bowl wall takes the rim travel out of the depth', () => {
  it('subtracts the rim relief, so rim-to-floor stays the budget', () => {
    for (const [depth, relief] of [
      [4.75, 0],
      [4.75, 0.9],
      [9.31, 3.0],
      [1.2, 0.1],
    ]) {
      const wall = bowlVerticalScale(depth, relief) * CAVITY_PROFILE_DEPTH;
      assert.ok(
        Math.abs(wall + relief - depth) < 1e-9,
        `wall ${wall} + relief ${relief} != ${depth}`,
      );
    }
  });

  it('never inverts the wall, even when the relief is the whole budget', () => {
    assert.ok(bowlVerticalScale(2.66, 17) > 0);
    assert.ok(bowlVerticalScale(2.66, Number.NaN) > 0);
    assert.ok(bowlVerticalScale(0, 0) > 0);
  });
});

describe('terrain-following cavity rim', () => {
  it('keeps every rim vertex on or under the ground it cuts through', () => {
    const bowl = createCavityBowl(new THREE.Color('#3a2a1c'), new THREE.Color('#6a5440'), 24, 12);
    const centre = new THREE.Vector3(0, 0, 0);
    const surface = (x: number, z: number): number => 0.5 * x - 0.2 * z;
    updateCavityBowl(bowl, centre, 2, 1, surface);

    for (const sample of rimSamples(bowl, centre, surface)) {
      assert.ok(
        Math.abs(sample.worldY - sample.ground) < 1e-3,
        `rim vertex sits ${(sample.worldY - sample.ground).toFixed(3)} m off its ground`,
      );
    }
  });

  it('spends a bank on the wall, so the pit is still the depth the roots asked for', () => {
    const bowl = createCavityBowl(new THREE.Color('#3a2a1c'), new THREE.Color('#6a5440'), 24, 12);
    const centre = new THREE.Vector3(0, 0, 0);
    const bank = (x: number, z: number): number => 0.6 * x - 0.2 * z;
    updateCavityBowl(bowl, centre, 2, 1, bank);

    // A 1.4 m mouth wants a 2.66 m pit (the mouth's own depth rule). The rim's
    // travel up this bank is part of that 2.66 m, not extra on top of it: the
    // floor has to land on the depth the soil's cut was built to, or the pit and
    // the earth body it is cut into end up with two floors.
    const wanted = 2 * CAVITY_MOUTH_FRACTION * CAVITY_DEPTH_TO_MOUTH;
    const rim = rimSamples(bowl, centre, bank);
    const highestRim = Math.max(...rim.map((sample) => sample.worldY));
    const floorY = bowl.position.y + lowestLocalY(bowl) * bowl.scale.y;
    assert.ok(
      Math.abs(highestRim - floorY - wanted) < 1e-6,
      `rim-to-floor is ${(highestRim - floorY).toFixed(3)} m, wanted ${wanted.toFixed(3)} m`,
    );
    assert.ok(Math.abs(floorDepthOf(bowl) - wanted) > 0.05, 'the bank cost the wall nothing');
    for (const sample of rim) {
      assert.ok(
        Math.abs(sample.worldY - sample.ground) < 1e-3,
        `rim vertex sits ${(sample.worldY - sample.ground).toFixed(3)} m off the bank`,
      );
    }
  });

  it('keeps a positive wall when the cliff is wider than the pit is deep', () => {
    const bowl = createCavityBowl(new THREE.Color('#3a2a1c'), new THREE.Color('#6a5440'), 24, 12);
    const centre = new THREE.Vector3(0, 0, 0);
    const cliff = (x: number, z: number): number => 6 * x - z;
    updateCavityBowl(bowl, centre, 2, 1, cliff);

    // No scale can make this mouth 2.66 m deep and still reach both lips: the
    // rim alone spans more than that. The shell keeps a positive wall instead of
    // inverting, and the floor stays under the lowest lip.
    assert.ok(bowl.scale.y > 0, 'the wall inverted');
    const lowestRim = Math.min(...rimSamples(bowl, centre, cliff).map((s) => s.worldY));
    assert.ok(
      bowl.position.y + lowestLocalY(bowl) * bowl.scale.y < lowestRim,
      'the floor is above the lowest rim vertex',
    );
  });

  it('keeps the lip on a walkable bank', () => {
    const bowl = createCavityBowl(new THREE.Color('#3a2a1c'), new THREE.Color('#6a5440'), 24, 12);
    const centre = new THREE.Vector3(0, 0, 0);
    const bank = (x: number, z: number): number => x - 0.3 * z;
    updateCavityBowl(bowl, centre, 2, 1, bank);
    for (const sample of rimSamples(bowl, centre, bank)) {
      assert.ok(
        Math.abs(sample.worldY - sample.ground) < 1e-3,
        `rim vertex sits ${(sample.worldY - sample.ground).toFixed(2)} m off the bank`,
      );
    }
  });
});
