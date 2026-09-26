import { beforeEach, describe, expect, it } from 'vitest';
import { packFromNodes, parsePack, serializePack } from '../userTemplates';
import { applyTemplates } from '../templates';
import { browserBackend } from '../storage';
import { useStore } from '../store';
import type { McpData } from '../types';
import { graph } from './helpers';

const g = graph(
  [
    ['project', 'project', { name: 'tienda' }],
    ['a', 'agent', { name: 'revisor', description: 'Revisa PRs.', prompt: 'Sos revisor.' }],
    ['s', 'skill', { name: 'commits', description: 'Commits convencionales.', instructions: 'feat/fix.' }],
    ['m', 'mcp', { name: 'github', transport: 'http', url: 'https://x/mcp', headers: 'Authorization=Bearer ghp_abcdefghijklmnopqrstuvwxyz123456', env: 'DEBUG=1' }],
  ],
  [['a', 's'], ['a', 'm']],
);

describe('plantillas propias', () => {
  beforeEach(() => localStorage.clear());

  it('guarda las piezas elegidas con sus conexiones y sin secretos', () => {
    const p = packFromNodes(g, ['a', 's', 'm', 'project'], { title: 'Equipo', blurb: 'Lo nuestro', lang: 'es' });
    expect(p.items.map((i) => i.id)).toEqual(['agent-revisor', 'skill-commits', 'mcp-github']);
    expect(p.items[0].links).toEqual(['commits', 'github']);
    const mcp = p.items[2].data as Partial<McpData>;
    expect(mcp.headers).toBe('Authorization=Bearer ${GITHUB_TOKEN}');
    expect(mcp.env).toBe('DEBUG=1');
    expect(serializePack(p)).not.toContain('ghp_');
  });

  it('ida y vuelta por archivo: id nuevo, sin invisibles ni campos desconocidos', () => {
    const p = packFromNodes(g, ['a'], { title: 'Revisor', blurb: '', lang: 'en' });
    const raw = JSON.parse(serializePack(p));
    raw.items[0].data.prompt = 'Sos​ revisor.';
    raw.items[0].data.inyectado = 'x';
    const { pack, hidden } = parsePack(JSON.stringify(raw));
    expect(hidden).toBe(1);
    expect(pack.id).not.toBe(p.id);
    expect(pack.lang).toBe('en');
    expect(pack.items[0].data).toMatchObject({ name: 'revisor', prompt: 'Sos revisor.' });
    expect(pack.items[0].data).not.toHaveProperty('inyectado');
  });

  it('rechaza archivos que no son paquetes', () => {
    expect(() => parsePack('{"emede":1}')).toThrow(/emede-pack/);
    expect(() => parsePack('no json')).toThrow();
    expect(() => parsePack(JSON.stringify({ emedePack: 1, items: [{ kind: 'virus', data: { name: 'x' } }] }))).toThrow();
  });

  it('se inserta en otro proyecto con sus conexiones', () => {
    const p = packFromNodes(g, ['a', 's'], { title: 'Equipo', blurb: '', lang: 'es' });
    useStore.getState().loadProject({ id: 'otro', graph: graph([['project', 'project', { name: 'otro' }]]) });
    expect(applyTemplates(p.items)).toHaveLength(2);
    const { nodes, edges } = useStore.getState();
    expect(nodes.map((n) => n.data.d.name).sort()).toEqual(['commits', 'otro', 'revisor']);
    expect(edges).toHaveLength(1);
  });

  it('se guardan en el navegador cuando no hay servidor', async () => {
    const b = browserBackend();
    const p = packFromNodes(g, ['a'], { title: 'Revisor', blurb: '', lang: 'es' });
    await b.putTemplate(p);
    expect((await b.listTemplates()).map((x) => x.title)).toEqual(['Revisor']);
    await b.removeTemplate(p.id);
    expect(await b.listTemplates()).toEqual([]);
  });
});
