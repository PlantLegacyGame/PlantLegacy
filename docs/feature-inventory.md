# Feature inventory

One row per feature the game contains. This is the index the bug work hangs off:
every defect in [`bug-inventory.md`](./bug-inventory.md) names the feature row it
belongs to, so a fix lands on a system and a system cannot be audited twice.

What this file is not: it does not restate a defect, a tunable or a task spec.
Defects live in `bug-inventory.md`, values in `config/`, task scope in `DESIGN.md`.

## How to use a row

- **Status:** `✔` working and exercised, `◐` partial or a fix that has not been
  verified in a browser, `✗` not built.
- **Open issues:** defect ids from `bug-inventory.md`, or a short pointer to the
  plan row that owns the work. `—` means none known.
- **Next action:** the single next thing, if the row is not done.
- **Pri:** `P0` blocks play or is being worked now, `P1` next, `P2` later, `P3`
  complete enough to leave alone.
- Close a row only with a named test or a committed capture; update the row in
  the same change as the fix.

## Entry and accounts

| ID | Feature | Task | Code home | Status | Open issues | Next action | Pri |
|---|---|---|---|---|---|---|---|
| F01 | Title scene, mascot, weather and sound | C01/C03 | `ui/MainMenu.ts`, `ui/title/` | ✔ | A02 rebuild; occasional 180–230 ms title tick | A01 palette, then A02 | P1 |
| F02 | Entry flow (booting → title → sign in/up → connecting → world → plant lost) | C01 | `ui/EntryFlowStateMachine.ts` | ✔ | 2-C loading and error states | — | P2 |
| F03 | Guest play, nickname and display name | C01 | `ui/MainMenu.ts`, `state/localProfile.ts` | ✔ | — | — | P3 |
| F04 | Accounts: Argon2id, JWT access/refresh, rate limits, lockout | T08C | `ops/accounts/` | ✔ | 4-A: live-session check, lockout reset, username normalisation, trusted proxies | 4-A | P1 |
| F05 | One session per account (`SESSION_REPLACED`) | T08C | `ops/accounts/service.ts` | ✔ | — | — | P3 |
| F06 | Server-unreachable overlay and retry | C01 | `ui/ServerUnreachableOverlay.ts` | ✔ | 2-C readable error mapping | — | P2 |
| F07 | Title world clock from the server hour | C03 | `environment/worldClock.ts`, `GET /world/time` | ✔ | — | — | P3 |

## Connection and world

| ID | Feature | Task | Code home | Status | Open issues | Next action | Pri |
|---|---|---|---|---|---|---|---|
| F08 | WebSocket protocol v4 handshake | T03P | `ops/net.ts`, `shared/protocol` | ✔ | INV-NET-16 client keeps its own message table | — | P2 |
| F09 | 20 Hz tick, STATE/KEYFRAME cadence, broadcast budget | T03 | `tick/`, `broadcastCadence.ts` | ✔ | 1-B live check blocked | — | P2 |
| F10 | Interest management and per-client entity caps | T03 | `ops/interestManager.ts` | ✔ | DEF-11 partial | — | P2 |
| F11 | Reclaim, reconnect window and away deltas | T03 | `main.ts`, `ops/persistence/` | ✔ | — | — | P3 |
| F12 | Input heartbeat (camera is client-side) | T03P | `main.ts`, `shared/protocol` | ✔ | by design | — | P3 |
| F13 | Payload validation on both boundaries | T03P | `shared/protocol/messageSchemas.ts` | ✔ | — | — | P3 |
| F14 | HTTP `/health`, `/ready`, `/config/*` | O01/C01 | `ops/health.ts`, `main.ts` | ✔ | — | — | P3 |
| F15 | In-process event bus and tick-budget metrics | T03 | `ops/eventBus.ts`, `tick/` | ✔ | — | — | P3 |

## Growth and resources

