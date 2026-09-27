import { describe, expect, it } from 'vitest';
import { render } from '../generators';
import { importFromRepo } from '../importers/repo';
import { parseFrontmatter, parseToml } from '../importers/parse';
import { readText, writeText } from '../fs';
import type { NodeData } from '../types';
import { ALL_TARGETS, graph } from './helpers';
import { LANGS } from '../i18n/langs';
import { memDir } from './memfs';

const design = graph(
  [
    ['project', 'project', { name: 'tienda', memory: '# Tienda\n\nUna tienda online.\n\n## Comandos\n\n`npm test`' }],
    ['a', 'agent', { name: 'reviewer', description: 'Revisa PRs antes de mergear', tools: ['read', 'search'], model: 'fast', prompt: 'Sos revisor.\n\n1. Leé el diff.' }],
    ['s', 'skill', { name: 'testing', description: 'Cómo escribir tests', instructions: 'Usá vitest.' }],
    ['c', 'command', { name: 'review', description: 'Revisar un PR', argumentHint: '[pr]', prompt: 'Revisá el PR $ARGUMENTS.' }],
    ['r1', 'rule', { name: 'sin-any', description: 'Tipado', alwaysApply: true, content: '- No uses any.' }],
    ['r2', 'rule', { name: 'api', description: 'API', alwaysApply: false, globs: 'src/api/**', content: '- Validá con zod.' }],
    ['m', 'mcp', { name: 'github', env: 'GITHUB_TOKEN=${GITHUB_TOKEN}' }],
  ],
  [['c', 'a'], ['a', 's'], ['a', 'm']],
);

const byKind = (nodes: { data: { d: NodeData } }[], kind: string) =>
  nodes.map((n) => n.data.d).filter((d) => d.kind === kind) as unknown as Record<string, unknown>[];

describe('parsers', () => {
  it('frontmatter con listas, mapas y comillas', () => {
    const { data, body } = parseFrontmatter('---\nname: x\ndescription: "a: b"\nskills: [one, two]\ntools:\n  - Read\npermission:\n  edit: deny\n---\n\nHola');
    expect(data).toEqual({ name: 'x', description: 'a: b', skills: ['one', 'two'], tools: ['Read'], permission: { edit: 'deny' } });
    expect(body).toBe('Hola');
  });
  it('toml plano con multilínea', () => {
    expect(parseToml('name = "a"\ndeveloper_instructions = """\nuno\ndos\n"""\n[mcp_servers.x]\nurl = "u"')).toEqual({
      name: 'a', developer_instructions: 'uno\ndos\n',
    });
  });
});

describe.each(ALL_TARGETS)('ida y vuelta desde %s', (target) => {
  it('recupera agentes, skills, comandos, reglas, MCP y conexiones', async () => {
    const dir = memDir({ ...render(design, { lang: 'es', targets: [target] }), 'package.json': '{"name":"tienda"}' });
    const { graph: g, counts } = await importFromRepo(dir);

    expect(counts.agents).toBe(1);
    expect(counts.skills).toBe(1);
    expect(counts.commands).toBe(1);
    expect(counts.rules).toBe(2);
    expect(counts.mcp).toBe(1);

    const [agent] = byKind(g.nodes, 'agent');
    expect(agent.name).toBe('reviewer');
    expect(agent.description).toBe('Revisa PRs antes de mergear');
    expect(agent.prompt).toContain('Sos revisor.');
    expect(agent.prompt).not.toMatch(/skill\(s\)|MCP/);
    expect(agent.tools).not.toContain('edit');
    expect(agent.tools).not.toContain('bash');

    const [cmd] = byKind(g.nodes, 'command');
    expect(cmd.name).toBe('review');
    expect(cmd.prompt).toContain('$ARGUMENTS');

    const rules = byKind(g.nodes, 'rule');
    expect(rules.find((r) => r.name === 'api')).toMatchObject({ globs: 'src/api/**', alwaysApply: false });

    const [mcp] = byKind(g.nodes, 'mcp');
    expect(String(mcp.env)).toMatch(/GITHUB_TOKEN=.*GITHUB_TOKEN/);

    const [project] = byKind(g.nodes, 'project');
    expect(project.memory).toContain('Una tienda online.');
    expect(project.memory).not.toContain('Subagentes disponibles');

    const kindOf = (id: string) => g.nodes.find((n) => n.id === id)!.data.d.kind;
    const links = g.edges.map((e) => `${kindOf(e.source)}>${kindOf(e.target)}`).sort();
    expect(links).toContain('command>agent');
    expect(links).toContain('agent>skill');
    expect(links).toContain('agent>mcp');
  });
});

