# Decision log

Decisions made while building T00 + O01. Each record is small on purpose: the
plan in `DESIGN.md` is the source of truth, and these explain **how** this
repository implements it. Add a record when a choice would otherwise be
re-litigated.

Format: **Context → Decision → Consequences.**

---

## ADR-001 — Run TypeScript directly on Node

**Context.** Server, shared and tooling are TypeScript. A bundler or `tsc` emit
step adds a build artifact and a watch loop for no gameplay benefit in Phase 0.

**Decision.** Use Node 24's native type stripping. All server/shared/tool imports
carry `.ts` extensions. `tsc` is used for typechecking only (`noEmit`).

**Consequences.** No build step for the server; the Docker image copies source.
Node must be ≥ 22.18. `allowImportingTsExtensions` and
`rewriteRelativeImportExtensions` stay on. C01 may still introduce Vite for the
client; that does not change the server.

---

## ADR-002 — Biome for lint and format

**Context.** The plan requires lint/format but does not name a tool. ESLint +
Prettier is two dependency trees and two configs.

**Decision.** One tool: Biome 2.6.4, recommended preset, single quotes, 100-column
lines, semicolons, trailing commas. `config/` and `DESIGN.md` are excluded.

**Consequences.** One command (`pnpm lint`) and one autofix (`pnpm lint:fix`).
Rules outside Biome's set are enforced by tests and review, not by a plugin.

---

## ADR-003 — pnpm workspaces, lockfile committed

**Context.** The plan mandates a pnpm monorepo. CI must be reproducible.

**Decision.** `pnpm-workspace.yaml` covers `apps/*`, `packages/*`, `tools/*`.
`packageManager` pins pnpm 10.18.0. `pnpm-lock.yaml` is committed and CI uses
`--frozen-lockfile`.

**Consequences.** Fresh clones need pnpm (Corepack or `npm i -g pnpm@10`).
Workspace packages use `workspace:*`.

---

## ADR-004 — `pg` directly, no ORM

**Context.** Phase 0 needs to prove the server can reach Postgres. Real
row-locked transactions arrive with T03/T08A.

**Decision.** Use `pg.Pool` behind a small `DatabaseProbe`. No ORM, no query
builder, no migration tool yet.

**Consequences.** `select 1` is the only query. O02 adds migrations; T03 adds the
transaction helpers. Adding an ORM later is a deliberate, separate decision.

---

## ADR-005 — `/health` is liveness, `/ready` is readiness

**Context.** A process can be alive while its database is down. Killing it then
would turn a database outage into a restart loop.

**Decision.** `/health` always returns 200 while the process runs and reports
`degraded` when a configured database is down. `/ready` returns 503 unless the
deployment requires a database and it answers.

**Consequences.** Container health checks use `/health`; load balancers and
deploy gates use `/ready`. `READINESS_REQUIRES_DB=false` makes local runs
ready without Postgres.

---

## ADR-006 — Config directory is discovered upward

**Context.** `pnpm --filter @plant-legacy/server start` runs with the working
directory set to `apps/server`, while `config/` lives at the repo root. The
container sets `CONFIG_DIR` explicitly.

**Decision.** If `CONFIG_DIR` is unset, walk up from `process.cwd()` until a
`config/_meta/schema.json` exists. `CONFIG_DIR` always wins when set.

**Consequences.** The server starts correctly from the repo root, from
`apps/server`, and from tests. No path is hardcoded to one machine.

---

## ADR-007 — Static client, separate deploy target

**Context.** The plan requires a free static client host and a server that owns
all state.

**Decision.** The client is plain static files published to GitHub Pages. The
server and Postgres run on one VM via Docker Compose. They share no process and
no filesystem.

**Consequences.** CORS/origin configuration becomes necessary once the client
calls more than `/health`. The client build injects `STAGING_SERVER_ORIGIN`.
The server never serves the game client in production.

---

## ADR-008 — One-command dev without an orchestration dependency

**Context.** O01 requires a fresh clone to run with one command. `concurrently`
would be a dependency for two child processes.

**Decision.** `tools/dev.mjs` installs if needed, builds the client, and spawns
the server and preview. The preview proxies `/health` and `/ready` to the server
so the shell works with a relative URL.

**Consequences.** `pnpm dev` is genuinely one command. The runner is ~70 lines
and uses only Node built-ins. It is development-only; production uses the
container.

---

## ADR-009 — 73 config stubs, `values: {}` until owned

**Context.** T00 must create every file named in DESIGN.md Part 6.2, but most
systems are not designed yet.

**Decision.** Generate one file per system with correct `_meta` (`system`,
`version`, `schema`, `owner_task`, `status`). Stubs carry `values: {}`. Only
`ops.json` (active) and `compliance.json` (draft) carry values now.

**Consequences.** The file list is testable and stable. An owning task replaces
`{}` with real entries and sets `status`. The validator accepts empty `values`;
it rejects malformed entries.

---

## ADR-010 — Five-line policy is a compliance floor, not moderation

**Context.** Payment rails and hosting require an illegal-content policy, while
the design forbids general moderation (RULE_6, RULE_12).

**Decision.** Draft exactly five lines in `config/compliance.json`: CSAM,
credible threats, doxxing, illegal activity, and an explicit statement that
nothing else is removed for content reasons.

**Consequences.** T40 owns enforcement, the age gate and legal pages. The policy
must not grow into a general moderation queue without changing the design.

---

## ADR-011 — No `.env` loader in the server

**Context.** Secrets must come only from the environment. A dotenv dependency
silently reads a file that could be committed by mistake.

**Decision.** Read `process.env` directly. `.env.example` documents names and
placeholders; Compose and the host provide real values.

**Consequences.** Local users export variables or use their shell/Compose. There
is no hidden file precedence and no chance of committing a loaded secret.

---

## ADR-012 — Strict TypeScript, no implicit `any` escape hatches

**Context.** The plan requires TypeScript strict mode.

**Decision.** `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
`noUnusedLocals`, `noUnusedParameters`, `useUnknownInCatchVariables`,
`verbatimModuleSyntax`, `isolatedModules`.

**Consequences.** Catch variables are `unknown` and must be narrowed. Type-only
imports must use `import type`. Tests compile under the same settings.
