import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { expandHome, VaultError } from './vault.ts';

/*
 * Para elegir el vault de Obsidian sin escribir la ruta: el navegador no puede darle a la página la ruta real
 * de una carpeta, así que la busca el servidor local.
 * - knownVaults: los vaults que Obsidian registra en su configuración (obsidian.json).
 * - listFolders: nombres de las subcarpetas de una carpeta, para navegar. Nunca devuelve archivos ni contenido,
 *   y omite las carpetas ocultas y de sistema. Como el resto de la API, solo atiende a la propia app (rejectRequest).
 */

export interface KnownVault { path: string; name: string; exists: boolean }

/** Dónde guarda Obsidian su lista de vaults en cada sistema (instalación normal, Flatpak y Snap en Linux). */
function obsidianConfigs(): string[] {
  if (process.env.EMEDE_OBSIDIAN_CONFIG) return [process.env.EMEDE_OBSIDIAN_CONFIG];
  const home = homedir();
  if (process.platform === 'win32') return [join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json')];
  if (process.platform === 'darwin') return [join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json')];
  return [
    join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'obsidian', 'obsidian.json'),
    join(home, '.var', 'app', 'md.obsidian.Obsidian', 'config', 'obsidian', 'obsidian.json'),
    join(home, 'snap', 'obsidian', 'current', '.config', 'obsidian', 'obsidian.json'),
  ];
}

/** Vaults que Obsidian conoce en este equipo, el más usado recientemente primero. */
export async function knownVaults(): Promise<KnownVault[]> {
  const found = new Map<string, { ts: number }>();
  for (const file of obsidianConfigs()) {
    try {
      const json = JSON.parse(await readFile(file, 'utf8')) as { vaults?: Record<string, { path?: unknown; ts?: unknown }> };
      for (const v of Object.values(json.vaults ?? {})) {
        if (typeof v.path === 'string' && v.path) found.set(resolve(v.path), { ts: typeof v.ts === 'number' ? v.ts : 0 });
      }
    } catch { /* Obsidian no está instalado o el archivo no se puede leer: no hay sugerencias */ }
  }
  return [...found].sort((a, b) => b[1].ts - a[1].ts)
    .map(([path]) => ({ path, name: basename(path), exists: existsSync(join(path, '.obsidian')) }));
}

const HIDDEN = /^[.$]|^(System Volume Information|node_modules)$/i;
const MAX = 1000;

/** Unidades disponibles en Windows (C:\, D:\…), para poder salir de la carpeta personal. */
const drives = () => (process.platform === 'win32' ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((d) => existsSync(d)) : []);

/** Subcarpetas de `path` (la carpeta personal si viene vacía), marcando cuáles son vaults de Obsidian. */
export async function listFolders(path: string) {
  const dir = resolve(path.trim() ? expandHome(path) : homedir());
  if (!(await stat(dir).catch(() => null))?.isDirectory()) throw new VaultError('not-found', 404);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
    throw new VaultError('not-found', 404);
  });
  const names = entries.filter((e) => e.isDirectory() && !HIDDEN.test(e.name)).map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).slice(0, MAX);
  const folders = await Promise.all(names.map(async (name) => ({
    name, isVault: (await stat(join(dir, name, '.obsidian')).catch(() => null))?.isDirectory() ?? false,
  })));
  const root = parse(dir).root === dir;
  return {
    path: dir,
    parent: root ? null : dirname(dir),
    isVault: existsSync(join(dir, '.obsidian')),
    home: homedir(),
    drives: drives(),
    folders,
  };
}
