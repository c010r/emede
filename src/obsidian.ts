import { ct } from './generators/content';
import { t } from './i18n';
import type { Lang } from './i18n/langs';
import type { Edge } from '@xyflow/react';
import type { FlowNode, Graph } from './store';
import { emptyData, KIND_META, slug, VALID_LINKS } from './defaults';
import { assignNames, frontmatter } from './generators';
import { resolveMcp } from './generators/secrets';
import { parseFrontmatter, str, strList } from './importers/parse';
import { stripHidden, stripHiddenDeep } from './sanitize';
import { TOOLS, type FileMap, type NodeData, type NodeKind, type ProjectData, type Tool, type VaultSync } from './types';

/*
 * Espejo del proyecto en un vault de Obsidian.
 * - Una nota por pieza, con propiedades (frontmatter) y enlaces [[…]] a las piezas que usa: se recorre con el grafo de Obsidian.
 * - Un .canvas igual al lienzo de emede.
 * - Ida y vuelta: las notas editadas en Obsidian se leen de nuevo. Las huellas guardadas al sincronizar
 *   distinguen qué cambió en Obsidian, qué cambió en emede y qué cambió en los dos lados.
 * Los secretos de MCP nunca se escriben (el vault puede sincronizarse a la nube): quedan como referencias.
 */

export const DEFAULT_VAULT_FOLDER = 'emede';

const TIPO: Record<NodeKind, string> = { project: 'proyecto', agent: 'agente', skill: 'skill', command: 'comando', rule: 'regla', mcp: 'mcp' };
const FOLDER: Record<Exclude<NodeKind, 'project'>, string> = { agent: 'agentes', skill: 'skills', command: 'comandos', rule: 'reglas', mcp: 'mcp' };
const KIND_BY_FOLDER = Object.fromEntries(Object.entries(FOLDER).map(([k, f]) => [f, k])) as Record<string, Exclude<NodeKind, 'project'>>;

/** Secciones extra de la nota del proyecto (la memoria es el cuerpo principal). */
const PROJECT_SECTIONS = [['estructura', 'structure'], ['convenciones', 'conventions']] as const;
const marker = (name: string) => `%% emede: ${name} %%`;

/** Huella corta del contenido (FNV-1a), para saber si una nota cambió desde la última sincronización. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of norm(s)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
const norm = (s: string) => s.replace(/\r\n/g, '\n').trim();

const projectOf = (g: Graph) => g.nodes.find((n) => n.id === 'project')!.data.d as ProjectData;

/** Carpeta del proyecto dentro del vault: la de la última sincronización, o <carpeta>/<proyecto>. */
export const vaultBase = (g: Graph, folder = DEFAULT_VAULT_FOLDER) =>
  projectOf(g).vault?.path || `${(folder.trim() || DEFAULT_VAULT_FOLDER).replace(/^\/+|\/+$/g, '')}/${slug(projectOf(g).name)}`;

/* ---------- emede → Obsidian ---------- */

export interface Mirror {
  files: FileMap;
  /** Ruta de la nota de cada pieza (id del nodo, "plan", "canvas"). */
  paths: Record<string, string>;
}

const link = (path: string, name: string) => `[[${path.replace(/\.md$/, '')}|${name}]]`;

