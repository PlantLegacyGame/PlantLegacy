# Deploy and environments

**Status:** O01 shipped the pipeline. Staging is a GitHub Pages client plus the
local Docker compose stack exposed through a **Cloudflare quick tunnel** — no VM
and no credit card. A persistent host is deferred.

This is the single operations document: environments, the command-by-command
first deploy, daily start/stop, troubleshooting, secrets and the security
checklist.

## Environments

| Environment | Client | Server | Postgres | `NODE_ENV` |
|---|---|---|---|---|
| Local | Vite dev server `http://localhost:4173` | `http://127.0.0.1:8080` | optional, compose on `127.0.0.1:5432` | `local` |
| Staging | GitHub Pages URL | Docker compose on a Docker host, exposed by a Cloudflare quick tunnel | same compose stack, named volume | `staging` |
| Production | same static build, separate origin | VM or larger host | managed or same host | `production` |

Environment is selected **only** by `NODE_ENV`; it is never inferred from a
hostname. The same image and the same static build move between environments.

Staging is **not independent** right now: it needs the Docker host, the compose
stack and the `cloudflared` process to stay running. If the PC sleeps or the
tunnel restarts, staging goes down or the URL changes.

**What you need:** a GitHub account, Node 24 and pnpm 10, Docker Desktop (WSL 2
backend on Windows), `cloudflared`, and the repository
`PlantLegacyGame/PlantLegacy`. Replace `<...>` placeholders with your own values.

## 1. First push (skip if the repo exists)

Create an **empty** repository on GitHub first: <https://github.com/new>. Do
**not** add a README, .gitignore or license.

```powershell
cd C:\Users\khmer\PlantLegacy

git config --global user.name "Your Name"
git config --global user.email "you@example.com"

git add .
git commit -m "T00 + O01: foundation, config, CI, deploy skeleton"
git branch -M main

git remote add origin https://github.com/PlantLegacyGame/PlantLegacy.git
git push -u origin main
```

When Git asks for a password, use Git Credential Manager or a fine-grained
personal access token scoped to this repository (Contents = Read and write).
`ci` must be green on the Actions tab before continuing.

## 2. Enable Pages and the staging variable

1. **Settings → Pages → Build and deployment → Source = GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables → New repository
   variable**: `STAGING_SERVER_ORIGIN` = the tunnel origin from step 4
   (`https://random-words.trycloudflare.com`). No trailing slash, no path. It
   must be the **server** origin, never the Pages URL.
3. Run **Actions → deploy-staging → Re-run all jobs** (or push again).

The client URL is `https://plantlegacygame.github.io/PlantLegacy/`. The build
injects `STAGING_SERVER_ORIGIN` into `<meta name="server-origin">`; if the
variable is empty the page loads but `/config/*` and `/ws` are called on the
Pages host and fail.

## 3. Start the server and Postgres

Create `ops/.env` once (gitignored; never commit it):

```powershell
cd C:\Users\khmer\PlantLegacy

@'
NODE_ENV=staging
CORS_ORIGINS=https://plantlegacygame.github.io,https://<current-tunnel>.trycloudflare.com,http://localhost:4173,http://127.0.0.1:4173,http://localhost:4174
'@ | Set-Content ops/.env
```

`POSTGRES_PASSWORD` is intentionally unset on the current machine: the existing
`ops_pgdata` volume was initialised with the compose default, and changing it now
breaks authentication. Use `down -v` only if you accept losing the volume.

```powershell
docker compose -f ops/compose.yml up -d --build
docker compose -f ops/compose.yml ps
curl.exe http://127.0.0.1:8080/health
curl.exe http://127.0.0.1:8080/ready
```

Expected: both 200; `/health` shows `"database":"ok"` and `"config_files":80`
(the count is owned by `docs/tunables.md`); `/ready` shows `"ready":true`. Compose auto-loads `ops/.env`; the server itself
reads `process.env` directly and has no dotenv loader (ADR-011).

## 4. Start the quick tunnel

In a second terminal:

```powershell
cloudflared tunnel --url http://localhost:8080
```

It prints the HTTPS origin for this session. The URL **changes every restart**;
closing either terminal takes staging down. The tunnel forwards only `:8080` —
Postgres stays bound to `127.0.0.1:5432` and is never exposed.

```powershell
curl.exe https://<tunnel>/health
curl.exe https://<tunnel>/ready
curl.exe https://<tunnel>/config/plant_renderer
```

## 5. Connect the two halves

1. Put the tunnel origin in `ops/.env` (`CORS_ORIGINS`), then restart the server:
   `docker compose -f ops/compose.yml up -d server`.
2. Set the `STAGING_SERVER_ORIGIN` repository variable to the same origin.
3. Re-run `deploy-staging` (or push a commit).
4. Open <https://plantlegacygame.github.io/PlantLegacy/>.

Expected in the browser: the canvas renders; the hint card appears after
`WELCOME`; DevTools → Network shows `wss://<tunnel>/ws` with status **101**;
`/config/onboarding` and `/config/plant_renderer` return **200**; no
`THREE.WebGLProgram` or CORS errors. Two tabs show two plants.

