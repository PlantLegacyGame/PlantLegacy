# Bug-fix plan — verified 2026-11-16

An ordered plan for the defects that exist in the code **today**, each with the
evidence that it is real, the exact edit, and a check that proves the fix. This
is the execution order; the defect list itself stays in
[`bug-inventory.md`](./bug-inventory.md), documentation-only debt is
[`tasks/DOC-01.md`](./tasks/DOC-01.md), and what a fix must not break is
`DESIGN.md`.

Produced by reading the tree and running the gate, not by copying older audits.
Every line number below was read in this pass.

## 0. What the gate says today

Re-run after the first pass of this plan landed (FIX-01, 02, 03, 06, 07).

| Command | Result | Evidence |
|---|---|---|
| `pnpm lint` | pass | 275 files, 0 errors (was 1 formatter error in `tools/docs-check/check.mjs`) |
| `pnpm typecheck` | pass | 7 workspace projects |
| `pnpm config:validate` | pass | 79 files, schema + rarity ban, including the two new Root Sight keys |
| `pnpm test` | pass | client 247, server 279, shared 183, weather 9; 0 failures |
| `pnpm docs:check` | pass | 0 mismatched quoted defaults in 95 rows (was 24, reported while exiting 0); 45/45 protocol rows |
| `pnpm build` | pass | chunk-size warning unchanged (5.4 MB main bundle) |
| `pnpm verify` | pass | the whole chain above, end to end |

Working tree state at the time of this pass: branch `main`, **192 changed
paths** (122 files, +13,558 / −2,107) uncommitted. These results therefore
describe uncommitted work, not `HEAD`. Nothing here has been committed by this
pass.

## 1. Order at a glance

| # | Fix | Defect | Size | Blocked by |
|---|---|---|---|---|
| FIX-01 ✔ | Format `check.mjs` so `pnpm lint` passes | L1 | S | — |
| FIX-02 ✔ | Correct the 24 quoted config defaults | F11 | M | — |
| FIX-03 ✔ | Make the drift check fatal; retire the dangling pointer | F10 | S | FIX-02 |
| FIX-04 | One protocol version, enforced in code | F12 | S | decision D1 |
| FIX-05 | Make `pnpm verify` mean what the README says | F13 | S | decision D2 |
| FIX-06 ✔ | Underground test against the soil, not Y=0 | A2 | M | — |
| FIX-07 ✔ | Root Sight uniforms from config | A8 | S | — |
| FIX-08 | Frame-rate-independent ambient fade | F9 | S | — |
| FIX-09 | One path into a UI layer | D5 | S | — |
| FIX-10 | Panels: give Mutation a close control; hit-test the rest | D3 | M | browser access |
| FIX-11 | Report tissue lost to drought and upkeep | E5 | M | — |
| FIX-12 | Test that growth cannot emit `PLANT_DAMAGE` | E3 | S | — |
| FIX-13 | Delete or document the dead protocol surface | F7 | S | decision D3 |
| FIX-14 | One helper for the planet-body draw range | F6 | S | — |
| FIX-15 | Shared panel primitive | D4 | L | FIX-09, FIX-10 |

Sizes: S ≈ under an hour, M ≈ half a day, L ≈ a day or more.

Wave 0 (FIX-01) is not optional: CI runs `pnpm lint` as its first gate, so the
current tree cannot go green.

---

## 2. Wave 0 — green the gate

### FIX-01 · `pnpm lint` fails on the docs checker (L1) — **done 2026-11-16**

**Why:** BIOME 2.6.4 reformats two statements in the drift reporter. The whole
`verify` chain and the CI job stop here.

**Where:** `tools/docs-check/check.mjs:137`, `:139`.

**Change:** run `pnpm lint:fix` (or hand-wrap the two `console.log` calls), then
confirm `pnpm lint` is clean. No behaviour change.

**Acceptance:** `pnpm lint` exits 0.

**Verify:** `pnpm lint; echo $?`

---

## 3. Wave 1 — make the guardrails honest

### FIX-02 · 24 quoted config defaults are wrong (F11) — **done 2026-11-16**

**Why:** five task records quote a `Default` that `config/` does not hold. A
reader who tunes from the record gets a value the code never reads. The full
row-by-row list (24 rows: C01 6, T00A 6, T01 6, T03 4, T03P 2) is in
[`tasks/DOC-01.md`](./tasks/DOC-01.md).

**Where and what:**

