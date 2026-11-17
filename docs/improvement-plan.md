# Improvement plan (2026-11-15)

A director-requested pass over everything already implemented: correctness,
robustness, performance and playable feel. This is **not** a list of new
features. Each task is scoped small enough to finish and verify in one sitting,
and each ends with its own record or a section here.

**Status legend:** `[ ]` planned, `[~]` in progress, `[x]` done and verified.
**Ground rules:** RULE_3 (no hardcoded gameplay values), RULE_4 (server owns
state), RULE_20 (no rarity), RULE_23 (account-bound flags), one task at a time,
`pnpm verify` + `pnpm docs:check` green before a task is marked done.

## Open director decisions

1. **Order.** Default plan runs foundations (Wave 1) before the visible HUD
   (Wave 2). Say the word to pull C04 HUD forward.
2. **Postgres.** Is a local `DATABASE_URL` / compose stack available? T08A
   inventory and most auth verification cannot be proven without it.
3. **Wire compatibility.** Pre-alpha assumption: `PROTOCOL_VERSION` may be
   bumped and message cadence/shape changed. If old clients must keep working,
   Wave 1-B becomes additive only. *1-B turned out additive (new config key,
   fewer messages, no payload change), so no bump was needed.*

## Audit snapshot — verified 2026-11-15

These are current-code findings, not copied from the older audit. Several entries
in `state-machines-and-invariants.md` are stale and get corrected as their task
lands.

| Finding | Where | Impact |
|---|---|---|
| Three tick-rate declarations; `world.tick_rate_hz` is dead and `PlantWorld` uses `world.active_tick_rate_hz` while the clock uses `net_proto.tick_rate_hz` | `config/world.json`, `config/net_proto.json`, `main.ts` | A dev tick-rate change desyncs simulation from the clock; `INV-TM-01/03` — **fixed in 1-A** |
| `client_send_rate_hz` is loaded but was never used; `STATE`/`KEYFRAME` go to every player every tick and `WEATHER_UPDATE` is broadcast every tick | `net.ts`, `main.ts` | Bandwidth scales with players × 20/s; `INV-TM-09` — **fixed in 1-B** |
| Plant saves never pass an event log, and `world_events` is never written | `main.ts:saveAllPlants`, shutdown path | `event_log`/`world_events` are dead features; `INV-PR-07` — **fixed in 1-C** |
| **Not a gap:** plant loads are validated (`validatePlantGraph` in `PlantWorld.loadPlant`, with a tested shared validator) and periodic saves already skip while one is in flight | `plantWorld.ts`, `main.ts` | The older audit entries for these are stale |
| `config/network.json` duplicated the whole protocol block (`tick_rate_hz`, keyframe, bounds, quantization, rate limits) while the client read only two keys | `config/network.json` | A third, editable copy of the tick rate; **fixed in 1-A/1-D** (file reduced to the two client health thresholds) |
| Consumption triggers return config booleans as world state | `resourceWorld.checkConsumptionTriggers` | `tileMineralTrigger` is a threshold test, dung/fertilizer are constants; `INV-RS-12` |
| HTTP requests from disallowed origins are still processed; only CORS headers differ from WS close | `main.ts` request path | Cross-origin requests reach handlers; `INV-AU-12` |
| Access tokens are checked for signature/expiry only, not against a live account/session | `accounts/service.verifyAccessToken` | A deleted/locked account keeps a valid token until expiry; `INV-AU-03` |
| Client has no payload validation; every message is `as`-cast, and `MESSAGE_TYPE` is duplicated | `apps/client/src/main.ts` | Malformed/older server can crash or corrupt client state; `INV-NET-08/13` — **fixed**: one shared `MESSAGE_TYPE`, and `validateMessage` runs before the dispatch switch |
| Renderer has no interpolation between 20 Hz ticks; dormant plants look identical to online plants | C02/C02b client paths | Visible stepping and no offline cue — **positions fixed in 2-B**; dormant cue still open |
| T25 height deltas are not applied to the client ground texture | `terrainState.ts`, ground shader | Digging/collapse does not visibly sink the lit ground |
| T06 tumble integrates against a flat y=0 plane; crawl substrate multiplier is 1.0 | `damagePipeline.ts` | Falls ignore slopes; T02 substrate hook unbuilt |
| CI does not run `pnpm docs:check` or the production build in the verify gate | `.github/workflows/ci.yml` | Docs drift can merge; build is only checked locally — **fixed in 1-D** |

