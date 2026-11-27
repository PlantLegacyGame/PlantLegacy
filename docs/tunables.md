# Tunables

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
- Value types: `number`, `integer`, `boolean`, `string`, `enum`, `array`,
  `schema_array`, `matrix`, `object`, `color` (`#rrggbb` or `#rrggbbaa`) and
  `palette_role`. A `palette_role` entry names a role from
  `config/palette.json` (`water_deep`) rather than a colour, so the palette owns
  the value; the validator rejects a role the palette does not define.
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
| `accounts` | T08C | active | 28 |
| `achievements` | T08B | stub | 0 |
| `annotations` | T19 | stub | 0 |
| `anticheat` | T41 | stub | 0 |
| `archetypes` | T12 | active | 1 |
| `audio` | C06 | stub | 0 |
| `boosters` | T13A | stub | 0 |
| `campaign` | T32 | stub | 0 |
| `chat` | T05 | active | 5 |
| `climate` | T07 | active | 22 |
| `climate_memory` | T39 | stub | 0 |
| `clips` | T35 | stub | 0 |
| `companions` | T11 | stub | 0 |
| `compliance` | T00 | draft | 3 |
| `controls` | C01 | active | 7 |
| `damage` | T06 | active | 23 |
| `daynight` | T07 | active | 4 |
| `deep_time` | T20 | stub | 0 |
| `dev` | D01 | active | 7 |
| `emotes` | T05 | active | 1 |
| `epoch_map` | T37 | stub | 0 |
| `extraction` | T51 | stub | 0 |
| `fragments` | T51 | stub | 0 |
| `genes` | T15 | stub | 0 |
| `gift_bundles` | T45 | stub | 0 |
| `gift_packs` | T50 | stub | 0 |
| `gifts` | T29 | stub | 0 |
| `growth` | T01 | active | 67 |
| `growth_scale` | T23 | stub | 0 |
| `guilds` | T44 | stub | 0 |
| `heirlooms` | T06A | stub | 0 |
| `inventory` | T08A | deprecated | 0 |
| `item_flags` | T08A | deprecated | 0 |
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
| `net_proto` | T03P | draft | 19 |
| `network` | T03 | active | 2 |
| `observation` | T28 | stub | 0 |
| `onboarding` | T00A | active | 3 |
| `ops` | O01 | active | 17 |
| `paid_spawn` | T21 | active | 5 |
| `palette` | C03 | draft | 2 |
| `parasitism` | T10 | stub | 0 |
| `persistence` | T26 | stub | 0 |
| `physics` | C02c | active | 14 |
| `plant_renderer` | C02 | active | 36 |
| `prestige` | T08B | stub | 0 |
| `profiles` | T47 | stub | 0 |
| `relics` | T18 | stub | 0 |
| `render` | C01 | active | 137 |
| `reports` | T05 | active | 5 |
| `reproduction` | T53 | stub | 0 |
| `reputation` | T43 | stub | 0 |
| `resources` | T00A | draft | 51 |
| `root_sight` | T02 | active | 28 |
| `session` | T08 | stub | 0 |
| `shop` | C05 | active | 4 |
| `spectating` | T30 | stub | 0 |
| `spectating_ui` | T36 | stub | 0 |
| `spectator` | T34 | stub | 0 |
| `spores` | T13 | active | 6 |
| `status` | T46 | stub | 0 |
| `symbiosis` | T09 | stub | 0 |
| `terrain` | T25 | active | 33 |
| `terrain_volume` | T56 | active | 13 |
| `territory` | T49 | stub | 0 |
| `tumbling` | T06 | active | 10 |
| `tutorial` | T33 | stub | 0 |
| `ui` | C01 | active | 36 |
| `uproot` | T06 | active | 19 |
| `water` | T31 | active | 37 |
| `weather` | T07 | active | 18 |
| `world` | T03 | active | 17 |


Total: **83 files**; 36 populated and 47 stubs (4 of them `draft`, 2 `deprecated`).

