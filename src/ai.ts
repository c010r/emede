import { generate, generateJSON, unfence } from './llm';
import { aiOf, hasAI } from './providers';
import { LANG_INFO, type Lang } from './i18n/langs';
import { t } from './i18n';
import { dataOf, linked, useStore, type FlowNode, type Graph } from './store';
import { emptyData, slug } from './defaults';
import type { AgentData, CommandData, McpData, NodeData, ProjectData, RuleData, Settings, SkillData, Tool } from './types';
import { TOOLS } from './types';
import type { Edge } from '@xyflow/react';
import { CATALOG, parseStack, stackLines, STACK_CATEGORIES, TECH_BY_ID, toItem, type StackCategory, type StackItem } from './stack';

const langName = (s: Settings) => LANG_INFO[s.lang]?.ai ?? 'español';

/** Idioma de la interfaz, para lo que la IA le dice al usuario (preguntas, hallazgos). */
export const uiLangName = (s: Settings) => LANG_INFO[s.uiLang ?? s.lang]?.ai ?? 'español';

export const SYSTEM = (s: Settings) => `Sos un experto en configurar agentes de programación con IA (Claude Code, OpenCode, Codex CLI, Gemini CLI, Cursor, GitHub Copilot).
Escribís instrucciones en Markdown claras, concretas y accionables para que un agente de código trabaje bien en un repositorio.
Principios:
- Priorizá información que el agente no puede deducir leyendo el código: comandos exactos, convenciones, decisiones, trampas conocidas.
- Imperativo, directo, sin relleno ni marketing. Listas cortas, ejemplos breves cuando aportan.
- No inventes rutas, versiones ni comandos que contradigan los datos provistos; si falta un dato, omitilo.
- NUNCA incluyas frontmatter YAML: solo el cuerpo Markdown. No envuelvas la respuesta en bloques de código.
- Escribí todo el contenido en ${langName(s)}.`;

/* ---------- contexto ---------- */

export function projectContext(g: Graph): string {
  const p = dataOf(g.nodes, 'project')[0] as ProjectData;
  const list = (kind: 'agent' | 'skill' | 'command' | 'rule' | 'mcp') =>
    dataOf(g.nodes, kind).map((n) => `- ${n.name}: ${'description' in n ? n.description : ''}`).join('\n') || '(ninguno)';
  return `# Proyecto: ${p.name}
Descripción: ${p.description || '-'}
Stack:
${[...stackLines(p.stackItems ?? []), p.stack].filter(Boolean).map((l) => `  ${l}`).join('\n') || '  -'}
Comandos: dev=\`${p.dev || '-'}\` build=\`${p.build || '-'}\` test=\`${p.test || '-'}\` lint=\`${p.lint || '-'}\`
Estructura: ${p.structure || '-'}
Convenciones: ${p.conventions || '-'}

Agentes:\n${list('agent')}
Skills:\n${list('skill')}
Comandos:\n${list('command')}
Reglas:\n${list('rule')}
Servidores MCP:\n${list('mcp')}`;
}

