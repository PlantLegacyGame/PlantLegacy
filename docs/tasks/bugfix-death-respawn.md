# Bugfix record — death, respawn and what is left behind

**Status:** `[x]` for this wave. One session, six reports that all met at the same
place: the moment a plant dies.

1. Dying offered no way to grow again where it happened. The card's "New seed"
   left the world, closed the socket and rebuilt the whole session.
2. Coming back after a death did not put the player on a new seed.
3. What the player became when they died did not look like a plant.
4. Every shadow under a thing lying on the ground was the same flat disc at the
   same angle, cutting into a slope on one side and hovering on the other.
5. After a death the camera was under the ground and not attached to the plant.
6. The death card reused the live inspect panel's numbers, so it printed `0 / 0`
   water and a growth rate from the last second of life, and the card was cramped.

## 1. What changed

| # | Report | Cause | Fix |
|---|---|---|---|
| 1 | No respawn as a seed | The card's first action called `entryFlowPlantLost`, which is the title screen; the chip did the same. Both paths discarded a healthy socket, and starting again meant a new HELLO, a new world and a new camera | Protocol `RESPAWN` (49). The server's `respawnPlayerAsSeed` creates the plant under the same owner, registers the socket at it, broadcasts `PLANT_CREATED` to nearby players and answers with a normal `WELCOME`; it refuses while a live plant is still owned, because one plant per owner is the join rule (INV-ID-01). The card's primary button is "Grow a new seed" and the spectate chip asks for the same thing; a 6 s fallback shows the plant-lost screen if no WELCOME arrives |
| 2 | Returning after death never became a seed | Server-side it did: `killPlant` deletes the plant from `plants` and the owner index, so both HELLO paths create a replacement. What was missing was the client showing it: the welcome refit was vetoed by `cameraUserMoved` from the dead plant's hill, the vitals HUD stayed hidden, and the peak node count came from the mirror the dead plant still occupied | A new plant resets `cameraUserMoved` and reframes; the welcome turns the vitals HUD back on, clears the death card and chip, and takes peak nodes from WELCOME's own node set instead of the stale mirror |
| 3 | The corpse was a bone | `WorldDrops` drew `remains` as a tapered shaft with two knobbed ends, which is an animal skeleton in a game where the player is the plant | A collapsed husk: a torn root plate, a three-joint stalk arched over, and two dried leaves curled down past the tip. It rests 3 cm off the soil instead of hovering at 26 cm, and it neither bobs nor turns on a turntable |
| 4 | Shadows all the same, not on the slope | Every contact shadow was a `CircleGeometry` turned flat with `rotation.x = -PI/2` at `surfaceY + 0.02`, so it had one plane and one height no matter what the ground did | `WorldDrops` takes a `groundNormal` sampler (`surfaceNormalAt` in the client); the disc's local +Z is mapped onto that normal, it is lifted along the normal rather than straight up, and its heading and stretch come from a stable hash of the drop id |
| 5 | Camera underground and off the plant | `frameCameraOnPlant` computed a grounded target, but `startCameraFocus` deliberately carries the pivot in plan only - the ground physics owns its height each frame. In the free-camera rig (`cameraMode: 'free'`) nothing writes that height at all, so the target stayed at the world origin and the whole rig hung under the terrain; a browser pass measured target y = 0 with the ground at 20.09 m. The framing eye was never checked against the ground either, so a 3 m arm on a bank started inside the hill | The framing writes `controls.target.y` from its own clamped target (the travel tween still carries only x/z); the eye is lifted until the arm - at 45%, 70% and 100% of its length - clears the drawn surface plus `camera_ground_touch_m`, capped at 8 m; and the target is floored at `clientSurfaceY(x, z, 0)` unless Root Sight is active. A changed plant id also clears the player-moved veto so the automatic refit runs. Measured in §4 |
| 7 | Plant shadows did not follow the slope | A plant's only shadow is the sun's shadow map: two hundred metres across a thousand texels, so a seedling's shadow is a texel or two of grey cast from one fixed plane, and it cannot say where the stem meets the soil | `PlantContactShadows` draws one soft ellipse per plant, laid in the ground plane under the lowest node and sized to the plant's plan spread (0.12-2.6 m). It is removed when the plant is gone, hidden with the body pass, and skipped for a body more than 0.35 m off its soil (uprooted, tumbling) |
| 6 | Cramped card, wrong numbers | `deathStatRows` was `plantStatRows`, the live panel's rows. Water, minerals, energy, health and growth rate describe a running plant; on a dead one they are zeroes and a stale rate. The card was 420 px with a two-column grid and its first action was to stay | A 520 px card with an eyebrow, the death sentence, a 1 px ember rule, an auto-fit stat grid and two buttons. `deathStatRows` is its own curated set: Cause, Killed by (when named), Age, Died on, Biomass, Peak biomass, Nodes, Peak nodes, and Mutations only when there were any. `PLANT_REMOVED` now carries the death record's `biomass` and `nodeCount`, so those two are current to the moment of death rather than the last STATE packet |

## 2. Config