**This line owns the count.** Other documents link here rather than quoting a
number (ADR-049).
Populated: `accounts`, `archetypes`, `chat`, `climate`, `compliance`, `controls`, `damage`, `daynight`, `dev`, `emotes`, `growth`, `items`, `mutations`, `mutation_visuals`, `net_proto`, `network`, `onboarding`, `ops`, `paid_spawn`, `palette`, `physics`, `plant_renderer`, `render`, `reports`, `resources`, `root_sight`, `shop`, `spores`, `terrain`, `terrain_volume`, `tumbling`, `ui`, `uproot`, `water`, `weather`, `world`.

## One key name, two files

Twenty-one key names are declared in more than one config file. That is not
automatically a mistake — `seed` is per-system, and `enabled` belongs to whichever
file names it — but the name does **not** make two values the same. Read the file
that owns the system, never a neighbour with the same key.

Three cases are worth knowing before you tune them, because the name promises
more agreement than exists:

- `terrain_radius` (`render`) and `patch_radius_m` (`terrain`) are the same 620 m
  by intent: one is the collider/sky-dome radius, the other the ground patch.
  Change them together.

The other two were defects, not documented pairs, and are gone:

- `root_aura_radius` was declared in `render` (6) and `plant_renderer` (3) and read
  from neither — both plant passes took a literal 3.0. One key now,
  `root_sight.aura_radius`, read by the SDF pass and the WebGPU pass alike (E19).
- `lightning_damage_amount` was 8 in `damage` (the value the pipeline billed) and
  25 in `weather` (parsed, never read). `damage` is the only copy, and the
  `WEATHER_STRIKE` event reports what the bolt actually took `plantsHit` and
  `totalDamage` instead of a second constant being quoted anywhere (E20).

`photosynthesis_energy_per_second`, `evaporation_per_s` and the `webgpu_tier*`
thresholds also repeat. Growth's energy per second is not resources' energy per
photosynthetic unit — two subsystems, two meanings. The `dev` copies of the
`webgpu_*` and camera keys are **not** live overrides: the dev panel draws them
from `/dev/config` and `applyDevConfig` refuses them, so `render`'s values are
what runs (E21).

### Renderer gates added in the 2026-11-27 pass

- `render.webgpu_enabled` is still the only WebGPU gate. Its value in
  `config/render.json` is `false`; the mesh pass is what gameplay draws. The
  WebGPU canvas, its analytic occlusion and `PlantMeshBuilder` are not on the
  shipping path, and moving to WebGPU later means migrating the whole scene's
  depth and picking, not flipping this key.
- `PlantRenderer`'s `sdfDevEnabled` is a code-level dev flag, not a config key.
  It defaults to `false`; only then is the SDF fullscreen quad created and fed a
  frame. Gameplay no longer packs nodes for it, updates a frame, writes LOD or
  draws an aura. `pnpm config:keys` therefore has no new key to find.

## Approved V5.4 config files (not created yet)

These are specified in `DESIGN.md` Part 11 and named in the tables below. They
are **not** in `config/` yet, so the validator count stays at 83.

| File | Owner | Purpose |
|---|---|---|
| `fauna.json` | T54 | Species, needs, senses, reflexes, animal vocalizations, influence maps, population caps, trap/struggle |
| `materials.json` | T55 | Material/element definitions, reaction matrix, CA cadence, flow and temperature rules |
| `terrain_features.json` | T57 | Parametric feature schema, control points, blend and validation limits |
| `world_objects.json` | T58 | Object types, behaviour state machines, persistence policy, interaction hooks |
| `succession.json` | T59 | Stages, thresholds, seed bank, recovery pulses, disturbance resets, deep-time hooks |
| `orchestration.json` | O04 | World pool, allocation thresholds, drain, routing, archive/restore, cost caps |

When the first file is created, update the count here, in `CONTEXT.md`,
`README.md`, `apps/server/src/core/config.test.ts` and the manual checklists in
the same change.
