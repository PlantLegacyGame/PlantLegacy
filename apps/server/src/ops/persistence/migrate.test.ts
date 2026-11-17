/**
 * Migration ordering and identity.
 *
 * The runner used to sort migration files by name and key the applied table on
 * the text before the first underscore, so `100_...` ran before `20_...`, and an
 * edited migration was skipped because only its name was compared.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { migrationChecksum, migrationVersion, sortMigrationFiles } from './migrate.ts';

test('migration versions are numeric, not lexical', () => {
  const sorted = sortMigrationFiles(['100_add_index.sql', '20_add_column.sql', '9_boot.sql']);
  assert.deepEqual(sorted, ['9_boot.sql', '20_add_column.sql', '100_add_index.sql']);
  assert.equal(migrationVersion('007_widgets.sql'), 7);
});

test('a file without a numeric prefix is refused', () => {
  assert.throws(() => migrationVersion('create_widgets.sql'), /numeric version prefix/);
});

test('the checksum ignores line-ending differences and tracks content', () => {
  const lf = 'CREATE TABLE a (id INT);\n';
  assert.equal(migrationChecksum(lf), migrationChecksum(lf.replace(/\n/g, '\r\n')));
  assert.notEqual(migrationChecksum(lf), migrationChecksum(`${lf}ALTER TABLE a ADD b INT;\n`));
});
