# tools/load-test

**Status:** placeholder. Owned by **O03** (load and capacity).
**Not implemented.** No dependencies, no scripts.

Purpose: measure the server's tick budget and connection limits against the
numbers in `docs/tick-budget.md` and DESIGN.md Part 13.4. This is capacity
measurement, not gameplay simulation — use `tools/sim-bots` for behaviour.

Contract when O03 lands:

- Fixed scenario file: player count, message rate, world size.
- Reports p50/p95/p99 tick time, dropped ticks, memory and DB pool wait.
- Fails when a tick exceeds the configured budget.
- Runs against a disposable database, never staging data.
