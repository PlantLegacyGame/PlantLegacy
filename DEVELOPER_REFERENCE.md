# Plant Legacy — Complete Developer Reference

**Last Updated:** 2026-11-02  
**Current Phase:** Gate 0 complete; Gate 1 run-up (Week 3-24)  
**Completed Tasks:** T00, O01, **T03P**, **C02**, **T01**  
**Partial Tasks:** C01 (foundation slice), T00A (onboarding slice)  
**Next Task:** **C03 Environment Rendering** (DESIGN.md Part 6.1)

---

## 📋 Project Status at a Glance

| Task | Status | Description |
|------|--------|-------------|
| T00 | ✅ Complete | Foundation: monorepo, 75 config files, config validator, rarity ban (RULE_20), account-bound invariant (RULE_23) |
| O01 | ✅ Complete | Repo + deploy pipeline: pnpm, Biome, CI, Docker, GitHub Pages, `/health` + `/ready` |
| T03P | ✅ Complete | WebSocket + JSON protocol, 20 Hz authoritative cubes; velocity/bounds rejection effective and tested |
| C01 | ⚠️ Partial | Vite + Three.js client, OrbitControls, WebSocket; no input abstraction, UI shell or debug overlay |
| C02 | ✅ Complete | Procedural plant renderer v1: tapered tubes, instanced leaves, shared material, triplanar noise, wind, health tint, 3 mutation signatures, L0/L1 |
| T00A | ⚠️ Partial | 3-line hint card and resource tooltips; tile grid and resource simulation not built |
| T01 | ✅ Complete | Server-authoritative typed-node growth: biomass cost, root competition, canopy shading, root attack; client renders growing plant via C02; biomass UI readout; 'G' key to grow |

### What Works Now (Live)
- **Local dev:** `pnpm dev` → server (8080) + Vite client (4173) with hot reload
- **Staging:** GitHub Pages at `https://plantlegacygame.github.io/PlantLegacy/`, API via Cloudflare quick tunnel
- **Protocol:** WebSocket v1 documented in `docs/protocol.md`; two tabs, server-authoritative cubes
- **Client:** Three.js scene, OrbitControls, C02 procedural plant renderer (tapered tubes + instanced leaves, shared material, triplanar noise, wind, health tint, mutation signatures, L0/L1), onboarding overlays
- **Config:** 75 files in `config/` (extended-1 format), validated at startup + CI

---

## 🔧 1. Local Development (Daily Workflow)

### Primary Command
```bash
pnpm dev
```
**What it does:**
1. Checks for `node_modules` → runs `pnpm install` if missing
2. Starts **server** in watch mode (`node --watch src/main.ts`) on `http://127.0.0.1:8080`
3. Starts **Vite dev server** on `http://localhost:4173` with:
   - Hot module replacement (HMR)
   - Proxy for `/health`, `/ready`, `/config`, `/ws` → server
   - Serves `apps/client/index.html` as entry

**Open:** `http://localhost:4173` in **two tabs** to test multiplayer sync  
(Use `localhost`, not `127.0.0.1`; Vite binds the IPv6 loopback on Windows.)  
**Stop:** `Ctrl+C` in the terminal running `pnpm dev`

### Verification Commands
```bash
pnpm verify        # Full CI chain: lint + typecheck + config:validate + test
pnpm lint          # Biome check (formatter + linter)
pnpm lint:fix      # Auto-fix lint issues (safe fixes only)
pnpm typecheck     # TypeScript strict check across all packages
pnpm config:validate  # Validates all 75 config files (schema + rarity ban + account-bound)
pnpm test          # node --test in packages/shared + apps/server
pnpm build         # Production build: Vite → apps/client/dist
pnpm start         # Server only (no watch), for production
```

### Key URLs (Local)
| Service | URL | Purpose |
|---------|-----|---------|
| Client | `http://localhost:4173` | Three.js game client |
| Server HTTP | `http://127.0.0.1:8080` | `/health`, `/ready`, `/config/onboarding`, `/config/plant_renderer` |
| Server WS | `ws://127.0.0.1:8080/ws` | WebSocket for game protocol |

---

## 🌐 2. Staging Deploy (Public Demo) — Manual Process