## Wave 1 — Foundations (correctness, no director input needed)

### 1-A One authoritative tick rate `[x]`
**Goal:** one rate for the clock, the wire and the active tier.
**Changes:** keep `net_proto.tick_rate_hz`; delete the dead
`world.tick_rate_hz` and `world.active_tick_rate_hz`; construct `PlantWorld` from
the net rate; `World.setTickRate` updates the tier machine too; replace the dev
"Active Hz" knob with the existing simulation tick-rate action.
**Acceptance:** changing the dev tick rate changes `PlantWorld.getTickRateHz()`
in the same call; no other config key declares a second tick rate.
**Verification:** unit test on `setTierRates`; `config:validate`; manual dev check.

### 1-B Broadcast budget `[~]`
**Goal:** honour `client_send_rate_hz` and remove per-tick broadcasts that do not
need them.
**Changes:** a banked-ms cadence (`broadcastCadence.ts`) gates STATE/KEYFRAME and
the root readout; `weather_send_rate_hz` (2) gates weather/day-night; keyframes
still send on their own interval; server counters are reported by
`dev_log_network`.
**Acceptance:** a live client receives STATE at the configured rate, weather at
2 Hz, and the debug overlay still updates; no gameplay regression.
**Verification:** `broadcastCadence.test.ts` (5); `pnpm verify` and `docs:check` green. **Live check blocked** — the game runs in the director's Chrome, which this agent cannot inspect.

### 1-C Event log and persistence truth `[x]`
**Goal:** either the saved event log means something or it stops claiming to.
**Changes:** `PlantEventLog` collects growth, damage, uproot, reroot and tier
changes; every save writes it; it is bounded by
`world.event_log_compaction_threshold`; boot reads `event_log` back and seeds
the in-memory log. Plant deaths append to `world_events` before the row is
deleted. `PlantWorld.loadPlant` already validated graphs, so no load changes.
**Acceptance:** a save carries the events produced since the previous save; the
compaction threshold bounds a long session; docs and schema agree.
**Verification:** `plantEventLog.test.ts` (7), persistence event-log tests (4),
load-rejection test (1); `pnpm verify` and `docs:check` green.

### 1-D Guardrails `[x]`
**Goal:** the plan cannot silently drift.
**Changes:** `pnpm docs:check` and `pnpm build` run in CI; the
`state-machines-and-invariants.md` entries touched by 1-A/1-B are reconciled;
this plan is linked from the README.
**Acceptance:** CI runs the same chain as `pnpm verify` plus docs and build.
**Verification:** read the workflow; run both locally.

### 1-E Review follow-ups (2026-11-16) `[~]`

The second review pass separated confirmed defects from hypotheses. Two were
fixed immediately because they were small and testable; the rest are scoped here.

**Fixed and verified**

- **Lightning polluted the ambient baseline.** A strike was added to the same
  `ambientLight.intensity` the day/night smoother lerps, so it was amplified and
  lingered; the flash scale was the literal `0.5` while
  `render.json:lightning_intensity_boost` was never read. `stepAmbientLighting`
  now owns the baseline and composes `baseline + flash`, and the dead
  `EnvironmentRenderer.lightningTimer` is gone.
  Test: `renderers/environment/celestial.test.ts`.
- **A reversed Root Sight transition reported the wrong direction.** The state
  was only stamped at progress 0/1, so re-opening during a close stayed
  `transitioning_to_surface` and `rootSightStateMachineIsEnabled` (underground
  view, root picking, camera floor) treated the opening cavity as closed.
  Direction is now derived from target + progress, and a closing cavity stays
  enabled until it is fully closed. Test: `RootSightStateMachine.test.ts`.

**Still open, in value order.** A later pass over the tree (2026-11-16) re-checked
every entry below and added the gate and documentation defects this list does not
carry; its execution order, with the evidence for each, is
[`bugfix-plan.md`](./bugfix-plan.md). This list stays as the value ranking.

