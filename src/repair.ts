import { create } from 'zustand';
import { useStore, type FlowNode } from './store';
import { validate, issueKey, type Issue } from './validate';
import { assignNames, render } from './generators';
import { computeOutput } from './output';
import { emptyData, newCanaryPhrase, slug } from './defaults';
import { stripHiddenDeep } from './sanitize';
import { generateJSON } from './llm';
import { aiOf, hasAI } from './providers';
import { projectContext, SYSTEM, uiLangName } from './ai';
import { t } from './i18n';
import { auditDesign, EDITABLE, type AuditResult } from './audit';
import { TARGETS, TOOLS, type NodeData, type NodeKind, type ProjectData, type Review, type Target, type Tool } from './types';

/*
 * Reparación de problemas en rondas hasta que no quede nada que se pueda arreglar solo:
 * 1. arreglos fijos (sin IA, sin preguntar);
 * 2. la IA reescribe, en un solo pedido, todos los campos con problemas, con las mismas reglas que verifican los chequeos;
 * 3. se vuelve a validar: lo que la IA no pudo resolver en dos intentos, o lo que necesita un dato del usuario,
 *    se pregunta en un modal que se abre solo.
 * Todo lo decidido ("dejarlo así", hallazgos de auditoría ya tratados) se guarda en el proyecto para no volver a marcarlo.
 */

export interface Question {
  key: string;
  nodeId?: string;
  title: string;
  /** Problema detectado, para entender por qué se pregunta. */
  context?: string;
  options?: { id: string; label: string }[];
  multi?: boolean;
  inputs?: { id: string; label: string; placeholder?: string; multiline?: boolean }[];
  /** Guarda la respuesta; si devuelve texto, es una indicación para la IA en la siguiente ronda. */
  resolve: (a: Answer) => string | void;
}

export interface Answer {
  choice: string[];
  values: Record<string, string>;
  /** "Dejarlo así": no se vuelve a marcar. */
  ignore?: boolean;
}

interface RepairState {
  running: boolean;
  status: string;
  questions: Question[];
  showQuestions: boolean;
  report: string;
  audit: AuditResult | null;
  /** Se pidió una reparación automática (después de generar con IA, importar o aplicar plantillas). */
  requested: boolean;
}

export const useRepair = create<RepairState>()(() => ({
  running: false, status: '', questions: [], showQuestions: false, report: '', audit: null, requested: false,
}));

/** Pide reparar apenas el editor esté listo. */
export const requestRepair = () => useRepair.setState({ requested: true });

/* ---------- estado de una sesión de reparación ---------- */

/** Respuesta del usuario que la IA tiene que usar, con el nodo al que se refiere. */
interface Note {
  text: string;
  nodeId?: string;
}

let session = { attempts: new Map<string, number>(), asked: new Set<string>(), notes: [] as Note[], extra: [] as Issue[] };
const MAX_ROUNDS = 3;
const MAX_ATTEMPTS = 2;

const st = () => useStore.getState();
const project = () => st().nodes.find((n) => n.id === 'project')!.data.d as ProjectData;
const nodeById = (id?: string) => st().nodes.find((n) => n.id === id);
const labelOf = (d: NodeData) => `${d.kind === 'command' ? '/' : ''}${d.name}`;

export function currentIssues(includeIgnored = false): Issue[] {
  const s = st();
  const files = computeOutput(render(s, s.settings), s.fileOverrides, s.excluded);
  return validate(s, s.settings, files, { includeIgnored });
}

function updateReview(fn: (r: Review) => Review) {
  const r = project().review ?? { ignored: [], treated: [] };
  st().updateNode('project', { review: fn(r) } as Partial<ProjectData>);
}

export const ignoreIssue = (key: string) =>
  updateReview((r) => ({ ...r, ignored: [...new Set([...r.ignored, key])] }));

export const restoreIgnored = () => updateReview((r) => ({ ...r, ignored: [] }));

const markTreated = (texts: string[]) =>
  texts.length && updateReview((r) => ({ ...r, treated: [...new Set([...r.treated, ...texts])].slice(-40) }));

/* ---------- 1. arreglos fijos ---------- */

