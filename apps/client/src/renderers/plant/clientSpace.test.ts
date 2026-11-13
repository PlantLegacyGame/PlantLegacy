import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toClientSpace } from './clientSpace.ts';

// The client's ground mapping in miniature: the surface is 2 m above the
// server's zero, so every surface-relative height gains that offset.
const surfaceY = (_x: number, _z: number, y: number): number => y + 2;

describe('toClientSpace', () => {
  it('maps a server attach point onto the drawn surface', () => {
    const mapped = toClientSpace({ x: 3, y: -1, z: 4 }, surfaceY);
    assert.deepEqual(mapped, { x: 3, y: 1, z: 4 });
  });

  it('keeps horizontal coordinates and applies the height offset only', () => {
    const mapped = toClientSpace({ x: -7.5, y: 0.25, z: 2.125 }, surfaceY);
    assert.equal(mapped?.x, -7.5);
    assert.equal(mapped?.z, 2.125);
    assert.ok(Math.abs((mapped?.y ?? 0) - 2.25) < 1e-12);
  });

  it('returns undefined when the attach point is absent or incomplete', () => {
    assert.equal(toClientSpace(undefined, surfaceY), undefined);
    assert.equal(toClientSpace({ x: 1, y: 2 }, surfaceY), undefined);
  });
});