- **A2 — underground detection uses absolute world Y.** Replace the five
  `camera.position.y < 0` / `target.y < 0` tests with one helper that compares
  against `planetTerrainY(...)`, the pattern `EnvironmentRenderer.update` already
  uses. Acceptance: on a 16 m rise, a camera 1 m under the soil is classified
  underground for the camera floor, spring-arm skip, root picking and
  `setUndergroundView`; on the flat spawn the same camera still is. Add a pure
  helper test with a stubbed terrain function; `main.ts` itself is not unit
  tested.
- **A8 — Root Sight presentation defaults are literals.** `main.ts` passes
  `{ radius: 50, soilOpacity: 0.3 }` while the file says 7 and 0.45. Build the
  uniforms from `config/root_sight.json` in the same place the machine is built,
  and remove the `50` / `radius * 0.7` fallbacks from
  `createRootSightUniforms`. Acceptance: changing `cutaway_radius` or
  `soil_opacity` in the file changes the first drawn frame, not only the values
  written by `updateRootSight`.
- **F9 — ambient smoothing is frame-rate dependent.** `stepAmbientLighting` takes
  `alpha`; pass `1 - exp(-dt / tau)` instead of a fixed 0.3 so the day/night fade
  takes the same wall-clock time at any frame rate. Test: stepping 1 s at 30 Hz
  and at 144 Hz lands within a small tolerance of the same baseline.
- **Docs drift (F5).** `docs/tasks/T02.md` quoted `cutaway_radius` 50/0.3;
  corrected to 7/0.45. The older entries for `controls.md` and `tunables.md`
  counts were stale and were removed from the inventory.
- **`docs:check` cannot catch a wrong statement.** It verifies links, config
  counts, the protocol table and duplicated prose; it does not compare a task
  document's quoted default with the config file. Add a source-backed check for
  `## Config: config/<file>.json` tables (key exists, quoted default equals
  `values[key].value`), then fix the drift it finds. This is the cheapest way to
  stop the T02 class of error returning.
- **F7 — dead protocol surface.** `[x]` `validateMovement` is deleted and
  `INPUT` is documented as an ack-only heartbeat in `docs/protocol.md` and
  `docs/controls.md`; nothing describes movement as server-enforced.

## Wave 2 — Playable feel (needs director eyes for visual sign-off)

### 2-A C04 HUD v1 + T06 controls `[~]`
**Goal:** the player can see and act on the systems already simulated.
**Changes:** a compact plant-status HUD (biomass and rate, rooted/uprooted/
tumbling/rerooting, structure against the uproot threshold, mutation bill,
day/weather/forecast); damage vignette and factual toast; reroot window and
camera-relative D-pad; WASD/arrow steering while uprooted; server sends
`structure` with STATE/KEYFRAME and structural damage with PLANT_DAMAGE.
**Acceptance:** a guest can grow, take weather damage, be uprooted, steer to soil
and reroot without opening the Dev Panel.
**Verification:** `PlantStatusHud.test.ts` (6); `pnpm verify`, `docs:check` and
`build` green. **In-browser pass blocked** by the Chrome access limitation.
**Still open:** context dock, rebinding screen, text-size slider, notification
log (recorded in `docs/tasks/C04.md`).

### 2-B Render interpolation and offline cue `[~]`
**Goal:** 20 Hz server state looks smooth; dormant plants read as dormant.
**Changes:** node positions the server streams between ticks (uproot, tumble)
now interpolate over one tick in `apps/client/src/render/PlantInterpolation.ts`,
starting from the currently drawn point so a late packet bends the path
instead of teleporting the body. Still **open:** the dormant/near visual cue,
and rotation interpolation once anything rotates.
**Acceptance:** panning shows no visible tick stepping; an offline plant is
distinguishable without a label.
**Verification:** `PlantInterpolation.test.ts` (6); director browser pass still
required; no change to server authority.

### 2-C Session UX and accessibility `[ ]`
**Goal:** no dead ends around connect, refresh, reconnect and failure.
**Changes:** loading/error states on the entry screen, reconnect countdown,
readable server error mapping, focus-visible and keyboard navigation for the
entry/chat/growth panels, `prefers-reduced-motion` for shakes/toasts.
**Acceptance:** every network failure produces a readable next action; keyboard
only path reaches sign-in/guest play.
**Verification:** director browser pass; component tests where the logic is pure.

