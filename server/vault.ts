import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/*
 * Acceso al vault de Obsidian por su ruta (configurada en Ajustes). Lo usa el servidor local, así la app
 * lee y escribe el vault desde cualquier navegador sin elegir la carpeta cada vez.
 * Toda ruta pedida es relativa al vault y no puede salir de él.
 */

export class VaultError extends Error {
  readonly code: 'no-vault' | 'outside' | 'not-found' | 'too-big';
  readonly status: number;
  constructor(code: VaultError['code'], status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export const expandHome = (p: string) => p.trim().replace(/^~(?=$|[\\/])/, homedir());

/** Ruta absoluta dentro del vault; rechaza rutas absolutas o que escapen con "..". */
export function inside(root: string, rel: string): string {
  const clean = (rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (isAbsolute(clean)) throw new VaultError('outside');
  const full = resolve(root, clean);
  if (full !== root && !full.startsWith(root + sep)) throw new VaultError('outside');
  return full;
}

export async function vaultInfo(path: string): Promise<{ path: string; exists: boolean; isVault: boolean }> {
  const root = resolve(expandHome(path));
  const isDir = async (p: string) => (await stat(p).catch(() => null))?.isDirectory() ?? false;
  return { path: root, exists: await isDir(root), isVault: await isDir(join(root, '.obsidian')) };
}

export async function listDir(root: string, rel: string) {
  const entries = await readdir(inside(root, rel), { withFileTypes: true }).catch(() => {
    throw new VaultError('not-found', 404);
  });
  return entries.filter((e) => e.isFile() || e.isDirectory()).map((e) => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' }));
}

const MAX_FILES = 20_000;
const MAX_BYTES = 60 * 1024 * 1024;

/** Notas (.md) y canvas bajo `rel`, de una sola vez. Salta carpetas ocultas (.obsidian, .git, .trash…). */
export async function readTree(root: string, rel: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let bytes = 0;
  let count = 0;
  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && /\.(md|canvas)$/i.test(e.name)) {
        const text = await readFile(full, 'utf8');
        bytes += text.length;
        if (++count > MAX_FILES || bytes > MAX_BYTES) throw new VaultError('too-big', 413);
        out[relative(root, full).split(sep).join('/')] = text;
      }
    }
  };
  await walk(inside(root, rel));
  return out;
}

export async function readNote(root: string, rel: string): Promise<string> {
  try {
    return await readFile(inside(root, rel), 'utf8');
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError('not-found', 404);
  }
}

export async function writeNote(root: string, rel: string, text: string): Promise<void> {
  const full = inside(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text, 'utf8');
}

export async function removeNote(root: string, rel: string): Promise<void> {
  await rm(inside(root, rel), { force: true });
}
