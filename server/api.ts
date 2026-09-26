import type { IncomingMessage, ServerResponse } from 'node:http';
import { JsonStore, type ProjectRecord } from './store.ts';
import { listDir, readNote, readTree, removeNote, VaultError, vaultInfo, writeNote } from './vault.ts';

/*
 * API REST mínima sobre el archivo JSON:
 *   GET    /api/health            → { ok, dataFile }
 *   GET    /api/settings          PUT /api/settings
 *   GET    /api/projects          → resúmenes (sin el grafo completo)
 *   GET    /api/projects/:id      PUT /api/projects/:id      DELETE /api/projects/:id
 *   POST   /api/import            → importación masiva (migración desde el navegador)
 *   GET    /api/vault/info[?path=] → si la ruta (o la de Ajustes) existe y es un vault de Obsidian
 *   GET    /api/vault/list?path=   GET /api/vault/tree?path=
 *   GET    /api/vault/file?path=   PUT /api/vault/file?path=   DELETE /api/vault/file?path=
 *   (rutas relativas al vault configurado en Ajustes; no pueden salir de él)
 *   POST   /api/ai/proxy          → reenvía un pedido a un proveedor de IA compatible con OpenAI
 *                                   (evita CORS; solo rutas /chat/completions y /models, https o equipo local)
 */

type Next = (err?: unknown) => void;

const MAX_BODY = 20 * 1024 * 1024;

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 });
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

/** Resumen para el dashboard: lo necesario para listar sin mandar cada grafo completo. */
function summary(p: ProjectRecord) {
  const nodes = ((p.graph as { nodes?: { data?: { d?: Record<string, unknown> } }[] })?.nodes ?? []).map((n) => n.data?.d ?? {});
  const project = nodes.find((d) => d.kind === 'project') ?? {};
  const count = (k: string) => nodes.filter((d) => d.kind === k).length;
  return {
    id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt,
    description: String(project.description ?? ''),
    stack: ((project.stackItems as { label: string }[]) ?? []).map((i) => i.label).slice(0, 8),
    counts: { agent: count('agent'), skill: count('skill'), command: count('command'), rule: count('rule'), mcp: count('mcp') },
  };
}

const validId = (id: string) => /^[\w-]{1,64}$/.test(id);

/** Destinos que el intermediario de IA acepta: APIs compatibles con OpenAI por https, o servidores del propio equipo. */
export function proxyAllowed(raw: string): boolean {
  try {
    const u = new URL(raw);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    return (u.protocol === 'https:' || (u.protocol === 'http:' && local)) && /\/(chat\/completions|models)$/.test(u.pathname) && !u.username;
  } catch {
    return false;
  }
}

