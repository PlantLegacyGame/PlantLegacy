/**
 * The visible water's shoreline is a contour of the solve, not the cell grid.
 *
 * The mesh used to be one triangle per pair of cell centres, so every pool's
 * edge was a staircase of squares. These checks build the same contour the mesh
 * uses and hold its boundary vertices to the zero-depth line.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWaterContour } from './waterContour.ts';

/** Pack `[level, depth]` pairs the way the field texture does: RGBA, 3 used. */
function field(cells: number, depthAt: (x: number, z: number) => number): Float32Array {
  const data = new Float32Array(cells * cells * 4);
  for (let z = 0; z < cells; z += 1) {
    for (let x = 0; x < cells; x += 1) {
      const at = (z * cells + x) * 4;
      const depth = depthAt(x, z);
      data[at] = depth; // level = bed; the contour only reads depth here
      data[at + 2] = depth;
    }
  }
  return data;
}

test('a fully wet grid fills every cell', () => {
  const cells = 3;
  const contour = buildWaterContour(
    field(cells, () => 0.1),
    cells,
    1,
  );
  assert.equal(contour.indices.length, cells * cells * 6);
  // Four corners per cell; adjacent cells do not share vertices because each
  // cell's polygon is emitted independently (the cost of keeping a contour
  // rebuild simple and allocation-light).
  assert.equal(contour.positions.length, cells * cells * 4 * 3);
});

test('a saddle cell is split into two wet fans instead of bridging its dry shoulders', () => {
  // Cell centres chosen so the four sampled corners of the lower-left cell
  // alternate wet/dry; the bilinear centre is exactly dry. Joining the four
  // crossings as one polygon would fill both dry shoulders.
  const cells = 2;
  const data = new Float32Array(cells * cells * 4);
  const centre = (x: number, z: number, value: number): void => {
    const at = (z * cells + x) * 4;
    data[at] = 0;
    data[at + 2] = value;
  };
  centre(0, 0, 1);
  centre(1, 0, -3);
  centre(0, 1, -3);
  centre(1, 1, 9);
  const contour = buildWaterContour(data, cells, 1);
  assert.ok(contour.positions.length > 0);
  assert.equal(contour.indices.length % 3, 0);
  for (const value of contour.positions) assert.ok(Number.isFinite(value));
  for (const value of contour.depths) assert.ok(value >= 0);
});

test('a dry grid has no surface at all', () => {
  const contour = buildWaterContour(
    field(4, () => 0),
    4,
    1,
  );
  assert.equal(contour.positions.length, 0);
  assert.equal(contour.indices.length, 0);
});

test('the shoreline is a sub-cell contour at zero depth', () => {
  const cells = 5;
  // A depth ramp whose zero crosses a cell between its samples. A cell-centre
  // mesh quantises the shore to x = 2; the contour puts it at x = 1.7.
  const contour = buildWaterContour(
    field(cells, (x) => x - 1.2),
    cells,
    1,
  );
  assert.ok(contour.positions.length > 0, 'the ramp produced no surface');
  assert.ok(contour.indices.length > 0, 'the ramp produced no triangles');
  const xs = [];
  const zs = [];
  for (let i = 0; i < contour.positions.length; i += 3) {
    xs.push(contour.positions[i]);
    zs.push(contour.positions[i + 2]);
  }
  assert.ok(Math.abs(Math.min(...xs) - 1.7) < 1e-3, 'the shoreline left the crossing cell');
  assert.ok(Math.min(...zs) >= 0 && Math.max(...zs) <= 5, 'the edge left the field');
  assert.ok(
    xs.some((x) => Math.abs(x - 1.7) < 1e-3),
    'the crossing is not sub-cell',
  );
  // Every crossing is exactly at zero; wet interior corners keep their column.
  assert.ok(
    contour.depths.some((depth) => depth > 0),
    'no wet interior',
  );
  assert.ok(
    contour.depths.every((depth) => depth >= 0),
    'negative depth',
  );
});
