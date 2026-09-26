import type { Graph } from './store';
import type { GenerateOptions } from './design';
import type { FileOverride } from './store';
import type { NodeData, NodeKind } from './types';
import { compareWith, expectedFiles, type FileCheck } from './cli/core';
import { importFromRepo } from './importers/repo';
import { memoryDir, readText, type DirHandle } from './fs';
import { stripHidden } from './sanitize';
import { slug, emptyData } from './defaults';
import { t } from './i18n';

/*
 * Traer al diseño los cambios hechos en el repo (a mano, por un agente, en otra rama…).
 * 1. Se comparan los archivos del repo con lo que generaría el diseño (igual que `emede check`).
 * 2. Los que cambiaron se leen con el importador y se comparan campo por campo con las piezas del diseño:
 *    una edición en .claude/agents/x.md actualiza el agente, y ese cambio llega a todas las plataformas.
 * 3. Lo que no corresponde a ningún campo (p. ej. .codex/config.toml editado a mano) se ofrece como
 *    "edición manual" del archivo, para que el próximo guardado no la pise.
 */

export interface RepoChange {
  key: string;
  type: 'update' | 'create' | 'file';
  label: string;
  /** Archivos del repo de los que sale el cambio. */
  paths: string[];
  /** Cómo está en el diseño / cómo está en el repo (para mostrar el diff). */
  before: string;
  after: string;
  /** Para piezas: aplica el cambio al grafo. */
  apply?: (g: Graph) => Graph;
  /** Para archivos: la edición manual a guardar. */
  override?: { path: string; value: FileOverride };
}

export interface RepoPull {
  changes: RepoChange[];
  /** Archivos del diseño que no están en la carpeta (¿todavía no se guardó?). */
  missing: string[];
  /** Cuántos archivos coinciden. */
  same: number;
}

/** Campos que se comparan por tipo. Se dejan afuera los que la conversión entre plataformas no conserva exactos
 *  (herramientas, modelo, variables de entorno de MCP). */
const FIELDS: Record<NodeKind, string[]> = {
  project: ['memory', 'plan'],
  agent: ['description', 'prompt'],
  skill: ['description', 'instructions'],
  command: ['description', 'argumentHint', 'prompt'],
  rule: ['content', 'globs'],
  mcp: ['command', 'args', 'url'],
};

const norm = (v: unknown) => String(v ?? '').replace(/\r\n/g, '\n').trim();
const fieldsText = (d: Record<string, unknown>, fields: string[]) =>
  fields.map((f) => `### ${f}\n${norm(d[f]) || '—'}`).join('\n\n');

const withPatch = (g: Graph, id: string, patch: Partial<NodeData>): Graph => ({
  ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, data: { d: { ...n.data.d, ...patch } as NodeData } } : n)),
});

