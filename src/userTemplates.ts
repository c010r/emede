import type { Graph } from './store';
import type { McpData, NodeData, NodeKind } from './types';
import type { Template } from './templates';
import { LANGS, type Lang } from './i18n/langs';
import { resolveMcp } from './generators/secrets';
import { countHiddenDeep, stripHiddenDeep } from './sanitize';
import { emptyData, slug } from './defaults';
import { t } from './i18n';

/*
 * Plantillas propias: paquetes de piezas que el usuario guarda desde un proyecto para reusarlas en otros,
 * y que se pueden compartir con el equipo como archivo .emede-pack.json.
 * Nunca llevan secretos: los valores sensibles de MCP quedan como referencias ${VAR}.
 */

export interface UserPack {
  id: string;
  title: string;
  blurb: string;
  /** Idioma en que está escrito el contenido (para traducirlo al insertarlo en un proyecto en otro idioma). */
  lang: Lang;
  items: Template[];
  createdAt: number;
  updatedAt: number;
}

const KINDS: Template['kind'][] = ['agent', 'skill', 'command', 'rule', 'mcp'];
const newId = () => `u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** MCP sin secretos: los valores sensibles de env y headers pasan a ser referencias ${VAR}. */
export function scrubMcp(d: McpData): McpData {
  const r = resolveMcp(d);
  const line = (x: { key: string; literal?: string; ref?: string; prefix?: string }) =>
    `${x.key}=${x.ref ? `${x.prefix ?? ''}\${${x.ref}}` : x.literal}`;
  return { ...d, env: r.env.map(line).join('\n'), headers: r.headers.map(line).join('\n') };
}

const itemData = (d: NodeData): Partial<NodeData> => {
  const clean = (d.kind === 'mcp' ? scrubMcp(d) : d) as unknown as Record<string, unknown>;
  const { kind: _k, ...rest } = clean;
  return rest as Partial<NodeData>;
};

/** Arma un paquete con las piezas elegidas del lienzo, con sus conexiones salientes (por nombre). */
export function packFromNodes(g: Graph, ids: string[], meta: { title: string; blurb: string; lang: Lang }): UserPack {
  const nodes = g.nodes.filter((n) => ids.includes(n.id) && n.data.d.kind !== 'project');
  const now = Date.now();
  return {
    id: newId(), title: meta.title.trim(), blurb: meta.blurb.trim(), lang: meta.lang, createdAt: now, updatedAt: now,
    items: nodes.map((n) => {
      const d = n.data.d;
      const links = g.edges.filter((e) => e.source === n.id)
        .map((e) => g.nodes.find((m) => m.id === e.target)?.data.d)
        .filter((x) => x && x.kind !== 'project').map((x) => x!.name);
      return {
        id: `${d.kind}-${slug(d.name)}`, kind: d.kind as Template['kind'], title: d.name,
        blurb: 'description' in d ? String(d.description ?? '') : '',
        data: itemData(d), ...(links.length ? { links } : {}),
      };
    }),
  };
}

/** Texto del archivo para compartir. */
export function serializePack(p: UserPack): string {
  return JSON.stringify({ emedePack: 1, ...p }, null, 2);
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Lee un .emede-pack.json (propio o de otra persona): valida la forma, quita caracteres invisibles
 * y los secretos de MCP, y le da un id nuevo para no pisar un paquete existente.
 */
export function parsePack(text: string): { pack: UserPack; hidden: number } {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(t('utpl.badFile'));
  }
  if (!raw || raw.emedePack !== 1 || !Array.isArray(raw.items)) throw new Error(t('utpl.badFile'));
  const hidden = countHiddenDeep(raw);
  const clean = stripHiddenDeep(raw);
  const items: Template[] = [];
  for (const it of clean.items as Record<string, unknown>[]) {
    const kind = it?.kind as Template['kind'];
    const data = it?.data as Record<string, unknown> | undefined;
    if (!KINDS.includes(kind) || !data || typeof data !== 'object' || !str(data.name).trim()) continue;
    // Solo los campos que conoce la pieza, con su tipo; lo demás se descarta.
    const base = emptyData(kind as NodeKind) as unknown as Record<string, unknown>;
    const picked: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(base)) {
      if (k === 'kind' || !(k in data)) continue;
      if (typeof v === typeof data[k] && Array.isArray(v) === Array.isArray(data[k])) picked[k] = data[k];
    }
    const full = { ...base, ...picked, kind } as NodeData;
    items.push({
      id: `${kind}-${slug(str(data.name))}`, kind, title: str(data.name), blurb: str(data.description),
      data: itemData(full),
      ...(Array.isArray(it.links) ? { links: (it.links as unknown[]).filter((x): x is string => typeof x === 'string') } : {}),
    });
  }
  if (!items.length) throw new Error(t('utpl.emptyFile'));
  const lang = (LANGS as readonly string[]).includes(str(clean.lang)) ? (clean.lang as Lang) : 'es';
  const now = Date.now();
  return {
    hidden,
    pack: { id: newId(), title: str(clean.title).trim() || t('utpl.untitled'), blurb: str(clean.blurb), lang, items, createdAt: now, updatedAt: now },
  };
}

export function downloadPack(p: UserPack) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([serializePack(p)], { type: 'application/json' }));
  a.download = `${slug(p.title) || 'plantilla'}.emede-pack.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
