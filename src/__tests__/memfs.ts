import type { DirHandle, FileHandle } from '../fs';

/** Carpeta en memoria que imita la File System Access API, para probar lectura y escritura. */
export function memDir(files: Record<string, string> = {}, name = 'repo'): DirHandle & { files: Record<string, string> } {
  const store = files;
  const make = (prefix: string, dirName: string): DirHandle => ({
    kind: 'directory',
    name: dirName,
    async *values() {
      const seen = new Set<string>();
      for (const p of Object.keys(store)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const [head, ...tail] = rest.split('/');
        if (seen.has(head)) continue;
        seen.add(head);
        yield tail.length ? make(`${prefix}${head}/`, head) : fileHandle(`${prefix}${head}`, head);
      }
    },
    async removeEntry(n) {
      delete store[`${prefix}${n}`];
    },
    async getDirectoryHandle(n, o) {
      const pre = `${prefix}${n}/`;
      if (!o?.create && !Object.keys(store).some((p) => p.startsWith(pre))) throw new DOMException('no existe', 'NotFoundError');
      return make(pre, n);
    },
    async getFileHandle(n, o) {
      const p = `${prefix}${n}`;
      if (!(p in store) && !o?.create) throw new DOMException('no existe', 'NotFoundError');
      return fileHandle(p, n);
    },
  });
  const fileHandle = (path: string, n: string): FileHandle => ({
    kind: 'file',
    name: n,
    getFile: async () => ({ text: async () => store[path] ?? '' }) as unknown as File,
    createWritable: async () => {
      let buf = '';
      return { write: async (s: string) => void (buf += s), close: async () => void (store[path] = buf) };
    },
  });
  return Object.assign(make('', name), { files: store });
}