| ID | Feature | Task | Code home | Status | Open issues | Next action | Pri |
|---|---|---|---|---|---|---|---|
| F16 | Player-triggered, resource-gated germination | T01 | `ops/plantWorld.ts`, `growth/rules.ts` | ✔ | E2 closed | — | P3 |
| F17 | Typed node growth, gene clamp, bounds | T01 | `shared/growth/`, `ops/growth/` | ✔ | E7, E11–E13, E15, E16 closed | — | P2 |
| F18 | Server-authoritative growth options and cost quote | T01 | `ops/growth/options.ts` | ✔ | E9, F22, F23 closed | — | P3 |
| F19 | Growth aim gizmo (ring, arrow, ghost, clamp badge) | T01 | `ui/GrowthSelectionStateMachine.ts`, `render/growthAimGizmo.ts` | ◐ | G6–G9 unverified; G01/G02 | Three-axis manipulator | P0 |
| F20 | Energy, photosynthesis, upkeep and biomass | T01 | `ops/plantWorld.ts` | ✔ | E5 silent tissue loss [?] | — | P2 |
| F21 | Resource tiles: light, moisture, minerals, diffusion, deposits | T00A | `ops/resourceWorld.ts`, `tileAddressing.ts` | ✔ | — | — | P3 |
| F22 | Plant and node health, wilt appearance | C04 | `ui/plantHealth.ts`, `plant/organShading.ts` | ✔ | E14 closed | — | P3 |
| F23 | Death and the death screen | C04 | `ui/DeathScreen.ts`, `PLANT_REMOVED` | ✔ | — | — | P3 |
| F24 | Onboarding and contextual hints | T00A | `ui/ContextHint.ts`, `config/onboarding.json` | ✔ | — | — | P3 |
| F25 | Season clock and `SEASON_UPDATE` | T03/T07 | `ops/weather`, `main.ts` | ◐ | Calamity director unbuilt (ADR-078) | — | P2 |

## Mutations

| ID | Feature | Task | Code home | Status | Open issues | Next action | Pri |
|---|---|---|---|---|---|---|---|
| F26 | Mutation table, adaptive pressure, acquisition | T04 | `ops/mutations/` | ✔ | Translocation unbuilt | — | P3 |
| F27 | Mutation upkeep with a biomass floor | T04 | `ops/plantWorld.ts` | ✔ | E6 closed | — | P3 |
| F28 | Mutation shedding and cooldown | T04 | `ops/plantWorld.ts` | ✔ | — | — | P3 |
| F29 | Level-up cards (`MUTATION_LEVEL`) | T04 | `ops/mutations/service.ts` | ✔ | — | — | P3 |
| F30 | Visual signatures and the mutation panel | T04 | `config/mutation_visuals.json`, `ui/MutationPanel.ts` | ✔ | C1–C10 closed | — | P3 |
| F31 | Dev mutation gallery | T04 | `ops/plantWorld.ts` | ✔ | — | — | P3 |

## Damage and uproot

| ID | Feature | Task | Code home | Status | Open issues | Next action | Pri |
|---|---|---|---|---|---|---|---|
| F32 | Four-source damage pipeline | T06 | `ops/damage/` | ✔ | E1 closed | — | P2 |
| F33 | Structural damage and uproot thresholds | T06 | `ops/damage/damagePipeline.ts` | ◐ | In-browser checklist never run | Checklist | P1 |
| F34 | Reroot crawl, steering and starvation | T06 | `ops/damage/`, `ui/PlayerPanels.ts` | ◐ | Substrate multiplier 1.0; G1–G5, R15 closed | — | P2 |
| F35 | Tumbling | T06 | `config/tumbling.json`, `damagePipeline.ts` | ◐ | Integrates on a flat plane (3-B) | — | P2 |
| F36 | Kill credit | T06 | `ops/damage/` | ✔ | — | — | P3 |
| F37 | Scripted herbivore swarms | T06 | `ops/damage/`, `FAUNA_EVENT` | ✔ | — | — | P3 |
| F38 | Damage vignette and factual cue | C04 | `ui/damageCue.ts` | ✔ | F14 closed | — | P3 |

## Economy and inventory

| ID | Feature | Task | Code home | Status | Open issues | Next action | Pri |
|---|---|---|---|---|---|---|---|
| F39 | Spore purse: earn, spend, cap | T13 | `ops/spores.ts`, `config/spores.json` | ✔ | — | — | P3 |
| F40 | Shop catalogue and server-checked purchase | C05 | `ops/shop.ts`, `ui/ShopPanel.ts` | ✔ | — | — | P2 |
| F41 | Pouch, ten slots, hotbar and number keys | T08A | `ui/Hotbar.ts`, `player_state` | ◐ | Item use and slot swap not RMW | T08A | P0 |
| F42 | Item definitions, names and Use | T08A | `config/items.json`, `ops/items.ts` | ◐ | I1/I2 browser pass | Verify in browser | P1 |
| F43 | `player_state` restart copy of pouch and purse | T08A | `ops/persistence/`, `accounts` | ✔ | Awards still follow the live object | T08A | P2 |
| F44 | World drops: spawn, expire, collect | T06/T08A | `renderers/WorldDrops.ts`, `ops/dropPickup.ts` | ✔ | T06 checklist | — | P2 |
| F45 | Spore chip and purse HUD | T13 | `ui/SporeChip.ts` | ✔ | — | — | P3 |

