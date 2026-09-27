import { t } from './i18n';
import type { Edge } from '@xyflow/react';
import type { FileOverride, FlowNode, Graph } from './store';
import type { Settings } from './types';
import { parseStack } from './stack';
import { defaultCanary, defaultGuards } from './defaults';
import type { UserPack } from './userTemplates';

/*
 * Persistencia de proyectos y ajustes en un archivo JSON.
 * - "file": el servidor local (npm run dev / npm start / app de escritorio) guarda en ~/.emede/emede.json.
 * - "browser": si no hay servidor (sitio estático), el mismo formato JSON se guarda en localStorage.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  stack: string[];
  counts: Record<'agent' | 'skill' | 'command' | 'rule' | 'mcp' | 'hook', number>;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectDoc {
  id: string;
  name: string;
  graph: Graph;
  fileOverrides: Record<string, FileOverride>;
  excluded: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface Backend {
  kind: 'file' | 'browser';
  /** Dónde viven los datos (ruta del archivo o descripción). */
  location: string;
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<ProjectDoc | null>;
  put(doc: ProjectDoc, opts?: { keepalive?: boolean }): Promise<void>;
  remove(id: string): Promise<void>;
  getSettings(): Promise<Partial<Settings>>;
  putSettings(s: Partial<Settings>): Promise<void>;
  importMany(docs: ProjectDoc[], settings?: Partial<Settings>): Promise<number>;
  /** Plantillas propias (compartidas entre todos los proyectos). */
  listTemplates(): Promise<UserPack[]>;
  putTemplate(p: UserPack): Promise<void>;
  removeTemplate(id: string): Promise<void>;
}

/* ---------- normalización (datos viejos o importados) ---------- */

/** Completa campos que agregaron versiones nuevas de la app. */
export function normalizeGraph(g: Graph): Graph {
  return {
    edges: (g.edges ?? []) as Edge[],
    nodes: (g.nodes ?? []).map((n): FlowNode => {
      const d = n.data.d as unknown as Record<string, unknown>;
      if (d.kind === 'project' && (!Array.isArray(d.stackItems) || !d.canary || !d.guards)) {
        const patch: Record<string, unknown> = {};
        if (!Array.isArray(d.stackItems)) Object.assign(patch, { stackItems: parseStack(String(d.stack ?? '')), stack: '' });
        // Proyectos anteriores al canario: se activa con una marca nueva (se puede apagar en el Inspector).
        if (!d.canary) patch.canary = defaultCanary();
        if (!d.guards) patch.guards = defaultGuards();
        return { ...n, data: { d: { ...n.data.d, ...patch } as FlowNode['data']['d'] } };
      }
      if (d.kind === 'mcp' && d.headers === undefined) return { ...n, data: { d: { ...n.data.d, headers: '' } as FlowNode['data']['d'] } };
      return n;
    }),
  };
}

const nameOf = (g: Graph) => g.nodes.find((n) => n.id === 'project')?.data.d.name || 'sin-nombre';

export function summarize(doc: ProjectDoc): ProjectSummary {
  const ds = doc.graph.nodes.map((n) => n.data.d);
  const p = ds.find((d) => d.kind === 'project');
  const count = (k: string) => ds.filter((d) => d.kind === k).length;
  return {
    id: doc.id, name: doc.name, createdAt: doc.createdAt ?? Date.now(), updatedAt: doc.updatedAt ?? Date.now(),
    description: p?.kind === 'project' ? p.description : '',
    stack: p?.kind === 'project' ? (p.stackItems ?? []).map((i) => i.label).slice(0, 8) : [],
    counts: { agent: count('agent'), skill: count('skill'), command: count('command'), rule: count('rule'), mcp: count('mcp'), hook: count('hook') },
  };
}

/* ---------- backend: servidor local ---------- */

