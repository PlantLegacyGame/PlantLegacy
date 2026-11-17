# Decision log

The only ruling log for this repository: every implementation choice and every
review outcome, addressed as `ADR-nnn`. Each record is small on purpose — the
plan in `DESIGN.md` is the source of truth, and these explain **how** this
repository implements it, or **what was decided** when the plan left a choice
open. Add a record when a choice would otherwise be re-litigated.

**Not the same as DESIGN Part 12.** Part 12 is the plan's own v5.3 decision log
(`D-nn`, e.g. `D-02`), frozen with the plan. Where the two overlap, the ADR here
is the current ruling; Part 12 is kept for the history of how the plan was
written.

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

---

## ADR-018 — Growth is a two-step, gene-gated interaction; no quick-grow

**Context.** The T01 prototype bound `G` to immediate growth. Pressing it
sprouted a fixed node regardless of where the player pointed, which node types
the plant's genes allow, or whether the plant could afford it. It bypassed the
biomass/energy economy and made the plant feel like a cursor instead of a body.

**Decision.** Remove the `G` quick-grow action. Growth is always:

1. **Select** an existing node or growing tip on the player's own plant.
2. **Choose a node type** from the types currently available to that plant
   (leaf, stem, branch, trunk, flower, spore sac, root, and future types).
   The option list is constrained by the plant's genes and the selected parent.
3. **Read the numbers** — energy cost, biomass gain, expected time, and a plain
   reason when the choice is not available.
4. **Commit.** The server validates parent, direction, type, gene availability,
   energy cost, and bounds before starting growth.

There is no generic "sprout" action and no client-side shortcut.

**Consequences.** The client needs selection, aim/preview, and node-type menu
UI. `GROWTH_INTENT` carries parent node, direction, and node type. The server
rejects unknown or gene-locked types and reports a plain reason. The C02b
renderer must show node-type variation. `G` is freed for the emote wheel only.
Design detail lives in `DESIGN.md` §17.6.1.

---

## ADR-019 — Biomass is mass; energy is the spendable growth currency

**Context.** Biomass was doing two jobs: it was the plant's body mass and also
the currency deleted when growing. That made growth feel like destroying the
plant to extend it, and left photosynthesis with no separate budget.

**Decision.** Split the two:

- **Biomass** is organism mass. It is the persistent body, shown as a total and
  a net rate. Growth *adds* biomass to the body.
- **Energy** is the spendable currency for growth and upkeep. Leaves produce it
  through photosynthesis using light, moisture, and minerals. Growth and upkeep
  consume it.

The player may direct growth. Undirected/autonomous growth (for example,
growing toward the sun) can be paused with a setting or a button so the plant
banks energy instead of spending it.

**Consequences.** State and HUD gain an energy value and rate alongside biomass.
`GROWTH_INTENT` costs energy and adds biomass rather than subtracting biomass.
Photosynthesis fills energy; upkeep drains it. The pause control is
server-authoritative and survives reconnect. Tunables live in
`config/growth.json` and `config/resources.json`.

---

## ADR-020 — Germination is player-triggered and resource-gated

**Context.** The server auto-germinated a plant about five seconds after spawn.
That contradicted the seed stage, removed the player's first decision, and made
"wait for rain" impossible.

**Decision.** The player chooses when to attempt germination. An attempt
succeeds only when the seed's local moisture **and** light are above the
configured thresholds; the server decides. A failed attempt can delay the seed
or kill it if the player commits in bad conditions — that failure is acceptable
and is part of the game. A player may deliberately delay germination to wait
for rain or better light.

**Consequences.** Remove the auto-germination timer. Add a `GERMINATE` intent
and server-side resource check with a plain failure reason. The seed persists
until a successful attempt or death. The first-spawn onboarding must explain
that germination is optional and gated by water and light. Config lives in
`config/growth.json` / `config/resources.json`.

---

## ADR-021 — Anonymous progress persists; reclaim by plant id

**Context.** Anonymous players could lose their plant on reconnect. Disconnect
recorded pending removal under `accountId ?? anon_<plantId>`, while reclaim
looked up `anon_<plantId>`; the anonymous `accountId` was actually the player
id, so the keys never matched and a new plant was created.

**Decision.** Anonymous play is persistent without an account. Reclaim is keyed
by the stable `plantId` (anonymous owner id), and the same key is used for
pending removal, reclaim, and `PLANT_SYNC`. A plant is not removed until the
reconnect window expires. Show a non-blocking recommendation to create an
account **at most once per day** so progress survives browser-data clearing.

**Consequences.** Unify removal/reclaim keying; send `PLANT_SYNC` with the full
node set on reclaim; keep the plant alive through the reconnect window. The
account prompt is rate-limited per UTC day, dismissible, and never blocks play.
Client storage holds the anonymous plant id/owner token.

---

## ADR-022 — Camera-only WASD; remove the cube avatar

**Context.** The T03P cube avatar survived into the plant build. WASD both
moved the cube and panned the camera, and the controls file bound the same keys
to two actions. RULE_1 says the camera is an independent entity and the player
is the plant.

**Decision.** Remove the cube avatar and all direct avatar movement. WASD and
arrow keys pan the camera only, as specified in DESIGN.md §17.4. WASD is reused
for reroot steering only while the plant is uprooted/tumbling, when camera
panning yields to that context action.

**Consequences.** Delete the cube mesh, state, and input path from the client.
Fix `config/controls.json` so one action owns each binding. Update the hint card
and manuals to say "WASD pans the camera." Any legacy server cube transport may
remain only as a test fixture and must not be rendered as the player.

---

## ADR-023 — Audit fix order: blockers, then C02b, then T05, then polish

**Context.** The 2026-11-06 audit found P0 state/transport/reconnect bugs, an
incomplete C02b slice, and unfinished T05, while CI was red.

**Decision.** Work in this order:

1. Fix P0 blockers (plant sync/germination, anonymous reclaim, resource update
   payload, growth interaction correctness).
2. Finish the C02b renderer gaps and its acceptance criteria.
3. Start T05 Communication.
4. Polish visuals and onboarding.

**Consequences.** T05 is not started until the blockers and C02b are done, even
though it is next in the DESIGN build order. `pnpm verify` must be green before
any of these are marked complete.

---

## ADR-024 — Resource updates are coordinate-addressed and client-local

