import { t } from './i18n';
/* Acceso a carpetas locales con la File System Access API (Chrome / Edge). */

export interface FileHandle {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (s: string) => Promise<void>; close: () => Promise<void> }>;
}
export interface DirHandle {
  kind: 'directory';
  name: string;
  values: () => AsyncIterable<FileHandle | DirHandle>;
  getDirectoryHandle: (n: string, o?: { create?: boolean }) => Promise<DirHandle>;
  getFileHandle: (n: string, o?: { create?: boolean }) => Promise<FileHandle>;
  removeEntry?: (n: string) => Promise<void>;
  queryPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

export const canUseFolders = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Abre el selector de carpetas; devuelve null si el usuario cancela. */
export async function pickDir(mode: 'read' | 'readwrite'): Promise<DirHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
  try {
    return await picker({ mode });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

/** Pide permiso de escritura si hace falta (por ejemplo, al reutilizar una carpeta ya elegida). */
export async function ensureWrite(dir: DirHandle): Promise<boolean> {
  if (!dir.queryPermission) return true;
  if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await dir.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

async function subdir(root: DirHandle, parts: string[], create: boolean): Promise<DirHandle | null> {
  let dir = root;
  for (const p of parts) {
    try {
      dir = await dir.getDirectoryHandle(p, { create });
    } catch {
      return null;
    }
  }
  return dir;
}

/** Lee un archivo por ruta relativa; null si no existe. */
export async function readText(root: DirHandle, path: string): Promise<string | null> {
  const parts = path.split('/');
  const dir = await subdir(root, parts.slice(0, -1), false);
  if (!dir) return null;
  try {
    return await (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).text();
  } catch {
    return null;
  }
}

export async function writeText(root: DirHandle, path: string, content: string): Promise<void> {
  const parts = path.split('/');
  const dir = await subdir(root, parts.slice(0, -1), true);
  if (!dir) throw new Error(t('err.mkdir', { path }));
  const w = await (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
  await w.write(content);
  await w.close();
}

/** Lista las entradas de una subcarpeta (vacío si no existe). */
export async function list(root: DirHandle, path: string): Promise<(FileHandle | DirHandle)[]> {
  const dir = path ? await subdir(root, path.split('/'), false) : root;
  if (!dir) return [];
  const out: (FileHandle | DirHandle)[] = [];
  for await (const e of dir.values()) out.push(e);
  return out;
}

/** Borra un archivo por ruta relativa (no falla si ya no existe). */
export async function removeFile(root: DirHandle, path: string): Promise<void> {
  const parts = path.split('/');
  const dir = await subdir(root, parts.slice(0, -1), false);
  if (!dir?.removeEntry) return;
  try {
    await dir.removeEntry(parts.at(-1)!);
  } catch { /* ya no existía */ }
}

/**
 * Todos los archivos de texto bajo `path` (recursivo), con ruta relativa a `root`.
 * Salta carpetas ocultas (.obsidian, .git…) y las que indique `skip`.
 */
export async function readTree(
  root: DirHandle, path: string, accept: (p: string) => boolean, skip: (p: string) => boolean = () => false,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // Vault por ruta (servidor local): todo el árbol en un solo pedido.
  const fast = (root as DirHandle & { tree?: (p: string) => Promise<Record<string, string>> }).tree;
  if (fast) {
    const all = await fast(path);
    const skipped = (p: string) => p.split('/').slice(0, -1).some((_, i, a) => skip(a.slice(0, i + 1).join('/')));
    for (const [p, t] of Object.entries(all)) if (accept(p) && !skipped(p)) out[p] = t;
    return out;
  }
  const start = path ? await subdir(root, path.split('/'), false) : root;
  if (!start) return out;
  const walk = async (dir: DirHandle, prefix: string) => {
    for await (const e of dir.values()) {
      const p = `${prefix}${e.name}`;
      if (e.name.startsWith('.')) continue;
      if (e.kind === 'directory') {
        if (!skip(p)) await walk(e, `${p}/`);
      } else if (accept(p)) out[p] = await (await e.getFile()).text();
    }
  };
  await walk(start, path ? `${path}/` : '');
  return out;
}

/** Carpeta elegida en esta sesión, para "Guardar de nuevo" sin volver a elegirla. */
let remembered: DirHandle | null = null;
export const rememberDir = (d: DirHandle | null) => {
  remembered = d;
};
export const rememberedDir = () => remembered;

/**
 * Envuelve una carpeta para que todo texto leído pase por un filtro (p. ej. quitar caracteres invisibles).
 * `onRead` recibe la ruta relativa y el texto original, y devuelve el texto a usar.
 */
export function filteredDir(dir: DirHandle, onRead: (path: string, text: string) => string, prefix = ''): DirHandle {
  const wrapFile = (f: FileHandle, path: string): FileHandle => ({
    kind: 'file',
    name: f.name,
    getFile: async () => {
      const file = await f.getFile();
      return { text: async () => onRead(path, await file.text()) } as File;
    },
    createWritable: () => f.createWritable(),
  });
  return {
    kind: 'directory',
    name: dir.name,
    async *values() {
      for await (const e of dir.values())
        yield e.kind === 'file' ? wrapFile(e, `${prefix}${e.name}`) : filteredDir(e, onRead, `${prefix}${e.name}/`);
    },
    getDirectoryHandle: async (n, o) => filteredDir(await dir.getDirectoryHandle(n, o), onRead, `${prefix}${n}/`),
    getFileHandle: async (n, o) => wrapFile(await dir.getFileHandle(n, o), `${prefix}${n}`),
  };
}

/** Carpeta de solo lectura armada con archivos en memoria (ruta → texto), con la misma interfaz que una real. */
export function memoryDir(files: Record<string, string>, name = 'repo'): DirHandle {
  const file = (path: string, n: string): FileHandle => ({
    kind: 'file',
    name: n,
    getFile: async () => ({ text: async () => files[path] }) as unknown as File,
    createWritable: async () => {
      throw new Error('memoryDir es de solo lectura');
    },
  });
  const dir = (prefix: string, n: string): DirHandle => ({
    kind: 'directory',
    name: n,
    async *values() {
      const seen = new Set<string>();
      for (const p of Object.keys(files)) {
        if (!p.startsWith(prefix)) continue;
        const [head, ...tail] = p.slice(prefix.length).split('/');
        if (seen.has(head)) continue;
        seen.add(head);
        yield tail.length ? dir(`${prefix}${head}/`, head) : file(`${prefix}${head}`, head);
      }
    },
    getDirectoryHandle: async (d) => {
      if (!Object.keys(files).some((p) => p.startsWith(`${prefix}${d}/`))) throw new DOMException(d, 'NotFoundError');
      return dir(`${prefix}${d}/`, d);
    },
    getFileHandle: async (f) => {
      if (!(`${prefix}${f}` in files)) throw new DOMException(f, 'NotFoundError');
      return file(`${prefix}${f}`, f);
    },
  });
  return dir('', name);
}