export function mirror(g: Graph, base: string, lang: Lang = 'es'): Mirror {
  const names = assignNames(g);
  const p = projectOf(g);
  const paths: Record<string, string> = {};
  for (const n of g.nodes) {
    const kind = n.data.d.kind;
    paths[n.id] = kind === 'project' ? `${base}/${slug(p.name)}.md` : `${base}/${FOLDER[kind]}/${names.get(n.id) ?? slug(n.data.d.name)}.md`;
  }
  if (p.plan?.trim()) paths.plan = `${base}/plan.md`;
  paths.canvas = `${base}/${slug(p.name)}.canvas`;

  const nameOf = (id: string) => g.nodes.find((n) => n.id === id)!.data.d.name;
  const uses = (id: string) => g.edges.filter((e) => e.source === id && paths[e.target]).map((e) => link(paths[e.target], nameOf(e.target)));

  const files: FileMap = {};
  for (const n of g.nodes) files[paths[n.id]] = noteText(n, uses(n.id), g, paths, lang);
  if (paths.plan) files[paths.plan] = frontmatter({ 'emede-id': 'plan', 'emede-tipo': 'plan', proyecto: link(paths.project, p.name) }) + norm(p.plan!) + '\n';
  files[paths.canvas] = canvas(g, paths);
  // Lo que se escribe en el vault pasa por la sanitización, como todo lo generado.
  for (const p of Object.keys(files)) files[p] = stripHidden(files[p]);
  return { files, paths };
}

function noteText(n: FlowNode, uses: string[], g: Graph, paths: Record<string, string>, lang: Lang): string {
  const d = n.data.d;
  const head = { 'emede-id': n.id, 'emede-tipo': TIPO[d.kind] };
  const tags = [`emede/${TIPO[d.kind]}`];
  const body = (s: string) => (norm(s) ? `${norm(s)}\n` : '');
  switch (d.kind) {
    case 'project': {
      const pieces = g.nodes.filter((x) => x.id !== 'project').map((x) => link(paths[x.id], x.data.d.name));
      const sections = PROJECT_SECTIONS.filter(([, f]) => norm(d[f])).map(([name, f]) => `\n${marker(name)}\n${norm(d[f])}\n`).join('');
      return frontmatter({
        ...head, descripcion: d.description, dev: d.dev, build: d.build, test: d.test, lint: d.lint,
        stack: (d.stackItems ?? []).map((i) => (i.version ? `${i.label} ${i.version}` : i.label)), piezas: pieces, tags,
      }) + body(d.memory) + sections;
    }
    case 'agent':
      return frontmatter({ ...head, descripcion: d.description, modelo: d.model, herramientas: d.tools, usa: uses, tags }) + body(d.prompt);
    case 'skill':
      return frontmatter({ ...head, descripcion: d.description, tags }) + body(d.instructions);
    case 'command':
      return frontmatter({ ...head, descripcion: d.description, argumentos: d.argumentHint, usa: uses, tags }) + body(d.prompt);
    case 'rule':
      return frontmatter({ ...head, descripcion: d.description, siempre: d.alwaysApply, globs: d.globs, tags }) + body(d.content);
    case 'mcp': {
      const r = resolveMcp(d);
      const line = (x: { key: string; literal?: string; ref?: string; prefix?: string }) => `${x.key}=${x.ref ? `${x.prefix ?? ''}\${${x.ref}}` : x.literal}`;
      return frontmatter({
        ...head, transporte: d.transport, comando: d.command, args: d.args, url: d.url,
        entorno: r.env.map(line), encabezados: r.headers.map(line), tags,
      }) + `${ct(lang, 'mcpVaultNote')}\n`;
    }
  }
}

/** Obsidian Canvas (formato JSON Canvas): una tarjeta por nota y las mismas flechas que en emede. */
function canvas(g: Graph, paths: Record<string, string>): string {
  const nodes = g.nodes.map((n) => ({
    id: n.id, type: 'file', file: paths[n.id],
    x: Math.round(n.position.x), y: Math.round(n.position.y), width: 300, height: 140, color: KIND_META[n.data.d.kind].color,
  }));
  const edges = g.edges.filter((e) => paths[e.source] && paths[e.target]).map((e) => ({
    id: e.id, fromNode: e.source, fromSide: 'right', toNode: e.target, toSide: 'left',
  }));
  return JSON.stringify({ nodes, edges }, null, 2) + '\n';
}

