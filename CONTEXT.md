# CONTEXT

Current context for any human or AI session working in this repository. Keep it
current at the end of every task (DESIGN.md, Session Protocol). `DESIGN.md` wins
over this file whenever they disagree.

**Phase:** 1 — The Living Sprout (in progress). **Implemented:** T00, O01, T03P, C01, **T00A** (resource model + onboarding), T01 (growth simulation), **T03** (persistence, offline tiers, interest management, event bus), **T08C** (accounts + sessions), **C02** (Raymarched SDF procedural organism renderer with `smin` organic fusion, Murray's law allometric tapering, thin-lamina foliage, and 0.9s real-time emergence animation), **T02** (Root Sight unified organism integration), **T07** (Weather state machine, day/night cycle, forecast broadcast, ResourceWorld integration). **Added:** config/resources.json, config/world.json, config/network.json, config/accounts.json, config/plant_renderer.json, config/root_sight.json, config/weather.json, config/daynight.json, server resource model, PlantPersistence, PlantWorld tiers, InterestManager, EventBus, AccountsService, WeatherSystem. **Last updated:** 2026-11-04.

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
draws server plant data and server cube positions. Do not add a new framework without a task that
requires it.

## 2. Commands

```sh
pnpm dev              # one command: install if needed, server + Vite dev server
pnpm dev:server       # server only, watch mode
pnpm dev:client       # Vite dev server only
pnpm verify           # lint + typecheck + config:validate + test
pnpm lint             # biome check .
pnpm typecheck        # tsc -p in every package
pnpm config:validate  # schema + rarity ban over config/*.json
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
│   │   ├── src/input/InputBus.ts         # C01 named actions + producers
│   │   ├── src/render/QualityController.ts  # C01 dynamic resolution
│   │   ├── src/renderers/PlantRenderer.ts  # Root Sight shaders, ground, points
│   │   ├── src/ui/UIShell.ts             # C01 DOM overlay layers, toasts
│   │   ├── src/ui/DebugOverlay.ts        # C01 live metrics overlay
│   │   ├── src/styles.css
│   │   └── tsconfig.json
│   └── server/
│       ├── Dockerfile
│       ├── src/core/config.ts # config load + env merge
│       ├── src/core/version.ts
│       ├── src/main.ts        # HTTP + WebSocket server, CubeWorld, /config routes
│       ├── src/ops/db.ts      # Postgres reachability probe + migrations
│       ├── src/ops/health.ts  # pure report + readiness
│       ├── src/ops/net.ts     # protocol types, net_proto config, movement validation
│       ├── src/ops/log.ts     # JSON logger
│       ├── src/ops/eventBus.ts    # T03 in-process pub/sub
│       ├── src/ops/interestManager.ts  # T03 spatial interest management
│       ├── src/ops/world.ts         # T03 world config loader
│       ├── src/ops/persistence/     # T03 binary snapshot + event log
│       ├── src/ops/plantWorld.ts    # T01 growth + T03 offline tiers
│       ├── src/ops/accounts/        # T08C accounts + sessions
│       │   ├── config.ts            # config loader
│       │   ├── service.ts           # argon2id, JWT, rate limits, lockout
│       │   └── http.ts              # /auth/* endpoints
│       └── tsconfig.json
├── packages/shared/
│   └── src/
│       ├── config/{types,validate,loader,index}.ts
│       ├── config/validate.test.ts
│       ├── events/index.ts    # GAME_EVENTS vocabulary (Appendix E)
│       ├── ids/index.ts       # prefixed opaque ids
│       ├── math/index.ts      # clamp, lerp
│       ├── protocol/index.ts  # PROTOCOL_VERSION, frame header
│       ├── schemas/{item,death-record}.ts
│       └── index.ts
├── tools/
│   ├── config-validator/src/cli.ts
│   ├── dev.mjs                # one-command local stack
│   ├── sim-bots/              # placeholder (T26)
│   ├── load-test/             # placeholder (O03)
│   ├── seed-data/             # placeholder (T03)
│   └── backup/                # placeholder (O02)
├── config/                    # 75 tunable files + _meta
├── docs/                      # tunables, tasks, checklists, design notes
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

- **Client:** renders only. It sends input intents and draws server cube state;
  it holds no authority (RULE_4, RULE_27). Three.js scene, OrbitControls,
  `PlantRenderer` (Root Sight shaders), **C01 input abstraction, UI shell,
  quality controller, debug overlay**, and the T00A onboarding overlay.
- **Server:** one process, one world, one Postgres (RULE_31). `CubeWorld` runs a
  20 Hz tick, quantizes movement and broadcasts `STATE` / `KEYFRAME`. Velocity
  and world-bounds rejection are effective (unit tests prove rejection fires).
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
| GET | `/config/root_sight` | 200 | flat `root_sight` values (`cutaway_radius`, `soil_opacity`, …) |
| * | anything else | 404 | `{ error: "not_found" }` |

The `/config/*` routes read the file from `CONFIG_DIR` on each request and fall
back to built-in defaults if the file cannot be read. They exist so the static
client can load T00A/T01 tunables without a bundler rebuild.

```ts
interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;            // SERVICE_VERSION
  uptime_s: number;           // floor(seconds since start)
  checks: {
    config: 'ok';
    config_files: number;     // 75
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

Validator rules (authoritative code: `src/config/validate.ts`):

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

### 5.6 Wire protocol (T03P)

WebSocket at `/ws`, JSON messages `{ type: number, payload: object }`.
`PROTOCOL_VERSION = 1`; the client sends `HELLO { clientVersion: 1 }` and the
server answers with `WELCOME`. Client → server: `HELLO`, `INPUT`, `PING`, `GROWTH_INTENT`, `RESOURCE_QUERY`, `PLANT_SYNC_REQUEST`.
Server → client: `WELCOME`, `STATE`, `KEYFRAME`, `REJECT`, `PONG`, `ERROR`, `GROWTH_EVENT`, `RESOURCE_UPDATE`, `PLANT_SYNC`, `PLANT_CREATED`.
The server validates movement (velocity, world bounds, quantization) and sends
`REJECT` plus authoritative state. Unit tests confirm both velocity and bounds
rejection fire. Full table, payload schemas:
[`docs/protocol.md`](./protocol.md).

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

The full rationale log is in [`docs/decisions.md`](./docs/decisions.md).

## 7. Invariants enforced today

| Rule | Where |
|---|---|
| RULE_3 (no hardcoded tunables) | config validator + code review; ops/compliance/net_proto/onboarding/plant_renderer values live in config. Known gaps: WASD bindings and camera limits in `main.ts`, shader constants in `PlantRenderer.ts` |
| RULE_20 (no rarity) | `auditTree` + validator tests + CI |
| RULE_23 (account-bound flags) | `auditTree` + `violatesAccountBoundInvariant` + tests |
| Startup fails on invalid config | `loadRuntimeConfig` throws before `listen` |
| Server owns state | `CubeWorld` is the only writer; the client renders received cube state and sends intents |
| Secrets not committed | `.gitignore` ignores `.env`; `.env.example` has placeholders |

## 8. Not built yet

Chat, economy, damage pipeline, weather/daynight, inventory, admin/compliance tooling.


**C02 procedural plant renderer** is completed using **Raymarched Signed Distance Fields (SDF) with smooth minimum (`smin`) organic fusion** inspired by the procedural creature architecture of *Hatched* by SublimeOrange (`https://www.reddit.com/r/IndieDev/comments/1x9mmly/im_a_solo_dev_building_hatched_a/`). Instead of floating primitive cylinders clipping with flat caps, the organism's tapered capsule segments, joint spheres, root crown, and parametric foliage melt into a continuous living membrane with smooth branch collars and seamless root-to-canopy transition at $y = 0$.

**T02 Root Sight** two-mode camera and volumetric ground cutaway are fully integrated with the unified SDF organism: subterranean root branches are revealed as part of that single continuous body, highlighting viewer roots in `#4CAF50` and rival roots in `#FF5722`.


T01 growth simulation is server-authoritative
and working. **T00A resource model complete** (tile grid, simulation,
photosynthesis, absorption, deposits, consumption triggers, diffusion, broadcasts,
client readout connected). **T03 complete** (binary snapshot + event log persistence,
Active/Near/Dormant offline tiers, interest management, event bus, tick-budget metrics,
PLANT_SYNC/PLANT_CREATED/PLANT_SYNC_REQUEST).

## 9. Keeping this file current

Update this file in the same change as any of:

- a new dependency, tool or runtime version;
- a new package, workspace or top-level directory;
- a new or changed interface (HTTP, shared export, protocol, env var);
- a locked decision or an invariant;
- a completed task (also update `docs/tasks/` and `docs/what-works-now.md`).
