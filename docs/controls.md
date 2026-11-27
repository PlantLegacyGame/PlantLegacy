# Controls

**Status:** implemented (C01 foundation, C04 settings). The named-action input abstraction is complete; bindings are loaded from `config/controls.json` (active, 7 values) and a player's rebinds are a per-device override map on top of it (`config/controlOverrides.ts`). `config/controls.json` is no longer a stub.
**Source of truth:** DESIGN.md Part 17 (controls) and Part 18 (UI and HUD); the C01 and C04 tasks.

## Current bindings (from `config/controls.json`)

| Action | Binding | Notes |
|---|---|---|
| Orbit camera | Left-drag / Middle-drag / Two-finger drag | `OrbitControls`; camera rotates around its target |
| Pan camera (mouse) | Right-drag | `OrbitControls` screen-space pan (moves camera + target) |
| Pan camera (keyboard) | `W` / `ArrowUp` | Move camera forward on ground plane |
| Pan camera (keyboard) | `S` / `ArrowDown` | Move camera backward on ground plane |
| Pan camera (keyboard) | `A` / `ArrowLeft` | Move camera left on ground plane |
| Pan camera (keyboard) | `D` / `ArrowRight` | Move camera right on ground plane |
| Pan camera (touch) | One-finger drag | Drag on world pans camera |
| Orbit camera (touch) | Two-finger drag | Two-finger drag orbits around the target |
| Zoom (mouse/touch) | Scroll wheel / Pinch | `OrbitControls`, smooth continuous zoom |
| Zoom (keyboard) | `-` / `+` (or `=`) | Smooth keyboard zoom with acceleration/damping |
| Recenter camera | `Space` / Double-click ground / Double-tap | Frames root node |
| Select node | Left-click / Tap | In Grow Mode: opens growth options. In Normal Mode: focuses camera on node. A near-tie between a parent's and child's pick sphere goes to the deeper node |
| Name a part | Hover a plant part | Shows `Leaf #2` and its place in the plant, plus how many growth options the server reports. The "click to see what it can grow" promise appears only when that count is above zero |
| Grow Mode toggle | `G` | Toggles between Normal Mode and Grow Mode |
| Root Sight toggle | `R` | Toggles organic ground cutaways & subterranean camera elevation. It also opens by itself when a radicle or root starts growing (`root_sight.auto_open_on_root_growth`); a hand-close then stands until the next buried part starts |
| Root Sight toggle (touch) | Screen-edge button | The same toggle, because a touch player has no `R`; it is why the action bar carries Root sight |
| Emote wheel | `E` | Opens emote selection |
| Inventory / Overview | `I` | Opens the inventory and plant overview together; once they are up, toggles the inventory only, so closing one panel never takes the other with it |
| Inventory slot 1–10 | `1`–`9`, `0` | In the world, selects and uses a hotbar slot. With the inventory open, moves the inventory selection only, where typing a count is the point |
| Collect drop | Left-click a drop within `render.drop_pick_distance_m` | Sends `DROP_COLLECT` for a dung, remains or fragment marker. The server owns the reward and removal |
| Shop | Spore chip `+` / title screen Shop button | Opens the shop panel; the balance and prices are the server's |
| Cancel growth / Close panel | `Escape` / Right-click (context) | Cancels growth drawing, closes the open plant panels or wheel, otherwise opens the pause menu. A panel's own close button closes that panel alone |
| Pause menu | `Escape` in the world | Resume, Settings, Controls, Leave to title. Also the action bar's Menu button, so it is reachable on touch |
| Settings | `O` | Opens the Settings sheet (Settings / Controls tabs). The same sheet is reachable from the pause menu, so `O` is a shortcut, not the only door |
| Operator readout, growth readout | dev panel → Debug | The tick card and the growth readout are switches in the dev panel. They were F3 and F2: F3 is the browser's find bar in Chrome and quick-find in Firefox, and both are function keys a browser game must not claim |
| Dev panel toggle | `` ` `` (backtick) | Opens dev panel with admin commands (only with `?dev=1`). The dev panel's Debug tab also owns the three readouts below |
| Dev camera limits | Dev panel → Camera → Unclamped Distance | Dev-only. Two things stop a long shot: the size class's orbit cap, and the spring-arm collision, which pulls the eye back to the first solid thing between it and the orbit target - in a planted field that is usually a neighbouring plant, not the terrain. A grown body cannot reach the 80 px tier boundary inside either. The toggle suspends both and deepens the far plane to 20 km, so a measurement can frame a plant from any distance and height |
| Planet orbit view | Dev panel → Camera → Orbit Planet / Local View | No key binding by request, and no config action either: the two buttons call `cam.setPlanetView()` directly, so there is nothing in `config/controls.json` to rebind |
| Debug overlay | dev panel → Debug → Metrics overlay | Unbound on purpose. It used to be a bare `Shift`, which fired every time a player held shift to select or capitalise, and swallowed the modifier. |
| Hints | `H` | Shows the key list on demand and re-enables hints. Hints themselves are contextual: each one appears once, when it is relevant |

Regenerating the test plant has no binding. It is a button in the dev panel's
Plant section (`?dev=1`). It used to be bound to `P`, while this page said `R`,
so a player following the page could replace their plant with a test specimen;
the binding is gone from `config/controls.json` and from the Settings → Controls
table, which now filters every `dev`-context action.

Input is sampled and sent to the server at 20 Hz. The camera is client-side and
server-unvalidated: `INPUT` frames are stored and only advance `lastInputTick`
(ack-only heartbeat), and the unused `validateMovement` helper has been deleted
rather than left as a pretend movement check. `REJECT` is returned for invalid
growth intents, not for movement. The client never moves its own cube.

Hints are contextual: each appears once, when it is relevant, for
`ui.hint_card_duration_ms`. `H` (or the bar's Hints button) shows the three-line
key list on demand. The vitals card reads real tile totals once the server sends
`RESOURCE_UPDATE` data.

## No function keys

Nothing in the game binds `F1`-`F12`, and no bare modifier acts as a toggle.
Function keys belong to the browser (find, reload, fullscreen, devtools), and a
bare `Shift` or `Alt` is a key players hold while doing something else. The
metrics overlay, growth readout and tick card are switches in the dev panel's
Debug tab instead.

## Action bar

The bottom row names every verb that used to be keyboard-only, with its key as a
badge: Grow (`G`), Root sight (`R`), Inventory (`I`), Chat (`T`), Emotes (`E`),
Hints (`H`), Menu (`Esc`). On a coarse pointer the badges are dropped, the targets
grow to 48 px and the row wraps instead of overflowing a phone, which is how those
verbs are reachable on a phone at all. Root sight is in the bar because a touch
player otherwise had no door into the underground view: `R` was its only binding.

## Phone layout

- The vitals card drops below the status card and spans the width.
- Inspect and Inventory become one full-width sheet with an Inspect / Inventory
  switch at the top, instead of two half-width columns.
- Chat opens full width above the action bar instead of as a corner column.
- The mode badge rides inside the action bar, so it can never overlap it.
- Nothing names a key on a finger layout: the action bar drops its badges, the
  pause rows drop theirs, and contextual hints swap their text for the `touchText`
  written beside it.

## One home for the finger copy

Every word a phone is told about its own controls lives in
[`apps/client/src/ui/touchCopy.ts`](../apps/client/src/ui/touchCopy.ts): the
gesture table the Settings → Controls tab renders, the title screen's one hint
line, and the two device-specific lines of the Hints card. It was three copies
before that (a config key, a table in the settings panel and a string in the title
scene) and they had already drifted. The keyboard card still comes from
`config/onboarding.json`, and the touch card borrows that card's last line, so the
game's description of what the player is has one owner.

## Grow Mode vs Normal Mode

- **Normal Mode (default):** Left-click a node → camera smoothly focuses on that node. No growth panel opens.
- **Grow Mode:** Press `G` to toggle. Left-click a node → growth options panel opens for that node. Select an option, then drag on the canvas to set growth direction, release to confirm.

Mode is shown without a line of text in a readout: the screen edge takes a green
tint, and the bar's Grow button is held down with a `GROW MODE` badge above it.
The pointer keeps its usual shape - the direction being aimed is drawn on the
plant itself, so nothing about the cursor has to change.

## Chat (T05)

- **Chat panel** (`T` key): proximity and world tabs, send on Enter, auto-shows briefly on new messages, scrollback capped at 50 messages. Full width above the action bar under 560px.
- **Rate limiting:** world chat limited to `chat.world_rate_msg_per_min` (default 12/min).
- **Block:** right-click any chat message → Block player. Blocked players' chat and emotes are hidden from you. Block persists for the session.
- **Report:** right-click any chat message → Report. Opens a modal dialog with pre-filled target, reason dropdown (RULE_6 categories), free-text additional info, and optional block checkbox. Reports are sent server-side with a context snapshot of recent chat lines. Rate-limited to `reports.report_rate_limit_per_min` (default 5/min).

## Implemented by C01

- Named-action input abstraction (`camera_pan`, `select_part`, `grow_mode_toggle`, …) and device producers for keyboard, mouse and touch.
- Loading bindings from `config/controls.json`; every key code is data, not source.
- Context rules: modal > text input > context actions > camera.
- Gameplay code reads action state via `isActive(actionId)`, never raw keys.
- `InputBus` with `isActive`, `wasPressed`, `getAxis` for 2D movement axes.
- **Emote wheel UI** (`E` key): circular emote selector with center close button, click-outside to close, Escape to close. Sends `/emote <id>` via chat message type.
- **Inventory/Overview panel** (`I` key): centred panel with plant stats and the server's inventory slot grid. The grid and the always-on hotbar are fed by `INVENTORY_SYNC` / `INVENTORY_SLOT_UPDATE`; number keys `1`–`9` and `0` select and use outside the inventory, and select only while it is open. Drag-and-drop reordering is not built yet.

## Implemented by C04 (settings and rebinding)

- **Per-device rebinding.** Settings → Controls lists the actions in the current
  device's layout and rebinds on a key press. The change is an override map
  (`plantlegacy.controls.v1` in `localStorage`), never a config write: the
  server's table stays the source of defaults, and a later config fix still
  reaches a player who rebound something else.
- **One key, one action.** Assigning a key takes it from whichever action held
  it, and the sheet says which actions lost it. An override for an action the
  config no longer has is ignored, not resurrected.
- **The table is filtered by device and context.** Every `dev`-context action is
  hidden from the player's sheet; the dev panel keeps its own buttons.
- **Reset to the config.** The sheet can drop every override for the device in
  one action.

## Not built yet

- **Growth aiming on touch** beyond tap-to-pick: the aim still follows a drag
  rather than a long-press-then-drag gesture (DESIGN 17.5). The camera, the
  action bar, the reroot pad and the panels all work on touch today.
- **A gesture producer beyond the six configured gestures.** `bindings_touch`
  holds one-finger drag, pinch, two-finger drag, double-tap, tap and the
  edge button; a seventh gesture needs both a producer and a config row.
- **Drag-and-drop reordering** in the inventory: slots select and use, and do not
  yet move.

## Contract C01 satisfies

- Every **desktop** binding is a tunable in `config/controls.json`; no key code in
  source. The six touch gestures are the stated exception: three.js gets
  `ONE: PAN` and `TWO: DOLLY_ROTATE` in the controls setup in `main.ts`, the edge
  button and the double-tap are hand-wired, and `bindings_touch` is the written
  specification of that set — which is why `config:keys` allowlists it instead of
  pretending a producer reads it.
- Actions are **named** (`camera_pan`, `select_part`, `grow_mode_toggle`, …), not
  raw keys. Producers translate devices into actions.
- Desktop first; the six touch gestures and the finger copy exist, and growth
  aiming is the remaining touch gap.
- Remapping is data, not code: the settings UI writes the same binding shape it
  reads, per device, as an override.
- Input only produces **intents**. The server validates them (RULE_27).

## Where the binding table lives

`config/controls.json` is the table — `bindings_desktop` (28 actions, read by the
keyboard and mouse producer) and `bindings_touch` (6 gestures, the written
specification of what the touch handlers implement). This page lists what a player
can press and why; it is not a second copy of the config, and it does not restate
every default key. A new binding is a config row plus a row here, and a player's
change is an override of that row, never a third table.