/** Estado de sincronización después de escribir (o leer) estas notas. */
export function syncState(base: string, m: Mirror, written: string[], prev?: VaultSync): VaultSync {
  const notes = { ...(prev?.path === base ? prev.notes : {}) };
  for (const [id, path] of Object.entries(m.paths)) {
    if (!written.includes(path)) continue;
    const h = hash(m.files[path]);
    notes[id] = { path, vault: h, emede: h };
  }
  return { path: base, notes };
}

/** La pieza tiene nombre propio (no el que se pone por defecto al crearla, como "nuevo-agente"). */
export const hasOwnName = (d: NodeData) => !!d.name.trim() && d.name !== emptyData(d.kind).name;

/**
 * Notas que no coinciden con lo último guardado en el vault: nuevas, cambiadas o renombradas en emede,
 * y las de piezas borradas. Las piezas sin nombre propio no cuentan (todavía no se guardan).
 */
export function pendingNotes(g: Graph, base: string, lang: Lang = 'es'): string[] {
  const m = mirror(g, base, lang);
  const sync = projectOf(g).vault;
  const notes = sync?.path === base ? sync.notes : {};
  const data = new Map(g.nodes.map((n) => [n.id, n.data.d]));
  const out = new Set<string>();
  for (const [id, path] of Object.entries(m.paths)) {
    if (data.has(id) && !hasOwnName(data.get(id)!)) continue;
    const r = notes[id];
    if (!r || r.path !== path || r.emede !== hash(m.files[path])) out.add(path);
  }
  for (const [id, r] of Object.entries(notes)) if (!m.paths[id]) out.add(r.path);
  return [...out];
}

/* ---------- Obsidian → emede ---------- */

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/** Destinos de los [[enlaces]] de un texto o una lista de propiedades. */
export const wikiTargets = (v: unknown): string[] =>
  [...(Array.isArray(v) ? v.map(str).join('\n') : str(v)).matchAll(WIKILINK)].map((m) => m[1].trim());

const basename = (p: string) => p.split('/').at(-1)!.replace(/\.md$/, '');

/** Resuelve un enlace como lo hace Obsidian: ruta exacta o, si no, nombre de archivo. */
export function resolveLink(target: string, files: string[]): string | undefined {
  const t = target.replace(/\.md$/, '');
  return files.find((f) => f.replace(/\.md$/, '') === t) ?? files.find((f) => basename(f) === basename(t));
}

/** Lee el cuerpo de la nota del proyecto: memoria y secciones marcadas. */
function projectBody(body: string): Record<string, string> {
  const out: Record<string, string> = { memory: '' };
  const parts = body.split(/^%% emede: (\w+) %%$/m);
  out.memory = norm(parts[0]);
  for (let i = 1; i < parts.length; i += 2) {
    const field = PROJECT_SECTIONS.find(([name]) => name === parts[i])?.[1];
    if (field) out[field] = norm(parts[i + 1] ?? '');
  }
  for (const [, f] of PROJECT_SECTIONS) out[f] ??= '';
  return out;
}

/** Campos de la pieza según la nota. No toca lo que la nota no representa (secretos de MCP, stack con versiones). */
export function notePatch(kind: NodeKind, text: string): Partial<NodeData> {
  const { data, body } = parseFrontmatter(stripHidden(text));
  const desc = str(data.descripcion);
  switch (kind) {
    case 'project':
      return { description: desc, dev: str(data.dev), build: str(data.build), test: str(data.test), lint: str(data.lint), ...projectBody(body) } as Partial<ProjectData>;
    case 'agent': {
      const model = str(data.modelo);
      return {
        description: desc, prompt: body,
        tools: strList(data.herramientas).map((t) => t.toLowerCase()).filter((t): t is Tool => (TOOLS as readonly string[]).includes(t)),
        ...(['inherit', 'fast', 'balanced', 'powerful'].includes(model) ? { model } : {}),
      } as Partial<NodeData>;
    }
    case 'skill': return { description: desc, instructions: body } as Partial<NodeData>;
    case 'command': return { description: desc, argumentHint: str(data.argumentos), prompt: body } as Partial<NodeData>;
    case 'rule': return { description: desc, globs: str(data.globs), alwaysApply: data.siempre !== false, content: body } as Partial<NodeData>;
    case 'mcp': {
      const transport = str(data.transporte) === 'http' ? 'http' : 'stdio';
      return { transport, command: str(data.comando), args: str(data.args), url: str(data.url) } as Partial<NodeData>;
    }
  }
}

