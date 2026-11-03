# Deploy

## Staging
1. Build client: `pnpm --filter @plant-legacy/client build` → upload `apps/client/dist/` to GitHub Pages
2. Run server: `docker compose -f ops/compose.yml up -d --build`
3. Expose with Cloudflare tunnel and set `STAGING_SERVER_ORIGIN`

## Fixed URL for CLI-created tunnel
1. `cloudflared tunnel list` (find your tunnel)
2. `cloudflared tunnel route dns <TUNNEL> <NAME>` (if name taken, use a different name) → gives `https://<NAME>.trycloudflare.com`
3. `cloudflared tunnel run <TUNNEL>`
4. Set `STAGING_SERVER_ORIGIN=https://<NAME>.trycloudflare.com` in GitHub repo variables

Server and client are deployed separately (client static, server owns state).
