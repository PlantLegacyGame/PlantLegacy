# Plant Legacy

A multiplayer plant-organism simulation. One server, one world, one Postgres.
Phase 0 foundation is in place, together with the Gate 0 networking gate and a
first procedural-rendering prototype. There is still no growth simulation,
economy or persistence.

**Source of truth:** [`DESIGN.md`](./DESIGN.md) (Master Build Plan v5.3.1). Every
task, rule and tunable comes from there. This repository implements **T00, O01,
T03P, C01, T00A** and the procedural plant renderer / Root Sight prototype
committed as **T01**. Full growth simulation (DESIGN.md §T01) is not built yet.

## Quick start

Requires **Node 24** (or 22.18+) and **pnpm 10**. On a fresh clone:

```sh
pnpm dev
```

That single command installs dependencies if needed, then starts:

- client (Vite dev server): <http://localhost:4173>
- server: <http://127.0.0.1:8080> (`/health`, `/ready`, `/config/*`, `/ws`)

Open the client URL in **two tabs** to see the server-authoritative cubes. Use
`localhost`, not `127.0.0.1`: Vite binds the IPv6 loopback on Windows. Press
`Ctrl+C` to stop both processes.

To run the checks CI runs:

```sh
pnpm verify
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | One-command local stack (install if needed, server + Vite dev server) |
| `pnpm dev:server` | Server only, watch mode |
| `pnpm dev:client` | Vite dev server only (proxies `/health`, `/ready`, `/config`, `/ws`) |
| `pnpm verify` | Lint + typecheck + config validator + unit tests |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm typecheck` | `tsc` across every workspace package |
| `pnpm config:validate` | Validate all `config/*.json`; **rejects `rarity`** |
| `pnpm test` | `node --test` in every package |
| `pnpm build` | Vite production build → `apps/client/dist` |
| `pnpm start` | Start the server (no watch) |

## Layout

```
apps/client/          Vite 8 + Three.js client (T03P, C01, T00A, T01)
apps/server/          HTTP + WebSocket server, health/readiness, Postgres probe
packages/shared/      Types, config loader/validator, protocol, events, ids
tools/config-validator/  CLI used by CI and `pnpm config:validate`
tools/dev.mjs         One-command local stack
config/               75 tunable files in extended-1 format + _meta
docs/                 Design notes, tunables, task records, checklists
ops/                  Docker compose, staging `.env`, deploy and backup placeholders
.github/workflows/    CI (verify) and staging static deploy
```

The full tree and every interface are documented in [`CONTEXT.md`](./CONTEXT.md).

## Configuration

Every tunable lives in `config/<system>.json` in the **extended-1** format:

```json
{
  "_meta": { "system": "ops", "version": "0.1.0", "schema": "extended-1",
             "owner_task": "O01", "status": "active" },
  "values": {
    "port": { "type": "integer", "value": 8080, "range": [1024, 65535] }
  }
}
```

- `value` is the default; `range` bounds it.
- A file's `_meta.system` must equal its filename.
- **No `rarity` field is allowed at any depth** (RULE_20). The validator fails
  the build if one appears.
- `account_bound: true` forces `tradeable`, `mailable` and `listable` to false
  (RULE_23).
- Stubs carry `values: {}` until their owning task fills them. Five files are
  populated today: `ops`, `compliance`, `net_proto`, `onboarding` and
  `plant_renderer`; the other 70 are stubs. See
  [`docs/tunables.md`](./docs/tunables.md) for the file-to-task map and current
  values.

## Environment

Secrets are **only** environment variables; `.env` is never committed. See
[`.env.example`](./.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `local` | Environment separation (`local`, `staging`, `production`) |
| `PORT` | `8080` | Server port (overrides `config/ops.json`) |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `CORS_ORIGINS` | local dev origins | Comma-separated browser origins allowed to call the API and open the WebSocket |
| `CONFIG_DIR` | auto-discovered | Path to `config/` |
| `DATABASE_URL` | unset | Postgres connection; unset = DB skipped locally |
| `READINESS_REQUIRES_DB` | `true` | `/ready` returns 503 unless Postgres answers |
| `STAGING_SERVER_ORIGIN` | unset | GitHub repo variable used by the staging deploy |

The staging compose stack reads `ops/.env` (gitignored) through Compose's normal
`.env` loading. Do not commit it.

## Deployment

- **Client:** static `apps/client/dist`, published by
  `.github/workflows/deploy-staging.yml` to GitHub Pages on `main`:
  <https://plantlegacygame.github.io/PlantLegacy/>.
- **Server + Postgres:** `docker compose -f ops/compose.yml up -d --build` on a
  machine running Docker. The current staging API is the local compose stack
  exposed through a **Cloudflare quick tunnel**; it is not a persistent VM yet.
  See [`docs/hosting.md`](./docs/hosting.md).
- **CI:** `.github/workflows/ci.yml` runs lint, typecheck, the config validator
  (schema + rarity ban), tests and the build on every push and PR.

The Pages build injects the `STAGING_SERVER_ORIGIN` repository variable into
`meta[name=server-origin]`. A quick-tunnel URL changes whenever the tunnel
restarts, so the variable and the server's `CORS_ORIGINS` must be updated
together.

## Documentation

| File | Contents |
|---|---|
| [`DESIGN.md`](./DESIGN.md) | Master plan v5.3.1 (source of truth) |
| [`CONTEXT.md`](./CONTEXT.md) | Stack, tree, interfaces, locked decisions |
| [`docs/tunables.md`](./docs/tunables.md) | Every config file, owner, current values |
| [`docs/protocol.md`](./docs/protocol.md) | WebSocket + JSON protocol (T03P) |
| [`docs/controls.md`](./docs/controls.md) | Current bindings and the C01 contract |
| [`docs/tasks/`](./docs/tasks/) | Task records and acceptance evidence |
| [`docs/checklists/`](./docs/checklists/) | Manual test checklists |
| [`docs/what-works-now.md`](./docs/what-works-now.md) | Honest status |
| [`docs/compliance-policy.md`](./docs/compliance-policy.md) | Five-line policy |
| [`docs/art-bible.md`](./docs/art-bible.md) | Visual language stub |
| [`docs/hosting.md`](./docs/hosting.md) | Deploy and environment separation |
| [`docs/deploy-walkthrough.md`](./docs/deploy-walkthrough.md) | First push → live staging URL, command by command |
| [`docs/decisions.md`](./docs/decisions.md) | Decision log |
| [`ATTRIBUTION.md`](./ATTRIBUTION.md) | Asset licenses (empty for now) |

## Non-negotiables

- **RULE_3:** no hardcoded gameplay values. Everything is a config tunable.
- **RULE_4 / RULE_27:** the server owns all state; the client only renders and
  sends intents.
- **RULE_20:** no `rarity` field, anywhere, ever. The validator enforces it.
- **RULE_23:** account-bound items cannot be traded, mailed or listed.

## License

UNLICENSED. All rights reserved until a license is chosen.