async function proxy(req: IncomingMessage, res: ServerResponse) {
  const body = (await readBody(req)) as { url?: string; method?: string; headers?: Record<string, string>; body?: string };
  if (!body.url || !proxyAllowed(body.url)) return send(res, 400, { error: 'Destino no permitido' });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = body.headers?.Authorization ?? body.headers?.authorization;
  if (auth) headers.Authorization = auth;
  let upstream: Response;
  try {
    upstream = await fetch(body.url, { method: body.method === 'POST' ? 'POST' : 'GET', headers, body: body.method === 'POST' ? body.body : undefined });
  } catch (e) {
    return send(res, 502, { error: `No se pudo conectar con ${new URL(body.url).host}: ${(e as Error).message}` });
  }
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
  const after = upstream.headers.get('retry-after');
  if (after) res.setHeader('Retry-After', after);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

/**
 * Crea el manejador HTTP. Sirve tanto de middleware de Vite (desarrollo) como dentro del servidor de producción.
 * Solo acepta pedidos del propio equipo (el servidor escucha en 127.0.0.1).
 */
export function createApi(store = new JsonStore()) {
  return async function api(req: IncomingMessage, res: ServerResponse, next?: Next) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next ? next() : send(res, 404, { error: 'No encontrado' });

    // Protección básica contra pedidos de otros sitios (el navegador manda Origin en los cross-site).
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && !origin.startsWith('tauri://'))
      return send(res, 403, { error: 'Origen no permitido' });

    try {
      const parts = url.pathname.split('/').filter(Boolean).slice(1); // sin "api"
      const [resource, id] = parts;
      const method = req.method ?? 'GET';

      if (resource === 'health' && method === 'GET') return send(res, 200, { ok: true, dataFile: store.file });

      if (resource === 'settings') {
        if (method === 'GET') return send(res, 200, (await store.read()).settings);
        if (method === 'PUT') {
          const body = (await readBody(req)) as Record<string, unknown>;
          return send(res, 200, await store.update((d) => (d.settings = { ...d.settings, ...body })));
        }
      }

      if (resource === 'ai' && id === 'proxy' && method === 'POST') return await proxy(req, res);

      if (resource === 'vault') {
        const settings = (await store.read()).settings;
        const rel = url.searchParams.get('path') ?? '';
        if (id === 'info' && method === 'GET') return send(res, 200, await vaultInfo(rel || String(settings.vaultPath ?? '')));
        const configured = String(settings.vaultPath ?? '').trim();
        if (!configured) throw new VaultError('no-vault');
        const info = await vaultInfo(configured);
        if (!info.exists) throw new VaultError('no-vault');
        const root = info.path;
        if (id === 'list' && method === 'GET') return send(res, 200, await listDir(root, rel));
        if (id === 'tree' && method === 'GET') return send(res, 200, await readTree(root, rel));
        if (id === 'file') {
          if (method === 'GET') return send(res, 200, { text: await readNote(root, rel) });
          if (method === 'PUT') {
            const body = (await readBody(req)) as { text?: unknown };
            await writeNote(root, rel, String(body.text ?? ''));
            return send(res, 204);
          }
          if (method === 'DELETE') {
            await removeNote(root, rel);
            return send(res, 204);
          }
        }
      }

      if (resource === 'projects' && !id) {
        if (method === 'GET') {
          const list = Object.values((await store.read()).projects).map(summary).sort((a, b) => b.updatedAt - a.updatedAt);
          return send(res, 200, list);
        }
      }

      if (resource === 'projects' && id) {
        if (!validId(id)) return send(res, 400, { error: 'Id inválido' });
        if (method === 'GET') {
          const p = (await store.read()).projects[id];
          return p ? send(res, 200, p) : send(res, 404, { error: 'Proyecto inexistente' });
        }
        if (method === 'PUT') {
          const body = (await readBody(req)) as Partial<ProjectRecord>;
          const saved = await store.update((d) => {
            const prev = d.projects[id];
            const now = Date.now();
            d.projects[id] = { ...body, id, name: String(body.name ?? prev?.name ?? 'sin-nombre'), createdAt: prev?.createdAt ?? now, updatedAt: now };
            return d.projects[id];
          });
          return send(res, 200, summary(saved));
        }
        if (method === 'DELETE') {
          await store.update((d) => void delete d.projects[id]);
          return send(res, 204);
        }
      }

      if (resource === 'templates' && !id && method === 'GET') {
        const list = Object.values((await store.read()).templates).sort((a, b) => b.updatedAt - a.updatedAt);
        return send(res, 200, list);
      }

      if (resource === 'templates' && id) {
        if (!validId(id)) return send(res, 400, { error: 'Id inválido' });
        if (method === 'PUT') {
          const body = (await readBody(req)) as Partial<ProjectRecord>;
          if (!Array.isArray(body.items)) return send(res, 400, { error: 'Plantilla inválida' });
          await store.update((d) => {
            const now = Date.now();
            d.templates[id] = { ...body, id, name: String(body.title ?? ''), createdAt: d.templates[id]?.createdAt ?? now, updatedAt: now };
          });
          return send(res, 204);
        }
        if (method === 'DELETE') {
          await store.update((d) => void delete d.templates[id]);
          return send(res, 204);
        }
      }

      if (resource === 'import' && method === 'POST') {
        const body = (await readBody(req)) as { projects?: ProjectRecord[]; settings?: Record<string, unknown> };
        const added = await store.update((d) => {
          let n = 0;
          for (const p of body.projects ?? []) {
            if (!p?.id || !validId(p.id) || d.projects[p.id]) continue;
            d.projects[p.id] = { ...p, createdAt: p.createdAt ?? Date.now(), updatedAt: p.updatedAt ?? Date.now() };
            n++;
          }
          if (body.settings && !Object.keys(d.settings).length) d.settings = body.settings;
          return n;
        });
        return send(res, 200, { added });
      }

      return send(res, 405, { error: 'Método no permitido' });
    } catch (e) {
      if (e instanceof VaultError) return send(res, e.status, { error: e.code, code: e.code });
      const status = (e as { status?: number }).status ?? (e instanceof SyntaxError ? 400 : 500);
      return send(res, status, { error: (e as Error).message });
    }
  };
}
