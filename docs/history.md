# History

A terse, append-only log of what changed and why. **Not reference material:**
nothing here describes current state. For how the system works today read
`CONTEXT.md`, `docs/what-works-now.md` and the task records; for rulings read
`docs/decisions.md`; for the exact text of an old change, `git log` has it.

One line per dated event. Detail that used to live here (audit narratives, the
old remediation plan, the v5.3.1 merge audit) is preserved in git history at the
commit that introduced this file.

## Design revisions

- **v5.3.1 (2026-11-09).** Thirteen reviewed corrections, no behavioural change:
  checkpoint table rebuilt (max gap four weeks), Gate 3 arithmetic fixed, the
  T25/T26 and T14/T43 cut-list conflicts resolved, Root Sight shader ownership
  given to T02, H01 decoupled from the real-money switch, stale `A…` references
  replaced, T15 extraction text corrected, vocabulary rows aligned with built
  systems, dependency matrix completed, duplicate Part 8.2 heading removed,
  RULE_16 checkpoint weeks corrected, heirloom-seed planting separated from T53.
- **v5.3.2 (2026-11-14).** Three internal contradictions corrected: the
  impostor representation and its VRAM row, the billboard/atlas clause in C02,
  and the three competing LOD tier schemes (now one canonical table, Part
  14.2.0). Also records that a season-end calamity is a burial under RULE_8.
  ADR-041 to ADR-049.
- **A-reference map.** v5.3.1 replaced every standalone `A5.2`/`A8.1`/`A13-*`
  style reference with a real Part/Task reference. None remain.

## Timeline

| Date | What changed | Evidence |
|---|---|---|
| 2026-11-06 | First audit. Four networking defects found: oversized `RESOURCE_UPDATE`, broken anonymous reconnect, own plant never applied from sync, `PLANT_REMOVED` fired on disconnect. | Fixed 2026-11-09; ADR-021, ADR-024 |
| 2026-11-08 | State-machine and invariant audit written: 12 implicit machines, 72 invariants, 16 confirmed defects; P0–P3 remediation plan. | `state-machines-and-invariants.md` ids |
| 2026-11-08 | Weather durations, upkeep double-subtraction, diffusion, persistence tier/lastTick, session limit, tile clamping, HELLO timeout, max-node check, seed growth gate, `RESOURCE_QUERY` shape fixed. | DEF-01…DEF-16 |
| 2026-11-09 | P0 blockers closed: plant sync and germination payloads, anonymous reclaim keying, delayed `PLANT_REMOVED`, two-step gene-gated growth, energy vs biomass, dt-scaled root damage, real tile moisture; cube avatar removed. | ADR-018, 019, 021, 022, 024, 025 |
| 2026-11-09 | Save format versioned (magic, version, length, CRC32, mode), seeded deterministic RNG for rendering, auth hardening: rotation order, atomic rate-limit upsert, prod JWT requirement, lockout extension. | `history` of T03/T08C |
| 2026-11-10 | Phase-1 formalization wired: reconnect and growth-intent state machines, `ConnectionRegistry`, `TickClock`; spawn collision, tier-limited root damage, single-sourced persistence. | 119 → 181 server tests |
| 2026-11-12 | Tick clock kept wall time (was running ~8.7 of 20 ticks/s); soil moisture raised; growth panel moved off the chat box. | 20.0 ticks/s, 3 597 s cycle |
| 2026-11-12 | Documentation audit: protocol through type 30, counts recomputed, Argon2id vs bcrypt corrected, T03P movement claim corrected. | `history` only |
| 2026-11-13 | Hardening pass: per-connection message budget, dev endpoints local-only, save on disconnect, honest offline simulation, offline plants visible, per-player `STATE`/`KEYFRAME`, entry screen rebuilt on HUD tokens, logout, guest-plant adoption, away report, income-first upkeep, dev actions truthful, death-while-away report, calendar persisted (`world_state`), seasons end as an event, `SESSION_REPLACED`. | migration 005; 6+5 visibility/ownership tests |
| 2026-11-13 | Planet world stage 1: 100 km sphere as ground and physics floor, plants dropped to the surface, soil shader owns the cutaway, planet view, gravity/up derived, spherical tile addressing, resource field on spherical cells. | 9 + 10 tests; `planetSurface.ts`, `sphericalGrid.ts` |
| 2026-11-13 | T25: one shared terrain field, inner + 620 m outer patch colliding on drawn vertices, per-plant capsule colliders, sparse 32×32 soil chunks with voids, protocols 32–34. | migration 006 |
| 2026-11-14 | Abyssal review: nine decisions, ADR-041 to ADR-049 (unified renderer deferred, L2 ellipsoid/L3 atlas, terrain slice, calamity as burial, two water slices, full traits, fauna before volumetric terrain, measurement first, two-document discipline). | `decisions.md` |
| 2026-11-14 | Documentation consolidated: one home per fact, `deploy.md`, `history.md`, tunables slimmed to an index, duplicate T51 spec removed, `pnpm docs:check` added. | commit `6e535c0` |
| 2026-11-14 | `history.md` itself compressed to this log; the abyssal config appendix reduced to key names. | this commit |

## Retired: state-machine remediation

The P0–P3 remediation plan and its progress log lived here. Phases 0–2 were
completed or folded into the task records; phase 3 items (broadcast throttling,
interest-cell wiring) remain tracked as `INV-TM-09` and `INV-TM-10` in
`docs/state-machines-and-invariants.md`, which is the only current status
source.