**Context.** `RESOURCE_UPDATE` broadcast every tile in the 256×256 grid whenever
day/night or evaporation changed values. The payload was multiple megabytes per
client per second, exceeded the browser receive buffer, and was dropped. The
client also never sent its initial `RESOURCE_QUERY`.

**Decision.** Send only changed tiles, each carrying its own `tileX`/`tileZ`.
The client resolves tiles by coordinate, never by array index, and sends
`RESOURCE_QUERY` on connect for its own tile's initial light/moisture/minerals.
For the single-plant readout, prefer a per-client local-tile payload over the
full dirty set.

**Consequences.** Resource traffic scales with actual change and interest area,
not grid size. The client readout updates from the first frame. No index-based
tile assumptions remain in the client.

---

## ADR-025 — P0 growth and damage correctness rules

**Context.** The audit also found four logic errors independent of the new
growth UI: root overlap damage applied per tick at the configured per-second
rate, zero-biomass plants were not removed, `lateral_root` was not validated,
and tile moisture was read from a hardcoded value.

**Decision.** Damage rates are multiplied by `dt` so configured HP/s means
HP/s. A plant at zero biomass is removed through the normal death path.
`lateral_root` is a first-class validated node type. Moisture and light come
from the plant's local tile, never a constant.

**Consequences.** Root pressure and root attack no longer deal roughly 20× the
configured damage. Death occurs once, through the pipeline. Invalid node types
are rejected before growth starts. Resource-gated behaviour (photosynthesis,
germination, growth) reads real tile state.

---

## ADR-026 — Germination: attempt always allowed, success is gated

**Context.** The 2026-11-07 audit found that `attemptGerminate` ignored the
configured moisture/light thresholds and always sprouted the seed when energy
was sufficient. That removed both the "wait for rain" decision and the player's
ability to deliberately end a seed.

**Decision.** A living seed may be attempted at any time.

- **Success** requires local tile light ≥ `germination_min_light` **and** local
  tile moisture ≥ `germination_min_moisture`, plus enough energy.
- **Failure** is allowed and destroys the seed/plant when the player commits
  below either threshold. This is deliberate: a player may use it to kill a
  seed or plant they no longer want.
- Resource values crossing a threshold never germinate a seed by themselves.
  Only a player growth intent (or a future auto-growth toggle the player turned
  on) can trigger germination.
- The client shows both thresholds, the current tile values, the energy cost,
  and a plain warning before commit.

**Consequences.** Restore the hard thresholds in `config/growth.json`. A failed
attempt goes through the normal plant-removal/death path and broadcasts
`PLANT_REMOVED`. Auto-growth is opt-in only; default is off.

---

## ADR-027 — Camera-first scale and plant size classes

**Context.** The starting seed was radius `0.047` and the camera sat about 27
world units away. The plant was technically rendered but read as an empty scene,
and the click target was sub-pixel.

**Decision.** Keep the current small plant model as the **normal** size class.
Add **large** and **giant** classes by scaling that model, not by scaling the
world or its resources. Frame the camera close to the player plant on first
spawn and on recenter (about 6 world units). The camera remains an independent
entity and defines no plant state.

**Consequences.** Add camera start/recenter distance and pan speed to
`config/render.json`. Do not change resource tile sizes or growth distances to
make plants visible. LOD and the 10k-player target stay on the rendering path;
scale is a presentation concern.

---

## ADR-028 — Growth options are server-authoritative

**Context.** The client hardcoded the growth option list and costs, and those
numbers disagreed with `config/growth.json`. The client also collapsed node
types into four render buckets, so it offered actions the server rejected.

**Decision.** The client asks the server for the options at a selected node. The
server returns the allowed node types, energy cost, biomass gain, expected time,
availability, and a plain reason for anything unavailable. Germination options
also carry current and required light/moisture. The client renders the returned
list verbatim; it never invents a cost or a node type. Gene locks are enforced
server-side.

**Consequences.** Add a growth-options request/response pair to the protocol.
The growth panel opens after the response and shows a loading state. The server
is the only source of node availability and costs.

---

## ADR-029 — No implicit persistence; build a dev settings engine

**Context.** The player asked not to save persistence between page reloads or
server restarts. The previous plan (ADR-021) relied on implicit anonymous
reclaim and a reconnect window, which left ghost plants and made every reload
look like a state bug. The player instead wants a dev build / game-engine panel
that can toggle and edit every aspect of the game.

**Decision.** Default local/dev behaviour is **session-only**:

- Reloading the page or restarting the server creates a fresh plant.
- No `localStorage` plant reclaim, no cross-reload restore.
- When persistence is off, a disconnected anonymous plant is removed
  immediately and `PLANT_REMOVED` is broadcast; no ghost plants remain.
- Authenticated production persistence and the reconnect window remain
  available behind an explicit dev toggle.

Build a dev settings console (`?dev=1`) backed by a dev-only server endpoint.
It lists every config system and lets the operator edit values, toggle the key
game switches (persistence, auto-growth, germination gate, plant size class,
camera, resource rates, rendering), and reset to the checked-in defaults.

**Consequences.** This supersedes ADR-021 for the default local/dev path. The
once-per-day account prompt only applies when persistence is enabled. Add task
D01 for the dev engine and make persistence an explicit, visible switch instead
of an inferred behaviour.

---

## ADR-030 — Reactive non-sapient fauna are allowed

**Context.** The v5.4 feature request wants herbivores to react: flee, struggle,
fight, be trapped by vines, and be killed. RULE_2 previously read as if all
multiplayer animals had to be scripted ambient events. That conflated
"non-intelligent" with "non-reactive".

**Decision.** Multiplayer may contain persistent **reactive fauna** with needs,
senses, influence maps, and deterministic reflexes. They may vocalize with
animal sounds (growls, chirps, distress calls, warning cries, mating calls) but
may not use human words or language. They may not converse, pursue story goals,
exercise judgment, form factions, use tools strategically, or plan.
Conversation, story goals and judgment remain campaign-only (T32). Scripted
herbivore events (T06) remain ambient; T54 adds persistent fauna. RULE_2 and
RULE_19 are amended accordingly (approved 2026-11-09).

**Consequences.** T54 and C11 are added as approved tasks (not started). Fauna
can be trapped, injured and killed by plants; the python-vine interaction
becomes legal. Existing T06 herbivore events still work and can coexist with
T54 fauna.

---

## ADR-031 — No world resets; a calamity is a burial

**Context.** The season-end calamity was described as killing every plant. It
was easy to read that as a world wipe. The intended behaviour is persistence:
the planet and its history survive; the old generation is buried.