export function autoFix(issues: Issue[]): number {
  const g = st();
  const names = assignNames(g);
  const patches: { id: string; patch: Partial<NodeData> }[] = [];
  for (const i of issues) {
    const node = nodeById(i.nodeId);
    if (i.repair !== 'auto' || !node) continue;
    const d = node.data.d;
    const patch = ((): Partial<NodeData> | null => {
      switch (i.code) {
        case 'hidden': return stripHiddenDeep(d);
        case 'canary-empty': return d.kind === 'project' && d.canary ? { canary: { ...d.canary, phrase: newCanaryPhrase() } } as Partial<ProjectData> : null;
        case 'no-name': {
          const base = 'description' in d && d.description.trim() ? slug(d.description.split(/\s+/).slice(0, 3).join(' ')) : `${d.kind}-${node.id.slice(-4)}`;
          return { name: base };
        }
        case 'dup-name': return { name: names.get(node.id) ?? `${d.name}-2` };
        case 'args-hint': return { argumentHint: '[argumentos]' } as Partial<NodeData>;
        case 'args-unused': return d.kind === 'command' ? { prompt: `${d.prompt.trimEnd()}\n\nArgumentos: $ARGUMENTS` } : null;
        default: return null;
      }
    })();
    if (patch) patches.push({ id: node.id, patch });
  }
  g.patchNodes(patches);
  return patches.length;
}

/* ---------- preguntas para lo que solo sabe el usuario ---------- */

const patch = (id: string, p: Partial<NodeData>) => st().patchNodes([{ id, patch: p }]);
const remove = (id: string) => st().patchNodes([], [], [id]);

