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

Twenty-one files carry values today. The other 56 are deliberate stubs.

### `config/ops.json` — O01, active

13 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `environments` | array | — | see file | Environment separation. Selected by NODE_ENV; never inferred from the hostname. |
| `port` | integer | 1024–65535 | `8080` | Overridden by PORT. |
| `host` | string | — | `0.0.0.0` | Bind address. Overridden by HOST. |
| `log_level` | enum | `debug`, `info`, `warn`, `error` | `info` | Overridden by LOG_LEVEL. |
| `cors_origins` | array | — | see file | Browser origins allowed to call the API. Overridden by CORS_ORIGINS (comma-separated). |
| `health_path` | string | — | `/health` |  |
| `readiness_path` | string | — | `/ready` |  |
| `readiness_requires_db` | boolean | — | `true` | When true, /ready returns 503 unless Postgres answers. |
| `db_pool_max` | integer | 1–100 | `10` |  |
| `db_connect_timeout_ms` | integer | 500–30000 | `3000` |  |
| `db_idle_timeout_ms` | integer | 1000–600000 | `10000` | How long an idle Postgres client stays in the pool before closing. |
| `shutdown_grace_ms` | integer | 0–60000 | `10000` |  |
| `trust_proxy` | boolean | — | `false` | Trust X-Forwarded-For for the client IP. Enable only behind a proxy that overwrites the header (e.g. the staging tunnel); otherwise rate limits can be spoofed. |

### `config/compliance.json` — T00, draft

3 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `policy_lines` | array | — | see file | Five-line illegal-content-only policy (RULE_6). Drafted by T00; T40 owns enforcement, the age gate and the legal pages. |
| `covered_surfaces` | array | — | see file | Surfaces the policy applies to. No other surface is moderated for content. |
| `general_moderation` | boolean | — | `false` | RULE_12: no general moderation. The five lines are a payment/hosting compliance floor. |

### `config/net_proto.json` — T03P, draft

12 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `protocol_version` | integer | 1–255 | `1` | Bumped on any breaking wire change |
| `max_message_size_bytes` | integer | 1024–1048576 | `16384` | Maximum WebSocket message size |
| `max_buffered_bytes` | integer | 65536–67108864 | `4194304` | Unsent socket backlog above which tick broadcasts are skipped |
| `max_messages_per_second` | integer | 1–1000 | `120` | Sustained inbound messages allowed per connection per second |
| `message_burst` | integer | 1–5000 | `240` | Short inbound burst allowed before the sustained rate applies |
| `tick_rate_hz` | integer | 10–60 | `20` | Server simulation tick rate |
| `position_quantization` | integer | 16–256 | `64` | Position quantization denominator (1/64 unit precision) |
| `angle_quantization_bits` | integer | 8–32 | `16` | Angle quantization in bits |
| `keyframe_interval_ticks` | integer | 1–60 | `10` | Full state snapshot interval in ticks |
| `max_velocity_units_per_tick` | number | 0.1–10 | `5` | Maximum allowed velocity for movement validation |
| `world_bounds` | object | — | see file | World boundaries for out-of-bounds validation |
| `client_send_rate_hz` | integer | 5–60 | `20` | Maximum client input send rate |
| `move_speed` | number | 0.1–20 | `5` | Movement speed in units per second |
| `hello_timeout_ms` | integer | 1000–30000 | `5000` | HELLO message timeout in milliseconds |
| `reconnect_window_ms` | integer | 30000–86400000 | `300000` | Reconnect window in milliseconds for plant reclaim |

### `config/onboarding.json` — T00A, active

3 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `hint_card_lines` | array | — | see file | Exactly 3 lines per RULE_13. No editorial text, no strategy hints. |
| `show_hint_card_duration_ms` | integer | 3000–60000 | `10000` | How long hint card stays visible on first spawn |
| `resource_tooltips` | object | — | see file | Contextual tooltips for resource readout. No strategy, just what the numbers mean. |

### `config/plant_renderer.json` — C02, active

26 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `max_nodes_per_plant` | integer | 100–50000 | `2000` | Maximum nodes to render per plant |
| `smin_blend_radius` | number | 0.05–0.5 | `0.15` | Smooth minimum blend radius for organic fusion between segments. Larger = more organic fusion, smaller = sharper joints. |
| `max_raymarch_steps` | integer | 32–256 | `128` | Maximum raymarching steps for LOD 0 (closest) |
| `raymarch_hit_epsilon` | number | 0.0001–0.01 | `0.001` | Hit distance epsilon for raymarching termination |
| `bounding_box_padding` | number | 0.1–2 | `0.5` | Padding around plant bounding box for raymarch start |
| `l0_raymarch_steps` | integer | 32–256 | `128` | Raymarch steps for LOD 0 (high quality, close) |
| `l1_raymarch_steps` | integer | 16–128 | `64` | Raymarch steps for LOD 1 (medium quality) |
| `l2_raymarch_steps` | integer | 8–64 | `32` | Raymarch steps for LOD 2 (low quality, far) |
| `l0_raymarch_epsilon` | number | 0.0001–0.01 | `0.0005` | Hit epsilon for LOD 0 |
| `l1_raymarch_epsilon` | number | 0.0001–0.01 | `0.001` | Hit epsilon for LOD 1 |
| `l2_raymarch_epsilon` | number | 0.0001–0.01 | `0.002` | Hit epsilon for LOD 2 |
| `root_sight_cutaway_radius` | number | 0.5–10 | `2.5` | Radius of the Root Sight cutaway sphere (world units) |
| `root_aura_radius` | number | 0.5–10 | `3` | Radius of root highlight aura in Root Sight mode |
| `root_sight_soil_opacity` | number | 0–1 | `0.15` | Opacity of soil overlay in Root Sight mode |
| `own_root_highlight_color` | string | — | `#4CAF50` | Highlight color for player's own roots in Root Sight (hex) |
| `rival_root_highlight_color` | string | — | `#FF5722` | Highlight color for rival roots in Root Sight (hex) |
| `wind_strength` | number | 0–2 | `0.3` | Wind displacement strength multiplier |
| `wind_speed` | number | 0.1–5 | `1` | Wind animation speed multiplier |
| `health_tint_strength` | number | 0–1 | `0.5` | Strength of health-based color tinting |
| `mutation_0_param` | number | 0–2 | `0` | Mutation visualization parameter 0 |
| `mutation_1_param` | number | 0–5 | `1.5` | Mutation visualization parameter 1 |
| `mutation_2_param` | number | 0–2 | `0.3` | Mutation visualization parameter 2 |
| `photosynthesis_viz` | boolean | — | `true` | Enable photosynthesis visualization overlay |
| `water_flow_viz` | boolean | — | `true` | Enable water flow visualization overlay |
| `nutrient_flow_viz` | boolean | — | `true` | Enable nutrient flow visualization overlay |
| `emergence_duration` | number | 0.1–5 | `0.9` | Duration of emergence animation in seconds |

