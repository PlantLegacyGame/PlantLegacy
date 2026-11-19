# CONTEXT

Current context for any human or AI session working in this repository. Keep it
current at the end of every task (DESIGN.md, Session Protocol). `DESIGN.md` wins
over this file whenever they disagree.

**Phase:** 1 — The Living Sprout (in progress). **Implemented:** T00, O01, T03P, C01, **T00A** (resource model + onboarding), T01 (growth simulation), **T03** (persistence, offline tiers, interest management, event bus), **T08C** (accounts + sessions), **C02** (Raymarched SDF procedural organism renderer with `smin` organic fusion, Murray's law allometric tapering, thin-lamina foliage, and 0.9s real-time emergence animation), **T02** (Root Sight unified organism integration), **T25** (shared terrain field, two-patch LOD ground with exact trimesh colliders, bounded Rapier plant colliders, one cavity field for Root Sight, sparse persistent soil edits with root tunnels, collapse and growth resistance; client height-texture application still pending), **T07** (Weather state machine, day/night cycle, forecast broadcast, ResourceWorld integration), **C03** (Environment rendering: sky dome gradient, sun/moon arcs, atmospheric fog, rain particle system, storm lightning flashes, soil moisture tinting, Root Sight cutaway refinement), **C02b slice** (WebGPU v1 compute-driven plant renderer: transparent overlay canvas, merged mesh tiers 0/1, billboard tiers 2–4, per-plant culling/LOD with hysteresis, Root Sight highlight, WebGL2 fallback; impostor baking, GPU skinning and texture arrays are in as well, and shared depth is the one open item), **D01** (dev settings engine: `?dev=1` gate, server `/dev/config` endpoints, `config/dev.json`, DevPanel wired to server, persistence switch wired to disconnect logic, key binding added). **Added:** config/resources.json, config/world.json, config/network.json, config/accounts.json, config/plant_renderer.json, config/root_sight.json, config/weather.json, config/daynight.json, config/render.json (expanded), config/dev.json, server resource model, PlantPersistence (versioned binary snapshot + event log with CRC32), PlantWorld tiers, InterestManager, EventBus, AccountsService (Argon2id, JWT rotation, atomic rate limits, lockout), WeatherSystem, EnvironmentRenderer, WebGPU renderer (`apps/client/src/renderers/webgpu/`), seeded RNG (`hash32`, `hash01`, `mulberry32`). **Approved 2026-11-09 (not built): v5.4 extension program** — T54 reactive non-sapient fauna, T55 material simulation, T56 volumetric terrain, C10 terrain/material rendering, T57 parametric terrain features, T58 world-object streaming and behaviour, T59 ecological succession, C11 fauna rendering, O04 cloud-native World orchestration. Rule amendments (RULE_2, RULE_8, RULE_19, RULE_22) and task specs are in `DESIGN.md` Part 11 and Part 16; there is no separate programme document, so the backlog is [`docs/tasks/README.md`](./docs/tasks/README.md). **C04 HUD slice (2026-11-15):** plant-status panel with health words (Healthy/Stressed/Withering/Dying), biomass rate, health against the uproot ceiling, mutation bill and `Day N · clock` weather forecast; damage vignette and toast; reroot countdown plus camera-relative D-pad and movement-key steering. `I` opens Inspect (left) and Inventory (right) with per-node health; the mutation list moved into Inspect. HUD also shows energy, water, minerals against capacity, node count, and split mutation energy/biomass upkeep; Inspect adds mutation kind, per-mutation share bars, totals and growth-pressure bars. Settings sheet has Settings/Controls tabs; the plant-lost screen repeats the detailed stats and clears the toast stack. Growth now starts parts at their minimum radius and thickens them with biomass; damage/drought recomputes radius, canopy is shed before roots, and unhealed stem damage decays after a configurable delay. Server sends `structure` in STATE/KEYFRAME and PLANT_DAMAGE, and `dayNumber` in WEATHER_UPDATE. **2026-11-16 batch:** mutation upkeep is a stall that never sheds or kills and never removes a mutation (only `MUTATION_SHED` does); a size mutation holds real tissue — `quota × scale³` mass, radius from biomass, passive wilt when oversized (ADR-057); mutations have levels with body-scaled costs and universal cards (ADR-058); appearance is `config/mutation_visuals.json` composed per organ family, one style per mutation, clamped in `caps`, with shape mutations biasing growth and `spined_epidermis` drawing real thorn geometry (ADR-059, C1–C9); the dev mutation gallery grants each mutation first and grows a mature 20–34 node body. The player's body has one anchor — `rootNodeId`, else a seed, else the last streamed crown — used by recentre and Root Sight, and the soil aperture is cut on both faces so the cavity works from inside the ground (ADR-060, G1–G4, A10). Root Sight opens itself when a buried part starts growing and the cavity opens on the first frame of growth (A7/A11, `player/rootSightAutoOpen.ts`, INV-RS-03). The growth card quotes the price the charge takes: one `growthChargeScale` (soil resistance × mutation cost/speed) feeds both the menu and `tryGrow`, energy rounded up (E9, ADR-061, INV-GR-13). Every child tube starts at the server's shipped `parentAttach*`, so branches sit on their parent instead of hanging below it (E10). Water is a medium as well as a surface: `renderers/environment/underwater.ts` derives depth/transmission/tint from the water field's own surfaces and `EnvironmentRenderer` applies shortened tinted fog, a dimmed sun, and a water shader that shades its underside as Snell's window (W1, ADR-062); the three water colours are config entries (W3). Config routes that served a subset of their file now serve the file (root_sight 7→17, ui 11→16, plant_renderer merges its 37 entries). **Second 2026-11-16 batch:** water sheets end radially (`sheet_edge_fade`) so a high camera cannot see the grid as a square of water (W4). Root Sight visibility follows the opening in volume: a root is drawn when it is inside the aperture cylinder, a buried eye skips the surface test (`cameraUnderSoil`) and gets an air window fused into the cavity envelope (`root_sight.eye_window_radius_m`), and the soil shader cuts that envelope while the eye is under the soil (A13, INV-RS-14/15, ADR-064). The growth gizmo anchors on the drawn part (`resolveDrawnNodePosition`), clamps a stale attach point to its own part, and reads as 3D (taper, landing ring, ground marker) (E12). `PLANT_CREATED` now mirrors WELCOME and every node payload carries `attachFraction`, so rival plants and the mutation gallery are drawn with the server's own joints, and each gallery body grows from a per-mutation seed with 4–8 internodes for a range of shapes (C10). A stem can grow a stem — an internode stack — so a plant without a trunk can finally get tall (E11, INV-GR-19). Rerooting no longer re-bases node `y` onto the landing terrain height, which had lifted a crawling plant into the sky (G5, INV-GR-18), and Space frames the whole grown body instead of the start distance (G6). **Last updated:** 2026-11-16.

**Also implemented since the list above:** **T05** (proximity/world chat, data-driven
emotes, block and report), **C03b** (inner detail + 620 m outer ground patch
from one shared field, exact trimesh colliders) and **T04** (data-driven
mutations, adaptive pressure, maintenance/shedding, PLNT v2 snapshots, protocol
v2 `MUTATION_STATE`/`MUTATION_SHED`, twelve visual signatures). **T06** damage, uproot and tumbling is implemented: one four-source damage pipeline (weather, tool, scripted herbivore swarm, terrain collapse/landing), uproot from sustained saturation, a height-scaled storm gust, a collapse or accumulated structural damage, a steered reroot crawl with a starvation failure, deterministic tumbling, kill credit, fragment/remains/dung world drops, protocol 37–43 and PLNT v3 snapshots (ADR-055, ADR-056). The in-browser checklist is outstanding and drop pickup belongs to T51/T08A — see `docs/tasks/T06.md`. **T08A** inventory
is partial and non-compliant — in-memory only; see `docs/tasks/T08A.md`.

**P0 (2026-11-15).** Measurement and budget foundations, records in
`docs/tasks/AL-01.md` and `AL-03.md`. Client gains
`src/dev/benchmark.ts` (six configurable poses, p50/p95/p99/max, CPU and real
GPU time), `src/render/GpuTimer.ts` (`EXT_disjoint_timer_query_webgl2`, null
timer when absent) and `src/render/PlantInterpolation.ts` (one-tick interpolation
for streamed node positions). `QualityController` is a measured-cost band now:
resolution, then draw distance (via `WebGPURenderer.setLodThresholdScale`), then
tier, with `gpu_band_min_ms` / `gpu_band_max_ms` / `quality_hold_ms` /
`draw_distance_floor` in `config/render.json`. `render.json` also carries
`size_classes` (`normal` / `large` / `giant`) so framing and detail scale with
the organism (ADR-027); `camera_max_distance` is 2000 m, `webgpu_max_plants`
20000. `world.json` raises `per_client_entity_cap` to 1000 and
`detailed_plant_budget` to 256. The server serves `/config/dev` (size class and
benchmark poses) through its generic `/config/<system>` route.

**Bug-fix session (2026-11-15).** A headless player bot now exists at
`tools/sim-bots/` (zero dependencies; Node's global `WebSocket`) and drives the
real protocol: it germinates, grows in a plant's proper order, backs off from
refusals and reports findings. Its first run reproduced the growth-damage bug:
a root tunnel collapsed two seconds after the radicle grew and the collapse was
billed to the plant that dug it, destroying the radicle and re-offering it. The
void and its collapse edit now carry `actorPlantId` and `applyCollapse` skips
that plant (ADR-051). Two tests cover both sides. Chat's Send and X buttons were
dead because `createChatUI` appended the panel to the `hud` layer (CSS
`pointer-events: none`) without opting in; the panel now opts in and its input
row is fixed so the button cannot clip. `MESSAGE_TYPE` moved into
`@plant-legacy/shared/protocol` so the client and server cannot drift again. The current defect list, with evidence and status per item, is
[`docs/bug-inventory.md`](./docs/bug-inventory.md).

**Gate and underground pass (2026-11-16).** The gate is green and it now fails
honestly: `pnpm lint` passes, and `pnpm docs:check` treats a quoted config
default that disagrees with `config/` as an error rather than printing it and
exiting 0. The 24 wrong defaults in five task records were corrected against
`config/` (record: [`docs/tasks/DOC-01.md`](./docs/tasks/DOC-01.md)). Underground
detection no longer assumes the soil is Y=0: `apps/client/src/player/underground.ts`
(`groundWorldY`, `isBelowSoil`) compares against `planetTerrainY` plus the terrain
skin, and the five `main.ts` sites that tested `y < 0` (camera floor, spring-arm
skip, both root-pick paths, the `setUndergroundView` gate) now use it, so an eye
under a hill is underground whatever its world Y. Root Sight's cutaway uniforms
start closed and take `cutaway_radius`, `soil_opacity` and the new
`aperture_radius_ratio` / `aperture_min_m` from `config/root_sight.json` the
moment it loads, instead of the old 50 m / 0.3 literal, so the first drawn frame
matches the file. Tests: `player/underground.test.ts`,
`renderers/environment/rootSightUniforms.test.ts`. Order, evidence and what is
still open: [`docs/bugfix-plan.md`](./docs/bugfix-plan.md).

## 1. Stack

| Thing | Version / choice | Why |
|---|---|---|
| Node | 24.19.0 locally; `engines: >=22.18` | Native TypeScript type stripping; no build step for server/shared |
| Package manager | pnpm 10.18.0 (Corepack-compatible) | Workspace protocol, strict node_modules |
| Language | TypeScript 5.9.3, `strict: true` | Design requirement |
| Lint + format | Biome 2.6.4 | One dependency, one config |
| Tests | `node --test` (built in) | No test framework dependency |
| Server HTTP | `node:http` (built in) | No framework until a task needs one |
| Database | PostgreSQL 17 (`postgres:17-alpine`), `pg` 8 | Single Postgres, no Redis/queue (RULE_31) |
| Client | Vite 8 + Three.js r187 + `@vitejs/plugin-legacy` | C01 foundation; one dev server and one production build |
| Realtime | `ws` (WebSocket) + JSON | T03P protocol; browser-compatible, works through the tunnel |
| CI | GitHub Actions | Verify on push/PR; Pages deploy on `main` |
| Container | `node:24-alpine` | Runs TS directly |

The **client** is bundled by Vite. The **server, shared package and tools** run
TypeScript directly on Node with no bundler. There is still **no ORM, no game
engine**; the growth simulation is server-authoritative (T01) and the renderer
draws server plant data. Do not add a new framework without a task that
requires it.

## 2. Commands

```sh
pnpm dev              # one command: install if needed, server + Vite dev server
pnpm dev:server       # server only, watch mode
pnpm dev:client       # Vite dev server only
pnpm verify           # lint + typecheck + config:validate + docs:check + test
pnpm lint             # biome check .
pnpm typecheck        # tsc -p in every package
pnpm config:validate  # schema + rarity ban over config/*.json
pnpm docs:check       # links, config counts, protocol table, duplicate prose
pnpm test             # node --test in packages/shared and apps/server
pnpm build            # Vite production build -> apps/client/dist
pnpm start            # server only
```

CI runs the same chain in `.github/workflows/ci.yml`. `pnpm-lock.yaml` is
committed; CI installs with `--frozen-lockfile`.

## 3. Repository tree

```
.
├── .github/workflows/
│   ├── ci.yml                 # lint, typecheck, config validator, tests, build
│   └── deploy-staging.yml     # static client -> GitHub Pages on main
├── apps/
│   ├── client/
│   │   ├── index.html         # Vite entry; meta[name=server-origin]
│   │   ├── vite.config.ts     # dev proxy + GitHub Pages base path
│   │   ├── scripts/           # legacy preview helpers (unused by `pnpm dev`)
│   │   ├── src/main.ts        # Three.js scene, WebSocket client, input, hint card
│   │   ├── src/config/clientConfig.ts    # C01 config loaders
│   │   ├── src/config/plantRendererConfig.ts
│   │   ├── src/config/waterConfig.ts     # T31 water tuning + the three water colours
│   │   ├── src/config/mutationVisuals.ts # T04 mutation style table (ADR-059)
│   │   ├── src/player/                   # own-body anchor (ADR-060), root-sight auto-open
│   │   ├── src/renderers/environment/underwater.ts  # being in water: depth, fog, sun, Snell window
│   │   ├── src/ui/DevPanel.ts            # D01 dev settings panel
│   │   ├── src/render/QualityController.ts  # C01 dynamic resolution
│   │   ├── src/renderers/PlantRenderer.ts  # C02 Raymarched SDF plant renderer (GL state, uniforms)
│   │   ├── src/renderers/plant/          # C02 node visuals, GPU packing, GLSL
│   │   ├── src/renderers/EnvironmentRenderer.ts  # C03 update order + public API
│   │   ├── src/renderers/environment/    # C03 sky, rain, ground, resource grid, celestial, weather presets
│   │   ├── src/renderers/rootSight/      # T02 cutaway uniforms and sizing
│   │   ├── src/renderers/webgpu/         # C02b WebGPU compute LOD + mesh/billboard passes
│   │   │   ├── WebGPURenderer.ts
│   │   │   ├── WebGPUDevice.ts
│   │   │   ├── PlantMeshBuilder.ts
│   │   │   └── shaders/*.wgsl
│   │   ├── src/ui/UIShell.ts             # C01 DOM overlay layers, toasts
│   │   ├── src/ui/DebugOverlay.ts        # C01 live metrics overlay
│   │   ├── src/styles.css
│   │   └── tsconfig.json
│   └── server/
│       ├── Dockerfile
│       ├── src/core/config.ts # config load + env merge
│       ├── src/core/version.ts
│       ├── src/main.ts        # HTTP + WebSocket server, World, /config routes
│       ├── src/ops/db.ts      # Postgres reachability probe + migrations
│       ├── src/ops/health.ts  # pure report + readiness
│       ├── src/ops/net.ts     # protocol types, net_proto config, movement validation
│       ├── src/ops/log.ts     # JSON logger
│       ├── src/ops/eventBus.ts    # T03 in-process pub/sub
│       ├── src/ops/interestManager.ts  # T03 spatial interest management
│       ├── src/ops/world.ts         # T03 world config loader
│       ├── src/ops/persistence/     # T03 binary snapshot + event log
│       │   ├── 001_create_plants_table.sql
│       │   ├── 002_create_accounts_table.sql
│       │   ├── 003_add_refresh_token_lookup_hash.sql
│       │   ├── 004_rate_limits_unique_constraint.sql
│       │   ├── migrate.ts
│       │   └── plantPersistence.ts
│       ├── src/ops/plantWorld.ts    # T01 growth + T03 offline tiers
│       ├── src/ops/growth/          # T01 pure rules (rules.ts) + growth menu (options.ts)
│       ├── src/ops/damage/          # T06 pipeline, config loaders, drops and uproot rules
│       ├── src/ops/accounts/        # T08C accounts + sessions
│       │   ├── config.ts            # config loader
│       │   ├── service.ts           # Argon2id, JWT, rate limits, lockout
│       │   └── http.ts              # /auth/* endpoints
│       └── tsconfig.json
├── packages/input/             # C01 InputBus + action state machine
├── packages/weather/           # T07 weather + day/night state machine
├── packages/shared/
│   └── src/
│       ├── config/{types,validate,loader,index}.ts
│       ├── damage/            # T06 damage, uproot, tumble and kill-credit rules
│       ├── config/validate.test.ts
│       ├── events/index.ts    # GAME_EVENTS vocabulary (Appendix E)
│       ├── growth/           # growth types, gene constraints, geometry, node types
│       ├── ids/index.ts       # prefixed opaque ids
│       ├── math/index.ts      # clamp, lerp, hash32, hash01, mulberry32
│       ├── protocol/index.ts  # PROTOCOL_VERSION, frame header
│       ├── schemas/{item,death-record}.ts
│       └── index.ts
├── tools/
│   ├── config-validator/src/cli.ts
│   ├── dev.mjs                # one-command local stack
│   ├── watch-server.mjs       # content-aware server restart (pnpm dev:server)
│   ├── sim-bots/              # placeholder (T26)
│   ├── load-test/             # placeholder (H01)
│   ├── seed-data/             # placeholder (T03)
│   └── backup/                # placeholder (O02)
├── config/                    # 78 tunable files + _meta (count owned by docs/tunables.md)
├── docs/                      # tunables, protocol, data model, decisions, history, deploy, tasks, checklists
├── ops/
│   ├── compose.yml            # server + postgres:17-alpine
│   ├── docker/README.md
│   ├── deploy/README.md
│   └── backup-scripts/README.md
├── DESIGN.md                  # source of truth (v5.3.1)
├── CONTEXT.md
├── README.md
├── ATTRIBUTION.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── biome.json
├── .env.example
└── .editorconfig / .gitignore / .dockerignore
```

`config/` holds one file per system from DESIGN.md Part 6.2, plus `_meta/`.
`docs/tunables.md` maps every file to its owning task.

## 4. Runtime architecture

```
Browser (Vite + Three.js) ──HTTP /health,/ready,/config/*──▶ Server (node:http + ws) ──select 1──▶ Postgres
        ▲                                                          │
        └──────────── WebSocket /ws (JSON, 20 Hz) ─────────────────┘
```

- **Client:** renders only. It sends input intents and draws server plant state;
  it holds no authority (RULE_4, RULE_27). Three.js scene, OrbitControls,
  `PlantRenderer` (C02 Raymarched SDF), `EnvironmentRenderer` (C03 sky/weather),
  optional `WebGPURenderer` overlay (C02b compute-driven plant LOD with WebGL2
  fallback), **C01 input abstraction, UI shell, quality controller, debug
  overlay**, and the T00A onboarding overlay.
- **Server:** one process, one world, one Postgres (RULE_31). `World` runs a
  20 Hz tick, steps plant growth and resource simulation, and broadcasts `STATE` / `KEYFRAME`.
  Config is loaded and validated before listening. **Serves `/config/render`, `/config/controls`,
  `/config/ui` for C01 client foundation.**
- **Database:** optional locally (`DATABASE_URL` unset → `skipped`), required in
  compose/staging (`READINESS_REQUIRES_DB=true`).
- **Deploy split:** client on GitHub Pages; server + Postgres in Docker compose,
  currently exposed through a Cloudflare quick tunnel rather than a VM. They are
  deployed separately on purpose.

## 5. Interfaces

### 5.1 HTTP

All responses are JSON, `cache-control: no-store`. `OPTIONS` returns 204 for
preflight. Other methods are `405`. Responses carry
`access-control-allow-origin` when the request's `Origin` is listed in
`ops.cors_origins` (or `CORS_ORIGINS`).

| Method | Path | Status | Body |
|---|---|---|---|
| GET | `/health` | 200 always while alive | `HealthReport` |
| GET | `/ready` | 200 ready, 503 not ready | `{ ready, ...HealthReport }` |
| GET | `/` | 200 | `{ name, version, world, note }` |
| GET | `/config/onboarding` | 200 | `{ hint_card_lines, show_hint_card_duration_ms, resource_tooltips }` |
| GET | `/config/plant_renderer` | 200 | flat `plant_renderer` values (`max_nodes_per_plant`, …) |
| GET | `/config/render` | 200 | flat `render` values (quality tiers, camera smoothing, …) |
| GET | `/config/controls` | 200 | flat `controls` values (bindings, text scale, …) |
| GET | `/config/ui` | 200 | flat `ui` values (theme tokens, z-indexes, …) |
| GET | `/config/root_sight` | 200 | flat `root_sight` values (`cutaway_radius`, `soil_opacity`, `auto_open_on_root_growth`, `eye_window_radius_m`, …) |
| GET | `/config/water` | 200 | flat `water` values (sheet depth, absorption, the three water colours, the sheet's radial `sheet_edge_fade`, …) |
| GET | `/config/mutation_visuals` | 200 | flat `mutation_visuals` values (`caps`, `styles`) |
| GET | `/config/daynight` | 200 | flat `daynight` values (`cycle_length_s` = 3600, i.e. a 60-minute day/night) |
| GET | `/config/resources` | 200 | flat `resources` values (`tile_light_base`, `max_light/moisture/minerals`) |
| * | anything else | 404 | `{ error: "not_found" }` |

The `/config/*` routes read the file from `CONFIG_DIR` on each request and fall
back to built-in defaults if the file cannot be read. They exist so the static
client can load T00A/T01 tunables without a bundler rebuild.

The generic route serves **every** `values` entry of the named file, so adding a
tunable needs no route change. Three routes used to send a hand-written subset
instead, and the client silently ran on compiled-in defaults for whatever was
missing: `/config/root_sight` served 7 of 17 entries, `/config/ui` 11 of 16, and
`/config/plant_renderer` asked its file for keys the file does not contain while
dropping the ones the client's parser reads. All three now merge the file's
entries (the explicit fields win where a name is derived, such as `ui.layers`).

Two routes are deliberate projections rather than the whole file:
`/config/growth` (per-type segment lengths/costs/growth times plus the organism
geometry the client draws and aims with) and `/config/controls` (desktop and touch
bindings merged into one `bindings` map).

```ts
interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;            // SERVICE_VERSION
  uptime_s: number;           // floor(seconds since start)
  checks: {
    config: 'ok';
    config_files: number;     // 79, per docs/tunables.md
    database: 'ok' | 'down' | 'skipped';
  };
}
```

`/health` is liveness: a down database reports `degraded` but still 200.
`/ready` is readiness: it is 503 when the deployment requires a database and
that database is not `ok`. When `requiresDb` is false, it is always ready.

### 5.2 Shared package (`@plant-legacy/shared`)

Subpath exports (all source, no build):

| Export | Contents |
|---|---|
| `.` | everything below |
| `./config` | `loadConfigDir`, `readNumber/Boolean/String`, `validateConfig`, `auditTree`, types |
| `./schemas` | `ItemDefinition`, `ItemFlags`, `ITEM_CATEGORIES`, `ITEM_FLAG_KEYS`, flag helpers |
| `./events` | `GAME_EVENTS`, `GameEventName`, `GameEvent` |

Key functions:

```ts
loadConfigDir(dir: string): Promise<ConfigLoadResult>
// { ok: true, files: string[], configs: Map<string, ConfigFile> }
// { ok: false, files: string[], configs: Map<...>, issues: ValidationIssue[] }

validateConfig(file: string, document: unknown): ValidationResult
auditTree(node: unknown, path: string, push: Push): void

readNumber(configs, system, key): number
readBoolean(configs, system, key): boolean
readString(configs, system, key): string
readStringArray(configs, system, key): string[]

newId(kind: 'account'|'world'|'plant'|'item'|'gene'|'seed'|'ledger'|'report'): string
clamp(value, min, max): number
lerp(a, b, t): number
```

`read*` throw on a missing or wrong-typed entry. Callers decide whether that is
fatal. The server treats it as fatal.

### 5.3 Config format (`extended-1`)

```ts
interface ConfigFile {
  _meta: {
    system: string;        // must equal the filename without .json
    version: string;
    schema: 'extended-1';
    owner_task?: string;   // e.g. "T01"
    status?: 'stub' | 'draft' | 'active' | 'deprecated';
    notes?: string;
  };
  values: Record<string, ConfigEntry>;
}
```

Entry types: `number`, `integer`, `boolean`, `string`, `enum`, `array`,
`schema_array`, `matrix`, `color`, `object`. Numeric entries require
`range: [min, max]`; `value` is the default. See
`packages/shared/src/config/types.ts` and `config/_meta/schema.json`.

Validator rules (authoritative code: `packages/shared/src/config/validate.ts`):

1. `_meta.schema` must be `extended-1`; `_meta.system` must match the filename.
2. Numeric `value` must be inside `range`; `range` must be `[min, max]` with
   `min < max`.
3. Enum `value` must be a member.
4. `matrix` dimensions must match `rows` × `cols`.
5. `schema_array` items must match the declared field types.
6. **Any `rarity` key or enum member anywhere is an error (RULE_20).**
7. **`account_bound: true` with any of `tradeable`/`mailable`/`listable` true is
   an error (RULE_23).**

### 5.4 Environment

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `local` | `local` / `staging` / `production`; never inferred from hostname |
| `PORT` | `ops.port` (8080) | Integer 1024–65535 |
| `HOST` | `ops.host` (0.0.0.0) | |
| `LOG_LEVEL` | `ops.log_level` (info) | `debug`/`info`/`warn`/`error` |
| `CORS_ORIGINS` | `ops.cors_origins` | Comma-separated browser origins allowed to call the API |
| `CONFIG_DIR` | auto-discovered upward | Must contain `_meta/schema.json` |
| `DATABASE_URL` | unset | Unset → DB `skipped` |
| `READINESS_REQUIRES_DB` | `ops.readiness_requires_db` (true) | |
| `STAGING_SERVER_ORIGIN` | unset | GitHub repository variable, deploy only |

`NODE_ENV` is validated against `ops.environments` at startup. Secrets are never
committed. `.env.example` contains placeholders only, and the server does not
load a `.env` file (ADR-011). Docker Compose does auto-load `ops/.env` for the
staging stack (ADR-015); that file is gitignored and is not read by the server
process itself.

### 5.5 Database probe

`DatabaseProbe` (`apps/server/src/ops/db.ts`) owns a `pg.Pool`. `ping()` runs
`select 1` and returns `ok` / `down`; no URL returns `skipped`. T03 adds
`world_plants` (binary snapshot + event log) and `world_events` tables with
migrations in `apps/server/src/ops/persistence/001_create_plants_table.sql`.

`PlantEventLog` keeps a bounded per-plant history of growth, damage, uproot,
reroot and tier changes. Each save writes it to `world_plants.event_log`, the
boot path reads it back and seeds the in-memory log, and
`world.event_log_compaction_threshold` drops the oldest entries. Plant deaths are
appended to `world_events` before the per-plant row is deleted, so the audit trail
covers the plant's whole life.

### 5.6 Wire protocol (T03P)

WebSocket at `/ws`, JSON messages `{ type: number, payload: object }`.
`PROTOCOL_VERSION = 3` (v2 added the T04 mutation messages, v3 adds mutation
levels); the client sends `HELLO { clientVersion: 3 }` and the server answers with
`WELCOME`. `net_proto.protocol_version` must equal that constant or the server
refuses to boot, so the two cannot drift apart silently. Client → server: `HELLO`, `INPUT`, `PING`, `GROWTH_INTENT`, `RESOURCE_QUERY`, `PLANT_SYNC_REQUEST`, `GROWTH_OPTIONS_REQUEST`, `DEV_ACTION`, `CHAT_MESSAGE`, `INVENTORY_REQUEST`, `INVENTORY_SLOT_USE`, `INVENTORY_SLOT_SWAP`, `REPORT`, `BLOCK`, `MUTATION_SHED` (36), `REROOT_INTENT` (37), `TERRAIN_REGION_REQUEST` (32).
Server → client: `WELCOME`, `STATE`, `KEYFRAME`, `REJECT`, `PONG`, `ERROR`, `GROWTH_EVENT`, `RESOURCE_UPDATE`, `PLANT_SYNC`, `PLANT_CREATED`, `PLANT_REMOVED`, `WEATHER_UPDATE`, `SEASON_UPDATE` (31), `GROWTH_OPTIONS_RESULT`, `CHAT_BROADCAST`, `INVENTORY_SYNC`, `INVENTORY_SLOT_UPDATE`, `MUTATION_STATE` (35), `PLANT_DAMAGE` (38), `PLANT_UPROOT` (39), `DROP_SPAWN` (40), `DROP_EXPIRED` (41), `FAUNA_EVENT` (42), `KILL_CREDIT` (43), `TERRAIN_REGION` (33), `TERRAIN_EDITS` (34), `DEV_RESPONSE`.
The server does **not** validate movement: the camera is client-side and there is
no server avatar, so `INPUT` only advances `lastInputTick` and `validateMovement`
was deleted. `REJECT` answers growth intents, never movement. Full table, payload
schemas:
[`docs/protocol.md`](./docs/protocol.md).

### 5.7 Events and ids

`GAME_EVENTS` is the shared vocabulary from Appendix E. The bus itself is T03.
Events: `PLANT_CREATED`, `PLANT_GROWTH`, `PLANT_DAMAGE`, `PLANT_DEATH`, `PLANT_TIER_CHANGE`, `PLAYER_JOINED`, `PLAYER_LEFT`, `RESOURCE_UPDATE`, `TICK_BUDGET_WARNING`.
Ids are opaque strings with a readable prefix (`acct_`, `world_`, `p_`, `item_`,
`gene_`, `seed_`, `ledger_`, `report_`) and are never assumed globally unique
outside the account service (every gameplay row also carries `world_id`).

## 6. Locked decisions

These are not open for reinterpretation without a new decision record.

1. **Camera is an independent entity.** It is not parented to the plant or the
   player and is not serialized as game state. C01 owns the CameraRig.
2. **All item and gene mutations are server transactions.** Granting,
   consuming, trading, mailing, grafting, extracting, bundling and planting all
   happen in a row-locked Postgres transaction on the server. The client may
   only request; it never mutates inventory.
3. **Single process, single world, single Postgres.** No Redis, no queue, no
   microservices (RULE_31). Scale later only with a measured reason.
4. **No rarity.** Not a field, not an enum member, not a color tier (RULE_20).
5. **Account-bound is absolute.** `account_bound: true` ⇒ `tradeable`,
   `mailable`, `listable` all false (RULE_23).
6. **Config is the only source of tunables.** No gameplay number in code
   (RULE_3). Config is validated at startup and in CI.
7. **TypeScript runs directly on the server side.** Server, shared and tools use
   Node's type stripping; imports carry `.ts` extensions. The client is bundled
   by Vite and typechecked with `tsc --noEmit`.
8. **Static client, authoritative server.** Separate deploy targets; the client
   never holds state (RULE_4, RULE_27). The Vite build is uploaded as static
   files; the server never serves the game client in production.
9. **Secrets only via environment.** No secrets file, no committed `.env`.
10. **`/health` is liveness, `/ready` is readiness.** A degraded database does
    not kill the process.
11. **Growth is two-step and gene-gated; no quick-grow.** Select a node/tip,
    choose an available node type, read energy cost and biomass gain, commit.
    The server validates parent, direction, type, genes, energy and bounds.
12. **Biomass is mass; energy is the spendable currency.** Photosynthesis fills
    energy; growth and upkeep spend it; growth adds biomass. Autonomous growth
    can be paused to bank energy.
13. **Germination is player-triggered and resource-gated.** No auto-germination.
    The attempt is always allowed; success requires configured moisture and
    light thresholds plus energy. Committing below a threshold destroys the
    seed/plant, which lets a player deliberately kill it. Delaying for rain is
    valid.
14. **No implicit persistence in local/dev.** Reloading or restarting creates a
    fresh plant; there is no `localStorage` reclaim and no ghost plant after
    disconnect. Persistence and the reconnect window are explicit dev switches.
    When persistence is on, recommend account creation at most once per day,
    never as a gate.
15. **WASD pans the camera.** No cube avatar and no direct avatar movement;
    reroot steering is the only movement context that reuses WASD. The camera
    frames the plant close, and plant size classes scale the small model rather
    than the world.
16. **Growth options are server-authoritative.** The server returns allowed node
    types, energy cost, biomass gain, expected time, and plain reasons. The
    client never hardcodes or overrides them.
17. **A dev settings engine owns implicit behaviour.** Every toggle and tunable
    lives behind `?dev=1` and a dev-only server endpoint so nothing is inferred
    from hidden client state.

The full rationale log is in [`docs/decisions.md`](./docs/decisions.md).

## 7. Invariants enforced today

This table lists invariants with a single guard. The full audit — every implicit
state machine and every invariant the app relies on but does not enforce — lives in
[`docs/state-machines-and-invariants.md`](./docs/state-machines-and-invariants.md),
which is the only current status source (the retired remediation plan is in
[`history.md`](./docs/history.md)).
Update that document, not this table, when an invariant is added or its
enforcement changes.

| Rule | Where |
|---|---|
| RULE_3 (no hardcoded tunables) | config validator + code review; ops/compliance/net_proto/onboarding/plant_renderer values live in config. Known gaps: WASD bindings and camera limits in `main.ts`, shader constants in `PlantRenderer.ts` |
| RULE_20 (no rarity) | `auditTree` + validator tests + CI |
| RULE_23 (account-bound flags) | `auditTree` + `violatesAccountBoundInvariant` + tests |
| Startup fails on invalid config | `loadRuntimeConfig` throws before `listen` |
| Server owns state | `World` is the only writer; the client renders received plant state and sends intents |
| Secrets not committed | `.gitignore` ignores `.env`; `.env.example` has placeholders |

## 8. Not built yet

Economy, marketplace/mail/trade, admin/compliance tooling. The T06 damage pipeline
is implemented; drop pickup, reroot controls and the damage HUD belong to
T51/T08A and C04. Chat, emotes and reports are implemented; inventory is partial and non-compliant — see [`docs/tasks/T08A.md`](./docs/tasks/T08A.md).

**V5.4 extension program (approved 2026-11-09, not built; ADR-047 schedules T54/C11 before volumetric terrain):** T54 reactive fauna, T55 material simulation, T56 volumetric terrain, C10 terrain/material rendering, T57 parametric terrain features, T58 world-object streaming, T59 ecological succession, C11 fauna rendering, O04 cloud-native orchestration. Nothing in this list exists in code. See `DESIGN.md` Parts 11 and 16 for the specs and the index of what is approved.


**C02 procedural plant renderer** is completed using **Raymarched Signed Distance Fields (SDF) with smooth minimum (`smin`) organic fusion** inspired by the procedural creature architecture of *Hatched* by SublimeOrange (`https://www.reddit.com/r/IndieDev/comments/1x9mmly/im_a_solo_dev_building_hatched_a/`). Instead of floating primitive cylinders clipping with flat caps, the organism's tapered capsule segments, joint spheres, root crown, and parametric foliage melt into a continuous living membrane with smooth branch collars and seamless root-to-canopy transition at $y = 0$.

**T02 Root Sight & Subterranean Visualization:** Two-mode camera with subterranean elevation tilting (`maxPolarAngle` extended to $177^\circ$) and organic ground cutaways. Rather than artificial spherical cuts or neon recoloring, the cutaway shader dynamically evaluates the multi-node smooth minimum distance (`smin`) across all subterranean roots and underground growths of player and rival plants. Soil opens up organically along root branches like smooth air bubble cavities with soft edges and earthen rim shading, preserving natural botanical bark and root coloration. Selecting root growth options or subterranean nodes automatically opens Root Sight.

**T01 Growth Interaction & Gene Clamping:** Silky-smooth growth direction drawing with exponential damping (`0.35` factor) and camera-facing plane projection, eliminating choppiness, jitter, and grazing ray singularities. Fully legible 2D HUD displays the allowed gene growth sector/cone (`minY`/`maxY`), maximum reach ring, glowing trajectory vector, directional arrowhead, concentric ghost bud preview, and real-time floating pill badge with organ name, meter reach, and constraint feedback (e.g., `(Max Reach)`, `(Gene Angle Clamped)`). Server-authoritative `clampGrowthDirectionByGene` mirrors client limits. Clicking a player plant node smoothly centers and frames the node at an appropriate zoom level; keyboard zoom (`-`/`+`) is smoothly damped; browser page zoom gestures are intercepted to protect the UI.


T01 growth simulation is server-authoritative
and working. **T00A resource model complete** (tile grid, simulation,
photosynthesis, absorption, deposits, consumption triggers, diffusion, broadcasts,
client readout connected). **T03 complete** (binary snapshot + event log persistence,
Active/Near/Dormant offline tiers, interest management, event bus, tick-budget metrics,
PLANT_SYNC/PLANT_CREATED/PLANT_SYNC_REQUEST).

## 9. Planet world (stage 1)

The play area is the surface of a sphere, not a plane. `config/render.json`
`planet_radius_m` (100000) sets the radius; `0` restores the flat plane.
`apps/client/src/renderers/environment/planetSurface.ts` owns the surface math
(drop from the pole plane, surface point/normal, cap geometry, `planetUp()`,
`planetGravity()`), with tests. Server nodes stay in the flat simulation frame and
are placed by `surfacePosition()`; the simulation itself is still planar.

The terrain is the circular piece of that sphere the player walks on, sized by
`render.json` `terrain_radius` (620 m, past the ~565 m horizon at eye height). The rest of the body is a sphere just
under it that shares the soil material, so the same tiles continue around the
globe. The soil shader converts fragments to arc-length surface coordinates from
the pole (`uPlanetCenter`/`uPlanetRadius`/`uPlanetEnabled`) before sampling the
256x256 resource grid, and the grid texture repeats; this is a surface
projection, not a geodesic tile topology. Root Sight keeps the terrain visible,
so the cutaway reads as a window into soil rather than a dome in the sky.

Planet orbit view is a dev-panel Camera action (Orbit Planet / Local View), with
no key binding. Its near, far, minimum distance and framing distance are all
`planet_radius_m` times a `planet_view_*_multiplier` tunable.

Root Sight no longer draws a soil dome. It cuts a cone out of the terrain from
the camera through the inspected node (`ground.ts` cone discard driven by
`uRootSightCamera`/`uRootSightCenter`/`uRootSightRadius`), so the opening follows
the view, stays round at any angle and shows the background through it. The rim
is a coverage edge one pixel wide rather than a hard discard. The
WebGL `soilDome`, the WebGPU `dome.wgsl` bowl and the unused WebGPU
`ground.wgsl` bubble cutaway were the source of the concentric rings and were
deleted. The dirt backdrop the dome used to give now comes from blending the sky
and fog to an earth gradient while Root Sight is open, so there is no dome
geometry that can ring or warp.

The camera's up vector follows the surface normal at the orbit target in the
local view and stays world up in planet view. OrbitControls reads `object.up`
when it is constructed and keeps that frame for the instance, and its cached
frame is private. `applyCameraUp()` therefore rebuilds the controls through the
public constructor when the normal moves more than 1.1 degrees, carrying the
target and settings over, instead of writing to `_quat`/`_quatInverse`. The dev
handle exposes `controls` as a getter so it follows the rebuilt instance.

Spherical tile addressing lives in `packages/shared/src/world/sphericalGrid.ts`
(exported as `@plant-legacy/shared/world`). It uses equal-angle latitude rings
with a per-ring cell count, and returns true neighbours (east/west wrap, poles
clamp, ring changes keep longitude) plus stable `ring:index` keys.

`ResourceWorld` stores resources per addressed cell through
`apps/server/src/ops/tileAddressing.ts`. The addressing is flat by default and
spherical when `render.json` `planet_radius_m` is positive; `main.ts` passes it
in. Cells come from the 1 m lattice points, so the simulated region is still the
configured bounds, but diffusion, canopy shading and uptake ask the addressing
who a cell's neighbours are. On a sphere that means the pole ring wraps, and
diagonal-looking tiles can be true neighbours. The 256x256 lattice survives as a
sampling view (`tileCells`, `tilesByCell`) so `getAllTiles`, the compact grid
buffer and the client's soil texture keep their contract. A planet-wide dense
grid is not built: at 100 km and 1 m cells that would be ~1.3e11 cells.

Still flat: physics and persistence treat the pole as a plane, and plant nodes
stay in the pole-local coordinate frame. Spherical physics is planned stage 2
(see the decisions in this session's record).

## 10. Notes for future sessions

- **Read config through the helpers.** `readNumber`, `readInteger`, `readString`,
  `readBoolean`, `readStringArray`, `readObject` from
  `@plant-legacy/shared/config`. Never inline a gameplay number (RULE_3).
- **The validator runs at server startup.** Invalid config exits before
  `listen`, so a boot failure is usually a config error.
- **Movement is not server-validated.** There is no server-side avatar: WASD
  pans the camera and `INPUT` is an ack-only heartbeat (`lastInputTick`). The
  unused `validateMovement` helper was deleted rather than left to imply
  enforcement that never ran. See `docs/protocol.md`.
- **Known RULE_3 gaps:** WASD bindings and camera limits in
  `apps/client/src/main.ts`. The RULE rows in §7 name the enforcement.

## 11. Keeping this file current

Update this file in the same change as any of:

- a new dependency, tool or runtime version;
- a new package, workspace or top-level directory;
- a new or changed interface (HTTP, shared export, protocol, env var);
- a locked decision or an invariant;
- a completed task (also update `docs/tasks/` and `docs/what-works-now.md`).
