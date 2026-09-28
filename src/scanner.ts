import type { Graph, FlowNode } from './store';
import { useStore } from './store';
import { emptyData, slug } from './defaults';
import type { AgentData, CommandData, McpData, NodeData, ProjectData, RuleData, SkillData, Tool } from './types';
import { TOOLS } from './types';
import type { Edge } from '@xyflow/react';
import { generateJSON } from './llm';
import { hasAI, aiOf } from './providers';
import { SYSTEM } from './ai';

/*
 * Escanea un proyecto existente y genera agentes, skills y comandos automáticamente.
 * La IA interpreta el stack detectado y crea una configuración útil y coherente.
 */

export interface ScanResult {
  graph: Graph;
  agents: string[];
  skills: string[];
  commands: string[];
  rules: string[];
  mcp: string[];
}

/** Diseño generado por la IA al escanear */
interface ScanDesign {
  project: Partial<ProjectData>;
  agents: (Partial<AgentData> & { skills?: string[]; mcp?: string[] })[];
  skills: Partial<SkillData>[];
  commands: (Partial<CommandData> & { agent?: string; skills?: string[] })[];
  rules: Partial<RuleData>[];
  mcp: Partial<McpData>[];
}

const SCAN_PROMPT = `Convertí el contexto del proyecto en una configuración completa de agentes de código.

$CONTEXT

## Qué generá:
1. **project**: datos del proyecto (name, description, memory con el archivo principal en ~120 líneas).
2. **agents**: 2-5 agentes especializados, cada uno con tools mínimas, model (inherit/fast/balanced/powerful), y prompt completo.
3. **skills**: 1-4 skills reutilizables con instrucciones completas.
4. **commands**: 2-5 comandos slash con prompt usando $ARGUMENTS si recibe argumentos.
5. **rules**: 1-4 reglas verificables; globs si aplican a ciertos archivos.
6. **mcp**: servidores MCP relevantes (puede ser vacío).

Usá el stack y estructura detectados. No inventes tecnologías fuera del contexto.
Todos los textos en Markdown, sin frontmatter.`;

const SCAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    project: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        description: { type: 'STRING' },
        memory: { type: 'STRING' },
        stack: { type: 'STRING' },
      },
      required: ['name', 'memory'],
    },
    agents: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          description: { type: 'STRING' },
          model: { type: 'STRING', enum: ['inherit', 'fast', 'balanced', 'powerful'] },
          tools: { type: 'ARRAY', items: { type: 'STRING', enum: [...TOOLS] } },
          skills: { type: 'ARRAY', items: { type: 'STRING' } },
          mcp: { type: 'ARRAY', items: { type: 'STRING' } },
          prompt: { type: 'STRING' },
        },
        required: ['name', 'description', 'tools', 'prompt'],
      },
    },
    skills: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, description: { type: 'STRING' }, instructions: { type: 'STRING' } },
        required: ['name', 'description', 'instructions'],
      },
    },
    commands: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' }, description: { type: 'STRING' },
          argumentHint: { type: 'STRING' }, prompt: { type: 'STRING' },
          agent: { type: 'STRING' }, skills: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['name', 'description', 'prompt'],
      },
    },
    rules: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' }, description: { type: 'STRING' },
          globs: { type: 'STRING' }, alwaysApply: { type: 'BOOLEAN' }, content: { type: 'STRING' },
        },
        required: ['name', 'description', 'content'],
      },
    },
    mcp: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' }, transport: { type: 'STRING', enum: ['stdio', 'http'] },
          command: { type: 'STRING' }, args: { type: 'STRING' }, url: { type: 'STRING' },
        },
        required: ['name', 'transport'],
      },
    },
  },
  required: ['project', 'agents', 'skills', 'commands', 'rules'],
};

/**
 * Escanea un proyecto y genera una configuración de agentes usando IA.
 * @param detectedContext - Texto con stack, comandos y estructura detectada del proyecto
 * @returns Resultado del scan con grafo y nombres de nodos
 */
export async function scanProject(detectedContext: string): Promise<ScanResult> {
  const st = useStore.getState();
  if (!hasAI(st.settings)) throw new Error('No hay proveedor de IA configurado');

  const design: ScanDesign = await generateJSON<ScanDesign>({
    ...aiOf(st.settings),
    system: SYSTEM(st.settings),
    temperature: 0.4,
    schema: SCAN_SCHEMA,
    prompt: SCAN_PROMPT.replace('$CONTEXT', detectedContext),
  });

  return buildGraph(design);
}

