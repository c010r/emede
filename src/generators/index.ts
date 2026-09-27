import { ct, type ContentKey } from './content';
import { t } from '../i18n';
import type { Graph } from '../store';
import { slug } from '../defaults';
import { stackLines } from '../stack';
import { stripHidden } from '../sanitize';
import type {
  AgentData, Canary, CommandData, FileMap, Lang, McpData, NodeData, NodeKind, ProjectData, RuleData, Settings, SkillData, Target, Tool,
} from '../types';
import { kvObject, REF_SYNTAX, resolveMcp, type ResolvedMcp } from './secrets';
import {
  claudeSettings, codexConfig, cursorHooks, geminiSettings, GUARD_SCRIPT, guardScript, guardsSection, ignoreFile,
  needsScript, opencodePermission, resolveGuards, type ResolvedGuards,
} from './guards';

/*
 * Formatos verificados contra la documentación oficial el 2026-09-25:
 * - Claude Code: .claude/agents (skills como lista YAML), .claude/skills, .claude/commands, .claude/rules (paths), .mcp.json (${VAR})
 * - OpenCode:    .opencode/agents (permission), .opencode/commands, skills desde .claude/skills o .agents/skills, opencode.json ({env:VAR})
 * - Codex CLI:   .codex/agents/*.toml, skills en .agents/skills (los custom prompts están obsoletos), .codex/config.toml (env_vars)
 * - Gemini CLI:  .gemini/agents, skills en .agents/skills, .gemini/commands/*.toml, .gemini/settings.json ($VAR)
 * - Cursor:      .cursor/agents, .cursor/skills, .cursor/rules/*.mdc, .cursor/mcp.json (${env:VAR})
 * - Copilot:     .github/agents/*.agent.md, skills desde .claude/skills o .agents/skills, .github/prompts, .vscode/mcp.json (inputs)
 * - Roo Code:    AGENTS.md (compartido), modos en .roomodes (agentes), skills en .agents/skills, .roo/commands/*.md, .roo/mcp.json
 *   Verificado el 2026-09-27 contra el código fuente de RooCodeInc/Roo-Code (packages/types/src/mode.ts, tool.ts,
 *   src/services/mcp/McpHub.ts, src/services/command/commands.ts, src/services/skills/SkillsManager.ts,
 *   src/core/prompts/sections/custom-instructions.ts) en vez de la documentación publicada: docs.roocode.com no
 *   fue alcanzable desde este entorno. .roo/mcp.json no tiene sintaxis de referencia a variables de entorno (los
 *   valores son literales), así que los secretos se dejan en blanco (ver noteFor).
 */

/* ---------- utilidades de formato ---------- */

