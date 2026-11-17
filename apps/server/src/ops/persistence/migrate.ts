import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

/**
 * The numeric prefix of a migration file, e.g. `007` in `007_create_widgets.sql`.
 *
 * The applied table used to be keyed by whatever preceded the first underscore,
 * and files were applied in that text order: `100_x.sql` sorted before
 * `20_y.sql`, so a later migration could run before an earlier one.
 */
export function migrationVersion(file: string): number {
  const match = /^(\d+)_/.exec(file);
  if (!match) throw new Error(`Migration ${file} has no numeric version prefix`);
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) throw new Error(`Migration ${file} has an unusable version`);
  return version;
}

/** Migration files in ascending numeric order, whatever their names sort like. */
export function sortMigrationFiles(files: string[]): string[] {
  return [...files].sort((a, b) => migrationVersion(a) - migrationVersion(b));
}

/**
 * Fingerprint of a migration's contents.
 *
 * A migration that is edited after it ran is a schema the repository no longer
 * describes, and it used to be skipped silently because only its name was
 * checked. The checksum makes the drift a loud failure instead.
 */
export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export async function runMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Older databases have the two-column table; add the new columns in place
    // rather than making the migration table itself a migration.
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
    await client.query(
      'ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS version_number INTEGER',
    );

    const appliedResult = await client.query(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    const applied = new Map<string, string | null>(
      appliedResult.rows.map((row) => [String(row.version), row.checksum ?? null]),
    );

    const files = await import('node:fs/promises').then((fs) => fs.readdir(migrationsDir));
    const migrationFiles = sortMigrationFiles(files.filter((f) => f.endsWith('.sql')));

    for (const file of migrationFiles) {
      const version = String(migrationVersion(file));
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      const checksum = migrationChecksum(sql);

      if (applied.has(version)) {
        const recorded = applied.get(version);
        if (recorded && recorded !== checksum) {
          throw new Error(
            `Migration ${file} changed after it was applied (${recorded.slice(0, 12)} -> ${checksum.slice(0, 12)})`,
          );
        }
        // Backfill databases migrated before checksums existed, so the next boot
        // can detect an edit to this file.
        if (!recorded) {
          await client.query(
            'UPDATE schema_migrations SET checksum = $1, version_number = $2 WHERE version = $3',
            [checksum, migrationVersion(file), version],
          );
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum, version_number) VALUES ($1, $2, $3)',
          [version, checksum, migrationVersion(file)],
        );
        await client.query('COMMIT');
        console.log(`Applied migration ${version}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${version} failed: ${error}`);
      }
    }
  } finally {
    client.release();
  }
}
