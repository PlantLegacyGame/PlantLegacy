# Data model

**Status:** reference. Tables are created by T03 (plants, events), T08C (accounts, sessions, rate_limits); the rest arrive with their owning tasks.
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
| `password_hash` | `text` | argon2id |
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
| `refresh_token_hash` | `text` | argon2id of refresh token |
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

Migration tooling lands with O02.
