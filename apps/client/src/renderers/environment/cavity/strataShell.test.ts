/**
 * The dug wall is geometry, not paint: bands, hard layer edges, real relief.
 *
 * These guard the three things that make it read as layered earth - a ring table
 * with one course per band, a doubled ring at every boundary so a colour change
 * is an edge rather than a gradient, and displacement below the lip that leaves
 * the lip itself exactly on the cut.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAVITY_PROFILE_DEPTH, CAVITY_STRATA_BANDS } from './profile.ts';
import { buildStrataShell, clodRelief, profileRadiusAt, strataRings } from './strataShell.ts';

const COLORS: [number, number, number][] = [
  [0.4, 0.3, 0.2],
  [0.28, 0.22, 0.16],
  [0.16, 0.13, 0.1],
];

describe('strata shell', () => {
  it('gives the wall one band per stratum, with a hard edge at each boundary', () => {
    const rings = strataRings(CAVITY_STRATA_BANDS, 3);
    const bands = new Set(rings.map((ring) => ring.band));
    assert.equal(bands.size, CAVITY_STRATA_BANDS.length, 'a stratum is missing its wall');

    for (const band of CAVITY_STRATA_BANDS.slice(1)) {
      const atBoundary = rings.filter(
        (ring) => Math.abs(-ring.y / CAVITY_PROFILE_DEPTH - band.from) < 0.01,
      );
      assert.ok(atBoundary.length >= 2, `stratum ${band.from} has no doubled ring`);
    }
  });

  it('leaves the lip exactly on the cut and displaces the wall below it', () => {
    const shell = buildStrataShell({ bands: CAVITY_STRATA_BANDS, colors: COLORS, cols: 64 });
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

  it('colours each band differently, so the layers are visible', () => {
    const shell = buildStrataShell({ bands: CAVITY_STRATA_BANDS, colors: COLORS, cols: 32 });
    const perRing: number[] = [];
    for (let r = 0; r < shell.ringCount; r += 1) {
      perRing.push(shell.colors[(r * shell.cols + 0) * 3]);
    }
    assert.ok(Math.max(...perRing) - Math.min(...perRing) > 0.05, 'every band is the same brown');
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
