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

## Populated values

Sixteen files carry values today. The other 59 are deliberate stubs.

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

### `config/net_proto.json` — T03P, draft

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `protocol_version` | integer | 1–255 | `1` | Wire protocol version; bumped on a breaking change |
| `max_message_size_bytes` | integer | 1024–1048576 | `16384` | WebSocket `maxPayload`; larger frames are dropped |
| `tick_rate_hz` | integer | 10–60 | `20` | Server simulation/broadcast rate |
| `position_quantization` | integer | 16–256 | `64` | Position is rounded to `1/64` unit before broadcast |
| `angle_quantization_bits` | integer | 8–32 | `16` | Rotation quantization bits |
| `keyframe_interval_ticks` | integer | 1–60 | `10` | Ticks between full `KEYFRAME` snapshots |
| `max_velocity_units_per_tick` | number | 0.1–10 | `0.5` | Server rejects inputs that exceed this speed |
| `world_bounds` | object | — | `min_x/max_x/min_z/max_z = ±1000` | Server rejects positions outside the box |
| `client_send_rate_hz` | integer | 5–60 | `20` | Client input send rate |

### `config/onboarding.json` — T00A, draft

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `hint_card_lines` | array of string | — | three lines | First-spawn hint card text (RULE_13 keeps it minimal) |
| `show_hint_card_duration_ms` | integer | 3000–60000 | `10000` | How long the hint card stays visible |
| `resource_tooltips` | object | — | `light`, `water`, `minerals` strings | Tooltip text on the resource readout |

### `config/plant_renderer.json` — T01, draft

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `max_nodes_per_plant` | integer | 100–10000 | `1000` | GPU buffer size for one plant's points |
| `root_max_depth` | number | 10–200 | `50` | Maximum root depth used by the generator |
| `canopy_max_height` | number | 10–200 | `50` | Maximum canopy height used by the generator |
| `node_spacing_min` | number | 0.1–5 | `0.5` | Minimum spacing between generated nodes |
| `node_spacing_max` | number | 0.5–10 | `2` | Maximum spacing between generated nodes |
| `branch_probability` | number | 0–1 | `0.15` | Branch chance in the generator |
| `root_sight_enabled` | boolean | — | `true` | Enables root visualization |
| `root_sight_opacity` | number | 0.1–1 | `0.6` | Root point opacity |
| `canopy_sight_enabled` | boolean | — | `true` | Enables canopy visualization |
| `photosynthesis_visualization` | boolean | — | `true` | Tints nodes by photosynthesis rate |
| `water_flow_visualization` | boolean | — | `true` | Shows water flow on root nodes |
| `nutrient_flow_visualization` | boolean | — | `true` | Shows nutrient flow on root nodes |
| `shader_quality` | enum | `low`, `medium`, `high`, `ultra` | `high` | Shader quality tier |
| `max_gpu_buffers` | integer | 2–16 | `8` | Maximum GPU buffers the renderer may hold |
| `compute_shader_workgroup_size` | integer | 16–256 | `64` | Reserved for compute-shader work |