## 6. Local development and daily commands

```powershell
pnpm dev        # client :4173 (localhost, not 127.0.0.1 — Vite binds IPv6), server :8080
pnpm verify     # lint + typecheck + config:validate + tests, before pushing
```

Vite proxies `/health`, `/ready`, `/config` and `/ws`, so no CORS work is needed
locally.

| Goal | Command |
|---|---|
| Start staging stack | `docker compose -f ops/compose.yml up -d --build` |
| Stop staging stack | `docker compose -f ops/compose.yml down` (add `-v` only to lose `ops_pgdata`) |
| Start tunnel | `cloudflared tunnel --url http://localhost:8080` |
| Trigger deploy | `git commit --allow-empty -m "deploy" && git push origin main` |
| Logs | `docker compose -f ops/compose.yml logs server` (or `postgres`) |

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| CORS policy error | `CORS_ORIGINS` lacks the exact Pages origin or the current tunnel origin. Update `ops/.env`, restart the server. |
| Mixed content | Pages is HTTPS and the API is HTTP. Use the HTTPS tunnel. |
| WebSocket closes with 4001 | The handshake `Origin` is not in `CORS_ORIGINS`. |
| `/config/plant_renderer` 404 | The image predates the route. Rebuild; locally check the Vite `/config` proxy. |
| `THREE.WebGLProgram` shader error | A shader redeclared `#version`, precision, or a built-in (ADR-016). |
| Pages 404 | Pages source must be **GitHub Actions**; check the `deploy-staging` run. |
| Page loads, nothing connects | `STAGING_SERVER_ORIGIN` empty or stale. Fix and re-run the deploy. |
| `permission denied ... docker.sock` | `sudo usermod -aG docker $USER`, then log out and back in. |
| `port is already allocated` | `Get-NetTCPConnection -State Listen -LocalPort 8080,5432`. |
| `password authentication failed` | The volume was created with another password. Restore it, or `down -v` (data loss). |
| `/ready` is 503 | Postgres unreachable. `docker compose ... logs postgres` and `... logs server`. |

## 8. Secrets and health

- Secrets are **only** environment variables. There is no secrets file in the
  repository; `.env` is gitignored and `ops/.env` is local-only.
- GitHub Actions **secrets** hold deploy credentials; repository **variables**
  hold non-secret values such as `STAGING_SERVER_ORIGIN`.
- Never paste a secret into a task record, a config file, a log line or an AI
  session. If one leaks, rotate it before continuing.
- `DATABASE_URL` is the only secret the server needs today.

| Probe | Meaning | Failure action |
|---|---|---|
| `GET /health` | process alive; DB may be `degraded` | restart the container if it stops returning 200 |
| `GET /ready` | can serve players (DB required and reachable) | keep it out of the load balancer until 200 |

The Dockerfile declares a `/health` `HEALTHCHECK`. Compose restarts are manual
until O02 adds a supervisor and backup/restore drill.

**Security checklist**

- [ ] `ops/.env` is not committed (`git status` must not list it).
- [ ] `CORS_ORIGINS` contains only the Pages origin, the current tunnel origin
      and local dev origins.
- [ ] Postgres is bound to `127.0.0.1`, never tunnelled.
- [ ] The GitHub token is scoped to this repository.
- [ ] `curl https://<tunnel>/health` works and no plain `http://` origin is
      exposed publicly.
- [ ] `ops/.env` and `STAGING_SERVER_ORIGIN` are updated together when the
      tunnel URL changes.

## 9. Persistent host (deferred)

A VM or a named tunnel removes the dependency on the local PC and the rotating
URL. **Not required** for the current staging setup.

- **Named Cloudflare tunnel (free, fixed URL):** Zero Trust → Networks → Tunnels
  → create → `cloudflared service install <token>`. Set
  `STAGING_SERVER_ORIGIN` once.
- Providers: Oracle Cloud Always Free (needs card verification, best specs,
  ARM), Fly.io (card), Railway (trial), Koyeb (no card, 512 MB), Render (no
  card, sleeps after 15 min idle). A sleeping host misses ticks, so prefer one
  that does not sleep.

On the host, use the same compose file and put a TLS proxy (Caddy, nginx) or a
named tunnel in front of `:8080`; never expose `:8080` or `:5432` directly.

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker

git clone https://github.com/PlantLegacyGame/PlantLegacy.git
cd PlantLegacy

export NODE_ENV=staging
export POSTGRES_PASSWORD=<strong-hex-password>
export CORS_ORIGINS=https://plantlegacygame.github.io
docker compose -f ops/compose.yml up -d --build

curl http://localhost:8080/health
curl http://localhost:8080/ready
```

GitHub Pages is HTTPS, so the API origin must be HTTPS too or the browser blocks
it as mixed content.

## 10. What O02 adds

Migrations on deploy, automated backups, a restore drill and server deploy
automation. Until then, a server deploy is a deliberate
`docker compose up -d --build` on the host.
