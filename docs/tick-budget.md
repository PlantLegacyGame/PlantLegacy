# Tick budget

**Status:** placeholder. Owner: **T03** (metrics), verified by **H01**.
**Source of truth:** DESIGN.md Parts 13.6 and 14.1.5.

The server records tick duration, per-tier cost and queue depth every second, and
warns when Active work exceeds its configured share of the budget. That is how
"online players do not notice offline simulation" is proven rather than asserted.

## Metrics to record each second

| Metric        | Meaning                        |
| ------------- | ------------------------------ |
| `active_ms`   | time spent in the Active tier  |
| `near_ms`     | time spent in the Near tier    |
| `dormant_ms`  | time spent in the Dormant tier |
| `queue_depth` | pending work items             |
| `snapshot_ms` | persistence slice cost         |

Persisted in `tick_budget_samples` (Appendix H).

## Rules

1. If the tick runs long, Dormant work slips first, then Near. Never Active.
2. A `tick_budget_exceeded` event is emitted, not logged and forgotten.
3. H01 must show Active-tier tick time inside budget at 50 → 500 → 2,000 bots.