### Prerequisites (One-Time Setup)
- [x] GitHub repo: `PlantLegacyGame/PlantLegacy`
- [x] Pages enabled: Settings → Pages → **Build and deployment** → Source = **GitHub Actions**
- [x] Docker Desktop installed and running
- [x] `cloudflared` installed

### Required GitHub Repository Variable
| Name | Value | Where |
|------|-------|-------|
| `STAGING_SERVER_ORIGIN` | `https://<your-tunnel>.trycloudflare.com` | Settings → Secrets and variables → Actions → Variables |

> **Important:** This MUST be the **server's public URL** (Cloudflare tunnel), NOT the GitHub Pages URL. The deploy workflow injects this into the client's `<meta name="server-origin">` so the browser knows where to connect.

### `ops/.env` (gitignored, never commit)
```dotenv
NODE_ENV=staging
CORS_ORIGINS=https://plantlegacygame.github.io,https://<current-tunnel>.trycloudflare.com,http://localhost:4173,http://127.0.0.1:4173,http://localhost:4174
```
`POSTGRES_PASSWORD` is intentionally unset: the existing `ops_pgdata` volume was
initialised with the compose default. Changing it breaks auth. Do **not** run
`down -v` unless you accept losing the volume.

### Step-by-Step Deploy Process

#### Window 1 — Start Staging Stack (Server + Postgres)
```powershell
cd C:\Users\khmer\PlantLegacy

docker compose -f ops/compose.yml up -d --build

# Wait for the Postgres healthcheck, then verify:
curl.exe http://localhost:8080/health
curl.exe http://localhost:8080/ready
```
**Expected:** Both return 200. `/ready` must show `"ready":true` and `"database":"ok"`.

#### Window 2 — Start Cloudflare Tunnel
```powershell
cloudflared tunnel --url http://localhost:8080
```
**Copy the HTTPS URL** (e.g., `https://abc123.trycloudflare.com`) — **this changes every restart**

#### Wire the tunnel origin
1. Put the tunnel origin in `ops/.env` → `CORS_ORIGINS`.
2. Restart the server so it picks up the value:
   `docker compose -f ops/compose.yml up -d server`
3. GitHub → `https://github.com/PlantLegacyGame/PlantLegacy/settings/variables/actions`
   → edit `STAGING_SERVER_ORIGIN` → paste the **new** tunnel URL.

#### Trigger Deploy
```powershell
cd C:\Users\khmer\PlantLegacy
git commit --allow-empty -m "trigger staging deploy"
git push origin main
```

#### Verify
1. **GitHub Actions** → `deploy-staging` → wait for **green**.
2. **Pages URL:** `https://plantlegacygame.github.io/PlantLegacy/` → canvas renders,
   hint card appears, and DevTools shows `wss://<tunnel>/ws` **101** plus
   `/config/onboarding` and `/config/plant_renderer` **200**.

### Keep Running for Demo
- **Window 1** (docker compose) — must stay open
- **Window 2** (cloudflared) — must stay open
- **On restart:** update `ops/.env` and `STAGING_SERVER_ORIGIN`, then re-run the deploy (the tunnel URL changes every time)

---

## 🛑 3. Stop Everything

```powershell
# Stop staging stack (frees ports 8080, 5432)
docker compose -f ops/compose.yml down
# Add -v ONLY if you accept losing the ops_pgdata volume (its password is baked in).

# Stop local dev (Ctrl+C in pnpm dev terminal)
# Stop tunnel (Ctrl+C in cloudflared terminal)
```

---

## 🖥️ 4. Future: Persistent Staging (VPS Options)

When you want a persistent staging server that doesn't require tunnel restarts:

### Option A: Cloudflare Named Tunnel (Free, Fixed URL)
1. Sign up at `https://dash.cloudflare.com` → Zero Trust → Networks → Tunnels
2. Create tunnel → copy token → `cloudflared service install <token>`
3. Fixed URL: `https://your-chosen-name.trycloudflare.com`
4. Set `STAGING_SERVER_ORIGIN` **once** — never changes

### Option B: Free VPS Providers

