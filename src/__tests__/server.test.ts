import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../../server/api.ts';
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
