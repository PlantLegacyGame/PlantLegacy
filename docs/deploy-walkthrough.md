# Deploy walkthrough

Command-by-command path from this folder to a working staging URL. The current
staging shape is **GitHub Pages client + local Docker compose API + Cloudflare
quick tunnel** — no VM and no credit card.

Replace `<...>` placeholders with your own values.

**What you need**

- A GitHub account and this folder (`C:\Users\khmer\PlantLegacy`).
- Node 24 and pnpm 10 for local builds.
- Docker Desktop (with the WSL 2 backend on Windows).
- `cloudflared` for the HTTPS tunnel.
- The GitHub repository `PlantLegacyGame/PlantLegacy`.

---

## 1. First push (skip if the repo already exists)

Create an **empty** repository on GitHub first: <https://github.com/new>.
Name it `PlantLegacy`. Do **not** add a README, .gitignore or license.

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

Check <https://github.com/PlantLegacyGame/PlantLegacy/actions>: `ci` must be
green before continuing.

---

## 2. Enable GitHub Pages and the staging variable

In the GitHub repository:

1. **Settings → Pages → Build and deployment → Source = GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables → New repository
   variable**
   - Name: `STAGING_SERVER_ORIGIN`
   - Value: the HTTPS origin printed by the tunnel in step 4 (for example
     `https://random-words.trycloudflare.com`)
   - No trailing slash, no path.
3. After the variable exists, run **Actions → deploy-staging → Re-run all jobs**
   (or push another commit).

The client URL is:

```text
https://plantlegacygame.github.io/PlantLegacy/
```

The build injects `STAGING_SERVER_ORIGIN` into
`<meta name="server-origin">`. If the variable is empty, the page loads but the
client calls `/config/*` and `/ws` on the Pages host and fails.

---

## 3. Start the server + Postgres locally

Create `ops/.env` once (it is gitignored; never commit it):

```powershell
cd C:\Users\khmer\PlantLegacy

@'
NODE_ENV=staging
CORS_ORIGINS=https://plantlegacygame.github.io,https://<current-tunnel>.trycloudflare.com,http://localhost:4173,http://127.0.0.1:4173,http://localhost:4174
'@ | Set-Content ops/.env
```

`POSTGRES_PASSWORD` is intentionally unset on the current machine: the existing
`ops_pgdata` volume was initialised with the compose default. Changing the
password now breaks authentication. Use `down -v` only if you accept losing the
volume.

Start the stack:

```powershell
docker compose -f ops/compose.yml up -d --build
docker compose -f ops/compose.yml ps
curl.exe http://127.0.0.1:8080/health
curl.exe http://127.0.0.1:8080/ready
```

Expected: both return 200; `/health` shows `"database":"ok"` and
`"config_files":75`; `/ready` shows `"ready":true`.

Compose auto-loads `ops/.env`. The server itself reads `process.env` directly
and has no dotenv loader.

---

## 4. Start the Cloudflare quick tunnel

In a second terminal:

```powershell
cloudflared tunnel --url http://localhost:8080
```

It prints a URL like `https://random-words.trycloudflare.com`. That is the
server origin for this session.

- The URL **changes every time the tunnel restarts**.
- Keep both terminals open; closing either takes staging down.
- The tunnel forwards only `:8080`. Postgres stays bound to `127.0.0.1:5432`.

Verify from outside:

```powershell
curl.exe https://<tunnel>/health
curl.exe https://<tunnel>/ready
curl.exe https://<tunnel>/config/plant_renderer
```

Expected: 200 for all three. `/config/onboarding` should also return 200.

---

## 5. Connect the two halves

1. Put the tunnel origin in `ops/.env` (`CORS_ORIGINS`), then restart the server:

```powershell
docker compose -f ops/compose.yml up -d server
```

2. GitHub → Settings → Secrets and variables → Actions → Variables: set
   `STAGING_SERVER_ORIGIN` to the same tunnel origin.
3. GitHub → Actions → `deploy-staging` → **Re-run all jobs** (or push a commit).
4. Open <https://plantlegacygame.github.io/PlantLegacy/>.

Expected in the browser:

- the Three.js canvas renders;
- the hint card appears after `WELCOME`;
- DevTools → Network shows `wss://<tunnel>/ws` with status **101**;
- `/config/onboarding` and `/config/plant_renderer` return **200**;
- the console has no `THREE.WebGLProgram` or CORS errors.

Open the page in **two tabs** to see two cubes.

---

## 6. Local development (no tunnel)

```powershell
pnpm dev
```

- client: <http://localhost:4173> (use `localhost`, not `127.0.0.1`; Vite binds
  the IPv6 loopback on Windows)
- server: <http://127.0.0.1:8080>

Vite proxies `/health`, `/ready`, `/config` and `/ws` to the server, so the
client works without CORS changes.

Run the full check chain before pushing:

```powershell
pnpm verify
```

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Browser console: CORS policy error | `CORS_ORIGINS` does not include the exact Pages origin or the current tunnel origin. Update `ops/.env`, restart the server. |
| Browser console: mixed content | Pages is HTTPS and the API is HTTP. Use the HTTPS tunnel (step 4). |
| WebSocket closes with code 4001 | The handshake `Origin` is not in `CORS_ORIGINS`. Add the Pages origin and the tunnel origin. |
| `/config/plant_renderer` 404 | The Docker image is older than the route. Rebuild: `docker compose -f ops/compose.yml up -d --build`. Locally, check the Vite `/config` proxy. |
| `THREE.WebGLProgram` shader error | A shader redeclared `#version`, precision, or a built-in matrix/attribute. See ADR-016. |
| Pages 404 | Settings → Pages → Source must be **GitHub Actions**; check the `deploy-staging` run. |
| Page loads but nothing connects | `STAGING_SERVER_ORIGIN` is empty or points at an old tunnel. Fix the variable and re-run the deploy. |
| `permission denied ... docker.sock` | `sudo usermod -aG docker $USER`, then log out and back in. |
| `port is already allocated` | Something else uses 8080/5432: `Get-NetTCPConnection -State Listen -LocalPort 8080,5432`. |
| `password authentication failed` | The `ops_pgdata` volume was created with a different password. Restore it or `down -v` (data loss). |
| `/ready` is 503 | Postgres is not reachable yet. `docker compose -f ops/compose.yml logs postgres` and `... logs server`. |

---

## 8. Security checklist

- [ ] `ops/.env` is not committed (`git status` must not list it).
- [ ] `CORS_ORIGINS` contains only the Pages origin, the current tunnel origin
      and local dev origins.
- [ ] Postgres is bound to `127.0.0.1`, never tunnelled.
- [ ] The GitHub token is scoped to this repository.
- [ ] `curl https://<tunnel>/health` works and no plain `http://` origin is
      exposed publicly.
- [ ] `ops/.env` and `STAGING_SERVER_ORIGIN` are updated together when the
      tunnel URL changes.

---

## 9. Optional: persistent VM (deferred)

A VM removes the dependency on the local PC and the rotating quick-tunnel URL.
It is **not required** for the current staging setup. When a no-card host is
available:

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
```

Put Caddy, nginx or a named Cloudflare tunnel in front of `:8080` for a stable
HTTPS origin, then set `STAGING_SERVER_ORIGIN` once. See
[`docs/hosting.md`](./hosting.md).