function nodeTask(g: Graph, node: FlowNode): { field: string; task: string } | null {
  const d = node.data.d;
  const names = (arr: NodeData[]) => arr.map((x) => x.name).join(', ') || 'ninguna';
  switch (d.kind) {
    case 'project':
      return {
        field: 'memory',
        task: `Escribí el archivo de memoria principal del repositorio (lo que va en CLAUDE.md / AGENTS.md / GEMINI.md).
Secciones sugeridas: resumen del proyecto, stack, comandos esenciales (bloque de código), estructura de carpetas, convenciones de código, flujo de trabajo (tests, commits), y qué NO hacer.
No listes los agentes/skills/comandos: eso se agrega automáticamente aparte. Máximo ~120 líneas.`,
      };
    case 'agent':
      return {
        field: 'prompt',
        task: `Escribí el system prompt del subagente "${d.name}".
Propósito: ${d.description || '(deducilo del nombre)'}
Herramientas disponibles: ${d.tools.join(', ') || 'ninguna'}. Skills que usa: ${names(linked(g, node.id, 'skill'))}.
Servidores MCP que usa: ${names(linked(g, node.id, 'mcp'))}.
Escribilo en segunda persona ("Sos…"), con: rol, cuándo actuar, proceso paso a paso, criterios de calidad, formato de la respuesta final y límites.`,
      };
    case 'skill':
      return {
        field: 'instructions',
        task: `Escribí las instrucciones de la skill "${d.name}" (el cuerpo de un SKILL.md).
Propósito: ${d.description || '(deducilo del nombre)'}
Incluí: cuándo usarla, pasos concretos, comandos/snippets relevantes al stack, checklist de verificación y errores comunes.`,
      };
    case 'command':
      return {
        field: 'prompt',
        task: `Escribí el prompt del comando slash "/${d.name}". Es el texto que se envía al agente cuando el usuario lo invoca.
Propósito: ${d.description || '(deducilo del nombre)'}
Argumentos: ${d.argumentHint || 'ninguno'}. Usá el marcador literal $ARGUMENTS donde vayan los argumentos del usuario.
Agentes a delegar: ${names(linked(g, node.id, 'agent'))}. Skills a usar: ${names(linked(g, node.id, 'skill'))}.
Formulalo como instrucciones directas al agente, con pasos numerados y resultado esperado.`,
      };
    case 'rule':
      return {
        field: 'content',
        task: `Escribí el contenido de la regla "${d.name}"${d.globs ? ` que aplica a archivos ${d.globs}` : ''}.
Propósito: ${d.description || '(deducilo del nombre)'}
Lista concisa de reglas verificables (hacer / no hacer), con un ejemplo corto si ayuda. Máximo ~40 líneas.`,
      };
    default:
      return null;
  }
}

/* ---------- escritura de cuerpos ---------- */

export async function writeNode(id: string, overwrite = true): Promise<void> {
  const st = useStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node) return;
  const t = nodeTask(st, node);
  if (!t) return;
  const current = (node.data.d as unknown as Record<string, string>)[t.field];
  if (!overwrite && current?.trim()) return;
  st.setBusy(id, true);
  try {
    const improve = current?.trim()
      ? `\n\nVersión actual (mejorala, conservá lo valioso y lo que el usuario escribió a mano):\n"""\n${current}\n"""`
      : '';
    const text = await generate({
      ...aiOf(st.settings),
      system: SYSTEM(st.settings),
      prompt: `${projectContext(st)}\n\n---\nTAREA:\n${t.task}${improve}`,
    });
    useStore.getState().updateNode(id, { [t.field]: unfence(text) } as Partial<NodeData>);
  } finally {
    useStore.getState().setBusy(id, false);
  }
}

export async function writeAll(overwrite: boolean, onProgress?: (done: number, total: number) => void) {
  const ids = useStore.getState().nodes.filter((n) => n.data.d.kind !== 'mcp').map((n) => n.id);
  let done = 0;
  const errors: string[] = [];
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await writeNode(id, overwrite);
      } catch (e) {
        errors.push(`${id}: ${(e as Error).message}`);
      }
      onProgress?.(++done, ids.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (errors.length) throw new Error(errors.join('\n'));
}

/* ---------- diseñar desde una idea ---------- */

