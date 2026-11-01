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
  - Expected: 73 files, OK.
- [x] `pnpm test`
  - Expected: 12 shared tests + 8 server tests pass, 0 fail.
- [x] `pnpm build`
  - Expected: `apps/client/dist/{index.html,main.js,styles.css}`.
- [x] `pnpm verify`
  - Expected: the whole chain exits 0.

## 2. Server liveness

- [x] `node apps/server/src/main.ts` (no `DATABASE_URL`)
  - Expected log: `listening`, `database: skipped`.
- [x] `curl http://127.0.0.1:8080/health`
  - Expected: 200, `"status":"ok"`, `"config_files":73`,
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
  - Expected: installs, builds the client, starts server `:8080` and preview
    `:4173`.
  - Observed: both processes start; preview proxies `/health`.
- [x] Open `http://127.0.0.1:4173`.
  - Expected: “Server ok” and version/uptime/database/config lines.
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

## 6. CI and staging (needs a remote)

- [x] Push a commit; `.github/workflows/ci.yml` runs and is green.
  - Observed: run `62a8ed2` on `PlantLegacyGame/PlantLegacy` — success.
- [x] Repository → Settings → Pages → Source = GitHub Actions.
  - Observed: Pages site exists; `deploy-staging` on `25f7b05` is green
    (`configure-pages`, `upload-pages-artifact`, `deploy-pages` all pass).
- [ ] Add repository variable `STAGING_SERVER_ORIGIN`.
  - Blocked on the VM origin.
- [x] Push to `main`; `deploy-staging` publishes the Pages URL.
  - Observed: <https://plantlegacygame.github.io/PlantLegacy/> → 200, shell HTML.
- [ ] Open the Pages URL; the shell reports the staging server as `ok`.
  - Page loads; server card still says not configured (variable unset).
- [ ] Deploy the server on one free VM:
      `git clone … && docker compose -f ops/compose.yml up -d --build`.
- [ ] `curl <server-origin>/health` → 200 `"status":"ok"`.

## 7. Secrets

- [x] `git status` / `.gitignore`: `.env` is ignored.
- [x] No secret appears in `config/`, docs, workflows or source.
- [x] `DATABASE_URL` is read only from `process.env`.
