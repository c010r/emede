import type { Edge } from '@xyflow/react';
import { emptyData, slug } from '../defaults';
import { layout, uid, type FlowNode, type Graph } from '../store';
import { filteredDir, list, readText, type DirHandle } from '../fs';
import { findHidden, stripHidden } from '../sanitize';
import type { Guards } from '../types';
import { detectInDir } from '../detect';
import type { AgentData, CommandData, McpData, ModelTier, ProjectData, RuleData, SkillData, Tool } from '../types';
import { TOOLS } from '../types';
import { parseFrontmatter, parseToml, parseTomlTables, str, strList, type FM } from './parse';
import {
  APPLIES_TO, ARG_PHRASES, canaryIn, GENERATED_SECTIONS, isAgentCanary, matchDelegate, matchMcp, matchUseSkills,
  RULES_SECTION, stripCmdSkillPrefix,
} from './scaffold';

/*
 * Reconstruye el diseño a partir de una configuración existente en un repo
 * (de Claude Code, OpenCode, Codex, Gemini CLI, Cursor o Copilot; generada por emede o escrita a mano).
 */

export interface ImportResult {
  graph: Graph;
  counts: Record<'agents' | 'skills' | 'commands' | 'rules' | 'mcp', number>;
  /** Archivos de los que salió cada cosa. */
  sources: string[];
  /** Archivos que traían caracteres invisibles (posibles instrucciones ocultas); se importaron limpios. */
  hidden: { path: string; count: number }[];
}

type Agent = Omit<AgentData, 'kind'> & { skills: string[]; mcp: string[]; canary?: boolean };
type Command = Omit<CommandData, 'kind'> & { agent?: string; skills: string[] };

/* ---------- lectura de archivos ---------- */

interface Doc {
  path: string;
  name: string;
  text: string;
}

/** Archivos de una carpeta con cierta extensión. */
async function filesIn(root: DirHandle, dir: string, ext: string): Promise<Doc[]> {
  const out: Doc[] = [];
  for (const e of await list(root, dir)) {
    if (e.kind !== 'file' || !e.name.endsWith(ext)) continue;
    out.push({ path: `${dir}/${e.name}`, name: e.name.slice(0, -ext.length), text: await (await e.getFile()).text() });
  }
  return out;
}

/** SKILL.md de cada subcarpeta de un directorio de skills. */
async function skillsIn(root: DirHandle, dir: string): Promise<Doc[]> {
  const out: Doc[] = [];
  for (const e of await list(root, dir)) {
    if (e.kind !== 'directory') continue;
    const text = await readText(root, `${dir}/${e.name}/SKILL.md`);
    if (text !== null) out.push({ path: `${dir}/${e.name}/SKILL.md`, name: e.name, text });
  }
  return out;
}

/* ---------- traducción inversa ---------- */

const TOOL_MAP: Record<string, Tool> = {
  read: 'read', list: 'read', read_file: 'read', read_many_files: 'read', list_directory: 'read',
  edit: 'edit', replace: 'edit', patch: 'edit', multiedit: 'edit',
  write: 'write', write_file: 'write',
  bash: 'bash', execute: 'bash', run_shell_command: 'bash', terminal: 'bash',
  grep: 'search', glob: 'search', search: 'search', grep_search: 'search',
  webfetch: 'web', websearch: 'web', web: 'web', web_fetch: 'web', google_web_search: 'web', fetch: 'web',
};

function toTools(raw: unknown): Tool[] {
  const names = strList(raw);
  if (!names.length) return [...TOOLS];
  const out = new Set<Tool>();
  for (const n of names) {
    const t = TOOL_MAP[n.toLowerCase().split(/[/(]/)[0]];
    if (t) out.add(t);
  }
  return out.size ? [...out] : [...TOOLS];
}

const toModel = (raw: unknown): ModelTier => {
  const m = str(raw).toLowerCase();
  if (/haiku|flash|mini|lite/.test(m)) return 'fast';
  if (/opus|pro|max/.test(m)) return 'powerful';
  if (/sonnet/.test(m)) return 'balanced';
  return 'inherit';
};

/** Quita las líneas que agrega emede al cuerpo y devuelve las referencias que contenían. */
function stripExtras(body: string) {
  let agent: string | undefined;
  const skills: string[] = [];
  const mcp: string[] = [];
  let canary = false;
  const names = (s: string) => s.split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
  const lines = body.split('\n').filter((l) => {
    // Versiones anteriores de emede: "Adoptá el rol `x`".
    const d = matchDelegate(l) ?? l.match(/^Adoptá el rol\s+`([^`]+)`/)?.[1];
    if (d) return (agent = d.replace(/`/g, '')), false;
    const s = matchUseSkills(l);
    if (s) return skills.push(...names(s)), false;
    const m = matchMcp(l);
    if (m) return mcp.push(...names(m)), false;
    if (isAgentCanary(l)) return (canary = true), false;
    return true;
  });
  return { body: lines.join('\n').trim(), agent, skills, mcp, canary };
}

