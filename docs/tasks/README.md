# Task records

One file per task, written when the task is completed. A task record is the
evidence that the acceptance criteria in `DESIGN.md` were met — not a second
design document.

## Rules

1. **One task per session.** Do not start the next task in the same session
   (DESIGN.md, Session Protocol). T00 + O01 were the one sanctioned pair because
   O01 depends on T00 and both are Phase 0 foundation.
2. Mark the task `[x]` here and in its record only when the acceptance criteria
   are met. External criteria that need a remote (CI run, live staging URL) stay
   `[ ]` with a note until they are actually observed.
3. Every record contains: implementation summary, config files touched, a
   tunables table (type/range/default/effect), the manual test checklist result,
   and `CONTEXT.md` / `ATTRIBUTION.md` updates.
4. No hardcoded values (RULE_3). No `rarity` field (RULE_20). Account-bound flag
   invariant enforced (RULE_23).
5. Update `docs/what-works-now.md` at every gate.
6. A partial task stays `[ ]` and its record states exactly which acceptance
   criteria are met. Do not mark a slice as the whole task.

## Current priority (2026-11-22)

`pnpm verify` is green. Work order is fixed by ADR-023, amended by ADR-026
through ADR-029, ADR-041/ADR-048 and the 2026-11-21 scope choices (ADR-080):

1. **T08A** — finish the inventory contract. The `player_state` restart copy
   and row-locked write landed 2026-11-22 (buy → restart → reconnect verified);
   every pouch mutation is now a locked read-modify-write (purchase, item use,
   slot swap, spore award, dev grant) and the duplication audit passed.
   Config ownership is resolved (ADR-082). Record: [T08A.md](./T08A.md).
2. **ADR-044 burial** — dead biomass becomes organic matter.
3. **W6 water slices 1–2** — the accepted ADR-065 rebuild.
4. AL-01 then AL-03 — client measurement, per **ADR-050** (gameplay first).
5. Atmosphere, audio and scatter polish (Wave 0 after measurement).
6. Remaining C02b work. Shared depth is **not** a C02b blocker: ADR-041 gates it
   on volumetric terrain (T56).

The 90-day, zoned calamity director is designed in
[`docs/calamities.md`](../calamities.md) and ADR-078, but it is **not** in this
work order until persistence, C04 and the burial fix land. The pre-alpha
single-player itch.io demo is designed in ADR-079 and packaged as a
downloadable build that bundles the existing server. The calendar baseline is
**40 / 84 / 130 weeks** (DESIGN Part 16 item 4).

Specs for every task in this list are in [`DESIGN.md` Part 11](../../DESIGN.md).

## Status

