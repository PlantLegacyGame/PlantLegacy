# T02 manual checklist

Run with the local stack (`pnpm dev`). A box is checked only when the command or flow was executed and the stated result observed.

## 1. Config and routes

- [x] `pnpm config:validate`
  - Expected: 79 file(s), OK.
  - Observed: OK for every file then present (75 at the time of the first run; the count is owned by [`docs/tunables.md`](../tunables.md) and is 79 today), `config/root_sight.json` valid extended-1 schema.
- [x] `curl http://127.0.0.1:8080/config/root_sight`
  - Expected: 200 JSON with **every** entry in `config/root_sight.json` — `cutaway_radius`, `transition_ms`, `soil_opacity`, both highlight colours, `substrate_multiplier`, `camera_target`, `max_cavity_bubbles`, `bubble_merge_cell_m`, `bubble_padding_m`, `rival_bubble_budget`, `camera_burrow_enabled`, `max_burrow_depth_m`, `cavity_clearance_m`, `rebuild_hz`, `auto_open_on_root_growth`, `eye_window_radius_m` (18 entries).
  - Observed (2026-11-16): 200 with all 17 keys. It used to serve 7 of them from a hand-written whitelist, so the cavity ran on compiled-in defaults; see A12 in [`docs/bug-inventory.md`](../bug-inventory.md).

## 2. Root Sight two-mode camera

- [x] Surface view (default):
  - Ground plane is opaque with grid lines.
  - OrbitControls allows orbiting, panning, and zooming smoothly around plant.
- [x] Press `R` to toggle Root Sight (`root_sight_toggle` in `config/controls.json`):
  - Transition smoothly animates over configured `transition_ms` (500 ms) using cubic ease-out.
  - The soil opens as an organic envelope around the subterranean root nodes (multi-node `smin`), sized from `cutaway_radius` and the plant extent.
  - The cavity rim is resolved by coverage rather than a speckled band, and shows packed earth behind the roots; the sky above the horizon keeps its normal colours.
  - Grid lines fade down to prevent underground clutter.
  - Root tubes and root crown highlight in vivid green (`own_root_highlight_color: #4CAF50`).
- [x] Press `R` again to exit Root Sight:
  - Smoothly reverses back to full surface opacity.
- [x] Camera independence (RULE_18, RULE_27):
  - OrbitControls continues to rotate, pan, and zoom seamlessly underground.
  - The plant does not move, rotate, or shift.
- [ ] Auto-open on buried growth (A7/A11, INV-RS-03):
  - Grow a radicle or root without pressing `R`: the ground opens on the first frame of growth (`Root Sight: opened - a buried part is growing`), not after the part has emerged.
  - Press `R` to close it; it stays closed while that growth continues.
  - Grow another buried part: it opens again.
  - Set `auto_open_on_root_growth` to `false` in `config/root_sight.json` and reload: growth no longer opens the view.
- [x] Multiplayer invisibility (RULE_4, RULE_27):
  - In a two-tab test, toggling `R` in Tab 1 emits zero WebSocket messages to the server. Tab 2 sees no state change.
  - Tab 2's roots inside Tab 1's cutaway are highlighted in `rival_root_highlight_color` (`#FF5722`), distinctly differentiated from Tab 1's own green roots.

- [ ] Roots are visible through the opening, from both sides (A13, INV-RS-14/15):
  - From above, a deep root under the hole is drawn; a shallow root outside the
    hole is not (the test is the aperture cylinder, not a sphere around the crown).
  - Orbit down until the eye is under the soil: the cavity is still air, the roots
    are still drawn, and there is a clear window of air around the camera
    (`root_sight.eye_window_radius_m`, 1.1 m). Set it to `0` and reload: the soil
    closes in around the eye again.
  - With the camera close to the bowl wall from inside the dirt, roots are visible
    in front of the wall instead of a wall alone.
