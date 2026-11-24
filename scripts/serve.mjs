import { createServer } from 'node:http';
import { existsSync, createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import workspace from '../api/workspace.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const envFile = path.join(project, '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const production = process.argv.includes('--production');
const publicRoot = await realpath(production ? path.join(project, 'dist') : project).catch(() => {
  throw new Error('Production output missing. Run npm run build before npm start.');
});
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');

const mime = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}));

function publicFile(pathname) {
  if (pathname === '/') return 'index.html';
  if (['/index.html', '/sw.js', '/manifest.webmanifest', '/favicon.ico'].includes(pathname)) return pathname.slice(1);
  const parts = pathname.slice(1).split('/');
  const [base] = parts;
  const extension = path.extname(pathname);
  if (!['assets', 'src'].includes(base) || !mime.has(extension)) return null;
  if (base === 'src' && !['.js', '.css'].includes(extension)) return null;
  if (parts.some(part => !part || part.startsWith('.') || /[\\:\0]/.test(part))) return null;
  return parts.join(path.sep);
}

function reply(res, status, message, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(message);
}

async function api(req, res) {
  const init = { method: req.method, headers: req.headers };
  if (!['GET', 'HEAD'].includes(req.method)) {
    init.body = Readable.toWeb(req);
    init.duplex = 'half';
  }
  const response = await workspace.fetch(new Request('http://localhost/api/workspace', init));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  let pathname;
  try {
    const host = new URL('http://' + req.headers.host).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      reply(res, 403, 'Local connections only.');
      return;
    }
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    reply(res, 400, 'Invalid request.');
    return;
  }

  try {
    if (pathname === '/api/workspace') {
      await api(req, res);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      reply(res, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
      return;
    }
    const name = publicFile(pathname);
    const resolved = name && await realpath(path.join(publicRoot, name));
    const relative = resolved && path.relative(publicRoot, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !publicFile('/' + relative.split(path.sep).join('/'))) {
      reply(res, 404, 'File not found.');
      return;
    }
    const info = await stat(resolved);
    if (!info.isFile()) {
      reply(res, 404, 'File not found.');
      return;
    }
    res.writeHead(200, { 'Content-Length': info.size, 'Content-Type': mime.get(path.extname(resolved)) });
    if (req.method === 'HEAD') res.end();
    else await pipeline(createReadStream(resolved), res);
  } catch (error) {
    if (res.headersSent) return;
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) reply(res, 404, 'File not found.');
    else reply(res, 500, 'Request could not be completed.');
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'Port ' + port + ' is already in use.' : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log('TerraSense ' + (production ? 'production' : 'development') + ' preview: http://127.0.0.1:' + port);
});
