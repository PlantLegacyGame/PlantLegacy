import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SurfaceWaterGrid } from './surfaceWater.ts';

const COLS = 8;
const ROWS = 8;
const CELL = 1;

/** Flat ground. */
function flat(height = 0): SurfaceWaterGrid {
  return new SurfaceWaterGrid(new Float32Array(COLS * ROWS).fill(height), COLS, ROWS, CELL);
}

/** A bowl: edges high, centre cell low. */
function bowl(): Float32Array {
  const heights = new Float32Array(COLS * ROWS);
  for (let z = 0; z < ROWS; z += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const dx = x - COLS / 2 + 0.5;
      const dz = z - ROWS / 2 + 0.5;
      heights[z * COLS + x] = Math.hypot(dx, dz) * 0.4;
    }
  }
  return heights;
}

describe('surface water', () => {
  it('starts dry and stays dry without rain', () => {
    const grid = flat();
    grid.step(0.1);
    assert.equal(grid.totalVolumeM3(), 0);
  });

  it('ponds in the lowest cell and spreads outwards as it fills', () => {
    const grid = new SurfaceWaterGrid(bowl(), COLS, ROWS, CELL);
    const centre = 4 * COLS + 4;
    grid.depth[centre] = 0.5;
    // Disable losses so the test is about flow only.
    for (let i = 0; i < 200; i += 1) {
      grid.step(0.05, { infiltrationPerS: 0, evaporationPerS: 0 });
    }
    assert.ok(grid.depth[centre] > 0, 'water stays at the bottom');
    let wetted = 0;
    for (let i = 0; i < grid.depth.length; i += 1) if (grid.depth[i] > 1e-4) wetted += 1;
    assert.ok(wetted > 1, `water spreads over neighbours (${wetted} cells)`);
    // Rim cells are much higher than the centre, so they stay dry.
    assert.equal(grid.depth[0], 0);
  });

  it('conserves mass between cells while flowing', () => {
    const grid = new SurfaceWaterGrid(bowl(), COLS, ROWS, CELL);
    const before = 2.0;
    grid.depth[4 * COLS + 4] = before;
    const initialVolume = grid.totalVolumeM3();
    for (let i = 0; i < 20; i += 1) {
      // The depth cap is a storage limit, not a leak: lift it above the test
      // volume so only the flow itself is being measured.
      grid.step(0.02, { infiltrationPerS: 0, evaporationPerS: 0, maxDepthM: 5 });
    }
    assert.ok(
      Math.abs(grid.totalVolumeM3() - initialVolume) < 1e-4,
      `mass drifted: ${initialVolume} -> ${grid.totalVolumeM3()}`,
    );
  });

  it('drains downhill on a slope instead of pooling on the crest', () => {
    const heights = new Float32Array(COLS * ROWS);
    for (let z = 0; z < ROWS; z += 1) {
      for (let x = 0; x < COLS; x += 1) heights[z * COLS + x] = -x * 0.5;
    }
    const grid = new SurfaceWaterGrid(heights, COLS, ROWS, CELL);
    grid.depth[0] = 0.4; // high side
    for (let i = 0; i < 100; i += 1) {
      grid.step(0.1, { infiltrationPerS: 0, evaporationPerS: 0 });
    }
    assert.ok(grid.depth[0] < 0.01, 'the crest empties');
    assert.ok(grid.depth[COLS - 1] > 0.01, 'the low side collects it');
  });

  it('soaks water into the soil and reports the volume', () => {
    const grid = flat();
    grid.addRain(0.1);
    const result = grid.step(1, { infiltrationPerS: 0.05, evaporationPerS: 0 });
    assert.ok(result.infiltratedM3 > 0);
    assert.ok(Math.abs(grid.totalVolumeM3() - (0.1 * COLS * ROWS - result.infiltratedM3)) < 1e-4);
  });

  it('caps the puddle at the configured depth', () => {
    const grid = flat();
    const rejected = grid.addRain(1, { maxDepthM: 0.2 });
    assert.ok(rejected > 0);
    for (let i = 0; i < grid.depth.length; i += 1) assert.ok(grid.depth[i] <= 0.2 + 1e-6);
  });
});