function questionFor(i: Issue): Question | null {
  const key = issueKey(i);
  const node = nodeById(i.nodeId);
  const d = node?.data.d;
  const base = { key, nodeId: i.nodeId, context: i.message };
  switch (i.code) {
    case 'no-targets':
      return {
        ...base, title: t('rep.q.targets'), multi: true,
        options: (Object.keys(TARGETS) as Target[]).map((t) => ({ id: t, label: TARGETS[t] })),
        resolve: (a) => void (a.choice.length && st().setSettings({ targets: a.choice as Target[] })),
      };
    case 'project-description':
      return {
        ...base, title: t('rep.q.description'),
        inputs: [{ id: 'description', label: t('rep.q.descriptionLabel'), multiline: true, placeholder: t('rep.q.descriptionPh') }],
        resolve: (a) => void (a.values.description?.trim() && patch('project', { description: a.values.description.trim() })),
      };
    case 'no-commands':
      return {
        ...base, title: t('rep.q.commands'),
        inputs: [
          { id: 'dev', label: t('rep.q.dev'), placeholder: 'npm run dev' },
          { id: 'build', label: t('rep.q.build'), placeholder: 'npm run build' },
          { id: 'test', label: t('rep.q.test'), placeholder: 'npm test' },
          { id: 'lint', label: t('rep.q.lint'), placeholder: 'npm run lint' },
        ],
        resolve: (a) => {
          const p = Object.fromEntries(Object.entries(a.values).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
          if (Object.keys(p).length) patch('project', p as Partial<ProjectData>);
        },
      };
    case 'test-gate':
      return {
        ...base, title: t('rep.q.testGate'),
        inputs: [{ id: 'test', label: t('rep.q.testCmd'), placeholder: 'npm test' }],
        options: [{ id: 'off', label: t('rep.q.noTestGate') }],
        resolve: (a) => {
          const p = project();
          if (a.choice.includes('off') && p.guards) patch('project', { guards: { ...p.guards, testGate: false } } as Partial<ProjectData>);
          else if (a.values.test?.trim()) patch('project', { test: a.values.test.trim() } as Partial<ProjectData>);
        },
      };
    case 'canary-empty':
      return {
        ...base, title: t('rep.q.canaryName'),
        inputs: [{ id: 'name', label: t('rep.q.name') }],
        resolve: (a) => {
          const c = project().canary;
          if (c && a.values.name?.trim()) patch('project', { canary: { ...c, phrase: a.values.name.trim() } } as Partial<ProjectData>);
        },
      };
    case 'rule-scope':
      return {
        ...base, title: t('rep.q.ruleScope', { name: d?.name ?? '' }),
        options: [{ id: 'always', label: t('rep.q.always') }],
        inputs: [{ id: 'globs', label: t('rep.q.globs'), placeholder: 'src/**/*.ts, *.sql' }],
        resolve: (a) => {
          if (a.choice.includes('always')) patch(i.nodeId!, { alwaysApply: true } as Partial<NodeData>);
          else if (a.values.globs?.trim()) patch(i.nodeId!, { globs: a.values.globs.trim() } as Partial<NodeData>);
        },
      };
    case 'mcp-command':
    case 'mcp-url': {
      const url = i.code === 'mcp-url';
      return {
        ...base, title: t(url ? 'rep.q.mcpUrl' : 'rep.q.mcpCommand', { name: d?.name ?? '' }),
        inputs: url
          ? [{ id: 'url', label: 'URL', placeholder: 'https://…/mcp' }]
          : [{ id: 'command', label: t('rep.q.command'), placeholder: 'npx' }, { id: 'args', label: t('rep.q.args'), placeholder: '-y @modelcontextprotocol/server-github' }],
        options: [{ id: 'delete', label: t('rep.q.delete') }],
        resolve: (a) => {
          if (a.choice.includes('delete')) return remove(i.nodeId!);
          const p = Object.fromEntries(Object.entries(a.values).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
          if (Object.keys(p).length) patch(i.nodeId!, p as Partial<NodeData>);
        },
      };
    }
    case 'stale-file':
      return {
        ...base, title: t('rep.q.stale', { path: i.path ?? '' }),
        options: [{ id: 'generated', label: t('rep.q.useGenerated') }, { id: 'mine', label: t('rep.q.keepMine') }],
        resolve: (a) => {
          const s = st();
          const o = s.fileOverrides[i.path!];
          if (!o) return;
          if (a.choice.includes('generated')) s.setOverride(i.path!, null);
          else if (a.choice.includes('mine')) {
            const gen = render(s, s.settings)[i.path!];
            if (gen !== undefined) s.setOverride(i.path!, { content: o.content, base: gen });
          }
        },
      };
  }
  return null;
}

/** Nodo sin nada de dónde deducir su propósito: la IA no puede adivinarlo. */
function isBlank(node: FlowNode): boolean {
  const d = node.data.d;
  if (d.kind === 'project' || d.kind === 'mcp') return false;
  const body = EDITABLE[d.kind].map((f) => String((d as unknown as Record<string, unknown>)[f] ?? '')).join('').trim();
  const defaultName = d.name === emptyData(d.kind).name;
  return !body && defaultName;
}

function purposeQuestion(node: FlowNode): Question {
  const d = node.data.d;
  return {
    key: `purpose:${node.id}`, nodeId: node.id,
    title: t('rep.q.purpose', { label: labelOf(d) }),
    context: t('rep.q.purposeWhy'),
    inputs: [
      { id: 'name', label: t('rep.q.nameOptional'), placeholder: d.name },
      { id: 'description', label: t('rep.q.whatWhen'), multiline: true },
    ],
    options: [{ id: 'delete', label: t('rep.q.delete') }],
    resolve: (a) => {
      if (a.choice.includes('delete')) return remove(node.id);
      const p: Record<string, string> = {};
      if (a.values.name?.trim()) p.name = slug(a.values.name);
      if (a.values.description?.trim()) p.description = a.values.description.trim();
      if (Object.keys(p).length) patch(node.id, p as Partial<NodeData>);
    },
  };
}

/** Pregunta abierta (de la IA o de la auditoría): la respuesta vuelve a la IA como indicación. */
const freeQuestion = (key: string, title: string, context: string | undefined, options: string[] = [], nodeId?: string): Question => ({
  key, nodeId, title, context,
  options: options.map((o, k) => ({ id: String(k), label: o })),
  inputs: [{ id: 'text', label: options.length ? t('rep.q.otherAnswer') : t('rep.q.answer'), multiline: true }],
  resolve: (a) => {
    const answer = [...a.choice.map((c) => options[Number(c)]), a.values.text?.trim()].filter(Boolean).join('. ');
    return answer ? `Pregunta: ${title}${context ? ` (${context})` : ''}\nRespuesta del usuario: ${answer}` : undefined;
  },
});

/* ---------- 2. corrección con IA ---------- */

const S = { type: 'STRING' };
const FIX_SCHEMA = {
  type: 'OBJECT',
  properties: {
    fixes: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { id: S, field: S, value: S }, required: ['id', 'field', 'value'] },
    },
    create: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { kind: { type: 'STRING', enum: ['agent', 'skill', 'command', 'rule'] }, name: S, description: S, body: S },
        required: ['kind', 'name', 'description', 'body'],
      },
    },
    questions: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { id: S, question: S, options: { type: 'ARRAY', items: S } }, required: ['question'] },
    },
  },
  required: ['fixes'],
};

