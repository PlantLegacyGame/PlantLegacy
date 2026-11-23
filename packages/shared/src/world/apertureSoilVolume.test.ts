/**
 * The aperture body's contract: it is a closed block of soil with a shaft
 * through it, under the drawn surface and above its own floor.
 *
 * The measurements are the ones the buried-eye view depends on: a point in the
 * wall is rock, a point on the shaft's axis is air all the way down, and the top
 * follows the hillside instead of being a flat lid.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type ApertureSoilParams,
  apertureSoilBounds,
  apertureSoilSdf,
  buildApertureSoilMesh,
  DEFAULT_APERTURE_SOIL,
} from './apertureSoilVolume.ts';

const flat = (): number => 10;
const slope = (x: number): number => 10 + x * 0.2;

function params(overrides: Partial<ApertureSoilParams> = {}): ApertureSoilParams {
  return {
    ...DEFAULT_APERTURE_SOIL,
    centreXM: 4,
    centreZM: -2,
    voidRadiusM: 1.2,
    extentM: 3.6,
    depthM: 3.4,
    voxelM: 0.3,
    ...overrides,
  };
}

function edgesAreClosed(indices: Uint32Array): boolean {
  const counts = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = indices[t + edge];
      const b = indices[t + ((edge + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const count of counts.values()) if (count !== 2) return false;
  return true;
}

describe('the aperture soil body', () => {
  const p = params();

  it('is rock in the wall between the shaft and the extent', () => {
    const wall = (p.voidRadiusM + p.extentM) / 2;
    assert.ok(
      apertureSoilSdf(flat, p, p.centreXM + wall, 10 - 1, p.centreZM) < 0,
      'the wall between the shaft and the extent is air',
    );
  });

  it('is air on the shaft axis from the top to the floor', () => {
    for (const depth of [0.05, 0.4, 1, 2, 3.3]) {
      assert.ok(
        apertureSoilSdf(flat, p, p.centreXM, 10 - depth, p.centreZM) > 0,
        `the shaft is solid ${depth} m down`,
      );
    }
  });

  it('is air above the surface, below the floor and outside the extent', () => {
    const wall = (p.voidRadiusM + p.extentM) / 2;
    assert.ok(apertureSoilSdf(flat, p, p.centreXM + wall, 10.5, p.centreZM) > 0, 'above the top');
    assert.ok(
      apertureSoilSdf(flat, p, p.centreXM + wall, 10 - 3.5, p.centreZM) > 0,
      'below the floor',
    );
    assert.ok(
      apertureSoilSdf(flat, p, p.centreXM + p.extentM + 0.5, 10 - 1, p.centreZM) > 0,
      'outside the extent',
    );
  });

  it('follows the drawn surface on a slope instead of cutting a flat lid', () => {
    const at = (x: number): number => apertureSoilSdf(slope, p, x, 9, p.centreZM);
    // Deep in the body is solid at both ends. At a fixed height just above the
    // downhill surface the answer flips: air downhill, soil uphill. A flat lid
    // at the centre's height would call both ends air.
    assert.ok(at(p.centreXM - 3) < 0);
    assert.ok(at(p.centreXM + 3) < 0);
    assert.ok(apertureSoilSdf(slope, p, p.centreXM - 3, 10.35, p.centreZM) > 0);
    assert.ok(apertureSoilSdf(slope, p, p.centreXM + 3, 10.35, p.centreZM) < 0);
  });

  it('meshes a closed body with a shaft through it', () => {
    const mesh = buildApertureSoilMesh(flat, p);
    assert.ok(mesh, 'no mesh');
    assert.ok(mesh.vertices > 1000, `only ${mesh.vertices} vertices`);
    assert.ok(edgesAreClosed(mesh.indices), 'the aperture body has holes');
    // The top surface, the floor, the outer wall and the shaft wall all exist:
    // vertices above, below, outside and inside the ring.
    let above = 0;
    let below = 0;
    let outer = 0;
    let inner = 0;
    for (let v = 0; v < mesh.vertices; v += 1) {
      const x = mesh.positions[v * 3];
      const y = mesh.positions[v * 3 + 1];
      const z = mesh.positions[v * 3 + 2];
      const r = Math.hypot(x - p.centreXM, z - p.centreZM);
      if (y > 10 - 0.1) above += 1;
      if (y < 10 - 3.3) below += 1;
      if (r > p.extentM - 0.3) outer += 1;
      if (r < p.voidRadiusM + 0.15 && r > p.voidRadiusM - 0.3) inner += 1;
    }
    assert.ok(above > 100, `only ${above} vertices on the top`);
    assert.ok(below > 100, `only ${below} vertices on the floor`);
    assert.ok(outer > 100, `only ${outer} vertices on the outer wall`);
    assert.ok(inner > 100, `only ${inner} vertices on the shaft wall`);
  });

  it('carries a depth on every vertex inside its band', () => {
    const mesh = buildApertureSoilMesh(flat, p);
    assert.ok(mesh);
    assert.equal(mesh.strata.length, mesh.vertices);
    for (const value of mesh.strata) assert.ok(value >= 0 && value < 1);
  });

  it('is the same body on every build', () => {
    const a = buildApertureSoilMesh(flat, p);
    const b = buildApertureSoilMesh(flat, p);
    assert.ok(a && b);
    assert.equal(a.vertices, b.vertices);
    assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
  });

  it('keeps its samples inside the bounds it reports', () => {
    const bounds = apertureSoilBounds(flat, p);
    const mesh = buildApertureSoilMesh(flat, p);
    assert.ok(mesh);
    for (let v = 0; v < mesh.vertices; v += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = mesh.positions[v * 3 + axis];
        assert.ok(value >= bounds.min[axis] - 1e-3 && value <= bounds.max[axis] + 1e-3);
      }
    }
  });
});
