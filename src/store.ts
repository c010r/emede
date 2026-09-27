import { create } from 'zustand';
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react';
import type { NodeData, NodeKind, ProjectData, Settings, VaultSync } from './types';
import { emptyData, VALID_LINKS } from './defaults';

export type FlowNode = Node<{ d: NodeData }, 'card'>;

export interface Graph {
  nodes: FlowNode[];
  edges: Edge[];
}

/** Edición manual de un archivo generado. `base` es lo que generaba la app cuando se editó. */
export interface FileOverride {
  content: string;
  base: string;
}

interface State extends Graph {
  settings: Settings;
  selectedId: string | null;
  busy: Record<string, boolean>;
  /** Sube con cada cambio de contenido (no con mover nodos ni seleccionar): evita regenerar archivos al arrastrar. */
  contentVersion: number;
  /** Proyecto abierto dentro de la biblioteca local. */
  projectId: string;
  /** Pantalla visible: el dashboard de proyectos o el editor. Siempre arranca en el dashboard. */
  /** setup: pantalla de instalación (la primera vez, o desde Ajustes). */
  view: 'setup' | 'dashboard' | 'editor';
  setView: (v: 'setup' | 'dashboard' | 'editor') => void;
  fileOverrides: Record<string, FileOverride>;
  excluded: string[];
  past: Graph[];
  future: Graph[];

  onNodesChange: (c: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  onConnect: (c: Connection) => void;
  isValidLink: (source: string, target: string) => boolean;
  addNode: (kind: NodeKind, data?: Partial<NodeData>) => string;
  updateNode: (id: string, patch: Partial<NodeData>) => void;
  /** Varios cambios juntos (reparación): un solo paso de deshacer. */
  patchNodes: (patches: { id: string; patch: Partial<NodeData> }[], add?: FlowNode[], remove?: string[]) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  select: (id: string | null) => void;
  setGraph: (g: Graph) => void;
  /** Registra lo sincronizado con el vault sin sumar un paso de deshacer (lo hace el guardado automático). */
  setVaultSync: (vault: VaultSync) => void;
  autoLayout: () => void;
  undo: () => void;
  redo: () => void;
  setSettings: (s: Partial<Settings>) => void;
  setBusy: (id: string, v: boolean) => void;
  setOverride: (path: string, o: FileOverride | null) => void;
  toggleExcluded: (path: string) => void;
  loadProject: (p: { id: string; graph: Graph; fileOverrides?: Record<string, FileOverride>; excluded?: string[] }) => void;
}

/**
 * Funciones de React Flow que usan los cambios del lienzo. Las registra el editor al cargarse
 * (setFlowOps) para que la librería no entre en el bundle inicial: sin editor no hay lienzo que las dispare.
 */
type FlowOps = Pick<typeof import('@xyflow/react'), 'addEdge' | 'applyEdgeChanges' | 'applyNodeChanges'>;
let flowOps: FlowOps | null = null;
export const setFlowOps = (ops: FlowOps) => {
  flowOps = ops;
};
const flow = () => {
  if (!flowOps) throw new Error('React Flow no está cargado: falta setFlowOps()');
  return flowOps;
};

export const uid = () => Math.random().toString(36).slice(2, 10);

export const initialGraph = (): Graph => ({
  nodes: [{ id: 'project', type: 'card', position: { x: 0, y: 0 }, deletable: false, data: { d: emptyData('project') } }],
  edges: [],
});

const kindOf = (nodes: FlowNode[], id: string) => nodes.find((n) => n.id === id)?.data.d.kind;

/* ---------- ubicación de nodos ---------- */

const COLUMN: Record<NodeKind, number> = { command: -420, rule: -420, project: 0, mcp: 0, agent: 420, skill: 840 };
const ROW = 170;

/** Primer hueco libre en la columna del tipo, para que los nodos nuevos no queden encimados. */
export function freeSpot(nodes: FlowNode[], kind: NodeKind) {
  const x = COLUMN[kind];
  const ys = nodes.filter((n) => Math.abs(n.position.x - x) < 200).map((n) => n.position.y);
  let y = kind === 'mcp' ? 2 * ROW : 0;
  while (ys.some((v) => Math.abs(v - y) < ROW - 20)) y += ROW;
  return { x, y };
}

/** Reacomoda todo en columnas: comandos y reglas | proyecto y MCP | agentes | skills. */
export function layout(nodes: FlowNode[]): FlowNode[] {
  const order: NodeKind[] = ['project', 'mcp', 'command', 'rule', 'agent', 'skill'];
  const sorted = [...nodes].sort((a, b) => order.indexOf(a.data.d.kind) - order.indexOf(b.data.d.kind));
  const nextY = new Map<number, number>();
  const lastKind = new Map<number, NodeKind>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of sorted) {
    const kind = n.data.d.kind;
    const x = COLUMN[kind];
    let y = nextY.get(x) ?? 0;
    // Respiro entre tipos que comparten columna (comandos/reglas, proyecto/MCP).
    if (lastKind.has(x) && lastKind.get(x) !== kind) y += 60;
    pos.set(n.id, { x, y });
    nextY.set(x, y + ROW);
    lastKind.set(x, kind);
  }
  return nodes.map((n) => ({ ...n, position: pos.get(n.id)! }));
}

