# Controls

**Status:** stub (T00). Owned by **C01**; bindings live in `config/controls.json`.
**Source of truth:** DESIGN.md Part 19 and the C01 task.

Nothing is bound yet. The Phase 0 client has one implicit action: it probes the
server on load. C01 introduces the input abstraction (named actions + producers
for keyboard, mouse and touch) and fills `config/controls.json`.

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

When C01 lands, replace this file with the actual action table, default
bindings, and the touch layout.