### `config/resources.json` — T00A, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `tile_size` | integer | 1–64 | `4` | World units per resource tile |
| `tile_light_base` | number | 0–200 | `80` | Base light per tile |
| `tile_moisture_base` | number | 0–200 | `40` | Base moisture per tile |
| `tile_minerals_base` | number | 0–200 | `30` | Base minerals per tile |
| `max_light` | number | 0–500 | `200` | Maximum light per tile |
| `max_moisture` | number | 0–500 | `200` | Maximum moisture per tile |
| `max_minerals` | number | 0–500 | `200` | Maximum minerals per tile |
| `absorption_per_s` | number | 0–10 | `0.5` | Absorption rate per second per draw unit |
| `max_absorption_per_tick` | number | 0–100 | `10` | Maximum absorption per tick |
| `growth_water_consumption_rate` | number | 0–1 | `0.1` | Water consumption per biomass per second |
| `growth_nutrient_consumption_rate` | number | 0–1 | `0.1` | Nutrient consumption per biomass per second |
| `growth_mineral_consumption_rate` | number | 0–1 | `0.1` | Mineral consumption per biomass per second |
| `evaporation_rate` | number | 0–1 | `0.02` | Moisture evaporation per tick |
| `diffusion_rate` | number | 0–1 | `0.1` | Resource diffusion toward neighbour mean |
| `deposit_biomass_fraction` | number | 0–1 | `0.5` | Fraction of biomass deposited on death |
| `deposit_radius` | number | 1–50 | `5` | Radius for death mineral deposits |
| `photosynthesis_biomass_rate` | number | 0–10 | `1.0` | Biomass gain per leaf per second |
| `photosynthesis_energy_rate` | number | 0–10 | `1.0` | Energy gain per leaf per second |

### `config/world.json` — T03, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `active_tick_rate_hz` | integer | 10–60 | `20` | Active tier tick rate |
| `near_tick_rate_hz` | integer | 1–20 | `5` | Near tier tick rate |
| `dormant_step_interval_sec` | integer | 60–3600 | `300` | Dormant tier step interval |
| `offline_damage_multiplier` | number | 0.1–10 | `1.0` | Damage multiplier for offline tiers |
| `tick_budget_active_share` | number | 0.1–1.0 | `0.7` | Active tier share of tick budget warning |
| `tick_budget_warn_threshold_ms` | number | 1–100 | `40` | Active tier ms warning threshold |
| `near_distance` | number | 10–500 | `50` | Distance for near tier classification |
| `reconnect_window_min` | integer | 1–60 | `5` | Reconnect window in minutes |

### `config/network.json` — T03, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `client_send_rate_hz` | integer | 5–60 | `20` | Client input send rate |
| `state_broadcast_rate_hz` | integer | 1–60 | `20` | STATE broadcast rate |
| `keyframe_interval_ticks` | integer | 1–60 | `10` | KEYFRAME interval |
| `max_players_per_cell` | integer | 10–500 | `100` | Interest management cell capacity |

### `config/accounts.json` — T08C, active

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `access_token_lifetime_min` | integer | 5–120 | `15` | Access token lifetime in minutes |
| `refresh_token_lifetime_days` | integer | 1–365 | `30` | Refresh token lifetime in days |
| `password_min_length` | integer | 6–64 | `8` | Minimum password length |
| `password_max_length` | integer | 8–256 | `128` | Maximum password length |
| `password_require_uppercase` | boolean | — | `true` | Require uppercase letter |
| `password_require_lowercase` | boolean | — | `true` | Require lowercase letter |
| `password_require_digit` | boolean | — | `true` | Require digit |
| `password_require_special` | boolean | — | `false` | Require special character |
| `username_min_length` | integer | 2–32 | `3` | Minimum username length |
| `username_max_length` | integer | 3–64 | `24` | Maximum username length |
| `username_allowed_chars` | string | — | `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-` | Allowed username characters |
| `rate_limit_signup_per_hour` | integer | 1–100 | `5` | Max sign-up attempts per IP per hour |
| `rate_limit_login_per_minute` | integer | 1–60 | `10` | Max login attempts per IP per minute |
| `rate_limit_refresh_per_minute` | integer | 5–100 | `20` | Max refresh attempts per IP per minute |
| `lockout_max_failed_attempts` | integer | 3–20 | `5` | Max failed attempts before lockout |
| `lockout_duration_min` | integer | 5–1440 | `15` | Lockout duration in minutes |
| `argon2_time_cost` | integer | 1–10 | `3` | Argon2id time cost |
| `argon2_memory_cost_kib` | integer | 8192–1048576 | `65536` | Argon2id memory cost in KiB |
| `argon2_parallelism` | integer | 1–8 | `4` | Argon2id parallelism |
| `jwt_algorithm` | enum | `HS256`, `RS256` | `HS256` | JWT signing algorithm |
| `jwt_issuer` | string | — | `plant-legacy` | JWT issuer claim |
| `jwt_audience` | string | — | `plant-legacy-client` | JWT audience claim |
| `display_name_min_length` | integer | 1–32 | `1` | Minimum display name length |
| `display_name_max_length` | integer | 1–64 | `32` | Maximum display name length |
| `session_max_per_account` | integer | 1–50 | `10` | Max concurrent sessions per account |

