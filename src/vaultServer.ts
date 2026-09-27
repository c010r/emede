import { t } from './i18n';
import type { DirHandle, FileHandle } from './fs';

/*
 * El vault configurado en Ajustes, leído y escrito por el servidor local.
 * Imita la interfaz de carpeta de la File System Access API, así el resto del código no distingue
 * entre una carpeta elegida en el navegador y el vault por ruta.
 */

export class VaultApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(['no-vault', 'outside', 'not-note', 'not-found', 'too-big'].includes(code) ? t(`err.vault.${code as 'no-vault'}`) : code);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/vault/${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 405) throw new Error(t('app.serverOutdated'));
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new VaultApiError(String(j.code ?? j.error ?? res.status), res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const q = (p: string) => `?path=${encodeURIComponent(p)}`;

export interface VaultInfo {
  path: string;
  exists: boolean;
  isVault: boolean;
}

/** Verifica una ruta (o la guardada en Ajustes si se omite). */
export const checkVault = (path?: string) => call<VaultInfo>('GET', `info${path ? q(path) : ''}`);

/** Vault que Obsidian registra en este equipo. */
export interface KnownVault { path: string; name: string; exists: boolean }
export const knownVaults = () => call<KnownVault[]>('GET', 'known');

/** Una carpeta del equipo con sus subcarpetas (solo nombres), para elegir el vault navegando. */
export interface FolderList {
  path: string;
  parent: string | null;
  isVault: boolean;
  home: string;
  drives: string[];
  folders: { name: string; isVault: boolean }[];
}
export async function listFolders(path = ''): Promise<FolderList> {
  const res = await fetch(`/api/folders${q(path)}`);
  if (res.status === 405) throw new Error(t('app.serverOutdated'));
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new VaultApiError(String(j.code ?? j.error ?? res.status), res.status);
  return j as FolderList;
}

export type ServerDir = DirHandle & { tree: (path: string) => Promise<Record<string, string>>; location: string };

export function serverVault(location: string): ServerDir {
  const make = (prefix: string, name: string): DirHandle => ({
    kind: 'directory',
    name,
    async *values() {
      const list = await call<{ name: string; kind: 'file' | 'directory' }[]>('GET', `list${q(prefix)}`);
      for (const e of list) yield e.kind === 'directory' ? make(`${prefix}${e.name}/`, e.name) : file(`${prefix}${e.name}`, e.name);
    },
    getDirectoryHandle: async (n, o) => {
      if (!o?.create) await call('GET', `list${q(`${prefix}${n}`)}`);
      return make(`${prefix}${n}/`, n);
    },
    getFileHandle: async (n) => file(`${prefix}${n}`, n),
    removeEntry: async (n) => void (await call('DELETE', `file${q(`${prefix}${n}`)}`)),
  });
  const file = (path: string, name: string): FileHandle => ({
    kind: 'file',
    name,
    getFile: async () => {
      const { text } = await call<{ text: string }>('GET', `file${q(path)}`);
      return { text: async () => text } as File;
    },
    createWritable: async () => {
      let buf = '';
      return { write: async (s: string) => void (buf += s), close: async () => void (await call('PUT', `file${q(path)}`, { text: buf })) };
    },
  });
  const root = make('', location.split(/[\/]/).filter(Boolean).at(-1) ?? location);
  return { ...root, location, tree: (path: string) => call('GET', `tree${q(path)}`) };
}