/** Construye el grafo y extrae los nombres de nodos */
function buildGraph(d: ScanDesign): ScanResult {
  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];
  const byName = new Map<string, string>();

  const project = {
    ...emptyData('project'),
    kind: 'project' as const,
    name: slug(d.project.name || 'proyecto'),
    stack: d.project.stack || '',
    description: d.project.description || '',
    memory: d.project.memory || '',
  } as ProjectData;

  nodes.push({ id: 'project', type: 'card', position: { x: 0, y: 0 }, deletable: false, data: { d: project } });

  const add = (kind: 'agent' | 'skill' | 'command' | 'rule' | 'mcp', items: Record<string, unknown>[], x: number, y0: number) =>
    items.forEach((it, i) => {
      const data = { ...emptyData(kind), ...it, kind } as NodeData;
      data.name = slug((data as { name: string }).name || 'software');
      if (data.kind === 'agent') data.tools = data.tools.filter((t): t is Tool => (TOOLS as readonly string[]).includes(t));
      const id = `${kind}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      byName.set(`${kind}:${data.name}`, id);
      nodes.push({ id, type: 'card', position: { x, y: y0 + i * 170 }, data: { d: data } });
    });

  const clean = (arr: Record<string, unknown>[] | undefined, drop: string[]) =>
    (arr ?? []).map((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !drop.includes(k))));

  add('command', clean(d.commands as unknown as Record<string, unknown>[], ['agent', 'skills']), -420, 0);
  add('rule', (d.rules as unknown as Record<string, unknown>[]) ?? [], -420, Math.max(1, d.commands?.length ?? 0) * 170 + 60);
  add('agent', clean(d.agents as unknown as Record<string, unknown>[], ['skills', 'mcp']), 420, 0);
  add('skill', (d.skills as unknown as Record<string, unknown>[]) ?? [], 840, 0);
  add('mcp', (d.mcp as unknown as Record<string, unknown>[]) ?? [], 0, 320);

  const link = (from: string | undefined, kind: string, name?: string) => {
    const to = name && byName.get(`${kind}:${slug(name)}`);
    if (from && to) edges.push({ id: `e-${from}-${to}`, source: from, target: to, animated: true });
  };

  d.agents?.forEach((a) => {
    const id = byName.get(`agent:${slug(a.name || '')}`);
    a.skills?.forEach((s) => link(id, 'skill', s));
    a.mcp?.forEach((m) => link(id, 'mcp', m));
  });

  d.commands?.forEach((c) => {
    const id = byName.get(`command:${slug(c.name || '')}`);
    link(id, 'agent', c.agent);
    c.skills?.forEach((s) => link(id, 'skill', s));
  });

  const all = { nodes, edges };
  const agentNames = nodes.filter((n) => n.data.d.kind === 'agent').map((n) => (n.data.d as AgentData).name);
  const skillNames = nodes.filter((n) => n.data.d.kind === 'skill').map((n) => (n.data.d as SkillData).name);
  const commandNames = nodes.filter((n) => n.data.d.kind === 'command').map((n) => (n.data.d as CommandData).name);
  const ruleNames = nodes.filter((n) => n.data.d.kind === 'rule').map((n) => (n.data.d as RuleData).name);
  const mcpNames = nodes.filter((n) => n.data.d.kind === 'mcp').map((n) => (n.data.d as McpData).name);

  return {
    graph: all,
    agents: agentNames,
    skills: skillNames,
    commands: commandNames,
    rules: ruleNames,
    mcp: mcpNames,
  };
}

/**
 * Formatea la detección de un proyecto (stack, comandos, estructura)
 * en texto listo para enviar a la IA.
 */
export function scanContextFromDetection(det: {
  name: string;
  description: string;
  items: { id: string; label: string; category: string; version?: string }[];
  commands?: Partial<Record<'dev' | 'build' | 'test' | 'lint', string>>;
  structure: string;
  sources?: string[];
}): string {
  const tech = det.items.map((i) => `- **${i.label}${i.version ? ' ' + i.version : ''}** (${i.category})`).join('\n') || '(ninguna)';
  const cmds = ['dev', 'build', 'test', 'lint'] as const;
  const cmdLines = cmds.filter((k) => det.commands?.[k]?.trim()).map((k) => `\`${k}\` = ${det.commands![k]!.trim()}`).join('\n');
  const struct = det.structure ? det.structure.split('\n').map((s) => `  ${s}`).join('\n') : '';
  const sources = det.sources?.length ? det.sources.map((f) => `  - ${f}`).join('\n') : '';

  return [
    `# Proyecto detectado: ${det.name || 'sin nombre'}`,
    det.description ? `\n${det.description}` : '',
    sources ? `\nArchivos analizados:\n${sources}` : '',
    `\n# Tecnologías detectadas\n${tech}`,
    cmdLines ? `\n# Comandos detectados\n${cmdLines}` : '',
    struct ? `\n# Estructura de carpetas\n${struct}` : '',
    '\nBasate en las tecnologías y comandos detectados para generar la configuración. No inventes tecnologías que no están en el proyecto.',
  ].filter(Boolean).join('\n');
}
