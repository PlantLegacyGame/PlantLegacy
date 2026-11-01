# tools/backup

**Status:** placeholder. Owned by **O02** (migrations, backups, restore drill).
**Not implemented.** No dependencies, no scripts.

Purpose: wrap `pg_dump` / `pg_restore` so a backup is one command and a restore
is rehearsed, not hoped for. The design requires a restore to a clean database
from yesterday's backup (DESIGN.md O02 acceptance).

Contract when O02 lands:

- `backup` writes a timestamped dump outside the repo and verifies its checksum.
- `restore <file>` refuses to target production without an explicit flag.
- `drill` restores into a throwaway database and runs `/ready`.
- Retention and destination come from `config/persistence.json`.
- No credential is ever written to a log or a filename.