| Task | Name | Status | Record |
|---|---|---|---|
| T00 | Foundation | `[x]` | [T00.md](./T00.md) |
| O01 | Repo and deploy pipeline | `[x]` | [O01.md](./O01.md) |
| T03P | Networking gate (Gate 0) | `[x]` transport and 20 Hz loop work; movement is camera-only (see the correction in T03P.md) | [T03P.md](./T03P.md) |
| C01 | Client foundation | `[x]` input abstraction, UI shell, quality tiers, debug overlay, pause-on-hidden, config routes | [C01.md](./C01.md) |
| T00A | Resource model + onboarding | `[x]` server and client resource model complete | [T00A.md](./T00A.md) |
| T01 | Growth (renderer prototype committed under this label) | `[x]` server-authoritative typed-node growth implemented; client sends GROWTH_INTENT, receives GROWTH_EVENT, renders growing plant via C02 renderer | [T01.md](./T01.md) |
| T03 | The Multiplayer World | `[x]` persistence, offline tiers (Active/Near/Dormant), interest management, event bus, tick-budget metrics, binary snapshot + event log | [T03.md](./T03.md) |
| T08C | Accounts and Sessions | `[x]` Argon2id, JWT access/refresh, rate limits, lockout, WebSocket auth | [T08C.md](./T08C.md) |
| C02 | Procedural Plant Renderer v1 | `[x]` Raymarched Signed Distance Fields (SDF) with polynomial smooth minimum (smin) organic fusion inside local bounding volumes; primitives fuse into a single continuous anatomical membrane | [C02.md](./C02.md) |
| T02 | Root Sight | `[x]` Two-mode camera and volumetric ground cutaway integrated with continuous SDF organism renderer; subterranean roots highlight in green/orange through cutaway | [T02.md](./T02.md) |
| T07 | Weather and Day/Night | `[x]` Server-authoritative day/night cycle, clear/rain/storm state machine with 3-phase thunderstorm cycle, forecast and soil moisture integration | [T07.md](./T07.md) |
| T25 | Terrain, colliders, physical dirt | `[ ]` Shared terrain/cavity fields, two-patch LOD ground with exact colliders, bounded plant colliders, root tunnels with collapse and persistence, protocol 32–34. Client height-texture application, debris/rain wiring and dev overlay pending | [T25.md](./T25.md) |
| C03b | Ground LOD and relief | `[x]` inner detail + 620 m outer patch from one shared field, exact trimesh colliders | [C03b.md](./C03b.md) |
| C03 | Environment Rendering | `[x]` Sky dome, sun/moon arcs, atmospheric fog, rain particles, storm lightning flashes, soil moisture/mineral tinting, and Root Sight cutaway refinement | [C03.md](./C03.md) |
| C04 | HUD and Controls v1 | `[x]` **Done 2026-11-22.** Health-word HUD (biomass/rate, health, mutations, `Day N` clock and forecast), damage vignette/toast, reroot countdown and camera-relative D-pad + movement-key steering, Inspect/Inventory side panels with per-node health, Settings/Controls tabs, per-device key rebinding, recent-activity notification log, death-screen stats, server `structure` and `dayNumber` fields. In-browser UI checklist passed (damage/uproot mechanics are T06's). | [C04.md](./C04.md) |
| C02b | WebGPU Compute-Driven Plant Renderer | `[ ]` v1 slice + impostor baking (readRenderData-driven, 16-view texture array + atlas copy) + VRAM pool budgeting (256MB default, allocateOrThrow) + GPU skinning for 0.9s emergence + texture arrays (Bark/Leaf/Flower/SporeSac/Seed) + cross-fade between tiers 1↔2 (blendFactor in PlantRenderData, mesh fades out, billboard fades in); mutation signatures (per-node mask, three documented signatures); planet-body occlusion in the cull pass; missing: shared depth between the WebGPU plant pass and the WebGL environment pass (separate canvases; no browser exposes WebGL depth to WebGPU without a readback) | [C02b.md](./C02b.md) |
| C02c | Client physics and collider budgets | `[ ]` no task record yet; `config/physics.json` owns the values (`owner_task: C02c`) | — |
| D01 | Dev settings engine | `[x]` `?dev=1` gate, server `/dev/config` endpoints, `config/dev.json`, DevPanel wired to server, persistence switch wired to disconnect logic, key binding added | [D01.md](./D01.md) |
| T05 | Communication | `[x]` Proximity/world chat, data-driven emotes, block and report. Record written retrospectively 2026-11-14; report entry points on non-chat surfaces await T14/T43/T08A/T29 | [T05.md](./T05.md) |
| T04 | Mutation | `[~]` **Partial.** Data-driven table (36 mutations), adaptive pressure over 8 categories with decay, scaled maintenance that can kill, shedding with cooldown and penalty, `mutation_acquired`/`mutation_shed`, PLNT v2, protocol v2 messages, 12 visual signatures, unlocked node types, size/growth-speed/diet effects. **Open:** translocation (post-MVP locomotion); `movement.reroot_speed` is consumed by T06 since 2026-11-15 | [T04.md](./T04.md) |
| T06 | Uproot, damage, tumbling | `[~]` Implemented server-side: four-source damage pipeline, saturation/gust/collapse/structural uproot, reroot crawl and starvation, deterministic tumbling, kill credit, world drops, protocol 37–43, PLNT v3, client redraw and dev buttons. **Open:** in-browser checklist not run; T02 substrate multiplier is still 1.0. Drop collection is live (`DROP_COLLECT`, `ops/dropPickup.ts`); persistence of the pouch/purse is T08A | [T06.md](./T06.md) |
| T08A | Inventory | `[~]` **Partial; restart copy and every pouch mutation row-locked.** `player_state` persists pouch and purse per account, loaded before HELLO and written inside each locked mutation, with saves on disconnect/shutdown; verified by buy → server restart → reconnect, a two-concurrent-purchase audit, and the item-use, award, clamped-write and dev-grant checks in `playerStateAudit.ts`. The duplication audit passed (no bypass; one dead award helper removed). Still open: the trade/mail/list systems. `items.json` owns the flags (ADR-082) | [T08A.md](./T08A.md) |
| — | Bugfix: camera, environment, growth | `[x]` Unindexed run of fixes; record kept as evidence | [bugfix-camera-environment-growth.md](./bugfix-camera-environment-growth.md) |
| C21-B | The twenty-one defects, Wave B | `[x]` Items 5, 6, 8, 18, 20: world-anchored precipitation with six-arm snow, terrain-hugging splash crowns with spray (hidden from below), a planetary climate field with orographic lift and rare storms replacing the global Markov chain, and protocol v5 `LEDGER_ENTRY` for every purse change. 30-day climate simulation with snow-in-winter asserted, a full live spring day (which found and fixed the seasonal curve, orographic distance and humidity centre), a driven winter night with live snow in the server log, and measured browser pass. Wave C is started as the first T56 volume slice; Waves D–E are planned, not started | [bugfix-c21b.md](./bugfix-c21b.md) |
| — | Bugfix: death, respawn and what is left behind | `[x]` Protocol `RESPAWN` (49) starts a new seed on the same socket; the death card's primary action grows again in place, the husk that replaces the bone lies still on the soil, drop shadows lie in the ground plane, the framing target can no longer sit under the terrain, and the card reports the death record's own biomass and node count instead of the live panel's zeroes. A second pass seats every contact shadow on the *drawn* terrain mesh instead of the height field (they differed by tens of centimetres on a bank), takes a plant's patch from parts at or above the soil, and leaves one hand-long body plus smaller offcuts rather than four stacked corpses. Driven in the dev browser: card, husk, drop and plant patches on a bank, the respawn framing, gallery patches 0.22-0.35 m against a seed's 0.20, and the body's plate 1.0 cm above the drawn ground; the narrow-pane card, a rival's view and the final husk size after it was enlarged were not checked | [bugfix-death-respawn.md](./bugfix-death-respawn.md) |
| C21-A | The twenty-one defects, Wave A | `[x]` Items 1, 2, 3, 9, 10, 11, 12, 15, 16, 19: title orb ordering and backstep hold, persistent drag, config home zoom, no public regenerate key, target-derived pan heading, free camera rig (`camera_mode`), named rival owners, distance-scaled tags, day-part clock. 25 tests and a measured browser pass. Waves B–E (weather, volume terrain, items/palette, the planet) are planned, not started | [bugfix-c21.md](./bugfix-c21.md) |

## Approved V5.4 tasks (not started)

These are post-alpha extensions, approved 2026-11-09. The full specs are in
`DESIGN.md` Part 11 and the rule amendments in Part 16; create a task record
when each task starts.

| Task | Name | Status | Spec |
|---|---|---|---|
| T54 | Reactive Fauna | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| T55 | Material Simulation | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| T56 | Volumetric Terrain | `[~]` **Partial, 2026-11-23:** one authored region is real 3D volume — a signed-distance field meshed by surface nets (2 078 vertices, welded, gradient normals), with an underside, an arch, deterministic strata and a config-owned field. Chunking, per-voxel materials, collision, persistence, LOD, streaming and the Root Sight interior are not built | [T56.md](./T56.md) |
| C10 | Volumetric Terrain and Material Rendering | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| T57 | Parametric Terrain Features | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| T58 | World Object Streaming and Behaviour | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| T59 | Ecological Succession and Failsafes | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| C11 | Reactive Fauna Rendering | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |

## Programme documents

- [`../abyssal-garden-source-analysis.md`](../abyssal-garden-source-analysis.md)
  — what Abyssal Garden's source actually does, what is worth taking from it, and
  the order the renderer work should happen in (Part II §15).
- [`../decisions.md`](../decisions.md) — ADR-041 to ADR-049 record the 2026-11-14
  review: deferred renderer unification, L2 ellipsoid/L3 atlas, scoped terrain
  slice, burial calamity, two water slices, full trait model, fauna before
  terrain, measurement-first order, and reference-only documentation.
| O04 | Cloud-Native World Orchestration | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |

## Naming

`docs/tasks/<TASK_ID>.md` — for example `T03P.md`, `C01.md`, `O02.md`.
Manual checklists live in `docs/checklists/<TASK_ID>-manual.md`.