**Decision.** There are no world resets. A season-end calamity kills plants and
lays their traces under sediment. The planet is never regenerated from scratch
or restored to a blank state. O04 archive/restore is not a reset path. RULE_8
and T20 are clarified (approved 2026-11-09).

**Consequences.** Terrain, material history, fossils and player traces persist
across seasons. Tests must reject any "reset world" operation. New Worlds start
from a seed, but an existing World is never blanked.

---

## ADR-032 — The damage pipeline covers fauna targets

**Context.** RULE_22 defined one damage pipeline for damage to plants with four
sources. Plant-vs-fauna combat (vines trapping a herbivore) needs the reverse
direction.

**Decision.** The pipeline is target-agnostic. Plant damage keeps the four
sources (weather, roots, tools, herbivores). Fauna damage uses the same record
shape with sources plant, weather and fauna. Every record carries source,
target, amount and time. RULE_22 is amended (approved 2026-11-09).

**Consequences.** T06 owns the pipeline; T54 and T59 emit records through it.
No system may apply damage outside it. Kill credit and drops read the same
records.

---

## ADR-033 — Material simulation runs on a decoupled cadence

**Context.** A per-frame cellular automaton over every material cell would blow
the 20 Hz tick budget and the client bandwidth budget.

**Decision.** T55 stores material cells over the existing T00A grid and updates
them at a configurable cadence inside the T03 tick budget. Initial defaults are
2 Hz, 64 active chunks and ~10% of the tick budget. The gameplay tick stays at
20 Hz. Updates are deterministic, quantized, and delta-broadcast only to
interested clients.

**Consequences.** Water/sand/lava/fire move at simulation cadence, not render
cadence. The client interpolates visuals. The tick budget can delay material
work before Active gameplay work (Part 13.6).

---

## ADR-034 — Volumetric terrain is sparse binary chunks

**Context.** Overhangs, arches and caves need 3D terrain, but a dense voxel grid
and per-voxel database rows would be unaffordable.

**Decision.** T56 stores terrain as sparse 3D chunks with occupancy, material
and an iso-surface value. Chunks are persisted as binary snapshots plus an
event log, loaded by interest, and rendered with LOD. No per-voxel DB rows.
The first release commits to **full multi-layer/overhang terrain (approved
Option B)**: arches, caves above caves and stacked layers are in scope from the
start.

**Consequences.** The flat ground becomes the initial surface layer. Root
tunneling, erosion and parametric features edit chunks. C10 owns rendering.
Chunk count and active-chunk caps are config.

---

## ADR-035 — World-object behaviour is config-defined

**Context.** "Any object can carry and execute behavioural logic" could mean
uploaded scripts. That would break server authority, determinism and security.

**Decision.** T58 streams and persists server-owned objects, but behaviour is a
config-defined state machine/component graph. No uploaded code, no `eval`, no
client scripts. Interaction hooks route to the owning system (T01, T06, T54).
The boundary is confirmed as **config-defined state machines only (approved
Option A)**; there is no sandboxed plugin model.

**Consequences.** New object types are data, not code. A plugin model would need
a separate ADR, security review and determinism plan. Config-only behaviour is
the more secure choice because no code execution path exists at all.

---

## ADR-036 — Cloud scale is many single-process Worlds

**Context.** "Cloud-native" could imply microservices, queues and per-request
compute. The existing architecture is one World = one process + one Postgres,
with many Worlds as the scale path.

**Decision.** Keep many single-process Worlds and a global account/routing
service. The first release runs **many Worlds per host (approved Option A)**;
per-World on-demand allocation is a later step behind the same routing contract.
No Redis, queue or microservice by default; an exception needs an ADR and a
measured reason. On-demand allocation is an ops concern, not a gameplay system.

**Consequences.** O04 is scheduled only when a second World is actually needed.
Client routing and account identity stay global. A World failure is isolated.
Moving to on-demand allocation later does not require a client rewrite.

---

## ADR-037 — Ecological succession has guaranteed recovery

**Context.** Player actions (mining, root tunneling, fire, over-grazing) can
degrade land. The design wants consequences without irreversible collapse.

**Decision.** T59 implements succession stages and recovery pulses. Degraded
land recovers **naturally, in real-time days, with weather as a modifier**:
wet and mild weather accelerates recovery; drought, fire and repeated
disturbance delay it. Recovery is guaranteed within a configured maximum time.
Fire, lava, flood and over-grazing reset stages locally. There is no
irreversible ecological collapse. Recovery is slow enough to matter; it is not
instant.

**Consequences.** Mining tailings flow, fill pits, become soil and grow grass.
Forests regrow. T20 deep time and T39 climate memory can accelerate or delay
recovery. All thresholds and rates are config.

---

## ADR-038 — Seeded deterministic RNG for rendering and simulation

**Context.** The plant renderer used `Math.random()` for leaf tilt, branch
curvature, and foliage placement. This caused non-deterministic visuals:
rebuilds produced different shapes, two clients saw different plants, and bugs
could not be replayed. The growth simulation also had no seeded randomness for
offline catch-up or procedural variation.

**Decision.** Add seeded RNG to `@plant-legacy/shared/math`:
- `hash32(str)` — FNV-1a 32-bit hash for deterministic string hashing
- `hash01(id, salt)` — returns deterministic `[0, 1)` float from string ID + salt
- `mulberry32(seed)` — fast seedable PRNG returning `[0, 1)` floats

Replace all `Math.random()` in rendering with `hash01(nodeId, 'salt')` where
`salt` identifies the variation domain (`'bend'`, `'leafNormalX'`, etc.). Use
`mulberry32(worldSeed)` for simulation noise (weather, resource variation) so
sequences are reproducible from a known seed.

**Consequences.** Plant appearance is now deterministic per node ID — same plant
looks identical on every client and every rebuild. Bugs in growth/rendering are
reproducible. No `Math.random()` remains in shared/server/client source outside
tests. Future procedural systems (terrain, fauna) use the same primitives.

---

## ADR-039 — Versioned plant snapshot envelope with CRC32

**Context.** The original binary snapshot format had no magic bytes, version,
length, or checksum. It used a fixed-size estimate (1024 + 71 bytes/node) that
overflowed with real UUID node IDs (≈250 bytes/node). `age` was written as
`BigInt` which would crash on fractional ages. The `event_log` column was
always written as `'[]'` and never read. A single save failure in the periodic
loop stopped all subsequent plants.

