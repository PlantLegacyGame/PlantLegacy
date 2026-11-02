# Controls

**Status:** partial (C01 foundation). The current bindings are hardcoded in
`apps/client/src/main.ts`; `config/controls.json` is still an empty stub.
**Source of truth:** DESIGN.md Part 19 and the C01 task.

## Current bindings

| Action | Binding | Notes |
|---|---|---|
| Move forward | `W` / `ArrowUp` | Sent as `PlayerInput.moveForward` |
| Move backward | `S` / `ArrowDown` | Sent as `PlayerInput.moveBackward` |
| Move left | `A` / `ArrowLeft` | Sent as `PlayerInput.moveLeft` |
| Move right | `D` / `ArrowRight` | Sent as `PlayerInput.moveRight` |
| Orbit camera | Left-drag | `OrbitControls`, with damping |
| Pan camera | Right-drag | `OrbitControls` |
| Zoom | Scroll wheel | `OrbitControls`, clamped to 10–200 units |

Input is sampled and sent to the server at 20 Hz. The server validates every
move (velocity, world bounds, quantization) and returns `REJECT` plus
authoritative state when an intent is invalid. The client never moves its own
cube.

The first-spawn hint card auto-hides after
`onboarding.show_hint_card_duration_ms`; there is no manual dismiss control yet.
The light/water/minerals readout and its tooltips exist, but the numbers are
placeholders until the server sends resource data.

## Not built yet

- The named-action input abstraction (`move_forward`, `interact`, …) and
  device producers for keyboard, mouse and touch.
- Loading bindings from `config/controls.json`; every key code is still in
  source, which is a RULE_3 gap that C01 must close.
- Rebinding UI and persistence.
- Camera recenter and game actions beyond movement.

## Contract C01 must satisfy

- Every binding is a tunable in `config/controls.json`; no key code in source.
- Actions are **named** (`move_forward`, `interact`, `open_inventory`, …), not
  raw keys. Producers translate devices into actions.
- Desktop first, but touch producers exist from day one.
- Remapping is data, not code: the settings UI writes the same config shape.
- Input only produces **intents**. The server validates them (RULE_27).

## Placeholder action groups

These names are provisional until C01 locks them:

| Group | Examples |
|---|---|
| Movement | `move_forward`, `move_back`, `strafe_left`, `strafe_right`, `jump` |
| Camera | `orbit`, `zoom_in`, `zoom_out`, `recenter` |
| Interaction | `interact`, `primary`, `secondary`, `cancel` |
| UI | `open_inventory`, `open_map`, `open_chat`, `toggle_debug` |

When the C01 input layer lands, replace this file with the actual action table,
default bindings, and the touch layout.
