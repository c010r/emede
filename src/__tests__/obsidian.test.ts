import { describe, expect, it } from 'vitest';
import {
  applyImport, collectNotes, hash, mirror, planImport, resolveLink, staleNotes, syncState, unsyncedEdits, vaultBase,
} from '../obsidian';
import type { Graph } from '../store';
import type { AgentData, McpData, ProjectData, SkillData } from '../types';
import { graph } from './helpers';

const BASE = 'emede/tienda';

const sample = () => graph([
  ['project', 'project', {
    name: 'tienda', description: 'Tienda online', test: 'npm test', memory: '# Tienda\n\n## Comandos\n- npm test',
    structure: 'src/ app', conventions: '- Usá tabs', plan: '# Plan\n- [ ] fase 1',
  }],
  ['a', 'agent', { name: 'revisor', description: 'Revisa PRs. Usar cuando hay un diff.', tools: ['read', 'search'], prompt: 'Sos revisor.' }],
  ['s', 'skill', { name: 'deploy', description: 'Despliega. Usar antes de publicar.', instructions: '1. npm run build' }],
  ['s2', 'skill', { name: 'migrar', description: 'Migraciones. Usar cuando cambia el esquema.', instructions: 'x' }],
  ['c', 'command', { name: 'review', description: 'Revisa', argumentHint: '[pr]', prompt: 'Revisá $ARGUMENTS' }],
  ['m', 'mcp', { name: 'github', command: 'npx', args: '-y server-github', env: 'GITHUB_TOKEN=ghp_secreto123456789' }],
], [['a', 's'], ['c', 'a']]);

const d = <T>(g: Graph, id: string) => g.nodes.find((n) => n.id === id)?.data.d as T;

/** Simula exportar: escribe el espejo y guarda el estado de sincronización en el proyecto. */
function exported(g: Graph) {
  const m = mirror(g, BASE);
  const vault = { ...m.files };
  const p = g.nodes.find((n) => n.id === 'project')!;
  p.data.d = { ...p.data.d, vault: syncState(BASE, m, Object.keys(m.files)) } as ProjectData;
  return { vault, m };
}

describe('espejo en Obsidian', () => {
  it('una nota por pieza, con propiedades, enlaces y canvas', () => {
    const { files, paths } = mirror(sample(), BASE);
    expect(paths.a).toBe('emede/tienda/agentes/revisor.md');
    expect(paths.c).toBe('emede/tienda/comandos/review.md');
    expect(paths.project).toBe('emede/tienda/tienda.md');
    expect(files[paths.a]).toContain('emede-id: a');
    expect(files[paths.a]).toContain('"[[emede/tienda/skills/deploy|deploy]]"');
    expect(files[paths.c]).toContain('[[emede/tienda/agentes/revisor|revisor]]');
    expect(files[paths.project]).toContain('%% emede: convenciones %%');
    expect(files['emede/tienda/plan.md']).toContain('- [ ] fase 1');
    const canvas = JSON.parse(files[paths.canvas]);
    expect(canvas.nodes).toHaveLength(6);
    expect(canvas.edges).toContainEqual(expect.objectContaining({ fromNode: 'a', toNode: 's' }));
  });

  it('nunca escribe secretos de MCP en el vault', () => {
    const { files, paths } = mirror(sample(), BASE);
    expect(files[paths.m]).not.toContain('ghp_secreto');
    expect(files[paths.m]).toContain('GITHUB_TOKEN=${GITHUB_TOKEN}');
  });

  it('la carpeta queda fija aunque se renombre el proyecto', () => {
    const g = sample();
    exported(g);
    (g.nodes[0].data.d as ProjectData).name = 'otro-nombre';
    expect(vaultBase(g, 'notas')).toBe(BASE);
  });
});

