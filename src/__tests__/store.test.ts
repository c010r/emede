import { beforeEach, describe, expect, it } from 'vitest';
import { initialGraph, layout, useStore } from '../store';
import { applyTemplates, PACKS, TEMPLATES } from '../templates';
import { closeProject, createProject, deleteProject, duplicateProject, exportable, openProject } from '../projects';
import { browserBackend, setBackend, storage } from '../storage';
import type { McpData } from '../types';
import { graph } from './helpers';

const st = () => useStore.getState();

beforeEach(() => {
  localStorage.clear();
  setBackend(browserBackend());
  st().loadProject({ id: 'p1', graph: initialGraph() });
});

describe('deshacer / rehacer', () => {
  it('deshace y rehace agregar un nodo', () => {
    const id = st().addNode('agent');
    expect(st().nodes.some((n) => n.id === id)).toBe(true);
    st().undo();
    expect(st().nodes.some((n) => n.id === id)).toBe(false);
    st().redo();
    expect(st().nodes.some((n) => n.id === id)).toBe(true);
  });

  it('agrupa lo que se tipea en un mismo campo en un solo paso', () => {
    const id = st().addNode('agent', { name: 'a' });
    for (const name of ['ab', 'abc', 'abcd']) st().updateNode(id, { name });
    st().undo();
    expect(st().nodes.find((n) => n.id === id)?.data.d.name).toBe('a');
  });

  it('una acción nueva descarta lo que se podía rehacer', () => {
    st().addNode('agent');
    st().undo();
    expect(st().future.length).toBe(1);
    st().addNode('skill');
    expect(st().future.length).toBe(0);
  });

  it('mover nodos no cambia la versión de contenido (no regenera archivos)', () => {
    const v = st().contentVersion;
    st().onNodesChange([{ type: 'position', id: 'project', position: { x: 50, y: 50 }, dragging: true }]);
    st().onNodesChange([{ type: 'position', id: 'project', position: { x: 60, y: 60 }, dragging: false }]);
    expect(st().contentVersion).toBe(v);
    st().undo(); // el arrastre sí se puede deshacer
    expect(st().nodes[0].position).toEqual({ x: 0, y: 0 });
  });
});

describe('ubicación de nodos', () => {
  it('los nodos nuevos del mismo tipo no se enciman', () => {
    const a = st().addNode('agent'), b = st().addNode('agent');
    const pos = (id: string) => st().nodes.find((n) => n.id === id)!.position;
    expect(Math.abs(pos(a).y - pos(b).y)).toBeGreaterThanOrEqual(150);
  });
  it('ordenar reparte por columnas sin superponer', () => {
    const g = graph([['a1', 'agent'], ['a2', 'agent'], ['c', 'command'], ['r', 'rule']]);
    const out = layout(g.nodes);
    const spots = out.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(spots).size).toBe(spots.length);
  });
});

describe('plantillas', () => {
  it('un paquete agrega todo, conecta y es un solo paso de deshacer', () => {
    const pack = PACKS.find((p) => p.id === 'pack-pr')!;
    const items = pack.items.map((id) => TEMPLATES.find((t) => t.id === id)!);
    expect(applyTemplates(items)).toHaveLength(items.length);
    const kinds = st().edges.map((e) => [e.source, e.target].map((id) => st().nodes.find((n) => n.id === id)!.data.d.name).join('>'));
    expect(kinds).toContain('review>code-reviewer');
    expect(kinds).toContain('commit>conventional-commits');
    expect(applyTemplates(items)).toEqual([]); // no duplica
    st().undo();
    expect(st().nodes.length).toBe(1);
  });
  it('todas las plantillas tienen nombre y descripción o datos mínimos', () => {
    for (const t of TEMPLATES) {
      expect(t.data.name, t.id).toBeTruthy();
      if (t.kind !== 'mcp') expect(String((t.data as { description?: string }).description), t.id).not.toBe('');
    }
  });
});

describe('proyectos guardados en JSON', () => {
  it('crea, guarda al cerrar, lista, duplica, reabre y borra', async () => {
    const id = await createProject();
    expect(st().view).toBe('editor');
    st().updateNode('project', { name: 'uno' });
    await closeProject();
    expect(st().view).toBe('dashboard');

    await duplicateProject(id);
    const list = await storage().list();
    expect(list.map((p) => p.name).sort()).toEqual(['uno', 'uno-copia']);

    expect(await openProject(id)).toBe(true);
    expect(st().nodes[0].data.d.name).toBe('uno');
    expect(st().past).toEqual([]); // el historial arranca limpio

    await deleteProject(id);
    expect((await storage().list()).map((p) => p.name)).toEqual(['uno-copia']);
  });

  it('exportar no incluye secretos', () => {
    const g = graph([['m', 'mcp', { name: 'gh', env: 'GITHUB_TOKEN=ghp_realvalue1234567890\nLOG=debug' }]]);
    const out = exportable(g).nodes.find((n) => n.id === 'm')!.data.d as McpData;
    expect(out.env).toBe('GITHUB_TOKEN=${GITHUB_TOKEN}\nLOG=debug');
  });
});