### `config/resources.json` — T00A, draft

40 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `tile_size` | number | 0.5–10 | `1` | World units per tile |
| `grid_width` | integer | 16–1024 | `256` | Number of tiles along X |
| `grid_height` | integer | 16–1024 | `256` | Number of tiles along Z |
| `tile_light_base` | integer | 0–500 | `80` | Base light level from sun |
| `day_night_curve` | array | — | see file | Day/night multiplier curve (32 steps, 0=midnight, 8=6am, 16=noon, 24=6pm) |
| `tile_moisture_base` | integer | 0–500 | `40` | Base moisture level |
| `rain_gain_per_s` | number | 0–5 | `0.5` | Moisture gain per second during rain |
| `evaporation_per_s` | number | 0–1 | `0.1` | Base moisture loss per second at reference temperature (20°C) |
| `temperature_base` | number | -10–40 | `20` | Base air temperature at midnight (°C) |
| `temperature_amplitude` | number | 0–30 | `15` | Temperature swing from day/night cycle (°C) |
| `temperature_sun_factor` | number | 0–1 | `0.3` | Additional temperature increase from direct sun (0-1 of max sun intensity) |
| `transpiration_factor` | number | 0–0.5 | `0.05` | Leaf transpiration rate multiplier (moisture loss per leaf per second at reference temp) |
| `photosynthesis_temp_optimum` | number | 10–40 | `25` | Optimal temperature for photosynthesis (°C) |
| `photosynthesis_temp_range` | number | 5–30 | `15` | Temperature range around optimum where photosynthesis is >50% (±°C) |
| `tile_minerals_base` | integer | 0–500 | `30` | Base mineral level |
| `absorption_per_s` | number | 0–5 | `1.2` | Minerals/moisture absorbed by roots per second |
| `absorption_radius` | number | 1–50 | `2` | Radius in tiles for root absorption |
| `dead_root_deposit` | number | 0–50 | `5` | Minerals deposited per dead root node |
| `dead_plant_deposit` | number | 0–50 | `20` | Minerals deposited per dead plant |
| `dung_deposit` | number | 0–50 | `15` | Minerals deposited by dung |
| `fertilizer_deposit` | number | 0–50 | `25` | Minerals deposited by fertilizer |
| `photosynthesis_rate` | number | 0–10 | `1` | Base photosynthesis rate |
| `photosynthesis_energy_per_second` | number | 0.1–100 | `2` | Base energy production per leaf per second at max light/moisture/minerals |
| `light_factor_curve` | array | — | see file | Piecewise-linear light factor curve |
| `moisture_factor_curve` | array | — | see file | Piecewise-linear moisture factor curve |
| `mineral_factor_curve` | array | — | see file | Piecewise-linear mineral factor curve |
| `consumption_trigger_tile_mineral_threshold` | integer | 0–100 | `20` | Tile mineral threshold for consumption trigger |
| `consumption_trigger_dung_item` | boolean | — | `true` | Enable dung consumption trigger |
| `consumption_trigger_fertilizer_item` | boolean | — | `true` | Enable fertilizer consumption trigger |
| `diffusion_rate` | number | 0–0.1 | `0.03` | Resource diffusion rate between tiles |
| `max_absorption_per_tick` | number | 0–10 | `1` | Maximum absorption per tick |
| `canopy_shade_reduction` | number | 0–1 | `0.1` | Light reduction per canopy node |
| `max_light` | integer | 100–10000 | `500` | Maximum light level (allows for magical/super-bright conditions) |
| `max_moisture` | integer | 100–10000 | `500` | Maximum moisture level (allows for flooded/super-saturated conditions) |
| `max_minerals` | integer | 100–10000 | `500` | Maximum mineral level (allows for super-fertilized conditions) |
| `photosynthesis_water_per_energy` | number | 0–1 | `0.03` | Stored water spent per unit of energy fixed by photosynthesis (transpirational cost of carbon gain) |
| `photosynthesis_mineral_per_energy` | number | 0–1 | `0.006` | Stored minerals spent per unit of energy fixed by photosynthesis (enzyme cofactors such as magnesium in chlorophyll) |
| `water_status_full_fraction` | number | 0.05–1 | `0.25` | Fraction of water capacity at which the plant counts as fully hydrated for photosynthesis. Below this, carbon gain falls away. |
| `mineral_status_full_fraction` | number | 0.05–1 | `0.25` | Fraction of mineral capacity at which the plant counts as fully supplied for photosynthesis |
| `night_transpiration_multiplier` | number | 0–1 | `0.15` | Fraction of daytime water loss that continues at night. Stomata close in darkness but rarely fully; measured night transpiration is often 10-30% of daytime. |

