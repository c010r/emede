import { describe, expect, it } from 'vitest';
import { assignNames, render } from '../generators';
import { looksSecret, resolveMcp } from '../generators/secrets';
import { emptyData } from '../defaults';
import type { McpData } from '../types';
import { ALL_TARGETS, graph } from './helpers';

const all = { lang: 'es' as const, targets: [...ALL_TARGETS] };

describe('nombres únicos', () => {
  it('no pisa archivos cuando dos nodos normalizan al mismo nombre', () => {
    const g = graph([['a1', 'agent', { name: 'Code Reviewer' }], ['a2', 'agent', { name: 'code-reviewer' }]]);
    expect([...assignNames(g).values()]).toEqual(['code-reviewer', 'code-reviewer-2']);
    const f = render(g, { lang: 'es', targets: ['claude'] });
    expect(f['.claude/agents/code-reviewer.md']).toBeDefined();
    expect(f['.claude/agents/code-reviewer-2.md']).toContain('name: code-reviewer-2');
  });

  it('las conexiones usan el nombre único', () => {
    const g = graph(
      [['s1', 'skill', { name: 'tests' }], ['s2', 'skill', { name: 'Tests' }], ['a', 'agent', { name: 'dev' }]],
      [['a', 's2']],
    );
    expect(render(g, { lang: 'es', targets: ['claude'] })['.claude/agents/dev.md']).toContain('skills: [tests-2]');
  });
});

