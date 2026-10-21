// Copyright 2026 青岛屿漠商贸有限公司. SPDX-License-Identifier: Apache-2.0
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/demo-state.mjs', ['demo-state.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/assets/canvas-tote.png', ['assets/canvas-tote.png', 'image/png']],
  ['/assets/notebook-set.png', ['assets/notebook-set.png', 'image/png']],
  ['/assets/mark.svg', ['assets/mark.svg', 'image/svg+xml']],
]);
export function createDemoServer() {
  return http.createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader('Cache-Control', 'no-cache');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Method not allowed'); return;
    }
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; } catch { response.writeHead(400); response.end('Bad request'); return; }
    const entry = files.get(pathname);
    if (!entry) { response.writeHead(404); response.end('Not found'); return; }
    const file = path.join(root, entry[0]);
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': entry[1], 'Content-Length': stat.size });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = fs.createReadStream(file);
      stream.on('error', () => response.destroy()); stream.pipe(response);
    });
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--port');
  const port = at === -1 ? 4173 : Number(process.argv[at + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Choose an explicit local port from 1024 to 65535');
  createDemoServer().listen(port, '127.0.0.1', () => console.log(`MerchantKit interactive demo: http://127.0.0.1:${port}\nBrowser-local fictional data only. No database, credentials or external services.`));
}
