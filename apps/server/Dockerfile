# Plant Legacy server image (O01).
#
# Runs TypeScript directly: Node 24 strips types natively, and the shared package
# is consumed as source. There is no bundler and no build step, which keeps the
# image small and the toolchain boring. Revisit only if profiling demands it.
FROM node:24-alpine

WORKDIR /app

# Install dependencies first so code changes do not bust the layer cache.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY tools/config-validator/package.json tools/config-validator/
RUN npm install -g pnpm@10.18.0 && pnpm install --filter @plant-legacy/server... --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/server apps/server
COPY config config

ENV NODE_ENV=production
ENV CONFIG_DIR=/app/config
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/src/main.ts"]
