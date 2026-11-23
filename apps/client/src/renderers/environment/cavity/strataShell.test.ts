/**
 * The dug wall is geometry, not paint: bands, hard layer edges, real relief.
 *
 * These guard the things that make it read as layered earth - a ring table with
 * courses of earth and a doubled ring at every stratum boundary, and displacement
 * below the lip that leaves the lip itself exactly on the cut. The colours are
 * not this module's any more: they are chosen per fragment from the config's
 * palette, so the shell must not grow a per-vertex colour back.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAVITY_PROFILE_DEPTH, CAVITY_STRATA_BANDS } from './profile.ts';
import { buildStrataShell, clodRelief, profileRadiusAt, strataRings } from './strataShell.ts';

describe('strata shell', () => {
  it('puts a doubled ring at every stratum boundary', () => {
    const rings = strataRings(CAVITY_STRATA_BANDS, 3);
    // Courses first: a wall of six rings has no strata to speak of.
    assert.ok(
      rings.length > CAVITY_STRATA_BANDS.length * 3,
      `the wall has only ${rings.length} rings`,
    );

    for (const band of CAVITY_STRATA_BANDS.slice(1)) {
      const atBoundary = rings.filter(
        (ring) => Math.abs(-ring.y / CAVITY_PROFILE_DEPTH - band.from) < 0.01,
      );
      assert.ok(atBoundary.length >= 2, `stratum ${band.from} has no doubled ring`);
      assert.ok(
        atBoundary.filter((ring) => ring.boundary).length >= 2,
        `stratum ${band.from} boundary is not marked as a contact`,
      );
    }
  });

  it('leaves the lip exactly on the cut and displaces the wall below it', () => {
    const shell = buildStrataShell({ bands: CAVITY_STRATA_BANDS, cols: 64 });
    // The lip: y = 0 and radius 1 in the shell's own units.
    for (let c = 0; c < shell.cols; c += 1) {
      const i = c * 3;
      assert.equal(shell.positions[i + 1], 0, 'the lip left the mouth plane');
      const radius = Math.hypot(shell.positions[i], shell.positions[i + 2]);
      assert.ok(Math.abs(radius - 1) < 1e-6, `the lip ring is off the cut (${radius})`);
    }
    // The cut wall stays a cylinder: the first course below the lip must not
    // wobble inside the aperture, or slivers of sky open around the mouth.
    const firstCourse: number[] = [];
    for (let c = 0; c < shell.cols; c += 1) {
      const i = (shell.cols + c) * 3;
      firstCourse.push(Math.hypot(shell.positions[i], shell.positions[i + 2]));
    }
    assert.ok(
      Math.max(...firstCourse) - Math.min(...firstCourse) < 1e-6,
      'the cut wall is not cylindrical',
    );
    // Deeper down, where soil surrounds the wall, the same ring is clodded.
    const depthRing = 8;
    const radii: number[] = [];
    for (let c = 0; c < shell.cols; c += 1) {
      const i = (depthRing * shell.cols + c) * 3;
      radii.push(Math.hypot(shell.positions[i], shell.positions[i + 2]));
    }
    assert.ok(Math.max(...radii) - Math.min(...radii) > 1e-4, 'the deep wall has no relief');
  });

  it('carries no per-vertex colour, because the shader owns the strata', () => {
    // The wall used to bake a colour per vertex, which the fragment shader then
    // discarded entirely: the strata are chosen per fragment from the config's
    // palette so the contact is a straight line at a depth instead of a ragged
    // one that follows the clods. A colour buffer here would be dead weight in
    // the geometry, and would drag the program back onto the vertex-colour path.
    const shell = buildStrataShell({ bands: CAVITY_STRATA_BANDS, cols: 32 });
    assert.equal(Object.hasOwn(shell, 'colors'), false, 'the shell bakes colours again');
    assert.equal(shell.positions.length, shell.ringCount * shell.cols * 3);
  });

  it('leaves the floor rings on the profile, so the cap is not scalloped', () => {
    // The same radial wobble that reads as clods on a 1 m wall is a serrated
    // ring where the floor narrows: the cap's edge was a torn grey plate. Rings
    // narrower than 0.7 of the mouth carry no relief, so the floor is the
    // profile's own cone and its edge is a clean circle.
    const shell = buildStrataShell({ bands: CAVITY_STRATA_BANDS, cols: 48 });
    const rings = strataRings(CAVITY_STRATA_BANDS, 3);
    let checked = 0;
    for (let ring = 0; ring < rings.length; ring += 1) {
      if (rings[ring].r > 0.7) continue;
      for (let c = 0; c < shell.cols; c += 1) {
        const i = (ring * shell.cols + c) * 3;
        const radius = Math.hypot(shell.positions[i], shell.positions[i + 2]);
        assert.ok(
          Math.abs(radius - rings[ring].r) < 1e-6,
          `floor ring ${ring} is off the profile by ${(radius - rings[ring].r).toFixed(4)}`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 0, 'no floor ring was checked');
  });

  it('keeps the relief inside the wall, never through it', () => {
    for (let i = 0; i < 64; i += 1) {
      const relief = clodRelief((i / 64) * Math.PI * 2, i / 64, 0.045);
      assert.ok(Math.abs(relief) <= 0.045 + 1e-9, 'a clod pushed the wall past its amplitude');
    }
    // The profile stays a wall: full width down the cut, narrowing to the floor.
    assert.ok(profileRadiusAt(0) > 0.99);
    assert.ok(profileRadiusAt(-CAVITY_PROFILE_DEPTH) < 0.01);
  });
});