| Provider | Credit Card? | Specs | Notes |
|----------|--------------|-------|-------|
| **Oracle Cloud Always Free** | Yes (verify only) | 4 ARM cores, 24 GB RAM, 200 GB | Best specs; ARM architecture |
| **Fly.io** | Yes (verify) | Free allowance (~3M CPU-sec/mo) | Easy Docker deploy |
| **Railway** | Trial only | $5/mo credit | Simple but may need card later |
| **Koyeb** | No | 1 vCPU, 512 MB RAM | Free tier, limited regions |
| **Render** | No | Free tier | Spins down after 15min idle |

### VPS Deploy Commands
```bash
# On the VPS (Ubuntu/Debian)
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker

git clone https://github.com/PlantLegacyGame/PlantLegacy.git
cd PlantLegacy

export NODE_ENV=staging
export POSTGRES_PASSWORD=<strong-random-password>
export CORS_ORIGINS=https://plantlegacygame.github.io
docker compose -f ops/compose.yml up -d --build

# Verify
curl http://localhost:8080/health
curl http://localhost:8080/ready
```

Then set `STAGING_SERVER_ORIGIN` to an **HTTPS** origin (a domain behind Caddy,
nginx or a named Cloudflare tunnel). GitHub Pages is HTTPS, so a plain
`http://<vps-ip>:8080` API is blocked by the browser as mixed content.

---

## 📚 5. Project Architecture Reference

### Repository Structure
```
PlantLegacy/
├── .github/workflows/
│   ├── ci.yml              # Lint, typecheck, config:validate, test, build
│   └── deploy-staging.yml  # Build client → GitHub Pages on main push
├── apps/
│   ├── client/             # Vite + Three.js client (C01, T00A, C02)
│   │   ├── index.html      # Vite entry + meta[name=server-origin]
│   │   ├── src/
│   │   │   ├── main.ts     # Game client entry (WebSocket, Three.js, input, overlays)
│   │   │   ├── styles.css  # Page + overlay styles
│   │   │   ├── config/plantRendererConfig.ts  # fetch + fallback for /config/plant_renderer
│   │   │   └── renderers/PlantRenderer.ts     # C02: tapered tubes, instanced leaves, shared plant material, triplanar noise, wind, health tint, mutation signatures, L0/L1 LOD
│   │   ├── scripts/        # Legacy preview helpers (unused by `pnpm dev`)
│   │   ├── vite.config.ts  # Vite config with dev proxy + Pages base path
│   │   └── package.json    # deps: three, vite, @vitejs/plugin-legacy
│   └── server/             # Node HTTP + WebSocket server
│       ├── src/
│       │   ├── main.ts     # HTTP + WebSocket server, CubeWorld, /config routes
│       │   ├── core/       # config.ts, version.ts
│       │   └── ops/        # net.ts (protocol), health.ts, db.ts, log.ts
│       ├── Dockerfile      # Node 24 alpine, runs TS directly
│       └── package.json    # deps: ws, pg, @plant-legacy/shared
├── packages/shared/        # Shared code (no build step)
│   └── src/
│       ├── config/         # Config loader, validator, types
│       ├── protocol/       # PROTOCOL_VERSION, frame header
│       ├── events/         # GAME_EVENTS vocabulary
│       ├── ids/            # Prefixed opaque IDs
│       ├── math/           # clamp, lerp
│       └── schemas/        # Item, death-record schemas
├── config/                 # 75 tunable files (extended-1 format)
│   ├── _meta/schema.json   # JSON Schema for editors
│   ├── _meta/validator-rules.md  # Authoritative validator rules
│   ├── ops.json            # O01, active: ports, CORS, DB, health, log
│   ├── compliance.json     # T00, draft: 5-line illegal-content policy
│   ├── net_proto.json      # T03P, draft: protocol tunables
│   ├── onboarding.json     # T00A, draft: hint card + resource tooltips
│   ├── plant_renderer.json # T01, draft: Root Sight renderer tunables
│   └── *.json              # 70 stub configs for future tasks
├── tools/
│   ├── dev.mjs             # pnpm dev orchestrator
│   ├── config-validator/   # CLI for config validation
│   └── sim-bots/load-test/seed-data/backup/  # Placeholders
├── ops/
│   ├── compose.yml         # Docker Compose: server + postgres:17-alpine
│   └── docker/backup-scripts/deploy/  # Documentation
├── docs/
│   ├── protocol.md         # Wire protocol spec (T03P)
│   ├── tunables.md         # Config file → task mapping
│   ├── what-works-now.md   # Honest status
│   ├── tasks/              # Task records (T00.md, O01.md, etc.)
│   └── checklists/         # Manual test checklists
├── DESIGN.md               # Master Build Plan v5.3.1 (SOURCE OF TRUTH)
├── CONTEXT.md              # Current stack, interfaces, locked decisions
├── README.md               # Quick start, scripts, layout
├── pnpm-workspace.yaml     # Workspace config
├── tsconfig.base.json      # TypeScript base config
├── biome.json              # Lint/format config
└── .env.example            # Environment variable template
```

