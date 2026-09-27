import { parseFrontmatter } from './importers/parse';
import type { FileMap, Target } from './types';

/*
 * Estimación de tokens: cuánto contexto consume cada archivo.
 * No es exacta (cada modelo tokeniza distinto), pero alcanza para comparar archivos y detectar los que pesan de más:
 * - alfabeto latino y código: ~4 caracteres por token;
 * - chino, japonés, coreano: ~1 token por carácter;
 * - otras escrituras (devanagari, bengalí, telugu, tamil…): ~2 caracteres por token.
 */

const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/g;
const OTHER_SCRIPT = /[^\u0000-ɏ -⁯㐀-鿿豈-﫿぀-ヿ가-힯\s]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK)?.length ?? 0;
  const other = text.match(OTHER_SCRIPT)?.length ?? 0;
  const latin = text.length - cjk - other;
  return Math.ceil(latin / 4 + cjk + other / 2);
}

/** 1234 → "1,2 k" (según el idioma de la interfaz). */
export const formatTokens = (n: number, locale?: string) =>
  n < 1000 ? String(n) : `${(n / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} k`;

/** Tokens por encima de los cuales un archivo que se carga en cada sesión conviene achicarlo. */
export const ALWAYS_LOADED_WARN = 3000;

/**
 * Archivos que cada herramienta carga en TODAS las sesiones (el costo fijo de contexto).
 * Agentes, skills y comandos se cargan solo cuando se usan.
 */
export function alwaysLoaded(files: FileMap, target: Target): string[] {
  const paths = Object.keys(files);
  const fm = (p: string) => parseFrontmatter(files[p]).data;
  switch (target) {
    case 'claude':
      return paths.filter((p) => p === 'CLAUDE.md' || (p.startsWith('.claude/rules/') && !fm(p).paths));
    case 'opencode':
    case 'codex':
    case 'roo':
      return paths.filter((p) => p === 'AGENTS.md');
    case 'gemini':
      return paths.filter((p) => p === 'GEMINI.md');
    case 'cursor':
      return paths.filter((p) => p.startsWith('.cursor/rules/') && fm(p).alwaysApply === true);
    case 'copilot':
      return paths.filter((p) => p === '.github/copilot-instructions.md'
        || (p.startsWith('.github/instructions/') && ['**', ''].includes(String(fm(p).applyTo ?? ''))));
  }
}

/** Costo fijo por sesión de cada herramienta elegida. */
export function sessionCost(files: FileMap, targets: Target[]): { target: Target; tokens: number; files: string[] }[] {
  return targets.map((target) => {
    const list = alwaysLoaded(files, target);
    return { target, files: list, tokens: list.reduce((n, p) => n + estimateTokens(files[p]), 0) };
  });
}
