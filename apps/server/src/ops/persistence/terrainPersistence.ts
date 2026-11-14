/**
 * Persistence for the sparse soil.
 *
 * Chunks are small (a 32x32 cell chunk is a few kilobytes of typed arrays), so
 * the periodic save upserts the active chunks in one transaction. Edits are
 * append-only (T26), and voids are a bounded snapshot because they change size
 * and disappear when they collapse.
 */
import type { Pool } from 'pg';
import type { TerrainChunk, TerrainEdit, TerrainSnapshot, TerrainVoid } from '../terrain.ts';

function toBytes(values: Float32Array): Buffer {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

function toFloat32(value: unknown): Float32Array {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value as ArrayBuffer);
  // Copy out of the pool's buffer: pg reuses it after the row is read.
  return new Float32Array(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
}

export class TerrainPersistence {
  private pool: Pool;
  private worldId: string;

  constructor(pool: Pool, worldId: string) {
    this.pool = pool;
    this.worldId = worldId;
  }

  async loadAll(): Promise<TerrainSnapshot | null> {
    const [chunksResult, editsResult, voidsResult] = await Promise.all([
      this.pool.query(
        'SELECT cx, cz, revision, heights, moisture, compaction FROM terrain_chunks WHERE world_id = $1',
        [this.worldId],
      ),
      this.pool.query(
        'SELECT id, tick, actor_plant_id, kind, x, y, z, radius_m, volume_m3 FROM terrain_edits WHERE world_id = $1 ORDER BY id ASC',
        [this.worldId],
      ),
      this.pool.query(
        'SELECT id, x, y, z, radius_m, volume_m3, stability FROM terrain_voids WHERE world_id = $1 ORDER BY id ASC',
        [this.worldId],
      ),
    ]);

    if (chunksResult.rows.length === 0 && editsResult.rows.length === 0) return null;

    const chunks: TerrainChunk[] = chunksResult.rows.map((row) => ({
      cx: Number(row.cx),
      cz: Number(row.cz),
      revision: Number(row.revision),
      heights: toFloat32(row.heights),
      moisture: toFloat32(row.moisture),
      compaction: toFloat32(row.compaction),
    }));
    const edits: TerrainEdit[] = editsResult.rows.map((row) => ({
      id: Number(row.id),
      tick: Number(row.tick),
      actorPlantId: row.actor_plant_id ?? null,
      kind: row.kind,
      x: Number(row.x),
      y: Number(row.y),
      z: Number(row.z),
      radiusM: Number(row.radius_m),
      volumeM3: Number(row.volume_m3),
    }));
    const voids: TerrainVoid[] = voidsResult.rows.map((row) => ({
      id: Number(row.id),
      x: Number(row.x),
      y: Number(row.y),
      z: Number(row.z),
      radiusM: Number(row.radius_m),
      volumeM3: Number(row.volume_m3),
      stability: Number(row.stability),
    }));

    return {
      chunks,
      edits,
      voids,
      nextEditId: edits.reduce((max, edit) => Math.max(max, edit.id), 0) + 1,
      nextVoidId: voids.reduce((max, cavity) => Math.max(max, cavity.id), 0) + 1,
    };
  }

  async save(snapshot: TerrainSnapshot): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const chunk of snapshot.chunks) {
        await client.query(
          `INSERT INTO terrain_chunks (world_id, cx, cz, revision, heights, moisture, compaction, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (world_id, cx, cz) DO UPDATE SET
             revision = EXCLUDED.revision,
             heights = EXCLUDED.heights,
             moisture = EXCLUDED.moisture,
             compaction = EXCLUDED.compaction,
             updated_at = NOW()`,
          [
            this.worldId,
            chunk.cx,
            chunk.cz,
            chunk.revision,
            toBytes(chunk.heights),
            toBytes(chunk.moisture),
            toBytes(chunk.compaction),
          ],
        );
      }

      for (const edit of snapshot.edits) {
        await client.query(
          `INSERT INTO terrain_edits
             (id, world_id, tick, actor_plant_id, kind, x, y, z, radius_m, volume_m3)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (world_id, id) DO NOTHING`,
          [
            edit.id,
            this.worldId,
            edit.tick,
            edit.actorPlantId,
            edit.kind,
            edit.x,
            edit.y,
            edit.z,
            edit.radiusM,
            edit.volumeM3,
          ],
        );
      }

      await client.query('DELETE FROM terrain_voids WHERE world_id = $1', [this.worldId]);
      for (const cavity of snapshot.voids) {
        await client.query(
          `INSERT INTO terrain_voids
             (world_id, id, x, y, z, radius_m, volume_m3, stability)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            this.worldId,
            cavity.id,
            cavity.x,
            cavity.y,
            cavity.z,
            cavity.radiusM,
            cavity.volumeM3,
            cavity.stability,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