**Decision.** Define a versioned envelope:
```
[magic: u32 = 0x504c4e54 ('PLNT')]
[version: u16 = 1]
[payload_length: u32]
[crc32: u32]
[payload: bytes...]
```

Use a `GrowableBuffer` that doubles capacity as needed (no fixed estimate).
Write `age` as `float64`. Persist `event_log` as JSON per save. Wrap each
plant's save in its own try/catch so one failure doesn't block others.

**Consequences.** Snapshots are self-describing and corruption-resistant.
Round-trip tests cover 1/10/100/2000 nodes, UUID IDs, corruption detection,
fractional ages. Format changes bump the version; old snapshots can be migrated
by a deserializer that switches on version.

---

## ADR-040 — Auth hardening: rotation order, atomic limits, JWT secret, lockout, pool logging

**Context.** The initial T08C implementation had several security/robustness
gaps:
- Refresh rotation revoked the old token *before* inserting the new one, leaving
  a window where a stolen token could be reused.
- Rate limiting used `DELETE → SELECT → INSERT/UPDATE` without a unique
  constraint, allowing race conditions.
- JWT secret fell back to a hardcoded dev value even in production.
- Lockout didn't count failed attempts *during* lockout, so attackers could
  spam without extending the lock.
- `pg.Pool` error events were silently ignored (`on('error', () => undefined)`).

**Decision.**
1. **Rotation order**: Insert new session → revoke old session (same transaction).
2. **Atomic rate limits**: CTE with `DELETE` old windows + `INSERT ... ON CONFLICT
   (ip, endpoint) DO UPDATE` (requires migration 004 unique constraint).
3. **JWT secret**: Throw in production if `JWT_SECRET` unset; warn in dev.
4. **Lockout extension**: Failed attempts during lockout increment counter and
   extend `locked_until`.
5. **Pool logging**: `DatabaseProbe` accepts optional `Logger`; pool errors
   logged at `error` level instead of swallowed.

**Consequences.** Auth is now robust against token reuse, rate-limit races, and
misconfiguration. Pool errors are visible in logs. Lockout is a real deterrent.
All changes are backward-compatible (new migrations, no protocol change).

**Update (2026-11-12).** Passwords are hashed with Argon2id
(`@node-rs/argon2`, tuned by `argon2_memory_kib` / `argon2_time_cost` /
`argon2_parallelism`). `bcryptjs` remains a dependency only to verify legacy
`$2*` rows, which are rehashed to Argon2id on the next successful login. The
bcrypt references above describe the state when this record was written.

---

## ADR-041 — The unified renderer waits for volumetric terrain

**Context.** DESIGN C02 specifies a *transparent WebGPU canvas layered over the
Three.js environment*. That split cannot share depth, so a plant is never
occluded by nearby relief, and light shafts and water refraction cannot read
plant depth. A proposal (`PlantLegacy-Abyssal-Integration-Plan.md` §4.3) called
this split a defect and described a single-frame renderer as already locked by
DESIGN. It is not: C02 is the locked spec.

**Decision.** The split canvas stays. A unified single-API frame is a
**proposed reversal**, deferred until T56 gives the world geometry tall enough
to occlude a plant. Unification is the gate for shipping caves, arches and sea — not a Wave 0
task.

**Consequences.** C02 keeps its authority and no C02 amendment is needed yet.
Shafts and water are built for the WebGL environment pass first. When T56 lands,
the unification work needs its own ADR and a C02 amendment, plus a WebGL2
fallback that is complete enough to play.

---

## ADR-042 — L2 is an ellipsoid SDF; the L3 atlas is colour-only

**Context.** DESIGN contradicted itself. C02 says the distant plant is a single
analytic ellipsoid SDF with "no billboards, no atlas generation"; 14.2.1 budgeted
~170 MB of multi-view atlases; 14.2.6 required impostors baked as
albedo/normal/emission. The shipped renderer followed the atlas. At three
surfaces per view the atlas costs ~504 MB — more than the 800 MB render budget.

**Decision.** Tier L2 (12–80 px) is a single ellipsoid SDF per plant: no VRAM
beyond the plant header. Tier L3 (2–12 px) is a colour-only atlas billboard at
~37 MB for 9k plants, rebaked only on shape change under a per-frame cap. Below
~2 px a plant is a coloured point. Part 14.2.0 owns tier numbering.

**Consequences.** The 170 MB and 504 MB figures are recorded as superseded in
14.2.1. `docs/partitioning-lod.md` and the plan point at Part 14.2.0 instead of
restating tiers. The shipped billboard path becomes L3-only; L2 needs
`impostor.wgsl`. Plants relight correctly at any time of day with no popping,
at the cost of 3–5× the arithmetic of a texture fetch in a screen band bounded
by the far field.

---

## ADR-043 — Volumetric terrain's first slice is one authored region

**Context.** v5.4 approval 10 accepts full multi-layer terrain (Option B) from
the first release. The plan proposed planet-wide 3D generation across ~30.7 M
surface columns at once. Abyssal Garden's achievement came from one 384 m box,
not a planet.

**Decision.** Keep 3D terrain. The first slice is a single authored region around
spawn (a handful of chunks), proving surface nets, welding, materials,
revisioning, collision and persistence on real gameplay before planet-wide
generation is attempted. T25's height field and its persisted deltas remain the
surface truth underneath during the slice.

**Consequences.** Streaming becomes a later, separable problem. AL-08 acceptance
is scoped to the region, not the planet. The migration path from T25 deltas is
still required and still owned by AL-08.

---

## ADR-044 — A calamity is a burial; dead biomass becomes organic matter

**Context.** RULE_8 (clarified 2026-11-09) says a season-end calamity is a burial,
not a wipe, and that the planet is never returned to a blank state. The shipped
tick kills every plant and the next season starts from bare soil, so the bodies
of a whole world's flora vanish. T59 already specifies dead matter → organic
matter → soil minerals; there was no field to put it in.

**Decision.** The death pipeline converts structural biomass into an
**organic-matter soil field** at the plant's position. Terrain edits, tunnels and
voids persist as they already do. The planet is never regenerated. Organic matter
is a soil/environment field, **not** a fourth player resource — T00A's light,
moisture and minerals are unchanged.

**Consequences.** The current bare-soil calamity is recorded in
`what-works-now.md` as a known divergence, not a design change. The existing
single death queue is the hook. `season_length_days` stays owned by `world.json`
(and `world_state` persists the countdown); `deep_time.json` owns only
transformations.