## Wave 3 — World and renderer polish

### 3-A T25 client height application `[ ]`
Apply sparse terrain height deltas to the client ground (height texture or chunk
mesh update) so tunnels and collapses sink the lit ground. Depends on the
existing `TERRAIN_REGION`/`TERRAIN_EDITS` payloads.

### 3-B T06 physical polish `[ ]`
Terrain-conformed tumbling, T02 substrate multiplier for the crawl, landing
effects tied to existing impact damage. No new UI.

### 3-C Water/environment continuity `[~]`
Surface work is done and checked by tests (sheet/table/river separation, depth
bias, damp stain, one colour set from config). **Being in the water is in
(W1/W3, ADR-062):** immersion state, tinted shortened fog, dimmed sun, Snell's
window from below.

Remaining, in order of value:
1. **A surface the eye can get under (W2).** River depth is 0.02–0.6 m and the
   rain sheet is centimetres, so only burrowing, the underground table or a dev
   flood triggers immersion. Either deepen water bodies (basin/dam model) or add a
   wade/swim camera that lowers the eye below the surface.
2. **Caustics and god rays** along the sun through the surface onto the soil, and
   particle motes in the beam (plan §5.4 rendering list) — the two remaining
   items from Abyssal Garden's underwater look.
3. **Shoreline foam** at the waterline where the sheet meets a bank; the damp-soil
   stain is currently the only shore cue.
4. Re-check seams and puddle/river overlap at the new quality tiers.

## Wave 4 — Security and social

### 4-A Auth/session/CORS hardening `[ ]`
Reject disallowed HTTP origins at the boundary, check access tokens against a
live account/session, reset lockout state correctly, normalize usernames,
configure trusted proxies.

### 4-B Client trust boundary `[ ]`
Import `MESSAGE_TYPE`/`PROTOCOL_VERSION` from shared code, validate inbound
payloads before use, replace user-controlled `innerHTML` with text nodes, and
make `DEV_RESPONSE` dispatch meaningful or remove it.

## Wave 5 — Conditional (blocked on director decisions / DB)

- **5-A T08A Postgres inventory** — Postgres is not available yet. The local
  inventory was hardened and tested on 2026-11-15 (counts, stack limits, slot
  bounds, account-bound invariant); Postgres saving, row locks and restart
  survival remain `[~]` in `docs/tasks/T08A.md`.
- **5-B Season-end burial (ADR-044)** — dead biomass becomes an organic-matter
  field and edits/voids persist.
- **5-C Measurement baseline (AL-01)** — six poses, GPU timing, zero-alloc audit;
  needed before judging renderer changes beyond eye checks.

## Explicitly deferred

Art, audio and animation assets; marketplace/mail/trade; fauna, material
simulation, volumetric terrain, world-object streaming and cloud orchestration;
guild/prestige/leaderboards; shared WebGL/WebGPU depth; mobile/touch layout;
asset licensing and external deployments. These need assets, external accounts
or a dedicated task, not a polish pass.

## Modularity audit — 2026-11-16

Measured over `apps/client/src`, `apps/server/src`, `packages/*/src` (code lines,
excluding tests). The problem is not the average file; it is that a handful of
files carry whole subsystems as module-scope state.

| File | Lines | Why it is a problem |
|---|---|---|
| `apps/client/src/main.ts` | 9478 | 53 imports and **256 module-scope `let`/`const` bindings**. Every subsystem (socket, UI, camera, growth, root sight, physics, benchmark) reaches into the same mutable namespace, so nothing can be imported without the whole app and no function's dependencies are visible in its signature |
| `apps/server/src/main.ts` | 4972 | Same shape: HTTP + WS + tick loop + persistence + weather + accounts in one module |
| `apps/client/src/renderers/webgpu/WebGPURenderer.ts` | 2618 | Renderer plus tier policy, culling, impostors and Root Sight highlighting |
| `apps/client/src/config/clientConfig.ts` | 1723 | Every system's client config type and loader in one file |
| `apps/client/src/ui/DevPanel.ts` | 1499 | ~40 dev actions in one file, each an ad-hoc fetch |
| `apps/server/src/ops/plantWorld.ts` | 2800 | World, tiers, interest management and save/load |

