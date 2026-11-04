# T02 manual checklist

Run with the local stack (`pnpm dev`). A box is checked only when the command or flow was executed and the stated result observed.

## 1. Config and routes

- [x] `pnpm config:validate`
  - Expected: 75 file(s), OK.
  - Observed: 75 files OK, `config/root_sight.json` valid extended-1 schema.
- [x] `curl http://127.0.0.1:8080/config/root_sight`
  - Expected: 200 JSON with `cutaway_radius`, `transition_ms`, `soil_opacity`, `own_root_highlight_color`, `rival_root_highlight_color`, `substrate_multiplier`, `camera_target`.
  - Observed: 200 JSON with values loaded from `config/root_sight.json`.

## 2. Root Sight two-mode camera

- [x] Surface view (default):
  - Ground plane is opaque with grid lines.
  - OrbitControls allows orbiting, panning, and zooming smoothly around plant.
- [x] Press `Tab` to toggle Root Sight:
  - Transition smoothly animates over configured `transition_ms` (500 ms) using cubic ease-out.
  - Ground circle inside `cutaway_radius` (50.0 units) becomes semi-transparent (soil opacity 0.3).
  - Grid lines fade down to prevent underground clutter.
  - Root tubes and root crown highlight in vivid green (`own_root_highlight_color: #4CAF50`).
- [x] Press `Tab` again to exit Root Sight:
  - Smoothly reverses back to full surface opacity.
- [x] Camera independence (RULE_18, RULE_27):
  - OrbitControls continues to rotate, pan, and zoom seamlessly underground.
  - The plant does not move, rotate, or shift.
- [x] Multiplayer invisibility (RULE_4, RULE_27):
  - In a two-tab test, toggling `Tab` in Tab 1 emits zero WebSocket messages to the server. Tab 2 sees no state change.
  - Tab 2's roots inside Tab 1's cutaway are highlighted in `rival_root_highlight_color` (`#FF5722`), distinctly differentiated from Tab 1's own green roots.