No config file was added or changed. The protocol version stays 5: `RESPAWN` is a
new client request, and a client that does not send it behaves exactly as before.

## 3. Tests

| Test | What it pins |
|---|---|
| `ui/DeathScreen.test.ts` (5) | The card still leads with the cause; the curated rows and their order; cause and source wording; an unknown `killedBy` token stays readable; mutation upkeep appears only when the plant had mutations; the live vitals (Water, Minerals, Energy, Health, Growth rate) are never on the card. The old "the rows come from the shared stat owner" test asserted the behaviour this wave removed, and is replaced by one that pins the divergence from `plantStatRows` |
| `renderers/WorldDrops.test.ts` (+3, 10 total) | A disc's plane is the ground plane and it is lifted along the normal; two drops on different slopes get different orientations; a husk rests under 25 cm, does not bob and does not spin |
| `renderers/PlantContactShadows.test.ts` (6) | One patch per plant; the disc's +Z maps onto the hill's own normal; the patch follows a moved foot and resizes with the spread; a seed never gets a dot under 0.12 m and a thicket never a patch past 2.6 m; a plant that leaves the payload loses its patch; the patches hide and show with the body pass; a missing normal falls back to flat ground |
| `renderers/drawnGround.test.ts` (3) | The drawn mesh's height is preferred over the field; with no mesh hit the field is the fallback; the normal comes from drawn heights 0.3 m either side, not from the field |
| `renderers/PlantFootprints.test.ts` (4) | Roots never get a foot; two plants keep two patches; a body more than 0.35 m off the field gets none; a seed still gets the 0.16 m floor, and the patch grows with the spread |
| `renderers/WorldDrops.test.ts` (+1, 12 total) | One body and any number of offcuts for a pile of remains: exactly one root plate, the offcut smaller than the body, and no second shadow disc; the body is over 0.3 m long |
| `ops/damage/damagePipeline.test.ts` (+1 assertion set) | A death's remains and dung lie around the body: no two drops share a plan point, none is further than 0.8 m from it |
| `packages/shared` protocol tests (230 with the wave) | `CLIENT_TO_SERVER_TYPES` and `SERVER_TO_CLIENT_TYPES` still cover `MESSAGE_TYPE` exactly once with `RESPAWN` (49) present |

## 4. Checks run

- `pnpm verify` green at the end of the wave: lint, typecheck, config validation,
  config keys, docs, palette, 31 tools, 230 shared, 24 weather, 508 server, 811
  client.
- The live path was driven once on an isolated server (`PORT=8099`, no database,
  never the dev world) with a one-off WebSocket client: HELLO created a seed,
  `RESPAWN` answered `REJECT { reason: 'plant_alive', originalType: 49 }`, the
  season-end dev action removed the plant, and the next `RESPAWN` answered with
  a `WELCOME` for a different plant id carrying one seed node at 3.66, 1.59.
  The client's `WELCOME` adoption for that response is the same handler every
  join uses; it was not driven in a browser.
- Driven in the dev browser (`?dev=1`) on 2026-11-23. A guest joined; the
  `dev_kill_plant` action was sent on the live socket. The card came up with
  "Life ended", "Your plant died", It was damaged past saving., Cause Damage,
  Age 21s, Died on Day 1 - 12:37, Biomass 1.0, Peak biomass 1.0, Nodes 1, Peak
  nodes 1, and "Grow a new seed" focused. Clicking it produced a new `WELCOME` and
  plant id on the same socket - no title, no second handshake - and the new seed
  was in frame.
- Camera measurements from the same run: a fresh join before the fix had the
  pivot at y = 0 with the ground at 20.09 m and the eye 0.31 m up under the hill;
  after it, a seed at 20.57 m ground framed on a target of 20.59 m with the eye
  0.61 m clear. After "Grow a new seed" on a bank: new plant id, 1 node, pivot
  17.41 m on ground 17.34 m, eye 1.56 m clear - and the seed visible in the shot.
- `dev_spawn_drop` put three drops on the same bank: their discs face
  (0.113, 0.937, -0.330), which is the hill's normal, not world up; a seed's
  plant patch sits at its foot with the same tilt. The husk, a seed's patch and
  the drops close up were looked at, not only measured.
- Not checked: the card at a narrow pane, the husk at normal play distance (it
  was inspected at about 1 m), and how a second account sees the respawned seed.
- Second pass, same dev browser. A dropped seed and the mutation gallery's 32
  grown bodies were measured together: the seed's patch is 0.20 m across and the
  gallery patches 0.22-0.35 m, each against its own body's spread. A death left
  four remains: on the drawn ground the body's plate bottom sat at 19.014 m
  against the drawn surface at 19.004 m, its leaves were children of its joints,
  and the pile held one root plate, 6 joints and 5 leaves across four remains -
  one body and three offcuts. Drop shadows now lift 0.027 m off the drawn ground
  at their own x/z (previously the field put them up to tens of centimetres out).