const yamlValue = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map((x) => yamlValue(x)).join(', ')}]`;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  return /^[\w .,/@()-]*$/.test(s) && !/^(true|false|null|yes|no|[\d.]+)$/i.test(s) && s.trim() === s && s !== ''
    ? s
    : JSON.stringify(s);
};

/** Frontmatter YAML; omite claves vacías. Soporta un nivel de mapas anidados. */
export function frontmatter(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v)) lines.push(`  ${k2}: ${yamlValue(v2)}`);
    } else lines.push(`${k}: ${yamlValue(v)}`);
  }
  return `---\n${lines.join('\n')}\n---\n\n`;
}

const tomlString = (s: string) => JSON.stringify(s);
const tomlMultiline = (s: string) => `"""\n${s.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')}\n"""`;
const tomlInline = (o: Record<string, string>) => `{ ${Object.entries(o).map(([k, v]) => `${tomlString(k)} = ${tomlString(v)}`).join(', ')} }`;

const splitArgs = (s: string) => s.match(/"[^"]*"|'[^']*'|\S+/g)?.map((a) => a.replace(/^["']|["']$/g, '')) ?? [];

const clean = (s: string) => s.trim().replace(/\n{3,}/g, '\n\n');
const json = (o: unknown) => JSON.stringify(o, null, 2) + '\n';

/* ---------- textos del andamiaje (en el idioma del contenido, ver content.ts) ---------- */

function texts(lang: Lang) {
  const c = (key: ContentKey, vars?: Record<string, string>) => ct(lang, key, vars);
  return {
    rules: c('rules'), appliesTo: c('appliesTo'), agents: c('agents'), skills: c('skills'),
    delegate: (a: string) => c('delegate', { a }),
    useSkills: (s: string) => c('useSkills', { s }),
    args: c('args'),
    overview: c('overview'), stack: c('stack'), cmds: c('cmds'), structure: c('structure'), conventions: c('conventions'),
    mcp: (m: string) => c('mcp', { m }),
    cmdSkill: (n: string, d: string) => c('cmdSkill', { n, d }).trim(),
    envExample: c('envExample'),
    plan: c('plan'),
    canary: (k: Canary) => [
      `## ${c('canaryTitle')}`,
      '',
      c(k.style === 'name' ? 'canaryName' : 'canaryMarker', { phrase: k.phrase }),
      '',
      `- ${c('canaryRule1')}`,
      `- ${c('canaryRule2')}`,
      `- ${c('canaryRule3')}`,
    ].join('\n'),
    agentCanary: (k: Canary) => c(k.style === 'name' ? 'agentCanaryName' : 'agentCanaryMarker', { phrase: k.phrase }),
  };
}

/* ---------- nombres únicos ---------- */

/**
 * Asigna a cada nodo un nombre de archivo único dentro de su tipo.
 * Dos nodos que normalizan al mismo nombre ("Code Reviewer" y "code-reviewer") reciben sufijos -2, -3…
 * en vez de pisarse en silencio.
 */
export function assignNames(g: Graph): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Map<NodeKind, Set<string>>();
  for (const n of g.nodes) {
    const d = n.data.d;
    if (d.kind === 'project') continue;
    const set = used.get(d.kind) ?? new Set<string>();
    used.set(d.kind, set);
    const base = slug(d.name);
    let name = base;
    for (let i = 2; set.has(name); i++) name = `${base}-${i}`;
    set.add(name);
    out.set(n.id, name);
  }
  return out;
}

/* ---------- modelo intermedio ---------- */

type Agent = AgentData & { skills: string[]; mcp: string[] };
type Command = CommandData & { agent?: string; skills: string[] };
type Mcp = McpData & { r: ResolvedMcp };

interface Model {
  t: ReturnType<typeof texts>;
  lang: Lang;
  project: ProjectData;
  /** Guardarraíles activos del proyecto (null si están apagados). */
  guards: ResolvedGuards | null;
  agents: Agent[];
  skills: SkillData[];
  commands: Command[];
  rules: RuleData[];
  mcp: Mcp[];
}

function buildModel(g: Graph, lang: Lang): Model {
  const names = assignNames(g);
  const of = <K extends NodeKind>(kind: K) =>
    g.nodes.filter((n) => n.data.d.kind === kind).map((n) => ({ ...(n.data.d as Extract<NodeData, { kind: K }>), id: n.id, name: names.get(n.id)! }));
  const links = (id: string, kind: NodeKind) =>
    g.edges.filter((e) => e.source === id).map((e) => g.nodes.find((n) => n.id === e.target))
      .filter((n) => n?.data.d.kind === kind).map((n) => names.get(n!.id)!);
  const project = g.nodes.find((n) => n.data.d.kind === 'project')!.data.d as ProjectData;
  return {
    t: texts(lang),
    lang,
    project,
    guards: resolveGuards(project),
    agents: of('agent').map((a) => ({ ...a, skills: links(a.id, 'skill'), mcp: links(a.id, 'mcp') })),
    skills: of('skill'),
    commands: of('command').map((c) => ({ ...c, agent: links(c.id, 'agent')[0], skills: links(c.id, 'skill') })),
    rules: of('rule'),
    mcp: of('mcp').map((s) => ({ ...s, r: resolveMcp(s) })),
  };
}

