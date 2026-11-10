# Tick budget

**Status:** metrics implemented, table not created. Owner: **T03** (metrics), verified by **H01**.
**Source of truth:** DESIGN.md Parts 13.6 and 14.1.5.

The server records tick duration, per-tier cost and queue depth every second, and
warns when Active work exceeds its configured share of the budget. That is how
"online players do not notice offline simulation" is proven rather than asserted.

## Metrics recorded each second

| Metric        | Meaning                        |
| ------------- | ------------------------------ |
| `active_ms`   | time spent in the Active tier  |
| `near_ms`     | time spent in the Near tier    |
| `dormant_ms`  | time spent in the Dormant tier |
| `queue_depth` | pending work items             |
| `snapshot_ms` | persistence slice cost         |

Planned table: `tick_budget_samples` (Appendix H) — not yet created (O02 migrations).

## Rules

1. If the tick runs long, Dormant work slips first, then Near. Never Active.
2. A `TICK_BUDGET_WARNING` event is emitted (via `GAME_EVENTS`), not just logged.
3. H01 must show Active-tier tick time inside budget at 50 → 500 → 2,000 bots.

## Config (`config/world.json`)

| Key | Default | Effect |
|---|---|---|
| `tick_budget_active_share` | 0.7 | Max Active share of tick budget |
| `tick_budget_warn_threshold_ms` | 40 | Warn threshold for Active tier |

## Current implementation (`apps/server/src/ops/plantWorld.ts`)

- `PlantWorld.step()` returns per-tier timing (`activeMs`, `nearMs`, `dormantMs`, `totalMs`)
- `World` checks budget every 100 ticks (5s at 20 Hz)
- `TICK_BUDGET_WARNING` event fires when Active share > `tick_budget_active_share` OR Active time > `tick_budget_warn_threshold_ms`
