# What works now

Honest list. No feature promises (T42, RULE_13). Updated at every gate.

## Working

- Monorepo, CI, config validator with the rarity ban, Docker image and compose
  stack, `/health` and `/ready`.
- One-command local start (`pnpm dev`) and a strict verify chain (`pnpm verify`).
- **T03P networking gate:** two tabs, one server, one server-authoritative cube
  per player over WebSocket + JSON at 20 Hz. WASD/arrows move the cube and the
  server broadcasts `STATE` / `KEYFRAME`. The rejection code exists but the
  velocity and world-bounds checks are currently ineffective; see the known
  gaps in [`protocol.md`](./protocol.md).
- **C01 client foundation:** Vite 8 + Three.js r187 scene, orbit/zoom/pan
  camera (`OrbitControls`), WebSocket connection, responsive canvas, lighting
  and shadows.
- **T00A onboarding:** dismissible three-line hint card and tooltips on the
  light / water / minerals readout, loaded from `/config/onboarding`.
- **T01 renderer prototype:** a GPU point renderer with Root Sight-style
  shaders, layered soil ground, and a client-generated test plant. It is a
  visual prototype, not simulated plant state; server cube positions are mapped
  onto the points.
- Staging client on GitHub Pages, with the API served from the local compose
  stack through a Cloudflare quick tunnel.

## Not built yet

Growth simulation, server-side plant nodes, persistence, accounts, chat,
economy, damage, weather, mutation, inventory, and a real Root Sight toggle
(the shader exists; the camera/soil cutaway does not). Input is hardcoded
WASD/arrows rather than the C01 action/rebinding layer, and there is no touch
input. The renderer has no interpolation between server ticks.

## Next

Per DESIGN.md Part 4, the next task is **T01 Growth**: typed nodes, biomass
costs, root competition, canopy shading and root attack. **C02** (procedural
plant renderer v1) follows. The renderer prototype committed under the T01
label is a prerequisite for that work, not the growth simulation itself.

## Explicitly not promised

Dates beyond the gate weeks in DESIGN.md, features not in the plan, and any
outcome the players have not built themselves.
