import { describe, expect, it } from 'vitest';
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { createMissingNotes } from '../vaultAuto';
import { pendingNotes } from '../obsidian';
import { setFlowOps, useStore, type Graph } from '../store';
import type { ProjectData, VaultSync } from '../types';
import { graph } from './helpers';
import { memDir } from './memfs';

setFlowOps({ addEdge, applyEdgeChanges, applyNodeChanges });

const withSync = (g: Graph, vault: VaultSync): Graph => ({
  ...g,
  nodes: g.nodes.map((n) => (n.id === 'project' ? { ...n, data: { d: { ...(n.data.d as ProjectData), vault } } } : n)),
});

const named = () => graph([['project', 'project', { name: 'tienda' }], ['a1', 'agent', { name: 'revisor' }]], [['a1', 'a1']]);

describe('guardado automático en el vault', () => {
  it('al vincular crea todas las notas del proyecto y las registra', async () => {
    const dir = memDir({ 'Bienvenido.md': '# hola' });
    const r = await createMissingNotes(dir, named(), 'emede', 'es');
    expect(r?.written.sort()).toEqual(['emede/tienda/agentes/revisor.md', 'emede/tienda/tienda.canvas', 'emede/tienda/tienda.md']);
    expect(dir.files['emede/tienda/agentes/revisor.md']).toContain('emede-id: a1');
    expect(dir.files['Bienvenido.md']).toBe('# hola');
    expect(Object.keys(r!.sync.notes).sort()).toEqual(['a1', 'canvas', 'project']);
  });

  it('nunca pisa una nota que ya existe', async () => {
    const dir = memDir({ 'emede/tienda/tienda.md': 'mi nota' });
    const r = await createMissingNotes(dir, named(), 'emede', 'es');
    expect(r?.written).not.toContain('emede/tienda/tienda.md');
    expect(dir.files['emede/tienda/tienda.md']).toBe('mi nota');
  });

  it('después solo crea las piezas nuevas y no revive notas borradas en Obsidian', async () => {
    const dir = memDir();
    const first = await createMissingNotes(dir, named(), 'emede', 'es');
    delete dir.files['emede/tienda/agentes/revisor.md']; // borrada en Obsidian
    const g = graph([['project', 'project', { name: 'tienda' }], ['a1', 'agent', { name: 'revisor' }], ['s1', 'skill', { name: 'pruebas' }]]);
    const r = await createMissingNotes(dir, withSync(g, first!.sync), 'emede', 'es');
    expect(r?.written).toEqual(['emede/tienda/skills/pruebas.md']);
    expect(Object.keys(r!.sync.notes).sort()).toEqual(['a1', 'canvas', 'project', 's1']);
    expect(await createMissingNotes(dir, withSync(g, r!.sync), 'emede', 'es')).toBeNull();
  });

  it('espera a que el proyecto y las piezas tengan nombre propio', async () => {
    const dir = memDir();
    expect(await createMissingNotes(dir, graph([['a1', 'agent', { name: 'revisor' }]]), 'emede', 'es')).toBeNull();
    const r = await createMissingNotes(dir, graph([['project', 'project', { name: 'tienda' }], ['a1', 'agent']]), 'emede', 'es');
    expect(r?.written.some((p) => p.includes('nuevo-agente'))).toBe(false);
    expect(r?.sync.notes.a1).toBeUndefined();
  });

  it('las notas pasan por la sanitización', async () => {
    const dir = memDir();
    await createMissingNotes(dir, graph([['project', 'project', { name: 'tienda' }], ['a1', 'agent', { name: 'revisor', prompt: 'hola​mundo' }]]), 'emede', 'es');
    expect(dir.files['emede/tienda/agentes/revisor.md']).toContain('holamundo');
  });

  it('deshacer una edición no olvida lo que ya está en el vault', () => {
    const st = useStore.getState;
    st().loadProject({ id: 'p1', graph: named() });
    st().updateNode('a1', { description: 'x' });
    st().setVaultSync({ path: 'emede/tienda', notes: { a1: { path: 'emede/tienda/agentes/revisor.md', vault: '1', emede: '1' } } });
    st().undo();
    expect((st().nodes.find((n) => n.id === 'project')!.data.d as ProjectData).vault?.path).toBe('emede/tienda');
  });
});

describe('notas pendientes (indicador de la barra)', () => {
  const synced = async (g: Graph) => withSync(g, (await createMissingNotes(memDir(), g, 'emede', 'es'))!.sync);
  const base = 'emede/tienda';

  it('recién guardado está al día', async () => {
    expect(pendingNotes(await synced(named()), base, 'es')).toEqual([]);
  });

  it('una pieza editada en emede queda pendiente', async () => {
    const g = await synced(named());
    const edited = { ...g, nodes: g.nodes.map((n) => (n.id === 'a1' ? { ...n, data: { d: { ...n.data.d, description: 'revisa PRs' } } } : n)) };
    expect(pendingNotes(edited, base, 'es')).toEqual(['emede/tienda/agentes/revisor.md']);
  });

  it('una pieza borrada deja pendiente su nota vieja; las sin nombre no cuentan', async () => {
    const g = await synced(named());
    const without = { nodes: g.nodes.filter((n) => n.id !== 'a1'), edges: [] };
    expect(pendingNotes(without, base, 'es')).toContain('emede/tienda/agentes/revisor.md');
    const plusUnnamed = await synced(named());
    plusUnnamed.nodes.push({ ...graph([['s1', 'skill']]).nodes[1] });
    expect(pendingNotes(plusUnnamed, base, 'es').some((p) => p.includes('nueva-skill'))).toBe(false);
  });
});
