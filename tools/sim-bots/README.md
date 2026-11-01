# tools/sim-bots

**Status:** placeholder. Owned by **T26** (persistence and bot soak).
**Not implemented.** No dependencies, no scripts.

Purpose: drive N synthetic clients against a staging server to soak the world
tick, catch memory growth, and reproduce population-scale bugs. Bots speak the
real wire protocol from `packages/shared`; they get no server shortcuts.

Contract when T26 lands:

- `pnpm --filter @plant-legacy/sim-bots start -- --bots 50 --minutes 30`
- Reads server origin, bot count and action mix from `config/persistence.json`.
- Never writes directly to Postgres.
- Exits non-zero on a protocol error or an unhandled server rejection.
