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

  it('keeps moving when the level is already flat, like water and not a spread', () => {
    // A drop in a bowl runs up the far side before it settles. The old solver
    // levelled the two cells and stopped dead in the same pass, which is the
    // difference between a liquid and a diffusion.
    const grid = new SurfaceWaterGrid(bowl(), COLS, ROWS, CELL);
    grid.depth[4 * COLS + 4] = 0.5;
    for (let i = 0; i < 40; i += 1) {
      grid.step(0.02, { infiltrationPerS: 0, evaporationPerS: 0 });
    }
    let highest = 0;
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < grid.depth.length; i += 1) {
      highest = Math.max(highest, grid.depth[i]);
      lowest = Math.min(lowest, grid.depth[i]);
    }
    assert.ok(highest - lowest > 0.01, 'a wave is still travelling');
  });

  it('cannot rise past a roof, and loses nothing trying', () => {
    // An aquifer under a lid: the roof is a wall, not a depth suggestion.
    const heights = new Float32Array(COLS * ROWS).fill(0);
    const roof = new Float32Array(COLS * ROWS).fill(0.5);
    const grid = new SurfaceWaterGrid(heights, COLS, ROWS, CELL, { roof });
    grid.addRain(2, { maxDepthM: 3 });
    for (let i = 0; i < 30; i += 1)
      grid.step(0.05, { infiltrationPerS: 0, evaporationPerS: 0, maxDepthM: 3 });
    const expected = 0.5 * COLS * ROWS;
    assert.ok(Math.abs(grid.totalVolumeM3() - expected) < 1e-4, 'the roof leaked');
    for (let i = 0; i < grid.depth.length; i += 1) assert.ok(grid.depth[i] <= 0.5 + 1e-6);
  });

  it('stacks a body under another one and moves water between them', () => {
    const ground = new Float32Array(COLS * ROWS).fill(0);
    const surface = new SurfaceWaterGrid(ground, COLS, ROWS, CELL);
    // A cave river two metres down, with a metre of headroom under its roof.
    const caveBed = new Float32Array(COLS * ROWS).fill(-2);
    const caveRoof = new Float32Array(COLS * ROWS).fill(-1);
    const cave = new SurfaceWaterGrid(caveBed, COLS, ROWS, CELL, { roof: caveRoof });
    const all = new Uint8Array(COLS * ROWS).fill(1);

    surface.depth[0] = 0.1;
    cave.depth[1] = 0.05;
    const down = surface.exchange(cave, {
      dt: 1,
      ratePerS: 0.01,
      direction: 'down',
      connection: all,
    });
    assert.ok(down.outM3 > 0, 'nothing percolated');
    assert.ok(cave.depth[1] > 0.05);
    assert.ok(cave.depth[0] > 0, 'the cave takes what the surface gives it');

    // Only the spring cell is open upward; elsewhere the rock holds.
    const spring = new Uint8Array(COLS * ROWS);
    spring[2] = 1;
    // The cave stream stands at the outcrop: a spring has to have something to
    // give before the rock can hold it back anywhere else.
    cave.depth[2] = 0.4;
    const before = surface.totalVolumeM3();
    const caveBefore = cave.totalVolumeM3();
    // 'up' from the surface's side means the other body - the cave - gives.
    const up = surface.exchange(cave, {
      dt: 1,
      ratePerS: 0.2,
      direction: 'up',
      connection: spring,
    });
    assert.ok(up.inM3 > 0, 'the spring stayed dry');
    assert.ok(surface.depth[2] > 0);
    assert.ok(Math.abs(surface.totalVolumeM3() - before - up.inM3) < 1e-6);
    assert.ok(cave.totalVolumeM3() < caveBefore, 'the spring is fed by the cave');
    assert.ok(cave.depth[2] >= 0, 'the cave level never goes negative');
  });

  it('caps the puddle at the configured depth', () => {
    const grid = flat();
    const rejected = grid.addRain(1, { maxDepthM: 0.2 });
    assert.ok(rejected > 0);
    for (let i = 0; i < grid.depth.length; i += 1) assert.ok(grid.depth[i] <= 0.2 + 1e-6);
  });
});