What was wrong with the cavity specifically, and what this pass did about it:
`environment/cavityBowl.ts` was 732 lines holding five unrelated concerns -
constants, per-frame placement maths, clip maths, geometry+GLSL, and the cut
wall - and the only way to test the slope maths was to build three.js geometry
first. It is now `environment/cavity/`: `profile.ts` (shape numbers and depth
budget, no THREE), `placement.ts` (`cavityBowlPlacement`, `fitRimToGround`),
`clip.ts` (`isEyeInsideCavity`, `cavityClipPolicy`), `bowlMesh.ts` (geometry +
shader), `wallMesh.ts`, `update.ts` (the only module that mutates a mesh).
Dependencies point one way: everything may import `profile.ts`, nothing imports
`update.ts`. `placement.test.ts` exercises the depth cap, the rim stretch, the
floor clamp and the clip policy as plain numbers (13 tests, no renderer).

Same pass, smaller seam: the origin/`ws`/dev-mode probing that `main.ts` derived
inline now lives in `config/endpoints.ts`, so the socket, the config fetches and
the reconnect payload read one copy.

Later pass, same kind of seam: the three `visualRadius*` helpers (SDF, mesh and
WebGPU) were one-line shims over `resolveDrawnRadius`, so they are gone and every
call site uses the shared rule; `PlantNodeData` imports point at
`renderers/plant/plantNodeData.ts` instead of going through `PlantRenderer.ts`,
which only re-exported it. Neither changed a drawn pixel.

**Staged plan for the god-modules (next sessions, one at a time):**

1. ~~`main.ts` step 1: an explicit app context.~~ **Done** —
`src/app/appContext.ts` holds `camera`, `scene`, `canvas`, `controls()`,
`plantNodes`, `socket()`, built once after the camera exists and passed to
extracted modules instead of them reading `main.ts`'s bindings. Getters, not
captured values, for anything replaced mid-session (controls are rebuilt on a
surface-normal change; the socket reconnects).
2. ~~`main.ts` step 2: the growth-aim block.~~ **Started** — the rendering half
is `src/render/growthAimGizmo.ts` (`createGrowthAimGizmo(ctx, hooks)`): it owns
the ring, tapered tube, head, tip, mouth disc, landing ring, drop marker, the
overlay canvas and the per-frame occlusion test, and takes `getDrawingData`,
`isAnchorOnNodeSurface`, `ringAnchor`, `isDropVisible`, `renderConfig`,
`visualRadiusOf` and `drawCentreOf` as hooks. `main.ts` lost 172 lines and the
nine module-scope mesh bindings. What is still in `main.ts`: the aim state
(yaw/pitch, drag mapping, commit), because it talks to the growth-selection
state machine and the socket - it moves when the context carries those.
3. ~~`main.ts` step 3: extract the message dispatch switch.~~ **Done** — the
   27-case switch inside `connect()` is now 24 named handlers plus one table;
   `connect()` went from ~1,990 lines to 198. The table lives in `net/dispatch.ts`
   (`createDispatchTable` throws on a duplicate type, `missingServerMessageTypes`
   reports at startup any server message with no handler — INV-NET-13), and
   `net/dispatch.test.ts` covers it, including that `CLIENT_TO_SERVER_TYPES` and
   `SERVER_TO_CLIENT_TYPES` together cover `MESSAGE_TYPE` exactly once.
   **Still open:** the handler bodies read `main.ts`'s module scope directly, so
   moving them into `net/handlers/*.ts` needs that state objectified first — the
   same blocker as the rest of the growth-aim block in step 2.
4. `main.ts` step 4: extract camera/framing (`focusCameraOnNode` ...
   `applyCameraPan`) as `render/cameraController.ts`.
5. Server: split `main.ts` into `http/`, `net/` and `tick/` modules; then split
   `plantWorld.ts` tiers from persistence.

## Tracking

Update this file at each task boundary. Deeper evidence (tests, manual checks,
deviations) goes in the task record or the relevant `docs/tasks/` file, not here.
