import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi, isLoopback } from '../../server/api.ts';
import { JsonStore } from '../../server/store.ts';

let dir = '';
let server: Server;
let base = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'emede-'));
  const api = createApi(new JsonStore(join(dir, 'emede.json')));
  server = createServer((req, res) => api(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

const call = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

/** Pedido con cabeceras que fetch no deja cambiar (Host). */
const raw = (path: string, headers: Record<string, string>) =>
  new Promise<number>((ok, fail) => {
    const req = request(base + path, { headers }, (res) => {
      res.resume();
      ok(res.statusCode ?? 0);
    });
    req.on('error', fail);
    req.end();
  });

const project = (id: string, name: string) => ({
  id, name, graph: { nodes: [{ id: 'project', data: { d: { kind: 'project', name, description: 'd', stackItems: [{ label: 'React' }] } } }, { id: 'a', data: { d: { kind: 'agent' } } }], edges: [] },
  fileOverrides: {}, excluded: [],
});

describe('API sobre archivo JSON', () => {
  it('guarda, lista y borra plantillas propias', async () => {
    const pack = { id: 'u-1', title: 'Equipo', blurb: '', lang: 'es', items: [{ id: 'agent-x', kind: 'agent', title: 'x', blurb: '', data: { name: 'x' } }] };
    expect((await call('/api/templates/u-1', { method: 'PUT', body: JSON.stringify(pack) })).status).toBe(204);
    const list = (await call('/api/templates')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'u-1', title: 'Equipo', items: pack.items });
    expect((await call('/api/templates/u-1', { method: 'PUT', body: '{"title":"sin items"}' })).status).toBe(400);
    expect((await call('/api/templates/..%2Fx', { method: 'PUT', body: JSON.stringify(pack) })).status).toBe(400);
    await call('/api/templates/u-1', { method: 'DELETE' });
    expect((await call('/api/templates')).body).toEqual([]);
  });

  it('informa dónde guarda', async () => {
    const r = await call('/api/health');
    expect(r.body).toEqual({ ok: true, dataFile: join(dir, 'emede.json') });
  });

  it('crea, lista con resumen, lee, actualiza y borra proyectos', async () => {
    expect((await call('/api/projects/p1', { method: 'PUT', body: JSON.stringify(project('p1', 'uno')) })).status).toBe(200);
    await call('/api/projects/p2', { method: 'PUT', body: JSON.stringify(project('p2', 'dos')) });

    const list = (await call('/api/projects')).body;
    expect(list.map((p: { name: string }) => p.name)).toEqual(['dos', 'uno']); // más reciente primero
    expect(list[0]).toMatchObject({ description: 'd', stack: ['React'], counts: { agent: 1 } });
    expect(list[0].graph).toBeUndefined(); // el listado no manda el grafo completo

    const full = (await call('/api/projects/p1')).body;
    expect(full.graph.nodes).toHaveLength(2);
    const created = full.createdAt;

    await call('/api/projects/p1', { method: 'PUT', body: JSON.stringify(project('p1', 'uno-v2')) });
    const again = (await call('/api/projects/p1')).body;
    expect(again.name).toBe('uno-v2');
    expect(again.createdAt).toBe(created);

    expect((await call('/api/projects/p2', { method: 'DELETE' })).status).toBe(204);
    expect((await call('/api/projects/p2')).status).toBe(404);
  });

  it('guarda los datos en el archivo JSON con respaldo .bak', async () => {
    const data = JSON.parse(await readFile(join(dir, 'emede.json'), 'utf8'));
    expect(Object.keys(data.projects)).toEqual(['p1']);
    expect(existsSync(join(dir, 'emede.json.bak'))).toBe(true);
  });

  it('ajustes y escrituras concurrentes sin perder datos', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      call(`/api/projects/c${i}`, { method: 'PUT', body: JSON.stringify(project(`c${i}`, `c${i}`)) })));
    await call('/api/settings', { method: 'PUT', body: JSON.stringify({ model: 'x', lang: 'es' }) });
    expect((await call('/api/projects')).body).toHaveLength(11);
    expect((await call('/api/settings')).body).toEqual({ model: 'x', lang: 'es' });
  });

  it('importa sin pisar proyectos existentes', async () => {
    const r = await call('/api/import', { method: 'POST', body: JSON.stringify({ projects: [project('p1', 'pisado'), project('nuevo', 'nuevo')] }) });
    expect(r.body).toEqual({ added: 1 });
    expect((await call('/api/projects/p1')).body.name).toBe('uno-v2');
  });

  it('rechaza ids inválidos y orígenes de otros sitios', async () => {
    expect((await call('/api/projects/..%2Fetc')).status).toBe(400);
    expect((await call('/api/projects', { headers: { Origin: 'https://malicioso.com' } })).status).toBe(403);
  });

  it('rechaza Host ajenos (DNS rebinding) y orígenes locales mal formados', async () => {
    const port = new URL(base).port;
    // Un dominio ajeno que resuelve a 127.0.0.1: el navegador no manda Origin en un GET del mismo origen.
    expect(await raw('/api/settings', { Host: `malicioso.com:${port}` })).toBe(403);
    expect(await raw('/api/settings', { Host: `127.0.0.1.malicioso.com:${port}` })).toBe(403);
    expect(await raw('/api/settings', { Host: `localhost:${port}` })).toBe(200);
    expect(await raw('/api/settings', { Host: `127.0.0.1:${port}`, Origin: 'http://localhost.malicioso.com' })).toBe(403);
    expect(await raw('/api/settings', { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` })).toBe(200);
  });

  it('solo atiende conexiones del propio equipo', () => {
    for (const a of ['127.0.0.1', '127.5.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopback(a)).toBe(true);
    for (const a of ['192.168.1.20', '10.0.0.1', '::ffff:192.168.1.20', 'fe80::1', '', undefined]) expect(isLoopback(a)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('el archivo de datos y sus copias son privados (tienen las API keys)', async () => {
    const sub = join(dir, 'privado');
    const store = new JsonStore(join(sub, 'emede.json'));
    await store.update((d) => (d.settings = { keys: { openai: 'sk-x' } }));
    await store.update((d) => (d.settings = { keys: { openai: 'sk-y' } }));
    const mode = async (f: string) => (await stat(join(sub, f))).mode & 0o777;
    expect(await mode('')).toBe(0o700);
    expect(await mode('emede.json')).toBe(0o600);
    expect(await mode('emede.json.bak')).toBe(0o600);
    // Un archivo creado antes con permisos abiertos queda privado en la próxima escritura.
    const old = join(dir, 'viejo.json');
    await writeFile(old, '{}', { mode: 0o644 });
    await new JsonStore(old).update(() => undefined);
    expect((await stat(old)).mode & 0o777).toBe(0o600);
    expect((await stat(`${old}.bak`)).mode & 0o777).toBe(0o600);
  });

  it('si el JSON está dañado conserva una copia y arranca vacío', async () => {
    const file = join(dir, 'roto.json');
    await writeFile(file, '{ esto no es json');
    const store = new JsonStore(file);
    expect((await store.read()).projects).toEqual({});
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(dir)).some((f) => f.startsWith('roto.json.corrupto-'))).toBe(true);
  });
});

describe('vault de Obsidian por ruta', () => {
  let vaultDir = '';
  beforeAll(async () => {
    vaultDir = join(dir, 'MiVault');
    await mkdir(join(vaultDir, '.obsidian'), { recursive: true });
    await mkdir(join(vaultDir, 'Notas'), { recursive: true });
    await writeFile(join(vaultDir, 'Notas', 'Idea.md'), 'Ver [[Stack]]');
    await writeFile(join(vaultDir, 'Stack.md'), 'Next.js');
    await writeFile(join(vaultDir, '.obsidian', 'app.json'), '{}');
  });

  it('verifica si una ruta es un vault', async () => {
    expect((await call(`/api/vault/info?path=${encodeURIComponent(vaultDir)}`)).body).toMatchObject({ exists: true, isVault: true });
    expect((await call(`/api/vault/info?path=${encodeURIComponent(join(dir, 'nada'))}`)).body).toMatchObject({ exists: false });
  });

  it('sin vault configurado no lee nada', async () => {
    expect((await call('/api/vault/tree?path=')).body).toMatchObject({ code: 'no-vault' });
  });

  it('lee, escribe y borra notas dentro del vault; nunca afuera', async () => {
    await call('/api/settings', { method: 'PUT', body: JSON.stringify({ vaultPath: vaultDir }) });
    const tree = (await call('/api/vault/tree?path=')).body;
    expect(Object.keys(tree).sort()).toEqual(['Notas/Idea.md', 'Stack.md']); // sin .obsidian

    expect((await call('/api/vault/file?path=emede/p/a.md', { method: 'PUT', body: JSON.stringify({ text: 'hola' }) })).status).toBe(204);
    expect(await readFile(join(vaultDir, 'emede', 'p', 'a.md'), 'utf8')).toBe('hola');
    expect((await call('/api/vault/file?path=emede/p/a.md')).body).toEqual({ text: 'hola' });
    await call('/api/vault/file?path=emede/p/a.md', { method: 'DELETE' });
    expect(existsSync(join(vaultDir, 'emede', 'p', 'a.md'))).toBe(false);

    for (const bad of ['../fuera.md', '..%2F..%2Fx.md', encodeURIComponent(join(dir, 'x.md'))]) {
      const r = await call(`/api/vault/file?path=${bad}`, { method: 'PUT', body: JSON.stringify({ text: 'x' }) });
      expect(r.body).toMatchObject({ code: 'outside' });
    }
    expect(existsSync(join(dir, 'fuera.md'))).toBe(false);
  });

  it('solo toca notas (.md/.canvas) fuera de carpetas ocultas, aunque el vault sea la carpeta personal', async () => {
    const put = (p: string) => call(`/api/vault/file?path=${encodeURIComponent(p)}`, { method: 'PUT', body: JSON.stringify({ text: 'x' }) });
    for (const bad of ['.bashrc', '.ssh/authorized_keys', '.obsidian/app.json', '.git/hooks/pre-commit.md', 'script.sh', 'Notas/Idea.md.sh']) {
      expect((await put(bad)).body, bad).toMatchObject({ code: 'not-note' });
      expect((await call(`/api/vault/file?path=${encodeURIComponent(bad)}`)).body, bad).toMatchObject({ code: 'not-note' });
      expect((await call(`/api/vault/file?path=${encodeURIComponent(bad)}`, { method: 'DELETE' })).body, bad).toMatchObject({ code: 'not-note' });
    }
    expect(await readFile(join(vaultDir, '.obsidian', 'app.json'), 'utf8')).toBe('{}');
    expect(existsSync(join(vaultDir, '.bashrc'))).toBe(false);
    expect((await put('Notas/lienzo.canvas')).status).toBe(204);
  });

  it.skipIf(process.platform === 'win32')('un enlace simbólico dentro del vault no lleva afuera', async () => {
    const outside = join(dir, 'afuera');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secreto.md'), 'secreto');
    await symlink(outside, join(vaultDir, 'enlace'));
    await symlink(join(outside, 'secreto.md'), join(vaultDir, 'nota-enlazada.md'));
    const q = (p: string) => `/api/vault/file?path=${encodeURIComponent(p)}`;
    expect((await call(q('enlace/secreto.md'))).body).toMatchObject({ code: 'outside' });
    expect((await call(q('nota-enlazada.md'))).body).toMatchObject({ code: 'outside' });
    expect((await call(q('enlace/nuevo.md'), { method: 'PUT', body: JSON.stringify({ text: 'x' }) })).body).toMatchObject({ code: 'outside' });
    expect((await call(q('nota-enlazada.md'), { method: 'DELETE' })).body).toMatchObject({ code: 'outside' });
    expect((await call('/api/vault/list?path=enlace')).body).toMatchObject({ code: 'outside' });
    expect(existsSync(join(outside, 'nuevo.md'))).toBe(false);
    expect(await readFile(join(outside, 'secreto.md'), 'utf8')).toBe('secreto');
    await rm(join(vaultDir, 'enlace'));
    await rm(join(vaultDir, 'nota-enlazada.md'));
  });

  it('el adaptador del cliente funciona como una carpeta normal', async () => {
    const { serverVault } = await import('../vaultServer');
    const { readTree, readText, writeText, removeFile } = await import('../fs');
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((u: string, init?: RequestInit) => realFetch(base + u, init)) as typeof fetch;
    try {
      const v = serverVault(vaultDir);
      await writeText(v, 'emede/p/agentes/x.md', 'contenido');
      expect(await readText(v, 'emede/p/agentes/x.md')).toBe('contenido');
      expect(await readText(v, 'emede/p/no-existe.md')).toBeNull();
      expect(Object.keys(await readTree(v, 'emede', () => true))).toEqual(['emede/p/agentes/x.md']);
      expect(Object.keys(await readTree(v, '', (p) => p.endsWith('.md'), (p) => p === 'emede')).sort()).toEqual(['Notas/Idea.md', 'Stack.md']);
      await removeFile(v, 'emede/p/agentes/x.md');
      expect(await readText(v, 'emede/p/agentes/x.md')).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