## Social

| ID | Feature | Task | Code home | Status | Open issues | Next action | Pri |
|---|---|---|---|---|---|---|---|
| F46 | World and proximity chat | T05 | `config/chat.json`, chat UI in `main.ts` | ✔ | D1/D2 closed | — | P3 |
| F47 | Data-driven emotes and the emote wheel | T05 | `config/emotes.json`, `main.ts` | ✔ | — | — | P3 |
| F48 | Block a player | T05 | `main.ts`, server session state | ✔ | Session-only persistence | — | P3 |
| F49 | Report with context snapshot | T05 | `config/reports.json`, modal in `main.ts` | ✔ | Other surfaces await T14/T43/T29 | — | P3 |

## World and rendering

| ID | Feature | Task | Code home | Status | Open issues | Next action | Pri |
|---|---|---|---|---|---|---|---|
| F50 | Planet sphere, 620 m terrain, exact colliders | T25/C03b | `environment/planetSurface.ts`, `ground.ts` | ◐ | D02: no interior volume | T56 volume | P0 |
| F51 | Sparse soil edits, root tunnels, collapse | T25 | `terrain/terrainState.ts`, `TERRAIN_EDITS` | ◐ | Client height texture (3-A); D02 | — | P1 |
| F52 | Spherical tile addressing and resource grid | T25 | `shared/world/sphericalGrid.ts` | ✔ | No dense planet grid (by design) | — | P3 |
| F53 | Raymarched SDF organism renderer | C02 | `renderers/PlantRenderer.ts`, `plant/` | ✔ | — | — | P2 |
| F54 | WebGPU compute LOD, impostors, skinning | C02b | `renderers/webgpu/` | ◐ | Shared depth missing (ADR-041) | — | P2 |
| F55 | Mesh L0/L1 renderer and organ junctions | C02/C02b | `MeshPlantRenderer.ts`, `PlantMeshBuilder.ts` | ◐ | G03 adhesion and taper | G03 | P0 |
| F56 | Quality controller, LOD tiers, GPU timer | C01/P0 | `render/QualityController.ts`, `GpuTimer.ts` | ✔ | — | — | P2 |
| F57 | One-tick plant interpolation | P0/2-B | `render/PlantInterpolation.ts` | ◐ | Dormant visual cue | — | P2 |
| F58 | Sky, sun/moon arcs, atmosphere and fog | C03 | `environment/atmosphere.ts`, `celestial.ts` | ✔ | A03 needs HDR/post | — | P1 |
| F59 | Rain, snow, lightning and server strikes | C03/T07 | `rainSystem.ts`, `lightningBolt.ts` | ✔ | F16, F20, F21 closed | — | P2 |
| F60 | Water: film, table, river, sea, underwater | T31/C03 | `environment/waterField.ts`, `waterMaterial.ts`, `ocean.ts` | ◐ | D01/D04: still surfaces | T55 water | P0 |
| F61 | Root Sight cutaway, aperture, bowl, occlusion | T02 | `rootSight/`, `environment/cavity/` | ◐ | A1, A8, R1–R5, U03 | D02 real geometry | P0 |
| F62 | Surface cutaway and coverage edge | T25/C03 | `environment/ground/shaderOverrides.ts` | ◐ | D02 removes the discard | — | P1 |
| F63 | Ink, outlines and organ shading | C02 | `plant/organShading.ts`, `plant/mutations.ts` | ✔ | C120–C133 closed | — | P3 |
| F64 | Camera rig: orbit, pan, zoom, recenter, clamps | C01 | `main.ts` camera block, `player/cameraAim.ts`, `player/cameraOrbit.ts`, `player/recenterView.ts` | ◐ | U01, U02, U05 fixed and measured; U04 | Free camera after D02 | P0 |
| F65 | Underwater medium | T31 | `environment/underwater.ts` | ◐ | D04 volume | — | P2 |

