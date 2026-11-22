# Controls

**Status:** implemented (C01 foundation). The named-action input abstraction is complete; bindings are loaded from `config/controls.json` (active, 10 values). `config/controls.json` is no longer a stub.
**Source of truth:** DESIGN.md Part 19 and the C01 task.

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
| Zoom (mouse/touch) | Scroll wheel / Pinch | `OrbitControls`, smooth continuous zoom |
| Zoom (keyboard) | `-` / `+` (or `=`) | Smooth keyboard zoom with acceleration/damping |
| Recenter camera | `Space` / Double-click ground / Double-tap | Frames root node |
| Select node | Left-click / Tap | In Grow Mode: opens growth options. In Normal Mode: focuses camera on node. A near-tie between a parent's and child's pick sphere goes to the deeper node |
| Name a part | Hover a plant part | Shows `Leaf #2` and its place in the plant, plus how many growth options the server reports. The "click to see what it can grow" promise appears only when that count is above zero |
| Grow Mode toggle | `G` | Toggles between Normal Mode and Grow Mode |
| Root Sight toggle | `R` | Toggles organic ground cutaways & subterranean camera elevation. It also opens by itself when a radicle or root starts growing (`root_sight.auto_open_on_root_growth`); a hand-close then stands until the next buried part starts |
| Emote wheel | `E` | Opens emote selection |
| Inventory / Overview | `I` | Opens the inventory and plant overview together; once they are up, toggles the inventory only, so closing one panel never takes the other with it |
| Inventory slot 1–10 | `1`–`9`, `0` | In the world, selects and uses a hotbar slot. With the inventory open, moves the inventory selection only, where typing a count is the point |
| Collect drop | Left-click a drop within `render.drop_pick_distance_m` | Sends `DROP_COLLECT` for a dung, remains or fragment marker. The server owns the reward and removal |
| Shop | Spore chip `+` / title screen Shop button | Opens the shop panel; the balance and prices are the server's |
| Cancel growth / Close panel | `Escape` / Right-click (context) | Cancels growth drawing, closes the open plant panels or wheel, otherwise opens the pause menu. A panel's own close button closes that panel alone |
| Pause menu | `Escape` in the world | Resume, Settings, Controls, Leave to title. Also the action bar's Menu button, so it is reachable on touch |
| Operator readout, growth readout | dev panel → Debug | The tick card and the growth readout are switches in the dev panel. They were F3 and F2: F3 is the browser's find bar in Chrome and quick-find in Firefox, and both are function keys a browser game must not claim |
| Dev panel toggle | `` ` `` (backtick) | Opens dev panel with admin commands (only with `?dev=1`). The dev panel's Debug tab also owns the three readouts below |
| Planet orbit view | Dev panel → Camera → Orbit Planet / Local View | No key binding by request; the action is `planet_view_toggle` but it is not bound |
| Debug overlay | dev panel → Debug → Metrics overlay | Unbound on purpose. It used to be a bare `Shift`, which fired every time a player held shift to select or capitalise, and swallowed the modifier. |
| Hints | `H` | Shows the key list on demand and re-enables hints. Hints themselves are contextual: each one appears once, when it is relevant |
| Regenerate plant (dev) | `R` (dev context) | Generates test plant at origin |

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

Mode is shown three ways, none of them text in a readout: the screen edge takes a
green tint, the cursor becomes a crosshair, and the bar's Grow button is held
down with a `GROW MODE` badge above it.

## Chat (T05)

- **Chat panel** (`T` key): proximity and world tabs, send on Enter, auto-shows briefly on new messages, scrollback capped at 50 messages. Full width above the action bar under 560px.
- **Rate limiting:** world chat limited to `chat.world_rate_msg_per_min` (default 12/min).
- **Block:** right-click any chat message → Block player. Blocked players' chat and emotes are hidden from you. Block persists for the session.
- **Report:** right-click any chat message → Report. Opens a modal dialog with pre-filled target, reason dropdown (RULE_6 categories), free-text additional info, and optional block checkbox. Reports are sent server-side with a context snapshot of recent chat lines. Rate-limited to `reports.report_rate_limit_per_min` (default 5/min).

## Implemented by C01

- Named-action input abstraction (`move_forward`, `interact`, …) and device producers for keyboard, mouse.
- Loading bindings from `config/controls.json`; every key code is data, not source.
- Context rules: modal > text input > context actions > camera.
- Gameplay code reads action state via `isActive(actionId)`, never raw keys.
- `InputBus` with `isActive`, `wasPressed`, `getAxis` for 2D movement axes.
- **Emote wheel UI** (`E` key): circular emote selector with center close button, click-outside to close, Escape to close. Sends `/emote <id>` via chat message type.
- **Inventory/Overview panel** (`I` key): centred panel with plant stats and the server's inventory slot grid. The grid and the always-on hotbar are fed by `INVENTORY_SYNC` / `INVENTORY_SLOT_UPDATE`; number keys `1`–`9` and `0` select and use outside the inventory, and select only while it is open. Drag-and-drop reordering is not built yet.

## Not built yet

- Touch producers for growth aiming beyond tap-to-pick (long-press a node for its
  menu, per DESIGN 17.5). The camera, the action bar, the reroot pad and the panels
  all work on touch today; the growth aim still turns from a drag, not a gesture.
- Rebinding UI and persistence.
- Camera recenter and game actions beyond movement.
- Inventory slot selection logic (actions bound, grid rendered, selection not wired).

## Contract C01 satisfies

- Every binding is a tunable in `config/controls.json`; no key code in source.
- Actions are **named** (`move_forward`, `interact`, `open_inventory`, …), not
  raw keys. Producers translate devices into actions.
- Desktop first; touch producers planned.
- Remapping is data, not code: the settings UI writes the same config shape.
- Input only produces **intents**. The server validates them (RULE_27).

## Placeholder action groups

These names are provisional until C04 adds the full settings UI:

| Group | Examples |
|---|---|
| Camera | `camera_orbit`, `camera_pan`, `camera_zoom`, `camera_recenter`, `camera_pan_forward`, `camera_pan_backward`, `camera_pan_left`, `camera_pan_right` |
| Interaction | `select_part`, `grow_mode_toggle`, `grow_cancel` |
| UI | `root_sight_toggle`, `emote_wheel`, `inventory_overview_toggle`, `inventory_slot_1`–`inventory_slot_10`, `dev_panel_toggle`, `debug_toggle`, `hint_card_toggle` |
| Dev | `plant_regenerate` |

When the C04 settings UI lands, replace this file with the actual action table,
default bindings, and the touch layout.