const S = { type: 'STRING' };
const DESIGN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    project: {
      type: 'OBJECT',
      properties: {
        name: S, description: S, stack: S, dev: S, build: S, test: S, lint: S, structure: S, conventions: S, memory: S,
      },
      required: ['name', 'description', 'stack', 'memory'],
    },
    agents: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: S, description: S,
          model: { type: 'STRING', enum: ['inherit', 'fast', 'balanced', 'powerful'] },
          tools: { type: 'ARRAY', items: { type: 'STRING', enum: [...TOOLS] } },
          skills: { type: 'ARRAY', items: S },
          mcp: { type: 'ARRAY', items: S },
          prompt: S,
        },
        required: ['name', 'description', 'tools', 'prompt'],
      },
    },
    skills: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { name: S, description: S, instructions: S }, required: ['name', 'description', 'instructions'] },
    },
    commands: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: S, description: S, argumentHint: S, prompt: S, agent: S, skills: { type: 'ARRAY', items: S } },
        required: ['name', 'description', 'prompt'],
      },
    },
    rules: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: S, description: S, globs: S, alwaysApply: { type: 'BOOLEAN' }, content: S },
        required: ['name', 'description', 'content'],
      },
    },
    mcp: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: S, transport: { type: 'STRING', enum: ['stdio', 'http'] }, command: S, args: S, url: S,
        },
        required: ['name', 'transport'],
      },
    },
    /** Solo cuando se pide conservar un plan que vino en PDF: su transcripción a Markdown. */
    planMarkdown: S,
  },
  required: ['project', 'agents', 'skills', 'commands', 'rules'],
};

interface Design {
  project: Partial<ProjectData>;
  agents: (Partial<AgentData> & { skills?: string[]; mcp?: string[] })[];
  skills: Partial<SkillData>[];
  commands: (Partial<CommandData> & { agent?: string; skills?: string[] })[];
  rules: Partial<RuleData>[];
  mcp?: Partial<McpData>[];
  planMarkdown?: string;
}

/** Qué tiene que devolver la IA en cualquier diseño (idea o plan). */
const DESIGN_OUTPUT = `Devolvé JSON con:
- project: datos del proyecto (stack = tecnologías separadas por comas, con versión mayor si aplica, ej: "Next.js 15, Prisma, PostgreSQL 16") y "memory" = cuerpo completo del archivo de memoria principal (Markdown).
- agents: 2 a 5 subagentes especializados y útiles (nombres kebab-case). tools solo de: ${TOOLS.join(', ')} (mínimo privilegio). model: fast para tareas simples, powerful para razonamiento complejo, inherit por defecto. skills/mcp = nombres que usa. prompt = system prompt completo.
- skills: 1 a 4 skills reutilizables con instructions completas.
- commands: 2 a 5 comandos slash (sin "/"), prompt completo usando $ARGUMENTS si recibe argumentos; agent = nombre del agente al que delega (opcional).
- rules: 1 a 4 reglas; globs separados por coma si aplican a ciertos archivos (vacío = siempre).
- mcp: solo servidores MCP reales y conocidos que aporten al proyecto (puede ser vacío). Para stdio, command y args separados por espacios.
Todos los textos en Markdown, sin frontmatter.`;

const currentData = (keepProject: boolean) =>
  keepProject ? `\n\nDatos ya cargados del proyecto (respetalos):\n${projectContext(useStore.getState())}` : '';

const currentProject = (keepProject: boolean) =>
  keepProject ? (dataOf(useStore.getState().nodes, 'project')[0] as ProjectData) : undefined;

/** Diseña el sistema completo a partir de una descripción libre. Devuelve el grafo; quien llama decide dónde aplicarlo. */
export async function designFromIdea(idea: string, keepProject: boolean): Promise<Graph> {
  const st = useStore.getState();
  const design = await generateJSON<Design>({
    ...aiOf(st.settings),
    system: SYSTEM(st.settings),
    temperature: 0.7,
    schema: DESIGN_SCHEMA,
    prompt: `Diseñá la configuración completa de agentes de código para este proyecto:
"""
${idea}
"""${currentData(keepProject)}

${DESIGN_OUTPUT}`,
  });
  return buildGraph(design, currentProject(keepProject));
}

export interface PlanInput {
  /** Texto del plan (Markdown o texto plano). */
  text?: string;
  /** Plan en PDF, en base64. */
  pdf?: { name: string; data: string };
  /** Guardar el plan en el proyecto (se genera docs/PLAN.md). */
  keepPlan: boolean;
  keepProject: boolean;
}

