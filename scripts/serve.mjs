import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

export function createGalaxyServer(root = projectRoot) {
  return createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      // The iframe has an opaque sandbox origin. Only public static files are served here.
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    };
    const send = (status, body, extra = {}) => {
      response.writeHead(status, { ...headers, ...extra });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'Method not allowed', { Allow: 'GET, HEAD' });
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { return send(400, 'Invalid path'); }
    if (pathname === '/') pathname = '/index.html';
    if (pathname.includes('\\') || pathname.includes('\0')) return send(400, 'Invalid path');
    if (!['/index.html', '/gravity-galaxy.html'].includes(pathname) && !pathname.startsWith('/src/') && !pathname.startsWith('/vendor/')) return send(404, 'Not found');
    const filename = resolve(root, '.' + pathname);
    const relativePath = relative(root, filename);
    if (relativePath === '..' || relativePath.startsWith('..' + sep) || isAbsolute(relativePath)) return send(403, 'Forbidden');
    if (!['index.html', 'gravity-galaxy.html'].includes(relativePath) && !relativePath.startsWith('src' + sep) && !relativePath.startsWith('vendor' + sep)) return send(404, 'Not found');
    if (!types[extname(filename)]) return send(404, 'Not found');
    try {
      const body = await readFile(filename);
      send(200, body, { 'Content-Type': types[extname(filename)], 'Content-Length': body.length });
    } catch (error) {
      send(['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code) ? 404 : 500, 'File unavailable');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const server = createGalaxyServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Set PORT to another port and restart.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`Astra is running at http://${host}:${port}\nPress Ctrl+C to stop.`));
  process.on('SIGINT', () => server.close());
  process.on('SIGTERM', () => server.close());
}