/* ---------- historial ---------- */

const HISTORY_LIMIT = 100;
let lastCheckpoint = { key: '', at: 0 };
let dragging = false;

export const useStore = create<State>()((set, get) => {
  /**
   * Guarda el estado actual antes de un cambio. Con `key`, los cambios seguidos sobre lo mismo
   * (tipear en un campo) se agrupan en un solo paso de deshacer.
   */
  const checkpoint = (key = '') => {
    const now = Date.now();
    if (key && key === lastCheckpoint.key && now - lastCheckpoint.at < 1500) {
      lastCheckpoint.at = now;
      return;
    }
    lastCheckpoint = { key, at: now };
    const { nodes, edges, past } = get();
    set({ past: [...past, { nodes, edges }].slice(-HISTORY_LIMIT), future: [] });
  };
  const bump = () => ({ contentVersion: get().contentVersion + 1 });

  return {
    ...initialGraph(),
    selectedId: 'project',
    busy: {},
    contentVersion: 0,
    projectId: uid(),
    view: 'dashboard',
    setView: (view) => set({ view }),
    fileOverrides: {},
    excluded: [],
    past: [],
    future: [],
    settings: { provider: 'gemini', keys: {}, models: {}, lang: 'es', targets: ['claude', 'opencode', 'codex'] },

    onNodesChange: (c) => {
      const structural = c.some((x) => x.type === 'remove' || x.type === 'add' || x.type === 'replace');
      const drag = c.find((x) => x.type === 'position');
      if (drag?.type === 'position') {
        if (drag.dragging && !dragging) checkpoint();
        dragging = !!drag.dragging;
      }
      if (structural) checkpoint();
      set({ nodes: flow().applyNodeChanges(c, get().nodes), ...(structural ? bump() : {}) });
    },
    onEdgesChange: (c) => {
      const structural = c.some((x) => x.type === 'remove' || x.type === 'add' || x.type === 'replace');
      if (structural) checkpoint();
      set({ edges: flow().applyEdgeChanges(c, get().edges), ...(structural ? bump() : {}) });
    },
    isValidLink: (source, target) => {
      const { nodes } = get();
      const a = kindOf(nodes, source), b = kindOf(nodes, target);
      return VALID_LINKS.some(([x, y]) => x === a && y === b);
    },
    onConnect: (c) => {
      if (!c.source || !c.target || !get().isValidLink(c.source, c.target)) return;
      checkpoint();
      set({ edges: flow().addEdge({ ...c, animated: true }, get().edges), ...bump() });
    },

    addNode: (kind, data) => {
      checkpoint();
      const id = `${kind}-${uid()}`;
      const node: FlowNode = {
        id, type: 'card', position: freeSpot(get().nodes, kind),
        data: { d: { ...emptyData(kind), ...data } as NodeData },
      };
      set({ nodes: [...get().nodes, node], selectedId: id, ...bump() });
      return id;
    },
    updateNode: (id, patch) => {
      checkpoint(`edit:${id}:${Object.keys(patch).sort().join(',')}`);
      set({
        nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { d: { ...n.data.d, ...patch } as NodeData } } : n)),
        ...bump(),
      });
    },
    patchNodes: (patches, add = [], remove = []) => {
      if (!patches.length && !add.length && !remove.length) return;
      checkpoint();
      lastCheckpoint = { key: '', at: 0 };
      const byId = new Map<string, Partial<NodeData>>();
      for (const p of patches) byId.set(p.id, { ...byId.get(p.id), ...p.patch });
      const drop = new Set(remove.filter((id) => id !== 'project'));
      set({
        nodes: [
          ...get().nodes.filter((n) => !drop.has(n.id))
            .map((n) => (byId.has(n.id) ? { ...n, data: { d: { ...n.data.d, ...byId.get(n.id) } as NodeData } } : n)),
          ...add,
        ],
        edges: get().edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)),
        selectedId: drop.has(get().selectedId ?? '') ? 'project' : get().selectedId,
        ...bump(),
      });
    },
    removeNode: (id) => {
      if (id === 'project') return;
      checkpoint();
      set({
        nodes: get().nodes.filter((n) => n.id !== id),
        edges: get().edges.filter((e) => e.source !== id && e.target !== id),
        selectedId: get().selectedId === id ? null : get().selectedId,
        ...bump(),
      });
    },
    removeEdge: (id) => {
      checkpoint();
      set({ edges: get().edges.filter((e) => e.id !== id), ...bump() });
    },
    select: (id) => set({ selectedId: id }),
    setGraph: (g) => {
      checkpoint();
      set({ nodes: g.nodes, edges: g.edges, selectedId: 'project', ...bump() });
    },
    setVaultSync: (vault) => {
      // También en el historial: deshacer una edición no tiene que olvidar qué notas ya están en el vault.
      const withVault = (nodes: FlowNode[]) =>
        nodes.map((n) => (n.id === 'project' ? { ...n, data: { d: { ...(n.data.d as ProjectData), vault } } } : n));
      const { nodes, past, future } = get();
      set({
        nodes: withVault(nodes),
        past: past.map((x) => ({ ...x, nodes: withVault(x.nodes) })),
        future: future.map((x) => ({ ...x, nodes: withVault(x.nodes) })),
        ...bump(),
      });
    },
    autoLayout: () => {
      checkpoint();
      set({ nodes: layout(get().nodes) });
    },
    undo: () => {
      const { past, future, nodes, edges, selectedId } = get();
      const prev = past.at(-1);
      if (!prev) return;
      lastCheckpoint = { key: '', at: 0 };
      set({
        ...prev, past: past.slice(0, -1), future: [{ nodes, edges }, ...future],
        selectedId: prev.nodes.some((n) => n.id === selectedId) ? selectedId : 'project', ...bump(),
      });
    },
    redo: () => {
      const { past, future, nodes, edges, selectedId } = get();
      const next = future[0];
      if (!next) return;
      lastCheckpoint = { key: '', at: 0 };
      set({
        ...next, future: future.slice(1), past: [...past, { nodes, edges }],
        selectedId: next.nodes.some((n) => n.id === selectedId) ? selectedId : 'project', ...bump(),
      });
    },
    setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
    setBusy: (id, v) => set({ busy: { ...get().busy, [id]: v } }),
    setOverride: (path, o) => {
      const next = { ...get().fileOverrides };
      if (o) next[path] = o;
      else delete next[path];
      set({ fileOverrides: next });
    },
    toggleExcluded: (path) => {
      const ex = get().excluded;
      set({ excluded: ex.includes(path) ? ex.filter((p) => p !== path) : [...ex, path] });
    },
    loadProject: (p) => {
      lastCheckpoint = { key: '', at: 0 };
      set({
        projectId: p.id, nodes: p.graph.nodes, edges: p.graph.edges, fileOverrides: p.fileOverrides ?? {},
        excluded: p.excluded ?? [], past: [], future: [], selectedId: 'project', view: 'editor', ...bump(),
      });
    },
  };
});

/* ---------- consultas sobre el grafo ---------- */

export function dataOf<K extends NodeKind>(nodes: FlowNode[], kind: K) {
  return nodes
    .filter((n) => n.data.d.kind === kind)
    .map((n) => ({ id: n.id, ...(n.data.d as Extract<NodeData, { kind: K }>) }));
}

export function linked(g: Graph, fromId: string, kind: NodeKind) {
  const ids = g.edges.filter((e) => e.source === fromId).map((e) => e.target);
  return g.nodes.filter((n) => ids.includes(n.id) && n.data.d.kind === kind).map((n) => n.data.d);
}

export function linkedFrom(g: Graph, toId: string, kind: NodeKind) {
  const ids = g.edges.filter((e) => e.target === toId).map((e) => e.source);
  return g.nodes.filter((n) => ids.includes(n.id) && n.data.d.kind === kind).map((n) => n.data.d);
}
