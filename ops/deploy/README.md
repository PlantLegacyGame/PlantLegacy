# ops/deploy

Placeholder for the staging/production deploy scripts.

Until O02, staging is:

1. `pnpm --filter @plant-legacy/client build` → publish `apps/client/dist` to a
   free static host (GitHub Pages workflow already does this).
2. `docker compose -f ops/compose.yml up -d --build` on the free VM.

Server and client are deployed separately on purpose: the client is static, the
server owns all state (RULE_4).
