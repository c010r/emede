import { migrateSettings } from '../providers';
import { beforeEach, describe, expect, it } from 'vitest';
import { browserBackend, migrateLegacy, normalizeGraph } from '../storage';
import { graph } from './helpers';

beforeEach(() => localStorage.clear());

describe('migración desde versiones anteriores', () => {
  it('pasa el proyecto abierto y la biblioteca vieja al JSON, una sola vez', async () => {
    const g = graph([['project', 'project', { name: 'actual' }], ['a', 'agent', { name: 'rev' }]]);
    const old = graph([['project', 'project', { name: 'viejo' }]]);
    localStorage.setItem('emede-state', JSON.stringify({
      state: { nodes: g.nodes, edges: [], projectId: 'cur', settings: { apiKey: 'k', model: 'm', lang: 'es', targets: ['claude'] } },
      version: 3,
    }));
    localStorage.setItem('emede-library', JSON.stringify({ old: { id: 'old', name: 'viejo', graph: old, fileOverrides: {}, excluded: [], updatedAt: 1 } }));

    const b = browserBackend();
    expect(await migrateLegacy(b)).toBe(2);
    expect((await b.list()).map((p) => p.name).sort()).toEqual(['actual', 'viejo']);
    expect(migrateSettings(await b.getSettings())).toMatchObject({ keys: { gemini: 'k' } });
    expect(localStorage.getItem('emede-state')).toBeNull();
    expect(localStorage.getItem('emede-state-migrado')).not.toBeNull(); // queda respaldo
    expect(await migrateLegacy(b)).toBe(0);
  });

  it('completa campos de versiones viejas (stack como texto, MCP sin headers)', () => {
    const g = graph([['m', 'mcp']]);
    const p = g.nodes[0].data.d as unknown as Record<string, unknown>;
    delete p.stackItems;
    p.stack = 'React, Vite';
    delete (g.nodes[1].data.d as unknown as Record<string, unknown>).headers;
    const n = normalizeGraph(g);
    expect((n.nodes[0].data.d as { stackItems: { id: string }[] }).stackItems.map((i) => i.id)).toEqual(['react', 'vite']);
    expect((n.nodes[1].data.d as { headers: string }).headers).toBe('');
  });
});