export async function planRepoPull(graph: Graph, opts: GenerateOptions, dir: DirHandle): Promise<RepoPull> {
  const expected = expectedFiles(graph, opts);
  const checks: FileCheck[] = await compareWith(expected, (p) => readText(dir, p));
  const drifted = checks.filter((c) => c.status === 'changed');
  const changedFiles = Object.fromEntries(drifted.map((c) => [c.path, stripHidden(c.current ?? '')]));

  const changes: RepoChange[] = [];
  if (drifted.length) {
    const imported = (await importFromRepo(memoryDir(changedFiles))).graph;
    const current = graph.nodes;
    const findDesign = (kind: NodeKind, name: string) =>
      current.find((n) => n.data.d.kind === kind && (kind === 'project' || slug(n.data.d.name) === slug(name)));

    for (const n of imported.nodes) {
      const d = n.data.d;
      const mine = findDesign(d.kind, d.name);
      // El proyecto importado solo trae lo que salió de archivos que cambiaron: memoria y plan.
      const fields = d.kind === 'project'
        ? FIELDS.project.filter((f) => (f === 'memory' ? MEMORY_FILES.some((p) => p in changedFiles) : 'docs/PLAN.md' in changedFiles))
        : FIELDS[d.kind];
      if (!fields.length) continue;
      const theirs = d as unknown as Record<string, unknown>;

      if (!mine) continue;
      const ours = mine.data.d as unknown as Record<string, unknown>;
      const diff = fields.filter((f) => norm(ours[f]) !== norm(theirs[f]));
      if (!diff.length) continue;
      const patch = Object.fromEntries(diff.map((f) => [f, typeof theirs[f] === 'string' ? norm(theirs[f]) : theirs[f]])) as Partial<NodeData>;
      // Una regla con globs deja de aplicarse siempre (y al revés).
      if (d.kind === 'rule' && diff.includes('globs')) Object.assign(patch, { alwaysApply: !norm(theirs.globs) });
      changes.push({
        key: `update:${mine.id}`, type: 'update',
        label: mine.id === 'project' ? t('repo.projectMemory') : `${t(`kind.${d.kind}`)} ${mine.data.d.kind === 'command' ? '/' : ''}${mine.data.d.name}`,
        paths: [], before: fieldsText(ours, diff), after: fieldsText(theirs, diff),
        apply: (g) => withPatch(g, mine.id, patch),
      });
    }

    // Archivos que siguen distintos aun con todos los cambios de piezas aplicados: ediciones que no son de ningún campo.
    const afterAll = changes.reduce((g, c) => (c.apply ? c.apply(g) : g), graph);
    const regenerated = expectedFiles(afterAll, opts);
    const generatedNow = expectedFiles(afterAll, { ...opts, fileOverrides: {} });
    for (const c of drifted) {
      const repo = changedFiles[c.path];
      if (regenerated[c.path] === undefined || norm(regenerated[c.path]) === norm(repo)) continue;
      changes.push({
        key: `file:${c.path}`, type: 'file', label: c.path, paths: [c.path],
        before: regenerated[c.path], after: repo,
        override: { path: c.path, value: { content: repo, base: generatedNow[c.path] ?? '' } },
      });
    }
    // Qué archivos explican cada cambio de pieza (para mostrarlo).
    for (const ch of changes) {
      if (ch.type === 'file') continue;
      const next = expectedFiles(ch.apply!(graph), opts);
      ch.paths = drifted.map((c) => c.path).filter((p) => next[p] !== undefined && norm(next[p]) !== norm(expected[p]));
    }
  }
  // Piezas que están en el repo y no en el diseño (creadas a mano o por otra herramienta).
  const all = (await importFromRepo(dir)).graph;
  for (const n of all.nodes) {
    const d = n.data.d;
    if (d.kind === 'project' || graph.nodes.some((m) => m.data.d.kind === d.kind && slug(m.data.d.name) === slug(d.name))) continue;
    changes.push({
      key: `create:${d.kind}:${slug(d.name)}`, type: 'create', label: `${t(`kind.${d.kind}`)} ${d.kind === 'command' ? '/' : ''}${d.name}`,
      paths: [], before: '', after: fieldsText(d as unknown as Record<string, unknown>, FIELDS[d.kind]),
      apply: (g) => ({
        ...g,
        nodes: [...g.nodes, {
          id: `${d.kind}-${Math.random().toString(36).slice(2, 10)}`, type: 'card',
          position: { x: -900, y: 170 * g.nodes.length }, data: { d: { ...emptyData(d.kind), ...d } as NodeData },
        }],
      }),
    });
  }

  return {
    changes,
    missing: checks.filter((c) => c.status === 'missing').map((c) => c.path),
    same: checks.filter((c) => c.status === 'same').length,
  };
}

const MEMORY_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursor/rules/proyecto.mdc'];

/** Aplica los cambios elegidos: piezas al grafo, archivos como ediciones manuales. */
export function applyRepoPull(graph: Graph, chosen: RepoChange[]): { graph: Graph; overrides: RepoChange['override'][] } {
  return {
    graph: chosen.reduce((g, c) => (c.apply ? c.apply(g) : g), graph),
    overrides: chosen.filter((c) => c.override).map((c) => c.override),
  };
}