---

## ADR-045 — Water ships in two slices

**Context.** `config/water.json` is a stub with no T31 spec. The plan proposed a
full sea — global sea level, salinity, pressure, coastal and deep-ocean biomes,
underwater plants, caustics — which is a new habitat, not an extension of one.
An oceanless planet also undercuts the planet-scale fantasy and the existing
Orbit Planet view.

**Decision.** First slice: lakes, rivers and rain-filled pools — water volume,
surface rendering, buoyancy, shoreline blend, fed by T25 basins and T07 rain.
Second slice, after caves and fauna: global ocean, salinity, pressure, depth
biomes and underwater plant traits.

**Consequences.** AL-09 splits. The dug-channel moment ("water flows into a
channel you dug", living-world acceptance) lands in slice one. Deep-water
tolerance traits wait for the second slice and for AL-17.

---

## ADR-046 — Full trait model; chemosynthesis is a tunable, not a cap

**Context.** No mutation or trait system exists; T04/T24 are config stubs. The
plan's habitat matrix depends on traits everywhere but no work package owned
building them. Light is the game's central scarcity, and chemosynthesis is a
second income channel that could make the sun optional.

**Decision.** Build the full general trait model (`kind: tolerance | metabolism |
structure | attachment | reproduction | defense`) with all five metabolisms —
photosynthesis, chemosynthesis, saprotrophy, parasitism, symbiosis — on equal
footing, all through the existing biomass/energy pipeline. Chemosynthesis rate
is a config tunable `chemosynthesis_ratio` (default 1.0 = parity with
photosynthesis, range 0–2), not a hard-coded cap.

**Consequences.** A new work package (AL-17) owns the trait and mutation rules
before any habitat consumes them. T09/T10 are required for the attachment half.
The light economy stays adjustable by config if cave flora out-competes canopy
flora; the balance risk is recorded rather than designed around.

---

## ADR-047 — Reactive fauna ships before volumetric terrain

**Context.** T54 is the only v5.4 system that needs no 3D terrain, water,
materials or traits — v5.4's own dependency note says it needs only T01, T03,
T06 and T07, all built. The plan filed it in Wave 3 behind AL-07/AL-08 anyway.

**Decision.** T54/C11 moves ahead of volumetric terrain.

**Consequences.** Fauna ships on the existing height field with the existing
damage pipeline (RULE_22 is already target-agnostic). Cave fauna later becomes a
spawn-table and habitat change rather than a new system. AL-11 no longer depends
on AL-08.

---

## ADR-048 — Measurement precedes visible polish

**Context.** `QualityController` scales pixel ratio from CPU fps and triangles.
At 60 Hz vsync that cannot detect headroom. There are no fixed visual poses and
no benchmark, so "is this better?" has no baseline.

**Decision.** Full AL-01 (benchmark, six fixed poses, GPU timing, zero-alloc
audit) then AL-03 (GPU-band controller) before atmosphere, audio or scatter
polish.

**Consequences.** 5–7 weeks of infrastructure before a visible change. Every
later visual and performance claim has a repeatable baseline. Atmosphere follows
immediately in Wave 0 and is expected to be the largest visible gain.

---

## ADR-049 — Documentation is two documents with reference-only discipline

**Context.** Four documents described terrain, tiers and config counts, and they
disagreed. `DESIGN.md` contradicted itself on impostors and used three tier
schemes. Merging everything would put week estimates into the document read most
often and mix a living spec with dated approval records.

**Decision.** `DESIGN.md` owns rules and task specs. The Abyssal integration plan
stays a programme document but **never restates a spec or a config value** — it
references the owner. Decisions become ADRs here. The AG technique catalogue
lives in `docs/abyssal-mechanisms.md`. `docs/tunables.md` owns the config file
count; other documents link rather than quote a number. The standalone v5.4 approval record was folded into
`docs/PlantLegacy-Abyssal-Integration-Plan.md` §0.3 on 2026-11-14, after its
77-file count was corrected to 78 with a pointer to `docs/tunables.md`. No
decision in it was altered.

**Consequences.** Adding a fact means choosing one owner and linking the rest.
The failure mode to watch is duplication, not file count: a single document that
restates config values drifts exactly as fast as four documents do.

---

## ADR-050 — Gameplay before measurement (amends ADR-048)

**Context.** ADR-048 put AL-01 (benchmark, six fixed poses, GPU timing,
zero-allocation audit) and AL-03 (GPU-band quality controller) ahead of all
visible work. DESIGN's Gate 1 order puts T04 Mutation (W17) and T06 damage
(W18–19) next. The two orders cannot both be first.

**Decision.** T04 then T06 ship first. AL-01 and AL-03 keep their content but
move behind the Gate 1 gameplay loop.

**Consequences.** Renderer changes for T04 are judged by eye until the benchmark
exists: there is no GPU baseline for the twelve mutation signatures. Resume
AL-01 as soon as T06 is accepted, and treat its benchmark as the baseline for
every later visual change. This is the one cost ADR-048 was protecting against,
accepted deliberately rather than overlooked.

---

## ADR-051 — Roots take resources; they do not deal damage

**Context.** INV-TM-06 (2026-11-13) deleted root-overlap pressure damage and
root attack because roots must be able to touch for symbiosis and grafting. The
T01 spec, `what-works-now.md` and the dependency matrix still described root
attack as live, and T06 was specified to depend on it.

**Decision.** Competition is resource theft: root nodes in the same tile contest
that tile's water and minerals, and a directed root press takes a larger share
of the contested supply. No root contact deals HP damage. Real damage comes only
from physical or environmental means: weather, scripted fauna, terrain collapse
and debris (T06 MVP).

**Consequences.** The T06 damage pipeline has no plant-vs-plant source and no
griefing vector. Roots still matter, because supply is finite and debited. A
later player-initiated physical damage action needs its own task and its own
ADR; it cannot be reintroduced as "root attack".

---

## ADR-052 — Uproot has a cause, never a dice roll

**Context.** T06 specifies uprooting by structural damage, weather or prolonged
starvation, and a reroot window with a desperation buff. An uproot that fires on
a random roll, or on ordinary rain, reads as the game misbehaving.

**Decision.** Uproot triggers only on events the player could have seen coming:
soil saturation after sustained rain, a storm gust above a configured threshold,
or a collapse under the root plate. Ordinary rain does not uproot, and a seed
that has not germinated has no root plate to tear free, so it cannot be
uprooted at all. There is no
desperation buff; recovery is its own reward. A plant that fails to reroot dies
of resource starvation, not of a separate scripted timer.

**Consequences.** T06 depends on saturation, gust and collapse signals rather
than on water volumes (ADR-045 slice one is not a prerequisite). Floating-point
buff machinery is not built. `uproot.json` owns the thresholds.

---

## ADR-053 — Mutations are chance plus legible pressure

**Context.** T04 weights the mutation pool by adaptive pressure, with no player
choice at the moment of a trigger. Chance without feedback is indistinguishable
from noise.

**Decision.** Acquisition stays a chance roll on a completed growth event,
weighted by adaptive pressure. Every plant also gets a pressure readout: the
eight growth categories and how much recent investment each holds. Maintenance
drains energy, then biomass, and biomass stops at `upkeep_biomass_floor`: an
unpaid bill stalls the plant and never removes a mutation or kills it. Dropping
a mutation is the owner's decision (`MUTATION_SHED`).

**Consequences.** Players can see which playstyle is steering their odds without
being told what to grow. The readout is presentational only; the server never
lets a client set pressure. PLNT snapshots move to v2 and the protocol to v2.

---

## ADR-054 — Twelve visual signatures, carried as an index

**Context.** The packed vertex word gave mutation visuals three spare bits, so
only three signatures (bioluminescent, thick bark, variegated) could be drawn.
DESIGN C02 specifies twelve.

**Decision.** Twelve signatures ship now. The packed word carries a four-bit
*signature index* (0 = none, 1..12), not a bitmask: a node shows one signature,
chosen as the plant's strongest, because twelve flags do not fit and an OR of
them has no visual meaning.

**Consequences.** Every packed-word consumer (mesh builder, mesh and billboard
WGSL) reads bits 28–31 as an index. The WebGL SDF path draws one organism, so it
maps the plant's signature onto its existing three mutation uniforms at lower
fidelity; the mesh and billboard tiers are the full-fidelity path. Adding a
thirteenth signature needs a wider word or a second parameter channel.

---

## ADR-055 — Damage is biomass loss; "HP" is structural mass

**Context.** T06 speaks of an uproot threshold in HP (1–10,000) while the plant
already models structural biomass as the sum of its parts. A separate HP pool
would be a second source of truth that has to be healed, saved and reconciled
with tissue mass.

**Decision.** Damage removes biomass from a part, and a plant's effective HP is
its structural biomass. `uproot.damage_threshold_hp` is the ceiling for the
accumulated unhealed damage that tears the root plate free, capped at 80% of the
plant's own mass so a small plant is still uprootable. Damage memory decays at
`damage.damage_memory_decay_per_s`; it is not healed by regrowth.

**Consequences.** Health stays derived (shared `plantHealth`), snapshots stay
small (one accumulated number), and no healing mechanic is implied. A future
healing or armour system needs its own task and must convert to this same
biomass currency rather than adding an HP bar beside it.

---

## ADR-056 — Drops are world objects until T51

**Context.** T06 must drop fragments, remains and dung, but T08A's inventory is
in-memory scaffolding that DESIGN forbids as the economy, and T51 owns fragment
item rules, pickup and provenance.

**Decision.** T06 spawns drops as world objects with an id, kind, position and
expiry, broadcasts their appearance and removal, and leaves collection and item
semantics to T08A/T51. The drop tuning (chance, counts, lifetimes) lives in
`damage.json`; `fragments.json` stays T51's.

**Consequences.** T06 has no inventory dependency and cannot corrupt the future
economy. Fragments decay on the ground until T51 binds them to inventory rows,
so a fragment left alone today is lost rather than banked.

---

## ADR-057 — A size mutation is tissue, and losing it wilts

**Context.** Size mutations started as a shader scale: the renderer multiplied a
node's radius by 1.25 while its biomass stayed the same. That made the drawn body
lie about the plant (a bigger plant with no more mass), and it made shedding
wrong in one of two ways: snapping the radius back on the same tick, or leaving a
body that no longer matched any tissue. "Bigger plants contain more biomass" was
not true of the simulation.

**Decision.** A linear size factor `m` multiplies a part's tissue quota by `m³`,
because radius follows `cuberoot(mass / nominal)`. A 1.25× form therefore holds
1.95× the mass and is drawn 1.25× as wide with no radius scaling anywhere:
`nodeRenderRadius` turns the part's own biomass into metres, exactly as it does
for damage, drought and repair. Gaining a size mutation fills tissue up to the new
quota (only in parts already at their base quota, so a reload cannot heal damage);
shedding one does not. An over-quota body loses `oversize_wilt_per_s` of its
excess per second, each part thinning as its own mass falls, and stored water,
minerals and energy above capacity leak at `oversize_leak_per_s`. Both live in
`config/mutations.json` and apply to the active and dormant paths.

**Consequences.** Shedding a size mutation is a real loss that plays out over
minutes instead of a visual snap, and a levelled size mutation is a real gain in
mass, capacity and upkeep. `q³` is harsh (a 25% form is nearly double the mass),
which is why the wilt and leak rates are config, not code. A part's radius ceiling
widens only with the largest form it was built under, so a shed never shrinks the
body in one step.

---

## ADR-058 — Mutation levels are bought with stored resources and chosen as cards

**Context.** Acquisition is a chance roll (ADR-053). A roll-only system means the
player never directs a mutation they already hold, and there was no way to invest
in one that fits their plan.

**Decision.** Every held mutation has a level, starting at 1. Raising it is a
player action (`MUTATION_LEVEL`): it costs stored energy and biomass
(`level_up` in `config/mutations.json`) and the player picks one card per
level from the cards **that mutation** can grow into. A card is one of the
mutation's own multiplier effects (a size mutation deals "Larger form", a root
mutation "Deeper roots", and every mutation deals "Leaner metabolism"), and each
card multiplies that effect by its configured step, so levels compound through the
same effect accumulation the base mutation uses. Upkeep climbs
`upkeep_per_level` per level. The server deals the cards and validates the pick, so
a client can only take a card it was shown. Levels and the cards taken persist in
PLNT v4 (v2/v3 saves load as level 1).