export interface VaultChange {
  key: string;
  /** Pieza afectada (para las nuevas, el id que va a tener). */
  nodeId: string;
  type: 'update' | 'create' | 'delete';
  label: string;
  path: string;
  /** Nota como la generaría emede hoy. */
  before: string;
  /** Nota en el vault. */
  after: string;
  /** También cambió en emede desde la última sincronización: elegir con cuidado. */
  conflict: boolean;
  apply: (g: Graph) => Graph;
}

const withNode = (g: Graph, id: string, patch: Partial<NodeData>): Graph => ({
  ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, data: { d: { ...n.data.d, ...patch } as NodeData } } : n)),
});

/** Reemplaza las conexiones que salen de `source` por las de la propiedad `usa` de la nota. */
function withLinks(g: Graph, source: string, text: string, notes: Record<string, string>, idByPath: Map<string, string>): Graph {
  const { data } = parseFrontmatter(text);
  const kindOf = (id: string) => g.nodes.find((n) => n.id === id)?.data.d.kind;
  const targets = wikiTargets(data.usa)
    .map((t) => resolveLink(t, Object.keys(notes)))
    .map((p) => (p ? idByPath.get(p) : undefined))
    .filter((id): id is string => !!id && VALID_LINKS.some(([a, b]) => a === kindOf(source) && b === kindOf(id)));
  const kept = g.edges.filter((e) => e.source !== source);
  const added: Edge[] = [...new Set(targets)].map((t) => ({ id: `e-${source}-${t}`, source, target: t, animated: true }));
  return { ...g, edges: [...kept, ...added] };
}

/**
 * Compara el vault con el proyecto y devuelve los cambios hechos en Obsidian desde la última sincronización.
 * `notes` son los archivos de la carpeta del proyecto en el vault (ruta → texto).
 */
