import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFlatAddressing,
  createSphericalAddressing,
  createTileAddressing,
} from './tileAddressing.ts';

const bounds = { minX: -4, maxX: 4, minZ: -4, maxZ: 4 };

test('flat addressing maps a point to its tile and back to the tile centre', () => {
  const flat = createFlatAddressing(bounds, 8, 8, 1);
  assert.equal(flat.kind, 'flat');
  const key = flat.keyFor(-3.2, 0.4);
  assert.equal(key, '0:4');
  assert.deepEqual(flat.centreOf(key), { x: -3.5, z: 0.5 });
});

test('flat addressing stops at the array edge and clamps out-of-bounds points', () => {
  const flat = createFlatAddressing(bounds, 8, 8, 1);
  assert.deepEqual(flat.neighboursOf('0:0').sort(), ['0:1', '1:0']);
  assert.equal(flat.keyFor(-100, 100), '0:7');
});

test('flat addressing is selected when no planet radius is configured', () => {
  assert.equal(createTileAddressing(bounds, 8, 8, 1, 0).kind, 'flat');
  assert.equal(createTileAddressing(bounds, 8, 8, 1, 100000).kind, 'spherical');
});

test('spherical addressing wraps east and west around the planet', () => {
  const sphere = createSphericalAddressing(100000, 1);
  // One cell per metre: ring 5 holds 35 cells, so 5:34 is the west edge and its
  // east neighbour is 5:0, not a clamp.
  const last = '5:34';
  assert.ok(sphere.neighboursOf(last).includes('5:0'), 'west edge wraps to index 0');
  assert.ok(sphere.neighboursOf('5:0').includes(last), 'east edge wraps to the last cell');
});

test('spherical cells at the pole neighbour themselves and sit close together', () => {
  const sphere = createSphericalAddressing(100000, 1);
  const poleKeys = sphere.neighboursOf('0:0');
  assert.ok(poleKeys.includes('0:0'), 'the pole ring is its own poleward neighbour');
  const centre = sphere.centreOf('0:0');
  assert.ok(Math.hypot(centre.x, centre.z) < 1, 'pole cells sit at the pole');
});

test('spherical addressing survives a point on the far side of the planet', () => {
  const sphere = createSphericalAddressing(100000, 1);
  const key = sphere.keyFor(0, 5000);
  assert.match(key, /^\d+:\d+$/);
  const centre = sphere.centreOf(key);
  assert.ok(Number.isFinite(centre.x) && Number.isFinite(centre.z));
  assert.ok(Math.hypot(centre.x, centre.z) > 1000, 'far side stays far away in flat x/z');
});