### `config/root_sight.json` — T02, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `enabled` | boolean | — | `true` | Enable Root Sight feature |
| `cutaway_radius` | number | 0.5–50 | `10` | Soil cutaway radius around camera |
| `soil_opacity` | number | 0.1–1.0 | `0.3` | Soil opacity in cutaway |
| `own_root_color` | string | `#rrggbb` | `#4CAF50` | Own root highlight color |
| `rival_root_color` | string | `#rrggbb` | `#FF5722` | Rival root highlight color |
| `transition_duration_ms` | integer | 100–2000 | `500` | Camera mode transition duration |
| `substrate_multiplier` | number | 0.1–1.0 | `0.5` | Substrate height multiplier for uproot crawl |

### `config/weather.json` — T07, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `clear_duration_min_s` | integer | 30–7200 | `300` | Clear weather minimum duration |
| `clear_duration_max_s` | integer | 30–7200 | `900` | Clear weather maximum duration |
| `rain_duration_min_s` | integer | 30–3600 | `120` | Rain minimum duration |
| `rain_duration_max_s` | integer | 30–3600 | `300` | Rain maximum duration |
| `storm_telegraph_duration_s` | integer | 10–300 | `30` | Storm telegraph duration |
| `storm_active_duration_s` | integer | 30–600 | `60` | Storm active duration |
| `storm_aftermath_duration_s` | integer | 30–600 | `60` | Storm aftermath duration |
| `rain_light_multiplier` | number | 0.1–1.0 | `0.7` | Light multiplier during rain |
| `storm_light_multiplier` | number | 0.0–1.0 | `0.3` | Light multiplier during storm |
| `rain_moisture_deposit_per_s` | number | 0–10 | `2.0` | Moisture deposit rate during rain |
| `storm_moisture_deposit_per_s` | number | 0–10 | `5.0` | Moisture deposit rate during storm |
| `clear_to_rain_prob` | number | 0–1 | `0.15` | Clear → rain transition probability |
| `rain_to_clear_prob` | number | 0–1 | `0.3` | Rain → clear transition probability |
| `rain_to_storm_prob` | number | 0–1 | `0.2` | Rain → storm telegraph probability |
| `telegraph_to_active_prob` | number | 0–1 | `1.0` | Telegraph → active (always) |
| `active_to_aftermath_prob` | number | 0–1 | `1.0` | Active → aftermath (always) |
| `aftermath_to_clear_prob` | number | 0–1 | `1.0` | Aftermath → clear (always) |

### `config/daynight.json` — T07, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `cycle_length_s` | integer | 300–86400 | `1800` | Full day/night cycle length |
| `day_fraction` | number | 0.1–0.9 | `0.66` | Fraction of cycle that is day |
| `sun_elevation_day` | number | 0–90 | `60` | Sun elevation at midday |
| `sun_elevation_night` | number | -90–0 | `-30` | Moon elevation at midnight |
| `sun_intensity_day` | number | 0.1–5.0 | `1.5` | Directional light intensity at midday |
| `sun_intensity_night` | number | 0.0–1.0 | `0.15` | Directional light intensity at midnight |
| `ambient_intensity_day` | number | 0.0–1.0 | `0.6` | Ambient light intensity at midday |
| `ambient_intensity_night` | number | 0.0–1.0 | `0.15` | Ambient light intensity at midnight |

