# Data model

**Status:** reference. `world_plants` and `world_events` (T03), `accounts`, `sessions` and `rate_limits` (T08C), `world_state` (T03 season calendar) and the three terrain tables (T25) exist; the rest arrive with their owning tasks.
**Source of truth:** DESIGN.md Appendix H.

Every gameplay table carries `world_id`. All item and Spore mutations must use
row-level locks (RULE_17). The current inventory is the one exception and is a
documented defect: it lives in memory only, so no economy code may build on it
until T08A is completed ([`tasks/T08A.md`](./tasks/T08A.md)).

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

## Current tables

### `world_plants` (T03)
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `p_` prefix |
| `world_id` | `uuid` | FK → `worlds` |
| `owner_id` | `uuid` | FK → `accounts` (or `anon_<plantId>`) |
| `snapshot` | `bytea` | Versioned binary envelope (PLNT magic, u16 ver, u32 len, u32 CRC32) |
| `event_log` | `jsonb` | `PlantEvent[]` array, max 1000 entries |
| `root_node_id` | `text` | |
| `total_biomass` | `numeric` | |
| `total_upkeep` | `numeric` | |
| `node_count` | `integer` | |
| `max_nodes` | `integer` | |
| `last_growth_tick` | `bigint` | |
| `growth_cooldown_until` | `bigint` | |
| `tier` | `text` | `active` \| `near` \| `dormant` |
| `last_tick` | `bigint` | |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

### `world_events` (T03)
| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial` | PK |
| `world_id` | `uuid` | |
| `event_type` | `text` | `GAME_EVENTS` value |
| `payload` | `jsonb` | |
| `created_at` | `timestamptz` | |

### `accounts` (T08C)
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `acct_` prefix |
| `username` | `text` | unique, lowercased |
| `display_name` | `text` | |
| `password_hash` | `text` | Argon2id (legacy bcrypt rows are rehashed on next login) |
| `role` | `text` | `player` \| `admin` |
| `failed_login_attempts` | `integer` | default 0 |
| `locked_until` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

### `sessions` (T08C)
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `ses_` prefix |
| `account_id` | `uuid` | FK → `accounts` |
| `refresh_token_hash` | `text` | bcrypt of refresh token |
| `refresh_token_lookup_hash` | `text` | **NOT NULL**, SHA-256 for deterministic lookup |
| `user_agent` | `text` | |
| `ip_address` | `text` | |
| `created_at` | `timestamptz` | |
| `expires_at` | `timestamptz` | |
| `revoked_at` | `timestamptz` | nullable |

### `rate_limits` (T08C)
| Column | Type | Notes |
|---|---|---|
| `ip_address` | `text` | PK part 1 |
| `endpoint` | `text` | PK part 2 |
| `attempt_count` | `integer` | |
| `window_start` | `timestamptz` | |

Unique constraint on `(ip_address, endpoint)` for atomic upsert.

### `world_state` (T03 season calendar)
| Column | Type | Notes |
|---|---|---|
| `world_id` | `text` | PK. One row per world |
| `season` | `integer` | Default 1. Survives restart and replanting |
| `season_remaining_ticks` | `bigint` | **Remaining** ticks, not an absolute tick: the counter restarts at 0 each boot |
| `last_calamity_at` | `timestamptz` | Wall time; display only |
| `updated_at` | `timestamptz` | |

### Terrain: `terrain_chunks`, `terrain_edits`, `terrain_voids` (T25)
The base surface derives from the world seed, so only **edited** chunks, their
voids and an append-only edit log are stored — never one row per voxel, and
never the whole ground.

| Table | Key | Stores |
|---|---|---|
| `terrain_chunks` | `(world_id, cx, cz)` | `revision`, plus `heights`, `moisture` and `compaction` as `bytea` |
| `terrain_edits` | `(world_id, id)` | Append-only: `tick`, `actor_plant_id`, `kind`, position, `radius_m`, `volume_m3`. Indexed by `(world_id, tick)` |
| `terrain_voids` | `(world_id, id)` | Position, `radius_m`, `volume_m3`, `stability`; a void collapses when dry and loose |

### Migrations

`apps/server/src/ops/persistence/`, applied in order:

| File | Creates |
|---|---|
| `001_create_plants_table.sql` | `world_plants`, `world_events` |
| `002_create_accounts_table.sql` | `accounts`, `sessions`, `rate_limits` |
| `003_add_refresh_token_lookup_hash.sql` | Deterministic refresh-token lookup column |
| `004_rate_limits_unique_constraint.sql` | `(ip_address, endpoint)` unique key for the atomic upsert |
| `005_create_world_state_table.sql` | `world_state` |
| `006_create_terrain_tables.sql` | `terrain_chunks`, `terrain_edits`, `terrain_voids` |

### Not in the database yet

- **Inventory.** The shipped inventory is in memory only — no table, no row
  locks — which violates DESIGN T08A. See [`tasks/T08A.md`](./tasks/T08A.md).
- **Reports.** Held in a bounded in-memory queue until T40 adds a table.
- **Fauna, materials, water bodies, world objects.** Arrive with T54–T58.

Migration tooling and the restore drill land with O02.
