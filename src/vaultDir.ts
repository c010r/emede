import { list, pickDir, type DirHandle } from './fs';
import { useStore } from './store';
import { storage } from './storage';
import { serverVault } from './vaultServer';

/*
 * Vault de Obsidian. Lo normal es configurar su ruta en Ajustes: el servidor local lo lee y escribe.
 * Sin servidor (app servida como sitio estático) se elige la carpeta en el navegador; ese acceso se recuerda
 * en IndexedDB y el navegador vuelve a pedir permiso la primera vez que se usa en cada sesión.
 */

let vault: DirHandle | null = null;

/** Hay servidor local: el vault se usa por su ruta. */
export const serverAvailable = () => {
  try {
    return storage().kind === 'file';
  } catch {
    return false;
  }
};

/** Vault por ruta configurada en Ajustes (solo con servidor local). */
export function configuredVault(): DirHandle | null {
  const path = useStore.getState().settings.vaultPath?.trim();
  return path && serverAvailable() ? serverVault(path) : null;
}
const DB = 'emede-vault';
const STORE = 'handles';

function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const req = fn(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const currentVault = () => configuredVault() ?? vault;

/** Vault recordado de una sesión anterior (sin pedir permiso todavía). */
export async function restoreVault(): Promise<DirHandle | null> {
  const configured = configuredVault();
  if (configured) return configured;
  if (vault) return vault;
  vault = (await idb<DirHandle>('readonly', (s) => s.get('vault'))) ?? null;
  return vault;
}

/** Una carpeta es un vault si tiene la carpeta de configuración de Obsidian. */
export async function isVault(dir: DirHandle): Promise<boolean> {
  return (await list(dir, '')).some((e) => e.kind === 'directory' && e.name === '.obsidian');
}

/** Abre el selector de carpetas; devuelve el vault elegido y si parece un vault de Obsidian. */
export async function pickVault(): Promise<{ dir: DirHandle; looksLikeVault: boolean } | null> {
  const dir = await pickDir('readwrite');
  if (!dir) return null;
  vault = dir;
  await idb('readwrite', (s) => s.put(dir, 'vault'));
  return { dir, looksLikeVault: await isVault(dir) };
}

/** Pide permiso de lectura (o escritura) sobre el vault recordado. */
export async function ensureAccess(dir: DirHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  if (!dir.queryPermission) return true;
  if ((await dir.queryPermission({ mode })) === 'granted') return true;
  return (await dir.requestPermission?.({ mode })) === 'granted';
}