### Key Config Files
| File | Owner | Status | Values | Purpose |
|------|-------|--------|--------|---------|
| `ops.json` | O01 | active | 12 | Server: port, CORS, DB pool, health paths, log level |
| `compliance.json` | T00 | draft | 3 | 5-line illegal-content-only policy (RULE_6) |
| `net_proto.json` | T03P | draft | 9 | Protocol: tick rate, quantization, velocity limit, world bounds |
| `onboarding.json` | T00A | draft | 3 | Hint card (3 lines), resource tooltips, duration |
| `plant_renderer.json` | C02 | draft | 30 | Tapered tube, instanced leaf, LOD, wind, health tint, mutation tunables |
| `*.json` (70 files) | various | stub | 0 | Empty `values: {}` — filled by owning task |

`pnpm config:validate` checks every row above. `docs/tunables.md` lists each key,
its type, range and default.

---

## 🔑 6. Critical Rules (Locked Decisions)

These are **non-negotiable** — violating them breaks the architecture:

| Rule | Description | Enforced By |
|------|-------------|-------------|
| **RULE_3** | No hardcoded gameplay values — all tunables in `config/*.json` | Config validator + code review |
| **RULE_4/27** | Server authoritative for all state; client only renders + sends intents | Architecture + code review |
| **RULE_6** | No general moderation — only 5-line illegal-content policy | Compliance config + T40 |
| **RULE_13** | Minimal onboarding only: 3-line hint card + contextual tooltips | T00A implementation |
| **RULE_20** | **NO `rarity` field anywhere** — not in schemas, not in enums, not in colors | Config validator (fails build) |
| **RULE_23** | `account_bound: true` → forces `tradeable/mailable/listable = false` | Config validator + item systems |
| **RULE_31** | Single process, single World, single Postgres — no Redis, no queue | Architecture |

---

## 🚀 7. Gate 1 Run-up Roadmap (Next Tasks)

Per `DESIGN.md` Part 4, the ordered tasks to reach **Gate 1 (Week 24)**:

| Order | Task | Description | Depends On | Status |
|-------|------|-------------|------------|--------|
| 0 | **T03P** | Networking gate: config-driven move speed, snake_case `world_bounds`, rejection tested | T03P | ✅ complete |
| 1 | **T01** | Growth: typed nodes, biomass cost, root competition, canopy shading, root attack | T00A | ✅ complete |
| 2 | **C03** | Environment rendering: terrain, sky, weather visuals | C01, T01 | next |
| 2 | **C02** | Procedural plant renderer v1 (tapered tubes, instanced leaves, shared material, L0/L1) | C01 | ✅ complete |
| 3 | **T03** | Multiplayer world: persistence, offline tiers, binary framing + delta | T03P, T01 | not started |
| 4 | **T07** | Weather + day/night | T00A, T03 | not started |
| 5 | **C03** | Environment and weather visuals | T07, C01 | not started |

This table is deliberately short: it lists only the tasks whose DESIGN.md
ordering follows Gate 0. The full ordered list is DESIGN.md Part 4.

**Gate 1 Acceptance:** 50-player core-loop playtest (read resources → grow → compete → be damaged → chat)

---

## ⚡ 8. Quick Reference Card

### Daily Commands
| Goal | Command |
|------|---------|
| Start local dev | `pnpm dev` |
| Run all checks | `pnpm verify` |
| Lint + fix | `pnpm lint:fix` |
| Typecheck only | `pnpm typecheck` |
| Run tests | `pnpm test` |
| Build client | `pnpm build` |
| Start server only | `pnpm start` |

