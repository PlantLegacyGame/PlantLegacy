/**
 * Sparse soil: the edits made to the shared terrain field.
 *
 * The base surface is a pure function (`terrainField.ts`) derived from a seed,
 * so the server never stores it. Only what changed is a chunk: a height delta,
 * moisture, compaction and the voids a root has opened. That keeps persistence
 * small and lets the client reproduce the same ground from the same field.
 *
 * Digging is a consequence of root growth (T25): a root that passes through
 * soil removes its own volume, lowers the surface when it runs shallow, pushes
 * the displaced earth into a ring, compacts the wall, and leaves a void that
 * collapses when it is dry and loose. There is no manual dig verb.
 */
import { type TerrainFieldParams, terrainHeightAt } from '@plant-legacy/shared/world';

export interface TerrainServiceOptions {
  cellSizeM: number;
  chunkCells: number;
  surfaceBreakDepthM: number;
  maxDepthM: number;
  maxEditVolumeM3: number;
  maxEditsPerTick: number;
  collapseCadenceHz: number;
  displacementRingCells: number;
  growthResistanceMin: number;
  growthResistanceMax: number;
  maxActiveChunks: number;
  runoffFraction: number;
  evaporationPerS: number;
  rainAbsorptionPerS: number;
}

export interface TerrainChunk {
  cx: number;
  cz: number;
  /** Height offset from the shared base field, metres. */
  heights: Float32Array;
  moisture: Float32Array;
  compaction: Float32Array;
  /** Bumped on every edit; clients fetch the region when it changes. */
  revision: number;
}

export type TerrainEditKind = 'root_tunnel' | 'collapse' | 'rain' | 'backfill';

export interface TerrainEdit {
  id: number;
  tick: number;
  actorPlantId: string | null;
  kind: TerrainEditKind;
  x: number;
  y: number;
  z: number;
  radiusM: number;
  volumeM3: number;
}

export interface TerrainVoid {
  id: number;
  x: number;
  y: number;
  z: number;
  radiusM: number;
  volumeM3: number;
  stability: number;
}

export interface TerrainRegion {
  originX: number;
  originZ: number;
  cellSizeM: number;
  cols: number;
  rows: number;
  revision: number;
  /** Float32 height deltas, little-endian. */
  heights: Float32Array;
  /** Uint8 moisture 0..255. */
  moisture: Uint8Array;
}

export interface TerrainSnapshot {
  chunks: TerrainChunk[];
  edits: TerrainEdit[];
  voids: TerrainVoid[];
  nextEditId: number;
  nextVoidId: number;
}

const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

export class TerrainService {
  private readonly field: TerrainFieldParams;
  private readonly options: TerrainServiceOptions;
  private readonly chunks = new Map<string, TerrainChunk>();
  private readonly voids: TerrainVoid[] = [];
  private edits: TerrainEdit[] = [];
  private nextEditId = 1;
  private nextVoidId = 1;
  private collapseAccumulator = 0;

  constructor(field: TerrainFieldParams, options: TerrainServiceOptions) {
    this.field = field;
    this.options = {
      ...options,
      cellSizeM: Math.max(0.1, options.cellSizeM),
      chunkCells: Math.max(2, Math.round(options.chunkCells)),
    };
  }

  /** Base surface height at a pole-local point, before edits. */
  baseHeightAt(x: number, z: number): number {
    return terrainHeightAt(this.field, x, z);
  }

  /** Surface height including edits, metres above the soil line. */
  heightAt(x: number, z: number): number {
    const chunk = this.chunkAtWorld(x, z, false);
    if (!chunk) return this.baseHeightAt(x, z);
    return this.baseHeightAt(x, z) + this.sampleChunk(chunk, x, z);
  }