/** Campos que la reparación puede tocar, además de los de texto. */
const FIXABLE: Record<NodeKind, string[]> = {
  ...EDITABLE,
  agent: [...EDITABLE.agent, 'tools'],
  command: [...EDITABLE.command, 'argumentHint'],
};
const BODY_OF: Record<'agent' | 'skill' | 'command' | 'rule', string> = { agent: 'prompt', skill: 'instructions', command: 'prompt', rule: 'content' };

/** Las mismas reglas que verifican quality.ts y validate.ts: lo que la IA escribe tiene que pasarlas. */
export const WRITING_RULES = `- Concreto y verificable. No uses: "apropiado", "adecuado", "cuando sea necesario", "si corresponde", "según convenga", "según sea necesario", "lo que haga falta", "etc.".
- No nombres principios abstractos (SOLID, DRY, KISS, YAGNI, clean code, buenas prácticas): escribí directamente la instrucción concreta, con un ejemplo corto.
- Descripción de agente o skill: una o dos frases (más de 25 caracteres) con qué hace y "Usar cuando …" (o su equivalente en el idioma del contenido). Tiene que distinguirse de las descripciones de los demás.
- Memoria del proyecto (memory): máximo 150 líneas; el detalle largo va a skills o reglas.
- Si un comando recibe argumentos, usá el marcador $ARGUMENTS y completá argumentHint.
- Agentes: tools con el mínimo privilegio que su tarea necesita.`;

interface FixResult {
  fixes: { id: string; field: string; value: string }[];
  create?: { kind: 'agent' | 'skill' | 'command' | 'rule'; name: string; description: string; body: string }[];
  questions?: { id?: string; question: string; options?: string[] }[];
}

