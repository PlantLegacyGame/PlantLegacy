# Decision log

Decisions made while building Phase 0 / Gate 0 (T00, O01, T03P, C01, T00A and
the T01 renderer prototype). Each record is small on purpose: the plan in
`DESIGN.md` is the source of truth, and these explain **how** this repository
implements it. Add a record when a choice would otherwise be re-litigated.

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

**Decision.** `tools/dev.mjs` installs if needed, then spawns the server (watch
mode) and the Vite dev server. Vite proxies `/health`, `/ready`, `/config` and
`/ws` to the server so the client can use relative URLs.

**Consequences.** `pnpm dev` is genuinely one command. The runner uses only Node
built-ins and `taskkill` on Windows for clean shutdown. It is development-only;
production serves the Vite build as static files and runs the container.

---

## ADR-009 — Config stubs, `values: {}` until owned

**Context.** T00 must create every file named in DESIGN.md Part 6.2, but most
systems are not designed yet.

**Decision.** Generate one file per system with correct `_meta` (`system`,
`version`, `schema`, `owner_task`, `status`). Stubs carry `values: {}`. When a
task needs a config that Part 6.2 did not name, add a file rather than hiding
values in code (RULE_3): `onboarding.json` and `plant_renderer.json` were added
this way.

**Consequences.** The file list is testable and stable: 73 Part 6.2 systems plus
2 additions = 75 files. Five are populated today (`ops` active; `compliance`,
`net_proto`, `onboarding`, `plant_renderer` draft); 70 are stubs. An owning task
replaces `{}` with real entries and sets `status`. The validator accepts empty
`values`; it rejects malformed entries.

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

---

## ADR-013 — Vite + Three.js for the client

**Context.** C01 needs a real scene, camera, input layer and DOM overlay. The
Phase 0 shell was plain HTML/CSS/TS with no renderer.

**Decision.** Build the client with Vite 8 and Three.js r187, plus
`@vitejs/plugin-legacy` for older browsers. `base` is `/PlantLegacy/` so the
GitHub Pages subpath resolves. The Vite dev server proxies `/health`, `/ready`,
`/config` and `/ws` to `127.0.0.1:8080`.

**Consequences.** The client gains a build step (`pnpm build` → `apps/client/dist`);
server, shared and tools still run TypeScript directly (ADR-001). Pages URLs must
keep the repository subpath, and the dev server must be opened through
`localhost` (Vite binds the IPv6 loopback on Windows).

---

## ADR-014 — WebSocket + JSON for the Gate 0 protocol

**Context.** T03P must decide how two browsers exchange server-authoritative
state before T03 builds the full protocol.

**Decision.** Use WebSocket at `/ws` with JSON frames
`{ type: number, payload: object }`. `PROTOCOL_VERSION = 1`; the client sends
`HELLO` then `INPUT` at 20 Hz. The server runs a 20 Hz `CubeWorld`, validates
velocity, world bounds and quantization, and broadcasts `STATE` or `KEYFRAME`.

**Consequences.** Debugging is trivial and the protocol works through the
Cloudflare tunnel. Payloads are larger than binary framing; T03 replaces this
with binary framing and delta compression. `net_proto.json` owns every value.

---

## ADR-015 — Staging API from local Docker compose behind a quick tunnel

**Context.** GitHub Pages is HTTPS, so the browser blocks an `http://` API as
mixed content. A persistent VM that accepts the owner's constraints (no credit
card) is not available yet.

**Decision.** Run the compose stack on a local machine with Docker and expose
the server's `:8080` through `cloudflared tunnel --url http://localhost:8080`.
Store `NODE_ENV=staging` and `CORS_ORIGINS` in gitignored `ops/.env`; Compose
auto-loads it. Inject the tunnel origin into the Pages build through the
`STAGING_SERVER_ORIGIN` repository variable.

**Consequences.** Staging works today with no card and no VM, but depends on the
local PC, Docker and the tunnel staying up. The quick-tunnel URL changes on
restart, so `ops/.env` and the repository variable must be updated together.
Postgres stays bound to `127.0.0.1` and is never tunnelled. A persistent VM or
named tunnel remains the intended replacement.

---

## ADR-016 — GLSL3 shader convention for Three r187

**Context.** Three r187 compiles `ShaderMaterial` as GLSL 3.00 ES and prepends
its own `#version`, precision block, built-in matrices and attributes. The first
Root Sight shaders repeated those declarations, so `#version` landed mid-file
and the built-ins were redefined; every program failed to compile.

**Decision.** Set `glslVersion: THREE.GLSL3` on every `ShaderMaterial`. Shader
strings must not contain `#version`, `precision`, or declarations of
`modelMatrix`, `modelViewMatrix`, `projectionMatrix`, `position`, `normal` or
`uv`. Use Three's built-in attributes for `PlaneGeometry`, and transform normals
with `mat3(modelMatrix)` when comparing against a world-space sun direction.

**Consequences.** Shaders compile on r187. Sources live inline in
`apps/client/src/renderers/PlantRenderer.ts`; the duplicate
`src/shaders/*.vert|frag` files were deleted to prevent drift. A future shader
must follow the same rule.

---

## ADR-017 — Serve tunables over HTTP instead of bundling them

**Context.** The static client is deployed to Pages, but tunables live in
`config/` and must be changeable without a client rebuild. RULE_3 forbids
copying the values into source.

**Decision.** The server exposes `GET /config/onboarding` and
`GET /config/plant_renderer`, reading the file from `CONFIG_DIR` per request and
flattening extended-1 `values` to a plain object. The client fetches with
`cache: 'no-store'` and falls back to defaults if the request fails.

**Consequences.** A config edit plus a refresh is enough; no Pages deploy is
needed. The client origin must be in `CORS_ORIGINS`. The server remains the
single source of tunables, and new systems should add a `/config/<system>` route
rather than embedding numbers in the bundle.
