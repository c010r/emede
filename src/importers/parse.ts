/* Parsers mínimos para los formatos que generan las herramientas de agentes (no son YAML/TOML completos). */

export type FM = Record<string, unknown>;

function scalar(raw: string): unknown {
  const v = raw.trim();
  if (v === '') return '';
  if (/^".*"$/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^\[.*\]$/.test(v))
    return (v.slice(1, -1).match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []).map((x) => scalar(x)).filter((x) => x !== '');
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** Separa el frontmatter YAML (subconjunto: escalares, listas y un nivel de mapas) del cuerpo Markdown. */
export function parseFrontmatter(text: string): { data: FM; body: string } {
  const t = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = t.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: t.trim() };
  const data: FM = {};
  let key = '';
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (top) {
      key = top[1];
      data[key] = top[2].trim() === '' ? undefined : scalar(top[2]);
      continue;
    }
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) {
      const arr = Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
      arr.push(scalar(item[1]));
      data[key] = arr;
      continue;
    }
    const sub = line.match(/^\s+(["']?[^:"']+["']?):\s*(.*)$/);
    if (sub && key) {
      const obj = (data[key] && typeof data[key] === 'object' && !Array.isArray(data[key]) ? data[key] : {}) as FM;
      obj[String(scalar(sub[1]))] = scalar(sub[2]);
      data[key] = obj;
    }
  }
  return { data, body: t.slice(m[0].length).trim() };
}

/** Lee `clave = valor` de un TOML plano (strings, multilínea """…""", listas y booleanos). Ignora tablas. */
export function parseToml(text: string): FM {
  const t = text.replace(/\r\n/g, '\n');
  const out: FM = {};
  const re = /^([\w-]+)\s*=\s*("""[\s\S]*?"""|'''[\s\S]*?'''|\[[^\]]*\]|"(?:[^"\\]|\\.)*"|'[^']*'|[^\n]+)/gm;
  const firstTable = t.search(/^\[[^\]]+\]\s*$/m);
  const head = firstTable >= 0 ? t.slice(0, firstTable) : t;
  for (const m of head.matchAll(re)) {
    const v = m[2].trim();
    if (v.startsWith('"""') || v.startsWith("'''")) out[m[1]] = v.slice(3, -3).replace(/^\n/, '').replace(/\\\\/g, '\\');
    else out[m[1]] = scalar(v);
  }
  return out;
}

/** Tablas `[prefijo.nombre]` de un TOML, cada una con sus claves (incluye tablas inline `{ a = "b" }`). */
export function parseTomlTables(text: string, prefix: string): Record<string, FM> {
  const out: Record<string, FM> = {};
  const t = text.replace(/\r\n/g, '\n');
  const heads = [...t.matchAll(/^\[([^\]]+)\]\s*$/gm)];
  heads.forEach((h, i) => {
    if (!h[1].startsWith(`${prefix}.`)) return;
    const body = t.slice(h.index! + h[0].length, heads[i + 1]?.index ?? t.length);
    const fm = parseToml(body);
    for (const [k, v] of Object.entries(fm))
      if (typeof v === 'string' && /^\{.*\}$/.test(v.trim()))
        fm[k] = Object.fromEntries([...v.matchAll(/"?([\w-]+)"?\s*=\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], m[2]]));
    out[h[1].slice(prefix.length + 1)] = fm;
  });
  return out;
}

export const str =(v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
export const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : [];