/** Límite práctico de texto: los modelos flash aceptan mucho más, pero así la respuesta llega en tiempo razonable. */
export const PLAN_MAX_CHARS = 400_000;

/**
 * Convierte un plan generado por IA (PRD, plan de implementación, roadmap) en la configuración de agentes:
 * extrae proyecto, stack, comandos y convenciones, y arma agentes, skills, comandos y reglas alineados al plan.
 */
export async function designFromPlan(input: PlanInput): Promise<Graph> {
  const st = useStore.getState();
  const text = input.text?.trim() ?? '';
  if (!text && !input.pdf) throw new Error(t('err.planEmpty'));
  if (text.length > PLAN_MAX_CHARS) throw new Error(t('err.planTooLong', { n: text.length.toLocaleString(), max: PLAN_MAX_CHARS.toLocaleString() }));
  const wantsTranscript = input.keepPlan && !!input.pdf;
  const design = await generateJSON<Design>({
    ...aiOf(st.settings),
    system: SYSTEM(st.settings),
    temperature: 0.4,
    schema: DESIGN_SCHEMA,
    files: input.pdf ? [{ mimeType: 'application/pdf', data: input.pdf.data }] : undefined,
    prompt: `Te paso un plan de proyecto generado por IA (${input.pdf ? `archivo PDF adjunto "${input.pdf.name}"` : 'texto entre comillas'}).
Tu tarea: convertirlo en la configuración de agentes de código que va a ejecutar ese plan.
${text ? `\n"""\n${text}\n"""\n` : ''}${currentData(input.keepProject)}

Cómo usar el plan:
- Extraé tal cual lo que el plan define: nombre, objetivo, stack y versiones, comandos, estructura de carpetas, convenciones, decisiones de arquitectura y restricciones. No inventes tecnologías que el plan no menciona.
- project.memory: resumí el objetivo, la arquitectura, las fases o hitos (con su orden) y las decisiones clave, para que cualquier agente entienda dónde está parado. Si el plan tiene tareas, incluí cómo se marca el avance.
- agents: uno por cada área de trabajo real del plan (por ejemplo backend, frontend, datos, QA, infraestructura), con el alcance que el plan le asigna.
- skills: los procedimientos repetibles que el plan describe (migraciones, despliegues, integración con un servicio, etc.).
- commands: flujos para ejecutar el plan, por ejemplo avanzar a la siguiente tarea o fase, revisar una fase contra sus criterios de aceptación o reportar el estado.
- rules: las restricciones y convenciones explícitas del plan (seguridad, estilo, performance, lo que no se debe hacer).
- Si el plan deja algo abierto, no lo decidas: mencionalo en memory como pendiente.
${wantsTranscript ? '- planMarkdown: transcribí el plan completo a Markdown fiel al original (títulos, listas, tablas).' : '- planMarkdown: dejalo vacío.'}

${DESIGN_OUTPUT}`,
  });
  const graph = buildGraph(design, currentProject(input.keepProject));
  if (input.keepPlan) {
    const plan = (text || design.planMarkdown || '').trim();
    const p = graph.nodes.find((n) => n.id === 'project');
    if (p && plan) p.data.d = { ...p.data.d, plan } as ProjectData;
  }
  return graph;
}

