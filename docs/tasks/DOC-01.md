# DOC-01 — Documentation truth: quoted defaults and stale records

**Status:** `[~]` — **the 24 quoted defaults are cleared (2026-11-16)** and the
check is an error now, so they cannot come back. The remaining items are the
non-table documentation bugs D-01, D-02, D-04 and D-05, which belong to FIX-04
(protocol version) and FIX-05 (`pnpm verify`) in [`../bugfix-plan.md`](../bugfix-plan.md).

Created 2026-11-16 as the inventory that `tools/docs-check/check.mjs` already
points at — the checker printed `... N more (docs/tasks/DOC-01.md)` for a file
that did not exist until then.

**Why this file exists.** `docs:check` compares every `Default` cell in a task
record's `## Config: \`config/<file>.json\`` table with `values[key].value`. It
found **24 mismatches in 95 quoted rows** and then exited 0, so CI stayed green
while five task records told readers the wrong numbers. The plan entry that fixes
this is `FIX-02` and `FIX-03` in [`../bugfix-plan.md`](../bugfix-plan.md).

**Rule applied throughout:** `config/` owns the default; a document quotes it.
Where a key no longer exists, the row is deleted rather than given a made-up
value.

## How the list was produced

```sh
pnpm docs:check        # prints the first 10 rows and "N more"
```

The full list needs a scan that does not truncate; the 24 rows below are that
scan, run 2026-11-16 against the working tree.

## The 24 rows

| # | Document | Key | Quoted | Config |
|---|---|---|---|---|
| 1 | `docs/tasks/C01.md` | `fps_warning_threshold` | 0.85 | 0.7 |
| 2 | `docs/tasks/C01.md` | `resolution_floor` | 0.25 | 0.5 |
| 3 | `docs/tasks/C01.md` | `camera_min_distance` | 10.0 | 1 |
| 4 | `docs/tasks/C01.md` | `camera_max_distance` | 200.0 | 2000 |
| 5 | `docs/tasks/C01.md` | `camera_max_polar_angle` | 1.52 | 3.1 |
| 6 | `docs/tasks/C01.md` | `shadow_map_size` | 2048 | 1024 |
| 7 | `docs/tasks/T00A.md` | `tile_moisture_base` | 40 | 150 |
| 8 | `docs/tasks/T00A.md` | `rain_gain_per_s` | 0.5 | 1.5 |
| 9 | `docs/tasks/T00A.md` | `evaporation_per_s` | 0.1 | 0.025 |
| 10 | `docs/tasks/T00A.md` | `absorption_per_s` | 0.2 | 2.4 |
| 11 | `docs/tasks/T00A.md` | `photosynthesis_rate` | 0.1 | 1 |
| 12 | `docs/tasks/T00A.md` | `diffusion_rate` | 0.01 | 0.03 |
| 13 | `docs/tasks/T01.md` | `root_growth_speed` | 0.5 | 0.85 |
| 14 | `docs/tasks/T01.md` | `canopy_growth_speed` | 0.5 | 0.95 |
| 15 | `docs/tasks/T01.md` | `node_cost_base` | 10 | 20 |
| 16 | `docs/tasks/T01.md` | *(heading)* `config/plant_world.json` | — | file does not exist |
| 17 | `docs/tasks/T01.md` | `save_interval_ms` | — | no such key |
| 18 | `docs/tasks/T01.md` | `event_log_max_entries` | — | no such key |
| 19 | `docs/tasks/T03.md` | `tick_rate_hz` | — | no such key (moved to `net_proto`) |
| 20 | `docs/tasks/T03.md` | `offline_damage_multiplier` | — | no such key |
| 21 | `docs/tasks/T03.md` | `detailed_plant_budget` | 100 | 256 |
| 22 | `docs/tasks/T03.md` | `per_client_entity_cap` | 200 | 1000 |
| 23 | `docs/tasks/T03P.md` | `protocol_version` | 1 | 3 |
| 24 | `docs/tasks/T03P.md` | `max_velocity_units_per_tick` | 0.5 | 5 |

By document: C01 6, T00A 6, T01 6, T03 4, T03P 2 — 24. Rows 1-15 and 21-24 are
one-line edits: make the quoted cell equal the config value. Rows 16-20 need a
decision about the table itself, recorded below.

## The five structural rows

