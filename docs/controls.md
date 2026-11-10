# Controls

**Status:** implemented (C01 foundation). The named-action input abstraction is complete; bindings are loaded from `config/controls.json` (active, 10 values). `config/controls.json` is no longer a stub.
**Source of truth:** DESIGN.md Part 19 and the C01 task.

## Current bindings (from `config/controls.json`)

| Action | Binding | Notes |
|---|---|---|
| Move forward | `W` / `ArrowUp` | Sent as `PlayerInput.moveForward` |
| Move backward | `S` / `ArrowDown` | Sent as `PlayerInput.moveBackward` |
| Move left | `A` / `ArrowLeft` | Sent as `PlayerInput.moveLeft` |
| Move right | `D` / `ArrowRight` | Sent as `PlayerInput.moveRight` |
| Orbit camera | Left-drag | `OrbitControls`, with damping |
| Pan camera | Right-drag | `OrbitControls` |
| Zoom (mouse) | Scroll wheel | `OrbitControls`, smooth continuous zoom |
| Zoom (keyboard) | `-` / `+` (or `=`) | Smooth keyboard zoom with acceleration/damping |
| Focus node | Click on player node | Recenters and smoothly frames node at ideal zoom distance |
| Growth draw | Click option + Drag | Silky-smooth gene-constrained 3D vector with HUD guide |
| Root Sight toggle | `Tab` | Toggles organic ground cutaways & subterranean camera elevation |
| Emote wheel | `G` | Opens emote selection |
| Growth intent | `E` | Opens growth panel on selected node |

Input is sampled and sent to the server at 20 Hz. The server validates every
move (velocity, world bounds, quantization) and returns `REJECT` plus
authoritative state when an intent is invalid. The client never moves its own
cube.

The first-spawn hint card auto-hides after
`onboarding.show_hint_card_duration_ms`; there is no manual dismiss control yet.
The light/water/minerals readout and its tooltips exist, but the numbers are
placeholders until the server sends resource data.

## Implemented by C01

- Named-action input abstraction (`move_forward`, `interact`, …) and device producers for keyboard, mouse.
- Loading bindings from `config/controls.json`; every key code is data, not source.
- Context rules: modal > text input > context actions > camera.
- Gameplay code reads action state via `isActive(actionId)`, never raw keys.
- `InputBus` with `isActive`, `wasPressed`, `getAxis` for 2D movement axes.

## Not built yet

- Touch producers for mobile (desktop only currently).
- Rebinding UI and persistence.
- Camera recenter and game actions beyond movement.

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
| Movement | `move_forward`, `move_back`, `strafe_left`, `strafe_right`, `jump` |
| Camera | `orbit`, `zoom_in`, `zoom_out`, `recenter` |
| Interaction | `interact`, `primary`, `secondary`, `cancel` |
| UI | `open_inventory`, `open_map`, `open_chat`, `toggle_debug` |

When the C04 settings UI lands, replace this file with the actual action table,
default bindings, and the touch layout.