- `docs/tasks/C01.md` — 6 rows (`config/render.json`):
  `fps_warning_threshold` 0.85→0.7, `resolution_floor` 0.25→0.5,
  `camera_min_distance` 10.0→1, `camera_max_distance` 200.0→2000,
  `camera_max_polar_angle` 1.52→3.1, `shadow_map_size` 2048→1024.
- `docs/tasks/T00A.md` — 6 rows (`config/resources.json`):
  `tile_moisture_base` 40→150, `rain_gain_per_s` 0.5→1.5,
  `evaporation_per_s` 0.1→0.025, `absorption_per_s` 0.2→2.4,
  `photosynthesis_rate` 0.1→1, `diffusion_rate` 0.01→0.03.
- `docs/tasks/T01.md` — 3 rows (`config/growth.json`):
  `root_growth_speed` 0.5→0.85, `canopy_growth_speed` 0.5→0.95,
  `node_cost_base` 10→20.
- `docs/tasks/T01.md` — heading `## Config: config/plant_world.json` names a
  file **that has never existed**; 11 of its 12 keys are in
  `config/growth.json`, so **done by deleting the second table** and folding its
  live rows into the real `config/growth.json` table above it; two tables for
  one file was the duplication that let it drift. `max_energy_per_plant` is
  gone (replaced by `energy_capacity_per_biomass` / `energy_capacity_floor`)
  and `root_overlap_pressure_damage` is gone (deleted by INV-TM-06 — roots may
  touch for symbiosis and grafting).
- `docs/tasks/T01.md` — the `config/persistence.json` table quotes
  `save_interval_ms` and `event_log_max_entries`; neither key exists and
  `config/persistence.json` is a stub (`values: {}`). The live keys are
  `config/world.json` `plant_save_interval_s` and
  `event_log_compaction_threshold`. **Done by deleting the table** — those
  timings are `world` tunables and `docs/tasks/T03.md` owns them.
- `docs/tasks/T03.md` — delete the `tick_rate_hz` row (removed by plan item 1-A;
  the one tick rate is `net_proto.tick_rate_hz`) and the
  `offline_damage_multiplier` row (no such key; offline behaviour is the
  Active/Near/Dormant tiers). Fix `detailed_plant_budget` 100→256 and
  `per_client_entity_cap` 200→1000.
- `docs/tasks/T03P.md` — `protocol_version` 1→3 and
  `max_velocity_units_per_tick` 0.5→5.

**Rule applied:** `config/` owns the default, the record quotes it. Where a key
is gone, delete the row rather than inventing a replacement value.

**Acceptance:** the drift reporter prints `0 mismatch(es)` (or prints nothing).

**Verify:** `pnpm docs:check`

### FIX-03 · the drift check cannot fail (F10) — **done 2026-11-16**

**Why:** `check.mjs` builds `configDrift`, prints it, and never adds it to
`errors`; the file's own header says "Exit 1 on any failure". So 24 wrong
defaults passed CI. It also tells the reader the remaining rows are listed in
`docs/tasks/DOC-01.md`, and that file did not exist — the link checker only
matches a markdown link whose target ends in `.md`, so a path inside a printed
message is invisible to it.

**Where:** `tools/docs-check/check.mjs:134-143` (the `if (configDrift.length > 0)`
block) and its header comment at `:1-10`.

**Change:**

1. After FIX-02 lands, push each drift entry into `errors` (reword as
   `x config default drift: …`) so the check exits 1.
2. Keep the headline count; drop the `(docs/tasks/DOC-01.md)` suffix or point it
   at the now-real [`tasks/DOC-01.md`](./tasks/DOC-01.md).
3. Add the fifth check to the header comment so the doc comment matches the code.

**Acceptance:** a deliberately wrong `Default` in any task record makes
`pnpm docs:check` exit 1; with the tree as it stands it exits 0.

**Verify:** edit one row, run `pnpm docs:check; echo $?`, revert.

### FIX-04 · one protocol version, enforced (F12)

**Why:** the version is documented as 1, 2 and 3 in different files, and nothing
ties the config key to the code constant even though
`config/net_proto.json`'s own note says "Must equal `PROTOCOL_VERSION`". The
server rejects `HELLO` on mismatch (`apps/server/src/main.ts:4747` compares
against `netProtoConfig.protocolVersion`) while the client sends the shared
constant (`apps/client/src/main.ts:6462`), so a config edit without a code edit
makes every client fail to connect.

