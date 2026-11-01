# Data model

**Status:** reference. Tables are created by T03 (plants, events) and T08A
(inventory, spores); the rest arrive with their owning tasks.
**Source of truth:** DESIGN.md Appendix H.

Every gameplay table carries `world_id`. All item and Spore mutations use
row-level locks (RULE_17); no in-memory inventories exist.

## Locked decisions

- A plant's node graph is a compact binary snapshot (`bytea`) plus a short
  append-only event log, compacted periodically. Never one row per node.
- `spore_balances` is a first-class row-locked table, not a column on accounts.
- `death_records` is written at every death from the MVP onward:
  `{plant_id, parent_seed_id, genes[], season, owner_id}`.
- Ledger erasure removes content and leaves a tombstone; nothing is silently
  deleted (RULE_5).
- `gene_mints` enforces `mints_per_plant_mutation` across acquisition and
  self-extraction (T15 / T51).

Migration tooling lands with O02.
