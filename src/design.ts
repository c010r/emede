import type { FileOverride, Graph } from './store';
import { normalizeGraph } from './storage';
import { countHiddenDeep, stripHiddenDeep } from './sanitize';
import { t } from './i18n';
import { LANGS, type Lang } from './i18n/langs';
import { TARGETS, type Target } from './types';

/*
 * Formato .emede.json: el diseño (grafo) y, desde esta versión, cómo se generan los archivos
 * (plataformas, idioma del contenido, ediciones manuales y exclusiones) para poder regenerarlos
 * igual fuera de la app (CLI, CI). Sin dependencias de la interfaz.
 */

export interface GenerateOptions {
  targets: Target[];
  lang: Lang;
  fileOverrides: Record<string, FileOverride>;
  excluded: string[];
}

export interface DesignFile {
  graph: Graph;
  /** Ausente en archivos exportados por versiones anteriores. */
  generate?: Partial<GenerateOptions>;
  /** Caracteres invisibles que traía (se quitaron). */
  hidden: number;
}

const isTarget = (x: unknown): x is Target => typeof x === 'string' && x in TARGETS;
const isLang = (x: unknown): x is Lang => typeof x === 'string' && (LANGS as readonly string[]).includes(x);

export function parseDesign(text: string): DesignFile {
  const raw = JSON.parse(text.replace(/^﻿/, '')) as Graph & { generate?: Record<string, unknown> };
  if (!Array.isArray(raw.nodes) || !raw.nodes.some((n) => n.id === 'project')) throw new Error(t('err.badDesign'));
  const g = raw.generate ?? {};
  const generate: Partial<GenerateOptions> = {};
  if (Array.isArray(g.targets)) generate.targets = g.targets.filter(isTarget);
  if (isLang(g.lang)) generate.lang = g.lang;
  if (g.fileOverrides && typeof g.fileOverrides === 'object') generate.fileOverrides = stripHiddenDeep(g.fileOverrides as Record<string, FileOverride>);
  if (Array.isArray(g.excluded)) generate.excluded = g.excluded.filter((p): p is string => typeof p === 'string');
  const hidden = countHiddenDeep(raw.nodes) + countHiddenDeep(g.fileOverrides ?? {});
  return {
    graph: normalizeGraph(stripHiddenDeep({ nodes: raw.nodes, edges: raw.edges ?? [] })),
    generate: Object.keys(generate).length ? generate : undefined,
    hidden,
  };
}

export function serializeDesign(graph: Graph, generate: GenerateOptions): string {
  return JSON.stringify({ emede: 1, ...graph, generate }, null, 2) + '\n';
}