**Truth today:** `packages/shared/src/protocol/index.ts:13` `PROTOCOL_VERSION = 3`;
`config/net_proto.json` `protocol_version` = 3; `docs/protocol.md:25` says 3.

**Drift to correct:** `CONTEXT.md:382` (says 2), `docs/protocol.md:350` (config
table row says 2), `docs/tasks/T03P.md:20` and `:53` (say 1),
`docs/decisions.md:213` (says 1 — historical, so leave the decision text and
append "superseded: the version is now 3" rather than rewriting history).

**Change (D1):** delete the `protocol_version` key from `net_proto.json` and have
`apps/server/src/ops/net.ts:47` read `PROTOCOL_VERSION` from
`@plant-legacy/shared/protocol`, so there is one source and no config edit can
break the handshake. Update `apps/server/src/ops/net.test.ts:24,64,89` fixtures.
Alternative if the key must stay: assert at startup that it equals
`PROTOCOL_VERSION` and fail the boot — but then the value is a tunable that must
never be tuned.

**Acceptance:** `grep -rn "PROTOCOL_VERSION" apps packages` shows one declaration;
no config file declares a version; the server still rejects a stale client.

**Verify:** `pnpm --filter @plant-legacy/server test`, then log in with the client.

### FIX-05 · `pnpm verify` is not the CI chain (F13)

**Why:** README says "To run the checks CI runs: `pnpm verify`". `verify` is
`lint && typecheck && config:validate && test`; `ci.yml` also runs `docs:check`
and `build`. A contributor can be green locally and red in CI.

**Where:** `package.json` `scripts.verify`, `README.md` (Quick start, above the
`pnpm verify` block), `.github/workflows/ci.yml`.

**Change (D2):** either add `docs:check` and `build` to `verify` (10 s build,
worth it) and add a `verify:fast` for the inner loop, or change the README
sentence to "CI runs `pnpm verify` plus `pnpm docs:check` and `pnpm build`".
Recommend the first: one command, one meaning.

**Acceptance:** `pnpm verify` and the CI job run the same commands in the same
order.

**Verify:** compare `package.json` to `ci.yml` step by step.

---

## 4. Wave 2 — client and server defects

### FIX-06 · underground detection assumes the soil is Y=0 (A2) — **done 2026-11-16**

**Why:** terrain relief reaches `surface_amplitude_m = 26`, so on a rise the eye
can be metres under the soil with a positive world Y. The floor clamp, the
spring-arm skip, root picking and `setUndergroundView` all then behave as if the
camera were above ground. `EnvironmentRenderer.update` already does it correctly
(`apps/client/src/renderers/EnvironmentRenderer.ts:297`, `:403`).

**Where (all five, verified):** `apps/client/src/main.ts:2085`
(`currentCameraMinDistance`), `:3745`, `:3853`, `:8446`
(`resolveCameraCollision`), `:8733` (`setUndergroundView` gate).

**Change:** `main.ts:1882` already has `clientSurfaceY(x, z, y)` =
`y + planetTerrainY(planetRadius, x, z, field)`. Add one predicate next to it:

```ts
/** True when a world-space Y at this x/z is below the drawn soil. */
function isUnderSoil(x: number, z: number, worldY: number, tolerance = 0): boolean {
  return worldY < clientSurfaceY(x, z, 0) - tolerance;
}
```

Use it at all five sites (`tolerance` 0.02 for the view gate, matching
`EnvironmentRenderer`). Keep `node.position.y < 0` in
`cameraMinDistanceForNode`: a node's Y is surface-relative, not world.

**Acceptance:** on a 16 m rise, a camera 1 m under the soil counts as underground
at all five sites; on flat ground the same camera still does.

**Verify:** put `isUnderSoil` in a small pure module (for example
`apps/client/src/player/underground.ts`, where `rootSightAutoOpen.ts` and
`ownPlantAnchor.ts` already live) and unit-test it with a stubbed terrain
function; `main.ts` has no test harness.

### FIX-07 · Root Sight presentation defaults are literals (A8) — **done 2026-11-16 (uniforms)**

**Why:** `main.ts:2309` builds the shared uniforms as
`createRootSightUniforms({ radius: 50, soilOpacity: 0.3 })` while
`config/root_sight.json` says `cutaway_radius` 7 and `soil_opacity` 0.45. The
factory then falls back to `50`, `radius * 0.7` and `0.3`
(`rootSightUniforms.ts:49,51,53`). RULE_3, and the first frames are wrong until
`updateRootSight` overwrites them.

