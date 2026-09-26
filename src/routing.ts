import { generateJSON } from './llm';
import { aiOf } from './providers';
import { LANG_INFO } from './i18n/langs';
import { slug } from './defaults';
import { stripHidden } from './sanitize';
import type { Graph } from './store';
import type { NodeData, RoutingCase, Settings } from './types';

/*
 * Prueba de enrutamiento: ¿la IA elige el agente o la skill correcta para cada pedido?
 * Las herramientas (Claude Code, Codex, Gemini CLI…) deciden a quién delegar mirando solo el nombre y la
 * descripción de cada pieza. La prueba reproduce eso: el modelo ve únicamente nombre + descripción y elige.
 * Los casos se generan a partir de lo que la pieza HACE (su prompt/instrucciones), no de su descripción,
 * así una descripción que no refleja el propósito real se detecta.
 */

export type { RoutingCase };

export interface RoutingResult {
  caseId: string;
  chosen: string;
  reason: string;
  ok: boolean;
}

export interface Candidate {
  key: string;
  id: string;
  kind: 'agent' | 'skill';
  name: string;
  description: string;
  body: string;
}

export const NONE = 'none';
const S = { type: 'STRING' };
const MAX_PIECES = 15;
const EXPERT = 'Sos un experto en configurar agentes de programación con IA (Claude Code, OpenCode, Codex CLI, Gemini CLI, Cursor, GitHub Copilot) y en cómo eligen subagentes y skills por su descripción.';
export const caseId = () => `rc-${Math.random().toString(36).slice(2, 9)}`;
const keyOf = (d: { kind: string; name: string }) => `${d.kind}:${slug(d.name)}`;

/** Agentes y skills: lo que la herramienta elige sola. Los comandos se invocan a mano con /nombre. */
export function candidates(g: Graph): Candidate[] {
  return g.nodes.flatMap((n) => {
    const d = n.data.d;
    if ((d.kind !== 'agent' && d.kind !== 'skill') || !d.name.trim()) return [];
    return [{
      key: keyOf(d), id: n.id, kind: d.kind, name: d.name, description: d.description ?? '',
      body: d.kind === 'agent' ? d.prompt : d.instructions,
    }];
  });
}

/** Normaliza lo que devuelve el modelo: nombre suelto, con o sin tipo, mayúsculas… */
export function resolveChoice(raw: string, list: Candidate[]): string {
  const v = stripHidden(String(raw ?? '')).trim();
  if (!v || /^(none|ninguno|ninguna|null|-)$/i.test(v)) return NONE;
  const exact = list.find((c) => c.key === v || c.key === v.toLowerCase());
  if (exact) return exact.key;
  const bare = slug(v.replace(/^(agent|skill|agente)\s*[:/]\s*/i, ''));
  const byName = list.filter((c) => slug(c.name) === bare);
  return byName.length === 1 ? byName[0].key : NONE;
}

const langOf = (s: Settings) => LANG_INFO[s.uiLang ?? s.lang]?.ai ?? 'español';

