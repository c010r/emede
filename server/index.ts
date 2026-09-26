import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.ts';
import { JsonStore } from './store.ts';

/*
 * Servidor de producción: sirve la app compilada (dist/) y la API sobre el JSON.
 * Uso: npm run build && npm start  →  http://127.0.0.1:5178
 */

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const port = Number(process.env.PORT ?? 5178);
const host = process.env.HOST ?? '127.0.0.1';
const store = new JsonStore();
const api = createApi(store);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

async function serveStatic(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const file = join(root, safe);
  if (!file.startsWith(root)) return null;
  try {
    if ((await stat(file)).isFile()) return { body: await readFile(file), type: TYPES[extname(file)] ?? 'application/octet-stream' };
  } catch { /* no existe: cae al index.html */ }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) return api(req, res);
  const hit = (await serveStatic(url.pathname)) ?? (await serveStatic('index.html'));
  if (!hit) {
    res.statusCode = 500;
    return res.end('Falta dist/: ejecutá npm run build');
  }
  res.setHeader('Content-Type', hit.type);
  res.end(hit.body);
})
  .on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.error(`El puerto ${port} está ocupado (¿ya está abierto emede o npm run dev?). Usá otro: PORT=5180 npm start`);
    process.exit(1);
  })
  .listen(port, host, () => {
    console.log(`emede listo en http://${host}:${port}`);
    console.log(`datos: ${store.file}`);
  });
