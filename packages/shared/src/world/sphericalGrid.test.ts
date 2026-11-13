import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SphericalTileGrid } from './sphericalGrid.ts';

// A small planet so the tests build fast, with metre-scale cells.
const grid = new SphericalTileGrid({ radiusM: 1000, cellSizeM: 10 });
const large = new SphericalTileGrid({ radiusM: 100000, cellSizeM: 1 });

test('rings split half a great circle, so ring count follows radius and cell size', () => {
  assert.equal(grid.ringCount, Math.round((Math.PI * 1000) / 10));
  assert.equal(grid.cellSizeM, 10);
  assert.equal(grid.radiusM, 1000);
});

test('a ring holds fewer cells toward the poles', () => {
  const equator = grid.cellsInRing(Math.floor(grid.ringCount / 2));
  const nearPole = grid.cellsInRing(0);
  const lastRing = grid.cellsInRing(grid.ringCount - 1);
  assert.ok(nearPole >= 1);
  assert.ok(nearPole < equator);
  assert.ok(lastRing < equator);
});

test('a cell centre maps back to its own cell', () => {
  const samples = [
    { ring: 2, index: 0 },
    { ring: Math.floor(grid.ringCount / 2), index: 3 },
    { ring: grid.ringCount - 2, index: 1 },
  ];
  for (const cell of samples) {
    const centre = grid.cellToSurface(cell);
    const found = grid.cellForSurfacePoint(centre.x, centre.y, centre.z);
    assert.deepEqual(found, cell, `round trip failed for ${grid.cellKey(cell)}`);
  }
});

test('active cells carry valid keys that parse back', () => {
  const cell = { ring: 4, index: 2 };
  const key = grid.cellKey(cell);
  assert.deepEqual(grid.parseCellKey(key), cell);
  assert.equal(grid.parseCellKey('not-a-cell'), null);
  assert.equal(grid.parseCellKey('999999:0'), null);
});

test('every cell has four true neighbours: east and west wrap around the planet', () => {
  const ring = Math.floor(grid.ringCount / 2);
  const cells = grid.cellsInRing(ring);
  const east = { ring, index: cells - 1 };
  const west = { ring, index: 0 };

  const eastNeighbours = grid.neighbours(east).map((cell) => grid.cellKey(cell));
  assert.ok(eastNeighbours.includes(grid.cellKey({ ring, index: 0 })), 'east edge wraps to 0');

  const westNeighbours = grid.neighbours(west).map((cell) => grid.cellKey(cell));
  assert.ok(
    westNeighbours.includes(grid.cellKey({ ring, index: cells - 1 })),
    'west edge wraps to the last cell',
  );
});

test('neighbouring is symmetric away from the poles', () => {
  const ring = Math.floor(grid.ringCount / 2);
  const cells = grid.cellsInRing(ring);
  const cell = { ring, index: Math.floor(cells / 3) };
  for (const neighbour of grid.neighbours(cell)) {
    const back = grid.neighbours(neighbour).map((candidate) => grid.cellKey(candidate));
    assert.ok(
      back.includes(grid.cellKey(cell)),
      `${grid.cellKey(neighbour)} does not list ${grid.cellKey(cell)}`,
    );
  }
});

test('the north and south poles are their own poleward neighbour', () => {
  const northPole = { ring: 0, index: 0 };
  const northNeighbours = grid.neighbours(northPole).map((cell) => grid.cellKey(cell));
  assert.ok(northNeighbours.includes(grid.cellKey(northPole)));

  const southRing = grid.ringCount - 1;
  const southPole = { ring: southRing, index: 0 };
  const southNeighbours = grid.neighbours(southPole).map((cell) => grid.cellKey(cell));
  assert.ok(southNeighbours.includes(grid.cellKey(southPole)));
});

test('adjacent cell centres are about one cell apart', () => {
  const ring = Math.floor(grid.ringCount / 2);
  const cell = { ring, index: 0 };
  const east = { ring, index: 1 };
  const north = { ring: ring - 1, index: 0 };
  for (const other of [east, north]) {
    const distance = grid.cellCentreDistance(cell, other);
    assert.ok(distance > grid.cellSizeM * 0.4, `too close: ${distance}`);
    assert.ok(distance < grid.cellSizeM * 1.8, `too far: ${distance}`);
  }
});

test('the surface mapping keeps the pole at the origin and height above it', () => {
  const poleCell = grid.cellForSurfacePoint(0, 0, 0);
  assert.equal(poleCell.ring, 0);

  const abovePole = grid.cellForSurfacePoint(0, 120, 0);
  assert.equal(abovePole.ring, 0);

  const away = grid.cellForSurfacePoint(300, 0, 0);
  assert.ok(away.ring > poleCell.ring);
});

test('a 100 km planet at one-metre cells still addresses one point in constant time', () => {
  const cell = large.cellForSurfacePoint(120, 0.5, -80);
  assert.ok(large.has(cell));
  assert.ok(large.ringCount > 1000);
  assert.ok(large.cellsInRing(cell.ring) > 1, 'a point off the pole is not in a one-cell ring');
  assert.ok(large.totalCells() > large.ringCount, 'rings are subdivided into many cells');
});