/** Normaliza marcadores de argumentos de cada plataforma a $ARGUMENTS. */
const normArgs = (s: string) =>
  s.replace(/\{\{args\}\}/g, '$ARGUMENTS').replace(/\$\{input:args(?::[^}]*)?\}/g, '$ARGUMENTS')
    .replace(ARG_PHRASES, '$ARGUMENTS');


/** Separa la memoria del proyecto de las secciones de índice y extrae las reglas inline. */
function splitMemory(text: string): { memory: string; rules: Omit<RuleData, 'kind'>[] } {
  const out: string[] = [];
  const rules: Omit<RuleData, 'kind'>[] = [];
  let mode: 'keep' | 'skip' | 'rules' = 'keep';
  let rule: Omit<RuleData, 'kind'> | null = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^## /.test(line)) {
      mode = GENERATED_SECTIONS.test(line) ? 'skip' : RULES_SECTION.test(line) ? 'rules' : 'keep';
      if (mode !== 'keep') continue;
    }
    if (mode === 'keep') out.push(line);
    else if (mode === 'rules') {
      const h = line.match(/^### (.+)$/);
      if (h) {
        rule = { name: h[1].trim(), description: '', globs: '', alwaysApply: true, content: '' };
        rules.push(rule);
      } else if (rule) {
        const g = line.match(APPLIES_TO);
        if (g) Object.assign(rule, { globs: g[1], alwaysApply: false });
        else rule.content += `${line}\n`;
      }
    }
  }
  for (const r of rules) {
    r.content = r.content.trim();
    r.description = r.content.split('\n')[0].replace(/^[-*]\s*/, '').slice(0, 100);
  }
  return { memory: out.join('\n').trim(), rules };
}

/* ---------- importación ---------- */

