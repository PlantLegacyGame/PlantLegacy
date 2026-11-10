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