/* ---------- piezas compartidas ---------- */

/** Memoria principal, con la referencia al plan si el proyecto tiene uno. */
function memoryBody(m: Model): string {
  const guards = m.guards ? guardsSection(m.guards, m.lang) : '';
  const body = withCanary(m, baseMemory(m)) + (guards ? `\n\n${guards}` : '');
  return m.project.plan?.trim() ? `${body}\n\n${m.t.plan}` : body;
}

const activeCanary = (m: Model) => (m.project.canary?.enabled && m.project.canary.phrase.trim() ? m.project.canary : null);

/**
 * Inserta el canario antes de la primera sección (después del título y la introducción), donde el agente lo lee primero.
 * No va pegado al título para no "adueñarse" del párrafo de introducción.
 * Si la marca deja de aparecer en las respuestas, el agente perdió estas instrucciones.
 */
function withCanary(m: Model, body: string): string {
  const c = activeCanary(m);
  if (!c) return body;
  const section = m.t.canary({ ...c, phrase: c.phrase.trim() });
  const firstSection = body.search(/^## /m);
  return firstSection >= 0
    ? clean(`${body.slice(0, firstSection).trimEnd()}\n\n${section}\n\n${body.slice(firstSection)}`)
    : clean(`${body}\n\n${section}`);
}

function baseMemory(m: Model): string {
  const p = m.project;
  if (p.memory.trim()) return clean(p.memory);
  const t = m.t;
  const cmds = [['dev', p.dev], ['build', p.build], ['test', p.test], ['lint', p.lint]].filter(([, v]) => v);
  return clean(
    [
      `# ${p.name}`,
      p.description && `## ${t.overview}\n\n${p.description}`,
      (p.stackItems?.length || p.stack) &&
        `## ${t.stack}\n\n${[stackLines(p.stackItems ?? []).map((l) => `- ${l}`).join('\n'), p.stack].filter(Boolean).join('\n\n')}`,
      cmds.length && `## ${t.cmds}\n\n\`\`\`bash\n${cmds.map(([k, v]) => `${v}  # ${k}`).join('\n')}\n\`\`\``,
      p.structure && `## ${t.structure}\n\n${p.structure}`,
      p.conventions && `## ${t.conventions}\n\n${p.conventions}`,
    ].filter(Boolean).join('\n\n'),
  );
}

const ruleSection = (m: Model, rules: RuleData[]) =>
  rules.length
    ? `## ${m.t.rules}\n\n` +
      rules.map((r) => `### ${r.name}\n${r.globs && !r.alwaysApply ? `\n_${m.t.appliesTo}: \`${r.globs}\`_\n` : ''}\n${clean(r.content || r.description)}`).join('\n\n')
    : '';

const index = (title: string, items: { name: string; description: string }[]) =>
  items.length ? `## ${title}\n\n${items.map((a) => `- \`${a.name}\`${a.description ? `: ${a.description}` : ''}`).join('\n')}` : '';
const agentIndex = (m: Model) => index(m.t.agents, m.agents);
const skillIndex = (m: Model) => index(m.t.skills, m.skills);

function agentBody(m: Model, a: Agent): string {
  const c = activeCanary(m);
  const extras = [
    a.mcp.length ? m.t.mcp(a.mcp.join(', ')) : '',
    a.skills.length ? m.t.useSkills(a.skills.join(', ')) : '',
    c?.agents ? m.t.agentCanary({ ...c, phrase: c.phrase.trim() }) : '',
  ].filter(Boolean).join('\n');
  return clean(`${clean(a.prompt || a.description)}${extras ? `\n\n${extras}` : ''}`);
}

type ArgStyle = 'dollar' | 'gemini' | 'copilot' | 'inline';
function commandBody(m: Model, c: Command, args: ArgStyle, delegate: boolean): string {
  const pre: string[] = [];
  if (c.agent && delegate) pre.push(m.t.delegate(c.agent));
  if (c.skills.length) pre.push(m.t.useSkills(c.skills.join(', ')));
  let body = clean(c.prompt || c.description);
  const repl = { dollar: '$ARGUMENTS', gemini: '{{args}}', copilot: `\${input:args:${c.argumentHint || 'args'}}`, inline: m.t.args }[args];
  if (args !== 'dollar') body = body.replaceAll('$ARGUMENTS', repl);
  if (c.argumentHint && !body.includes(repl) && args !== 'inline') body += `\n\n${repl}`;
  return clean([...pre, body].join('\n\n'));
}

const join = (...parts: string[]) => clean(parts.filter((p) => p && p.trim()).join('\n\n')) + '\n';

const skillFile = (s: SkillData) => frontmatter({ name: s.name, description: s.description }) + clean(s.instructions || s.description) + '\n';

/** Un comando convertido en skill de invocación explícita (Codex y Cursor ya no usan archivos de comandos). */
const commandSkillFile = (m: Model, c: Command, name: string) =>
  frontmatter({
    name,
    description: m.t.cmdSkill(c.name, c.description),
    'argument-hint': c.argumentHint,
    'disable-model-invocation': true,
  }) + commandBody(m, c, 'inline', true) + '\n';

/** Nombre de carpeta para la skill de un comando, sin chocar con una skill real del mismo nombre. */
const commandSkillName = (m: Model, c: Command) => (m.skills.some((s) => s.name === c.name) ? `cmd-${c.name}` : c.name);

const hasEdit = (a: Agent) => a.tools.includes('edit') || a.tools.includes('write');
const readOnly = (a: Agent) => !hasEdit(a) && !a.tools.includes('bash');

/** Grupos de herramientas de un modo de Roo Code: no tiene "web" ni "search" propios (van dentro de "read"). */
function rooGroups(a: Agent): string[] {
  const groups: string[] = [];
  if (a.tools.includes('read') || a.tools.includes('search')) groups.push('read');
  if (hasEdit(a)) groups.push('edit');
  if (a.tools.includes('bash')) groups.push('command');
  if (a.mcp.length) groups.push('mcp');
  return groups;
}

/* ---------- MCP ---------- */

function mcpStdio(s: Mcp, ref: (v: string) => string) {
  return { command: s.command, args: splitArgs(s.args), ...(s.r.env.length ? { env: kvObject(s.r.env, ref) } : {}) };
}

function envExample(m: Model): string | undefined {
  const rows = m.mcp.flatMap((s) => s.r.secrets.map((v) => `${v}=    # ${s.name}`));
  return rows.length ? `# ${m.t.envExample}\n${[...new Set(rows)].join('\n')}\n` : undefined;
}

/* ---------- adaptadores ---------- */

const CLAUDE_TOOLS: Record<Tool, string[]> = {
  read: ['Read'], edit: ['Edit'], write: ['Write'], bash: ['Bash'], search: ['Grep', 'Glob'], web: ['WebFetch', 'WebSearch'],
};
const CLAUDE_MODEL = { inherit: undefined, fast: 'haiku', balanced: 'sonnet', powerful: 'opus' };

function claude(m: Model, f: FileMap) {
  const always = m.rules.filter((r) => r.alwaysApply || !r.globs.trim());
  f['CLAUDE.md'] = join(memoryBody(m), ruleSection(m, always), agentIndex(m));
  for (const r of m.rules.filter((r) => !always.includes(r)))
    f[`.claude/rules/${r.name}.md`] =
      frontmatter({ paths: r.globs.split(',').map((g) => g.trim()).filter(Boolean) }) + clean(r.content || r.description) + '\n';
  for (const a of m.agents)
    f[`.claude/agents/${a.name}.md`] =
      frontmatter({
        name: a.name,
        description: a.description,
        tools: a.tools.length === 6 ? undefined : [...new Set(a.tools.flatMap((t) => CLAUDE_TOOLS[t]))].join(', '),
        model: CLAUDE_MODEL[a.model],
        skills: a.skills,
      }) + agentBody(m, a) + '\n';
  for (const s of m.skills) f[`.claude/skills/${s.name}/SKILL.md`] = skillFile(s);
  for (const c of m.commands)
    f[`.claude/commands/${c.name}.md`] =
      frontmatter({ description: c.description, 'argument-hint': c.argumentHint }) + commandBody(m, c, 'dollar', true) + '\n';
  if (m.mcp.length)
    f['.mcp.json'] = json({
      mcpServers: Object.fromEntries(m.mcp.map((s) => [s.name, s.transport === 'http'
        ? { type: 'http', url: s.url, ...(s.r.headers.length ? { headers: kvObject(s.r.headers, REF_SYNTAX.claude) } : {}) }
        : mcpStdio(s, REF_SYNTAX.claude)])),
    });
  if (m.guards) f['.claude/settings.json'] = json(claudeSettings(m.guards));
}

/** AGENTS.md: lo leen OpenCode y Codex (y también Cursor y Copilot). */
const agentsMd = (m: Model) => join(memoryBody(m), ruleSection(m, m.rules), agentIndex(m), skillIndex(m));

/** Skills compartidas: .agents/skills lo leen Codex, Gemini CLI, Cursor, Copilot y OpenCode. */
function sharedSkills(m: Model, f: FileMap) {
  for (const s of m.skills) f[`.agents/skills/${s.name}/SKILL.md`] = skillFile(s);
}

function opencode(m: Model, f: FileMap) {
  f['AGENTS.md'] = agentsMd(m);
  for (const a of m.agents) {
    const permission = {
      ...(hasEdit(a) ? {} : { edit: 'deny' }),
      ...(a.tools.includes('bash') ? {} : { bash: 'deny' }),
      ...(a.tools.includes('web') ? {} : { webfetch: 'deny' }),
    };
    f[`.opencode/agents/${a.name}.md`] =
      frontmatter({ description: a.description, mode: 'subagent', permission: Object.keys(permission).length ? permission : undefined }) +
      agentBody(m, a) + '\n';
  }
  for (const c of m.commands)
    f[`.opencode/commands/${c.name}.md`] =
      frontmatter({ description: c.description, agent: c.agent, subtask: c.agent ? true : undefined }) +
      commandBody(m, c, 'dollar', false) + '\n';
  const permission = m.guards ? opencodePermission(m.guards) : {};
  if (m.mcp.length || Object.keys(permission).length)
    f['opencode.json'] = json({
      $schema: 'https://opencode.ai/config.json',
      ...(Object.keys(permission).length ? { permission } : {}),
      ...(m.mcp.length ? {
        mcp: Object.fromEntries(m.mcp.map((s) => [s.name, s.transport === 'http'
          ? { type: 'remote', url: s.url, enabled: true, ...(s.r.headers.length ? { headers: kvObject(s.r.headers, REF_SYNTAX.opencode) } : {}) }
          : {
            type: 'local', command: [s.command, ...splitArgs(s.args)], enabled: true,
            ...(s.r.env.length ? { environment: kvObject(s.r.env, REF_SYNTAX.opencode) } : {}),
          }])),
      } : {}),
    });
}

function codex(m: Model, f: FileMap) {
  f['AGENTS.md'] = agentsMd(m);
  for (const a of m.agents)
    f[`.codex/agents/${a.name}.toml`] = [
      `name = ${tomlString(a.name)}`,
      `description = ${tomlString(a.description)}`,
      `sandbox_mode = ${tomlString(readOnly(a) ? 'read-only' : 'workspace-write')}`,
      `developer_instructions = ${tomlMultiline(agentBody(m, a))}`,
    ].join('\n') + '\n';
  for (const c of m.commands) {
    const name = commandSkillName(m, c);
    f[`.agents/skills/${name}/SKILL.md`] = commandSkillFile(m, c, name);
  }
  const servers = m.mcp.map((s) => {
      const lines = [`[mcp_servers.${s.name}]`];
      if (s.transport === 'http') {
        lines.push(`url = ${tomlString(s.url)}`);
        const auth = s.r.headers.find((h) => /^authorization$/i.test(h.key) && h.ref && /^bearer /i.test(h.prefix ?? ''));
        if (auth) lines.push(`bearer_token_env_var = ${tomlString(auth.ref!)}`);
        const rest = s.r.headers.filter((h) => h !== auth);
        const lit = rest.filter((h) => !h.ref), refs = rest.filter((h) => h.ref);
        if (lit.length) lines.push(`http_headers = ${tomlInline(Object.fromEntries(lit.map((h) => [h.key, h.literal!])))}`);
        if (refs.length) lines.push(`env_http_headers = ${tomlInline(Object.fromEntries(refs.map((h) => [h.key, h.ref!])))}`);
      } else {
        lines.push(`command = ${tomlString(s.command)}`, `args = [${splitArgs(s.args).map(tomlString).join(', ')}]`);
        const lit = s.r.env.filter((e) => !e.ref), refs = s.r.env.filter((e) => e.ref);
        if (lit.length) lines.push(`env = ${tomlInline(Object.fromEntries(lit.map((e) => [e.key, e.literal!])))}`);
        // Codex reenvía estas variables desde el entorno local: el valor nunca queda en el archivo.
        if (refs.length) lines.push(`env_vars = [${refs.map((e) => tomlString(e.ref!)).join(', ')}]`);
      }
      return lines.join('\n');
    });
  // Las claves de primer nivel (sandbox, aprobaciones) tienen que ir antes de cualquier tabla.
  const parts = [m.guards ? codexConfig(m.guards) : '', ...servers].filter(Boolean);
  if (parts.length) f['.codex/config.toml'] = parts.join('\n\n') + '\n';
}

const GEMINI_TOOLS: Record<Tool, string[]> = {
  read: ['read_file', 'read_many_files', 'list_directory'], edit: ['replace'], write: ['write_file'],
  bash: ['run_shell_command'], search: ['grep_search', 'glob'], web: ['web_fetch', 'google_web_search'],
};

function gemini(m: Model, f: FileMap) {
  f['GEMINI.md'] = join(memoryBody(m), ruleSection(m, m.rules), agentIndex(m), skillIndex(m));
  for (const a of m.agents) {
    const tools = a.tools.length === 6 && !a.mcp.length
      ? undefined
      : [...new Set(a.tools.flatMap((t) => GEMINI_TOOLS[t])), ...a.mcp.map((s) => `mcp_${s}_*`)];
    f[`.gemini/agents/${a.name}.md`] = frontmatter({ name: a.name, description: a.description, tools }) + agentBody(m, a) + '\n';
  }
  for (const c of m.commands)
    f[`.gemini/commands/${c.name}.toml`] =
      `description = ${tomlString(c.description)}\nprompt = ${tomlMultiline(commandBody(m, c, 'gemini', true))}\n`;
  const guardSettings = m.guards ? geminiSettings(m.guards) : {};
  if (m.mcp.length || Object.keys(guardSettings).length)
    f['.gemini/settings.json'] = json({
      ...guardSettings,
      ...(m.mcp.length ? {
        mcpServers: Object.fromEntries(m.mcp.map((s) => [s.name, s.transport === 'http'
          ? { httpUrl: s.url, ...(s.r.headers.length ? { headers: kvObject(s.r.headers, REF_SYNTAX.gemini) } : {}) }
          : mcpStdio(s, REF_SYNTAX.gemini)])),
      } : {}),
    });
  const ignore = m.guards ? ignoreFile(m.guards, m.lang) : '';
  if (ignore) f['.geminiignore'] = ignore;
}

function cursor(m: Model, f: FileMap) {
  const mdc = (fm: Record<string, unknown>, body: string) => frontmatter(fm) + clean(body) + '\n';
  f['.cursor/rules/proyecto.mdc'] = mdc({ description: m.project.description || m.project.name, alwaysApply: true },
    join(memoryBody(m), agentIndex(m), skillIndex(m)));
  for (const r of m.rules)
    f[`.cursor/rules/${r.name}.mdc`] = mdc(
      { description: r.description, globs: r.alwaysApply ? undefined : r.globs, alwaysApply: r.alwaysApply || !r.globs.trim() },
      r.content || r.description,
    );
  for (const a of m.agents)
    f[`.cursor/agents/${a.name}.md`] =
      frontmatter({ name: a.name, description: a.description, model: 'inherit', readonly: readOnly(a) || undefined }) + agentBody(m, a) + '\n';
  // Los comandos van como skills de invocación explícita, salvo que Codex ya los haya escrito en .agents/skills.
  for (const c of m.commands) {
    const name = commandSkillName(m, c);
    if (!f[`.agents/skills/${name}/SKILL.md`]) f[`.cursor/skills/${name}/SKILL.md`] = commandSkillFile(m, c, name);
  }
  if (m.mcp.length)
    f['.cursor/mcp.json'] = json({
      mcpServers: Object.fromEntries(m.mcp.map((s) => [s.name, s.transport === 'http'
        ? { url: s.url, ...(s.r.headers.length ? { headers: kvObject(s.r.headers, REF_SYNTAX.cursor) } : {}) }
        : mcpStdio(s, REF_SYNTAX.cursor)])),
    });
  const hooks = m.guards ? cursorHooks(m.guards) : null;
  if (hooks) f['.cursor/hooks.json'] = json(hooks);
  const ignore = m.guards ? ignoreFile(m.guards, m.lang) : '';
  if (ignore) f['.cursorignore'] = ignore;
}

const COPILOT_TOOLS: Record<Tool, string> = { read: 'read', edit: 'edit', write: 'edit', bash: 'execute', search: 'search', web: 'web' };

function copilot(m: Model, f: FileMap) {
  const always = m.rules.filter((r) => r.alwaysApply || !r.globs.trim());
  f['.github/copilot-instructions.md'] = join(memoryBody(m), ruleSection(m, always), agentIndex(m));
  for (const r of m.rules.filter((r) => !always.includes(r)))
    f[`.github/instructions/${r.name}.instructions.md`] =
      frontmatter({ applyTo: r.globs, description: r.description }) + clean(r.content || r.description) + '\n';
  for (const a of m.agents)
    f[`.github/agents/${a.name}.agent.md`] =
      frontmatter({ name: a.name, description: a.description, tools: [...new Set(a.tools.map((t) => COPILOT_TOOLS[t]))] }) +
      agentBody(m, a) + '\n';
  for (const c of m.commands)
    f[`.github/prompts/${c.name}.prompt.md`] =
      frontmatter({ description: c.description, agent: c.agent ?? 'agent', 'argument-hint': c.argumentHint }) +
      commandBody(m, c, 'copilot', false) + '\n';
  if (m.mcp.length) {
    const secrets = [...new Set(m.mcp.flatMap((s) => s.r.secrets))];
    f['.vscode/mcp.json'] = json({
      ...(secrets.length ? {
        inputs: secrets.map((v) => ({ type: 'promptString', id: v.toLowerCase().replace(/_/g, '-'), description: v, password: true })),
      } : {}),
      servers: Object.fromEntries(m.mcp.map((s) => [s.name, s.transport === 'http'
        ? { type: 'http', url: s.url, ...(s.r.headers.length ? { headers: kvObject(s.r.headers, REF_SYNTAX.vscode) } : {}) }
        : { type: 'stdio', ...mcpStdio(s, REF_SYNTAX.vscode) }])),
    });
  }
}

/**
 * Sin sintaxis de referencia a variables de entorno en .roo/mcp.json (los valores son literales, verificado
 * contra McpHub.ts): un secreto se deja en blanco en vez de escribir su valor real o una referencia que
 * Roo Code no va a resolver.
 */
function rooKv(list: { key: string; literal?: string; ref?: string }[]): Record<string, string> | undefined {
  if (!list.length) return undefined;
  return Object.fromEntries(list.map((x) => [x.key, x.ref ? '' : x.literal!]));
}

function roo(m: Model, f: FileMap) {
  f['AGENTS.md'] = agentsMd(m);
  if (m.agents.length)
    f['.roomodes'] = json({
      customModes: m.agents.map((a) => ({
        slug: a.name, name: a.name, roleDefinition: agentBody(m, a), description: a.description, groups: rooGroups(a),
      })),
    });
  for (const c of m.commands)
    f[`.roo/commands/${c.name}.md`] =
      frontmatter({ description: c.description, 'argument-hint': c.argumentHint, mode: c.agent }) + commandBody(m, c, 'dollar', false) + '\n';
  if (m.mcp.length)
    f['.roo/mcp.json'] = json({
      mcpServers: Object.fromEntries(m.mcp.map((s) => [s.name, s.transport === 'http'
        ? { type: 'streamable-http', url: s.url, ...(s.r.headers.length ? { headers: rooKv(s.r.headers) } : {}) }
        : { command: s.command, args: splitArgs(s.args), ...(s.r.env.length ? { env: rooKv(s.r.env) } : {}) }])),
    });
}

/* ---------- API ---------- */

export function render(g: Graph, settings: Pick<Settings, 'lang' | 'targets'>): FileMap {
  const m = buildModel(g, settings.lang);
  const f: FileMap = {};
  const has = (t: Target) => settings.targets.includes(t);
  if (has('claude')) claude(m, f);
  // .agents/skills cubre a todas las demás; OpenCode, Cursor y Copilot también leen .claude/skills,
  // así que si solo están ellas junto a Claude no se duplica.
  if (has('codex') || has('gemini') || has('roo') || (!has('claude') && (has('opencode') || has('cursor') || has('copilot'))))
    sharedSkills(m, f);
  if (has('codex')) codex(m, f);
  if (has('opencode')) opencode(m, f);
  if (has('gemini')) gemini(m, f);
  if (has('cursor')) cursor(m, f);
  if (has('copilot')) copilot(m, f);
  if (has('roo')) roo(m, f);
  if (settings.targets.length && m.project.plan?.trim()) f['docs/PLAN.md'] = `${clean(m.project.plan)}\n`;
  if (m.guards && needsScript(m.guards, { claude: has('claude'), cursor: has('cursor'), gemini: has('gemini') }))
    f[GUARD_SCRIPT] = guardScript(m.guards, m.lang);
  const env = settings.targets.length ? envExample(m) : undefined;
  if (env) f['.env.example'] = env;
  // Defensa en profundidad: ningún archivo generado sale con caracteres invisibles.
  return Object.fromEntries(Object.entries(f).map(([p, c]) => [p, stripHidden(c)] as const).sort(([a], [b]) => a.localeCompare(b)));
}

/** Notas de instalación para archivos con requisitos fuera del repo. */
export function noteFor(path: string): string | undefined {
  if (path === '.codex/config.toml') return t('note.codex');
  if (path === '.env.example') return t('note.env');
  if (path.startsWith('.agents/skills/')) return t('note.skills');
  if (path === GUARD_SCRIPT) return t('note.guard');
  if (path === '.claude/settings.json') return t('note.claudeSettings');
  if (path === '.vscode/mcp.json') return t('note.vscodeMcp');
  if (path === '.roo/mcp.json') return t('note.rooMcp');
  return undefined;
}