### `config/render.json` — C03, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `camera_start_distance` | number | 1–100 | `6` | Initial camera distance from plant |
| `camera_pan_speed` | number | 0.1–10 | `2` | Camera pan speed multiplier |
| `quality_tiers` | array of object | — | 4 tiers | Dynamic resolution tiers |
| `fog_density_clear` | number | 0.0–0.5 | `0.02` | Fog density in clear weather |
| `fog_density_rain` | number | 0.0–0.5 | `0.05` | Fog density in rain |
| `fog_density_storm` | number | 0.0–0.5 | `0.08` | Fog density in storm |
| `rain_particle_count` | integer | 100–5000 | `1500` | Rain particle count |
| `lightning_flash_duration_ms` | integer | 10–200 | `50` | Lightning flash duration |
| `webgpu_enabled` | boolean | — | `true` | Enable WebGPU renderer when available |

### `config/plant_world.json` — T01/T03, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `max_nodes_per_plant` | integer | 100–10000 | `2000` | Maximum nodes per plant |
| `max_energy_per_plant` | number | 100–10000 | `1000` | Maximum energy storage |
| `energy_upkeep_per_biomass` | number | 0.001–1.0 | `0.01` | Energy upkeep per biomass per second |
| `growth_cooldown` | number | 0.1–10 | `1.0` | Growth cooldown in seconds |
| `germination_min_light` | number | 0–200 | `40` | Minimum light for germination |
| `germination_min_moisture` | number | 0–200 | `40` | Minimum moisture for germination |
| `growth_min_water` | number | 0–100 | `10` | Minimum stored water for growth |
| `growth_min_nutrients` | number | 0–100 | `10` | Minimum stored nutrients for growth |
| `growth_min_minerals` | number | 0–100 | `10` | Minimum stored minerals for growth |
| `root_growth_speed` | number | 0.1–10 | `0.5` | Root growth speed per tick |
| `canopy_growth_speed` | number | 0.1–10 | `0.5` | Canopy growth speed per tick |
| `root_overlap_pressure_damage` | number | 0.1–100 | `10.0` | Root overlap damage per second |
| `light_blocking_per_node` | number | 0.1–10 | `2.0` | Light blocking per canopy node |

### `config/persistence.json` — T03, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `save_interval_ms` | integer | 1000–300000 | `30000` | Periodic save interval |
| `event_log_max_entries` | integer | 10–10000 | `1000` | Max event log entries per plant |

### `config/interest.json` — T03, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `cell_size` | integer | 10–500 | `50` | Interest management cell size |
| `max_entities_per_cell` | integer | 10–500 | `100` | Max entities per cell |
| `subscribe_radius_cells` | integer | 1–10 | `2` | Client subscription radius in cells |


### `config/controls.json` — C01, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `camera_pan_left` | string | — | `KeyA` | Pan camera left |
| `camera_pan_right` | string | — | `KeyD` | Pan camera right |
| `camera_pan_up` | string | — | `KeyW` | Pan camera up |
| `camera_pan_down` | string | — | `KeyS` | Pan camera down |
| `camera_orbit_left` | string | — | `ArrowLeft` | Orbit camera left |
| `camera_orbit_right` | string | — | `ArrowRight` | Orbit camera right |
| `camera_orbit_up` | string | — | `ArrowUp` | Orbit camera up |
| `camera_orbit_down` | string | — | `ArrowDown` | Orbit camera down |
| `text_scale` | number | 0.8–1.5 | `1.0` | Global text scale factor |

### `config/ui.json` — C01, active

