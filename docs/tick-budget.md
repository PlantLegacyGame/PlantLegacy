# Tick budget

**Status:** the budget **warning is consumed** and **tick-time metrics exist**
(the window is served at `ops.metrics_path`, default `GET /metrics`, and asserted
in `ops/tickMetrics.test.ts`). Still missing: the persisted sample table, any form
of tier yielding, and a recorded H01 bot run.
**Source of truth:** DESIGN.md Parts 13.6 and 14.1.5.

The rule this file exists to make provable is "online players do not notice
offline simulation". The server now both *reports* an over-budget tick and
*records* what the tick spent its time on, so the evidence exists even though the
shedding rule does not.

## What exists (verified against the code 2026-11-16)

- `PlantWorld.step()` returns `{ activeMs, nearMs, dormantMs, totalMs }`.
- Tiers are **scheduled, not scaled**: `near` and `dormant` accumulate elapsed
  milliseconds and step once per interval (`nearTickRateHz`,
  `dormantTickRateHz`). A tier therefore runs at exactly its configured rate
  instead of being stretched by a per-tick `dt` multiplier.
- `checkTickBudget` runs on **every tick** (not every 100) and publishes
  `GAME_EVENTS.TICK_BUDGET_WARNING` when Active's share of the tick exceeds
  `tick_budget_active_share`, **or** when Active time exceeds
  `tick_budget_warn_threshold_ms`. Both branches can fire on the same tick.
- `World.onTick` feeds that return value to `TickMetrics`
  (`apps/server/src/ops/tickMetrics.ts`), which keeps a ring of the last
  `ops.metrics_window_ticks` samples and summarises them: average and worst
  Active / Near / Dormant / total milliseconds, ticks whose Active work passed
  the threshold, peak Active share, and the warning count with the last payload.
- `World.start()` subscribes to `TICK_BUDGET_WARNING` and `stop()` unsubscribes,
  so the event now has a consumer instead of being dropped.
- `GET /metrics` (configurable, disable with an empty path) returns that window
  as JSON. It is not Prometheus text and it is not per second: it is a rolling
  window of ticks, which is what the shedding rule would need anyway.

## Config (`config/world.json` and `config/ops.json`)

| Key | Default | Effect |
|---|---|---|
| `tick_budget_active_share` | 0.7 | Max Active share of tick time before a warning |
| `tick_budget_warn_threshold_ms` | 40 | Active-time warning threshold |
| `near_tick_rate_hz` | 5 | Near-tier step rate |
| `snapshot_interval_ticks` | 6000 | Persistence slice interval |
| `metrics_path` | `/metrics` | Where the tick window is served; empty disables it |
| `metrics_window_ticks` | 300 | Samples kept (15 s at 20 Hz) |

The tick rate itself is **not** here: `net_proto.tick_rate_hz` is the single
authoritative value (the dead `world.tick_rate_hz` was removed in 1-A).

## Missing

- **No `tick_budget_samples` table** (Appendix H); O02 migrations have not
  landed, so the window is in memory only and a restart forgets it.
- **`queue_depth` and `snapshot_ms` are still not measured.** The window covers
  simulation time; persistence slice cost and send-queue depth are not in it.
- **No tier yielding.** The old rule "if the tick runs long, Dormant slips
  first, then Near, never Active" is not implemented. `step()` runs Active, then
  Near if its accumulator is due, then Dormant if its accumulator is due; there
  is no remaining-budget check between them. A long tick delays the next tick
  rather than shedding work. `overBudgetTicks` and `peakActiveShare` now provide
  the trigger such a rule would read, and nothing reads it yet.

## Network side (added after this file was written)

Broadcast cost is now the part of the tick that is actually measured:

- STATE and KEYFRAME are gated per player by `client_send_rate_hz` through
  `stepCadence` (`apps/server/src/ops/broadcastCadence.ts`, called from
  `apps/server/src/tick/stateBroadcast.ts`), so a client receives them at the
  configured rate rather than every simulation tick.
- Weather and day/night are gated by `weather_send_rate_hz`.
- Per-channel message and byte counters exist and are reported through the
  `dev_log_network` dev channel; sends refused for socket backlog are counted
  separately.

## Requirements, restated as open or done

1. **Tier yielding when over budget** — open, see Missing.
2. **A warning that someone can see** — **done**: `World.start()` subscribes,
   `TickMetrics` counts it, and `GET /metrics` reports `budgetWarnings`,
   `overBudgetTicks`, `peakActiveShare` and `lastWarning`.
3. **Metrics and the sample table** — metrics done (in-memory window); the
   sample table is still open.
4. **H01 bot runs at 50 → 500 → 2,000** — open. `tools/sim-bots` exists and the
   window now gives a run something to record; no run has been recorded.
