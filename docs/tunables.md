33 |28 |14 |1 |14 |# Tunables

Every gameplay and ops value lives in `config/<system>.json` (RULE_3). This page
is the index: which file owns which system, what is populated today, and how many
entries each file declares. The values themselves stay in the config files.

Machine-readable source: the files themselves. The validator is
`packages/shared/src/config/validate.ts`.

## Format

```json
{
  "_meta": {
    "system": "ops",
    "version": "0.1.0",
    "schema": "extended-1",
    "owner_task": "O01",
    "status": "active",
    "notes": "…"
  },
  "values": {
    "port": { "type": "integer", "value": 8080, "range": [1024, 65535], "notes": "…" }
  }
}
```

- `value` **is** the default.
- Numeric entries require `range: [min, max]`, `min < max`.
- `status`: `stub` → declared, empty; `draft` → populated but not final;
  `active` → owned and used; `deprecated` → kept for migration only.
- A file's `_meta.system` must equal its filename.

### How to add a tunable

1. Add an entry to the owning file's `values`.
2. Give numbers a `range`, enums their members, strings a sensible `max_length`.
3. Read it in code through `readNumber` / `readBoolean` / `readString` — never
   inline the number.
4. Run `pnpm config:validate`.
5. Update this page if the file's status or value count changes.

## All config files

`values` counts entries currently declared. `0` means a deliberate T00 stub; the
owning task fills it.

| File | Owner | Status | Values |
|---|---|---|---|
| `account_progress` | T08B | stub | 0 |
| `accounts` | T08C | active | 27 |
| `achievements` | T08B | stub | 0 |
| `annotations` | T19 | stub | 0 |
| `anticheat` | T41 | stub | 0 |
| `archetypes` | T12 | stub | 0 |
| `audio` | C06 | stub | 0 |
| `boosters` | T13A | stub | 0 |
| `campaign` | T32 | stub | 0 |
| `chat` | T05 | active | 4 |
| `climate_memory` | T39 | stub | 0 |
| `clips` | T35 | stub | 0 |
| `companions` | T11 | stub | 0 |
| `compliance` | T00 | draft | 3 |
| `controls` | C01 | active | 7 |
| `damage` | T06 | active | 23 |
| `daynight` | T07 | active | 4 |
| `deep_time` | T20 | stub | 0 |
| `dev` | D01 | active | 14 |
| `emotes` | T05 | active | 1 |
| `epoch_map` | T37 | stub | 0 |
| `extraction` | T51 | stub | 0 |
| `fragments` | T51 | stub | 0 |
| `genes` | T15 | stub | 0 |
| `gift_bundles` | T45 | stub | 0 |
| `gift_packs` | T50 | stub | 0 |
| `gifts` | T29 | stub | 0 |
| `growth` | T01 | active | 66 |
| `growth_scale` | T23 | stub | 0 |
| `guilds` | T44 | stub | 0 |
| `heirlooms` | T06A | stub | 0 |
| `inventory` | T08A | stub | 0 |
| `item_flags` | T08A | stub | 0 |
| `items` | T08A | active | 7 |
| `leaderboards` | T38 | stub | 0 |
| `ledger` | T16 | stub | 0 |
| `liveops` | T42 | stub | 0 |
| `mail` | T45 | stub | 0 |
| `marketplace` | T14 | stub | 0 |
| `messaging` | T27 | stub | 0 |
| `minimap` | T48 | stub | 0 |
| `mutations` | T04 | active | 60 |
| `mutation_visuals` | T04 | active | 3 |
| `naming` | T17 | stub | 0 |
| `net_proto` | T03P | draft | 14 |
| `network` | T03 | active | 2 |
| `observation` | T28 | stub | 0 |
| `onboarding` | T00A | active | 3 |
| `ops` | O01 | active | 17 |
| `paid_spawn` | T21 | stub | 0 |
| `parasitism` | T10 | stub | 0 |
| `persistence` | T26 | stub | 0 |
| `physics` | C02c | active | 14 |
| `plant_renderer` | C02 | active | 33 |
| `prestige` | T08B | stub | 0 |
| `profiles` | T47 | stub | 0 |
| `relics` | T18 | stub | 0 |
| `render` | C01 | active | 132 |
| `reports` | T05 | active | 5 |
| `reproduction` | T53 | stub | 0 |
| `reputation` | T43 | stub | 0 |
| `resources` | T00A | draft | 50 |
| `root_sight` | T02 | active | 28 |
| `session` | T08 | stub | 0 |
| `shop` | C05 | active | 4 |
| `spectating` | T30 | stub | 0 |
| `spectating_ui` | T36 | stub | 0 |
| `spectator` | T34 | stub | 0 |
| `spores` | T13 | stub | 0 |
| `status` | T46 | stub | 0 |
| `symbiosis` | T09 | stub | 0 |
| `terrain` | T25 | active | 36 |
| `territory` | T49 | stub | 0 |
| `tumbling` | T06 | active | 10 |
| `tutorial` | T33 | stub | 0 |
| `ui` | C01 | active | 35 |
| `uproot` | T06 | active | 19 |
| `water` | T31 | active | 33 |
| `weather` | T07 | active | 19 |
| `world` | T03 | active | 17 |


Total: **80 files**; 30 populated and 50 stubs (3 of them `draft`).

**This line owns the count.** Other documents link here rather than quoting a
number (ADR-049).
Populated: `accounts`, `chat`, `compliance`, `controls`, `daynight`, `dev`, `emotes`, `growth`, `items`, `net_proto`, `network`, `onboarding`, `ops`, `physics`, `plant_renderer`, `render`, `reports`, `resources`, `root_sight`, `terrain`, `ui`, `water`, `weather`, `world`.

## Approved V5.4 config files (not created yet)

These are specified in `DESIGN.md` Part 11 and named in the tables below. They
are **not** in `config/` yet, so the validator count stays at 80.

| File | Owner | Purpose |
|---|---|---|
| `fauna.json` | T54 | Species, needs, senses, reflexes, animal vocalizations, influence maps, population caps, trap/struggle |
| `materials.json` | T55 | Material/element definitions, reaction matrix, CA cadence, flow and temperature rules |
| `terrain_volume.json` | T56 | Chunk size, world height, generation, material palette, LOD, collision, persistence |
| `terrain_features.json` | T57 | Parametric feature schema, control points, blend and validation limits |
| `world_objects.json` | T58 | Object types, behaviour state machines, persistence policy, interaction hooks |
| `succession.json` | T59 | Stages, thresholds, seed bank, recovery pulses, disturbance resets, deep-time hooks |
| `orchestration.json` | O04 | World pool, allocation thresholds, drain, routing, archive/restore, cost caps |

When the first file is created, update the count here, in `CONTEXT.md`,
`README.md`, `apps/server/src/core/config.test.ts` and the manual checklists in
the same change.
