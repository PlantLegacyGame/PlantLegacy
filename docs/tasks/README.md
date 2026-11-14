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

## Current priority (2026-11-14)

`pnpm verify` is green. Work order is fixed by ADR-023, amended by ADR-026
through ADR-029 and by ADR-041/ADR-048:

1. AL-01 then AL-03 — client measurement (benchmark, six fixed poses, GPU
   timing, zero-alloc audit) and the GPU-band quality controller.
2. Atmosphere, audio and scatter polish (Wave 0 after measurement).
3. Remaining C02b work. Shared depth is **not** a C02b blocker: ADR-041 gates it
   on volumetric terrain (T56).

Full programme: [`../PlantLegacy-Abyssal-Integration-Plan.md`](../PlantLegacy-Abyssal-Integration-Plan.md).

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
| C02b | WebGPU Compute-Driven Plant Renderer | `[ ]` v1 slice + impostor baking (readRenderData-driven, 16-view texture array + atlas copy) + VRAM pool budgeting (256MB default, allocateOrThrow) + GPU skinning for 0.9s emergence + texture arrays (Bark/Leaf/Flower/SporeSac/Seed) + cross-fade between tiers 1↔2 (blendFactor in PlantRenderData, mesh fades out, billboard fades in); mutation signatures (per-node mask, three documented signatures); planet-body occlusion in the cull pass; missing: shared depth between the WebGPU plant pass and the WebGL environment pass (separate canvases; no browser exposes WebGL depth to WebGPU without a readback) | [C02b.md](./C02b.md) |
| C02c | Client physics and collider budgets | `[ ]` no task record yet; `config/physics.json` owns the values (`owner_task: C02c`) | — |
| D01 | Dev settings engine | `[x]` `?dev=1` gate, server `/dev/config` endpoints, `config/dev.json`, DevPanel wired to server, persistence switch wired to disconnect logic, key binding added | [D01.md](./D01.md) |
| T05 | Communication | `[x]` Proximity/world chat, data-driven emotes, block and report. Record written retrospectively 2026-11-14; report entry points on non-chat surfaces await T14/T43/T08A/T29 | [T05.md](./T05.md) |
| T08A | Inventory | `[ ]` **partial, non-compliant** — item definitions, stacking and protocol 24–28 exist, but the inventory is in-memory, has no Postgres transactions or row locks, and `item_flags.json` is a stub — DESIGN T08A forbids in-memory inventories | [T08A.md](./T08A.md) |
| — | Bugfix: camera, environment, growth | `[x]` Unindexed run of fixes; record kept as evidence | [bugfix-camera-environment-growth.md](./bugfix-camera-environment-growth.md) |

## Approved V5.4 tasks (not started)

These are post-alpha extensions, approved 2026-11-09. The full specs are in
`DESIGN.md` Part 11; the index and rationale are in
[`../PlantLegacy-Abyssal-Integration-Plan.md`](../PlantLegacy-Abyssal-Integration-Plan.md) §0.3 and §12. Create task records
when each task starts.

| Task | Name | Status | Spec |
|---|---|---|---|
| T54 | Reactive Fauna | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| T55 | Material Simulation | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| T56 | Volumetric Terrain | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| C10 | Volumetric Terrain and Material Rendering | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| T57 | Parametric Terrain Features | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| T58 | World Object Streaming and Behaviour | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| T59 | Ecological Succession and Failsafes | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |
| C11 | Reactive Fauna Rendering | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |

## Programme documents

- [`../PlantLegacy-Abyssal-Integration-Plan.md`](../PlantLegacy-Abyssal-Integration-Plan.md)
  — work packages, waves, risks and acceptance for extending the world. Owns no
  task specs; links to DESIGN Part 11.
- [`../abyssal-mechanisms.md`](../abyssal-mechanisms.md) — technique reference
  (Abyssal Garden mechanisms P L may adopt, and what must change).
- [`../decisions.md`](../decisions.md) — ADR-041 to ADR-049 record the 2026-11-14
  review: deferred renderer unification, L2 ellipsoid/L3 atlas, scoped terrain
  slice, burial calamity, two water slices, full trait model, fauna before
  terrain, measurement-first order, and reference-only documentation.
| O04 | Cloud-Native World Orchestration | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |

## Naming

`docs/tasks/<TASK_ID>.md` — for example `T03P.md`, `C01.md`, `O02.md`.
Manual checklists live in `docs/checklists/<TASK_ID>-manual.md`.