**Change (as landed):** the factory takes no arguments and returns *closed*
uniforms, so it holds no tuned value at all; `applyRootSightConfig(uniforms, config)`
mutates the shared set the moment the config loads, before the first frame. The
`0.28` floor and `0.7` ratio became `root_sight.aperture_min_m` and
`root_sight.aperture_radius_ratio`, read through `apertureRadiusFor`, and the
client's offline fallbacks were corrected to the file's 7 / 0.45.

**Acceptance:** changing `cutaway_radius` or `soil_opacity` in the file changes
the first drawn frame.

**Verify:** `apps/client/src/renderers/RootSightStateMachine.test.ts` pattern —
add a parse test asserting the uniforms take the file's numbers.

### FIX-08 · ambient smoothing is frame-rate dependent (F9)

**Why:** `EnvironmentRenderer.ts:789` passes a fixed `alpha: 0.3`, so the
day/night fade closes 30% of the remaining gap per *frame*: a 144 Hz client
reaches night roughly five times faster than a 30 Hz one.

**Where:** `apps/client/src/renderers/EnvironmentRenderer.ts:780-790`;
`apps/client/src/renderers/environment/celestial.ts:92-116`.

**Change:** pass `alpha: 1 - Math.exp(-dt / tau)` and add
`render.json` `ambient_smoothing_tau_s` (number, range `[0.01, 5]`, default 0.35)
so the time constant is config, not a code constant (RULE_3). Read it in
`clientConfig.ts` with a fallback.

**Acceptance:** stepping one simulated second at 30 Hz and at 144 Hz lands within
a small tolerance of the same baseline.

**Verify:** extend `apps/client/src/renderers/environment/celestial.test.ts`
(it already steps the function at different rates).

### FIX-09 · elements bypass the layer's pointer-events opt-in (D5)

**Why:** `UIShell.attachTo` (`apps/client/src/ui/UIShell.ts:102-109`) is the one
place that sets `pointer-events: auto` for a child of a layer whose CSS is
`pointer-events: none`. Four sites append directly and depend on each element
setting it itself; this is the class of bug that produced D2 (dead chat buttons).

**Where:** `apps/client/src/main.ts:4571` (resource readout),
`:4665` (hint card), `:4729` (a panel), and
`apps/client/src/ui/DebugOverlay.ts:63`.

**Change:** route all four through `uiShell.attachTo(layerName, element)`. Where
`uiShell` may be null during early boot, keep the existing fallback but set
`pointerEvents` explicitly, so "appended but dead" is unreachable.

**Acceptance:** every child of a `ui-layer` either opts in or is deliberately
inert (a label). A grep for `layer.appendChild` in `apps/client/src` returns only
`UIShell.attachTo`.

**Verify:** the grep; plus a click on the resource readout tooltip and the hint
card in the browser.

### FIX-10 · panels and their close controls (D3)

**Verified correction:** `MutationPanel` has **no close control at all** — the
word "close" does not appear in
`apps/client/src/ui/MutationPanel.ts`, and its API is
`update / clear / panel / dispose` with no `hide()`. So "the X does nothing" is
the wrong diagnosis for that panel: there is no X. `PlayerPanels` binds
`[data-close="inspect"]` and `[data-close="inventory"]` (`:323-324`) and
`SettingsPanel` binds `.pl-settings__close` (`:157`), so those two need a hit
test, not a rewrite.

**Change:**

1. Give `MutationPanel` a header close button and a `hide()` on its API, wired in
   `main.ts` next to the existing show path (the panel is created at
   `main.ts:2761` and its `display` is only ever set to `none` at creation).
2. Add `Escape` handling to the same three panels, once, through FIX-15's
   primitive if that lands first.
3. Re-test the Inspect/Inventory/Settings X buttons with a real hit test:
   `document.elementFromPoint(center of the button)` must return the button (or a
   descendant), not the canvas. That distinguishes "handler missing" from
   "something is on top".

**Acceptance:** every panel that can open can be closed by its X and by Escape,
and `elementFromPoint` at each X returns that X.

**Verification limit:** this needs a browser. `main.ts` has no DOM test harness,
so this fix cannot be proven from the command line.

### FIX-11 · tissue lost to drought and upkeep is silent (E5)

