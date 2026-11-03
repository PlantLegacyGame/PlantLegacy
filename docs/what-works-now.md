# What works now

Honest list. No feature promises (T42, RULE_13). Updated at every gate.

## Working

- Monorepo, CI, config validator with the rarity ban, Docker image and compose
  stack, `/health` and `/ready`.
- One-command local start (`pnpm dev`) and a strict verify chain (`pnpm verify`).
- **T03P networking gate:** two tabs, one server, one server-authoritative cube
  per player over WebSocket + JSON at 20 Hz. WASD/arrows move the cube and the
  server broadcasts `STATE` / `KEYFRAME`. Server rejects velocity-exceeded and
  out-of-bounds inputs with `REJECT` + authoritative `STATE` correction.
- **C01 client foundation:** Vite 8 + Three.js r187 scene, orbit/zoom/pan
  camera (`OrbitControls`), WebSocket connection, responsive canvas, lighting
  and shadows. **Input abstraction** with named actions and producers
  (keyboard/mouse), bindings loaded from `/config/controls` (rebindable).
  **UI shell** with layered DOM overlay (hud/panel/menu/modal/toast/tooltip/debug),
  theme tokens as CSS variables, global text-scale (80–150%), toast notifications.
  **Quality controller** with hardware-tier detection and dynamic pixel-ratio
  scaling to hold target FPS. **Debug overlay** (`\`` key) shows fps, frame ms,
  triangles, draw calls, memory, network KB/s. **Pause on hidden tab**.
  Config served via `/config/render`, `/config/controls`, `/config/ui`.
- **T00A onboarding:** dismissible three-line hint card and tooltips on the
  light / water / minerals readout, loaded from `/config/onboarding`.
- **T01 growth:** server-authoritative typed-node growth with root competition,
  canopy shading, root attack. Procedural plant renderer v1 (C02) renders
  growing plants.
- **T00A:** tile resource model (light/moisture/minerals), onboarding hint card
  and tooltips.
- **T03 multiplayer world:** plants persist across disconnect (binary snapshot +
  event log in Postgres). Offline simulation tiers (Active/Near/Dormant) with
  catch-up integration. Interest management with spatial cells and entity caps.
  Event bus for decoupled game events. Tick-budget metrics logged per tick.
  Reconnect window implemented.
- **T08C accounts and sessions:** sign-up, login, logout, token refresh;
  argon2id password hashing; JWT access (15 min) + refresh (30 days) tokens with
  rotation; IP rate limits and account lockout after failed attempts; WebSocket
  auth via HELLO accessToken; plant ownerId = accountId for persistence.
- Staging client on GitHub Pages, with the API served from the local compose
  stack through a tunnel.

## Not built yet

Growth simulation (two-step pointing), chat, economy, damage,
weather, mutation, inventory, and a real Root Sight toggle (the shader exists;
the camera/soil cutaway does not). Touch input not implemented (desktop only).
The renderer has no interpolation between server ticks. Interest management
not yet filtering STATE/KEYFRAME broadcasts. Binary protocol not on wire.

## Next

Per DESIGN.md Part 4, the next tasks are **T02** (Root Sight), **T07** (Weather and Day/Night), **C03** (Environment Rendering). **T02** depends on T01 + C01.

## Explicitly not promised

Dates beyond the gate weeks in DESIGN.md, features not in the plan, and any
outcome the players have not built themselves.
