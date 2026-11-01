# Tunables

Every gameplay and ops value lives in `config/<system>.json` (RULE_3). This page
is the human-readable index: what each file owns, what is populated today, and
the exact type/range/default/effect of the values that exist.

Machine-readable source: the files themselves. The validator is
`packages/shared/src/config/validate.ts`.

## Format

```json
{
  "_meta": {
    "system": "ops",
    "version": "0.1.0",
    "schema": "extended-1",
    "owner_task": "O01",
    "status": "active",
    "notes": "…"
  },
  "values": {
    "port": { "type": "integer", "value": 8080, "range": [1024, 65535], "notes": "…" }
  }
}
```

- `value` **is** the default.
- Numeric entries require `range: [min, max]`, `min < max`.
- `status`: `stub` → declared, empty; `draft` → populated but not final;
  `active` → owned and used; `deprecated` → kept for migration only.
- A file's `_meta.system` must equal its filename.

### How to add a tunable

1. Add an entry to the owning file's `values`.
2. Give numbers a `range`, enums their members, strings a sensible `max_length`.
3. Read it in code through `readNumber` / `readBoolean` / `readString` — never
   inline the number.
4. Run `pnpm config:validate`.
5. Update this page if the file's status or value count changes.

## Active values

### `config/ops.json` — O01, active

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `environments` | array of string | — | `local`, `staging`, `production` | Allowed `NODE_ENV` values; selected explicitly, never from hostname |
| `port` | integer | 1024–65535 | `8080` | Listen port; `PORT` overrides |
| `host` | string | max 64 | `0.0.0.0` | Bind address; `HOST` overrides |
| `log_level` | enum | `debug`, `info`, `warn`, `error` | `info` | Minimum log severity; `LOG_LEVEL` overrides |
| `cors_origins` | array of string | — | `http://127.0.0.1:4173`, `http://localhost:4173` | Browser origins allowed to call the API; `CORS_ORIGINS` (comma-separated) overrides |
| `health_path` | string | max 64 | `/health` | Liveness path |
| `readiness_path` | string | max 64 | `/ready` | Readiness path |
| `readiness_requires_db` | boolean | — | `true` | When true, `/ready` is 503 unless Postgres answers; `READINESS_REQUIRES_DB` overrides |
| `db_pool_max` | integer | 1–100 | `10` | Maximum Postgres pool clients |
| `db_connect_timeout_ms` | integer | 500–30000 | `3000` | Postgres connection timeout |
| `db_idle_timeout_ms` | integer | 1000–600000 | `10000` | Idle Postgres client lifetime in the pool |
| `shutdown_grace_ms` | integer | 0–60000 | `10000` | Time allowed for in-flight requests before forced exit |

### `config/compliance.json` — T00, draft

| Key | Type | Default | Effect |
|---|---|---|---|
| `policy_lines` | array of string (5) | the five policy lines | The illegal-content-only policy (RULE_6); T40 enforces |
| `covered_surfaces` | array of string (8) | chat, profiles, trade listings, DMs, guild names, guild mottos, mail, reviews | Surfaces the policy applies to |
| `general_moderation` | boolean | `false` | RULE_12: no general moderation queue |

## All config files

`values` counts entries currently declared. `0` means a deliberate T00 stub; the
owning task fills it.

| File | Owner | Status | Values |
|---|---|---|---|
| `account_progress` | T08B | stub | 0 |
| `accounts` | T08C | stub | 0 |
| `achievements` | T08B | stub | 0 |
| `annotations` | T19 | stub | 0 |
| `anticheat` | T41 | stub | 0 |
| `archetypes` | T12 | stub | 0 |
| `audio` | C06 | stub | 0 |
| `boosters` | T13A | stub | 0 |
| `campaign` | T32 | stub | 0 |
| `chat` | T05 | stub | 0 |
| `climate_memory` | T39 | stub | 0 |
| `clips` | T35 | stub | 0 |
| `companions` | T11 | stub | 0 |
| `compliance` | T00 | draft | 3 |
| `controls` | C01 | stub | 0 |
| `damage` | T06 | stub | 0 |
| `daynight` | T07 | stub | 0 |
| `deep_time` | T20 | stub | 0 |
| `emotes` | T05 | stub | 0 |
| `epoch_map` | T37 | stub | 0 |
| `extraction` | T51 | stub | 0 |
| `fragments` | T51 | stub | 0 |
| `genes` | T15 | stub | 0 |
| `gift_bundles` | T45 | stub | 0 |
| `gift_packs` | T50 | stub | 0 |
| `gifts` | T29 | stub | 0 |
| `growth` | T01 | stub | 0 |
| `growth_scale` | T23 | stub | 0 |
| `guilds` | T44 | stub | 0 |
| `heirlooms` | T06A | stub | 0 |
| `inventory` | T08A | stub | 0 |
| `item_flags` | T08A | stub | 0 |
| `leaderboards` | T38 | stub | 0 |
| `ledger` | T16 | stub | 0 |
| `liveops` | T42 | stub | 0 |
| `mail` | T45 | stub | 0 |
| `marketplace` | T14 | stub | 0 |
| `messaging` | T27 | stub | 0 |
| `minimap` | T48 | stub | 0 |
| `mutations` | T04 | stub | 0 |
| `naming` | T17 | stub | 0 |
| `net_proto` | T03P | stub | 0 |
| `network` | T03 | stub | 0 |
| `observation` | T28 | stub | 0 |
| `ops` | O01 | active | 12 |
| `paid_spawn` | T21 | stub | 0 |
| `parasitism` | T10 | stub | 0 |
| `persistence` | T26 | stub | 0 |
| `prestige` | T08B | stub | 0 |
| `profiles` | T47 | stub | 0 |
| `relics` | T18 | stub | 0 |
| `render` | C01 | stub | 0 |
| `reports` | T05 | stub | 0 |
| `reproduction` | T53 | stub | 0 |
| `reputation` | T43 | stub | 0 |
| `resources` | T00A | stub | 0 |
| `root_sight` | T02 | stub | 0 |
| `session` | T08 | stub | 0 |
| `spectating` | T30 | stub | 0 |
| `spectating_ui` | T36 | stub | 0 |
| `spectator` | T34 | stub | 0 |
| `spores` | T13 | stub | 0 |
| `status` | T46 | stub | 0 |
| `symbiosis` | T09 | stub | 0 |
| `terrain` | T25 | stub | 0 |
| `territory` | T49 | stub | 0 |
| `tumbling` | T06 | stub | 0 |
| `tutorial` | T33 | stub | 0 |
| `ui` | C04 | stub | 0 |
| `uproot` | T06 | stub | 0 |
| `water` | T31 | stub | 0 |
| `weather` | T07 | stub | 0 |
| `world` | T03 | stub | 0 |

Total: **73 files**, matching DESIGN.md Part 6.2 exactly.
