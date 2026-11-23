# Bugfix record — the twenty-one defects, Wave A

**Status:** `[x]` for Wave A (items 1, 2, 3, 9, 10, 11, 12, 15, 16, 19). Waves B–E
are planned in the same list and **not started**; this record is one wave, per the
task rules.

The twenty-one defects were reported on 2026-11-23. They group by cause, not by
symptom: 7/12/13/21 are one missing volume terrain; 5/6/8/20 are one weather
system. Wave A is the ten whose cause lies in the title camera, the world camera,
the labels, the controls table and the clock, and it is the only wave this
session touched.

## 1. What changed

| Item | Defect | Cause | Fix |
|---|---|---|---|
| 1 | The title's sun and moon jerk every quarter second | The frame loop ran the smooth pass, which reads the disc's laid-out step and writes the offset off it, **before** the layout pass that moved the step. The offset was therefore one layout step stale every 250 ms and the disc jumped forward and was pulled back. The backstep hold was also 0.02 day (28.8 minutes), so a clock that landed behind froze both bodies for that long | The layout runs first and the smooth pass second, in the same frame and on the same phase (`MainMenu.paintOrbs(phase)`); the geometry moved to `ui/title/orbPlacement.ts` so the ordering is a test; the hold is 0.0015 day (~5 s of world time) |
| 2 | Dragging the title and letting go snapped it back to centre | `parallaxTarget` returned the origin whenever the pointer was null, and `pointerleave` cleared the pointer, so a release (or leaving the window) undid the drag | The drag's release is a persistent `rest` offset; hover adds its spring on top of it; Space and the camera home clear it. `parallaxTarget(draft, pointer, config, rest)` |
| 3 | The title opened at the camera's mechanical limit | `ZOOM_HOME = ZOOM_MIN` (0.55), the zoom at which the pane first fits inside the painted world | `ui.title_home_zoom` (0.72), clamped to the camera's own 0.55–3.2 range, used for boot, `0` and Space |
| 9 | `P` replaced the player's plant with a test specimen, and the controls page said `R` | `plant_regenerate` was a public binding (P on disk, R in the route's fallback and in `docs/controls.md`) and the Settings table listed every action it found | The action is gone from `config/controls.json` and the server route; Settings skips every `dev`-context action; the page names the dev-panel button instead; a test reads the shipped file and fails if a dev action is offered |
| 10 | `W`/`S` sometimes moved sideways, backwards or up a hill | The heading came from `camera.getWorldDirection()`, read before the orbit controls and the aim lean rebuilt the camera for the frame, and `right` came from a surface-normal up vector | The heading is `target - eye` (`player/cameraPan.ts`), the basis is pure and tested; W/S/A/D verified live with zero vertical travel |
| 11 | Panning made the eye ride the terrain up and down | `settlePlayerOnGround` followed the pivot delta and clamped the target floor and the eye to the ground | In `camera_mode: free` the ground rig returns before any of it; a level pan over a 0.829 slope now keeps its height exactly |
| 12 | The camera could not be flown through terrain | The same ground and cavity clamps | Free mode skips `clampEyeToGround`, `clampEyeToCavity` and the aim lean, and W follows the whole view vector. `camera_mode: ground` keeps the old rig as a switch |
| 15 | Inspecting a rival showed `owner 9f3a1c07b8e2` | The panel printed `ownerId.slice(0, 12)`; the snapshot already carried `ownerName` | The client stores the name from `PLANT_SYNC`/`PLANT_CREATED` and `ownerCaption()` prints the name or "Unnamed plant" |
| 16 | Name tags were blurry and the same size at every distance | A constant 15 px plate, a texture drawn at 1x whatever the display, and a client fallback floor of 0.25 against the configured 0.75 | `render/tagScale.ts` gives a distance curve (22 px cap, 16 px at 20 m, 7 px floor); the texture is drawn at `min(2, devicePixelRatio)`; both floors are 0.75 |
| 19 | `12:00` was the only clue to the time of day | The clock chip printed season, day and hour only | `ui/dayPart.ts` names Dawn/Day/Dusk/Night with a sun or moon glyph from the server's own day fraction |

## 2. Config

