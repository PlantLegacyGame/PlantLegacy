# Bugfix record — the twenty-one defects, Wave B

**Status:** `[x]` for Wave B (items 5, 6, 8, 18, 20). Waves C–E of the same list
are planned and **not started**; this record is one wave, per the task rules.

Wave A fixed the ten defects in the title camera, world camera, labels, controls
and clock. Wave B is the weather-and-economy wave: what falls, what it lands on,
what decides it, and what the purse did. Its five items share one cause each, and
two of them (5 and 6) were the same pass seen from different angles.

## 1. What changed

| Item | Defect | Cause | Fix |
|---|---|---|---|
| 5 | Rain and snow followed the camera; the field slid with the player | Every drop was an offset from a mesh whose x/z were copied from the eye each frame, so walking moved the whole shower and standing still left water hanging beside the player | Each drop owns a home in a torus of `rain_box_width` and its drawn copy is the nearest one to the eye (`renderers/environment/precipitationAnchor.ts`, tested). Only a drop that crosses the edge is rewritten, and it jumps by exactly one box. Drops draw their own world x/z, so the mesh never follows. Snow also became a six-armed crystal instead of a round dot |
| 6 | Splashes were single-sided rings floating at a fixed height, and threw no spray | One flat horizontal quad per landing at `+0.04`, no terrain normal, culled from below | A crown: an open 12-sided cone standing on the ground's own normal (tangents baked like the wet patches), with twelve tongues of water cut out of it in the fragment shader. Double-sided, and hidden when the eye is under that piece of ground or under the soil at all (`setEyeUnderGround`) |
| 8, 20 | The weather was a global Markov chain: one sky for the whole world, rolled every few minutes, with no relation to terrain or place | `pickNextState` rolled fixed probabilities; time, season and position were not inputs | `packages/weather/src/climateField.ts`: advected humidity/cloud noise, orographic lift over the real terrain, temperature from season, hour and altitude, and rare storms from a second, coarser noise. The state machine keeps its durations and the storm's three phases, but asks the field which weather happens. Measured over 30 simulated days: 20.8% wet, 2 storms, 8.2 minutes per state, both rain and snow |
| 18 | The purse changed with no explanation: a purchase, a use, an award and a drop all moved the same number | Only `INVENTORY_SYNC` carried the balance, and a balance is not a reason | Protocol v5 `LEDGER_ENTRY` (48), one per change, with kind, label, item, count, spores moved and the committed balance; `packages/shared/src/economy/ledger.ts` owns the words; the inventory panel shows the last 14 |

## 2. Config

| File | Key | Type / range | Default | Effect |
|---|---|---|---|---|
| `config/climate.json` | 22 keys | numbers/integers, each with a range | see file | The field's scale, wind, lift, temperature, humidity, cloud, thresholds, storm rarity, re-evaluation and hysteresis |
| `config/net_proto.json` | `protocol_version` | integer, 1–255 | 5 | Bumped with `PROTOCOL_VERSION` for `LEDGER_ENTRY` |
| `config/weather.json` | unchanged | — | — | Still owns durations, storm phases, light and moisture; the field decides the state |

`loadClimateConfig` sanitises every number on the way in, so a bad edit cannot
freeze the sky (a zero system scale would sample one point forever).

## 3. Tests

| Test | What it pins |
|---|---|
| `precipitationAnchor.test.ts` (6) | World copies stay inside the volume; a walking eye moves nothing unless a drop wraps; a wrap is exactly one box; a drop stays still across 19 m of walking |
| `climateField.test.ts` (9) | Ranges and determinism; windward clouds more than lee; day/night and altitude temperature (400 m costs exactly 2.6 °C); rain/snow by temperature; precipitation hysteresis; storm cooldown; **30 simulated days**: 4–40% wet, ≤ 8 storms, no state shorter than 45 s on average, every storm runs telegraph → active → aftermath, same seed same sequence |
| `ledger.test.ts` (shared, 7) / `ledger.test.ts` (server, 4) | Order and cap; signed amount text; one line per kind; no id in player text; `NaN` prints as 0; the wire payload is rounded and carries the committed balance |
| `shop.test.ts`, `inventoryHandlers.test.ts` (updated) | A purchase sends `LEDGER_ENTRY` with the price and the new balance; a use sends its own line even when no spores moved |

