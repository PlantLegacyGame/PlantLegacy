# Hosting and environments

**Status:** skeleton shipped by O01. Deploy automation for the server arrives
with O02. This file records the intended shape so nothing is improvised later.

**First time?** Follow [`docs/deploy-walkthrough.md`](./deploy-walkthrough.md)
for copy-paste commands from commit to live staging URL.

## Environments

| Environment | Client | Server | Postgres | `NODE_ENV` |
|---|---|---|---|---|
| Local | `http://127.0.0.1:4173` (preview) | `http://127.0.0.1:8080` | optional, compose on `:5432` | `local` |
| Staging | GitHub Pages URL | one free VM, Docker | same VM, Docker volume | `staging` |
| Production | same static build, separate origin | same VM or a larger one | managed or same VM | `production` |

Environment is selected **only** by `NODE_ENV`; it is never inferred from a
hostname. The same image and the same static build move between environments.

## Staging URLs

- Client: `https://<owner>.github.io/<repo>/` — shown in the repository's
  `github-pages` environment after the first deploy.
- Server: set the repository variable `STAGING_SERVER_ORIGIN` to the VM origin
  (for example `https://api-staging.example.dev`). The deploy workflow injects
  it into `apps/client/dist/index.html` as `meta[name=server-origin]`.
- Health: `$STAGING_SERVER_ORIGIN/health` must return 200 with
  `"status":"ok"` (or `"degraded"` only while the DB is intentionally down).
- Readiness: `$STAGING_SERVER_ORIGIN/ready` must return 200 before the deploy is
  considered good.
- CORS: set the server's `CORS_ORIGINS` to the exact Pages origin (for example
  `https://owner.github.io`). The client and API are different origins; without
  this the browser blocks `/health`.

## Client (free static host)

`.github/workflows/deploy-staging.yml` builds `apps/client/dist` and publishes it
to GitHub Pages on every push to `main`.

1. Repository → Settings → Pages → Source = **GitHub Actions**.
2. Add repository variable `STAGING_SERVER_ORIGIN`.
3. Push to `main`; the workflow prints the Pages URL in the `github-pages`
   environment.

The client is static. It never talks to Postgres and never holds state.

## Server + Postgres (one free VM)

```sh
git clone <repo> && cd PlantLegacy
docker compose -f ops/compose.yml up -d --build
docker compose -f ops/compose.yml ps
curl -fsS http://127.0.0.1:8080/health
```

Compose sets the server's environment directly (including `DATABASE_URL`); no
`.env` file is read. For non-Compose runs, export variables in the shell — the
server deliberately has no dotenv loader (ADR-011).

Compose starts `postgres:17-alpine` with a named volume and the server image
built from `apps/server/Dockerfile`. The server waits for the Postgres health
check, then listens on `:8080`.

Put a TLS reverse proxy (Caddy or nginx) in front of `:8080` for a public
origin. The proxy terminates TLS; the container stays plain HTTP on a private
network.

### Free VM options

Any provider that offers a persistent VM with Docker and a small disk works.
The plan only requires "one free VM". Prefer a provider whose free tier does not
sleep, because a sleeping world server misses ticks. Record the chosen provider
and region here when the first staging VM exists.

## Secrets

- Secrets are **only** environment variables. There is no secrets file in the
  repository, and `.env` is git-ignored.
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
automation. Until then, server deploys are a deliberate manual `git pull` +
`docker compose up -d --build` on the VM.