| File | Key | Type / range | Default | Effect |
|---|---|---|---|---|
| `config/ui.json` | `title_home_zoom` | number, 0.55–3.2 | 0.72 | The title camera's resting zoom and where `0`/Space return it |
| `config/render.json` | `camera_mode` | enum `free`/`ground` | `free` | The world camera rig: flying eye, or the old ground-following rig |
| `config/render.json` | `resolution_floor` | number, 0.1–1 | 0.75 | Already 0.75; the client and server fallbacks were 0.25 and are now 0.75 |
| `config/controls.json` | `plant_regenerate` | — | removed | Regeneration is a dev-panel button only |

## 3. Tests

| Test | What it pins |
|---|---|
| `ui/title/orbPlacement.test.ts` (5) | Layout and smooth offset compose to the raw body position; the stale order is one step wrong; the CSS clamp is measured in its own space |
| `ui/title/parallax.test.ts` (+2) | A released drag persists; hover adds to it; rest is clamped |
| `player/cameraPan.test.ts` (6) | Heading is `target - eye`; W/S/A/D directions; ground pans never change height; free mode flies the view vector |
| `render/tagScale.test.ts` (4) | The curve falls with distance, equals 16 px at 20 m, and is bounded |
| `ui/dayPart.test.ts` (4) | The four boundaries to the minute, the glyphs, the wrap, NaN |
| `ui/resourceVitals.test.ts` (+2) | The clock chip carries the day part; it says nothing before the server clock |
| `config/controlsBindings.test.ts` (+2) | The shipped file offers no dev-context action and no regenerate binding |
| `render/rivalTagLabel.test.ts` (+2) | The owner line is a name or "Unnamed plant", never an id |

## 4. Browser pass — `localhost:4173/PlantLegacy/?dev=1`, 2026-11-23

Measured in the running page (dev handle and DOM), not eyeballed:

- **Home zoom:** `--pl-scene-zoom` 0.720 at boot; `+` three times took it to
  1.320; `0` returned it to 0.720 with the inline transform cleared; twenty `-`
  presses stopped at the 0.550 floor.
- **Drag:** the near ridge read `translate3d(-107.43px, -17.91px, 0)` during the
  drag, `(-119.98px, -20px)` 1.2 s after release (persisted and settled) and
  `(-0.02px, 0px)` after Space.
- **Orbs:** 193 frames over 3.2 s while unpinned: 2.087 px of travel, largest
  frame step 0.014 px, no backwards step, no step over 1 px. The old order would
  have shown a ~2 px jump and a pull-back every 250 ms.
- **Camera, ground rig removed:** eye at 24.175 m over a 0.829 slope, `W` for
  1 s: travelled 6.671 m, the ground under the eye rose 3.005 m, the eye's height
  changed **0.0000 m**. `S` +3.97 z, `D` +4.00 x, `A` −4.00 x, all with `dy` 0.
- **Free flight:** looking down and holding `W` dropped the eye 3.493 m in 0.7 s;
  aimed under a hill, the eye settled 0.593 m **below** the ground at its own
  position and stayed there.
- **`P`:** nodes 1 → 1, no toast, and no "Generated test plant" anywhere in the
  page after the press.
- **Clock:** "◐ Dawn · Season 1 · Day 3 · 07:59" became "☀ Day · Season 1 · Day 3 ·
  08:00" on the 08:00 boundary; it read Dawn at 07:39 and 07:47.
- **Tags** (mutation gallery, 45 labels): at exactly 5 / 20 / 50 m the text
  projected to 21.99 / 15.94 / 11.57 screen px and the sprite to 0.278 / 0.806 /
  1.462 m; the canvas was 159 px tall at `devicePixelRatio` 1.42, i.e. drawn at
  the display's own density.

Not checked in the browser: the Inspect owner line against a live signed-in
rival (the gallery has no display names, and the row is covered by
`ownerCaption` tests); the tag blurb is a text change, not a layout one.

## 5. Records

`docs/bug-inventory.md` gained the K01–K10 rows. `CONTEXT.md`,
`docs/history.md`, `docs/what-works-now.md` and the task index were updated.
`pnpm verify` is green: 31 tools + 221 shared + 504 server + 799 client tests
(including the 25 new ones above) + lint, typecheck, config validation, config
keys, docs and palette.
