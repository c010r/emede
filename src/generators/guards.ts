import { ct, type ContentKey } from './content';
import type { Guards, Lang, ProjectData } from '../types';

/*
 * Guardarraíles: lo que se tiene que cumplir se aplica con los mecanismos de cada herramienta
 * (permisos, sandbox, hooks, archivos ignorados). La sección de memoria queda como respaldo para las que no los tienen.
 * Formatos verificados contra la documentación oficial el 2026-09-26.
 */

const lines = (s = '') => s.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const uniq = <T,>(a: T[]) => [...new Set(a)];

/** Guardarraíles efectivos: listas limpias y comandos del proyecto (test, lint) aprobados automáticamente. */
export interface ResolvedGuards {
  protect: string[];
  deny: string[];
  ask: string[];
  allow: string[];
  format: string;
  /** Comando de tests que debe pasar antes de terminar (vacío = sin control). */
  gate: string;
  sandbox: Guards['sandbox'];
  network: boolean;
}

export function resolveGuards(p: ProjectData): ResolvedGuards | null {
  const g = p.guards;
  if (!g?.enabled) return null;
  return {
    protect: uniq(lines(g.protectPaths)),
    deny: uniq(lines(g.denyCommands)),
    ask: uniq(lines(g.askCommands)),
    allow: uniq([...lines(g.allowCommands), p.test, p.lint].map((c) => c?.trim()).filter(Boolean) as string[]),
    format: g.formatCommand.trim(),
    gate: g.testGate ? p.test.trim() : '',
    sandbox: g.sandbox,
    network: g.network,
  };
}

/** Script de guarda que usan los hooks (Node corre igual en Windows, macOS y Linux). */
export const GUARD_SCRIPT = 'scripts/agent-guard.mjs';
export const needsScript = (g: ResolvedGuards, targets: { cursor: boolean; gemini: boolean; claude: boolean }) =>
  ((targets.cursor || targets.gemini) && (g.deny.length > 0 || (targets.cursor && g.ask.length > 0))) || (targets.claude && !!g.gate);

/* ---------- Claude Code: .claude/settings.json ---------- */

/** Regla de ruta de Claude: relativa al proyecto con "./". */
const claudePath = (p: string) => (p.startsWith('/') || p.startsWith('~') || p.startsWith('./') ? p : `./${p}`);
const claudeBash = (c: string) => [`Bash(${c})`, `Bash(${c} *)`];

export function claudeSettings(g: ResolvedGuards) {
  const hooks: Record<string, unknown[]> = {};
  if (g.format) hooks.PostToolUse = [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: g.format }] }];
  if (g.gate) hooks.Stop = [{ hooks: [{ type: 'command', command: `node ${GUARD_SCRIPT} gate` }] }];
  return {
    permissions: {
      ...(g.allow.length ? { allow: g.allow.flatMap(claudeBash) } : {}),
      ...(g.ask.length ? { ask: g.ask.flatMap(claudeBash) } : {}),
      deny: [
        ...g.protect.flatMap((p) => [`Read(${claudePath(p)})`, `Edit(${claudePath(p)})`]),
        ...g.deny.flatMap(claudeBash),
      ],
    },
    ...(Object.keys(hooks).length ? { hooks } : {}),
  };
}

/* ---------- OpenCode: permission en opencode.json ---------- */

export function opencodePermission(g: ResolvedGuards) {
  const bash: Record<string, string> = {};
  // En OpenCode gana la última regla que coincide: primero lo permitido, al final lo prohibido.
  for (const c of g.allow) Object.assign(bash, { [c]: 'allow', [`${c} *`]: 'allow' });
  for (const c of g.ask) Object.assign(bash, { [c]: 'ask', [`${c} *`]: 'ask' });
  for (const c of g.deny) Object.assign(bash, { [c]: 'deny', [`${c} *`]: 'deny' });
  const files = Object.fromEntries(g.protect.map((p) => [p, 'deny']));
  return {
    ...(Object.keys(bash).length ? { bash } : {}),
    ...(g.protect.length ? { read: files, edit: files } : {}),
  };
}

/* ---------- Codex: sandbox y aprobaciones en .codex/config.toml ---------- */

export function codexConfig(g: ResolvedGuards): string {
  return [
    `sandbox_mode = "${g.sandbox}"`,
    'approval_policy = "on-request"',
    '',
    '[sandbox_workspace_write]',
    `network_access = ${g.network}`,
  ].join('\n');
}

/* ---------- Gemini CLI: tools y hooks en .gemini/settings.json ---------- */

