import { readFileSync, lstatSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
const root = process.env.SITE_RELEASE_DIR;
if (!root) throw new Error('SITE_RELEASE_DIR required');
const port = Number(process.env.SITE_RELEASE_PORT ?? 5210);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const find = (path) => {
  if (!path || path === '/') return readFileSync(join(root, 'index.html'));
  const file = resolve(root, path.slice(1));
  if (!file.startsWith(root + sep)) return undefined;
  try {
    const stat = lstatSync(file);
    if (stat.isFile()) return readFileSync(file);
    if (stat.isDirectory()) return readFileSync(join(file, 'index.html'));
  } catch {}
  return undefined;
};
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return; }
  const pathname = decodeURIComponent(url.pathname);
  const body = find(pathname);
  if (body === undefined) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
  const type = (pathname === '/' || pathname.endsWith('/')) ? types['.html'] : types[extname(pathname)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive' });
  res.end(req.method === 'HEAD' ? undefined : body);
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${port}/` })));
const close = () => server.close(() => process.exit(0));
process.once('SIGINT', close); process.once('SIGTERM', close);