describe('secretos MCP', () => {
  const mcp = (p: Partial<McpData>) => ({ ...emptyData('mcp'), name: 'github', ...p }) as McpData;

  it('detecta valores sensibles por nombre y por forma', () => {
    expect(looksSecret('GITHUB_TOKEN', 'x')).toBe(true);
    expect(looksSecret('FOO', 'ghp_abcdefghijklmnop1234')).toBe(true);
    expect(looksSecret('LOG_LEVEL', 'debug')).toBe(false);
  });

  it('convierte secretos en referencias y conserva literales inofensivos', () => {
    const r = resolveMcp(mcp({ env: 'GITHUB_TOKEN=ghp_realvalue1234567890\nLOG_LEVEL=debug\nOTHER=${MY_VAR}' }));
    expect(r.env).toEqual([
      { key: 'GITHUB_TOKEN', ref: 'GITHUB_TOKEN' },
      { key: 'LOG_LEVEL', literal: 'debug' },
      { key: 'OTHER', ref: 'MY_VAR' },
    ]);
    expect(r.secrets).toEqual(['GITHUB_TOKEN', 'MY_VAR']);
  });

  it('nunca escribe el valor real en ningún archivo', () => {
    const g = graph([['m', 'mcp', { name: 'github', env: 'GITHUB_TOKEN=ghp_realvalue1234567890' }],
      ['h', 'mcp', { name: 'remote', transport: 'http', url: 'https://x.dev/mcp', headers: 'Authorization=Bearer sk-live-secret-123456789' }]]);
    const files = render(g, all);
    for (const [path, content] of Object.entries(files)) {
      expect(content, path).not.toContain('ghp_realvalue');
      expect(content, path).not.toContain('sk-live-secret');
    }
    expect(JSON.parse(files['.mcp.json']).mcpServers.github.env.GITHUB_TOKEN).toBe('${GITHUB_TOKEN}');
    expect(JSON.parse(files['.mcp.json']).mcpServers.remote.headers.Authorization).toBe('Bearer ${REMOTE_TOKEN}');
    expect(JSON.parse(files['opencode.json']).mcp.github.environment.GITHUB_TOKEN).toBe('{env:GITHUB_TOKEN}');
    expect(JSON.parse(files['.cursor/mcp.json']).mcpServers.github.env.GITHUB_TOKEN).toBe('${env:GITHUB_TOKEN}');
    expect(files['.codex/config.toml']).toContain('env_vars = ["GITHUB_TOKEN"]');
    expect(files['.codex/config.toml']).toContain('bearer_token_env_var = "REMOTE_TOKEN"');
    const vscode = JSON.parse(files['.vscode/mcp.json']);
    expect(vscode.inputs.map((i: { id: string }) => i.id)).toEqual(['github-token', 'remote-token']);
    expect(vscode.servers.github.env.GITHUB_TOKEN).toBe('${input:github-token}');
    expect(files['.env.example']).toMatch(/GITHUB_TOKEN=\s+# github/);
  });

  it('Roo Code: sin sintaxis de referencia, el secreto queda en blanco (no una referencia rota)', () => {
    const g = graph([['m', 'mcp', { name: 'github', env: 'GITHUB_TOKEN=ghp_realvalue1234567890\nLOG_LEVEL=debug' }]]);
    const f = render(g, { lang: 'es', targets: ['roo'] });
    expect(f['.roo/mcp.json']).not.toContain('ghp_realvalue');
    const servers = JSON.parse(f['.roo/mcp.json']).mcpServers;
    expect(servers.github.env).toEqual({ GITHUB_TOKEN: '', LOG_LEVEL: 'debug' });
  });
});

describe('formatos por plataforma', () => {
  const g = graph(
    [
      ['a', 'agent', { name: 'reviewer', description: 'Revisa PRs', tools: ['read', 'search'], prompt: 'Sos revisor.' }],
      ['s', 'skill', { name: 'testing', description: 'Tests', instructions: 'Usá vitest.' }],
      ['c', 'command', { name: 'review', description: 'Revisar', argumentHint: '[pr]', prompt: 'Revisá $ARGUMENTS.' }],
    ],
    [['c', 'a'], ['a', 's']],
  );
  const f = render(g, all);

  it('Claude: skills como lista YAML', () => {
    expect(f['.claude/agents/reviewer.md']).toContain('skills: [testing]');
    expect(f['.claude/agents/reviewer.md']).toContain('tools: Read, Grep, Glob');
  });
  it('OpenCode: carpetas en plural y permission en vez de tools', () => {
    expect(f['.opencode/agents/reviewer.md']).toMatch(/permission:\n {2}edit: deny\n {2}bash: deny/);
    expect(f['.opencode/commands/review.md']).toContain('agent: reviewer');
  });
  it('Codex: subagentes TOML y comandos como skills', () => {
    expect(f['.codex/agents/reviewer.toml']).toContain('sandbox_mode = "read-only"');
    expect(f['.agents/skills/review/SKILL.md']).toContain('disable-model-invocation: true');
    expect(Object.keys(f).some((p) => p.startsWith('.codex/prompts'))).toBe(false);
  });
  it('Gemini: subagentes con herramientas propias', () => {
    expect(f['.gemini/agents/reviewer.md']).toContain('read_file');
    expect(f['.gemini/commands/review.toml']).toContain('{{args}}');
  });
  it('Cursor: subagentes nativos de solo lectura', () => {
    expect(f['.cursor/agents/reviewer.md']).toContain('readonly: true');
  });
  it('Roo Code: AGENTS.md compartido, modo de solo lectura en .roomodes, comando con "mode"', () => {
    const g2 = graph(
      [
        ['a', 'agent', { name: 'reviewer', description: 'Revisa PRs', tools: ['read', 'search'], prompt: 'Sos revisor.' }],
        ['c', 'command', { name: 'review', description: 'Revisar', argumentHint: '[pr]', prompt: 'Revisá $ARGUMENTS.' }],
      ],
      [['c', 'a']],
    );
    const f2 = render(g2, { lang: 'es', targets: ['roo'] });
    expect(f2['AGENTS.md']).toContain('# mi-proyecto');
    const [mode] = JSON.parse(f2['.roomodes']).customModes;
    expect(mode).toMatchObject({ slug: 'reviewer', name: 'reviewer', description: 'Revisa PRs', groups: ['read'] });
    expect(mode.roleDefinition).toContain('Sos revisor.');
    expect(f2['.roo/commands/review.md']).toContain('mode: reviewer');
    expect(f2['.roo/commands/review.md']).toContain('Revisá $ARGUMENTS.');
  });
  it('skills compartidas sin duplicar comandos', () => {
    expect(f['.agents/skills/testing/SKILL.md']).toBeDefined();
    expect(f['.cursor/skills/review/SKILL.md']).toBeUndefined();
  });
  it('un comando con el mismo nombre que una skill no la pisa', () => {
    const g2 = graph([['s', 'skill', { name: 'deploy' }], ['c', 'command', { name: 'deploy' }]]);
    const f2 = render(g2, { lang: 'es', targets: ['codex'] });
    expect(f2['.agents/skills/deploy/SKILL.md']).not.toContain('disable-model-invocation');
    expect(f2['.agents/skills/cmd-deploy/SKILL.md']).toContain('disable-model-invocation: true');
  });
});