export function geminiSettings(g: ResolvedGuards) {
  const shell = (c: string) => `run_shell_command(${c})`;
  const hooks: Record<string, unknown[]> = {};
  if (g.deny.length)
    hooks.BeforeTool = [{ matcher: 'run_shell_command', hooks: [{ name: 'emede-guard', type: 'command', command: `node ${GUARD_SCRIPT} shell`, timeout: 10000 }] }];
  if (g.format)
    hooks.AfterTool = [{ matcher: 'write_file|replace', hooks: [{ name: 'emede-format', type: 'command', command: g.format, timeout: 120000 }] }];
  const tools = {
    ...(g.allow.length ? { allowed: g.allow.map(shell) } : {}),
    ...(g.ask.length ? { confirmationRequired: g.ask.map(shell) } : {}),
  };
  return {
    ...(Object.keys(tools).length ? { tools } : {}),
    ...(Object.keys(hooks).length ? { hooks } : {}),
  };
}

/* ---------- Cursor: .cursor/hooks.json ---------- */

export function cursorHooks(g: ResolvedGuards) {
  const hooks: Record<string, unknown[]> = {};
  if (g.deny.length || g.ask.length) hooks.beforeShellExecution = [{ command: `node ${GUARD_SCRIPT} shell --cursor` }];
  if (g.format) hooks.afterFileEdit = [{ command: g.format }];
  return Object.keys(hooks).length ? { version: 1, hooks } : null;
}

/** Archivos que el agente no debe ver (.geminiignore, .cursorignore), en formato gitignore. */
export const ignoreFile = (g: ResolvedGuards, lang: Lang) =>
  g.protect.length
    ? `# ${ct(lang, 'ignoreHeader')}\n${g.protect.join('\n')}\n`
    : '';

/* ---------- respaldo en la memoria ---------- */

const code = (xs: string[]) => xs.map((x) => `\`${x}\``).join(', ');

export function guardsSection(g: ResolvedGuards, lang: Lang): string {
  const c = (k: ContentKey) => ct(lang, k);
  const out = [`## ${c('guardsTitle')}`, ''];
  if (g.protect.length) out.push(`- ${c('neverRead')}: ${code(g.protect)}.`);
  if (g.deny.length) out.push(`- ${c('neverRun')}: ${code(g.deny)}.`);
  if (g.ask.length) out.push(`- ${c('askBefore')}: ${code(g.ask)}.`);
  if (g.format) out.push(`- ${c('afterEdit')} \`${g.format}\`.`);
  if (g.gate) out.push(`- ${c('beforeFinish')} \`${g.gate}\` ${c('andPass')}.`);
  return out.length > 2 ? out.join('\n') : '';
}

/* ---------- script de guarda ---------- */

export function guardScript(g: ResolvedGuards, lang: Lang): string {
  const msg = { denied: ct(lang, 'guardDenied'), ask: ct(lang, 'guardAsk'), failing: ct(lang, 'guardFailing') };
  return `#!/usr/bin/env node
// Generado por emede: guardarraíl para agentes de código (Claude Code, Cursor, Gemini CLI).
//   node ${GUARD_SCRIPT} shell [--cursor]  bloquea comandos prohibidos (sale con código 2)
//   node ${GUARD_SCRIPT} gate              exige que pasen los tests antes de que el agente termine
// Editá las listas desde emede y volvé a generar; los cambios manuales se pierden.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DENY = ${JSON.stringify(g.deny)};
const ASK = ${JSON.stringify(g.ask)};
const TEST = ${JSON.stringify(g.gate)};

const mode = process.argv[2];
const cursor = process.argv.includes('--cursor');
let payload = {};
try {
  payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  payload = {};
}

if (mode === 'shell') {
  const command = String(payload.command ?? payload.tool_input?.command ?? payload.toolInput?.command ?? '');
  // Se revisa cada tramo de una línea compuesta: "npm test && git push --force".
  const parts = command.split(/&&|\\|\\||;|\\||\\n/).map((s) => s.trim().replace(/\\s+/g, ' '));
  const match = (list) => list.find((p) => parts.some((c) => c === p || c.startsWith(p + ' ')));
  const denied = match(DENY);
  if (denied) {
    process.stderr.write(${JSON.stringify(msg.denied)} + ': ' + denied + '\\n');
    if (cursor) process.stdout.write(JSON.stringify({ permission: 'deny', user_message: ${JSON.stringify(msg.denied)} + ': ' + denied }));
    process.exit(2);
  }
  if (cursor && match(ASK)) process.stdout.write(JSON.stringify({ permission: 'ask', user_message: ${JSON.stringify(msg.ask)} }));
  process.exit(0);
}

if (mode === 'gate') {
  // Si el agente ya reintentó por este control, no se lo vuelve a frenar (evita un bucle).
  if (!TEST || payload.stop_hook_active) process.exit(0);
  try {
    execSync(TEST, { stdio: 'pipe' });
    process.exit(0);
  } catch (e) {
    const out = String(e.stdout ?? '') + String(e.stderr ?? '');
    process.stderr.write(${JSON.stringify(msg.failing)} + ' (' + TEST + '):\\n' + out.split('\\n').slice(-40).join('\\n'));
    process.exit(2);
  }
}
`;
}
