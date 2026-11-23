# Bugfix record — the twenty-one defects, Wave B

**Status:** `[x]` for Wave B (items 5, 6, 8, 18, 20). Wave C is started as T56's
first volume slice ([T56.md](./T56.md)); Waves D–E of the same list are planned
and **not started**. This record is one wave, per the task rules.

Wave A fixed the ten defects in the title camera, world camera, labels, controls
and clock. Wave B is the weather-and-economy wave: what falls, what it lands on,
what decides it, and what the purse did. Its five items share one cause each, and
two of them (5 and 6) were the same pass seen from different angles.

## 1. What changed

| Item | Defect | Cause | Fix |
|---|---|---|---|
| 5 | Rain and snow followed the camera; the field slid with the player | Every drop was an offset from a mesh whose x/z were copied from the eye each frame, so walking moved the whole shower and standing still left water hanging beside the player | Each drop owns a home in a torus of `rain_box_width` and its drawn copy is the nearest one to the eye (`renderers/environment/precipitationAnchor.ts`, tested). Only a drop that crosses the edge is rewritten, and it jumps by exactly one box. Drops draw their own world x/z, so the mesh never follows. Snow also became a six-armed crystal instead of a round dot |
| 6 | Splashes were single-sided rings floating at a fixed height, and threw no spray | One flat horizontal quad per landing at `+0.04`, no terrain normal, culled from below | A crown: an open 12-sided cone standing on the ground's own normal (tangents baked like the wet patches), with twelve tongues of water cut out of it in the fragment shader. Double-sided, and hidden when the eye is under that piece of ground or under the soil at all (`setEyeUnderGround`) |
| 8, 20 | The weather was a global Markov chain: one sky for the whole world, rolled every few minutes, with no relation to terrain or place | `pickNextState` rolled fixed probabilities; time, season and position were not inputs | `packages/weather/src/climateField.ts`: advected humidity/cloud noise, orographic lift over the real terrain, temperature from season, hour and altitude, and rare storms from a second, coarser noise. The state machine keeps its durations and the storm's three phases, but asks the field which weather happens. Measured over 30 simulated days with the corrected field (2026-11-23, §4b): 23.8% wet, 2 storms, 7.1 minutes per state, rain and snow (1.9% snow) |
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
| `climateField.test.ts` (11) | Ranges and determinism; windward clouds more than lee; day/night and altitude temperature (400 m costs exactly 2.6 °C); **summer is warmer than spring and winter colder than autumn**; **orographic lift is measured over the configured distance and rewards the windward slope, not the lee**; rain/snow by temperature; precipitation hysteresis; storm cooldown; **30 simulated days from the shipped config**: 4–40% wet, ≤ 8 storms, no state shorter than 45 s on average, every storm runs telegraph → active → aftermath, same seed same sequence |
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
- **Climate:** not exercised as a watched weather cycle in this pass; §4b is
  the full-day observation that closed that gap and found three defects in the
  field.

## 4a. Fresh-eyes cuts (2026-11-23, second pass)

Nothing was added; six things came out, and one of the cuts exposed a dev-control
gap that the snow check needed closed.

| Cut | Why it was not pulling its weight |
|---|---|
| `wrappedBetween()` in `precipitationAnchor.ts` and its test | Only its own test called it. The anchor pass compares the drawn anchor with the wrapped one and re-samples that drop's ground itself, so a second helper answering "did it wrap" was a rule with no reader |
| `setGround(groundY, position)`'s camera argument | Every frame passed `this.camera.position` and the function began with `void position;`. The column follows the ground under the eye, not the eye's x/z |
| `mesh.position.y = eyeGroundY` in `follow()` | A second write of the value `setGround()` had already written that same frame, behind an `if (sampler)` that could not change the result |
| `sanitizeClimateConfig` in `loadClimateConfig` | The config was sanitised on the way out of the loader *and* again in `WeatherSystem.connectClimate`, the only place that builds a field. One boundary now, where the field is built |
| `WeatherSystem.getClimateSample()` | A public accessor with no caller; the state machine gets the sample through the binding it already owns. **Restored in §4b:** the server's `weather changed` log is the caller that pass needed |
| *(added)* Snow entry in the dev weather select | Not a cut but the one thing this pass had to add: the server's resolver, the machine and the renderer all accept `snow`, and the panel's list stopped one state short, which is exactly why a snow shower had never been seen |

## 4b. The full live day (2026-11-23, third pass)

