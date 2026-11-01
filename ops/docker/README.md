# ops/docker

The server image lives at `apps/server/Dockerfile` so the build context stays at
the repo root (the server needs `packages/shared` and `config/`).

`ops/compose.yml` builds it and pairs it with Postgres.

Nothing else belongs here until O02 (migrations, backups, restore drill).
