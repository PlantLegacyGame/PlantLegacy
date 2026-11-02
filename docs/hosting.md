# Hosting and environments

**Status:** O01 shipped the pipeline; the staging API currently runs from the
local Docker compose stack through a Cloudflare quick tunnel. A persistent VM is
deferred until a no-card host is chosen. This file records the intended shape so
nothing is improvised later.

**First time?** Follow [`docs/deploy-walkthrough.md`](./deploy-walkthrough.md)
for copy-paste commands from commit to live staging URL.

## Environments

| Environment | Client | Server | Postgres | `NODE_ENV` |
|---|---|---|---|---|
| Local | Vite dev server `http://localhost:4173` | `http://127.0.0.1:8080` | optional, compose on `127.0.0.1:5432` | `local` |
| Staging | GitHub Pages URL | Docker compose on a Docker host, exposed by a Cloudflare quick tunnel | same compose stack, named volume | `staging` |
| Production | same static build, separate origin | VM or larger host | managed or same host | `production` |

Environment is selected **only** by `NODE_ENV`; it is never inferred from a
hostname. The same image and the same static build move between environments.

The staging server is **not independent** right now: it needs the Docker host,
the compose stack and the `cloudflared` process to stay running. If the PC
sleeps or the tunnel restarts, staging goes down or the URL changes.

## Staging URLs

- Client: <https://plantlegacygame.github.io/PlantLegacy/> — published by the
  `deploy-staging` workflow to the `github-pages` environment.
- Server: the HTTPS origin printed by `cloudflared tunnel --url
  http://localhost:8080`. It looks like
  `https://<random-words>.trycloudflare.com` and **changes on every restart**.
  The current value lives in two places that must agree:
  - `ops/.env` → `CORS_ORIGINS`
  - GitHub → Settings → Secrets and variables → Actions → Variables →
    `STAGING_SERVER_ORIGIN`
- Health: `$STAGING_SERVER_ORIGIN/health` returns 200 with `"status":"ok"` (or
  `"degraded"` only while the DB is intentionally down).
- Readiness: `$STAGING_SERVER_ORIGIN/ready` returns 200 with `"database":"ok"`.
- Game API: `$STAGING_SERVER_ORIGIN/config/onboarding`,
  `$STAGING_SERVER_ORIGIN/config/plant_renderer`, and the WebSocket at
  `wss://<tunnel>/ws`.
- CORS: `CORS_ORIGINS` must contain the **exact** Pages origin
  (`https://plantlegacygame.github.io`) and the current tunnel origin. The
  client and API are different origins; without this the browser blocks
  `/config/*` and the WebSocket handshake.

## Client (free static host)

`.github/workflows/deploy-staging.yml` builds `apps/client/dist` and publishes
it to GitHub Pages on every push to `main`.

1. Repository → Settings → Pages → Source = **GitHub Actions**.
2. Add repository variable `STAGING_SERVER_ORIGIN` (the tunnel or VM origin).
3. Push to `main`; the workflow prints the Pages URL in the `github-pages`
   environment.

The client is static. It never talks to Postgres and never holds state.

## Server + Postgres (Docker host + quick tunnel)

On any machine with Docker:

```sh
docker compose -f ops/compose.yml up -d --build
docker compose -f ops/compose.yml ps
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/ready
```

Compose auto-loads `ops/.env` (gitignored) from the project directory. The
server itself still reads `process.env` directly and has no dotenv loader
(ADR-011); Compose is what turns the file into container environment variables.

A minimal `ops/.env` for staging:

```dotenv
NODE_ENV=staging
CORS_ORIGINS=https://plantlegacygame.github.io,https://<current-tunnel>.trycloudflare.com,http://localhost:4173,http://127.0.0.1:4173
```

`POSTGRES_PASSWORD` is intentionally unset on the current machine: the existing
`ops_pgdata` volume was initialised with the compose default. Changing the
password now breaks authentication; reset the volume with `down -v` (data loss)
if you need a new password.

Start the tunnel in a second terminal:

```sh
cloudflared tunnel --url http://localhost:8080
```

It prints the public HTTPS URL. Copy that URL into `ops/.env`
(`CORS_ORIGINS`), restart the server, then update the `STAGING_SERVER_ORIGIN`
repository variable and re-run `deploy-staging`.

The Postgres port is bound to `127.0.0.1` only; it is never exposed through the
tunnel. The tunnel forwards only the server's `:8080`.

## Persistent VM (deferred)

A free VM with Docker and a small disk is the intended stable target. Prefer a
provider whose free tier does **not** require a credit card and does not sleep,
because a sleeping world server misses ticks. The repository owner has ruled out
card-verified hosts for now, so this remains deferred.

On a VM, use the same compose file and put a TLS reverse proxy (Caddy or nginx)
in front of `:8080`, or run a named Cloudflare tunnel for a fixed hostname. Do
not expose `:8080` or `:5432` directly.

## Secrets

- Secrets are **only** environment variables. There is no secrets file in the
  repository, and `.env` is git-ignored.
- `ops/.env` is local-only and must never be committed.
- GitHub Actions secrets hold deploy credentials; repository **variables** hold
  non-secret values such as `STAGING_SERVER_ORIGIN`.
- Never paste a secret into a task record, a config file, a log line or an AI
  session. If a secret leaks, rotate it before continuing.
- `DATABASE_URL` is the only secret the server needs today.

## Health and restarts

| Probe | Meaning | Failure action |
|---|---|---|
| `GET /health` | process is alive; DB may be `degraded` | restart the container if it stops returning 200 |
| `GET /ready` | process can serve players (DB required and reachable) | keep it out of the load balancer until 200 |

The Dockerfile declares a `/health` `HEALTHCHECK`. Compose restarts are manual
until O02 adds a supervisor and backup/restore drill.

## What O02 adds

Migrations on deploy, automated backups, a restore drill, and server deploy
automation. Until then, server deploys are a deliberate `docker compose up -d
--build` on the Docker host.