The field had only ever been simulated, so the world was left running on the dev
stack for one complete day: `cycle_length_s` = 3600 s, 06:00 to 06:00, boot at
02:13:55Z, with the shipped config and the plant's own root as the anchor
(-0.597, -4.567). Every authoritative state change was read back from the server
log. The replay is
`node tools/climate-day/measure.mjs --days=1 --anchor-x=-0.5973 --anchor-z=-4.5672`;
the live log is the same tool with `--log=/tmp/server-b.log`.

| | wet | storms | snow | transitions | mean state |
|---|---|---|---|---|---|
| **live day** | **22.5%** | **1** | **0%** | **10** | **360 s** |
| replay of that day | 22.5% | 1 | 0% | 10 | 360 s |
| 30-day run, day 1 | 22.5% | 1 | 0% | 10 | 360 s |
| 30-day run, all 30 days | 23.8% | 2 | 1.9% | 254 | 425 s |

The live day followed the replay's ten transitions in order and in state, at most
2.8 s apart (the replay steps at 1 s, the server at 20 Hz). The first rain: live
270.1 s, humidity 0.797, precipitation 0.314, 16.9 °C; replay 269 s with the same
three values. The storm ran telegraph → active → aftermath in both. Snow is zero
because the day is in spring and the replay's air ran 7.6–19.6 °C, nowhere near
the 2.5 °C snow line — not because snow is broken: the 30-day run reaches winter
and spends 1.9% of its time snowing there. Against the old 30-day figure the
corrected field is slightly wetter (23.8% against 20.8%), has the same two
storms, and now puts its snow in the season that should have it.

The day found three defects the 30-day test could not see, because the test
used a hand-copied config and a synthetic hill:

| Defect | Cause | Fix | Evidence |
|---|---|---|---|
| The seasonal curve was inverted (K25) | `cos(seasonPhase·2π)` peaks at phase 0, the first day of spring, so spring was the year's hottest and autumn its coldest | `sin(seasonPhase·2π)`: the equinoxes sit at the mean, summer peaks at 0.25, winter bottoms at 0.75 | `climateField.test.ts` summer > spring + 8 °C, winter < autumn − 8 °C, equinoxes at the mean |
| Orographic lift used the wrong distance and the wrong side (K26) | The 120 m look-ahead was multiplied by wind speed (720 m at 6 m/s), and the slope was subtracted backwards, rewarding the lee after the crest | One wind *direction* × distance ahead, rise = ahead − here | `climateField.test.ts`: windward gains 0.06 humidity over flat ground, lee gains exactly none, 1 and 12 m/s agree |
| With the lift fixed the field almost never rained (K27) | The old 0.56 mean humidity put the 0.704 rain onset in the noise's 95th percentile; the old 20.8% had been the fictitious 0.13 of lift | `humidity_base` 0.70, cloud and rain thresholds unchanged at 0.6/0.26 | 30-day run: 0.3% wet before, 23.8% after; day one 22.5% with 10 transitions |

The 30-day test now loads `config/climate.json`, `config/weather.json` and
`config/daynight.json` through the same loaders the server uses, instead of a
hard-coded copy, so a config change cannot leave it measuring a world that no
longer exists. The server also logs one `weather changed` line per transition
with tick, day, season and the field's temperature, humidity, cloud and
precipitation; before it, the weather left no trace at all. The `snow` state and
its 1.9% share still come from the simulation, not from this live day.

## 4c. Snow in winter, and a pass over the pass (2026-11-23, fourth pass)

The 30-day test asserted `snowShare >= 0`, which cannot fail: the 1.9% in §4b
was reported by the measurement tool, not pinned by the suite. The test now
records the season of every snowing second and requires snow in the winter
quarter (phase 0.625–0.875) and none outside it. The shipped run snows on days
20–26 for 2070 s, 1.92% of the run; the cosine curve of K25 would put that snow
at the autumn equinox and fail the second assertion.