export function planImport(g: Graph, base: string, notes: Record<string, string>, lang: Lang = 'es'): VaultChange[] {
  const sync = projectOf(g).vault;
  const current = mirror(g, base, lang);
  const changes: VaultChange[] = [];
  const idByPath = new Map<string, string>();
  const byId = new Map<string, string>();
  const clean: Record<string, string> = {};
  for (const [path, raw] of Object.entries(notes)) {
    if (!path.endsWith('.md')) continue;
    const text = stripHidden(raw);
    clean[path] = text;
    const id = str(parseFrontmatter(text).data['emede-id']);
    if (id) byId.set(id, path);
  }
  // Notas creadas en Obsidian (sin emede-id) que ya se trajeron antes: se reconocen por su ruta.
  for (const [id, r] of Object.entries(sync?.notes ?? {})) if (!byId.has(id) && clean[r.path] !== undefined) byId.set(id, r.path);
  const known = new Set(byId.values());

  // Ids de piezas nuevas (creadas en Obsidian), para poder resolver enlaces hacia ellas.
  const fresh = new Map<string, { id: string; kind: Exclude<NodeKind, 'project'> }>();
  for (const path of Object.keys(clean)) {
    const { data } = parseFrontmatter(clean[path]);
    if (str(data['emede-id']) || known.has(path)) continue;
    const kind = KIND_BY_FOLDER[path.slice(base.length + 1).split('/')[0]];
    if (kind && path.split('/').length === base.split('/').length + 2)
      fresh.set(path, { id: `${kind}-${hash(path)}`, kind });
  }
  for (const [id, path] of byId) idByPath.set(path, id);
  for (const [path, f] of fresh) idByPath.set(path, f.id);

  const label = (d: NodeData) => `${t(`kind.${d.kind}`)} ${d.kind === 'command' ? '/' : ''}${d.name}`;

  for (const n of g.nodes) {
    const path = byId.get(n.id);
    const rec = sync?.notes[n.id];
    const before = current.files[current.paths[n.id]];
    if (!path) {
      if (rec && n.id !== 'project')
        changes.push({
          key: `delete:${n.id}`, nodeId: n.id, type: 'delete', label: label(n.data.d), path: rec.path, before, after: '', conflict: hash(before) !== rec.emede,
          apply: (x) => ({ nodes: x.nodes.filter((y) => y.id !== n.id), edges: x.edges.filter((e) => e.source !== n.id && e.target !== n.id) }),
        });
      continue;
    }
    const after = clean[path];
    if (rec && hash(after) === rec.vault) continue; // no se tocó en Obsidian
    if (norm(after) === norm(before)) continue;
    const kind = n.data.d.kind;
    const renamed = slug(basename(path));
    changes.push({
      key: `update:${n.id}`, nodeId: n.id, type: 'update', label: label(n.data.d), path, before, after,
      conflict: !!rec && hash(before) !== rec.emede,
      apply: (x) => {
        const patch = { ...notePatch(kind, after), ...(renamed !== slug(n.data.d.name) ? { name: renamed } : {}) };
        const y = withNode(x, n.id, stripHiddenDeep(patch));
        return kind === 'agent' || kind === 'command' ? withLinks(y, n.id, after, clean, idByPath) : y;
      },
    });
  }

  for (const [path, f] of fresh) {
    const after = clean[path];
    const name = slug(basename(path));
    changes.push({
      key: `create:${path}`, nodeId: f.id, type: 'create', label: t('obs.newNote', { kind: t(`kind.${f.kind}`), name }), path, before: '', after, conflict: false,
      apply: (x) => {
        const d = { ...emptyData(f.kind), ...stripHiddenDeep(notePatch(f.kind, after)), name } as NodeData;
        const y: Graph = { ...x, nodes: [...x.nodes, { id: f.id, type: 'card', position: { x: -900, y: 170 * x.nodes.length }, data: { d } }] };
        return f.kind === 'agent' || f.kind === 'command' ? withLinks(y, f.id, after, clean, idByPath) : y;
      },
    });
  }

  const planPath = byId.get('plan');
  if (planPath) {
    const after = clean[planPath];
    const rec = sync?.notes.plan;
    const plan = parseFrontmatter(after).body;
    const beforePlan = current.paths.plan ? current.files[current.paths.plan] : '';
    if ((!rec || hash(after) !== rec.vault) && norm(plan) !== norm(projectOf(g).plan ?? ''))
      changes.push({
        key: 'update:plan', nodeId: 'plan', type: 'update', label: t('obs.planNote'), path: planPath, before: beforePlan, after,
        conflict: !!rec && hash(beforePlan) !== rec.emede,
        apply: (x) => withNode(x, 'project', { plan } as Partial<ProjectData>),
      });
  }
  return changes;
}

/** Posiciones del .canvas de Obsidian (si se reacomodaron las tarjetas allá). */
export function canvasPositions(text: string | undefined, idByFile: Record<string, string>): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  try {
    const c = JSON.parse(text ?? '') as { nodes?: { id: string; file?: string; x: number; y: number }[] };
    for (const n of c.nodes ?? []) {
      const id = (n.file && idByFile[n.file]) || n.id;
      if (Number.isFinite(n.x) && Number.isFinite(n.y)) out.set(id, { x: n.x, y: n.y });
    }
  } catch { /* canvas ausente o inválido: se ignora */ }
  return out;
}

/**
 * Aplica los cambios elegidos y deja registrado el nuevo estado de sincronización.
 * Solo se marca como sincronizado lo aplicado y lo que no tenía cambios: lo que se dejó sin aplicar
 * se vuelve a proponer la próxima vez.
 */