- The corpse was looked at again after the split (`screenshots/husk-v2.png`): one
  body with a dung ball above it and offcuts around, not four pale husks. The
  body was then made half again as long and given a wider shade; that last size
  change is pinned by the test (body over 0.3 m) but was not re-viewed, because
  the dev page stopped accepting PLAY after the final reload.
- The plant could not be grown on a slope through gameplay in the dev world: a
  direct `GROWTH_INTENT` was refused four times and the seed never germinated, so
  the multi-node check used the gallery's real grown bodies (20-34 nodes) rather
  than a hand-grown seedling.

## 5. Second pass — the shadow on the drawn ground, and one corpse

Three things still looked wrong after the wave, and all three were the same kind
of mistake: a number taken from a world slightly different from the one drawn.

| Report | Cause | Fix |
|---|---|---|
| "The shadow is hovering - it isn't on the actual ground" | Contact shadows were seated on the analytic height field, but the ground on screen is the `planet-terrain-detail` triangle mesh, and on a bank the two disagree by tens of centimetres. The normal came from the field too, so the disc was tilted to a slope that was not under it | `DrawnGround` raycasts the drawn mesh down its own column and takes a plane normal from the drawn heights 0.3 m either side. Drops and plants both seat on it. The height field is kept for classification only - is this part a root, is the body airborne - never for placement |
| The patch under a plant followed its lowest node, whatever that node was | A root is below the soil, so the lowest node was usually a root tip and the patch slid off the crown down the hill; a seed got a dot under a point that was not the plant | `plantFootprints` (pure, exported) counts only nodes at or above the soil, places one foot per plant, then spreads it; a body more than 0.35 m off its field gets no patch; the floor is 0.16 m and the radius is 0.55 × spread |
| "Fix the dead body... all the nodes are still connected" | A death spawns four `remains` and a dung ball at one point, and each remains was drawn as a whole husk: four pale corpses stacked into one black shadow puddle, with the dung hovering out of the pile. The husk itself was loose pieces, 0.26 m long | The server drops them on a golden-angle spiral around the body (0.14-0.38 m out). The client draws the first remains at a spot as the body - root plate, three chained joints, two leaves each parented to a joint, a hand long, base on the soil - and any further remains within 0.6 m as a smaller offcut: one joint, one leaf, no plate, no second shadow |

The husk is also no longer pale bone-coloured: the dried stalk and leaves are
olive-brown, and the leaf droops were backed off until every tip rests on or just
above the soil instead of 4 cm through it - measured at 0.7 mm into the soil, and
pinned by a test that fails past 2 mm.

A review of that pass found three more places where a number described a surface
other than the one on screen:

- A plant's footprint asked the analytic field which of its parts stood above the
  soil, then seated the patch on the drawn mesh. On a bank the triangle can stand
  half a metre over the field, so a buried root tip counted as standing and the
  patch slid up the hill. One sampler now answers both questions.
- The drop height sampler added `camera_ground_touch_m` - the camera's own
  clearance - to the soil height, so every drop and every drop shadow rested 2 cm
  in the air before its own lift. A clearance is not a ground height.
- The enlarged husk's leaf tips reached 7.8 mm into the soil. The droop angles
  moved 0.07 rad and the deepest point is now 0.7 mm under: contact, not burial.

## 6. Files

- `packages/shared/src/protocol/index.ts`, `messageSchemas.ts` — `RESPAWN` (49),
  `PLANT_REMOVED.biomass/nodeCount`.
- `apps/server/src/main.ts` — `respawnPlayerAsSeed`, the dispatch case, the death
  record's numbers on `PLANT_REMOVED`.
- `apps/client/src/main.ts` — `requestNewSeed`, `exitDeathUi`, welcome adoption
  after a death, framing floor and refit reset, `groundNormal` for drops,
  authoritative death numbers.
- `apps/client/src/ui/DeathScreen.ts`, `DeathScreen.test.ts` — the card and its
  curated rows.
- `apps/client/src/ui/plantStats.ts` — formatters exported for the death card.
- `apps/client/src/renderers/WorldDrops.ts`, `WorldDrops.test.ts` — the husk and
  slope-aligned contact shadows; one body plus offcuts per pile of remains.
- `apps/client/src/renderers/drawnGround.ts`, `drawnGround.test.ts` — the drawn
  mesh's height and plane normal.
- `apps/client/src/renderers/PlantContactShadows.ts`, `PlantFootprints.test.ts` —
  `plantFootprints`, the above-soil footprint rule.
- `apps/server/src/ops/damage/damagePipeline.ts`, `damagePipeline.test.ts` — the
  death's drops lie around the body.
- `apps/client/src/renderers/PlantContactShadows.ts`,
  `PlantContactShadows.test.ts` — one contact patch per plant, in the ground
  plane.
- `apps/client/src/renderers/MeshPlantRenderer.ts`, `PlantRenderer.ts` — builds a
  footprint from each plant's lowest node, forwards the terrain normal, and keeps
  the patches visible and disposed with the body.
- `docs/protocol.md`, `docs/bug-inventory.md`, `docs/history.md`,
  `docs/what-works-now.md`, `CONTEXT.md`, `docs/tasks/README.md`.
