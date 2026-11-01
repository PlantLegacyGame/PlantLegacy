# tools/seed-data

**Status:** placeholder. Owned by **T03** (world server) and **O02** (restore drill).
**Not implemented.** No dependencies, no scripts.

Purpose: create a deterministic local world for tests and screenshots. Seeds are
derived from an explicit integer so a failing test can be replayed exactly.

Contract when T03 lands:

- `pnpm --filter @plant-legacy/seed-data start -- --seed 1234`
- Writes only through the server's normal transaction helpers, never raw SQL
  invented in the tool.
- Refuses to run when `NODE_ENV=production`.
- Idempotent for the same seed.