export function applyImport(g: Graph, base: string, chosen: VaultChange[], notes: Record<string, string>, lang: Lang = 'es'): Graph {
  const proposed = new Set(planImport(g, base, notes, lang).map((c) => c.nodeId));
  const applied = new Set(chosen.map((c) => c.nodeId));
  let next = chosen.reduce((x, c) => c.apply(x), g);
  const prev = projectOf(g).vault;

  // Ruta en el vault de cada pieza: por emede-id, por la ruta de las nuevas o por la sincronización anterior.
  const pathById = new Map<string, string>();
  for (const [p, t] of Object.entries(notes)) {
    const id = p.endsWith('.md') ? str(parseFrontmatter(t).data['emede-id']) : '';
    if (id) pathById.set(id, p);
  }
  for (const c of chosen) if (c.type === 'create') pathById.set(c.nodeId, c.path);
  for (const [id, r] of Object.entries(prev?.notes ?? {})) if (!pathById.has(id) && notes[r.path] !== undefined) pathById.set(id, r.path);

  const canvasPath = prev?.notes.canvas?.path ?? mirror(g, base, lang).paths.canvas;
  const canvasText = notes[canvasPath];
  if (canvasText !== undefined && hash(canvasText) !== prev?.notes.canvas?.vault) {
    const idByFile = Object.fromEntries([...pathById].map(([id, p]) => [p, id]));
    const pos = canvasPositions(canvasText, idByFile);
    next = { ...next, nodes: next.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)) };
  }

  const after = mirror(next, base, lang);
  const state: VaultSync['notes'] = { ...(prev?.path === base ? prev.notes : {}) };
  for (const [id, path] of pathById) {
    if (!after.paths[id] || (proposed.has(id) && !applied.has(id))) continue;
    state[id] = { path, vault: hash(notes[path]), emede: hash(after.files[after.paths[id]]) };
  }
  for (const c of chosen) if (c.type === 'delete') delete state[c.nodeId];
  if (canvasText !== undefined) state.canvas = { path: canvasPath, vault: hash(canvasText), emede: hash(after.files[after.paths.canvas]) };
  return withNode(next, 'project', { vault: { path: base, notes: state } } as Partial<ProjectData>);
}

/**
 * Notas del espejo que sobran después de exportar: piezas borradas en emede o renombradas
 * (su nota vieja quedó con otro nombre). Solo se consideran notas creadas por emede (con emede-id).
 */
export function staleNotes(existing: Record<string, string>, m: Mirror, prev?: VaultSync): string[] {
  const wanted = new Set(Object.values(m.paths));
  const recorded = new Set(Object.values(prev?.notes ?? {}).map((r) => r.path));
  return Object.entries(existing)
    .filter(([p, t]) => p.endsWith('.md') && !wanted.has(p) && (recorded.has(p) || str(parseFrontmatter(t).data['emede-id'])))
    .map(([p]) => p);
}

/** Notas editadas en Obsidian que todavía no se trajeron: exportar encima las pisaría. */
export function unsyncedEdits(g: Graph, existing: Record<string, string>): string[] {
  const sync = projectOf(g).vault;
  if (!sync) return [];
  return Object.values(sync.notes)
    .filter((r) => existing[r.path] !== undefined && hash(existing[r.path]) !== r.vault)
    .map((r) => r.path);
}

/* ---------- vault como fuente ---------- */

/** Junta notas del vault en un solo texto para "Desde plan". Con `linked`, suma las notas enlazadas (un nivel). */
export function collectNotes(all: Record<string, string>, chosen: string[], linked: boolean): string {
  const paths = new Set(chosen);
  if (linked)
    for (const p of chosen)
      for (const t of wikiTargets(all[p] ?? '')) {
        const hit = resolveLink(t, Object.keys(all));
        if (hit) paths.add(hit);
      }
  return [...paths].map((p) => `<!-- nota: ${p} -->\n# ${basename(p)}\n\n${norm(stripHidden(all[p] ?? ''))}`).join('\n\n---\n\n');
}
