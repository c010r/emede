import { generateJSON } from './llm';
import { aiOf } from './providers';
import { SYSTEM, uiLangName } from './ai';
import { useStore, type Graph } from './store';
import { slug } from './defaults';
import type { NodeKind, ProjectData } from './types';

/*
 * Auditoría con IA de todo el diseño: busca lo que un chequeo estático no ve
 * (contradicciones, huecos, instrucciones que el agente no puede verificar).
 * Solo detecta: la corrección la hace la reparación (repair.ts), que junta todos los problemas
 * de un mismo campo en una sola reescritura y la verifica contra los chequeos automáticos.
 */

export interface AuditFinding {
  nodeId?: string;
  kind: NodeKind;
  nodeLabel: string;
  severity: 'error' | 'warn';
  issue: string;
  suggestion: string;
  /** Hace falta un dato o una decisión que solo tiene el usuario. */
  question?: string;
}

export interface AuditResult {
  score: number;
  summary: string;
  findings: AuditFinding[];
}

/** Campo de texto principal de cada tipo (el que la IA puede reescribir). */
export const EDITABLE: Record<NodeKind, string[]> = {
  project: ['memory', 'description', 'conventions'],
  agent: ['prompt', 'description'],
  skill: ['instructions', 'description'],
  command: ['prompt', 'description'],
  rule: ['content', 'description'],
  mcp: [],
  hook: ['description'],
};

const MAX_BODY = 4000;
const clip = (s: string) => (s.length > MAX_BODY ? `${s.slice(0, MAX_BODY)}\n[…recortado]` : s);

export function dump(g: Graph): string {
  return g.nodes.map((n) => {
    const d = n.data.d;
    const fields = EDITABLE[d.kind]
      .map((f) => [f, String((d as unknown as Record<string, unknown>)[f] ?? '')] as const)
      .filter(([, v]) => v.trim())
      .map(([f, v]) => `### ${f}\n${clip(v)}`)
      .join('\n');
    const extra = d.kind === 'agent' ? `\nherramientas: ${d.tools.join(', ')}` : d.kind === 'rule' ? `\nglobs: ${d.globs || '(siempre)'}` : '';
    return `## [${d.kind}] ${d.name}${extra}\n${fields || '(vacío)'}`;
  }).join('\n\n');
}

const S = { type: 'STRING' };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: { type: 'INTEGER', description: '0 a 100' },
    summary: S,
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['project', 'agent', 'skill', 'command', 'rule', 'mcp'] },
          name: S,
          severity: { type: 'STRING', enum: ['error', 'warn'] },
          issue: S,
          suggestion: S,
          question: S,
        },
        required: ['kind', 'name', 'severity', 'issue', 'suggestion'],
      },
    },
  },
  required: ['score', 'summary', 'findings'],
};

export async function auditDesign(): Promise<AuditResult> {
  const st = useStore.getState();
  const treated = (st.nodes.find((n) => n.id === 'project')?.data.d as ProjectData | undefined)?.review?.treated ?? [];
  const res = await generateJSON<{
    score: number; summary: string;
    findings: { kind: NodeKind; name: string; severity: AuditFinding['severity']; issue: string; suggestion: string; question?: string }[];
  }>({
    ...aiOf(st.settings),
    system: SYSTEM(st.settings),
    // Sin variación: la misma configuración tiene que dar el mismo resultado.
    temperature: 0,
    schema: SCHEMA,
    prompt: `Auditá esta configuración de agentes de código. Buscá solo problemas que cambian cómo trabaja el agente:
- Contradicciones entre la memoria, las reglas y los prompts de los agentes.
- Instrucciones que el agente no puede verificar ni cumplir (sin criterio de éxito).
- Descripciones de agentes y skills que no dejan claro cuándo usarlos, o que se pisan entre sí.
- Agentes con más permisos de los que su tarea necesita.
- Huecos: comandos, flujos o restricciones que el proyecto claramente necesita y faltan.
- Contenido que sobra en la memoria principal (se carga en cada sesión): conviene moverlo a skills o reglas.
No marques estilo, redacción ni preferencias. Máximo 8 hallazgos, los más importantes primero.
Si la configuración está bien, devolvé findings vacío: es un resultado válido y esperado después de una reparación. No busques problemas por cumplir.
Para cada hallazgo: kind y name del nodo (para el proyecto usá kind "project"; si falta un nodo, el kind y el nombre que tendría), severidad, problema y sugerencia concreta.
question: completala solo si corregirlo requiere un dato o una decisión que solo el usuario tiene (un comando, una ruta, una preferencia); formulala como pregunta directa. Si se puede corregir con lo que ya está, dejala vacía.
score: calidad general de 0 a 100.
Escribí summary, issue, suggestion y question en ${uiLangName(st.settings)} (el usuario las lee en la interfaz).
${treated.length ? `\nYA TRATADOS (corregidos o decididos por el usuario). No los vuelvas a reportar salvo que el texto actual todavía tenga exactamente ese problema:\n${treated.map((t) => `- ${t}`).join('\n')}\n` : ''}
CONFIGURACIÓN:
${dump(st)}`,
  });

  const findNode = (kind: NodeKind, name: string) =>
    st.nodes.find((n) => n.data.d.kind === kind && (slug(n.data.d.name) === slug(name) || kind === 'project'));

  return {
    score: Math.max(0, Math.min(100, Math.round(res.score))),
    summary: res.summary,
    findings: res.findings.map((f) => ({
      nodeId: findNode(f.kind, f.name)?.id,
      kind: f.kind,
      nodeLabel: `${f.kind === 'command' ? '/' : ''}${f.name}`,
      severity: f.severity === 'error' ? 'error' : 'warn',
      issue: f.issue,
      suggestion: f.suggestion,
      question: f.question?.trim() || undefined,
    })),
  };
}
