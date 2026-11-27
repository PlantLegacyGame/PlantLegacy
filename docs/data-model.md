# Data model

**Status:** reference. `world_plants` and `world_events` (T03), `accounts`, `sessions` and `rate_limits` (T08C), `world_state` (T03 season calendar), the three terrain tables (T25) and `player_state` (T08A partial) exist; the rest arrive with their owning tasks.
**Source of truth:** DESIGN.md Appendix H.

Every gameplay table carries `world_id`. All item and Spore mutations must use
row-level locks (RULE_17). The pouch and purse have a restart copy in
`player_state`, keyed by account id. The live copy is still the connected
player; every pouch and purse mutation (purchase, item use, slot swap, spore
award, dev grant) is one read-modify-write transaction that locks the row and
upserts, and the row is the lock (ADR-081). `items.json` owns the item flags and
is the single catalogue (ADR-082); `inventory.json` and `item_flags.json` are
deprecated stubs with no readers. What T08A still owes is the trade/mail/list
systems, not the persistence contract. See [`tasks/T08A.md`](./tasks/T08A.md);
T14/T29/T45 build on this path.

## Locked decisions

- A plant's node graph is a compact binary snapshot (`bytea`) plus a short
  append-only event log, compacted periodically. Never one row per node.
- One `player_state` row owns an account's pouch and purse; the row is the lock. It is not a column on `accounts`. This replaces the earlier "separate `spore_balances` table" line with ADR-081, because a purchase changes the item and the price together and one row cannot half-commit.
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
| `event_log` | `jsonb` | `PlantEvent[]`, bounded by `world.event_log_compaction_threshold` (default 10000) |
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
| `world_id` | `text` | |
| `type` | `text` | `plant_death` today; the `GAME_EVENTS` feed can add more |
| `payload` | `jsonb` | plant id, owner, cause, final biomass, node count |
| `tick` | `bigint` | simulation tick |
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
| `last_login_at` | `timestamptz` | nullable; written on a successful sign-in |
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
| `id` | `bigserial` | PK |
| `ip_address` | `text` | unique part 1 |
| `endpoint` | `text` | unique part 2 |
| `attempt_count` | `integer` | |
| `window_start` | `timestamptz` | |

Unique constraint on `(ip_address, endpoint)` (migration 004) so `INSERT … ON CONFLICT`
is one statement. `id` is a surrogate key and nothing keys off it.

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

#### `terrain_chunks`
| Column | Type | Notes |
|---|---|---|
| `world_id` | `text` | PK part 1 |
| `cx` | `integer` | PK part 2, chunk column |
| `cz` | `integer` | PK part 3, chunk row |
| `revision` | `integer` | Bumped on every write; a client holding an older revision refetches |
| `heights` | `bytea` | Packed per-vertex height offsets for this chunk only |
| `moisture` | `bytea` | Packed moisture samples |
| `compaction` | `bytea` | Packed compaction samples |
| `updated_at` | `timestamptz` | |

#### `terrain_edits`
| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` | PK part 2, monotonic per world |
| `world_id` | `text` | PK part 1 |
| `tick` | `bigint` | Simulation tick; indexed with `world_id` |
| `actor_plant_id` | `text` | Nullable: an edit with no living author |
| `kind` | `text` | Which edit (dig, collapse, …) |
| `x`, `y`, `z` | `double precision` | World position |
| `radius_m` | `double precision` | |
| `volume_m3` | `double precision` | Soil removed or added |
| `created_at` | `timestamptz` | |

Append-only: a row is written once and never updated. Indexed by `(world_id, tick)`.

#### `terrain_voids`
| Column | Type | Notes |
|---|---|---|
| `world_id` | `text` | PK part 1 |
| `id` | `bigint` | PK part 2 |
| `x`, `y`, `z` | `double precision` | World position |
| `radius_m` | `double precision` | |
| `volume_m3` | `double precision` | |
| `stability` | `double precision` | Below its threshold and dry, the void collapses |

### `player_state` (T08A, partial)
| Column | Type | Notes |
|---|---|---|
| `owner_id` | `text` | PK. The account id, not the plant id: a new seed keeps the pouch and purse |
| `slots` | `jsonb` | Array of `{ itemId, count }` or `null`; length is the configured slot count after sanitising |
| `spores` | `bigint` | Non-negative; clamped to `spores.max_balance` on read and write |
| `updated_at` | `timestamptz` | |

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
| `007_create_player_state_table.sql` | `player_state` |

### Not in the database yet

- **The rest of the inventory contract.** `player_state` persists the pouch and
  purse, and every pouch and purse mutation (purchase, item use, slot swap, spore
  award, dev grant) is a single read-modify-write transaction; `items.json` owns
  the flags (ADR-082). The duplication audit passed; the trade/mail/list systems are
  open; see [`tasks/T08A.md`](./tasks/T08A.md).
- **Reports.** Held in a bounded in-memory queue until T40 adds a table.
- **Fauna, materials, water bodies, world objects.** Arrive with T54–T58.

Migration tooling and the restore drill land with O02.
