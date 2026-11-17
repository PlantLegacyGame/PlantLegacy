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
| Select node | Left-click / Tap | In Grow Mode: opens growth options. In Normal Mode: focuses camera on node |
| Grow Mode toggle | `G` | Toggles between Normal Mode and Grow Mode |
| Root Sight toggle | `R` | Toggles organic ground cutaways & subterranean camera elevation. It also opens by itself when a radicle or root starts growing (`root_sight.auto_open_on_root_growth`); a hand-close then stands until the next buried part starts |
| Emote wheel | `E` | Opens emote selection |
| Inventory / Overview | `I` | Toggles combined inventory + plant overview panel |
| Inventory slot 1–10 | `1`–`9`, `0` | Selects inventory slot |
| Cancel growth / Close panel | `Escape` / Right-click (context) | Cancels growth drawing, hides panels |
| Dev panel toggle | `` ` `` (backtick) | Opens dev panel with admin commands (only with `?dev=1`) |
| Planet orbit view | Dev panel → Camera → Orbit Planet / Local View | No key binding by request; the action is `planet_view_toggle` but it is not bound |
| Debug overlay toggle | `Shift` | Toggles debug metrics overlay |
| Hint card toggle | `H` | Shows/hides first-spawn hint card |
| Regenerate plant (dev) | `R` (dev context) | Generates test plant at origin |

Input is sampled and sent to the server at 20 Hz. The camera is client-side and
server-unvalidated: `INPUT` frames are stored and only advance `lastInputTick`
(ack-only heartbeat), and the unused `validateMovement` helper has been deleted
rather than left as a pretend movement check. `REJECT` is returned for invalid
growth intents, not for movement. The client never moves its own cube.

The first-spawn hint card auto-hides after
`onboarding.show_hint_card_duration_ms`; `H` toggles it back on.
The light/water/minerals readout and its tooltips exist and show real tile
readings once the server sends `RESOURCE_UPDATE` data.

## Grow Mode vs Normal Mode

- **Normal Mode (default):** Left-click a node → camera smoothly focuses on that node. No growth panel opens.
- **Grow Mode:** Press `G` to toggle. Left-click a node → growth options panel opens for that node. Select an option, then drag on the canvas to set growth direction, release to confirm.

Mode state is shown in the UI (top-left indicator).

## Chat (T05)

- **Chat panel** (`T` key): proximity and world tabs, send on Enter, auto-shows briefly on new messages, scrollback capped at 50 messages.
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
- **Inventory/Overview panel** (`I` key): centered panel with plant stats and inventory slot grid (visual stub; slot logic not yet wired).

## Not built yet

- Touch producers for mobile (desktop only currently).
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