/** Standing water has to behave like water, not like a drawn shape. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfaceWaterField } from './surfaceWaterField.ts';

const STEP = 1 / 20;

/** A bowl four metres across, with the rim a half metre higher. */
const bowl = (x: number, z: number): number => (x * x + z * z < 9 ? -0.2 : 0.3);

test('rain runs off the bank and pools in the hollow', () => {
  const field = createSurfaceWaterField({ cells: 24, extentM: 12, dampHaloCells: 0 });
  field.setTerrainSampler(bowl);
  field.update(STEP, 0, 0, 1);
  field.addRain(0.02);
  for (let i = 0; i < 200; i += 1) field.update(STEP, 0, 0, 0);
  const depth = field.depthAt(0.5, 0.5);
  const bank = field.depthAt(11, 11);
  assert.ok(depth > 0.001, `the hollow holds water (got ${depth})`);
  assert.ok(depth > bank, `the hollow holds more than the bank (${depth} vs ${bank})`);
  assert.ok(field.coverage() > 0 && field.coverage() <= 1);
});

test('the texture carries the water surface above the ground it covers', () => {
  const field = createSurfaceWaterField({ cells: 24, extentM: 12, dampHaloCells: 0 });
  field.setTerrainSampler(bowl);
  field.update(STEP, 0, 0, 1);
  field.addRain(0.02);
  for (let i = 0; i < 200; i += 1) field.update(STEP, 0, 0, 0);
  const data = field.texture.image.data as Float32Array;
  // Cell (12, 12) covers world (0.5, 0.5): the middle of the bowl.
  const index = (12 * field.cells + 12) * 4;
  const surface = data[index] ?? 0;
  const depth = data[index + 2] ?? 0;
  assert.ok(Math.abs(surface - (bowl(0.5, 0.5) + depth)) < 1e-5);
  assert.ok(depth > 0.001);
  // Every wet cell is also damp, which is what draws the shoreline.
  assert.ok((data[index + 1] ?? 0) > 0);
});

test('snow settles where it falls instead of running downhill', () => {
  const field = createSurfaceWaterField({ cells: 24, extentM: 12, dampHaloCells: 0 });
  field.setTerrainSampler(bowl);
  field.update(STEP, 0, 0, 1);
  field.setMode('snow');
  for (let i = 0; i < 400; i += 1) field.update(STEP, 0, 0, 1);
  const hollow = field.depthAt(0.5, 0.5);
  const bank = field.depthAt(9, 9);
  assert.ok(hollow > 0.0005, `the drift builds (got ${hollow})`);
  // A drift is as deep on the bank as in the dip: no flow, so no pooling.
  assert.ok(Math.abs(hollow - bank) < 0.004, `flat cover (${hollow} vs ${bank})`);
  assert.equal(field.mode(), 'snow');
});

test('disposing the field releases both the surface and cave textures', () => {
  const field = createSurfaceWaterField({
    cells: 16,
    extentM: 8,
    dampHaloCells: 0,
    underground: true,
  });
  const cave = field.underground;
  assert.ok(cave);
  let surfaceDisposed = 0;
  let caveDisposed = 0;
  field.texture.addEventListener('dispose', () => {
    surfaceDisposed += 1;
  });
  cave.texture.addEventListener('dispose', () => {
    caveDisposed += 1;
  });
  field.dispose();
  assert.equal(surfaceDisposed, 1);
  assert.equal(caveDisposed, 1, 'the cave texture leaked');
});

test('the field follows the player without draining what it carries', () => {
  const field = createSurfaceWaterField({ cells: 24, extentM: 12, dampHaloCells: 0 });
  field.setTerrainSampler(bowl);
  field.update(STEP, 0, 0, 1);
  field.addRain(0.02);
  for (let i = 0; i < 100; i += 1) field.update(STEP, 0, 0, 0);
  const before = field.volumeM3();
  assert.ok(before > 0);
  // A step of a few metres re-centres the grid; the water it still covers
  // comes with it instead of being thrown away under the player's feet.
  field.update(STEP, 6, 0, 0);
  assert.ok(Math.abs(field.volumeM3() - before) <= before * 0.25);
  assert.ok(field.originX < 0);
});
