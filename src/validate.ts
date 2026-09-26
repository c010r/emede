import { t } from './i18n';
import type { Graph } from './store';
import { slug } from './defaults';
import { assignNames } from './generators';
import type { NodeData, Settings } from './types';
import { toWrite, type OutputFile } from './files';
import { ALWAYS_LOADED_WARN, formatTokens, sessionCost } from './tokens';
import { countHiddenDeep } from './sanitize';
import { minDescription, qualityIssues } from './quality';

export type Level = 'error' | 'warn' | 'info';

/**
 * Cómo se repara un problema:
 * auto = arreglo fijo sin preguntar · ai = lo reescribe la IA · ask = falta un dato o una decisión del usuario.
 */
export type Repair = 'auto' | 'ai' | 'ask';

export interface Issue {
  level: Level;
  /** Tipo de problema, estable (no depende del texto del mensaje). */
  code: string;
  repair: Repair;
  message: string;
  /** Nodo al que se refiere (para seleccionarlo al hacer click). */
  nodeId?: string;
  /** Archivo al que se refiere. */
  path?: string;
  /** Arreglo automático disponible. */
  fix?: 'strip-hidden';
}

/** Identifica un problema entre revisiones: mismo tipo sobre el mismo nodo o archivo. */
export const issueKey = (i: Pick<Issue, 'code' | 'nodeId' | 'path'>) => `${i.code}:${i.nodeId ?? i.path ?? ''}`;


const BODY: Partial<Record<NodeData['kind'], string>> = { agent: 'prompt', skill: 'instructions', command: 'prompt', rule: 'content' };


/** Revisa el diseño y los archivos generados en busca de problemas que afectan el funcionamiento de los agentes. */
export function validate(
  g: Graph, settings: Pick<Settings, 'targets'>, files: OutputFile[], opts: { includeIgnored?: boolean } = {},
): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Level, code: string, repair: Repair, message: string, nodeId?: string, path?: string, fix?: Issue['fix']) =>
    issues.push({ level, code, repair, message, nodeId, path, fix });

  // Caracteres invisibles: pueden esconder instrucciones que el modelo lee y una persona no ve.
  for (const n of g.nodes) {
    const count = countHiddenDeep(n.data.d);
    if (count)
      add('error', 'hidden', 'auto', t('val.hidden', { name: n.data.d.name || n.data.d.kind, n: count }), n.id, undefined, 'strip-hidden');
  }

  if (!settings.targets.length) add('error', 'no-targets', 'ask', t('val.noTargets'));

  const names = assignNames(g);
  const project = g.nodes.find((n) => n.data.d.kind === 'project')?.data.d;
  if (project?.kind === 'project') {
    if (!project.description.trim() && !project.memory.trim())
      add('info', 'project-description', 'ask', t('val.projectDescription'), 'project');
    if (project.guards?.enabled && project.guards.testGate && !project.test.trim())
      add('warn', 'test-gate', 'ask', t('val.testGate'), 'project');
    if (project.canary?.enabled && !project.canary.phrase.trim())
      add('warn', 'canary-empty', project.canary.style === 'name' ? 'ask' : 'auto', t('val.canaryEmpty'), 'project');
    if (!project.dev && !project.build && !project.test && !project.memory.trim())
      add('info', 'no-commands', 'ask', t('val.noCommands'), 'project');
  }

  for (const n of g.nodes) {
    const d = n.data.d;
    if (d.kind === 'project') continue;
    const label = `${d.kind === 'command' ? '/' : ''}${d.name || '(sin nombre)'}`;
    const unique = names.get(n.id);

    if (!d.name.trim()) add('error', 'no-name', 'auto', t('val.noName', { kind: t(`kind.${d.kind}`) }), n.id);
    else if (unique && unique !== slug(d.name))
      add('warn', 'dup-name', 'auto', t('val.dupName', { label, kind: t(`kind.${d.kind}`), unique }), n.id);

    if ('description' in d) {
      const desc = d.description.trim();
      if (!desc) {
        const key = d.kind === 'agent' || d.kind === 'skill';
        add(key ? 'error' : 'warn', 'no-description', 'ai', t(key ? 'val.noDescAgent' : 'val.noDescOther', { label }), n.id);
      } else if ((d.kind === 'agent' || d.kind === 'skill') && desc.length < minDescription(desc))
        add('info', 'short-description', 'ai', t('val.shortDesc', { label }), n.id);
    }

    const body = BODY[d.kind];
    if (body && !String((d as unknown as Record<string, string>)[body] ?? '').trim())
      add('warn', 'no-body', 'ai', t('val.noBody', { label, field: t(`val.body.${d.kind as 'agent'}`) }), n.id);

    if (d.kind === 'agent' && !d.tools.length) add('warn', 'no-tools', 'ai', t('val.noTools', { label }), n.id);

    if (d.kind === 'command') {
      const usesArgs = d.prompt.includes('$ARGUMENTS');
      if (usesArgs && !d.argumentHint.trim()) add('info', 'args-hint', 'auto', t('val.argsHint', { label }), n.id);
      if (d.argumentHint.trim() && d.prompt.trim() && !usesArgs)
        add('info', 'args-unused', 'auto', t('val.argsUnused', { label }), n.id);
    }

    if (d.kind === 'rule' && !d.alwaysApply && !d.globs.trim())
      add('warn', 'rule-scope', 'ask', t('val.ruleScope', { label }), n.id);

    if (d.kind === 'mcp') {
      if (d.transport === 'stdio' && !d.command.trim()) add('error', 'mcp-command', 'ask', t('val.mcpCommand', { label }), n.id);
      if (d.transport === 'http' && !/^https?:\/\//.test(d.url.trim())) add('error', 'mcp-url', 'ask', t('val.mcpUrl', { label }), n.id);
    }
  }

  // Lo que cada herramienta carga en todas las sesiones (memoria + reglas que aplican siempre).
  const seen = new Set<string>();
  for (const c of sessionCost(toWrite(files), settings.targets)) {
    const key = c.files.join(', ');
    if (c.tokens <= ALWAYS_LOADED_WARN || seen.has(key)) continue;
    seen.add(key);
    add('warn', 'memory-long', 'ai', t('val.memoryLong', { path: key, n: formatTokens(c.tokens) }), 'project', c.files[0]);
  }
  for (const f of files) {
    if (!f.excluded && f.stale) add('warn', 'stale-file', 'ask', t('val.stale', { path: f.path }), undefined, f.path);
  }

  for (const q of qualityIssues(g)) add(q.level, q.code, 'ai', q.message, q.nodeId);

  const ignored = new Set(project?.kind === 'project' ? project.review?.ignored ?? [] : []);
  const order: Record<Level, number> = { error: 0, warn: 1, info: 2 };
  return issues
    .filter((i) => opts.includeIgnored || !ignored.has(issueKey(i)))
    .sort((a, b) => order[a.level] - order[b.level]);
}