## 4. Browser pass — `localhost:4173/PlantLegacy/?dev=1`, 2026-11-23

Measured in the running page after restarting the server on the new code
(`/health` reported 82 config files):

- **Anchoring:** 4000 drops. A 3 m sideways walk (and a further 3 m diagonal)
  changed 310 and 140 of the 8000 anchor values; every real change was exactly
  one 60 m box, and the rest differed by under 0.01 m (Float32 rounding). No drop
  slid partially with the camera.
- **Splash crowns:** 480 instances, material `side: 2` (double-sided), mesh at
  the origin with world anchors, terrain tangents present, sampled ground heights
  19.6–20.6 m across four crowns on the slope. Visible while raining above
  ground; **hidden** with the eye below the surface; visible again on return.
- **Snow, forced and seen (2026-11-23, second pass):** the dev panel's weather
  select gained a Snow entry (the machine and renderer both had the state; the
  panel simply could not reach it), and forcing it put the world into `snow` for
  180 s: the vitals read `snow` with a clear-time forecast, the drop mesh held
  4000 instances with `uSnow = 1`, opacity 0.85 and the clock advancing, the
  splash pass stayed off, and six-armed crystals were visible against the sky and
  across the ground at noon. Saved as `docs/screenshots/wave-b-snow.png`.
- **Ledger:** using a Starter Dung showed
  `Used Starter Dung · +5 spores · 125 left`, and the spore chip read 125; the
  empty state read "No spore changes yet." A dev grant produced
  `Dev grant · 120 left` before the label gained the item name (now
  `Dev grant: Starter Fertilizer ×3`).
- **Purchase, live:** opened the shop from the spore chip while the world was
  connected and bought a Starter Dung. The shop's balance went 120 → 100, the
  chip followed to 100, the pouch went ×2 → ×3, and the inventory's ledger read
  `Bought Starter Dung · −20 spores · 100 left`. Saved as
  `docs/screenshots/wave-b-ledger-purchase.png`.
- **Climate:** not exercised as a watched weather cycle; it is the server's
  driver and its evidence is the 30-day simulation plus the live server running
  on it (the world's own weather was "Rain, clear in 2:41" while the field was
  raining at the plant).

## 4a. Fresh-eyes cuts (2026-11-23, second pass)

Nothing was added; six things came out, and one of the cuts exposed a dev-control
gap that the snow check needed closed.

| Cut | Why it was not pulling its weight |
|---|---|
| `wrappedBetween()` in `precipitationAnchor.ts` and its test | Only its own test called it. The anchor pass compares the drawn anchor with the wrapped one and re-samples that drop's ground itself, so a second helper answering "did it wrap" was a rule with no reader |
| `setGround(groundY, position)`'s camera argument | Every frame passed `this.camera.position` and the function began with `void position;`. The column follows the ground under the eye, not the eye's x/z |
| `mesh.position.y = eyeGroundY` in `follow()` | A second write of the value `setGround()` had already written that same frame, behind an `if (sampler)` that could not change the result |
| `sanitizeClimateConfig` in `loadClimateConfig` | The config was sanitised on the way out of the loader *and* again in `WeatherSystem.connectClimate`, the only place that builds a field. One boundary now, where the field is built |
| `WeatherSystem.getClimateSample()` | A public accessor with no caller; the state machine gets the sample through the binding it already owns |
| *(added)* Snow entry in the dev weather select | Not a cut but the one thing this pass had to add: the server's resolver, the machine and the renderer all accept `snow`, and the panel's list stopped one state short, which is exactly why a snow shower had never been seen |

## 5. Records

`docs/bug-inventory.md` gained K11–K15. `docs/protocol.md`, `docs/tunables.md`,
`CONTEXT.md`, `docs/history.md`, `docs/what-works-now.md` and the task index were
updated. `pnpm verify` is green: 31 tools + 228 shared + 21 weather + 508 server +
805 client tests, lint, typecheck, config validation, config keys, docs and
palette.
