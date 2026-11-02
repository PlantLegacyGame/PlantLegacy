# Plant Legacy — Complete Developer Reference

**Last Updated:** 2026-11-01  
**Current Phase:** Gate 1 Run-up (Week 2-24)  
**Completed Tasks:** T00, O01, T03P, C01, T00A  
**Next Task:** T01 — Procedural Plant Renderer (Root Sight Shader)

---

## 📋 Project Status at a Glance

| Task | Status | Description |
|------|--------|-------------|
| T00 | ✅ Complete | Foundation: monorepo, 74 config files, config validator, rarity ban (RULE_20), account-bound invariant (RULE_23) |
| O01 | ✅ Complete | Repo + deploy pipeline: pnpm, Biome, CI, Docker, GitHub Pages, `/health` + `/ready` |
| T03P | ✅ Complete | Networking Gate 0: WebSocket + JSON protocol, server-authoritative cubes, 20Hz tick |
| C01 | ✅ Complete | Vite + Three.js client: OrbitControls, 3D cubes, smooth interpolation, dev proxy |
| T00A | ✅ Complete | Onboarding: 3-line hint card (RULE_13), resource readout with tooltips |

### What Works Now (Live)
- **Local dev:** `pnpm dev` → server (8080) + Vite client (4173) with hot reload
- **Staging:** GitHub Pages at `https://plantlegacygame.github.io/PlantLegacy/` (shows "Server ok" when tunnel active)
- **Protocol:** WebSocket v1 documented in `docs/protocol.md`
- **Config:** 74 files in `config/` (extended-1 format), validated at startup + CI

---

## 🔧 1. Local Development (Daily Workflow)

### Primary Command
```bash
pnpm dev
```
**What it does:**
1. Checks for `node_modules` → runs `pnpm install` if missing
2. Starts **server** in watch mode (`node --watch src/main.ts`) on `http://127.0.0.1:8080`
3. Starts **Vite dev server** on `http://127.0.0.1:4173` with:
   - Hot module replacement (HMR)
   - Proxy for `/health`, `/ready`, `/ws` → server
   - Serves `apps/client/src/index.html` as entry

**Open:** `http://127.0.0.1:4173` in **two tabs** to test multiplayer sync  
**Stop:** `Ctrl+C` in the terminal running `pnpm dev`

### Verification Commands
```bash
pnpm verify        # Full CI chain: lint + typecheck + config:validate + test
pnpm lint          # Biome check (formatter + linter)
pnpm lint:fix      # Auto-fix lint issues (safe fixes only)
pnpm typecheck     # TypeScript strict check across all packages
pnpm config:validate  # Validates all 74 config files (schema + rarity ban + account-bound)
pnpm test          # node --test in packages/shared + apps/server
pnpm build         # Production build: Vite → apps/client/dist
pnpm start         # Server only (no watch), for production
```

### Key URLs (Local)
| Service | URL | Purpose |
|---------|-----|---------|
| Client | `http://127.0.0.1:4173` | Three.js game client |
| Server HTTP | `http://127.0.0.1:8080` | `/health`, `/ready`, `/config/onboarding` |
| Server WS | `ws://127.0.0.1:8080` | WebSocket for game protocol |

---

## 🌐 2. Staging Deploy (Public Demo) — Manual Process

### Prerequisites (One-Time Setup)
- [x] GitHub repo: `PlantLegacyGame/PlantLegacy`
- [x] Pages enabled: Settings → Pages → **Build and deployment** → Source = **GitHub Actions**
- [x] Docker Desktop installed and running

### Required GitHub Repository Variable
| Name | Value | Where |
|------|-------|-------|
| `STAGING_SERVER_ORIGIN` | `https://<your-tunnel>.trycloudflare.com` | Settings → Secrets and variables → Actions → Variables |

> **Important:** This MUST be the **server's public URL** (Cloudflare tunnel), NOT the GitHub Pages URL. The deploy workflow injects this into the client's `<meta name="server-origin">` so the browser knows where to connect.

### Step-by-Step Deploy Process

#### Window 1 — Start Staging Stack (Server + Postgres)
```powershell
cd C:\Users\khmer\PlantLegacy

# Set environment variables (run in THIS window only)
$env:NODE_ENV = "staging"
$env:POSTGRES_PASSWORD = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
$env:CORS_ORIGINS = "https://plantlegacygame.github.io"

# Clean start (removes old Postgres volume)
docker compose -f ops/compose.yml down -v
docker compose -f ops/compose.yml up -d --build

# Wait 15-20 seconds for Postgres healthcheck, then verify:
curl http://localhost:8080/health
curl http://localhost:8080/ready
```
**Expected:** Both return 200. `/ready` must show `"ready":true` and `"database":"ok"`

#### Window 2 — Start Cloudflare Tunnel
```powershell
cloudflared tunnel --url http://localhost:8080
```
**Copy the HTTPS URL** (e.g., `https://abc123.trycloudflare.com`) — **this changes every restart**

#### GitHub — Update Variable
1. Go to: `https://github.com/PlantLegacyGame/PlantLegacy/settings/variables/actions`
2. Edit `STAGING_SERVER_ORIGIN` → paste the **new** tunnel URL
3. Save

