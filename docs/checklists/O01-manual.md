# O01 manual checklist

Run from the repository root. Boxes marked `[ ]` need infrastructure that is not
available in the build workspace (Docker, a GitHub remote); they are not code
gaps.

## 1. Install and verify

- [x] `pnpm install --frozen-lockfile`
  - Expected: lockfile accepted, workspace linked.
  - Observed: 5 workspace projects, lockfile present.
- [x] `pnpm lint`
  - Expected: `Checked … No fixes applied`, exit 0.
- [x] `pnpm typecheck`
  - Expected: all 4 projects `Done`.
- [x] `pnpm config:validate`
  - Expected: 75 files, OK.
- [x] `pnpm test`
  - Expected: 12 shared tests + 8 server tests pass, 0 fail.
- [x] `pnpm build`
  - Expected: `apps/client/dist/index.html` plus hashed `assets/*.js` and
    `assets/*.css` from Vite.
- [x] `pnpm verify`
  - Expected: the whole chain exits 0.

## 2. Server liveness

- [x] `node apps/server/src/main.ts` (no `DATABASE_URL`)
  - Expected log: `listening`, `database: skipped`.
- [x] `curl http://127.0.0.1:8080/health`
  - Expected: 200, `"status":"ok"`, `"config_files":75`,
    `"database":"skipped"`.
  - Observed: exact.
- [x] `curl http://127.0.0.1:8080/ready`
  - Expected: 503 while `READINESS_REQUIRES_DB=true` and DB is skipped.
  - Observed: 503.

## 3. Configured database failure

- [x] Start with `DATABASE_URL=postgres://plant:plant@127.0.0.1:59999/plant_legacy`.
  - Expected: process stays alive; `/health` 200 `"status":"degraded"`,
    `"database":"down"`.
  - Observed: exact.
- [x] With `READINESS_REQUIRES_DB=false`, `/ready` returns 200.
  - Observed: 200.

## 4. One-command local stack

- [x] Delete `node_modules` (or use a fresh clone) and run `pnpm dev`.
  - Expected: installs if needed, starts server `:8080` and the Vite dev server
    on `localhost:4173`.
  - Observed: both processes start; Vite proxies `/health`, `/ready`, `/config`
    and `/ws`.
- [x] Open `http://localhost:4173` (not `127.0.0.1`; Vite binds the IPv6
      loopback on Windows).
  - Expected: Three.js canvas, hint card after `WELCOME`, and a WebSocket
    connection to `/ws`.
- [x] `Ctrl+C` stops both processes.

## 5. Docker compose (needs Docker)

- [x] `docker compose -f ops/compose.yml up -d --build`
  - Expected: `postgres` healthy, `server` starts after it, volume `pgdata`.
  - Observed: `postgres:17-alpine` healthy; `server` built from
    `apps/server/Dockerfile` and healthy; volume created as `ops_pgdata`.
- [x] `curl http://127.0.0.1:8080/ready`
  - Expected: 200 with `"database":"ok"`.
  - Observed: 200 `{"ready":true,…,"database":"ok"}`.
- [x] `docker compose -f ops/compose.yml down` and confirm the volume persists.
  - Observed: both containers removed, `ops_pgdata` still listed.
  - Extra: wrote a probe row, ran `down` then `up -d`, row was still there;
    probe dropped afterwards.

## 6. CI and staging (remote + tunnel)

- [x] Push a commit; `.github/workflows/ci.yml` runs and is green.
  - Observed: `ci` and `deploy-staging` both success on `7d22644`.
- [x] Repository → Settings → Pages → Source = GitHub Actions.
  - Observed: Pages site exists; `deploy-staging` is green
    (`configure-pages`, `upload-pages-artifact`, `deploy-pages` all pass).
- [x] Add repository variable `STAGING_SERVER_ORIGIN`.
  - Observed: set to the current Cloudflare quick-tunnel origin.
- [x] Push to `main`; `deploy-staging` publishes the Pages URL.
  - Observed: <https://plantlegacygame.github.io/PlantLegacy/> → 200.
- [x] Open the Pages URL; the client connects to the staging API.
  - Observed: `wss://…/ws` → 101, `/config/onboarding` and
    `/config/plant_renderer` → 200, canvas renders, no console errors.
- [x] Run the server + Postgres from compose:
      `docker compose -f ops/compose.yml up -d --build`.
  - Observed: `postgres` and `server` both healthy.
- [x] Expose `:8080` with `cloudflared tunnel --url http://localhost:8080`.
  - Observed: HTTPS tunnel origin; `/health` and `/ready` return 200.
- [x] `curl <server-origin>/health` → 200 `"status":"ok"`.
- [ ] Persistent VM: deferred until a no-card host is chosen; not an O01 gap.

## 7. Secrets

- [x] `git status` / `.gitignore`: `.env` is ignored.
- [x] No secret appears in `config/`, docs, workflows or source.
- [x] `DATABASE_URL` is read only from `process.env`.
