import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(join(here, '..', 'dist'));
const port = Number.parseInt(process.env.CLIENT_PORT ?? process.env.PORT ?? '4173', 10);
const proxyOrigin = process.env.PROXY_ORIGIN ?? 'http://127.0.0.1:8080';

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
]);

function proxy(request, response, pathname) {
  const target = new URL(pathname, proxyOrigin);
  const upstream = httpRequest(
    target,
    { method: request.method, headers: request.headers },
    (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(response);
    },
  );
  upstream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    }
    response.end(JSON.stringify({ error: 'server_unreachable', origin: proxyOrigin }));
  });
  request.pipe(upstream);
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');

  // The static shell calls same-origin `/health`; forward it to the game server
  // in local dev. In staging the client is built with an absolute origin.
  if (url.pathname === '/health' || url.pathname === '/ready') {
    proxy(request, response, url.pathname);
    return;
  }

  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(root, normalize(requested).replace(/^(\.\.[/\\])+/, ''));

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'content-type': TYPES.get(extname(filePath)) ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`client preview: http://127.0.0.1:${port} (serving ${root})`);
});
