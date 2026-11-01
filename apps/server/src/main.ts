import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import process from 'node:process';
import { loadRuntimeConfig } from './core/config.ts';
import { SERVICE_VERSION } from './core/version.ts';
import { DatabaseProbe } from './ops/db.ts';
import { buildHealthReport, isReady } from './ops/health.ts';
import { createLogger } from './ops/log.ts';

const STARTED_AT = Date.now();

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

/**
 * The client is deployed to a different origin (GitHub Pages), so the browser
 * needs an explicit allow. Only origins listed in `ops.cors_origins` (or the
 * `CORS_ORIGINS` override) receive the header; everything else is unchanged.
 */
function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[],
): void {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'origin');
  }
}

async function main(): Promise<void> {
  const { runtime, configFileCount } = await loadRuntimeConfig();
  const log = createLogger(runtime.logLevel);
  const database = new DatabaseProbe(runtime.databaseUrl, {
    max: runtime.dbPoolMax,
    connectTimeoutMs: runtime.dbConnectTimeoutMs,
    idleTimeoutMs: runtime.dbIdleTimeoutMs,
  });

  log.info('config loaded', {
    configDir: runtime.configDir,
    configFiles: configFileCount,
  });

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    applyCors(request, response, runtime.corsOrigins);
    const method = request.method ?? 'GET';

    if (method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      });
      response.end();
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname === runtime.healthPath || url.pathname === runtime.readinessPath) {
      const report = buildHealthReport({
        version: SERVICE_VERSION,
        uptimeSeconds: (Date.now() - STARTED_AT) / 1000,
        database: await database.ping(),
        configFiles: configFileCount,
      });

      if (url.pathname === runtime.healthPath) {
        sendJson(response, 200, report);
        return;
      }

      const ready = isReady(report, runtime.readinessRequiresDb);
      sendJson(response, ready ? 200 : 503, { ready, ...report });
      return;
    }

    if (url.pathname === '/') {
      sendJson(response, 200, {
        name: 'plant-legacy-server',
        version: SERVICE_VERSION,
        world: null,
        note: 'Phase 0 foundation. No world simulation yet (see DESIGN.md Part 4, B2).',
      });
      return;
    }

    sendJson(response, 404, { error: 'not_found' });
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      log.error('request failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!response.headersSent) sendJson(response, 500, { error: 'internal_error' });
      else response.end();
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });

    const forceExit = setTimeout(() => {
      log.error('shutdown timed out', { graceMs: runtime.shutdownGraceMs });
      process.exit(1);
    }, runtime.shutdownGraceMs);
    forceExit.unref();

    server.close(() => {
      database
        .close()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  server.listen(runtime.port, runtime.host, () => {
    log.info('listening', {
      host: runtime.host,
      port: runtime.port,
      env: runtime.nodeEnv,
      database: database.configured ? 'configured' : 'skipped',
      version: SERVICE_VERSION,
    });
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