async function aiFix(issues: Issue[], notes: Note[]): Promise<{ changed: number; questions: Question[] }> {
  const s = st();
  const byNode = new Map<string, Issue[]>();
  const loose: Issue[] = [];
  for (const i of issues) {
    if (i.nodeId && nodeById(i.nodeId)) byNode.set(i.nodeId, [...(byNode.get(i.nodeId) ?? []), i]);
    else loose.push(i);
  }
  for (const n of notes) if (n.nodeId && nodeById(n.nodeId) && !byNode.has(n.nodeId)) byNode.set(n.nodeId, []);
  const blocks = [...byNode].map(([id, list]) => {
    const d = nodeById(id)!.data.d;
    const fields = FIXABLE[d.kind]
      .map((f) => [f, (d as unknown as Record<string, unknown>)[f]] as const)
      .map(([f, v]) => `### ${f}\n${Array.isArray(v) ? v.join(', ') : String(v ?? '') || '(vacío)'}`)
      .join('\n');
    return `## [${d.kind}] id=${id} nombre=${d.name}\nProblemas:\n${[...new Set(list.map((i) => `- ${i.message}`))].join('\n') || '- (ver las respuestas del usuario)'}\n${fields}`;
  });

  const res = await generateJSON<FixResult>({
    ...aiOf(s.settings),
    system: SYSTEM(s.settings),
    temperature: 0.2,
    schema: FIX_SCHEMA,
    prompt: `Corregí los problemas de esta configuración de agentes de código.

Reglas para todo texto que escribas (se verifican automáticamente después; si no las cumplís, el problema vuelve a aparecer):
${WRITING_RULES}
- Devolvé cada campo COMPLETO corregido, no un fragmento, y un solo valor por campo que combine todas las correcciones de ese campo.
- Conservá lo que no tiene que ver con el problema, sobre todo lo que escribió el usuario.
- No inventes comandos, rutas, versiones ni decisiones. Si para corregir algo necesitás un dato que solo sabe el usuario, no lo corrijas: agregá una pregunta en questions (con id del nodo y opciones concretas si las hay). Escribí las preguntas y sus opciones en ${uiLangName(s.settings)}.
- fixes: id del nodo, field y value. Campos permitidos — project: ${FIXABLE.project.join('|')}; agent: ${FIXABLE.agent.join('|')}; skill: ${FIXABLE.skill.join('|')}; command: ${FIXABLE.command.join('|')}; rule: ${FIXABLE.rule.join('|')}.
- tools: lista separada por comas, solo de: ${TOOLS.join(', ')}.
- create: solo si un problema pide explícitamente agregar un agente, skill, comando o regla (o mover contenido de la memoria a una skill o regla). body = contenido completo.

CONTEXTO DEL PROYECTO:
${projectContext(s)}
${notes.length ? `\nRESPUESTAS DEL USUARIO (usalas para corregir):\n${notes.map((n) => n.text).join('\n\n')}\n` : ''}${loose.length ? `\nPROBLEMAS GENERALES:\n${loose.map((i) => `- ${i.message}`).join('\n')}\n` : ''}
PROBLEMAS POR NODO:
${blocks.join('\n\n') || '(ninguno)'}`,
  });

  const clean = stripHiddenDeep(res);
  const patches: { id: string; patch: Partial<NodeData> }[] = [];
  for (const f of clean.fixes ?? []) {
    const d = nodeById(f.id)?.data.d;
    if (!d || !FIXABLE[d.kind].includes(f.field) || !f.value?.trim()) continue;
    const value = f.field === 'tools'
      ? f.value.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter((t): t is Tool => (TOOLS as readonly string[]).includes(t))
      : f.value.trim();
    if (Array.isArray(value) && !value.length) continue;
    patches.push({ id: f.id, patch: { [f.field]: value } as Partial<NodeData> });
  }
  const added: FlowNode[] = (clean.create ?? []).map((c, k) => {
    const kind = c.kind;
    const pos = { x: kind === 'agent' ? 420 : kind === 'skill' ? 840 : -420, y: 1200 + k * 170 };
    const data = { ...emptyData(kind), name: slug(c.name), description: c.description, [BODY_OF[kind]]: c.body } as NodeData;
    return { id: `${kind}-${Math.random().toString(36).slice(2, 10)}`, type: 'card', position: pos, data: { d: data } };
  });
  s.patchNodes(patches, added);
  const questions = (clean.questions ?? []).filter((q) => q.question?.trim()).map((q, k) =>
    freeQuestion(`ai:${q.id ?? ''}:${slug(q.question).slice(0, 40)}:${k}`, q.question, undefined, q.options ?? [], nodeById(q.id)?.id));
  return { changed: patches.length + added.length, questions };
}

/* ---------- orquestación ---------- */

const addQuestions = (qs: Question[]) => {
  const have = new Set(useRepair.getState().questions.map((q) => q.key));
  const fresh = qs.filter((q) => !have.has(q.key));
  if (fresh.length) useRepair.setState((r) => ({ questions: [...r.questions, ...fresh], showQuestions: true }));
};

/**
 * Repara todo lo que se pueda. `audit` suma una auditoría con IA al principio.
 * `fresh` empieza una sesión nueva (se olvidan los intentos y las preguntas ya hechas).
 */