#### Trigger Deploy
```powershell
cd C:\Users\khmer\PlantLegacy
git commit --allow-empty -m "trigger staging deploy"
git push origin main
```

#### Verify
1. **GitHub Actions** → `deploy-staging` workflow → wait for **green**
2. **Pages URL:** `https://plantlegacygame.github.io/PlantLegacy/` → should show **"Server ok"** with version, uptime, database status

### Keep Running for Demo
- **Window 1** (docker compose) — must stay open
- **Window 2** (cloudflared) — must stay open
- **On restart:** Repeat ALL steps (tunnel URL changes every time)

---

## 🛑 3. Stop Everything

```powershell
# Stop staging stack (frees ports 8080, 5432)
docker compose -f ops/compose.yml down -v

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

Then set `STAGING_SERVER_ORIGIN` = `http://<vps-ip>:8080` (or domain with Caddy/Cloudflare for HTTPS)

---

## 📚 5. Project Architecture Reference

### Repository Structure
```
PlantLegacy/
├── .github/workflows/
│   ├── ci.yml              # Lint, typecheck, config:validate, test, build
│   └── deploy-staging.yml  # Build client → GitHub Pages on main push
├── apps/
│   ├── client/             # Vite + Three.js client (C01)
│   │   ├── src/
│   │   │   ├── main.ts     # Game client entry (WebSocket, Three.js, input)
│   │   │   └── index.html  # Vite entry (in src/ for Vite)
│   │   ├── vite.config.ts  # Vite config with dev proxy
│   │   ├── package.json    # deps: three, vite, @vitejs/plugin-legacy
│   │   └── public/         # Static assets (empty for now)
│   └── server/             # Node HTTP + WebSocket server
│       ├── src/
│       │   ├── main.ts     # HTTP + WebSocket server, CubeWorld
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
├── config/                 # 74 tunable files (extended-1 format)
│   ├── _meta/schema.json   # JSON Schema for editors
│   ├── _meta/validator-rules.md  # Authoritative validator rules
│   ├── ops.json            # Server config (ports, CORS, DB, etc.)
│   ├── onboarding.json     # T00A: hint card + resource tooltips
│   ├── net_proto.json      # T03P: protocol tunables
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
| File | Owner | Status | Purpose |
|------|-------|--------|---------|
| `ops.json` | O01 | active | Server: port, CORS, DB pool, health paths, log level |
| `onboarding.json` | T00A | draft | Hint card (3 lines), resource tooltips, duration |
| `net_proto.json` | T03P | draft | Protocol: tick rate, quantization, velocity limits, world bounds |
| `compliance.json` | T00 | draft | 5-line illegal-content-only policy (RULE_6) |
| `*.json` (70 files) | various | stub | Empty `values: {}` — filled by owning task |

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

| Order | Task | Description | Depends On |
|-------|------|-------------|------------|
| 1 | **T01** | Procedural plant renderer (Root Sight shader) | C01 |
| 2 | **C02** | HUD/menus/input rebinding + text scale 80-150% | C01 |
| 3 | **T03** | Full binary protocol (delta compression, client prediction) | T03P |
| 4 | **T08C** | Accounts: username/password + session (email recovery later) | T00, O01 |
| 5 | **T02** | Growth simulation: nodes, biomass, pruning, resources | T01 |
| 6 | **T07** | Day/night cycle + weather system | C01 |
| 7 | **C03** | Weather visuals (particles, sky, lighting) | T07, C01 |
| 8 | **T05** | Chat (proximity + world) + report/block UI | C02, T08C |
| 9 | **T04** | Mutations: schema + 3 implemented | T01, T02 |
| 10 | **T06** | Damage pipeline (weather, roots, herbivores) | T02, T07 |
| 11 | **T08A** | Inventory + Spore stipend (session end) | T08C |
| 12 | **C04** | Mail UI + guild roster | T08A, T05 |

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
| Stop staging stack | `docker compose -f ops/compose.yml down -v` |
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
- **74 config files** — count increases as tasks add their configs
- **Rarity ban is absolute** — any `rarity` key or enum member fails validation

### Client-Server Boundary
- **Client is NEVER authoritative** — it renders interpolated state, sends inputs
- **Server validates every input** — velocity limits, world bounds, quantization
- **Protocol v1** — WebSocket + JSON; T03 will replace with binary framing + delta compression

### Development Workflow
1. **Make changes** in `apps/server/src/` or `apps/client/src/`
2. **`pnpm verify`** before committing — catches lint, types, config, tests
3. **Test locally** with `pnpm dev` (two tabs for multiplayer)
4. **Staging deploy** only when you need to show someone externally

### Upcoming Technical Decisions
- **T01:** Root Sight shader — will need GPU buffer management, compute shaders
- **T03:** Binary protocol — frame header `[version:u8][type:u8][payload]`, quantization, delta encoding
- **T08C:** Accounts — bcrypt password hashing, JWT sessions, `accounts` config
- **T02:** Growth — node-based procedural generation, biomass economy, pruning mechanics

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
Next update after **T01** (Procedural Plant Renderer) is complete.