  getChunk(cx: number, cz: number, create = false): TerrainChunk | null {
    const key = chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing) return existing;
    if (!create) return null;
    if (this.chunks.size >= this.options.maxActiveChunks) this.evictOldestChunk();
    const count = this.options.chunkCells * this.options.chunkCells;
    const chunk: TerrainChunk = {
      cx,
      cz,
      heights: new Float32Array(count),
      moisture: new Float32Array(count).fill(0.3),
      compaction: new Float32Array(count),
      revision: 1,
    };
    this.chunks.set(key, chunk);
    return chunk;
  }

  getChunks(): readonly TerrainChunk[] {
    return Array.from(this.chunks.values());
  }

  getVoids(): readonly TerrainVoid[] {
    return this.voids;
  }

  getEditsSince(revision: number): TerrainEdit[] {
    return this.edits.filter((edit) => edit.id > revision);
  }

  getLatestRevision(): number {
    return this.edits.length > 0 ? this.edits[this.edits.length - 1].id : 0;
  }

  /**
   * A root segment removed its own volume from the soil.
   *
   * `radiusM` is the drawn root radius, `lengthM` the segment length. The
   * volume is capped by `max_edit_volume_m3` so one long segment cannot carve a
   * cavern; the rest of the displaced earth is spread into the ring around it.
   */
  recordRootTunnel(
    actorPlantId: string | null,
    x: number,
    y: number,
    z: number,
    radiusM: number,
    lengthM: number,
    tick = 0,
  ): TerrainEdit | null {
    const radius = Math.max(0.02, radiusM);
    const volume = Math.min(
      this.options.maxEditVolumeM3,
      Math.PI * radius * radius * Math.max(0, lengthM),
    );
    if (!(volume > 1e-6)) return null;
    const surface = this.heightAt(x, z);
    const depth = surface - y;
    if (depth < -0.25) return null; // Above the ground: a stem, not a tunnel.

    const chunk = this.chunkAtWorld(x, z, true);
    if (!chunk) return null;
    const { index } = this.chunkCell(chunk, x, z);

    // The surface sinks when the tunnel runs close to it. Deep tunnels only
    // open a void; the ground above them stays until it collapses.
    if (depth <= this.options.surfaceBreakDepthM + radius) {
      const sink = Math.min(radius * 2, volume / Math.max(0.5, radius * radius * 2));
      chunk.heights[index] = Math.max(-2, chunk.heights[index] - sink);
      this.spreadDisplacement(chunk, index, volume * 0.5);
    }
    chunk.compaction[index] = Math.min(1, chunk.compaction[index] + 0.25);
    chunk.moisture[index] = Math.max(0, chunk.moisture[index] - 0.02);
    chunk.revision += 1;

    const stability = 0.2 + chunk.compaction[index] * 0.35 + chunk.moisture[index] * 0.35;
    this.voids.push({
      id: this.nextVoidId++,
      x,
      y,
      z,
      radiusM: Math.max(0.12, radius * 1.8),
      volumeM3: volume,
      stability,
    });

    const edit = this.pushEdit({
      tick,
      actorPlantId,
      kind: 'root_tunnel',
      x,
      y,
      z,
      radiusM: radius,
      volumeM3: volume,
    });
    return edit;
  }

  /** Collapse unsupported voids. Runs at `collapse_cadence_hz`, not per tick. */
  tick(dt: number, tick = 0): void {
    const cadence = Math.max(0.1, this.options.collapseCadenceHz);
    this.collapseAccumulator += dt;
    const step = 1 / cadence;
    if (this.collapseAccumulator < step) return;
    const steps = Math.floor(this.collapseAccumulator / step);
    this.collapseAccumulator -= steps * step;

    for (let n = 0; n < steps; n += 1) {
      for (let i = this.voids.length - 1; i >= 0; i -= 1) {
        const cavity = this.voids[i];
        // Dry, loose soil cannot hold a roof. Stable, damp, compacted soil does.
        const shrink = (0.55 - cavity.stability) * 0.5 + 0.02;
        if (shrink <= 0.02) continue;
        cavity.radiusM -= cavity.radiusM * Math.min(0.5, shrink);
        if (cavity.radiusM > 0.1) continue;

        // Backfill: the roof comes down, the surface dimples, the void is gone.
        this.voids.splice(i, 1);
        const chunk = this.chunkAtWorld(cavity.x, cavity.z, true);
        if (chunk) {
          const { index } = this.chunkCell(chunk, cavity.x, cavity.z);
          chunk.heights[index] = Math.max(
            -2,
            chunk.heights[index] - Math.min(1, cavity.volumeM3 / 2),
          );
          chunk.compaction[index] = Math.max(0, chunk.compaction[index] - 0.2);
          chunk.moisture[index] = Math.min(1, chunk.moisture[index] + 0.05);
          chunk.revision += 1;
        }
        this.pushEdit({
          tick,
          actorPlantId: null,
          kind: 'collapse',
          x: cavity.x,
          y: cavity.y,
          z: cavity.z,
          radiusM: 0.1,
          volumeM3: cavity.volumeM3,
        });
      }
    }
  }

  /** Rain adds moisture to the chunks near a point; the rest runs off. */
  applyRain(x: number, z: number, radiusM: number, amount: number): void {
    if (!(amount > 0)) return;
    const cells = Math.max(1, Math.round(radiusM / this.options.cellSizeM));
    const centre = this.chunkAtWorld(x, z, true);
    if (!centre) return;
    for (let dz = -cells; dz <= cells; dz += 1) {
      for (let dx = -cells; dx <= cells; dx += 1) {
        const chunk = this.chunkAtWorld(
          x + dx * this.options.cellSizeM,
          z + dz * this.options.cellSizeM,
          false,
        );
        if (!chunk) continue;
        const { index } = this.chunkCell(
          chunk,
          x + dx * this.options.cellSizeM,
          z + dz * this.options.cellSizeM,
        );
        const absorbed = amount * (1 - this.options.runoffFraction);
        chunk.moisture[index] = Math.min(1, chunk.moisture[index] + absorbed);
        chunk.revision += 1;
      }
    }
  }

  /** Evaporate and drain every active chunk. */
  dry(dt: number): void {
    const loss = this.options.evaporationPerS * Math.max(0, dt);
    if (loss <= 0) return;
    for (const chunk of this.chunks.values()) {
      for (let i = 0; i < chunk.moisture.length; i += 1) {
        if (chunk.moisture[i] > 0) chunk.moisture[i] = Math.max(0, chunk.moisture[i] - loss);
      }
    }
  }

  /**
   * Multiplier on growth energy and time: compact, dry, deep soil is harder to
   * push a root through than loose, damp topsoil. Clamped by config.
   */
  growthResistanceAt(x: number, y: number, z: number): number {
    const chunk = this.chunkAtWorld(x, z, false);
    let compaction = 0;
    let moisture = 0.3;
    if (chunk) {
      const { index } = this.chunkCell(chunk, x, z);
      compaction = chunk.compaction[index] ?? 0;
      moisture = chunk.moisture[index] ?? 0.3;
    }
    const depth = Math.max(0, this.heightAt(x, z) - y);
    const raw =
      1 +
      compaction * 0.8 +
      (depth / Math.max(1, this.options.maxDepthM)) * 0.6 +
      (1 - moisture) * 0.15;
    return Math.min(
      this.options.growthResistanceMax,
      Math.max(this.options.growthResistanceMin, raw),
    );
  }

  /** Chunks that intersect a square region around a world point. */
  getRegion(worldX: number, worldZ: number, radiusM: number): TerrainRegion {
    const size = this.options.chunkCells * this.options.cellSizeM;
    const minCx = Math.floor((worldX - radiusM) / size);
    const maxCx = Math.floor((worldX + radiusM) / size);
    const minCz = Math.floor((worldZ - radiusM) / size);
    const maxCz = Math.floor((worldZ + radiusM) / size);
    const cols = (maxCx - minCx + 1) * this.options.chunkCells;
    const rows = (maxCz - minCz + 1) * this.options.chunkCells;
    const heights = new Float32Array(cols * rows);
    const moisture = new Uint8Array(cols * rows);
    let revision = 0;
    for (let cz = minCz; cz <= maxCz; cz += 1) {
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const chunk = this.getChunk(cx, cz, false);
        revision = Math.max(revision, chunk?.revision ?? 0);
        if (!chunk) continue;
        const ox = (cx - minCx) * this.options.chunkCells;
        const oz = (cz - minCz) * this.options.chunkCells;
        for (let j = 0; j < this.options.chunkCells; j += 1) {
          for (let i = 0; i < this.options.chunkCells; i += 1) {
            const target = (oz + j) * cols + ox + i;
            const source = j * this.options.chunkCells + i;
            heights[target] = chunk.heights[source];
            moisture[target] = Math.round(chunk.moisture[source] * 255);
          }
        }
      }
    }
    return {
      originX: minCx * size,
      originZ: minCz * size,
      cellSizeM: this.options.cellSizeM,
      cols,
      rows,
      revision,
      heights,
      moisture,
    };
  }

  snapshot(): TerrainSnapshot {
    return {
      chunks: Array.from(this.chunks.values()),
      edits: [...this.edits],
      voids: this.voids.map((cavity) => ({ ...cavity })),
      nextEditId: this.nextEditId,
      nextVoidId: this.nextVoidId,
    };
  }

  load(snapshot: TerrainSnapshot): void {
    this.chunks.clear();
    for (const chunk of snapshot.chunks) {
      this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk);
    }
    this.edits = [...snapshot.edits];
    this.voids.length = 0;
    this.voids.push(...snapshot.voids.map((cavity) => ({ ...cavity })));
    this.nextEditId = Math.max(snapshot.nextEditId, this.getLatestRevision() + 1);
    this.nextVoidId = Math.max(snapshot.nextVoidId, this.voids.length + 1);
  }

  private pushEdit(edit: Omit<TerrainEdit, 'id'>): TerrainEdit {
    const record: TerrainEdit = { id: this.nextEditId++, ...edit };
    this.edits.push(record);
    // Append-only in the world log, but the in-memory tail is bounded so a long
    // session cannot grow without limit. Persistence keeps the full history.
    if (this.edits.length > 2048) this.edits.splice(0, this.edits.length - 2048);
    return record;
  }

  private chunkAtWorld(x: number, z: number, create: boolean): TerrainChunk | null {
    const size = this.options.chunkCells * this.options.cellSizeM;
    const cx = Math.floor(x / size);
    const cz = Math.floor(z / size);
    return this.getChunk(cx, cz, create);
  }

  private chunkCell(
    chunk: TerrainChunk,
    x: number,
    z: number,
  ): { i: number; j: number; index: number } {
    const size = this.options.chunkCells * this.options.cellSizeM;
    const localX = x - chunk.cx * size;
    const localZ = z - chunk.cz * size;
    const i = Math.min(
      this.options.chunkCells - 1,
      Math.max(0, Math.floor(localX / this.options.cellSizeM)),
    );
    const j = Math.min(
      this.options.chunkCells - 1,
      Math.max(0, Math.floor(localZ / this.options.cellSizeM)),
    );
    return { i, j, index: j * this.options.chunkCells + i };
  }

  private sampleChunk(chunk: TerrainChunk, x: number, z: number): number {
    return chunk.heights[this.chunkCell(chunk, x, z).index] ?? 0;
  }

  private spreadDisplacement(chunk: TerrainChunk, index: number, volume: number): void {
    const cells = this.options.chunkCells;
    const ring = Math.max(1, Math.round(this.options.displacementRingCells));
    const i = index % cells;
    const j = Math.floor(index / cells);
    const targets: number[] = [];
    for (let dj = -ring; dj <= ring; dj += 1) {
      for (let di = -ring; di <= ring; di += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cells || nj >= cells) continue;
        targets.push(nj * cells + ni);
      }
    }
    if (targets.length === 0) return;
    // Mass-conserving approximation: the removed volume is spread over the
    // ring, so the surface rises around a shallow tunnel instead of simply
    // vanishing. Capped so a deep edit cannot build a mountain.
    const each = Math.min(0.05, volume / Math.max(1, targets.length) / 2);
    for (const target of targets) {
      chunk.heights[target] = Math.min(1.5, chunk.heights[target] + each);
    }
  }

  private evictOldestChunk(): void {
    const oldest = this.chunks.keys().next();
    if (!oldest.done) this.chunks.delete(oldest.value);
  }
}