export async function repairAll(opts: { audit?: boolean; fresh?: boolean } = {}): Promise<void> {
  const r = useRepair.getState();
  if (r.running) return;
  if (opts.fresh) session = { attempts: new Map(), asked: new Set(), notes: [], extra: [] };
  useRepair.setState({ running: true, status: t('rep.checking'), requested: false });
  const hasKey = hasAI(st().settings);
  let changed = 0;
  const questions: Question[] = [];
  const ask = (q: Question | null) => {
    if (q && !session.asked.has(q.key)) {
      session.asked.add(q.key);
      questions.push(q);
    }
  };
  let auditNote = '';

  try {
    if (opts.audit && hasKey) {
      useRepair.setState({ status: t('rep.auditing') });
      const audit = await auditDesign();
      useRepair.setState({ audit });
      auditNote = t('rep.auditNote', { score: audit.score, n: audit.findings.length });
      for (const [k, f] of audit.findings.entries()) {
        const text = `${f.nodeLabel}: ${f.issue}`;
        if (f.question) ask(freeQuestion(`audit:${k}:${slug(f.issue).slice(0, 40)}`, f.question, text, [], f.nodeId));
        else if (!f.nodeId && f.kind !== 'project')
          ask(freeQuestion(`audit:${k}:${slug(f.issue).slice(0, 40)}`, t('rep.q.auditAdd', { suggestion: f.suggestion }), text, [t('rep.q.yesAdd'), t('rep.q.noNeed')], undefined));
        else session.extra.push({ level: f.severity, code: 'audit', repair: 'ai', message: `${f.issue} → ${f.suggestion}`, nodeId: f.nodeId });
      }
      markTreated(audit.findings.map((f) => `${f.nodeLabel}: ${f.issue}`));
    }

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      useRepair.setState({ status: t('rep.roundAuto', { n: round }) });
      changed += autoFix(currentIssues());

      const issues = currentIssues();
      for (const i of issues.filter((x) => x.repair === 'ask')) ask(questionFor(i));

      // Nodos vacíos: primero hay que saber para qué son.
      const blank = new Set(st().nodes.filter(isBlank).map((n) => n.id));
      for (const id of blank) ask(purposeQuestion(nodeById(id)!));

      if (!hasKey) break;
      const pending = [...issues.filter((i) => i.repair === 'ai' && !blank.has(i.nodeId ?? '') && (session.attempts.get(issueKey(i)) ?? 0) < MAX_ATTEMPTS), ...session.extra];
      session.extra = [];
      const notes = session.notes;
      session.notes = [];
      if (!pending.length && !notes.length) break;

      useRepair.setState({ status: t('rep.roundAI', { n: round, count: pending.length }) });
      const res = await aiFix(pending, notes);
      changed += res.changed;
      res.questions.forEach(ask);
      for (const i of pending) session.attempts.set(issueKey(i), (session.attempts.get(issueKey(i)) ?? 0) + 1);
    }

    // Lo que la IA no pudo resolver en dos intentos: se pregunta en vez de insistir.
    for (const i of currentIssues()) {
      if (i.repair === 'ai' && (session.attempts.get(issueKey(i)) ?? 0) >= MAX_ATTEMPTS)
        ask({ ...freeQuestion(issueKey(i), t('rep.q.couldNot'), i.message, [], i.nodeId) });
    }

    addQuestions(questions);
    const left = currentIssues().length;
    const pendingQ = useRepair.getState().questions.length;
    useRepair.setState({
      report: (changed ? t('rep.fixed', { n: changed }) : t('rep.nothing')) + auditNote +
        (pendingQ ? t('rep.questionsLeft', { n: pendingQ }) : left ? t('rep.warningsLeft', { n: left }) : t('rep.clean')) +
        (changed ? t('rep.undo') : '') +
        (!hasKey ? t('rep.noKey') : ''),
    });
  } finally {
    useRepair.setState({ running: false, status: '' });
  }
}

/** Aplica las respuestas del modal y, si hay algo nuevo para la IA, sigue reparando. */
export async function answerQuestions(answers: Map<string, Answer>): Promise<void> {
  const { questions } = useRepair.getState();
  const done = new Set<string>();
  const treated: string[] = [];
  for (const q of questions) {
    const a = answers.get(q.key);
    if (!a) continue;
    done.add(q.key);
    if (a.ignore) {
      if (q.key.startsWith('audit:') || q.key.startsWith('ai:')) treated.push(`${q.context ?? q.title} (el usuario decidió dejarlo así)`);
      else if (q.key.startsWith('purpose:')) currentIssues().filter((i) => i.nodeId === q.nodeId).forEach((i) => ignoreIssue(issueKey(i)));
      else ignoreIssue(q.key);
      continue;
    }
    const note = q.resolve(a);
    if (note) session.notes.push({ text: note, nodeId: q.nodeId });
    // Con la respuesta, la IA vuelve a intentarlo.
    session.attempts.delete(q.key);
  }
  markTreated(treated);
  useRepair.setState((r) => {
    const questions = r.questions.filter((q) => !done.has(q.key));
    return { questions, showQuestions: questions.length > 0 };
  });
  await repairAll();
}