## Interface

| ID | Feature | Task | Code home | Status | Open issues | Next action | Pri |
|---|---|---|---|---|---|---|---|
| F66 | UI shell, layers, tokens, text scale, toasts | C01 | `ui/UIShell.ts`, `config/ui.json` | ✔ | Three styling systems | A01: HUD ramps and tokens come from the palette; title/menu ramps (A02) open | P2 |
| F67 | Vitals card, world clock, weather chip | C04 | `ui/resourceVitals.ts` | ✔ | No per-row history | — | P3 |
| F68 | Plant status HUD and health | C04 | `ui/PlantStatusHud.ts` | ✔ | — | — | P3 |
| F69 | Action bar and contextual hints | C01/C04 | `ui/ActionBar.ts`, `ui/ContextHint.ts` | ✔ | — | — | P3 |
| F70 | Pause, Settings, Controls, accessibility | C04 | `ui/PauseMenu.ts`, `ui/SettingsPanel.ts` | ◐ | Rebinding screen, notification log | C04 closeout | P1 |
| F71 | Inspect and inventory panels, rival inspect | C04/T08A | `ui/PlayerPanels.ts` | ✔ | D4 no shared panel primitive | — | P1 |
| F72 | Hover tips, node picking, leaf cursors | C04 | `ui/PlantHoverTip.ts`, `nodePick.ts` | ✔ | — | — | P3 |
| F73 | Debug overlay, tick card, dev panel | C01/D01 | `ui/DebugOverlay.ts`, `ui/DevPanel.ts` | ✔ | — | — | P3 |
| F74 | Phone and touch layouts, touch copy | C04 | `ui/touchCopy.ts`, `styles.css` | ◐ | Growth aim touch gesture | — | P2 |
| F75 | Growth option cards | C01 | `ui/GrowthSelectionStateMachine.ts` | ✔ | — | — | P2 |
| F76 | Chat panel | T05 | `main.ts` `createChatUI` | ✔ | — | — | P3 |
| F77 | Emote wheel | T05 | `main.ts` `createEmoteWheel` | ✔ | — | — | P3 |
| F78 | Notification log | C04 | — | ✗ | — | C04 | P2 |

## Operations and development

| ID | Feature | Task | Code home | Status | Open issues | Next action | Pri |
|---|---|---|---|---|---|---|---|
| F79 | Config format, validator, rarity ban, key checker | T00 | `shared/config/`, `tools/config-validator` | ✔ | — | — | P3 |
| F80 | Docs guardrail and CI verify gate | O01 | `tools/docs-check`, `.github/workflows` | ✔ | — | — | P2 |
| F81 | Postgres probe, migrations, checksums | T03 | `ops/db.ts`, `ops/persistence/migrate.ts` | ✔ | F25 closed | — | P2 |
| F82 | Binary snapshots, event log, compaction | T03 | `ops/persistence/plantPersistence.ts` | ✔ | F24 closed | — | P2 |
| F83 | Dev panel, dev actions, `?dev=1` gate | D01 | `config/dev.json`, `ui/DevPanel.ts` | ✔ | — | — | P3 |
| F84 | Headless player bots | T26 | `tools/sim-bots/` | ✔ | — | — | P3 |
| F85 | Staging deploy (Pages + compose + tunnel) | O01 | `.github/workflows`, `ops/` | ◐ | Quick-tunnel URL churn | — | P2 |
| F86 | Audio system | C06 | `config/audio.json` (stub) | ✗ | Title creak only | — | P3 |
| F87 | Text catalogue and localisation | C01 | — | ✗ | Inline strings in builders | — | P3 |

## Approved, not built

T54 reactive fauna, T55 material simulation, T56 volumetric terrain, C10
volumetric terrain and material rendering, T57 parametric terrain features, T58
world-object streaming, T59 ecological succession, C11 fauna rendering, O04
orchestration. Their specs are `DESIGN.md` Part 11; `config/` has 49 stub systems
waiting for them (owned by `docs/tunables.md`).

## Defects

Defect rows are not kept here. [`bug-inventory.md`](./bug-inventory.md) is the
single home for *what is broken now*, with evidence; [`bugfix-plan.md`](./bugfix-plan.md)
orders the fixes. This sheet names the feature each one belongs to.
