import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  createPlanetBody,
  createTerrainPatch,
  planetGravity,
  planetSurfaceDrop,
  planetSurfaceFrame,
  planetSurfaceY,
  planetTerrainY,
  planetUp,
  TERRAIN_PATCH_RADIUS_M,
  terrainOffset,
  terrainRelief,
} from './planetSurface.ts';

const RADIUS = 300;

describe('planet surface', () => {
  it('puts the pole at the tangent plane and drops away from it', () => {
    assert.equal(planetSurfaceDrop(RADIUS, 0, 0), 0);
    assert.equal(planetSurfaceY(RADIUS, 0, 0), 0);

    const near = planetSurfaceDrop(RADIUS, 10, 0);
    const far = planetSurfaceDrop(RADIUS, 40, 0);
    assert.ok(near > 0);
    assert.ok(far > near);
    // r = 50 on a 300 m planet: 300 - sqrt(300² - 50²) ≈ 4.2 m.
    assert.ok(Math.abs(planetSurfaceDrop(RADIUS, 50, 0) - 4.19) < 0.05);
  });

  it('is symmetric in every direction around the pole', () => {
    assert.equal(planetSurfaceDrop(RADIUS, 20, 0), planetSurfaceDrop(RADIUS, 0, 20));
    assert.equal(planetSurfaceDrop(RADIUS, 12, 16), planetSurfaceDrop(RADIUS, 16, -12));
  });

  it('clamps past the horizon instead of returning NaN', () => {
    assert.equal(planetSurfaceDrop(RADIUS, RADIUS + 10, 0), RADIUS);
    assert.equal(planetSurfaceDrop(0, 10, 10), 0);
    assert.equal(planetSurfaceDrop(RADIUS, Number.NaN, 0), 0);
  });

  it('places surface points exactly on the sphere and normals point outward', () => {
    for (const [x, z] of [
      [0, 0],
      [10, -5],
      [40, 40],
    ]) {
      const { point, normal } = planetSurfaceFrame(RADIUS, x, z);
      const centre = { y: -RADIUS };
      const distance = Math.hypot(point.x, point.y - centre.y, point.z);
      assert.ok(Math.abs(distance - RADIUS) < 1e-6);
      assert.ok(Math.abs(normal.length() - 1) < 1e-9);
      assert.ok(normal.y > 0);
      // Point minus centre must be radial.
      assert.ok(Math.abs(point.x - normal.x * RADIUS) < 1e-6);
      assert.ok(Math.abs(point.z - normal.z * RADIUS) < 1e-6);
    }
  });

  it('lifts a point along the surface normal by the requested altitude', () => {
    const { point } = planetSurfaceFrame(RADIUS, 20, 20, 0.5);
    assert.ok(point.y > planetSurfaceY(RADIUS, 20, 20));
  });

  it('gives gravity that points at the planet centre, opposite the surface up', () => {
    const up = planetUp(RADIUS, 30, -20);
    const gravity = planetGravity(RADIUS, 30, -20);
    assert.ok(Math.abs(up.length() - 1) < 1e-9);
    assert.ok(gravity.x === -up.x && gravity.y === -up.y && gravity.z === -up.z);

    const point = planetSurfaceFrame(RADIUS, 30, -20).point;
    const toCentre = { x: -point.x, y: -RADIUS - point.y, z: -point.z };
    const length = Math.hypot(toCentre.x, toCentre.y, toCentre.z);
    const dot = (gravity.x * toCentre.x + gravity.y * toCentre.y + gravity.z * toCentre.z) / length;
    assert.ok(Math.abs(dot - 1) < 1e-9);
  });

  it('adds relief that is deterministic, bounded and actually varied', () => {
    assert.equal(terrainOffset(12.5, -3.25, 0.35), terrainOffset(12.5, -3.25, 0.35));
    assert.equal(terrainOffset(10, 10, 0), 0);

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = -40; i <= 40; i += 1) {
      for (let j = -40; j <= 40; j += 1) {
        const offset = terrainOffset(i * 3.7, j * 2.9, 0.35);
        assert.ok(Math.abs(offset) <= 0.35 + 1e-9);
        min = Math.min(min, offset);
        max = Math.max(max, offset);
      }
    }
    assert.ok(max - min > 0.2, 'terrain has no relief');
  });

  it('puts the relief on top of the sphere drop and fades it out at the rim', () => {
    const x = 5;
    const z = -3;
    const expected = planetSurfaceY(RADIUS, x, z) + terrainRelief(x, z, 2.4);
    assert.ok(Math.abs(planetTerrainY(RADIUS, x, z, 2.4) - expected) < 1e-12);
    assert.equal(planetTerrainY(RADIUS, x, z, 0), planetSurfaceY(RADIUS, x, z));
    // Past the patch the ground is the sphere again, so the patch rim is seamless.
    assert.equal(terrainRelief(TERRAIN_PATCH_RADIUS_M + 5, 0, 2.4), 0);
  });

  it('carries the relief on a metre-scale patch instead of the planet sphere', () => {
    const amplitude = 2.4;
    const patch = createTerrainPatch(RADIUS, amplitude, new THREE.MeshBasicMaterial());
    const cellSize =
      (TERRAIN_PATCH_RADIUS_M * 2) / (Math.sqrt(patch.geometry.getAttribute('position').count) - 1);
    assert.ok(cellSize < 3, `terrain cells are ${cellSize.toFixed(1)} m across`);

    const positions = patch.geometry.getAttribute('position');
    let spread = 0;
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const relief = positions.getY(i) - Math.sqrt(Math.max(RADIUS ** 2 - (x * x + z * z), 0));
      // Raise-only: the sphere stays the physics floor, so no vertex may dip
      // below it, and none may exceed the configured amplitude.
      assert.ok(relief >= -1e-3, `terrain dips ${relief.toFixed(3)} m below the sphere`);
      assert.ok(relief <= amplitude + 0.05, `terrain rises ${relief.toFixed(2)} m`);
      spread = Math.max(spread, relief);
    }
    assert.ok(spread > amplitude * 0.8, `patch only rises ${spread.toFixed(2)} m`);

    const planet = createPlanetBody(RADIUS, new THREE.MeshBasicMaterial());
    const planetPositions = planet.geometry.getAttribute('position');
    let offSphere = 0;
    for (let i = 0; i < planetPositions.count; i += 1) {
      const length = Math.hypot(
        planetPositions.getX(i),
        planetPositions.getY(i),
        planetPositions.getZ(i),
      );
      if (Math.abs(length - RADIUS) > 1e-3) offSphere += 1;
    }
    assert.equal(offSphere, 0);
  });

  it('uses one sphere as the whole ground, with its pole on the play plane', () => {
    // The ground is the planet, not a cap over a body: one surface means no seam
    // and no edge to walk off. The body is pushed down by its own radius so the
    // pole sits at y = 0, where the play area's tangent plane is.
    const mesh = createPlanetBody(RADIUS, new THREE.MeshBasicMaterial());
    assert.equal(mesh.position.y, -RADIUS);

    const positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 1) {
      const distance = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
      assert.ok(Math.abs(distance - RADIUS) < 1e-3, `vertex ${i} is off the sphere`);
    }
  });

  it('covers the planet continuously instead of stopping at an edge', () => {
    // A cap had a rim the player could reach; a sphere has none, so the surface
    // runs all the way round and the far side is covered too.
    const mesh = createPlanetBody(RADIUS, new THREE.MeshBasicMaterial());
    const positions = mesh.geometry.getAttribute('position');
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < positions.count; i += 1) {
      lowest = Math.min(lowest, positions.getY(i));
    }
    assert.ok(Math.abs(lowest + RADIUS) < 1e-2);
  });
});