describe('ida y vuelta desde Roo Code', () => {
  // Fuera de ALL_TARGETS: a diferencia de las otras 6 plataformas, .roo/mcp.json no tiene sintaxis de
  // referencia a variables de entorno, así que el secreto no vuelve igual (queda en blanco, ver generators/index.ts).
  it('recupera agentes, skills, comandos, reglas y MCP (el secreto queda en blanco, no rompe)', async () => {
    const dir = memDir({ ...render(design, { lang: 'es', targets: ['roo'] }), 'package.json': '{"name":"tienda"}' });
    const { graph: g, counts } = await importFromRepo(dir);

    expect(counts).toEqual({ agents: 1, skills: 1, commands: 1, rules: 2, mcp: 1 });

    const [agent] = byKind(g.nodes, 'agent');
    expect(agent.name).toBe('reviewer');
    expect(agent.description).toBe('Revisa PRs antes de mergear');
    expect(agent.prompt).toContain('Sos revisor.');
    expect(agent.prompt).not.toMatch(/skill\(s\)|MCP/);
    expect(agent.tools).toEqual(['read']);

    const [cmd] = byKind(g.nodes, 'command');
    expect(cmd.prompt).toContain('$ARGUMENTS');

    const rules = byKind(g.nodes, 'rule');
    expect(rules.find((r) => r.name === 'api')).toMatchObject({ globs: 'src/api/**', alwaysApply: false });

    const [mcp] = byKind(g.nodes, 'mcp');
    expect(mcp.name).toBe('github');
    expect(mcp.env).toBe('GITHUB_TOKEN=');

    const [project] = byKind(g.nodes, 'project');
    expect(project.memory).toContain('Una tienda online.');

    const kindOf = (id: string) => g.nodes.find((n) => n.id === id)!.data.d.kind;
    const links = g.edges.map((e) => `${kindOf(e.source)}>${kindOf(e.target)}`).sort();
    expect(links).toContain('command>agent');
    expect(links).toContain('agent>skill');
    expect(links).toContain('agent>mcp');
  });
});

describe('carpeta en memoria', () => {
  it('lee y escribe rutas anidadas', async () => {
    const dir = memDir();
    await writeText(dir, 'a/b/c.md', 'hola');
    expect(await readText(dir, 'a/b/c.md')).toBe('hola');
    expect(await readText(dir, 'a/x.md')).toBeNull();
  });
});

describe.each(LANGS)('ida y vuelta con el contenido en %s', (lang) => {
  const withExtras = graph(
    [
      ['project', 'project', {
        name: 'tienda', memory: '# Tienda\n\nUna tienda online.', plan: '# Plan\n- fase 1',
        canary: { enabled: true, phrase: '🐤 CANARIO-AB12', agents: true, style: 'marker' },
      } as Partial<NodeData>],
      ['a', 'agent', { name: 'reviewer', description: 'Revisa PRs', tools: ['read', 'search'], prompt: 'Sos revisor.' }],
      ['s', 'skill', { name: 'testing', description: 'Tests', instructions: 'Usá vitest.' }],
      ['c', 'command', { name: 'review', description: 'Revisar un PR', argumentHint: '[pr]', prompt: 'Revisá el PR $ARGUMENTS.' }],
      ['r', 'rule', { name: 'api', description: 'API', alwaysApply: false, globs: 'src/api/**', content: '- Validá con zod.' }],
      ['m', 'mcp', { name: 'github', command: 'npx', args: '-y server-github' }],
    ],
    [['c', 'a'], ['c', 's'], ['a', 's'], ['a', 'm']],
  );

  it.each(['claude', 'codex', 'gemini'] as const)('los textos que agrega emede no quedan en el contenido (%s)', async (target) => {
    const dir = memDir({ ...render(withExtras, { lang, targets: [target] }) });
    const { graph: g } = await importFromRepo(dir);
    const d = (kind: string) => byKind(g.nodes, kind)[0];
    expect(d('project').memory).toBe('# Tienda\n\nUna tienda online.');
    expect(d('project')).toMatchObject({ canary: { phrase: '🐤 CANARIO-AB12' } });
    expect(d('agent').prompt).toBe('Sos revisor.');
    expect(d('command')).toMatchObject({ prompt: 'Revisá el PR $ARGUMENTS.', description: 'Revisar un PR' });
    // Las referencias del texto vuelven a ser conexiones.
    const name = (id: string) => g.nodes.find((n) => n.id === id)?.data.d.name;
    const links = g.edges.map((e) => `${name(e.source)}→${name(e.target)}`).sort();
    expect(links).toEqual(expect.arrayContaining(['review→reviewer', 'reviewer→testing']));
  });
});
