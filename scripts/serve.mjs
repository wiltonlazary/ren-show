// Serves the built ren-show (run scripts/build.mjs first).
//
//   node scripts/serve.mjs [--port 5173] [--host 127.0.0.1]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = existsSync(join(root, 'artifact')) ? join(root, 'artifact', 'dist') : join(root, 'dist');
const args = process.argv.slice(2);
const option = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
};

/**
 * Starts the server; resolves with it once it listens.
 * @param {{ port?: number, host?: string }} [options]
 */
export async function start(options = {}) {
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`no build in ${dist}: run node scripts/build.mjs`);
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
      const file = normalize(join(dist, path.endsWith('/') ? `${path}index.html` : path));
      if (!file.startsWith(dist + sep)) return void response.writeHead(403).end();
      const body = await readFile(file);
      response
        .writeHead(200, {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
          // Cross-origin isolation: SharedArrayBuffer is available, so ren-core's
          // worker connection answers input through its shared mailbox.
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
        })
        .end(body);
    } catch (error) {
      // A malformed escape (%E0%A4%A) is the request's fault, not a missing file.
      if (error instanceof URIError) response.writeHead(400).end('bad request');
      else response.writeHead(404).end('not found');
    }
  });
  await new Promise(resolve => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve(undefined)));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await start({ port: Number(option('port', '5173')), host: option('host', '127.0.0.1') });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  console.log(`ren-show at http://${address.address}:${address.port}/  (?runtime for the automatic-runtime bundle)`);
}
