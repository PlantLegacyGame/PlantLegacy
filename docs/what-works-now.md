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
- **T01 growth & C02 plant renderer:** server-authoritative typed-node growth with root competition, canopy shading, root attack. **C02 procedural plant renderer** renders plants as unified organic living bodies via Raymarched Signed Distance Fields (SDF) with polynomial smooth minimum (`smin`) primitive fusion, continuous 3D triplanar noise, vertex wind sway, Inigo Quilez ambient occlusion (AO), and local bounding volumes. Features botanical Murray's law allometric tapering (sturdy base trunk tapering into delicate twigs aloft), paper-thin elliptic lancet foliage (eliminating hockey-puck disc thickness), smooth branch collar fillets without joint lumpiness, and real-time 0.9s growth emergence animations for seed split, shoot elongation, and leaf unfurling. Full geometric bounding box frustum culling guarantees branches extending from bases behind the camera remain fully visible.




- **T00A:** tile resource model (light/moisture/minerals), onboarding hint card
  and tooltips.
- **T03 multiplayer world:** plants persist across disconnect (binary snapshot +
  event log in Postgres). Offline simulation tiers (Active/Near/Dormant) with
  catch-up integration. Interest management with spatial cells and entity caps.
  Event bus for decoupled game events. Tick-budget metrics logged per tick.
  **Reconnect window (5 min) + PLANT_SYNC on join + PLANT_CREATED/PLANT_REMOVED broadcasts + PLANT_SYNC_REQUEST on tab visibility.**
- **T08C accounts and sessions:** sign-up, login, logout, token refresh;
  argon2id password hashing; JWT access (15 min) + refresh (30 days) tokens with
  rotation; IP rate limits and account lockout after failed attempts; WebSocket
  auth via HELLO accessToken; plant ownerId = accountId for persistence.
- **T07 Weather & Day/Night:** 5-state weather state machine (`clear`, `rain`, `thunderstorm_telegraph`, `thunderstorm_active`, `thunderstorm_aftermath`) with Markov transition probabilities, day/night diurnal orbital cycle (1800s day, 0.66 day fraction, dynamic solar elevation and intensity), server tick integration modifying `ResourceWorld` moisture deposition and canopy light reception in real time, client `WEATHER_UPDATE` broadcast handling adjusting directional sun and ambient lighting dynamically. Fully driven by `config/weather.json` and `config/daynight.json`.
- **C03 Environment Rendering:** dynamic sky dome with zenith/horizon exponential gradient responding to diurnal time and weather condition; sun and moon celestial arcs in orbital opposition; atmospheric distance fog dynamically density-graded with horizon weather colors; lightweight instanced particle rain (1500 points, phone budget friendly, zero-cost when dry); thunderstorm lightning flashes with randomized multi-frame strobe and light spike; pre-storm sulfur telegraph cast and clearing aftermath; terrain ground mesh with dynamic soil moisture darkening and mineral tinting, refining and preserving the T02 Root Sight cutaway. Driven by `config/render.json`.
- **T02 Root Sight:** two-mode camera with volumetric soil cutaway shader on the ground plane, smooth transition (500 ms ease-out), high-contrast root highlighting (#4CAF50 for local player, #FF5722 for rival plants), independent camera target, `substrate_multiplier` (0.5) configured for T06 uproot crawl. Local-only toggle via `Tab` key or touch edge button.
- **Background tab fix:** plants survive tab-out for 5 min (authenticated + anonymous), reclaim on reconnect with full PLANT_SYNC, ghost plants cleaned via PLANT_REMOVED.
- Staging client on GitHub Pages, with the API served from the local compose
  stack through a tunnel.

## Not built yet

Growth simulation (two-step pointing), chat, economy, damage,
mutation, inventory. Touch input not implemented (desktop only).

The renderer has no interpolation between server ticks. Interest management
not yet filtering STATE/KEYFRAME broadcasts. Binary protocol not on wire.

## Next

Per DESIGN.md Part 4, the next task is **T05** (Chat, Emotes, Report/Block). T05 depends on T03 + T08C.

## Explicitly not promised

Dates beyond the gate weeks in DESIGN.md, features not in the plan, and any
outcome the players have not built themselves.