**16 — `## Config: config/plant_world.json` in T01.md.** That file has never
existed. Eleven of the twelve keys under it live in `config/growth.json`
(`max_nodes_per_plant`, `energy_upkeep_per_biomass`, `growth_cooldown`,
`germination_min_light`, `germination_min_moisture`, `growth_min_water`,
`growth_min_nutrients`, `growth_min_minerals`, `root_growth_speed`,
`canopy_growth_speed`, `light_blocking_per_node`). Retitle the heading to
`config/growth.json` and delete two rows:

- `max_energy_per_plant` — replaced by `energy_capacity_per_biomass` and
  `energy_capacity_floor` in `config/growth.json`; the only `max_energy_per_plant`
  left in the tree is a dev knob in `config/dev.json`.
- `root_overlap_pressure_damage` — deleted by INV-TM-06. Roots must be able to
  touch for symbiosis and grafting (ADR-051), so a root-overlap damage number
  cannot come back under that name.

**17-18 — `config/persistence.json` keys in T01.md.** The file exists and is a
stub (`values: {}`); neither `save_interval_ms` nor `event_log_max_entries` exists
anywhere in `config/`. The live keys are `config/world.json`
`plant_save_interval_s` and `event_log_compaction_threshold`. Re-point the table
at `config/world.json`, or delete it and let `docs/tasks/T03.md` own persistence
timings.

**19-20 — `config/world.json` keys in T03.md.** `tick_rate_hz` was removed in
plan item 1-A so that `net_proto.tick_rate_hz` is the only tick rate;
`offline_damage_multiplier` never existed — offline plants are the
Active/Near/Dormant tiers, not a damage multiplier. Delete both rows.

## Documentation bugs outside the config tables

| ID | Where | Bug | Correct statement |
|---|---|---|---|
| D-01 | `CONTEXT.md:382` | "`PROTOCOL_VERSION = 2` (v2 adds the T04 mutation messages)" | `PROTOCOL_VERSION = 3`; v2 added `MUTATION_STATE`/`MUTATION_SHED`, v3 adds `MUTATION_LEVEL` and levels in `MUTATION_STATE` |
| D-02 | `docs/protocol.md:350` | config table row says `protocol_version` default 2 | 3 (and see FIX-04: the key may be removed entirely) |
| D-03 | `docs/tasks/T03P.md:20`, `:53` | say version 1 | 3 |
| D-04 | `docs/decisions.md:213` | records `PROTOCOL_VERSION = 1` for the T03P decision | leave the historical record, append "superseded — the wire is at 3" so the decision log stays honest about when it was true |
| D-05 | `README.md` Quick start | "To run the checks CI runs: `pnpm verify`" — CI also runs `docs:check` and `build` | either add both to `verify` (FIX-05) or say so |
| D-06 | `docs/bug-inventory.md` F5 | marked `[ ]` and re-states the old 50 / 0.3 | it is fixed; `docs/tasks/T02.md:51,53` reads 7.0 / 0.45 |
| D-07 | `docs/bug-inventory.md` A6 | marked `[ ]` while its own text and test describe the fix | move to **Fixed** |
| D-08 | `docs/bug-inventory.md` E4 | claims drought shrinking node radii is a defect | the code does it deliberately (`plantWorld.ts:1855-1863`) and drains canopy before roots; withdraw or restate |
| D-09 | `tools/docs-check/check.mjs:1-10` | header lists four checks and says "Exit 1 on any failure", but the drift check is a fifth that never fails | after FIX-03, list five and make drift fatal |

## Acceptance

- [x] `pnpm docs:check` reports 0 mismatches in 95 quoted rows.
- [x] Rows 16-20 are resolved by editing the documents, not by weakening the
      check: the phantom `plant_world.json` table and the dead `persistence.json`
      table are deleted, their live keys folded into the `config/growth.json`
      table; the two `world.json` rows that no longer exist are deleted.
- [x] The drift check is an **error**, so this cannot silently return. Proven by
      flipping `shadow_map_size` to 999 and watching `docs:check` exit 1.
- [ ] D-01 to D-09 are corrected; D-04 is annotated rather than rewritten.
      Done: D-03, D-06, D-07, D-08, D-09. Open: D-01, D-02, D-04, D-05
      (protocol version and the `verify` claim).

## Why the check did not catch its own dangling pointer

The link checker only matches a markdown link whose target ends in `.md`. The
`docs/tasks/DOC-01.md` reference
was inside a printed message string, so it was never treated as a link. This
file's existence plus FIX-03's wording change closes that gap; a stronger
guardrail would also scan backticked `docs/…md` paths in tool sources, which is
optional and not required for the acceptance above.