| Cut | Why it was not pulling its weight |
|---|---|
| `tools/climate-day/measure.mjs`'s hand-copied config tables | About 110 lines re-mapped `climate.json`, `weather.json`, `daynight.json` and the terrain/render/world keys with their own fallbacks, and the fallbacks had drifted from the files they read: river width 7 m against 12, soil depth 1.2 against 1.6, rain start 0.22 against 0.28. It was the same mistake §4b removed from the test, one file over. The tool now loads the shipped configs through `loadConfigDir` and the server's own loaders, so a renamed key throws instead of measuring a world nobody ships |
| `sanitizeClimateConfig`'s numeric fallbacks | A second set of numbers, and the wrong second set: orographic lift 0.004 against the shipped 0.35, storm chance 0.055 against 0.25, humidity 0.52 against 0.70. A config that lost a key would have built a nearly dry planet with no explanation. The fallbacks are now the shipped values, pinned by a test that blanks every number and asserts the result equals the loaded `config/climate.json` |
| `dayNumber` in the replay's transition log | Added a quarter day before dividing by the day length, so a 3400 s transition (day 1 by every other count in the tool) printed as day 2. There is one count of the day now, from midnight, as `perDay` already used |
| `wind_speed_mps` and `orographic_lift` notes | Both still described the broken physics: speed "drives orographic lift" and the lift was "per metre per second of upslope". After K26 the lift is set by the wind direction and the distance over the slope, and the unit is metres climbed per metre travelled |
| `--log=/tmp/server-b.log` in the usage line | On Windows `/tmp` is `C:\tmp` to Node and something else to Git Bash: a path that only works in the shell it was written in. The example is a relative path now |

## 4d. A live winter day, and one ground (2026-11-23, fifth pass)

Snow had only ever been a simulated figure; §4b's 1.92% is the 30-day test. The
dev world was driven into winter with the built dev control (`dev_end_season`),
which ends a season and kills every plant. Seasons wrap, so 1→2→3→4 is winter
and 5 is spring again: an early duplicate jump overshot to 5, and the world had
to be taken to 8. Winter was reached at 03:56:35Z, 168 s after the clean boot at
03:53:47Z, and the reconnected plant's root (2.752, −4.105) became the anchor.

The first twenty minutes were dry at the anchor — humidity 0.64, cloud 0.10,
precipitation 0 at −1 °C — because precipitation needs humidity above 0.704 and
the state machine re-reads the field every `reevaluate_s` (90 s). The advected
air arrived at 04:16:49 (humidity 0.788, precipitation 0.283), and the next
re-evaluation logged the first live snow:

| time (UTC) | transition | temp | humidity | cloud | precip |
|---|---|---|---|---|---|
| 03:58:17 | clear → rain | 7.9 °C | 0.798 | 0.495 | 0.317 |
| 04:01:17 | rain → clear | 9.0 °C | 0.717 | 0.293 | 0.045 |
| 04:17:48 | clear → **snow** | **0.1 °C** | 0.822 | 0.556 | 0.400 |
| 04:19:18 | snow → clear | −1.1 °C | 0.677 | 0.193 | 0 |

The snow lasted 90 s. The clock was driven to 22:48 (`dev_set_time` 0.95, the
cold hour) and held there while the cell was wet, so this is a driven night, not
a natural one. Measured from the second the world became winter:
`node tools/climate-day/measure.mjs --log=.tmp-dev/dev.log --from=168 --days=1`
reads wet 18.4%, snow 6.14% (90 s), 0 storms, 4 transitions, temperature
−1.1..9.0 °C, field humidity mean 0.754. The window is partial (1441 s of 3600 s)
because the observation began when winter did; `--from` exists for that case,
and a partial day's share now divides by its own observed seconds instead of a
whole day.

The same pass gave the ground one owner: `loadTerrainFieldParams`
(`packages/shared/src/world/terrainFieldConfig.ts`) reads every terrain-field
tunable, and both the server's `TerrainService` and the day tool call it. The
server's inline copy still fell back to 6 m of relief and a 7 m river, the tool's
to 7 m and 1.2 m of soil. A renamed key now throws in one place; a test pins the
loader to `config/terrain.json` (26 m relief, 12 m river, 1.6 m soil) and asserts
a missing key throws.

The vitals clock put the hour at the end of one nowrap line behind the season and
day, so on the narrow card the clipped part was the number the chip exists to
show. The hour now leads it (`☾ Night · 23:48`), and season, day and the
countdown ride the wrapping sub-line. Client tests updated; the card was not
viewed in a browser this pass.

## 5. Records

`docs/bug-inventory.md` gained K11–K15 and, from the full-day check, K25–K27.
`docs/protocol.md`, `docs/tunables.md`, `CONTEXT.md`, `docs/history.md`,
`docs/what-works-now.md` and the task index were updated. The climate can be
measured with `node tools/climate-day/measure.mjs` (a simulated day or 30-day
year, or `--log=/tmp/server-b.log` for the live day the server actually ran). `pnpm verify` is green: 31 tools + 230 shared + 24 weather + 508 server +
805 client tests, lint, typecheck, config validation, config keys, docs and
palette.
