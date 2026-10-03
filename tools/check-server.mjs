import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer, FILM_ROOT } from './serve.mjs';

const server = await startServer();
try {
  const sibling = path.basename(FILM_ROOT) + '-other';
  for (const [urlPath, expected] of [['/index.html', 200], ['/..%2findex.html', 403], [`/..%2f${sibling}/index.html`, 403]]) {
    const result = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port: server.port, path: urlPath }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
    assert.equal(result.status, expected, urlPath);
    if (expected === 200) assert(result.body.includes('<canvas id="film">'));
  }
  console.log('PASS: real loopback HTTP index=200; encoded parent and same-prefix sibling traversal=403.');
} finally {
  await server.close();
}