export async function importFromRepo(dir: DirHandle): Promise<ImportResult> {
  // Todo lo que se lee del repo pasa por el filtro de caracteres invisibles (Rules File Backdoor).
  const hidden: { path: string; count: number }[] = [];
  const root = filteredDir(dir, (path, text) => {
    const count = findHidden(text).length;
    if (!count) return text;
    if (!hidden.some((h) => h.path === path)) hidden.push({ path, count });
    return stripHidden(text);
  });
  const sources: string[] = [];
  const agents = new Map<string, Agent>();
  const skills = new Map<string, Omit<SkillData, 'kind'>>();
  const commands = new Map<string, Command>();
  const rules = new Map<string, Omit<RuleData, 'kind'>>();
  const mcps = new Map<string, Omit<McpData, 'kind'>>();
  const firstWins = <T>(map: Map<string, T>, name: string, value: T, path: string) => {
    const key = slug(name);
    if (map.has(key)) return;
    map.set(key, value);
    sources.push(path);
  };

  // Proyecto: el primer archivo de memoria que exista.
  const project = { ...emptyData('project') } as ProjectData;
  for (const path of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursor/rules/proyecto.mdc']) {
    const raw = await readText(root, path);
    if (raw === null) continue;
    const text = path.endsWith('.mdc') ? parseFrontmatter(raw).body : raw;
    const { memory, rules: inline } = splitMemory(text);
    project.memory = memory;
    // Si el repo ya tenía un canario de emede, se conserva su marca (así no cambia en cada importación).
    const canary = canaryIn(text);
    if (canary) project.canary = { enabled: true, phrase: canary.phrase, agents: false, style: canary.style };
    for (const r of inline) firstWins(rules, r.name, r, path);
    sources.push(path);
    break;
  }
  const plan = await readText(root, 'docs/PLAN.md');
  if (plan?.trim()) {
    project.plan = plan.trim();
    sources.push('docs/PLAN.md');
  }
  const settings = await readText(root, '.claude/settings.json');
  if (settings) {
    try {
      const guards = guardsFromClaude(JSON.parse(settings), project.guards);
      if (guards) {
        project.guards = guards;
        sources.push('.claude/settings.json');
      }
    } catch { /* settings.json inválido: se ignora */ }
  }
  const det = await detectInDir(root);
  Object.assign(project, {
    name: slug(det.name || root.name), description: det.description, stackItems: det.items, structure: det.structure,
    dev: det.commands.dev ?? '', build: det.commands.build ?? '', test: det.commands.test ?? '', lint: det.commands.lint ?? '',
  });
  if (!project.description) project.description = project.memory.match(/^(?!#)(.{20,200})$/m)?.[1] ?? '';

  // Agentes (markdown con frontmatter)
  const agentDirs: [string, string][] = [
    ['.claude/agents', '.md'], ['.opencode/agents', '.md'], ['.opencode/agent', '.md'], ['.gemini/agents', '.md'],
    ['.cursor/agents', '.md'], ['.github/agents', '.agent.md'],
  ];
  for (const [dir, ext] of agentDirs)
    for (const doc of await filesIn(root, dir, ext)) {
      const { data, body } = parseFrontmatter(doc.text);
      const x = stripExtras(body);
      let tools = toTools(data.tools);
      // OpenCode: permission / tools como mapa de booleanos
      const perm = (data.permission ?? {}) as FM;
      const boolTools = data.tools && typeof data.tools === 'object' && !Array.isArray(data.tools) ? (data.tools as FM) : {};
      if (perm.edit === 'deny' || boolTools.edit === false) tools = tools.filter((t) => t !== 'edit' && t !== 'write');
      if (perm.bash === 'deny' || boolTools.bash === false) tools = tools.filter((t) => t !== 'bash');
      if (perm.webfetch === 'deny' || boolTools.webfetch === false) tools = tools.filter((t) => t !== 'web');
      if (data.readonly === true) tools = tools.filter((t) => !['edit', 'write', 'bash'].includes(t));
      firstWins(agents, str(data.name) || doc.name, {
        name: str(data.name) || doc.name, description: str(data.description), model: toModel(data.model), tools,
        prompt: x.body, skills: [...strList(data.skills), ...x.skills], mcp: x.mcp, canary: x.canary,
      }, doc.path);
    }
  // Agentes de Codex (TOML)
  for (const doc of await filesIn(root, '.codex/agents', '.toml')) {
    const t = parseToml(doc.text);
    const x = stripExtras(str(t.developer_instructions));
    firstWins(agents, str(t.name) || doc.name, {
      name: str(t.name) || doc.name, description: str(t.description), model: toModel(t.model),
      tools: t.sandbox_mode === 'read-only' ? ['read', 'search'] : [...TOOLS], prompt: x.body, skills: x.skills, mcp: x.mcp, canary: x.canary,
    }, doc.path);
  }

  // Skills y comandos-skill (disable-model-invocation = comando de invocación explícita)
  for (const dir of ['.claude/skills', '.agents/skills', '.opencode/skills', '.opencode/skill', '.github/skills', '.cursor/skills', '.codex/skills'])
    for (const doc of await skillsIn(root, dir)) {
      const { data, body } = parseFrontmatter(doc.text);
      const name = str(data.name) || doc.name;
      if (data['disable-model-invocation'] === true) {
        const x = stripExtras(body);
        const cmdName = name.replace(/^cmd-/, '');
        const description = stripCmdSkillPrefix(str(data.description));
        firstWins(commands, cmdName, {
          name: cmdName, description, argumentHint: str(data['argument-hint']), prompt: normArgs(x.body), agent: x.agent, skills: x.skills,
        }, doc.path);
      } else firstWins(skills, name, { name, description: str(data.description), instructions: body }, doc.path);
    }

  // Comandos
  const cmdDirs: [string, string][] = [
    ['.claude/commands', '.md'], ['.opencode/commands', '.md'], ['.opencode/command', '.md'], ['.github/prompts', '.prompt.md'],
    ['.cursor/commands', '.md'], ['.codex/prompts', '.md'],
  ];
  for (const [dir, ext] of cmdDirs)
    for (const doc of await filesIn(root, dir, ext)) {
      const { data, body } = parseFrontmatter(doc.text);
      const x = stripExtras(body);
      const agent = str(data.agent);
      firstWins(commands, doc.name, {
        name: doc.name, description: str(data.description), argumentHint: str(data['argument-hint']), prompt: normArgs(x.body),
        agent: x.agent ?? (agent && !['agent', 'ask', 'edit', 'build', 'plan'].includes(agent) ? agent : undefined), skills: x.skills,
      }, doc.path);
    }
  for (const doc of await filesIn(root, '.gemini/commands', '.toml')) {
    const t = parseToml(doc.text);
    const x = stripExtras(str(t.prompt));
    firstWins(commands, doc.name, {
      name: doc.name, description: str(t.description), argumentHint: '', prompt: normArgs(x.body), agent: x.agent, skills: x.skills,
    }, doc.path);
  }

  // Reglas
  for (const doc of await filesIn(root, '.claude/rules', '.md')) {
    const { data, body } = parseFrontmatter(doc.text);
    const globs = strList(data.paths).join(', ');
    firstWins(rules, doc.name, { name: doc.name, description: body.split('\n')[0].slice(0, 100), globs, alwaysApply: !globs, content: body }, doc.path);
  }
  for (const doc of await filesIn(root, '.cursor/rules', '.mdc')) {
    if (doc.name === 'proyecto' || /^(agente|skill)-/.test(doc.name)) continue;
    const { data, body } = parseFrontmatter(doc.text);
    const globs = strList(data.globs).join(', ');
    firstWins(rules, doc.name, {
      name: doc.name, description: str(data.description), globs, alwaysApply: data.alwaysApply === true || !globs, content: body,
    }, doc.path);
  }
  for (const doc of await filesIn(root, '.github/instructions', '.instructions.md')) {
    const { data, body } = parseFrontmatter(doc.text);
    const globs = str(data.applyTo);
    firstWins(rules, doc.name, {
      name: doc.name, description: str(data.description), globs: globs === '**' ? '' : globs, alwaysApply: !globs || globs === '**', content: body,
    }, doc.path);
  }

  // MCP: el primer archivo con cada servidor
  const kvLines = (o: unknown) =>
    Object.entries((o ?? {}) as Record<string, unknown>)
      .map(([k, v]) => `${k}=${str(v).replace(/\$\{input:([\w-]+)\}/g, (_, id: string) => `\${${id.toUpperCase().replace(/-/g, '_')}}`)}`)
      .join('\n');
  const mcpFiles: [string, (j: FM) => Record<string, FM>][] = [
    ['.mcp.json', (j) => j.mcpServers as Record<string, FM>],
    ['.cursor/mcp.json', (j) => j.mcpServers as Record<string, FM>],
    ['.gemini/settings.json', (j) => j.mcpServers as Record<string, FM>],
    ['.vscode/mcp.json', (j) => j.servers as Record<string, FM>],
    ['opencode.json', (j) => j.mcp as Record<string, FM>],
  ];
  for (const [path, pick] of mcpFiles) {
    const text = await readText(root, path);
    if (!text) continue;
    let servers: Record<string, FM> = {};
    try {
      servers = pick(JSON.parse(text)) ?? {};
    } catch {
      continue;
    }
    for (const [name, s] of Object.entries(servers)) {
      const url = str(s.url ?? s.httpUrl);
      const cmd = Array.isArray(s.command) ? (s.command as string[]) : [str(s.command), ...strList(s.args)];
      firstWins(mcps, name, {
        name,
        transport: url ? 'http' : 'stdio',
        command: url ? '' : cmd[0] ?? '',
        args: url ? '' : cmd.slice(1).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
        url,
        env: kvLines(s.env ?? s.environment),
        headers: kvLines(s.headers),
      }, path);
    }
  }

  // MCP de Codex (config.toml): env_vars y bearer_token_env_var se vuelven referencias ${VAR}
  const codexToml = await readText(root, '.codex/config.toml');
  if (codexToml)
    for (const [name, s] of Object.entries(parseTomlTables(codexToml, 'mcp_servers'))) {
      const env = [
        ...Object.entries((s.env ?? {}) as FM).map(([k, v]) => `${k}=${str(v)}`),
        ...strList(s.env_vars).map((v) => `${v}=\${${v}}`),
      ].join('\n');
      const headers = [
        ...(s.bearer_token_env_var ? [`Authorization=Bearer \${${str(s.bearer_token_env_var)}}`] : []),
        ...Object.entries((s.http_headers ?? {}) as FM).map(([k, v]) => `${k}=${str(v)}`),
        ...Object.entries((s.env_http_headers ?? {}) as FM).map(([k, v]) => `${k}=\${${str(v)}}`),
      ].join('\n');
      const url = str(s.url);
      firstWins(mcps, name, {
        name, transport: url ? 'http' : 'stdio', command: str(s.command), args: strList(s.args).join(' '), url, env, headers,
      }, '.codex/config.toml');
    }

  if (project.canary && [...agents.values()].some((a) => a.canary)) project.canary = { ...project.canary, agents: true };

  return { graph: toGraph(project, agents, skills, commands, rules, mcps), counts: {
    agents: agents.size, skills: skills.size, commands: commands.size, rules: rules.size, mcp: mcps.size,
  }, sources: [...new Set(sources)], hidden };
}

function toGraph(
  project: ProjectData,
  agents: Map<string, Agent>,
  skills: Map<string, Omit<SkillData, 'kind'>>,
  commands: Map<string, Command>,
  rules: Map<string, Omit<RuleData, 'kind'>>,
  mcps: Map<string, Omit<McpData, 'kind'>>,
): Graph {
  const nodes: FlowNode[] = [{ id: 'project', type: 'card', position: { x: 0, y: 0 }, deletable: false, data: { d: project } }];
  const ids = new Map<string, string>();
  const push = (kind: 'agent' | 'skill' | 'command' | 'rule' | 'mcp', key: string, d: object) => {
    const id = `${kind}-${uid()}`;
    ids.set(`${kind}:${key}`, id);
    nodes.push({ id, type: 'card', position: { x: 0, y: 0 }, data: { d: { ...emptyData(kind), ...d, kind } as FlowNode['data']['d'] } });
  };
  for (const [k, a] of agents) push('agent', k, { name: a.name, description: a.description, model: a.model, tools: a.tools, prompt: a.prompt });
  for (const [k, s] of skills) push('skill', k, s);
  for (const [k, c] of commands) push('command', k, { name: c.name, description: c.description, argumentHint: c.argumentHint, prompt: c.prompt });
  for (const [k, r] of rules) push('rule', k, r);
  for (const [k, m] of mcps) push('mcp', k, m);

  const edges: Edge[] = [];
  const link = (from: string | undefined, kind: string, name: string) => {
    const to = ids.get(`${kind}:${slug(name)}`) ?? (kind === 'skill' ? ids.get(`skill:${slug(name.replace(/^cmd-/, ''))}`) : undefined);
    if (from && to && !edges.some((e) => e.source === from && e.target === to))
      edges.push({ id: `e-${from}-${to}`, source: from, target: to, animated: true });
  };
  for (const [k, a] of agents) {
    a.skills.forEach((s) => link(ids.get(`agent:${k}`), 'skill', s));
    a.mcp.forEach((m) => link(ids.get(`agent:${k}`), 'mcp', m));
  }
  for (const [k, c] of commands) {
    if (c.agent) link(ids.get(`command:${k}`), 'agent', c.agent);
    c.skills.forEach((s) => link(ids.get(`command:${k}`), 'skill', s));
  }
  return { nodes: layout(nodes), edges };
}

/**
 * Reconstruye los guardarraíles desde .claude/settings.json (permisos y hooks).
 * Reglas Bash(cmd) y Bash(cmd *) se unifican; Read/Edit de la misma ruta cuentan como un archivo protegido.
 */
export function guardsFromClaude(settings: FM, base?: Guards): Guards | null {
  const perms = (settings.permissions ?? {}) as Record<string, unknown>;
  const hooks = (settings.hooks ?? {}) as Record<string, { hooks?: { command?: string }[] }[]>;
  if (!Object.keys(perms).length && !Object.keys(hooks).length) return null;
  const bash = (list: unknown) =>
    [...new Set(strList(list).map((r) => r.match(/^Bash\((.+?)(?: \*)?\)$/)?.[1]).filter(Boolean) as string[])];
  const paths = [...new Set(strList(perms.deny).map((r) => r.match(/^(?:Read|Edit)\((?:\.\/)?(.+)\)$/)?.[1]).filter(Boolean) as string[])];
  const format = hooks.PostToolUse?.[0]?.hooks?.[0]?.command ?? '';
  const gate = !!hooks.Stop?.some((h) => h.hooks?.some((x) => x.command?.includes('agent-guard')));
  return {
    ...(base ?? { enabled: true, protectPaths: '', denyCommands: '', askCommands: '', allowCommands: '', formatCommand: '', testGate: false, sandbox: 'workspace-write', network: false }),
    enabled: true,
    protectPaths: paths.join('\n'),
    denyCommands: bash(perms.deny).join('\n'),
    askCommands: bash(perms.ask).join('\n'),
    allowCommands: bash(perms.allow).join('\n'),
    formatCommand: format,
    testGate: gate,
  };
}