function buildGraph(d: Design, prev?: ProjectData): Graph {
  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];
  const byName = new Map<string, string>();
  const project = { ...emptyData('project'), ...(prev ?? {}), ...stripEmpty(d.project), kind: 'project' } as ProjectData;
  project.name = slug(project.name);
  // La IA devuelve el stack como texto: se convierte a ítems del selector y se suma a lo ya elegido.
  project.stackItems = mergeStack(prev?.stackItems ?? [], parseStack(d.project.stack ?? ''));
  project.stack = prev?.stack ?? '';
  nodes.push({ id: 'project', type: 'card', position: { x: 0, y: 0 }, deletable: false, data: { d: project } });

  const add = (kind: 'agent' | 'skill' | 'command' | 'rule' | 'mcp', items: Partial<NodeData>[], x: number, y0: number) =>
    items.forEach((it, i) => {
      const id = `${kind}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      const data = { ...emptyData(kind), ...stripEmpty(it), kind } as NodeData;
      data.name = slug(data.name);
      if (data.kind === 'agent') data.tools = data.tools.filter((t): t is Tool => (TOOLS as readonly string[]).includes(t));
      byName.set(`${kind}:${data.name}`, id);
      nodes.push({ id, type: 'card', position: { x, y: y0 + i * 170 }, data: { d: data } });
    });

  const clean = <T extends object>(arr: T[] | undefined, drop: string[]) =>
    (arr ?? []).map((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !drop.includes(k))) as T);

  add('command', clean(d.commands, ['agent', 'skills']), -420, 0);
  add('rule', d.rules ?? [], -420, Math.max(1, d.commands?.length ?? 0) * 170 + 60);
  add('agent', clean(d.agents, ['skills', 'mcp']), 420, 0);
  add('skill', d.skills ?? [], 840, 0);
  add('mcp', d.mcp ?? [], 0, 320);

  const link = (from: string | undefined, kind: string, name?: string) => {
    const to = name && byName.get(`${kind}:${slug(name)}`);
    if (from && to) edges.push({ id: `e-${from}-${to}`, source: from, target: to, animated: true });
  };
  d.agents?.forEach((a) => {
    const id = byName.get(`agent:${slug(a.name ?? '')}`);
    a.skills?.forEach((s) => link(id, 'skill', s));
    a.mcp?.forEach((m) => link(id, 'mcp', m));
  });
  d.commands?.forEach((c) => {
    const id = byName.get(`command:${slug(c.name ?? '')}`);
    link(id, 'agent', c.agent);
    c.skills?.forEach((s) => link(id, 'skill', s));
  });
  return { nodes, edges };
}

const stripEmpty = <T extends object>(o: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== '' && v != null)) as Partial<T>;


export const mergeStack = (current: StackItem[], extra: StackItem[]) => [
  ...current,
  ...extra.filter((x) => !current.some((c) => c.id === x.id)),
];

/* ---------- sugerir stack ---------- */

const STACK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: 'id del catálogo, o "custom" si no está' },
          label: S,
          category: { type: 'STRING', enum: Object.keys(STACK_CATEGORIES) },
          version: S,
        },
        required: ['id', 'label', 'category'],
      },
    },
    dev: S, build: S, test: S, lint: S,
    reason: S,
  },
  required: ['items', 'reason'],
};

export interface StackSuggestion {
  items: StackItem[];
  commands: Partial<Record<'dev' | 'build' | 'test' | 'lint', string>>;
  reason: string;
}

/** Propone un stack coherente a partir de la descripción del proyecto y lo que ya se eligió. */
export async function suggestStack(): Promise<StackSuggestion> {
  const st = useStore.getState();
  const p = dataOf(st.nodes, 'project')[0] as ProjectData;
  const catalog = CATALOG.map((t) => `${t.id} (${t.label}, ${t.cat})`).join('; ');
  const res = await generateJSON<{
    items: { id: string; label: string; category: StackCategory; version?: string }[];
    dev?: string; build?: string; test?: string; lint?: string; reason: string;
  }>({
    ...aiOf(st.settings),
    system: SYSTEM(st.settings),
    temperature: 0.4,
    schema: STACK_SCHEMA,
    prompt: `Proyecto: ${p.name}
Descripción: ${p.description || '(sin descripción)'}
Notas del stack: ${p.stack || '-'}
Ya elegido: ${stackLines(p.stackItems ?? []).join(' | ') || 'nada'}

Proponé el stack completo y coherente para este proyecto: lenguaje, framework(s), base de datos, ORM, estilos, testing, linter, gestor de paquetes e infraestructura, solo lo que tenga sentido.
Respetá lo ya elegido (incluilo) y completá lo que falte. Preferí opciones modernas, populares y compatibles entre sí.
Usá ids del catálogo siempre que existan: ${catalog}
Si una tecnología no está en el catálogo, usá id "custom".
version = versión mayor estable actual solo si es relevante (ej: "19"), si no dejalo vacío.
dev/build/test/lint = comandos exactos para ese stack.
reason = una frase explicando la elección.`,
  });
  const items = res.items.map((i): StackItem => {
    const tech = TECH_BY_ID.get(i.id);
    return tech
      ? toItem(tech, i.version || undefined)
      : { id: `custom-${slug(i.label)}`, label: i.label, category: i.category in STACK_CATEGORIES ? i.category : 'other', ...(i.version ? { version: i.version } : {}) };
  });
  const commands = Object.fromEntries(
    (['dev', 'build', 'test', 'lint'] as const).filter((k) => res[k]?.trim()).map((k) => [k, res[k]!.trim()]),
  );
  return { items, commands, reason: res.reason };
}

/* ---------- traducir plantillas ---------- */

const BODY_OF = { agent: 'prompt', skill: 'instructions', command: 'prompt', rule: 'content' } as const;

/**
 * Las plantillas están escritas en español. Si el contenido se genera en otro idioma, traduce las piezas
 * recién insertadas (descripción y cuerpo; los nombres son identificadores y no se tocan).
 * Devuelve null si no hace falta traducir o no hay IA configurada.
 */
export function translateTemplates(ids: string[], from: Lang = 'es'): Promise<void> | null {
  const st = useStore.getState();
  if (st.settings.lang === from || !hasAI(st.settings) || !ids.length) return null;
  const nodes = st.nodes.filter((n) => ids.includes(n.id) && n.data.d.kind in BODY_OF);
  if (!nodes.length) return null;
  const items = nodes.map((n) => {
    const d = n.data.d as unknown as Record<string, string>;
    const field = BODY_OF[n.data.d.kind as keyof typeof BODY_OF];
    return { id: n.id, description: d.description ?? '', body: d[field] ?? '', argumentHint: d.argumentHint ?? '' };
  });
  return (async () => {
    const res = await generateJSON<{ items: { id: string; description: string; body: string; argumentHint?: string }[] }>({
      ...aiOf(st.settings),
      system: SYSTEM(st.settings),
      temperature: 0.2,
      schema: {
        type: 'OBJECT',
        properties: {
          items: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { id: S, description: S, body: S, argumentHint: S }, required: ['id', 'description', 'body'] },
          },
        },
        required: ['items'],
      },
      prompt: `Traducí al ${langName(st.settings)} estas piezas de configuración de agentes de código.
Conservá exactamente el formato Markdown, los bloques de código, los comandos, las rutas, los nombres propios y el marcador $ARGUMENTS.
Traducí solo el texto en lenguaje natural. Devolvé cada pieza con el mismo id.

${JSON.stringify(items, null, 2)}`,
    });
    const patches = res.items
      .map((it) => {
        const node = nodes.find((n) => n.id === it.id);
        if (!node || !it.body?.trim()) return null;
        const field = BODY_OF[node.data.d.kind as keyof typeof BODY_OF];
        const patch: Record<string, string> = { [field]: it.body.trim() };
        if (it.description?.trim()) patch.description = it.description.trim();
        if (node.data.d.kind === 'command' && it.argumentHint?.trim()) patch.argumentHint = it.argumentHint.trim();
        return { id: it.id, patch: patch as Partial<NodeData> };
      })
      .filter((p): p is { id: string; patch: Partial<NodeData> } => !!p);
    useStore.getState().patchNodes(patches);
  })();
}