### Staging Commands
| Goal | Command |
|------|---------|
| Start staging stack | `docker compose -f ops/compose.yml up -d --build` |
| Stop staging stack | `docker compose -f ops/compose.yml down` (add `-v` only if you accept losing `ops_pgdata`) |
| Start tunnel | `cloudflared tunnel --url http://localhost:8080` |
| Trigger deploy | `git commit --allow-empty -m "deploy" && git push origin main` |
| Check Pages | `https://plantlegacygame.github.io/PlantLegacy/` |
| Check Actions | `https://github.com/PlantLegacyGame/PlantLegacy/actions` |

### Config Commands
| Goal | Command |
|------|---------|
| Validate all configs | `pnpm config:validate` |
| Add new tunable | Edit `config/<system>.json` → `pnpm config:validate` |
| View tunables index | `docs/tunables.md` |

### Debugging
| Issue | Check |
|-------|-------|
| Server won't start | `docker compose logs server` / `docker compose logs postgres` |
| CORS errors | Verify `CORS_ORIGINS` includes client origin |
| `/ready` 503 | Check Postgres health: `docker compose ps` |
| Tunnel not working | Verify `STAGING_SERVER_ORIGIN` matches current tunnel URL |
| Client not loading | Check Vite dev server output for HMR errors |

---

## 📝 9. Important Notes for Future Sessions

### Config System
- **Never hardcode values** — always use `readNumber/readInteger/readString/readBoolean/readStringArray/readObject` from `@plant-legacy/shared/config`
- **Config validator runs at server startup** — invalid config = process exits before listening
- **75 config files** — 73 DESIGN.md systems plus `onboarding.json` and `plant_renderer.json`
- **Rarity ban is absolute** — any `rarity` key or enum member fails validation
- **`account_bound: true` forces** `tradeable`, `mailable`, `listable` to `false` (RULE_23)
- **Known RULE_3 gaps to close:** `speed = 5.0` in `apps/server/src/ops/net.ts`, hardcoded WASD bindings and camera limits in `apps/client/src/main.ts`

### Client-Server Boundary
- **Client is NEVER authoritative** — it renders received state and sends input intents
- **Server owns the tick** — `CubeWorld` steps at `net_proto.tick_rate_hz` and broadcasts `STATE` / `KEYFRAME`
- **Rejection is currently broken** — `validateMovement` compares camelCase `worldBounds` keys against the snake_case config and moves at a hardcoded speed below the velocity limit, so no input produces `REJECT`. See `docs/protocol.md` known gaps.
- **Protocol v1** — WebSocket + JSON; T03 will replace with binary framing + delta compression

### Development Workflow
1. **Make changes** in `apps/server/src/` or `apps/client/src/`
2. **`pnpm verify`** before committing — catches lint, types, config, tests
3. **Test locally** with `pnpm dev` (two tabs for multiplayer)
4. **Staging deploy** only when you need to show someone externally

### Upcoming Technical Decisions
- **C03 Environment Rendering:** terrain mesh, sky/day-night, rain, storm visuals (DESIGN.md Part 6.1)
- **T03 Multiplayer world:** persistence, offline tiers, binary protocol, delta encoding
- **T02 Root Sight:** underground cutaway shader, soil transparency, camera mode

---

## 📖 10. Essential Documentation Links

| Document | Purpose |
|----------|---------|
| `DESIGN.md` | Master Build Plan v5.3.1 — **source of truth for all tasks/rules** |
| `CONTEXT.md` | Current stack, tree, interfaces, locked decisions |
| `docs/protocol.md` | Wire protocol spec (T03P) |
| `docs/tunables.md` | Config file → owner task → current values |
| `docs/what-works-now.md` | Honest status (updated at every gate) |
| `docs/tasks/*.md` | Task records with acceptance evidence |
| `docs/checklists/*.md` | Manual test checklists |
| `config/_meta/validator-rules.md` | Authoritative config validator rules |

---

**Keep this file updated** as tasks complete and new workflows emerge.  
Next update after **C03 Environment Rendering**.