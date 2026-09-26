import { initialGraph, uid, useStore, type Graph } from './store';
import { normalizeGraph, storage, type ProjectDoc } from './storage';
import { resolveMcp } from './generators/secrets';
import type { NodeData } from './types';
import { requestRepair } from './repair';
import { parseDesign, serializeDesign } from './design';
import { t } from './i18n';
import { commandsIn, commandsWarning } from './risky';

/* Operaciones sobre proyectos guardados en el JSON. */

const nameOf = (g: Graph) => g.nodes.find((n) => n.id === 'project')?.data.d.name || 'sin-nombre';

/** Documento del proyecto abierto, tal como se guarda. */
export function currentDoc(): ProjectDoc {
  const s = useStore.getState();
  return {
    id: s.projectId, name: nameOf(s), graph: { nodes: s.nodes, edges: s.edges },
    fileOverrides: s.fileOverrides, excluded: s.excluded,
  };
}

/** Guarda el proyecto abierto (si hay uno abierto en el editor). */
export async function saveCurrent(opts?: { keepalive?: boolean }): Promise<void> {
  if (useStore.getState().view !== 'editor') return;
  await storage().put(currentDoc(), opts);
}

export async function openProject(id: string): Promise<boolean> {
  const doc = await storage().get(id);
  if (!doc) return false;
  useStore.getState().loadProject({ ...doc, graph: normalizeGraph(doc.graph) });
  return true;
}

/** Crea un proyecto (vacío o a partir de un grafo), lo guarda y lo abre en el editor. */
export async function createProject(graph: Graph = initialGraph(), extra?: Partial<ProjectDoc>): Promise<string> {
  const g = normalizeGraph(structuredClone(graph));
  const doc: ProjectDoc = { id: uid(), name: nameOf(g), graph: g, fileOverrides: {}, excluded: [], ...extra };
  await storage().put(doc);
  useStore.getState().loadProject(doc);
  return doc.id;
}

export async function duplicateProject(id: string): Promise<void> {
  const doc = await storage().get(id);
  if (!doc) return;
  const graph = structuredClone(doc.graph);
  const p = graph.nodes.find((n) => n.id === 'project');
  if (p) p.data.d = { ...p.data.d, name: `${p.data.d.name}-copia` };
  await storage().put({ ...doc, id: uid(), name: nameOf(graph), graph, createdAt: undefined });
}

export async function deleteProject(id: string): Promise<void> {
  await storage().remove(id);
}

/** Guarda y vuelve al dashboard. */
export async function closeProject(): Promise<void> {
  await saveCurrent();
  useStore.getState().setView('dashboard');
}

/** Copia del diseño apta para compartir: los secretos de MCP quedan como referencias ${VAR}. */
export function exportable(g: Graph): Graph {
  return {
    edges: g.edges,
    nodes: g.nodes.map((n) => {
      const d = n.data.d;
      if (d.kind !== 'mcp') return n;
      const r = resolveMcp(d);
      const line = (x: { key: string; literal?: string; ref?: string; prefix?: string }) =>
        `${x.key}=${x.ref ? `${x.prefix ?? ''}\${${x.ref}}` : x.literal}`;
      return { ...n, data: { d: { ...d, env: r.env.map(line).join('\n'), headers: r.headers.map(line).join('\n') } as NodeData } };
    }),
  };
}

/** Descarga el proyecto abierto como .emede.json (sin secretos), con lo necesario para regenerarlo desde la CLI. */
export function downloadDesign(g: Graph) {
  const s = useStore.getState();
  const text = serializeDesign(exportable(g), {
    targets: s.settings.targets, lang: s.settings.lang, fileOverrides: s.fileOverrides, excluded: s.excluded,
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `${nameOf(g)}.emede.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Lee un .emede.json exportado. Los caracteres invisibles se quitan y se informa cuántos había. */
export async function readDesignFile(file: File): Promise<{ graph: Graph; hidden: number; warning: string }> {
  const { graph, hidden } = parseDesign(await file.text());
  return { graph, hidden, warning: hiddenWarning(hidden) + commandsWarning(commandsIn(graph.nodes.map((n) => n.data.d))) };
}

export const hiddenWarning = (n: number) => (n ? t('app.hiddenRemoved', { n }) : '');

/**
 * Aplica un diseño generado (por IA o desde un plan): en el editor reemplaza el lienzo (se puede deshacer);
 * desde el dashboard crea un proyecto nuevo con él.
 */
export async function applyDesign(graph: Graph): Promise<'current' | 'new'> {
  // Lo generado por IA se revisa y repara solo apenas está en el editor.
  requestRepair();
  if (useStore.getState().view === 'editor') {
    useStore.getState().setGraph(graph);
    return 'current';
  }
  await createProject(graph);
  return 'new';
}