**Why:** `shedTissueMass` (`apps/server/src/ops/plantWorld.ts:1864-1926`) drains
node biomass, calls `refreshRadius`, and `detachNode`s any part that empties —
with no `PLANT_DAMAGE` message and no bus event. The only `PLANT_DAMAGE`
broadcast is the damage pipeline's (`apps/server/src/main.ts:676-685`). So a
part can vanish from a starved plant with nothing in the client's damage feed.

**Change:** emit a damage event from the shed path with `source: 'drought'`
(water/mineral shortfall) or `'starvation'` (energy), carrying
`nodeId`, `destroyedNodeIds`, `amount`, `totalBiomass`. Reuse the existing
`PlantDamagePayload`; extend the `source` union rather than adding a message, so
no protocol bump is needed. Batch per tick, not per node — a drought can empty
many nodes in one tick and the client should see one message.

**Acceptance:** a plant starved until a leaf detaches produces exactly one
`PLANT_DAMAGE` naming the destroyed node; the event log gains a matching
`damage` entry.

**Verify:** `apps/server/src/ops/plantWorld.test.ts` — the existing test
`lowers health when drought sheds tissue and repairs it once fed` (`:1978`) is the
natural place to assert the event.

### FIX-12 · nothing asserts growth cannot damage the plant (E3)

**Why:** E1's fix (ADR-051) is only watched by the bot's `growth-damage` rule. A
regression in the collapse path would ship green.

**Change:** in `apps/server/src/ops/damage/damagePipeline.test.ts`, add the
inverse of the existing test: grow a root tunnel, run the pipeline past the
collapse time, and assert **no** damage event carries the growing plant. The
existing test "own tunnel is ignored" covers one path; this one covers "grow
anything, take nothing".

**Acceptance:** injecting the old behaviour (removing the `actorPlantId` skip)
makes the test fail.

**Verify:** `pnpm --filter @plant-legacy/server test`.

---

## 5. Wave 3 — cleanup

### FIX-13 · dead protocol surface (F7)

`validateMovement` (`apps/server/src/ops/net.ts:504`) has no call sites, and
`INPUT` is consumed only to advance `lastInputTick`. Under RULE_1 the camera is
client-side and the server keeps no avatar position, so this is not missing
enforcement. **D3:** either delete `validateMovement` and its tests, or keep it
and document `INPUT` in `docs/protocol.md` as an ack-only heartbeat. Deleting is
cleaner while nothing depends on it; documented dead code still costs a reader.

### FIX-14 · one helper for the planet-body draw range (F6)

`EnvironmentRenderer.update` and the renderer's own state both recompute the
planet-body draw range and `surfaceShells` visibility from the eye height each
frame. Correct today, split in two places. Extract `updatePlanetBodyVisibility(eyeY)`
and call it once. Pure refactor; no behaviour change.

### FIX-15 · shared panel primitive (D4)

Chat, Inspect, Inventory, Mutations, Settings and Dev each re-implement header,
close, Escape, focus trap and z-index. After FIX-09 and FIX-10 stabilise the
behaviour, extract `ui/Panel.ts` (`title`, `body`, `onClose`, `layer`, Escape,
focus restore) and move the six panels onto it. This is the fix that stops
D2/D3/D5 from recurring; it is last because it is the largest and needs the
others settled first.

---

## 6. Confirmed **not** defects — do not spend time here

| Item | Why it is not a bug |
|---|---|
| E4 "drought shrinks node radii" | The shrink is deliberate and documented in the code: `plantWorld.ts:1855-1863` says every part's radius is recomputed after losing mass "so the renderer actually draws the decline". `shedTissueMass` drains leaves, then canopy stems, and reaches roots only after the canopy is gone. As written the entry is false; if the complaint is really "root thinning looks wrong", that is an art decision, not a defect. |
| F5 `docs/tasks/T02.md` quotes 50 / 0.3 | Already fixed: the table at `docs/tasks/T02.md:51,53` reads 7.0 and 0.45. The inventory row is stale and must move to **Fixed**. |
| A6 transition direction | Already fixed: `RootSightStateMachine` derives direction from target + progress and has a test. The inventory row is stale. |
| Build warning "Top-level await is not available in the configured target environment" | Checked the artefact, not the warning: `dist/assets/index-legacy-*.js` is a `System.register` module with no top-level `await` (the bootstrap was wrapped). No confirmed defect. Re-check only if `main.ts` gains another top-level `await`. |
| A1 "no strata to reveal" | A capability limit, not a bug. It needs real volume terrain (T56/C10), which the integration plan schedules later. |
| 5.45 MB main chunk | A size warning, not a defect. Code-splitting is a performance task (AL-01 family), not a fix. |