describe('traer cambios de Obsidian', () => {
  it('recién exportado no hay nada que traer', () => {
    const g = sample();
    const { vault } = exported(g);
    expect(planImport(g, BASE, vault)).toEqual([]);
  });

  it('aplica ediciones de texto, propiedades y enlaces', () => {
    const g = sample();
    const { vault, m } = exported(g);
    vault[m.paths.a] = vault[m.paths.a]
      .replace('Sos revisor.', 'Sos revisor. Corré npm test.')
      .replace('herramientas: [read, search]', 'herramientas: [read, search, bash]')
      .replace('usa: ["[[emede/tienda/skills/deploy|deploy]]"]', 'usa:\n  - "[[migrar]]"');
    vault[m.paths.project] = vault[m.paths.project].replace('- Usá tabs', '- Usá 2 espacios');

    const changes = planImport(g, BASE, vault);
    expect(changes.map((c) => c.key).sort()).toEqual(['update:a', 'update:project']);
    expect(changes.every((c) => !c.conflict)).toBe(true);

    const next = applyImport(g, BASE, changes, vault);
    expect(d<AgentData>(next, 'a').prompt).toBe('Sos revisor. Corré npm test.');
    expect(d<AgentData>(next, 'a').tools).toEqual(['read', 'search', 'bash']);
    expect(next.edges.filter((e) => e.source === 'a').map((e) => e.target)).toEqual(['s2']);
    expect(d<ProjectData>(next, 'project').conventions).toBe('- Usá 2 espacios');
    expect(d<ProjectData>(next, 'project').structure).toBe('src/ app');
    // Ya sincronizado: no se vuelve a proponer.
    expect(planImport(next, BASE, vault)).toEqual([]);
  });

  it('marca conflicto si la pieza cambió en los dos lados', () => {
    const g = sample();
    const { vault, m } = exported(g);
    vault[m.paths.s] = vault[m.paths.s].replace('1. npm run build', '1. npm run build:prod');
    (g.nodes.find((n) => n.id === 's')!.data.d as SkillData).instructions = '1. pnpm build';
    const [c] = planImport(g, BASE, vault);
    expect(c).toMatchObject({ key: 'update:s', conflict: true });
  });

  it('una nota nueva crea una pieza y no vuelve a aparecer después de exportar', () => {
    const g = sample();
    const { vault } = exported(g);
    vault['emede/tienda/skills/Revisar seguridad.md'] = '---\ndescripcion: Revisa secretos. Usar antes de cada PR.\n---\n\n1. Buscá tokens.';
    const changes = planImport(g, BASE, vault);
    expect(changes.map((c) => c.type)).toEqual(['create']);
    const next = applyImport(g, BASE, changes, vault);
    const created = next.nodes.find((n) => n.data.d.name === 'revisar-seguridad')!.data.d as SkillData;
    expect(created.instructions).toBe('1. Buscá tokens.');
    expect(planImport(next, BASE, vault)).toEqual([]);

    // Al exportar, la nota queda con el nombre del espejo y la original sobra.
    const m2 = mirror(next, BASE);
    expect(staleNotes(vault, m2, d<ProjectData>(next, 'project').vault)).toEqual(['emede/tienda/skills/Revisar seguridad.md']);
  });

  it('una nota borrada en Obsidian propone borrar la pieza', () => {
    const g = sample();
    const { vault, m } = exported(g);
    delete vault[m.paths.s2];
    const changes = planImport(g, BASE, vault);
    expect(changes).toEqual([expect.objectContaining({ key: 'delete:s2', type: 'delete' })]);
    expect(applyImport(g, BASE, changes, vault).nodes.some((n) => n.id === 's2')).toBe(false);
  });

  it('lo que no se aplica se vuelve a proponer', () => {
    const g = sample();
    const { vault, m } = exported(g);
    vault[m.paths.a] = vault[m.paths.a].replace('Sos revisor.', 'Otro prompt.');
    vault[m.paths.s] = vault[m.paths.s].replace('npm run build', 'npm run build -- --prod');
    const changes = planImport(g, BASE, vault);
    const next = applyImport(g, BASE, changes.filter((c) => c.nodeId === 'a'), vault);
    expect(planImport(next, BASE, vault).map((c) => c.key)).toEqual(['update:s']);
  });

  it('no deja pisar ediciones de Obsidian sin traerlas y no toca secretos al volver', () => {
    const g = sample();
    const { vault, m } = exported(g);
    vault[m.paths.m] = vault[m.paths.m].replace('comando: npx', 'comando: node');
    expect(unsyncedEdits(g, vault)).toEqual([m.paths.m]);
    const next = applyImport(g, BASE, planImport(g, BASE, vault), vault);
    expect(d<McpData>(next, 'm')).toMatchObject({ command: 'node', env: 'GITHUB_TOKEN=ghp_secreto123456789' });
  });
});

describe('vault como fuente', () => {
  it('junta las notas elegidas y, si se pide, las enlazadas', () => {
    const all = {
      'Proyectos/Tienda.md': 'Ver [[Decisiones]] y [[Stack|el stack]].',
      'Proyectos/Decisiones.md': 'Usamos Postgres.',
      'Stack.md': 'Next.js 15',
      'Otra.md': 'nada',
    };
    const text = collectNotes(all, ['Proyectos/Tienda.md'], true);
    expect(text).toContain('Usamos Postgres.');
    expect(text).toContain('Next.js 15');
    expect(text).not.toContain('nada');
    expect(collectNotes(all, ['Proyectos/Tienda.md'], false)).not.toContain('Postgres');
    expect(resolveLink('Decisiones', Object.keys(all))).toBe('Proyectos/Decisiones.md');
  });

  it('las huellas ignoran finales de línea de Windows', () => {
    expect(hash('a\r\nb\n')).toBe(hash('a\nb'));
  });
});
