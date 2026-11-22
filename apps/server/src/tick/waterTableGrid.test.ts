import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type WaterTableGrid, WaterTableGridBuilder } from './waterTableGrid.ts';

function heights(grid: WaterTableGrid): Float32Array {
  const buffer = Buffer.from(grid.heightsBase64, 'base64');
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

describe('the water-table field builder', () => {
  it('samples the whole field across bounded slices', () => {
    // The point of the class: no single call may cost a whole 48x48 field.
    let samples = 0;
    const builder = new WaterTableGridBuilder(
      (x, z) => {
        samples += 1;
        return x + z;
      },
      { cells: 4, cellSizeM: 2, chunkCells: 5 },
    );
    const perCall: number[] = [];
    for (let call = 0; call < 10 && !builder.grid; call += 1) {
      const before = samples;
      builder.advance(0, 0);
      perCall.push(samples - before);
    }
    assert.deepEqual(perCall, [5, 5, 5, 1], '16 samples split 5/5/5/1');
    assert.equal(builder.grid?.cells, 4);
  });

  it('decodes to the field its own origin describes', () => {
    const builder = new WaterTableGridBuilder((x, z) => x * 1000 + z, {
      cells: 2,
      cellSizeM: 2,
      chunkCells: 4,
    });
    // Centre (0,0) with two 2 m cells puts the origin at (-2,-2) and the sample
    // centres at -1 and +1 on both axes.
    builder.advance(0, 0);
    const grid = builder.grid;
    assert.ok(grid);
    assert.equal(grid.originX, -2);
    assert.equal(grid.originZ, -2);
    assert.equal(grid.cellSizeM, 2);
    assert.deepEqual([...heights(grid)], [-1001, 999, -999, 1001]);
  });

  it('has no field until the first one is complete', () => {
    const builder = new WaterTableGridBuilder(() => 0, { cells: 4, chunkCells: 2 });
    builder.advance(0, 0);
    assert.equal(builder.grid, null);
  });

  it('does no work while the root stands inside the tolerance', () => {
    // Standing still must not sample anything: the field it has is the field
    // this position wants.
    let samples = 0;
    const builder = new WaterTableGridBuilder(
      () => {
        samples += 1;
        return 1;
      },
      { cells: 2, cellSizeM: 2, chunkCells: 2, moveToleranceM: 0.5 },
    );
    builder.advance(0, 0);
    builder.advance(0, 0);
    assert.ok(builder.grid);
    samples = 0;
    assert.equal(builder.advance(0.3, -0.2), null);
    assert.equal(samples, 0);
  });

  it('finishes a started field even while the root walks out of tolerance', () => {
    // Restarting on drift would mean a walking root never gets a field: it
    // leaves a 0.5 m tolerance in about three ticks and a field takes four.
    const builder = new WaterTableGridBuilder((x) => x, {
      cells: 2,
      cellSizeM: 2,
      chunkCells: 1,
      moveToleranceM: 0.5,
    });
    builder.advance(0, 0);
    builder.advance(5, 0);
    builder.advance(10, 0);
    builder.advance(15, 0);
    const grid = builder.grid;
    assert.ok(grid);
    assert.equal(grid.originX, -2, 'the field covers where its build started');
  });

  it('serves the last finished field while a moved root rebuilds, then the new one', () => {
    const builder = new WaterTableGridBuilder((x) => x, {
      cells: 2,
      cellSizeM: 2,
      chunkCells: 1,
      moveToleranceM: 0.5,
    });
    for (let i = 0; i < 4; i += 1) builder.advance(0, 0);
    const first = builder.grid;
    assert.ok(first);
    builder.advance(20, 0);
    assert.equal(builder.grid, first, 'the old field is still what the readout draws');
    for (let i = 0; i < 3; i += 1) builder.advance(20, 0);
    const second = builder.grid;
    assert.ok(second);
    assert.notEqual(second, first);
    assert.ok(second.originX > first.originX);
  });

  it('ignores a position that is not a number', () => {
    const builder = new WaterTableGridBuilder(() => 1, { cells: 2, chunkCells: 4 });
    assert.equal(builder.advance(Number.NaN, 0), null);
    assert.equal(builder.grid, null);
  });
});