### `config/world.json` — T03, active

18 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `tick_rate_hz` | integer | 10–60 | `20` | Main simulation tick rate |
| `max_players_per_world` | integer | 10–50000 | `10000` | Design target for max players per world |
| `reconnect_window_min` | number | 1–60 | `5` | Reconnect window in minutes |
| `persistence_enabled` | boolean | — | `false` | Keep a disconnected plant for the reconnect window and restore it on reclaim. Off by default in local/dev: a reload or restart creates a fresh plant (ADR-029). |
| `detailed_plant_budget` | integer | 50–100 | `100` | Max detailed (L0) plants per client |
| `cell_size` | integer | 16–256 | `64` | Spatial cell size in world units |
| `interest_ring_radius` | integer | 0–3 | `1` | Number of cell rings to subscribe to |
| `per_client_entity_cap` | integer | 50–1000 | `200` | Max entities sent to a client per tick |
| `snapshot_interval_ticks` | integer | 1000–60000 | `6000` | Ticks between binary snapshots (default 5 min at 20 Hz) |
| `event_log_compaction_threshold` | integer | 1000–100000 | `10000` | Event log entries before compaction |
| `active_tick_rate_hz` | integer | 10–60 | `20` | Active tier tick rate |
| `near_tick_rate_hz` | integer | 1–20 | `5` | Near tier tick rate |
| `dormant_step_interval_sec` | number | 10–300 | `30` | Dormant tier step interval in seconds |
| `tick_budget_active_share` | number | 0.5–0.9 | `0.7` | Max share of tick budget for Active tier |
| `tick_budget_warn_threshold_ms` | number | 10–100 | `40` | Warn when Active tier exceeds this ms per tick |
| `interest_detail_distances` | object | — | see file | InterestManager detail level distances in world units |
| `max_frame_time_ms` | integer | 50–500 | `200` | Maximum frame time in ms for tick clock (prevents spiral of death) |

### `config/network.json` — T03, active

10 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `protocol_version` | integer | 1–255 | `1` | Wire protocol version |
| `max_message_size_bytes` | integer | 1024–1048576 | `65536` | Max WebSocket message size |
| `tick_rate_hz` | integer | 10–60 | `20` | Server tick rate (network update rate) |
| `keyframe_interval_ticks` | integer | 10–1000 | `100` | Keyframe broadcast interval in ticks |
| `world_bounds` | object | — | see file | World bounds for plant growth |
| `max_velocity_units_per_tick` | number | 0.1–10 | `2` | Max velocity per tick (unused, kept for protocol compatibility) |
| `binary_protocol_enabled` | boolean | — | `false` | Enable binary protocol (Part 13.8) |
| `position_quantization` | integer | 16–256 | `64` | Position quantization divisor (1/64 unit precision) |
| `angle_quantization_bits` | integer | 8–16 | `16` | Angle quantization bits |
| `rate_limit_per_type` | schema_array | — | see file | Rate limits per message type (type, max_per_second) |

### `config/accounts.json` — T08C, active