/** Genera pedidos de ejemplo: 2 por pieza a partir de lo que hace, y algunos que ninguna debería tomar. */
export async function suggestCases(g: Graph, settings: Settings): Promise<RoutingCase[]> {
  const list = candidates(g).slice(0, MAX_PIECES);
  if (!list.length) return [];
  const res = await generateJSON<{ cases: { request: string; expect: string }[] }>({
    ...aiOf(settings),
    system: EXPERT,
    temperature: 0.4,
    schema: {
      type: 'OBJECT',
      properties: { cases: { type: 'ARRAY', items: { type: 'OBJECT', properties: { request: S, expect: S }, required: ['request', 'expect'] } } },
      required: ['cases'],
    },
    prompt: `Estas son las piezas (subagentes y skills) de la configuración de un agente de código. Para cada una ves lo que HACE (su prompt o instrucciones).

${list.map((c) => `### ${c.key}\n${c.body.slice(0, 1500) || '(sin contenido)'}`).join('\n\n')}

Escribí pedidos realistas que un desarrollador le escribiría al agente de código, en ${langOf(settings)}:
- 2 pedidos por pieza en los que esa pieza sea la adecuada. Variados: uno directo y uno indirecto (que describa la situación sin nombrar la tarea). Nunca menciones el nombre de la pieza.
- 3 pedidos que ninguna pieza debería tomar (tareas generales que el agente principal resuelve solo). Para esos, expect = "${NONE}".
En "expect" poné la clave exacta de la pieza (por ejemplo "${list[0].key}") o "${NONE}".`,
  });
  const keys = new Set(list.map((c) => c.key));
  return (res.cases ?? [])
    .map((c) => ({ id: caseId(), request: stripHidden(String(c.request ?? '')).trim(), expect: keys.has(c.expect) ? c.expect : NONE }))
    .filter((c) => c.request);
}

/** Corre los casos: el modelo ve solo nombre + descripción de cada pieza, como la herramienta real. */
export async function runRouting(g: Graph, cases: RoutingCase[], settings: Settings): Promise<RoutingResult[]> {
  const list = candidates(g);
  const todo = cases.filter((c) => c.request.trim());
  if (!todo.length) return [];
  const res = await generateJSON<{ results: { index: number; choice: string; reason: string }[] }>({
    ...aiOf(settings),
    temperature: 0,
    system: `Sos el agente principal de una herramienta de programación (como Claude Code). Podés delegar en subagentes o cargar skills, y decidís solo por su nombre y su descripción, que es todo lo que ves de ellos.
Delegás o cargás una skill cuando la descripción indica claramente que corresponde; si no, resolvés vos ("${NONE}").`,
    schema: {
      type: 'OBJECT',
      properties: {
        results: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: { index: { type: 'INTEGER' }, choice: S, reason: S }, required: ['index', 'choice', 'reason'] },
        },
      },
      required: ['results'],
    },
    prompt: `Subagentes y skills disponibles:
${list.length ? list.map((c) => `- ${c.key}: ${c.description.trim() || '(sin descripción)'}`).join('\n') : '(ninguno)'}

Para cada pedido, decidí qué usarías: la clave exacta ("${list[0]?.key ?? 'agent:x'}") o "${NONE}". Explicá el motivo en una oración, en ${langOf(settings)}.

${todo.map((c, i) => `${i}. ${c.request}`).join('\n')}`,
  });
  const byIndex = new Map((res.results ?? []).map((r) => [Number(r.index), r]));
  return todo.map((c, i) => {
    const r = byIndex.get(i);
    const chosen = resolveChoice(r?.choice ?? '', list);
    return { caseId: c.id, chosen, reason: stripHidden(String(r?.reason ?? '')).trim(), ok: chosen === c.expect };
  });
}

/**
 * Con los casos que fallaron, reescribe las descripciones de las piezas involucradas (la esperada y la que se
 * eligió por error) para que la elección sea la correcta. Devuelve el grafo nuevo y qué piezas cambiaron.
 */
export async function improveDescriptions(
  g: Graph, cases: RoutingCase[], results: RoutingResult[], settings: Settings,
): Promise<{ graph: Graph; changed: string[] }> {
  const list = candidates(g);
  const failed = results.filter((r) => !r.ok).map((r) => ({ r, c: cases.find((c) => c.id === r.caseId)! })).filter((x) => x.c);
  const involved = new Set(failed.flatMap(({ r, c }) => [r.chosen, c.expect]).filter((k) => k !== NONE));
  const pieces = list.filter((c) => involved.has(c.key));
  if (!pieces.length) return { graph: g, changed: [] };
  const res = await generateJSON<{ pieces: { key: string; description: string }[] }>({
    ...aiOf(settings),
    system: EXPERT,
    temperature: 0.2,
    schema: {
      type: 'OBJECT',
      properties: { pieces: { type: 'ARRAY', items: { type: 'OBJECT', properties: { key: S, description: S }, required: ['key', 'description'] } } },
      required: ['pieces'],
    },
    prompt: `La herramienta elige subagentes y skills solo por su descripción, y en estos pedidos eligió mal:
${failed.map(({ r, c }) => `- "${c.request}" → debía ser ${c.expect}, eligió ${r.chosen}`).join('\n')}

Todas las piezas y sus descripciones actuales:
${list.map((c) => `- ${c.key}: ${c.description || '(sin descripción)'}`).join('\n')}

Qué hace cada pieza a corregir:
${pieces.map((c) => `### ${c.key}\n${c.body.slice(0, 1500)}`).join('\n\n')}

Reescribí la descripción SOLO de las piezas de la última lista (${pieces.map((c) => c.key).join(', ')}), para que la elección sea la correcta en esos pedidos sin romper los demás casos.
Cada descripción: qué hace + "Usar cuando…" con disparadores concretos, y si hace falta cuándo NO usarla. Máximo 300 caracteres. Escribila en ${LANG_INFO[settings.lang]?.ai ?? 'español'}.`,
  });
  const patch = new Map<string, string>();
  for (const p of res.pieces ?? []) {
    const c = pieces.find((x) => x.key === p.key);
    const desc = stripHidden(String(p.description ?? '')).trim();
    if (c && desc && desc !== c.description) patch.set(c.id, desc);
  }
  return {
    changed: [...patch.keys()],
    graph: {
      ...g,
      nodes: g.nodes.map((n) => (patch.has(n.id) ? { ...n, data: { d: { ...n.data.d, description: patch.get(n.id)! } as NodeData } } : n)),
    },
  };
}