/** El servidor que corre es de otra versión que la app: quedó abierto después de actualizar emede (ver server/codeId.ts). */
export async function serverOutdated(): Promise<boolean> {
  try {
    const health = (await (await fetch('/api/health')).json()) as { code?: string };
    return health.code !== __EMEDE_SERVER_CODE__;
  } catch {
    return false;
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  // 405: una ruta que el servidor no conoce, porque es de una versión anterior a la app.
  if (res.status === 405) throw new Error(t('app.serverOutdated'));
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? t('err.http', { status: res.status, path }));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function httpBackend(dataFile: string): Backend {
  return {
    kind: 'file',
    location: dataFile,
    list: () => http('/api/projects'),
    get: async (id) => {
      try {
        return await http<ProjectDoc>(`/api/projects/${id}`);
      } catch {
        return null;
      }
    },
    // keepalive: el navegador completa el guardado aunque la página se esté cerrando (límite ~64 KB).
    put: async (doc, opts) => void (await http(`/api/projects/${doc.id}`, { method: 'PUT', body: JSON.stringify(doc), keepalive: opts?.keepalive })),
    remove: async (id) => void (await http(`/api/projects/${id}`, { method: 'DELETE' })),
    getSettings: () => http('/api/settings'),
    putSettings: async (s) => void (await http('/api/settings', { method: 'PUT', body: JSON.stringify(s) })),
    importMany: async (projects, settings) =>
      (await http<{ added: number }>('/api/import', { method: 'POST', body: JSON.stringify({ projects, settings }) })).added,
    listTemplates: () => http('/api/templates'),
    putTemplate: async (p) => void (await http(`/api/templates/${p.id}`, { method: 'PUT', body: JSON.stringify(p) })),
    removeTemplate: async (id) => void (await http(`/api/templates/${id}`, { method: 'DELETE' })),
  };
}

/* ---------- backend: navegador (respaldo sin servidor) ---------- */

const BROWSER_KEY = 'emede-data';
interface BrowserData {
  version: 1;
  settings: Partial<Settings>;
  projects: Record<string, ProjectDoc>;
  templates?: Record<string, UserPack>;
}

export function browserBackend(): Backend {
  const read = (): BrowserData => {
    try {
      return { version: 1, settings: {}, projects: {}, ...JSON.parse(localStorage.getItem(BROWSER_KEY) ?? '{}') };
    } catch {
      return { version: 1, settings: {}, projects: {} };
    }
  };
  const write = (d: BrowserData) => localStorage.setItem(BROWSER_KEY, JSON.stringify(d));
  return {
    kind: 'browser',
    location: 'este navegador (localStorage)',
    list: async () => Object.values(read().projects).map(summarize).sort((a, b) => b.updatedAt - a.updatedAt),
    get: async (id) => read().projects[id] ?? null,
    put: async (doc) => {
      const d = read();
      const now = Date.now();
      d.projects[doc.id] = { ...doc, createdAt: d.projects[doc.id]?.createdAt ?? doc.createdAt ?? now, updatedAt: now };
      write(d);
    },
    remove: async (id) => {
      const d = read();
      delete d.projects[id];
      write(d);
    },
    getSettings: async () => read().settings,
    putSettings: async (s) => {
      const d = read();
      d.settings = { ...d.settings, ...s };
      write(d);
    },
    importMany: async (docs, settings) => {
      const d = read();
      let n = 0;
      for (const doc of docs) if (!d.projects[doc.id]) (d.projects[doc.id] = doc), n++;
      if (settings && !Object.keys(d.settings).length) d.settings = settings;
      write(d);
      return n;
    },
    listTemplates: async () => Object.values(read().templates ?? {}).sort((a, b) => b.updatedAt - a.updatedAt),
    putTemplate: async (p) => {
      const d = read();
      d.templates = { ...d.templates, [p.id]: { ...p, updatedAt: Date.now() } };
      write(d);
    },
    removeTemplate: async (id) => {
      const d = read();
      if (d.templates) delete d.templates[id];
      write(d);
    },
  };
}

/* ---------- arranque ---------- */

let backend: Backend | null = null;
export const storage = () => {
  if (!backend) throw new Error(t('err.storageNotReady'));
  return backend;
};
export const setBackend = (b: Backend) => {
  backend = b;
};

/** Usa el servidor local si responde; si no, el navegador. */
export async function initStorage(): Promise<Backend> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(t);
    const body = res.ok ? await res.json() : null;
    backend = body?.ok ? httpBackend(body.dataFile) : browserBackend();
  } catch {
    backend = browserBackend();
  }
  await migrateLegacy(backend);
  return backend;
}

/* ---------- migración desde versiones anteriores (localStorage) ---------- */

const LEGACY_STATE = 'emede-state';
const LEGACY_LIBRARY = 'emede-library';

/**
 * Las versiones anteriores guardaban el proyecto abierto y la biblioteca en localStorage.
 * Se pasan una sola vez al JSON y se dejan las claves viejas renombradas como respaldo.
 */
export async function migrateLegacy(b: Backend): Promise<number> {
  const docs = new Map<string, ProjectDoc>();
  let settings: Partial<Settings> | undefined;
  try {
    const lib = JSON.parse(localStorage.getItem(LEGACY_LIBRARY) ?? '{}') as Record<string, ProjectDoc & { updatedAt: number }>;
    for (const e of Object.values(lib)) if (e?.graph) docs.set(e.id, { ...e, graph: normalizeGraph(e.graph) });
    const st = JSON.parse(localStorage.getItem(LEGACY_STATE) ?? 'null')?.state as
      | { nodes?: FlowNode[]; edges?: Edge[]; settings?: Settings; projectId?: string; fileOverrides?: Record<string, FileOverride>; excluded?: string[] }
      | undefined;
    if (st?.nodes?.length) {
      const graph = normalizeGraph({ nodes: st.nodes, edges: st.edges ?? [] });
      const id = st.projectId ?? `legacy-${Date.now()}`;
      // El estado abierto es la versión más nueva de ese proyecto.
      docs.set(id, { id, name: nameOf(graph), graph, fileOverrides: st.fileOverrides ?? {}, excluded: st.excluded ?? [], updatedAt: Date.now() });
    }
    settings = st?.settings;
  } catch {
    return 0;
  }
  if (!docs.size && !settings) return 0;
  const added = await b.importMany([...docs.values()], settings);
  for (const k of [LEGACY_STATE, LEGACY_LIBRARY]) {
    const v = localStorage.getItem(k);
    if (v !== null) {
      localStorage.setItem(`${k}-migrado`, v);
      localStorage.removeItem(k);
    }
  }
  return added;
}
