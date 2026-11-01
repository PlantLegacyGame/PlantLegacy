# Partitioning and LOD

**Status:** placeholder. Owner: **T03** (weeks 10–11).
**Source of truth:** DESIGN.md Parts 13.5, 13.6, 13.7.

T03 must return a written strategy before the world server is accepted. Build for
50–100 detailed plants; design for 10,000 per World.

## Open items T03 must settle

- Cell size (default 64×64 world units) and interest ring radius.
- Per-client entity cap and how the overflow is downgraded to L1/L2.
- How Dormant catch-up integration is computed when a plant wakes.
- Snapshot time-slicing so persistence never spikes a tick.

## Fixed by the plan

- One World = one process + one Postgres. No Redis, no queue, no microservices.
- Tiers: Active (full tick), Near (reduced), Dormant (coarse + wake-ups).
- Dormant work is delayed first when the tick runs long; Active work never waits.
- 10k is a design target, not a pass/fail test.