| Key | Type | Range | Default | Effect |
|---|---|---|---|---|
| `toast_duration_ms` | integer | 1000–30000 | `3000` | Toast notification duration |
| `theme_primary` | string | `#rrggbb` | `#2E7D32` | Primary theme color |
| `theme_secondary` | string | `#rrggbb` | `#4CAF50` | Secondary theme color |
| `theme_background` | string | `#rrggbb` | `#1B1B1B` | Background color |
| `theme_surface` | string | `#rrggbb` | `#2D2D2D` | Surface color |
| `theme_on_surface` | string | `#rrggbb` | `#FFFFFF` | Text on surface color |
| `z_index_hud` | integer | 1–100 | `10` | HUD layer z-index |
| `z_index_panel` | integer | 1–100 | `20` | Panel layer z-index |
| `z_index_modal` | integer | 1–100 | `50` | Modal layer z-index |
| `z_index_toast` | integer | 1–100 | `100` | Toast layer z-index |
| `z_index_tooltip` | integer | 1–100 | `200` | Tooltip layer z-index |
| `z_index_debug` | integer | 1–100 | `1000` | Debug overlay z-index |


## All config files

`values` counts entries currently declared. `0` means a deliberate T00 stub; the
owning task fills it.

| File | Owner | Status | Values |
|---|---|---|---|
| `account_progress` | T08B | stub | 0 |
| `accounts` | T08C | active | 29 |
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
| `controls` | C01 | active | 10 |
| `damage` | T06 | stub | 0 |
| `daynight` | T07 | active | 8 |
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
| `net_proto` | T03P | draft | 9 |
| `network` | T03 | active | 4 |
| `observation` | T28 | stub | 0 |
| `onboarding` | T00A | draft | 3 |
| `ops` | O01 | active | 12 |
| `paid_spawn` | T21 | stub | 0 |
| `parasitism` | T10 | stub | 0 |
| `persistence` | T03 | active | 2 |
| `plant_renderer` | T01 | draft | 15 |
| `plant_world` | T01/T03 | active | 13 |
| `prestige` | T08B | stub | 0 |
| `profiles` | T47 | stub | 0 |
| `relics` | T18 | stub | 0 |
| `render` | C03 | active | 9 |
| `reports` | T05 | stub | 0 |
| `reproduction` | T53 | stub | 0 |
| `reputation` | T43 | stub | 0 |
| `resources` | T00A | active | 16 |
| `root_sight` | T02 | active | 7 |
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
| `ui` | C01 | active | 11 |
| `uproot` | T06 | stub | 0 |
| `water` | T31 | stub | 0 |
| `weather` | T07 | active | 20 |
| `world` | T03 | active | 8 |

Total: **75 files** — the 73 systems named in DESIGN.md Part 6.2 plus
`onboarding.json` (T00A) and `plant_renderer.json` (T01). Sixteen files are
populated (`ops`, `compliance`, `net_proto`, `onboarding`, `plant_renderer`,
`resources`, `world`, `network`, `accounts`, `root_sight`, `weather`, `daynight`,
`render`, `plant_world`, `persistence`, `interest`, `controls`, `ui`);
the other 57 are stubs.

## Approved V5.4 config files (not created yet)

These are specified in `DESIGN.md` Part 11 and indexed in
[`v5.4-extension-plan.md`](./v5.4-extension-plan.md). They are **not** in
`config/` yet, so the validator count stays at 75.

| File | Owner | Purpose |
|---|---|---|
| `fauna.json` | T54 | Species, needs, senses, reflexes, animal vocalizations, influence maps, population caps, trap/struggle |
| `materials.json` | T55 | Material/element definitions, reaction matrix, CA cadence, flow and temperature rules |
| `terrain_volume.json` | T56 | Chunk size, world height, generation, material palette, LOD, collision, persistence |
| `terrain_features.json` | T57 | Parametric feature schema, control points, blend and validation limits |
| `world_objects.json` | T58 | Object types, behaviour state machines, persistence policy, interaction hooks |
| `succession.json` | T59 | Stages, thresholds, seed bank, recovery pulses, disturbance resets, deep-time hooks |
| `orchestration.json` | O04 | World pool, allocation thresholds, drain, routing, archive/restore, cost caps |

When the first file is created, update the count here, in `CONTEXT.md`,
`README.md`, `apps/server/src/core/config.test.ts` and the manual checklists in
the same change.
