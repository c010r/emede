import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, type Io } from '../cli/main';
import { serializeDesign } from '../design';
import { setUILang } from '../i18n';
import { alwaysLoaded, estimateTokens, sessionCost } from '../tokens';
import { render } from '../generators';
import { graph } from './helpers';

let dir = '';
let out: string[] = [];
let err: string[] = [];
const io = (extra: Partial<Io> = {}): Io => ({
  cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l), locales: ['es-AR'], dataFile: join(dir, 'data.json'), ...extra,
});

const design = graph(
  [
    ['project', 'project', { name: 'tienda', description: 'Tienda', memory: '# Tienda' }],
    ['a', 'agent', { name: 'revisor', description: 'Revisa PRs. Usar cuando hay un diff.', prompt: 'Sos revisor.' }],
  ],
);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'emede-cli-'));
  out = [];
  err = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await setUILang('es');
});

const writeDesign = (extra: Parameters<typeof serializeDesign>[1] = { targets: ['claude', 'codex'], lang: 'es', fileOverrides: {}, excluded: [] }) =>
  writeFile(join(dir, 'tienda.emede.json'), serializeDesign(design, extra));

describe('emede generate / check', () => {
  it('avisa qué comandos ejecutarán los agentes cuando el diseño viene de un archivo', async () => {
    const risky = graph([
      ['project', 'project', { name: 'tienda', test: 'npm test' }],
      ['m', 'mcp', { name: 'github', command: 'npx', args: '-y servidor-github' }],
    ]);
    await writeFile(join(dir, 'tienda.emede.json'), serializeDesign(risky, {
      targets: ['claude'], lang: 'es', excluded: [],
      fileOverrides: { '.claude/settings.json': { content: '{"hooks":{}}', base: '' } },
    }));
    expect(await main(['generate', '--dry-run'], io())).toBe(0);
    const warning = err.join('\n');
    expect(warning).toContain('MCP «github»: `npx -y servidor-github`');
    expect(warning).toContain('se aprueba sin preguntar: `npm test`');
    expect(warning).toContain('edición manual de .claude/settings.json');
    // check solo lee: no hace falta avisar.
    err = [];
    await main(['check'], io());
    expect(err.join('\n')).not.toContain('MCP «github»');
  });

  it('genera, verifica, detecta cambios y los repara con respaldo', async () => {
    await writeDesign();
    expect(await main(['generate'], io())).toBe(0);
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf8')).toContain('# Tienda');
    expect(existsSync(join(dir, '.codex', 'agents', 'revisor.toml'))).toBe(true);
    expect(out.join('\n')).toContain('Contexto fijo por sesión');

    expect(await main(['check'], io())).toBe(0);

    // Alguien editó un archivo en el repo: check falla y dice cuál.
    await writeFile(join(dir, 'CLAUDE.md'), '# Tienda\n\nCambio a mano');
    err = [];
    expect(await main(['check'], io())).toBe(1);
    expect(err.join('\n')).toMatch(/distinto\s+CLAUDE\.md/);

    // generate lo vuelve al diseño y respalda la versión reemplazada.
    expect(await main(['generate'], io())).toBe(0);
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf8')).not.toContain('Cambio a mano');
    const [backup] = await readdir(join(dir, '.emede-backup'));
    expect(await readFile(join(dir, '.emede-backup', backup, 'CLAUDE.md'), 'utf8')).toContain('Cambio a mano');
  });

  it('respeta ediciones manuales y exclusiones guardadas en el diseño', async () => {
    const generated = render(design, { lang: 'es', targets: ['claude'] });
    await writeDesign({
      targets: ['claude'], lang: 'es', excluded: ['.claude/agents/revisor.md'],
      fileOverrides: { 'CLAUDE.md': { content: '# A mano', base: generated['CLAUDE.md'] } },
    });
    expect(await main(['generate'], io())).toBe(0);
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# A mano');
    expect(existsSync(join(dir, '.claude', 'agents', 'revisor.md'))).toBe(false);
  });

  it('--dry-run no escribe y --targets / --lang mandan sobre el diseño', async () => {
    await writeDesign();
    expect(await main(['generate', 'tienda.emede.json', '--dry-run', '--targets', 'gemini', '--lang', 'en'], io())).toBe(0);
    expect(out.join('\n')).toContain('+ GEMINI.md');
    expect(existsSync(join(dir, 'GEMINI.md'))).toBe(false);
  });

  it('usa un proyecto guardado en la app con --project', async () => {
    await writeFile(join(dir, 'data.json'), JSON.stringify({
      version: 1, settings: { targets: ['gemini'], lang: 'es' },
      projects: { p1: { id: 'p1', name: 'tienda', graph: design, fileOverrides: {}, excluded: [], updatedAt: 1 } },
    }));
    expect(await main(['list'], io())).toBe(0);
    expect(out.join('\n')).toMatch(/tienda\s+p1/);
    expect(await main(['generate', '--project', 'tienda', '--out', 'salida'], io())).toBe(0);
    expect(existsSync(join(dir, 'salida', 'GEMINI.md'))).toBe(true);
  });

  it('errores de uso: código 2 y mensaje claro', async () => {
    expect(await main(['check'], io())).toBe(2);
    expect(err.join('\n')).toContain('No hay ningún *.emede.json');
    await writeDesign();
    err = [];
    expect(await main(['generate', '--targets', 'vscode'], io())).toBe(2);
    expect(err.join('\n')).toContain('Plataforma desconocida: vscode');
    expect(await main(['bailar'], io())).toBe(2);
  });

  it('los mensajes salen en el idioma del sistema', async () => {
    await writeDesign();
    expect(await main(['check'], io({ locales: ['en-US'] }))).toBe(1);
    expect(err.join('\n')).toContain("don't match the design");
  });
});

describe('estimación de tokens', () => {
  it('alfabeto latino ~4 caracteres por token; chino ~1 por carácter', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('代码审查'.repeat(25))).toBe(100);
    expect(estimateTokens('')).toBe(0);
  });

  it('cuenta solo lo que cada herramienta carga siempre', () => {
    const g = graph([
      ['project', 'project', { memory: '# Proyecto' }],
      ['r1', 'rule', { name: 'siempre', alwaysApply: true, content: '- Regla general.' }],
      ['r2', 'rule', { name: 'api', alwaysApply: false, globs: 'src/api/**', content: '- Solo API.' }],
      ['a', 'agent', { name: 'x', description: 'x', prompt: 'largo '.repeat(500) }],
    ]);
    const files = render(g, { lang: 'es', targets: ['claude', 'cursor'] });
    expect(alwaysLoaded(files, 'cursor')).not.toContain('.cursor/rules/api.mdc');
    const cost = sessionCost(files, ['claude']);
    expect(cost[0].files).toContain('CLAUDE.md');
    expect(cost[0].files.some((f) => f.includes('agents'))).toBe(false); // los agentes se cargan solo al usarlos
  });
});
