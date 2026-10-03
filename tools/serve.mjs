#!/usr/bin/env node
// Tiny static file server for the film folder.
//
//   node tools/serve.mjs [--port 8123]      -> live dev server, open http://localhost:8123/
//
// Also imported by render.mjs / still.mjs, which add POST sinks so the page can stream
// binary data (raw frames, WAV) straight into Node without base64 over CDP.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.glsl': 'text/plain; charset=utf-8',
};

/**
 * Start a static server rooted at the film folder.
 * @param {object} opts
 * @param {number} [opts.port=0]         0 = pick a free port
 * @param {Record<string,(req:http.IncomingMessage, body:Buffer, url:URL)=>Promise<any>|any>} [opts.sinks]
 *        POST handlers keyed by pathname (e.g. '/__frame'). The handler's resolved value is
 *        JSON-encoded as the response. Responding late applies back-pressure to the page.
 * @returns {Promise<{server: http.Server, port: number, url: string, close: () => Promise<void>}>}
 */
export function startServer({ port = 0, sinks = {}, quiet = true } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'POST' && sinks[url.pathname]) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        const out = await sinks[url.pathname](req, body, url);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(out ?? { ok: true }));
        return;
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(FILM_ROOT, rel));
      if (file !== FILM_ROOT && !file.startsWith(FILM_ROOT + path.sep)) { res.writeHead(403).end(); return; }
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found: ' + rel);
        if (!quiet) console.log('404', rel);
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      console.error('[serve]', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err && err.stack || err));
    }
  });
  server.keepAliveTimeout = 60000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({
        server,
        port: p,
        url: `http://127.0.0.1:${p}/`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : 8123;
  const { url } = await startServer({ port, quiet: false });
  console.log(`film dev server: ${url}`);
  console.log(`  live player     ${url}`);
  console.log(`  start at 95 s   ${url}?t=95`);
  console.log(`  loop one shot   ${url}?shot=<id>&hud=1`);
}