**Consequences.** Random still decides *which* mutations appear; the player decides
what a mutation becomes and how far it goes. The card pool is config, so a new
mutation needs no code to be levellable, and its upgrades can never promise an
effect the simulation does not read.

---

## ADR-059 — Mutation appearance is config, composed per organ

**Context.** The renderers carried a hardcoded table of twelve "visual signatures"
and a four-bit index in the vertex word. A plant drew exactly one signature, the
highest index, so a second mutation never appeared; several mutations shared an
index on purpose (`deep_taproot`, `mineral_hoard`, `symbiotic_nodules` and
`spined_epidermis` were all `12`), which made a mutation's name and its look
unrelated; tints multiplied unclamped and blew channels out; and the look table
itself lived in client code, against RULE_3.

**Decision.** Appearance is data (`config/mutation_visuals.json`, served at
`/config/mutation_visuals`) and it is composed, not selected.

1. **One style per mutation id**: an organ family (`foliage`, `woody`, `seed`,
   `bloom`, `whole`), a procedural pattern (`mottle`, `spots`, `stripes`, `veins`,
   `sheen`, `glow`), a tint and its strength, a variegation colour and amount, a
   glow colour and amount, bark thickness and darkening, and a thorn density. The
   ordinal in declaration order is what ships as `visualSignature`, so the wire
   shape is unchanged and a rival plant can still be painted from a bare integer.
