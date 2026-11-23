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
| 5 | Camera underground and off the plant | `frameCameraOnPlant` trusted its target. A surface-relative point mapped before the terrain config was known (a reload's first WELCOME) put the pivot inside a hill, and relief reaches tens of metres | The framing target is floored at `clientSurfaceY(x, z, 0)` unless Root Sight is active, which is the one mode that frames a buried point on purpose. A changed plant id also clears the player-moved veto so the automatic refit runs |
| 6 | Cramped card, wrong numbers | `deathStatRows` was `plantStatRows`, the live panel's rows. Water, minerals, energy, health and growth rate describe a running plant; on a dead one they are zeroes and a stale rate. The card was 420 px with a two-column grid and its first action was to stay | A 520 px card with an eyebrow, the death sentence, a 1 px ember rule, an auto-fit stat grid and two buttons. `deathStatRows` is its own curated set: Cause, Killed by (when named), Age, Died on, Biomass, Peak biomass, Nodes, Peak nodes, and Mutations only when there were any. `PLANT_REMOVED` now carries the death record's `biomass` and `nodeCount`, so those two are current to the moment of death rather than the last STATE packet |

## 2. Config

No config file was added or changed. The protocol version stays 5: `RESPAWN` is a
new client request, and a client that does not send it behaves exactly as before.

## 3. Tests

| Test | What it pins |
|---|---|
| `ui/DeathScreen.test.ts` (5) | The card still leads with the cause; the curated rows and their order; cause and source wording; an unknown `killedBy` token stays readable; mutation upkeep appears only when the plant had mutations; the live vitals (Water, Minerals, Energy, Health, Growth rate) are never on the card. The old "the rows come from the shared stat owner" test asserted the behaviour this wave removed, and is replaced by one that pins the divergence from `plantStatRows` |
| `renderers/WorldDrops.test.ts` (+3, 10 total) | A disc's plane is the ground plane and it is lifted along the normal; two drops on different slopes get different orientations; a husk rests under 25 cm, does not bob and does not spin |
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
- The death card, the husk and the shadows were **not** looked at in a browser in
  this pass. What is verified is the logic above through the tests; what still
  needs an eye is the card's layout at a narrow pane, the husk's silhouette at
  drop size, and whether the reframed camera after "Grow a new seed" lands on the
  seed rather than hillside.

## 5. Files

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
  slope-aligned contact shadows.
- `docs/protocol.md`, `docs/bug-inventory.md`, `docs/history.md`,
  `docs/what-works-now.md`, `CONTEXT.md`, `docs/tasks/README.md`.
