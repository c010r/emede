import { readTree, writeText, type DirHandle } from './fs';
import { emptyData } from './defaults';
import type { Lang } from './i18n/langs';
import { DEFAULT_VAULT_FOLDER, mirror, syncState, vaultBase } from './obsidian';
import { stripHidden } from './sanitize';
import { storage } from './storage';
import { useStore, type Graph } from './store';
import type { NodeData, ProjectData, VaultSync } from './types';
import { configuredVault } from './vaultDir';
import { checkVault } from './vaultServer';

/*
 * Guardado automático en el vault configurado en Ajustes: al vincularlo (y al arrancar) se guardan las notas
 * de todos los proyectos, y después las de cada pieza nueva del proyecto abierto.
 * Solo crea notas que faltan: nunca pisa ni borra una que ya existe. Actualizar sigue siendo "Enviar a Obsidian",
 * que muestra el diff y respalda. Una nota que ya se guardó una vez no se vuelve a crear (si se borró en Obsidian, queda borrada).
 * Las piezas con el nombre por defecto (nuevo-agente…) esperan a tener nombre propio, así no queda una nota huérfana al renombrarlas.
 */

const isNote = (p: string) => p.endsWith('.md') || p.endsWith('.canvas');
const unnamed = (d: NodeData) => !d.name.trim() || d.name === emptyData(d.kind).name;

/** Crea en `dir` las notas del proyecto que todavía no existen. Devuelve el nuevo estado de sincronización, o null si no escribió nada. */
export async function createMissingNotes(dir: DirHandle, g: Graph, folder: string, lang: Lang): Promise<{ sync: VaultSync; written: string[] } | null> {
  const project = g.nodes.find((n) => n.id === 'project')!.data.d as ProjectData;
  if (unnamed(project)) return null; // la carpeta del proyecto sale de su nombre: se espera a que lo tenga
  const base = vaultBase(g, folder);
  const m = mirror(g, base, lang);
  const files = Object.fromEntries(Object.entries(m.files).map(([p, c]) => [p, stripHidden(c)]));
  const recorded = project.vault?.path === base ? project.vault.notes : {};
  const data = new Map(g.nodes.map((n) => [n.id, n.data.d]));
  const wanted = Object.entries(m.paths)
    .filter(([id]) => !recorded[id] && !(data.has(id) && unnamed(data.get(id)!)))
    .map(([, path]) => path);
  if (!wanted.length) return null;

  const existing = await readTree(dir, base, isNote);
  const written = wanted.filter((p) => existing[p] === undefined);
  if (!written.length) return null;
  for (const p of written) await writeText(dir, p, files[p]);
  return { sync: syncState(base, { ...m, files }, written, project.vault), written };
}

const withVault = (g: Graph, vault: VaultSync): Graph => ({
  ...g,
  nodes: g.nodes.map((n) => (n.id === 'project' ? { ...n, data: { d: { ...(n.data.d as ProjectData), vault } } } : n)),
});

/** El vault de Ajustes, si existe y es un vault de Obsidian (con servidor local). */
async function vaultDir(): Promise<DirHandle | null> {
  const dir = configuredVault();
  if (!dir) return null;
  const info = await checkVault();
  return info.exists && info.isVault ? dir : null;
}

const options = () => {
  const s = useStore.getState().settings;
  return { folder: s.vaultFolder || DEFAULT_VAULT_FOLDER, lang: s.lang ?? 'es' };
};

/* Una sola sincronización a la vez: dos seguidas podrían crear la misma nota. */
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
};

async function syncOpen(dir: DirHandle): Promise<number> {
  const s = useStore.getState();
  if (s.view !== 'editor') return 0;
  const { folder, lang } = options();
  const r = await createMissingNotes(dir, { nodes: s.nodes, edges: s.edges }, folder, lang);
  if (!r) return 0;
  // Si mientras tanto se cambió de proyecto, el estado se guarda en el que corresponde.
  const now = useStore.getState();
  if (now.view === 'editor' && now.projectId === s.projectId) now.setVaultSync(r.sync);
  else await saveSync(s.projectId, r.sync);
  return r.written.length;
}

async function saveSync(id: string, sync: VaultSync) {
  const doc = await storage().get(id);
  if (doc) await storage().put({ ...doc, graph: withVault(doc.graph, sync) });
}

/** Notas nuevas del proyecto abierto. Devuelve cuántas creó. */
export const syncOpenProject = () =>
  serial(async () => {
    const s = useStore.getState();
    if (s.view !== 'editor' || !configuredVault()) return 0;
    const dir = await vaultDir();
    return dir ? syncOpen(dir) : 0;
  });

/** Notas que falten de todos los proyectos guardados (al vincular el vault o al arrancar). Devuelve cuántas creó. */
export const syncAllProjects = (vaultPath: string) =>
  serial(async () => {
    if (!configuredVault()) return 0;
    // El servidor escribe en el vault de sus Ajustes: se asegura que ya tenga la ruta nueva.
    await storage().putSettings({ vaultPath });
    const dir = await vaultDir();
    if (!dir) return 0;
    const { folder, lang } = options();
    const open = useStore.getState();
    let n = 0;
    for (const { id } of await storage().list()) {
      if (open.view === 'editor' && id === open.projectId) {
        n += await syncOpen(dir);
        continue;
      }
      const doc = await storage().get(id);
      if (!doc) continue;
      const r = await createMissingNotes(dir, doc.graph, folder, lang);
      if (!r) continue;
      await storage().put({ ...doc, graph: withVault(doc.graph, r.sync) });
      n += r.written.length;
    }
    return n;
  });