2. **Composition**: every held mutation contributes to every organ family it
   targets. Tints multiply as `mix(1, tint, strength)` and clamp into
   `caps.min_tint..caps.max_tint`; variegation and darkening stack as
   `1 - product(1 - v)`; glow sums; bark excess adds; thorns take the maximum.
   Each has a ceiling in `caps`, and levels amplify a style by
   `caps.level_visual_gain` per level above the first.
3. **Geometry follows the name**: `bark_thickness` scales tube radii in both mesh
   builders, `spines` emits thorn tubes/protrusions, and the two shape mutations
   also carry growth biases (`vertical_bias`, `drooping_bias`) applied in
   `applyMutationShapeBias` before the gene clamp, so a columnar habit really
   grows upright and drooping fronds really hang.
4. **The renderers only paint**: the WebGPU pass reads one composed record per
   plant and per organ family from a storage buffer (`LookOrgan`/`PlantLook` in
   `common.wgsl`); the Three.js mesh pass composes per organ in JS and builds
   material variants from the result; the SDF fallback paints one organism from
   the foliage composite. No shader knows what any mutation is called.

**Consequences.** A plant can show several mutations at once, each on the organs
its name implies. Adding a mutation or restyling one is a config edit with no
renderer change, and the config test rejects a style that would look exactly like
another mutation. The four-bit index survives only for the packed vertex word the
billboard tiers use, and it reports "none" rather than a truncated (wrong) ordinal
when a style's ordinal does not fit. Per-node painting (a mutation that affects
only one part) is still not modelled: styles are plant-wide per organ family.

## ADR-060 — The player's body has one anchor, and the soil is cut on both faces

**Context.** Space (recentre) and Root Sight both need to know where the player's
plant *is*. Both answered it with "the first parentless node in the mirror" and
framed every node flagged `isOwnPlant`. That is map iteration order, not the
plant: after an uproot the body is streamed node by node, a reconnect can leave a
node from the previous session, and the reroot handler captured the authoritative
final positions into the interpolator and then dropped every segment in the same
message. The result was a camera and a cavity that pointed at where the plant had
been. Separately, the soil is a double-sided skin but only its front face was
cut, so the cavity was visible from outside and from above and invisible from
inside the earth.

**Decision.**
1. **One anchor.** `player/ownPlantAnchor.ts` resolves the body as the server's
   `rootNodeId` node, else a seed, else any parentless node, else the crown
   position the server repeats on every uproot message. Root Sight's context and
   Space both use it; `ownBodyNodes()` filters the mirror by the plant tag so a
   leftover node cannot stretch the framing. A reroot lands the body on the final
   streamed pose (not into a tween that is then discarded) and asks for one
   resync, because a settled body is a new authoritative frame.
2. **The aperture is cut on both faces.** The soil is `THREE.DoubleSide`; the cut
   applies to front and back faces. The earthen lip remains a surface-only
   shading effect and is faded out with the eye underground — that, not the
   front-face gate, is what kept the bright ring out of the underground view.

**Consequences.** A crawl moves the body, the camera and the cavity together, and
Root Sight can be used from inside the ground as well as from above. Anything
that needs "the player" now has one function to call instead of its own filter.

## ADR-061 — A quote is a charge, and a child starts where the server put it

**Context.** Two growth-menu complaints had the same shape: the UI and the rules
disagreed about the same thing, and the disagreement was invisible until the
player acted.

- The cards were built from `computeGrowthCostQuote` alone, while `tryGrow`
  multiplied that by the soil's resistance (up to ~1.75× in deep compacted dirt)
  and by the mutation growth-cost multiplier, and divided the time by the growth
  speed multiplier. A root card said "6 energy"; the server wanted 11 and refused
  with `insufficient_energy`, next to a `Grow` button that had been enabled.
- The WebGPU mesh pass recomputed where a child of a *seed* leaves its parent,
  instead of using the attach point the server shipped. The CPU path used the
  shipped point. So the same plant was drawn with two different skeletons: a stem
  started at the seed's coat surface in one and at the server's attach in the
  other, and its branches — placed at a fraction of the *server's* segment — hung
  three centimetres below the drawn stem, in the air.

**Decision.**

1. **One charge scale.** `growthChargeScale(plant, node, targetLayer)` is the only
   place resistance and mutation cost/speed are combined. `tryGrow` charges with
   it; `buildGrowthOptions` quotes with it (`scaleGrowthQuote`, which rounds
   energy *up*, so a card can only be pessimistic). The scale is measured at the
   part the growth leaves from — the menu cannot know the direction, and the soil
   around the parent is what the resistance is about.
2. **The server's attach point is the drawn start.** Any renderer starts a child's
   tube at `parentAttach*` (the point `placeSegment` used), for seed and non-seed
   parents alike; `nodeAttachmentPoint` is only the fallback for payloads that
   predate the field. `renderers/webgpu/nodeAttachment.test.ts` measures a real
   grown seedling and asserts every child starts on or inside its parent's drawn
   body.

**Consequences.** A enabled `Grow` button now implies the server will take the
growth at the quoted price. Growth geometry has one skeleton, so a joint cannot
be stitched in one renderer and float in another. Anything that re-derives a
placement or a price must go through these two functions instead of copying the
formula.

## ADR-062 — Water is a medium, not only a surface

