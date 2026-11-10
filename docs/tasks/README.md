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

## Current priority (2026-11-07 audit)

`pnpm verify` is red, so no task is done. Work order is fixed by ADR-023 and
amended by ADR-026 through ADR-029:

1. P0 blockers: player-triggered germination gate, server-authoritative growth
   options, close camera framing and WASD pan, stale G/cube removal, session-only
   persistence, lint green.
2. D01 dev settings engine (every toggle and tunable behind `?dev=1`).
3. C02b gaps and acceptance criteria.
4. T05 Communication.
5. Visual and onboarding polish.

## Status

| Task | Name | Status | Record |
|---|---|---|---|
| T00 | Foundation | `[x]` | [T00.md](./T00.md) |
| O01 | Repo and deploy pipeline | `[x]` | [O01.md](./O01.md) |
| T03P | Networking gate (Gate 0) | `[x]` transport and 20 Hz loop work; velocity/bounds rejection effective and tested | [T03P.md](./T03P.md) |
| C01 | Client foundation | `[x]` input abstraction, UI shell, quality tiers, debug overlay, pause-on-hidden, config routes | [C01.md](./C01.md) |
| T00A | Resource model + onboarding | `[x]` server and client resource model complete | [T00A.md](./T00A.md) |
| T01 | Growth (renderer prototype committed under this label) | `[x]` server-authoritative typed-node growth implemented; client sends GROWTH_INTENT, receives GROWTH_EVENT, renders growing plant via C02 renderer | [T01.md](./T01.md) |
| T03 | The Multiplayer World | `[x]` persistence, offline tiers (Active/Near/Dormant), interest management, event bus, tick-budget metrics, binary snapshot + event log | [T03.md](./T03.md) |
| T08C | Accounts and Sessions | `[x]` argon2id, JWT access/refresh, rate limits, lockout, WebSocket auth | [T08C.md](./T08C.md) |
| C02 | Procedural Plant Renderer v1 | `[x]` Raymarched Signed Distance Fields (SDF) with polynomial smooth minimum (smin) organic fusion inside local bounding volumes; primitives fuse into a single continuous anatomical membrane | [C02.md](./C02.md) |
| T02 | Root Sight | `[x]` Two-mode camera and volumetric ground cutaway integrated with continuous SDF organism renderer; subterranean roots highlight in green/orange through cutaway | [T02.md](./T02.md) |
| T07 | Weather and Day/Night | `[x]` Server-authoritative day/night cycle, clear/rain/storm state machine with 3-phase thunderstorm cycle, forecast and soil moisture integration | [T07.md](./T07.md) |
| C03 | Environment Rendering | `[x]` Sky dome, sun/moon arcs, atmospheric fog, rain particles, storm lightning flashes, soil moisture/mineral tinting, and Root Sight cutaway refinement | [C03.md](./C03.md) |
| C02b | WebGPU Compute-Driven Plant Renderer | `[ ]` v1 slice: real WebGPU buffers/shaders, compute culling + hysteresis LOD, tier 0/1 merged mesh, tier 2–4 billboards, WebGL2 fallback; impostor baking, VRAM pools, GPU skinning, texture arrays, cross-fade, L2/L3 mutations, and shared depth still missing | [C02b.md](./C02b.md) |
| D01 | Dev settings engine | `[ ]` client DevPanel implemented (7 tabs, full UI); missing `?dev=1` gate, server `/dev/config` endpoints, `config/dev.json`, persistence switch wiring | [D01.md](./D01.md) |

## Approved V5.4 tasks (not started)

These are post-alpha extensions, approved 2026-11-09. The full specs are in
`DESIGN.md` Part 11; the index and rationale are in
[`../v5.4-extension-plan.md`](../v5.4-extension-plan.md). Create task records
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
| O04 | Cloud-Native World Orchestration | `[ ]` approved (not started) | [DESIGN.md Part 11](../../DESIGN.md) |

## Naming

`docs/tasks/<TASK_ID>.md` — for example `T03P.md`, `C01.md`, `O02.md`.
Manual checklists live in `docs/checklists/<TASK_ID>-manual.md`.