## 7. To-do ledger

Tick these; each is one commit at most.

**Gate**
- [x] FIX-01 `pnpm lint` passes
- [x] FIX-02 24 quoted defaults corrected; T01's phantom tables removed and their live rows folded into `growth.json`
- [x] FIX-03 drift check fails on drift; DOC-01 pointer resolves
- [x] FIX-04 protocol version has one source (`loadNetProtoConfig` refuses to boot when `net_proto.protocol_version` disagrees with `PROTOCOL_VERSION`; the server handshake uses the constant)
- [x] FIX-05 `verify` == CI chain (adds `docs:check`; `verify:ci` adds `build`; README rows updated)

**Client**
- [x] FIX-06 `isBelowSoil` used at `main.ts:2085,3745,3853,8446,8733`
- [x] FIX-07 Root Sight uniforms read `root_sight.json` (aperture derived from two new keys)
- [x] FIX-08 ambient fade uses `1 - exp(-dt/tau)` with `render.ambient_fade_tau_s`
- [x] FIX-09 no `layer.appendChild` outside `UIShell.attachTo` (DebugOverlay now attaches through the shell)
- [~] FIX-10 Mutation panel has a close control (button + Escape; close is per plant). X-button `elementFromPoint` hit tests are browser checks and have **not** been run

**Server**
- [x] FIX-11 drought/upkeep tissue loss emits one `PLANT_DAMAGE` per tick (`PlantWorld.drainShedDamage` batches per plant; the server broadcasts it)
- [x] FIX-12 growth-cannot-damage test: a grown, fed plant leaves the shed-damage queue empty in `plantWorld.test.ts`

**Cleanup**
- [x] FIX-13 `validateMovement` deleted; `INPUT` documented as an ack-only heartbeat. `net_proto.max_velocity_units_per_tick` and the cross-field rule that read it (`growth.root_speed_exceeds_max_velocity`) went with it.
- [x] FIX-14 `EnvironmentRenderer.updatePlanetBodyVisibility` is the one place that sets the body draw range and shell visibility
- [x] Dev panel grants any configured item (`dev_grant_item`), so every definition can be read in the inventory panel instead of only the three in a starting pouch
- [ ] FIX-15 shared panel primitive

**Docs**
- [x] Inventory rows F5, A6, E4 corrected (see §6) — already done on 2026-11-16 and the ledger row was stale: `docs/bug-inventory.md` carries all three as `[x]` with the correction (A6 at line 46, E4 at 144, F5 at 196), each naming the code or doc that resolves it.
- [x] Protocol version agrees everywhere: `PROTOCOL_VERSION = 3` in `@plant-legacy/shared/protocol`, `net_proto.protocol_version` is 3, and `docs/protocol.md` (config table) and `docs/tasks/T03P.md:20,53` all say 3; `CONTEXT.md` §5.6 states that the key must equal the constant or the server refuses to boot. The line numbers in this row had drifted, which is why it read as an open mismatch.
- [x] README `pnpm verify` claim matches reality (verify includes `docs:check`; `verify:ci` adds the build)

## 8. Open decisions

1. **D1 — protocol version.** Delete `net_proto.protocol_version` and read the
   shared constant (recommended), or keep the key and assert equality at boot?
2. **D2 — `verify` scope.** Add `docs:check` + `build` to `verify` and add
   `verify:fast` (recommended), or weaken the README sentence?
3. **D3 — dead protocol surface.** Delete `validateMovement`, or document `INPUT`
   as an ack-only heartbeat?
4. **D4 — E4.** Confirm the entry is withdrawn, or restate it as an art
   complaint about root thickness during a drought.
5. **D5 — W2 / water depth.** Immersion needs a surface the eye can get under;
   river depth is 0.02–0.6 m, so only burrowing or a dev flood triggers it.
   Deepen water bodies or add a wade/swim camera? Not scheduled here because it
   is a design decision, not a fix.

## 9. Verification discipline for every item

Each fix is done when: the named check passes, `pnpm verify` is green after it,
and the inventory row moves to **Fixed** with the test that proves it. A fix that
cannot be proven from the command line (FIX-10, the visual half of FIX-07) stays
`[~]` in the inventory with "browser pass pending", never `[x]`.
