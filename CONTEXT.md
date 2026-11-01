# CONTEXT

Current context for any human or AI session working in this repository. Keep it
current at the end of every task (DESIGN.md, Session Protocol). `DESIGN.md` wins
over this file whenever they disagree.

**Phase:** 0 — Foundation. **Implemented:** T00 + O01 only.
**Last updated:** 2026-11-01.

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
| Client | Static HTML/CSS/TS shell | C01 replaces it with Vite + Three.js |
| CI | GitHub Actions | Verify on push/PR; Pages deploy on `main` |
| Container | `node:24-alpine` | Runs TS directly |

There is **no bundler, no ORM, no game engine and no game loop** yet. Do not add
one without a task that requires it.

## 2. Commands

```sh
pnpm dev              # one command: install if needed, build client, run both
pnpm verify           # lint + typecheck + config:validate + test
pnpm lint             # biome check .
pnpm typecheck        # tsc -p in every package
pnpm config:validate  # schema + rarity ban over config/*.json
pnpm test             # node --test in packages/shared and apps/server
pnpm build            # static client -> apps/client/dist
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
│   │   ├── index.html         # shell; meta[name=server-origin]
│   │   ├── scripts/copy-static.mjs
│   │   ├── scripts/serve.mjs  # preview server; proxies /health and /ready
│   │   ├── src/main.ts        # fetch /health, render status
│   │   ├── src/styles.css
│   │   └── tsconfig.json
│   └── server/
│       ├── Dockerfile
│       ├── src/core/config.ts # config load + env merge
│       ├── src/core/version.ts
│       ├── src/main.ts        # HTTP server, /health, /ready, shutdown
│       ├── src/ops/db.ts      # Postgres reachability probe
│       ├── src/ops/health.ts  # pure report + readiness
│       ├── src/ops/health.test.ts
│       ├── src/ops/log.ts     # JSON logger
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
├── config/                    # 73 tunable files + _meta
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
Browser (static shell) ──GET /health──▶ Server (node:http) ──select 1──▶ Postgres
        ▲                                   │
        └──────── static files ─────────────┘ (separate origin/host)
```

- **Client:** static files only. It holds no game state and no authority
  (RULE_4, RULE_27). `src/main.ts` probes `/health` and prints the result.
- **Server:** one process, one world, one Postgres (RULE_31). It loads and
  validates all config before listening; invalid config is a startup failure.
- **Database:** optional locally (`DATABASE_URL` unset → `skipped`), required in
  compose/staging (`READINESS_REQUIRES_DB=true`).
- **Deploy split:** client on GitHub Pages; server + Postgres on one free VM.
  They are deployed separately on purpose.

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
| * | anything else | 404 | `{ error: "not_found" }` |

```ts
interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;            // SERVICE_VERSION
  uptime_s: number;           // floor(seconds since start)
  checks: {
    config: 'ok';
    config_files: number;     // 73
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
| `CLIENT_PORT` / `PROXY_ORIGIN` | `4173` / `http://127.0.0.1:8080` | Local client preview only |

`NODE_ENV` is validated against `ops.environments` at startup. Secrets are never
committed. `.env.example` contains placeholders only, and the server does not
load a `.env` file (ADR-011).

### 5.5 Database probe

`DatabaseProbe` (`apps/server/src/ops/db.ts`) owns a `pg.Pool`. `ping()` runs
`select 1` and returns `ok` / `down`; no URL returns `skipped`. There are **no
tables or migrations yet** — T03/T08A/O02 add them.

### 5.6 Wire protocol (placeholder)

`PROTOCOL_VERSION = 1`; frame header is `[version:u8][type:u8]`. Payload
encoding is decided by **T03P** (Gate 0) and documented in
`docs/protocol.md`. Do not invent a second framing.

### 5.7 Events and ids

`GAME_EVENTS` is the shared vocabulary from Appendix E. The bus itself is T03.
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
7. **TypeScript runs directly.** Server, shared and tools use Node's type
   stripping; imports carry `.ts` extensions. The client compiles with `tsc`
   until C01 moves it to Vite.
8. **Static client, authoritative server.** Separate deploy targets; the client
   never holds state (RULE_4, RULE_27).
9. **Secrets only via environment.** No secrets file, no committed `.env`.
10. **`/health` is liveness, `/ready` is readiness.** A degraded database does
    not kill the process.

The full rationale log is in [`docs/decisions.md`](./docs/decisions.md).

## 7. Invariants enforced today

| Rule | Where |
|---|---|
| RULE_3 (no hardcoded tunables) | config validator + code review; ops/compliance values live in config |
| RULE_20 (no rarity) | `auditTree` + validator tests + CI |
| RULE_23 (account-bound flags) | `auditTree` + `violatesAccountBoundInvariant` + tests |
| Startup fails on invalid config | `loadRuntimeConfig` throws before `listen` |
| Server owns state | no client state exists yet; server is the only writer |
| Secrets not committed | `.gitignore` ignores `.env`; `.env.example` has placeholders |

## 8. Not built yet

World simulation, plants, growth, rendering, accounts, chat, economy, protocol
transport, database schema/migrations, admin/compliance tooling. The next task
is **T03P** (Gate 0), per DESIGN.md Part 4.

## 9. Keeping this file current

Update this file in the same change as any of:

- a new dependency, tool or runtime version;
- a new package, workspace or top-level directory;
- a new or changed interface (HTTP, shared export, protocol, env var);
- a locked decision or an invariant;
- a completed task (also update `docs/tasks/` and `docs/what-works-now.md`).