**Context.** Water was drawn as surfaces — a rain sheet, the river, the water
table — with a careful shader for looking *at* them. Nothing happened when the
camera went *into* one: same sky, same horizon fog, same sun, and the sheet seen
from below was shaded with its top-side model, so it read as a flat lid of sky.
"Underwater is identical to above water" was the literal truth of the code.

**Decision.** Being in water is a first-class state, computed from the same data
the meshes are built from.

1. `WaterField.waterSurfacesAt(x, z)` reports every drawn surface over a point
   (puddle sheet, river, water table), so the eye asks the water field what it is
   under instead of a second, drifting model.
2. `renderers/environment/underwater.ts` turns that into depth, Beer–Lambert
   transmission `exp(-depth · k)`, a 0..1 tint amount, tightened fog and a dimmed
   beam. Immersion starts at `minDepthM` (6 cm): a damp ankle stays air.
3. `EnvironmentRenderer` adopts the state each frame and applies it to the fog
   (scaled, tinted with the water's own deep colour) and the sun. The water shader
   shades its underside as Snell's window: a bright, rippling opening within
   ~48.6° of vertical and self-reflection outside it.
4. **The colours are data.** `water_deep_color`, `water_shallow_color` and
   `water_sky_color` in `config/water.json` paint every water material in one
   pass (`paintWater`), and the underwater tint reads the same deep colour, so the
   sheet, the river, the table and the medium cannot drift apart (W3).

**Consequences.** The view now changes the moment the eye crosses a water surface,
and the tint, fog and light all come from the same depth, so a shallow dive and a
deep one differ the way real water does. The surfaces themselves are untouched:
this adds a medium, it does not move the water. A camera cannot yet *swim*
(W2 in the bug inventory): river depth and sheet depth are centimetres, so
immersion currently needs burrowing, the underground table, or a dev flood.

## ADR-063 — A part is drawn where it is, and a plant is a stack of internodes

**Context.** Three separate reports described the same illusion: the growth gizmo
landing on a stem the player had not selected, gallery plants that looked like
disconnected tentacles, and every plant in the gallery looking alike.

The gizmo anchored on `node.position`, which is where a node *will* be when it
finishes growing; the renderer draws it at `parentAttach + (target − parentAttach)
× progress`. On a part that had just started those differ by a whole segment, and
on a plant with more than one branch that segment is where the neighbouring stem
is drawn. The gallery's failures were the same kind of mistake in the payloads:
`PLANT_CREATED` (how every rival plant arrives) carried positions but not
`parentAttach*`, `target*`, `attachFraction` or `radius`, and no payload carried
`attachFraction` at all, so the renderer recomputed joints the server had already
decided. And a `stem` could not grow another stem, so no unmutated plant could be
taller than one 35 cm internode: every body was a fan of branches off a stump.

**Decision.**

1. **One answer for "where is this part drawn right now."**
   `resolveDrawnNodePosition` already existed for picking; the gizmo anchor, the
   seed's body lift, the pick sphere and the drag hit test read it too, so the
   thing the player aims from is the thing they see. An attachment point is
   clamped to within one segment of the selected part, so a stale mirror cannot
   carry the ring elsewhere.
2. **Every node payload is a geometry payload.** Welcome, sync, growth event and
   plant-created all carry `parentAttach*`, `target*`, `attachFraction` and
   `radius`. A payload that claims to mirror WELCOME must actually do it.
3. **A stem continues into a stem.** An internode stack is how a plant gets tall;
   `trunk` and `culm` remain mutation-only upgrades of that column, not the only
   way to rise. `columnar_habit` and the gallery's "five-internode column" were
   describing something the rules did not allow.
4. **Variety is data, not luck.** The gallery grows each body from a seed derived
   from the mutation id, so the row is a range of heights, bearings and habits
   while the same mutation always produces the same plant.

**Consequences.** The gizmo is aimed at what is on screen. Plants can be grown
taller than a stump, which changes the growth menu (a stem now offers a stem) and
makes a mature body a real silhouette. The gallery is a row of different plants
rather than forty-five copies. Any new node payload must carry the same fields,
or the client will draw guessed joints again.

## ADR-064 — Root Sight is a volume the eye can be inside

**Context.** Root Sight was built as a hole you look *through*: a plan-view
aperture cut in the soil skin, an inverted bowl behind it, and a plant pass that
hid anything the planet sphere stood in front of. Two reports followed. Looking
at the cup wall from inside the dirt showed the wall and no roots; and a camera
flown down into the cavity saw a brown wall, because the eye was *inside* the
planet and every root was therefore "behind the earth".

**Decision.** The opening is a volume, and visibility follows it.

1. Above ground, a root is visible when it is inside the **aperture cylinder**,
   not a sphere around the crown. The soil is cut in plan view, so a root under
   the hole is exposed at any depth while a shallow root outside it stays buried.
2. When the eye is below the soil surface, the analytic surface test is skipped
   (`cameraUnderSoil`): dirt between a buried eye and a root is the medium the
   eye is standing in, not a wall.
3. A buried eye gets an **air bubble** fused into the same envelope as the root
   bubbles (`root_sight.eye_window_radius_m`, default 1.1 m), and the soil shader
   cuts the envelope — not just the aperture — while the eye is under the
   surface. The window is added only when the cavity is already open, so a buried
   camera cannot excavate ground the plant never dug.

**Consequences.** A camera can follow a root down and still see it, and the
cavity is a space rather than a picture. The eye window is bounded by
`max_burrow_depth_m`, and it is one more bubble in a 64-slot uniform array.true## ADR-065 — Inland water stops being geometry

**Status:** proposed 2026-11-17 (W6), not built.

**Context.** Four translucent surfaces draw water (rain sheet, water table, river
ribbon, ocean), and each new defect has been repaired by adding a rule that keeps
them from fighting: a depth bias, a near discard, a route clip mask, a lift, a
hysteresis threshold, and a client-side clamp of the server's own heights.

**Decision.** Reduce rather than reconcile. Delete the water table mesh; draw
inland water in the terrain shader from the streamed height (depth compare,
Beer-Lambert, flow streak, Fresnel sheen); keep puddles as wetness; keep the
ocean dome. Abyssal Garden's single-volume look is the reference for the shading,
not for the surface count.

**Consequences.** No translucent surface inland means no z-fighting, no clip
masks and no depth bias — and no specular reflection worth the name unless a
screen-space pass is added later. Groundwater stays as simulation data; only its
drawing goes away.
