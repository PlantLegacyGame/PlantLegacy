import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_TERRAIN_FIELD } from '@plant-legacy/shared/world';
import { TerrainService, type TerrainServiceOptions } from './terrain.ts';

const OPTIONS: TerrainServiceOptions = {
  cellSizeM: 0.5,
  chunkCells: 16,
  surfaceBreakDepthM: 0.8,
  maxDepthM: 12,
  maxEditVolumeM3: 4,
  maxEditsPerTick: 16,
  collapseCadenceHz: 2,
  displacementRingCells: 2,
  growthResistanceMin: 0.4,
  growthResistanceMax: 2.5,
  maxActiveChunks: 32,
  runoffFraction: 0.15,
  evaporationPerS: 0.002,
  rainAbsorptionPerS: 0.05,
};

function service(): TerrainService {
  return new TerrainService({ ...DEFAULT_TERRAIN_FIELD, amplitudeM: 2 }, OPTIONS);
}

describe('server terrain service', () => {
  it('uses the shared base field and has no chunks until soil is edited', () => {
    const terrain = service();
    const base = terrain.baseHeightAt(12, -7);
    assert.ok(base >= 0 && base <= 2);
    assert.equal(base, service().baseHeightAt(12, -7));
    assert.equal(terrain.getChunks().length, 0);
    assert.equal(terrain.getVoids().length, 0);
  });

  it('opens a void and lowers the surface for a shallow root tunnel', () => {
    const terrain = service();
    const x = 4;
    const z = 6;
    const before = terrain.heightAt(x, z);
    const edit = terrain.recordRootTunnel('plant-1', x, before - 0.2, z, 0.2, 1.2, 7);
    assert.ok(edit);
    assert.equal(edit?.kind, 'root_tunnel');
    assert.ok((edit?.volumeM3 ?? 0) > 0);
    assert.ok(terrain.heightAt(x, z) < before, 'shallow tunnel did not sink the surface');
    assert.equal(terrain.getVoids().length, 1);
    assert.ok(terrain.growthResistanceAt(x, before - 0.2, z) >= OPTIONS.growthResistanceMin);
  });

  it('leaves the surface alone for a deep tunnel but still records the volume', () => {
    const terrain = service();
    const x = -20;
    const z = 9;
    const before = terrain.heightAt(x, z);
    const edit = terrain.recordRootTunnel('plant-2', x, before - 5, z, 0.15, 1, 1);
    assert.ok(edit);
    assert.equal(terrain.heightAt(x, z), before);
    assert.equal(terrain.getVoids().length, 1);
    assert.ok((terrain.getVoids()[0]?.volumeM3 ?? 0) > 0);
  });

  it('caps a single edit at max_edit_volume_m3', () => {
    const terrain = service();
    const edit = terrain.recordRootTunnel('plant-3', 0, terrain.heightAt(0, 0) - 2, 0, 5, 100, 1);
    assert.ok(edit);
    assert.ok((edit?.volumeM3 ?? 0) <= OPTIONS.maxEditVolumeM3 + 1e-9);
  });

  it('collapses a loose dry void and dimples the ground', () => {
    const terrain = service();
    const x = 10;
    const z = 10;
    const surface = terrain.heightAt(x, z);
    terrain.recordRootTunnel('plant-4', x, surface - 3, z, 0.3, 1, 1);
    assert.equal(terrain.getVoids().length, 1);
    const startSurface = terrain.heightAt(x, z);
    // Two minutes of simulation at 2 Hz is plenty for a loose cavity.
    for (let i = 0; i < 240; i += 1) terrain.tick(0.5, i);
    assert.equal(terrain.getVoids().length, 0);
    assert.ok(terrain.heightAt(x, z) <= startSurface);
    assert.ok(terrain.getEditsSince(0).some((edit) => edit.kind === 'collapse'));
  });

  it('reports higher resistance in compact, deep, dry soil', () => {
    const terrain = service();
    const surface = terrain.heightAt(2, 2);
    const shallow = terrain.growthResistanceAt(2, surface - 0.2, 2);
    terrain.recordRootTunnel('plant-5', 2, surface - 0.2, 2, 0.2, 1, 1);
    const compact = terrain.growthResistanceAt(2, surface - 0.2, 2);
    assert.ok(compact >= shallow);
    assert.ok(compact <= OPTIONS.growthResistanceMax);
  });

  it('round-trips a region for the wire', () => {
    const terrain = service();
    const x = 6;
    const z = -3;
    const surface = terrain.heightAt(x, z);
    terrain.recordRootTunnel('plant-6', x, surface - 1, z, 0.25, 1, 3);
    const region = terrain.getRegion(x, z, 8);
    assert.ok(region.cols > 0 && region.rows > 0);
    assert.equal(region.heights.length, region.cols * region.rows);
    assert.equal(region.moisture.length, region.cols * region.rows);
    assert.ok(region.revision > 0);
    // The edited cell is inside the envelope.
    assert.ok(region.heights.some((height) => Math.abs(height) > 1e-6));
  });

  it('applies rain and dries soil without touching the base field', () => {
    const terrain = service();
    terrain.applyRain(0, 0, 4, 0.1);
    const chunk = terrain.getChunk(0, 0, false);
    assert.ok(chunk);
    assert.ok((chunk?.moisture[0] ?? 0) > 0.3);
    const wet = terrain.getChunk(0, 0, false)?.moisture[0] ?? 0;
    terrain.dry(10);
    const after = terrain.getChunk(0, 0, false)?.moisture[0] ?? 0;
    assert.ok(after < wet);
    assert.ok(after >= 0);
  });

  it('restores a snapshot including edits and voids', () => {
    const terrain = service();
    const surface = terrain.heightAt(1, 1);
    terrain.recordRootTunnel('plant-7', 1, surface - 0.3, 1, 0.2, 1, 9);
    const snapshot = terrain.snapshot();
    const restored = service();
    restored.load(snapshot);
    assert.equal(restored.getChunks().length, snapshot.chunks.length);
    assert.equal(restored.getVoids().length, 1);
    assert.equal(restored.getLatestRevision(), terrain.getLatestRevision());
    assert.equal(restored.getEditsSince(0).length, terrain.getEditsSince(0).length);
  });
});
