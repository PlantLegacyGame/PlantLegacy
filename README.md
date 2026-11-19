# Plant Legacy

A multiplayer plant-organism simulation. One server, one world, one Postgres.
Phase 1 foundation is in place, together with the Gate 0 networking gate and a
first procedural-rendering prototype. Growth simulation, persistence, accounts,
chat, weather and day/night are implemented. Economy is not built yet.

**Source of truth:** [`DESIGN.md`](./DESIGN.md) (Master Build Plan v5.3.1). Every
task, rule and tunable comes from there. This repository implements **T00, O01,
T03P, C01, T00A** (resource model + onboarding), **T01** (growth simulation),
**T03** (persistence, offline tiers, interest management, event bus),
**T08C** (accounts + sessions), **T07** (weather & day/night), **C02** (SDF
plant renderer), **T02** (Root Sight), **T04** (mutations), **T05** (chat,
emotes, block, report),
**C03** (environment rendering) and **C03b** (ground LOD), the
**C02b slice** (WebGPU compute-driven plant LOD with WebGL2 fallback), **D01**
(dev settings), **T06** (damage, uproot, tumbling, reroot crawl, kill credit and
drops; in-browser checklist pending), and
**T25** (shared terrain field, LOD ground colliders, plant colliders, sparse
persistent soil edits; client height-texture application still pending).

## Quick start

Requires **Node 24** (or 22.18+) and **pnpm 10**. On a fresh clone:

```sh
pnpm dev
```

That single command installs dependencies if needed, then starts:

- client (Vite dev server): <http://localhost:4173>
- server: <http://127.0.0.1:8080> (`/health`, `/ready`, `/config/*`, `/ws`)

Open the client URL in **two tabs** to see the server-authoritative plants. Use
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
| `pnpm verify` | The CI chain: lint + typecheck + config validator + docs check + unit tests |
| `pnpm verify:ci` | `verify` plus the production build |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm typecheck` | `tsc` across every workspace package |
| `pnpm config:validate` | Validate all `config/*.json`; **rejects `rarity`** |
| `pnpm docs:check` | Links, config counts, protocol table and duplicate prose across `docs/` |
| `pnpm test` | `node --test` in every package |
| `pnpm bot` | Headless player bots against a running server (`-- --bots 2 --minutes 5`); see [`tools/sim-bots`](./tools/sim-bots/README.md) |
| `pnpm build` | Vite production build → `apps/client/dist` |
| `pnpm start` | Start the server (no watch) |

## Layout

```
apps/client/          Vite 8 + Three.js client (T03P, C01, T00A, T01)
apps/server/          HTTP + WebSocket server, health/readiness, Postgres probe
packages/shared/      Types, config loader/validator, protocol, events, ids
tools/config-validator/  CLI used by CI and `pnpm config:validate`
tools/docs-check/     Documentation guardrail (`pnpm docs:check`)
tools/dev.mjs         One-command local stack
config/               78 tunable files in extended-1 format + _meta (count owned by docs/tunables.md)
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
- Stubs carry `values: {}` until their owning task fills them. **Twenty-four**
  files carry values today and 54 are stubs; the authoritative list is owned by
  [`docs/tunables.md`](./docs/tunables.md) rather than duplicated here.

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
  See [`docs/deploy.md`](./docs/deploy.md).
- **CI:** `.github/workflows/ci.yml` runs lint, typecheck, the config validator
  (schema + rarity ban), tests and the build on every push and PR.

The Pages build injects the `STAGING_SERVER_ORIGIN` repository variable into
`meta[name=server-origin]`. A quick-tunnel URL changes whenever the tunnel
restarts, so the variable and the server's `CORS_ORIGINS` must be updated
together.

## Documentation

| Topic | Single home |
|---|---|
| What the game is: philosophy, humour, the 31 rules, every task spec | [`DESIGN.md`](./DESIGN.md) — source of truth, not summarized elsewhere |
| Every ruling, with its date and reasoning | [`docs/decisions.md`](./docs/decisions.md) |
| How the built system actually works | [`CONTEXT.md`](./CONTEXT.md), [`docs/protocol.md`](./docs/protocol.md), [`docs/data-model.md`](./docs/data-model.md), [`docs/state-machines-and-invariants.md`](./docs/state-machines-and-invariants.md) |
| Config files: owner, status, value count | [`docs/tunables.md`](./docs/tunables.md) — values live in `config/` |
| What is built, what is not, known gaps | [`docs/what-works-now.md`](./docs/what-works-now.md) |
| What happened, when | [`docs/history.md`](./docs/history.md) — append-only, not current state |
| What comes next | [`docs/tasks/README.md`](./docs/tasks/README.md) — the ordered backlog; renderer work is ranked in [`docs/abyssal-garden-source-analysis.md`](./docs/abyssal-garden-source-analysis.md) Part II §15 |
| What to fix in the built system, in order | [`docs/improvement-plan.md`](./docs/improvement-plan.md) |
| The 2026-11-16 verified defect pass, fix by fix | [`docs/bugfix-plan.md`](./docs/bugfix-plan.md) |
| What is broken right now, with evidence and status | [`docs/bug-inventory.md`](./docs/bug-inventory.md) |
| How to ship it | [`docs/deploy.md`](./docs/deploy.md) |
| Per-task evidence and checklists | [`docs/tasks/`](./docs/tasks/), [`docs/checklists/`](./docs/checklists/) |

Supporting references: [`docs/controls.md`](./docs/controls.md) (bindings),
[`docs/art-bible.md`](./docs/art-bible.md) (visual language),
[`docs/partitioning-lod.md`](./docs/partitioning-lod.md) (interest, partitioning),
[`docs/tick-budget.md`](./docs/tick-budget.md) (tick timing),
[`docs/compliance-policy.md`](./docs/compliance-policy.md),
[`docs/what-spores-are.md`](./docs/what-spores-are.md),
[`docs/abyssal-garden-source-analysis.md`](./docs/abyssal-garden-source-analysis.md) (Abyssal Garden source analysis and what to take from it),
[`ATTRIBUTION.md`](./ATTRIBUTION.md) (asset licences).

## Approved extensions (not built)

The v5.4 extension program is **approved 2026-11-09, not built**. It covers reactive
non-sapient fauna, material simulation (water/sand/lava/fire), sparse volumetric
terrain, parametric terrain features, streamed world objects, ecological
succession, and cloud-native World orchestration. The task specs and rule
amendments are in [`DESIGN.md`](./DESIGN.md) Parts 2, 11 and 16; the task index is
[`docs/tasks/README.md`](./docs/tasks/README.md).

**Abyssal Garden, reviewed 2026-11-14:** what the upstream source actually does,
where earlier descriptions of it were wrong, and the order to adopt it in are in
[`docs/abyssal-garden-source-analysis.md`](./docs/abyssal-garden-source-analysis.md).
Its nine review decisions are ADR-041 to ADR-049 in
[`docs/decisions.md`](./docs/decisions.md).

Nothing in that program changes the current 78-file config count (owned by
[`docs/tunables.md`](./docs/tunables.md)) or the
single-process World until the individual task is started.

## Non-negotiables

- **RULE_3:** no hardcoded gameplay values. Everything is a config tunable.
- **RULE_4 / RULE_27:** the server owns all state; the client only renders and
  sends intents.
- **RULE_20:** no `rarity` field, anywhere, ever. The validator enforces it.
- **RULE_23:** account-bound items cannot be traded, mailed or listed.

## License

UNLICENSED. All rights reserved until a license is chosen.