27 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `access_token_lifetime_min` | integer | 5–120 | `15` | Access token lifetime in minutes |
| `refresh_token_lifetime_days` | integer | 1–365 | `30` | Refresh token lifetime in days |
| `password_min_length` | integer | 6–64 | `8` | Minimum password length |
| `password_max_length` | integer | 8–256 | `128` | Maximum password length |
| `password_require_uppercase` | boolean | — | `true` | Require uppercase letter in password |
| `password_require_lowercase` | boolean | — | `true` | Require lowercase letter in password |
| `password_require_digit` | boolean | — | `true` | Require digit in password |
| `password_require_special` | boolean | — | `false` | Require special character in password |
| `username_min_length` | integer | 2–32 | `3` | Minimum username length |
| `username_max_length` | integer | 3–64 | `24` | Maximum username length |
| `username_allowed_chars` | string | — | `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-` | Allowed characters in username |
| `rate_limit_signup_per_hour` | integer | 1–100 | `5` | Max sign-up attempts per IP per hour |
| `rate_limit_login_per_minute` | integer | 1–60 | `10` | Max login attempts per IP per minute |
| `rate_limit_refresh_per_minute` | integer | 5–100 | `20` | Max token refresh attempts per IP per minute |
| `lockout_max_failed_attempts` | integer | 3–20 | `5` | Max failed login attempts before lockout |
| `lockout_duration_min` | integer | 5–1440 | `15` | Lockout duration in minutes |
| `bcrypt_cost` | integer | 4–15 | `12` | bcrypt work factor, used only to verify legacy hashes (they are rehashed with Argon2id on next login) |
| `argon2_memory_kib` | integer | 8192–262144 | `19456` | Argon2id memory cost in KiB (OWASP baseline is 19456) |
| `argon2_time_cost` | integer | 1–10 | `2` | Argon2id iterations |
| `argon2_parallelism` | integer | 1–8 | `1` | Argon2id lanes |
| `request_body_max_bytes` | integer | 1024–1048576 | `16384` | Maximum accepted byte length for an /auth/* request body |
| `jwt_algorithm` | enum | `HS256`, `RS256` | `HS256` | JWT signing algorithm |
| `jwt_issuer` | string | — | `plant-legacy` | JWT issuer claim |
| `jwt_audience` | string | — | `plant-legacy-client` | JWT audience claim |
| `display_name_min_length` | integer | 1–32 | `1` | Minimum display name length |
| `display_name_max_length` | integer | 1–64 | `32` | Maximum display name length |
| `session_max_per_account` | integer | 1–50 | `10` | Max concurrent sessions per account |

### `config/root_sight.json` — T02, active

7 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `cutaway_radius` | number | 5–500 | `7` | Radius of the underground cutaway sphere around the camera target |
| `transition_ms` | integer | 0–3000 | `500` | Smooth transition duration between surface and underground modes (0 = instant) |
| `soil_opacity` | number | 0–0.9 | `0.45` | Opacity of soil inside the cutaway (0 = invisible, 0.9 = nearly opaque) |
| `own_root_highlight_color` | color | — | `#4CAF50` | High-contrast color for the viewer's own roots |
| `rival_root_highlight_color` | color | — | `#FF5722` | Distinct color for nearby rival roots |
| `substrate_multiplier` | number | 0.1–1 | `0.5` | Movement multiplier for uprooted reroot crawl (T06); applies whether Root Sight is on or off |
| `camera_target` | enum | `own_plant`, `camera_position` | `own_plant` | Default cutaway target reference; the camera is an independent entity |

### `config/weather.json` — T07, active

19 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `clear_duration_min_s` | integer | 30–1800 | `180` | Minimum duration of clear weather in seconds |
| `clear_duration_max_s` | integer | 30–3600 | `420` | Maximum duration of clear weather in seconds |
| `rain_duration_min_s` | integer | 20–1200 | `120` | Minimum duration of rain in seconds |
| `rain_duration_max_s` | integer | 20–2400 | `300` | Maximum duration of rain in seconds |
| `storm_telegraph_duration_s` | integer | 10–300 | `45` | Duration of thunderstorm telegraph phase in seconds |
| `storm_active_duration_s` | integer | 10–300 | `90` | Duration of thunderstorm active phase in seconds |
| `storm_aftermath_duration_s` | integer | 30–600 | `60` | Duration of thunderstorm aftermath phase in seconds |
| `rain_moisture_gain_per_s` | number | 0–5 | `0.8` | Moisture deposited to soil tiles per second during rain |
| `storm_moisture_gain_per_s` | number | 0–10 | `1.6` | Moisture deposited to soil tiles per second during active thunderstorm |
| `clear_light_multiplier` | number | 0.5–1.5 | `1` | Ambient daylight multiplier during clear weather |
| `rain_light_multiplier` | number | 0.2–1 | `0.65` | Ambient daylight multiplier during rain |
| `storm_light_multiplier` | number | 0.1–0.8 | `0.35` | Ambient daylight multiplier during active storm |
| `storm_wind_damage_threshold` | number | 5–50 | `18` | Wind force threshold above which unreinforced canopy nodes suffer damage |
| `storm_wind_damage_rate` | number | 0–10 | `1.5` | Damage per second applied to vulnerable exposed canopy nodes during active storm |
| `lightning_frequency_per_minute` | number | 0–20 | `4` | Average lightning strikes per minute during active thunderstorm |
| `lightning_damage_radius` | number | 1–20 | `6` | Radial damage impact of a lightning strike on ground or high canopy |
| `lightning_damage_amount` | number | 5–100 | `25` | Base damage dealt to nodes caught in a lightning strike radius |
| `forecast_window_s` | integer | 30–600 | `180` | How far in advance players can read the weather forecast |
| `biome_weather_modifier` | number | 0.5–2 | `1` | Biome modifier (constant 1.0 in MVP per DESIGN.md) |

### `config/daynight.json` — T07, active

4 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `cycle_length_s` | integer | 600–7200 | `1800` | Full day/night planetary cycle length in seconds (30 minutes default) |
| `day_fraction` | number | 0.4–0.8 | `0.66` | Fraction of cycle classified as daytime (sun above horizon) |
| `dawn_dusk_transition_s` | integer | 10–300 | `60` | Duration of dawn and dusk transitions in seconds |
| `condition_mapping` | object | — | see file | Mapping from weather state to T13A booster condition tokens |

### `config/render.json` — C01, active

73 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `target_fps` | integer | 30–120 | `60` | Render-loop target frames per second on the current tier. |
| `fps_warning_threshold` | number | 0.5–0.95 | `0.7` | Fraction of target_fps at which the client downgrades resolution. |
| `resolution_floor` | number | 0.1–1 | `0.75` | Minimum renderer pixel ratio relative to devicePixelRatio. |
| `max_pixel_ratio` | number | 1–4 | `1.25` | Maximum renderer pixel ratio. |
| `camera_smoothing` | number | 0–0.5 | `0.05` | OrbitControls dampingFactor. |
| `camera_min_distance` | number | 0.1–100 | `1` | Minimum orbit distance. |
| `camera_min_distance_root` | number | 0.02–1 | `0.15` | Minimum orbit distance while inspecting the root layer (Root Sight on, or camera/target below the surface). |
| `camera_max_distance` | number | 50–5000 | `500` | Maximum orbit distance. |
| `camera_max_polar_angle` | number | 0–3.14 | `3.1` | Max polar angle in radians (~177 degrees, allows looking straight down). |
| `camera_start_distance` | number | 1–100 | `6` | Initial and recenter orbit distance from the player plant. Close enough to read a seedling. |
| `camera_pan_speed` | number | 0.5–100 | `8` | WASD/arrow camera pan speed in world units per second. |
| `camera_zoom_speed` | number | 0.5–10 | `2` | Keyboard zoom rate multiplier for - and + keys (logarithmic, applied per second). |
| `camera_collision_enabled` | boolean | — | `true` | Pull the camera in when the line of sight from its target would pass through a solid physics collider (terrain). |
| `camera_collision_margin` | number | 0.05–2 | `0.3` | Gap kept between the camera and whatever solid object it is pushed away from. |
| `idle_drop_timeout_ms` | integer | 0–120000 | `30000` | Ms of no input before the render loop throttles to 10 fps. |
| `shadow_map_size` | integer | 512–4096 | `1024` | Directional light shadow map dimension. |
| `quality_tiers` | schema_array | — | see file |  |
| `debug_overlay_enabled` | boolean | — | `true` | Toggle the C01 debug overlay (fps, triangles, draw calls, memory, network). |
| `debug_overlay_key` | string | — | ``` | Keyboard code that toggles the debug overlay. |
| `pause_on_hidden` | boolean | — | `true` | Pause the render loop and stop sending INPUT when the tab is hidden. |
| `sky_zenith_day` | color | — | `#4A7A96` | Sky zenith color during clear day. |
| `sky_horizon_day` | color | — | `#C8D6D4` | Sky horizon color during clear day. |
| `sky_zenith_dusk` | color | — | `#2A2038` | Sky zenith color during dawn/dusk transitions. |
| `sky_horizon_dusk` | color | — | `#D4553A` | Sky horizon color during dawn/dusk transitions. |
| `sky_zenith_night` | color | — | `#0B0E14` | Sky zenith color during night. |
| `sky_horizon_night` | color | — | `#1B202A` | Sky horizon color during night. |
| `sky_zenith_rain` | color | — | `#2E3A44` | Sky zenith color during rain. |
| `sky_horizon_rain` | color | — | `#5A6E7C` | Sky horizon color during rain. |
| `sky_zenith_storm` | color | — | `#181C22` | Sky zenith color during thunderstorm. |
| `sky_horizon_storm` | color | — | `#2C333D` | Sky horizon color during thunderstorm. |
| `sky_zenith_telegraph` | color | — | `#242820` | Sky zenith color during storm telegraph phase. |
| `sky_horizon_telegraph` | color | — | `#454A36` | Sky horizon color during storm telegraph phase. |
| `sun_color_day` | color | — | `#FFFFEE` | Directional sun color during clear day. |
| `sun_color_dusk` | color | — | `#FFA066` | Directional sun color during dusk/dawn. |
| `sun_color_night` | color | — | `#7088A8` | Directional celestial light color during night (moonlight). |
| `sun_intensity_day` | number | 0.1–3 | `1.4` | Direct solar light intensity at peak noon. |
| `sun_intensity_night` | number | 0.01–0.8 | `0.15` | Direct celestial light intensity at midnight. |
| `ambient_intensity_day` | number | 0.05–1.5 | `0.6` | Ambient light intensity during day. |
| `ambient_intensity_night` | number | 0.01–0.8 | `0.15` | Ambient light intensity during night. |
| `fog_near_clear` | number | 10–200 | `70` | Fog near distance during clear weather. |
| `fog_far_clear` | number | 100–800 | `320` | Fog far distance during clear weather. |
| `fog_near_rain` | number | 5–100 | `25` | Fog near distance during rain. |
| `fog_far_rain` | number | 50–400 | `160` | Fog far distance during rain. |
| `fog_near_storm` | number | 2–50 | `15` | Fog near distance during active storm. |
| `fog_far_storm` | number | 30–300 | `100` | Fog far distance during active storm. |
| `rain_particle_count` | integer | 0–5000 | `1500` | Number of precipitation particles simulated in camera volume. |
| `rain_particle_speed` | number | 5–60 | `28` | Vertical descent speed of rain particles in m/s. |
| `rain_box_width` | number | 20–200 | `60` | Horizontal dimensions of rain bounding volume centered on camera. |
| `rain_box_height` | number | 10–100 | `35` | Vertical dimension of rain bounding volume. |
| `rain_particle_size` | number | 0.05–1.5 | `0.25` | Rendered size of rain streaks. |
| `rain_streak_length` | number | 5–100 | `25` | Length of rain streaks in world units. |
| `rain_streak_width` | number | 0.005–0.1 | `0.02` | Width of rain streaks in world units. |
| `rain_max_velocity` | number | 10–100 | `35` | Maximum rain particle velocity for streak scaling. |
| `lightning_flash_duration_ms` | integer | 20–500 | `120` | Duration of an atmospheric lightning flash in milliseconds. |
| `lightning_intensity_boost` | number | 1–10 | `4` | Peak light intensity multiplier during lightning flash. |
| `lightning_min_interval_s` | number | 1–30 | `3.5` | Minimum delay in seconds between lightning strikes during thunderstorm. |
| `lightning_max_interval_s` | number | 3–60 | `9` | Maximum delay in seconds between lightning strikes during thunderstorm. |
| `soil_dry_color` | color | — | `#4A4536` | Terrain soil tint when moisture is low. |
| `soil_wet_color` | color | — | `#1B2014` | Terrain soil tint when moisture is high or after rain. |
| `soil_mineral_tint` | color | — | `#5A8FA8` | Subtle mineral accent tone on ground terrain. |
| `terrain_mesh_subdivisions` | integer | 8–128 | `48` | Subdivision radial segments of the terrain ground mesh. |
| `terrain_radius` | number | 50–800 | `300` | World radius of the ground terrain mesh. |
| `root_aura_radius` | number | 0.5–20 | `6` | 3D proximity aura radius around root nodes for subterranean sight cutaway. |
| `webgpu_enabled` | boolean | — | `true` | Enable WebGPU renderer with compute-driven architecture. Falls back to WebGL2 if unavailable. |
| `webgpu_max_plants` | integer | 1000–20000 | `10000` | Maximum plants supported by WebGPU compute-driven renderer. |
| `webgpu_tier0_threshold` | integer | 100–500 | `300` | Projected pixel size threshold for Tier 0 (full mesh). |
| `webgpu_tier1_threshold` | integer | 40–150 | `80` | Projected pixel size threshold for Tier 1 (mid mesh). |
| `webgpu_tier2_threshold` | integer | 6–100 | `50` | Projected pixel size threshold for Tier 2 (multi-view impostor). |
| `webgpu_tier3_threshold` | integer | 1–8 | `2` | Projected pixel size threshold for Tier 3 (single-view billboard). |
| `webgpu_hysteresis_promote` | number | 1–1.5 | `1.15` | Hysteresis multiplier for tier promotion. |
| `webgpu_hysteresis_demote` | number | 0.5–1 | `0.85` | Hysteresis multiplier for tier demotion. |
| `webgpu_min_dwell_time` | number | 0.1–2 | `0.5` | Minimum dwell time in seconds before tier change. |
| `node_pick_radius` | number | 0.1–2 | `0.35` | Minimum world-space pick radius for node selection during growth. |

### `config/growth.json` — T01, active

38 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `root_growth_speed` | number | 0.1–10 | `0.85` | Root layer growth speed in units per second |
| `canopy_growth_speed` | number | 0.1–10 | `0.95` | Canopy layer growth speed in units per second |
| `node_cost_base` | integer | 1–100 | `20` | Base biomass cost per node |
| `max_nodes_per_plant` | integer | 200–200000 | `2000` | Server-safety ceiling for max nodes per plant |
| `growth_cooldown` | number | 0–1 | `0.5` | Cooldown between growth attempts in seconds |
| `cotyledon_shed_leaf_count` | integer | 1–12 | `4` | True leaves a plant needs before its cotyledons are shed |
| `light_blocking_per_node` | integer | 1–25 | `5` | Light reduction per canopy node on tiles below |
| `seed_node` | object | — | see file | Seed node type definition (dormant, 0 upkeep, germinates into radicle + cotyledons). The seed's biomass IS the plant's starting biomass — it is redistributed during germination. |
| `radicle_node` | object | — | see file | Radicle (primary root tip) - first root to emerge, grows downward rapidly using seed reserves. |
| `root_node` | object | — | see file | Root node type definition. Thick taproot — high structural investment for anchoring and water/nutrient absorption. Minerals used for lignin/cellulose cell walls. |
| `lateral_root_node` | object | — | see file | Lateral root node definition. Branches from primary root pericycle — finer, higher absorption surface. |
| `stem_node` | object | — | see file | Stem node type definition. Woody structural element — moderate investment, high integrity. High minerals for lignin. |
| `branch_node` | object | — | see file | Branch node type definition. Lateral branch from axillary bud — slightly cheaper than main stem. |
| `leaf_node` | object | — | see file | Leaf node type definition. Thin photosynthetic organ — cheap to produce, high ROI. Only leaf nodes photosynthesize. Low minerals for leaf structure. |
| `cotyledon_node` | object | — | see file | Cotyledon (seed leaf) node definition. First photosynthetic organs — slightly less efficient than true leaves, temporary. Shed when plant has 4+ true leaves. |
| `flower_node` | object | — | see file | Flower node type definition. Complex reproductive structure — most expensive non-root node, high upkeep. Produces heirloom seeds. |
| `spore_sac_node` | object | — | see file | Spore sac node type definition. Reproductive structure — moderate investment, produces spores for dispersal. |
| `vine_node` | object | — | see file | Vine node type definition. Thin climbing stem — cheaper than woody stem, high horizontal spread. |
| `growth_intent_cooldown` | number | 0.05–1 | `0.2` | Client growth intent rate limit in seconds |
| `germination_min_moisture` | number | 0–100 | `30` | Hard success threshold: local tile moisture (0-100) must be at least this value for the seed to sprout. A player may still attempt below it; the seed dies instead (ADR-026). |
| `germination_min_light` | number | 0–100 | `10` | Hard success threshold: local light (0-100) must be at least this value for the seed to sprout. A player may still attempt below it; the seed dies instead (ADR-026). |
| `germination_failure_kills_seed` | boolean | — | `true` | When true, a germination attempt below the moisture/light thresholds destroys the seed/plant. Lets a player deliberately kill a seed (ADR-026). |
| `photosynthesis_energy_per_second` | number | 0.1–100 | `10` | Base energy production per leaf per second at max light/moisture/minerals |
| `energy_upkeep_per_biomass` | number | 0.001–0.1 | `0.04` | Energy upkeep cost per unit biomass per second |
| `energy_capacity_per_biomass` | number | 1–5000 | `20` | Energy the plant can store per unit of its own total biomass. Storage is a property of the plant, not a global cap. |
| `energy_capacity_floor` | number | 10–10000 | `120` | Minimum energy capacity, so a seed can still sprout. |
| `water_capacity_per_root_biomass` | number | 1–5000 | `8` | Water the roots can store per unit of root biomass. |
| `water_capacity_floor` | number | 5–5000 | `40` | Minimum water capacity of a plant. |
| `mineral_capacity_per_root_biomass` | number | 1–5000 | `8` | Minerals the roots can store per unit of root biomass. |
| `mineral_capacity_floor` | number | 5–5000 | `40` | Minimum mineral capacity of a plant. |
| `initial_energy_fraction` | number | 0.05–1 | `0.5` | Fraction of energy capacity a new seed starts with. |
| `growth_water_consumption_rate` | number | 0.1–50 | `0.15` | Water consumed per second of growth time per unit biomass cost |
| `growth_nutrient_consumption_rate` | number | 0.1–50 | `0.1` | Nutrients (N/P/K) consumed per second of growth time per unit biomass cost |
| `growth_mineral_consumption_rate` | number | 0.1–50 | `0.1` | Minerals consumed per second of growth time per unit biomass cost. Minerals = structural building blocks (calcium for cell walls, magnesium for chlorophyll, silica for rigidity, trace elements for enzymes). |
| `growth_min_water` | number | 0–100 | `12` | Minimum tile water level (0-100) for growth to proceed. Below this, growth pauses. |
| `growth_min_nutrients` | number | 0–100 | `15` | Minimum tile nutrient level (0-100) for growth to proceed. Below this, growth pauses. |
| `growth_min_minerals` | number | 0–100 | `6` | Minimum tile mineral level (0-100) for growth to proceed. Below this, growth pauses. |

### `config/items.json` — T08A, active

7 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `item_definitions` | schema_array | — | see file | Starting item definitions. All account_bound items have tradeable/mailable/listable = false per RULE_23. |
| `starting_inventory` | schema_array | — | see file | Items given to new players on first spawn. |
| `inventory_slots` | integer | 5–50 | `10` | Number of inventory slots per player. |
| `fertilizer_minerals_gain` | number | 1–1000 | `50` | Minerals added to the plant when a fertilizer item is used (clamped to capacity). |
| `dung_water_gain` | number | 1–1000 | `30` | Water added to the plant when a dung item is used (clamped to capacity). |
| `dung_minerals_gain` | number | 1–1000 | `20` | Minerals added to the plant when a dung item is used (clamped to capacity). |
| `essence_energy_gain` | number | 1–10000 | `500` | Energy restored when an essence item is used (clamped to capacity). |

### `config/dev.json` — D01, active

16 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `dev_panel_enabled` | boolean | — | `true` | Master switch for dev panel. When false, panel cannot be opened even with ?dev=1 |
| `persistence_enabled` | boolean | — | `false` | When true, plants persist across disconnects within the reconnect window. When false (default), plants are session-only and removed immediately on disconnect. |
| `plant_save_interval_s` | number | 5–3600 | `30` | Seconds between periodic plant snapshot writes |
| `reconnect_window_seconds` | integer | 30–86400 | `300` | How long a plant waits for its owner to reconnect before being removed (persistence must be enabled). |
| `germination_gate` | boolean | — | `true` | When true, germination requires moisture and light thresholds. When false, germination always succeeds. |
| `germination_failure_kills_seed` | boolean | — | `true` | When true, failing germination destroys the seed/plant. When false, it just pauses growth. |
| `seed_size_class` | enum | `normal`, `large`, `giant` | `normal` | Scales the initial plant model and camera framing. Normal = standard, Large = 2x, Giant = 4x. |
| `camera_start_distance` | number | 5–200 | `26` | Initial camera distance from plant root on spawn. |
| `camera_recenter_distance` | number | 5–200 | `18` | Camera distance when Space is pressed to recenter on plant. |
| `camera_pan_speed` | number | 0.5–50 | `5` | Camera pan speed in units per second for WASD/arrow keys. |
| `resource_rates` | object | — | see file | Runtime-adjustable resource and growth rates |
| `webgpu_enabled` | boolean | — | `true` | Enable WebGPU render path when available |
| `webgpu_tier0_threshold` | integer | 100–500 | `300` | Projected pixel size for tier 0 (full mesh) |
| `webgpu_tier1_threshold` | integer | 40–150 | `80` | Projected pixel size for tier 1 (mid mesh) |
| `webgpu_tier2_threshold` | integer | 6–30 | `12` | Projected pixel size for tier 2 (billboard) |
| `webgpu_tier3_threshold` | integer | 1–8 | `2` | Projected pixel size for tier 3 (billboard); below uses tier 4 |

### `config/controls.json` — C01, active

7 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `bindings_desktop` | schema_array | — | see file |  |
| `bindings_touch` | schema_array | — | see file |  |
| `touch_min_target_px` | number | 40–64 | `44` | Minimum touch target size in CSS pixels. |
| `hud_max_screen_fraction` | number | 0.1–0.4 | `0.2` | Maximum fraction of screen the HUD may cover. |
| `root_sight_mode` | enum | `toggle`, `hold` | `toggle` | Root Sight interaction mode. |
| `text_scale` | number | 0.8–1.5 | `1` | Global UI text scale (80-150%). |
| `context_dock_fade_ms` | integer | 0–500 | `150` | Fade duration for context-dock actions appearing/disappearing. |

### `config/ui.json` — C01, active

11 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `text_scale` | number | 0.8–1.5 | `1` | Global UI text scale applied as a CSS variable. |
| `layers` | object | — | see file | Z-index stack for DOM overlay layers. Higher layers always win. |
| `theme` | object | — | see file | Design tokens. Plain colors only - no rarity tiers (RULE_20). |
| `toast_duration_ms` | integer | 1000–15000 | `4000` | Default time a toast notification stays visible. |
| `toast_max_stack` | integer | 1–20 | `5` | Maximum toasts stacked before older ones are dropped. |
| `hint_card_duration_ms` | integer | 2000–60000 | `10000` | First-spawn hint card display time. |
| `hint_card_max_lines` | integer | 1–6 | `3` | Maximum hint card lines (RULE_13). |
| `panel_default_width_px` | integer | 200–640 | `320` | Default width for collapsible side panels. |
| `panel_animation_ms` | integer | 0–600 | `200` | Panel open/close animation duration. |
| `reduced_motion` | boolean | — | `false` | Respect OS reduced-motion: kills camera shake, particles and sway. |
| `safe_area_padding_px` | integer | 0–32 | `8` | HUD padding from the device safe-area edge. |

### `config/chat.json` — T05, active

4 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `proximity_range_px` | number | 5–500 | `150` | Proximity chat range in world units; players outside range don't receive the message. |
| `world_rate_msg_per_min` | integer | 1–60 | `12` | World chat rate limit per player in messages per minute. |
| `log_size` | integer | 100–10000 | `200` | Maximum number of chat log entries kept per session before dropping oldest. |
| `message_max_chars` | integer | 40–2000 | `500` | Longest chat message the server accepts from one player, in characters. |

### `config/emotes.json` — T05, active

2 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `emote_definitions` | schema_array | — | see file |  |
| `emote_range_px` | number | 5–200 | `100` | Default emote broadcast range in world units when per-emote range is not set. |

### `config/reports.json` — T05, active

4 values.

| Key | Type | Range / members | Default | Effect |
|---|---|---|---|---|
| `report_reasons` | schema_array | — | see file |  |
| `context_line_count` | integer | 5–100 | `20` | Number of surrounding chat lines captured in a report context snapshot. |
| `report_free_text_max` | integer | 50–2000 | `500` | Maximum length of the free-text additional-info field in a report. |
| `reports_in_memory_max` | integer | 10–5000 | `200` | Newest reports kept in memory for moderation review |
| `report_rate_limit_per_min` | integer | 1–30 | `5` | Maximum reports a single player can file per minute to prevent report spam. |

## All config files

`values` counts entries currently declared. `0` means a deliberate T00 stub; the
owning task fills it.

| File | Owner | Status | Values |
|---|---|---|---|
| `account_progress` | T08B | stub | 0 |
| `accounts` | T08C | active | 27 |
| `achievements` | T08B | stub | 0 |
| `annotations` | T19 | stub | 0 |
| `anticheat` | T41 | stub | 0 |
| `archetypes` | T12 | stub | 0 |
| `audio` | C06 | stub | 0 |
| `boosters` | T13A | stub | 0 |
| `campaign` | T32 | stub | 0 |
| `chat` | T05 | active | 4 |
| `climate_memory` | T39 | stub | 0 |
| `clips` | T35 | stub | 0 |
| `companions` | T11 | stub | 0 |
| `compliance` | T00 | draft | 3 |
| `controls` | C01 | active | 7 |
| `damage` | T06 | stub | 0 |
| `daynight` | T07 | active | 4 |
| `deep_time` | T20 | stub | 0 |
| `dev` | D01 | active | 16 |
| `emotes` | T05 | active | 2 |
| `epoch_map` | T37 | stub | 0 |
| `extraction` | T51 | stub | 0 |
| `fragments` | T51 | stub | 0 |
| `genes` | T15 | stub | 0 |
| `gift_bundles` | T45 | stub | 0 |
| `gift_packs` | T50 | stub | 0 |
| `gifts` | T29 | stub | 0 |
| `growth` | T01 | active | 38 |
| `growth_scale` | T23 | stub | 0 |
| `guilds` | T44 | stub | 0 |
| `heirlooms` | T06A | stub | 0 |
| `inventory` | T08A | stub | 0 |
| `item_flags` | T08A | stub | 0 |
| `items` | T08A | active | 7 |
| `leaderboards` | T38 | stub | 0 |
| `ledger` | T16 | stub | 0 |
| `liveops` | T42 | stub | 0 |
| `mail` | T45 | stub | 0 |
| `marketplace` | T14 | stub | 0 |
| `messaging` | T27 | stub | 0 |
| `minimap` | T48 | stub | 0 |
| `mutations` | T04 | stub | 0 |
| `naming` | T17 | stub | 0 |
| `net_proto` | T03P | draft | 12 |
| `network` | T03 | active | 10 |
| `observation` | T28 | stub | 0 |
| `onboarding` | T00A | active | 3 |
| `ops` | O01 | active | 13 |
| `paid_spawn` | T21 | stub | 0 |
| `parasitism` | T10 | stub | 0 |
| `persistence` | T26 | stub | 0 |
| `plant_renderer` | C02 | active | 26 |
| `prestige` | T08B | stub | 0 |
| `profiles` | T47 | stub | 0 |
| `relics` | T18 | stub | 0 |
| `render` | C01 | active | 73 |
| `reports` | T05 | active | 4 |
| `reproduction` | T53 | stub | 0 |
| `reputation` | T43 | stub | 0 |
| `resources` | T00A | draft | 40 |
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
| `weather` | T07 | active | 19 |
| `world` | T03 | active | 18 |


Total: **77 files**; 21 populated and 56 stubs.
Populated: `accounts`, `chat`, `compliance`, `controls`, `daynight`, `dev`, `emotes`, `growth`, `items`, `net_proto`, `network`, `onboarding`, `ops`, `plant_renderer`, `render`, `reports`, `resources`, `root_sight`, `ui`, `weather`, `world`.

## Approved V5.4 config files (not created yet)

These are specified in `DESIGN.md` Part 11 and indexed in
[`v5.4-extension-plan.md`](./v5.4-extension-plan.md). They are **not** in
`config/` yet, so the validator count stays at 77.

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
