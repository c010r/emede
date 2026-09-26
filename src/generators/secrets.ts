import type { McpData } from '../types';

/*
 * Los archivos de configuración MCP se suben al repo. Nunca se escribe un secreto literal:
 * los valores sensibles se reemplazan por referencias a variables de entorno, cada plataforma con su sintaxis,
 * y se genera un .env.example con los nombres (sin valores).
 */

export interface KV {
  key: string;
  /** Valor literal (no sensible). */
  literal?: string;
  /** Nombre de la variable de entorno que contiene el valor. */
  ref?: string;
  /** Texto fijo antes de la referencia, p. ej. "Bearer ". */
  prefix?: string;
}

export interface ResolvedMcp {
  env: KV[];
  headers: KV[];
  /** Variables de entorno que el usuario tiene que definir. */
  secrets: string[];
}

const SECRET_KEY = /(TOKEN|SECRET|PASSW(OR)?D|PWD|API_?KEY|ACCESS_?KEY|PRIVATE|CREDENTIAL|AUTH|COOKIE|SESSION|(^|_)PAT($|_))/i;
const SECRET_PREFIX = /^(gh[pousr]_|github_pat_|sk-|sk_(live|test)_|rk_(live|test)_|xox[abpr]-|AIza|glpat-|eyJ[\w-]+\.)/;
const REF_PATTERNS = [/^\$\{env:(\w+)\}$/, /^\{env:(\w+)\}$/, /^\$\{(\w+)(?::-[^}]*)?\}$/, /^\$(\w+)$/, /^%(\w+)%$/];

const envName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SECRET';

/** Si el valor ya es una referencia (${X}, {env:X}, $X…), devuelve el nombre de la variable. */
export function refName(value: string): string | undefined {
  for (const re of REF_PATTERNS) {
    const m = value.trim().match(re);
    if (m) return m[1];
  }
  return undefined;
}

/** Heurística: clave con nombre sensible, prefijo de token conocido o cadena larga de aspecto aleatorio. */
export function looksSecret(key: string, value: string): boolean {
  if (SECRET_KEY.test(key)) return true;
  const v = value.trim();
  if (SECRET_PREFIX.test(v)) return true;
  return v.length >= 24 && /^[\w\-.+/=]+$/.test(v) && /\d/.test(v) && /[a-z]/i.test(v) && !v.includes('/');
}

export const parseLines = (s = '') =>
  s.split('\n').map((l) => l.trim()).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()] as const)
    .filter(([k]) => k);

export function resolveMcp(s: McpData): ResolvedMcp {
  const secrets = new Set<string>();
  const env = parseLines(s.env).map(([key, value]): KV => {
    const ref = refName(value) ?? (looksSecret(key, value) || !value ? envName(key) : undefined);
    if (ref) secrets.add(ref);
    return ref ? { key, ref } : { key, literal: value };
  });
  const headers = parseLines(s.headers).map(([key, value]): KV => {
    const bearer = value.match(/^(Bearer|Token|Basic)\s+(.*)$/i);
    const prefix = bearer ? `${bearer[1]} ` : undefined;
    const inner = bearer ? bearer[2] : value;
    const sensitive = /^authorization$/i.test(key) || looksSecret(key, inner) || !inner;
    const ref = refName(inner) ?? (sensitive ? envName(`${s.name}_${/^authorization$/i.test(key) ? 'token' : key}`) : undefined);
    if (ref) secrets.add(ref);
    return ref ? { key, ref, prefix } : { key, literal: value };
  });
  return { env, headers, secrets: [...secrets] };
}

/** Sintaxis de referencia a variable de entorno de cada plataforma. */
export const REF_SYNTAX = {
  claude: (v: string) => `\${${v}}`,
  opencode: (v: string) => `{env:${v}}`,
  gemini: (v: string) => `\${${v}}`,
  cursor: (v: string) => `\${env:${v}}`,
  /** VS Code pide el valor una vez con un input de tipo contraseña. */
  vscode: (v: string) => `\${input:${v.toLowerCase().replace(/_/g, '-')}}`,
} as const;

/** Arma un objeto { clave: valor } usando la sintaxis de referencia de la plataforma. */
export function kvObject(list: KV[], ref: (v: string) => string): Record<string, string> | undefined {
  if (!list.length) return undefined;
  return Object.fromEntries(list.map((x) => [x.key, x.ref ? `${x.prefix ?? ''}${ref(x.ref)}` : x.literal!]));
}
