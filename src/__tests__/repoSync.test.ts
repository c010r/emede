import { describe, expect, it } from 'vitest';
import { applyRepoPull, planRepoPull } from '../repoSync';
import { render } from '../generators';
import { LANGS } from '../i18n/langs';
import type { GenerateOptions } from '../design';
import { graph } from './helpers';
import { memDir } from './memfs';

const design = graph([
  ['project', 'project', { name: 'tienda', description: 'Tienda', memory: '# Tienda\n\n- Usar pnpm.' }],
  ['a', 'agent', { name: 'revisor', description: 'Revisa PRs. Usar cuando hay un diff.', prompt: 'Sos revisor.' }],
  ['s', 'skill', { name: 'pruebas', description: 'Escribe pruebas. Usar al agregar código.', instructions: 'Usá vitest.' }],
]);
const opts = (o: Partial<GenerateOptions> = {}): GenerateOptions =>
  ({ targets: ['claude', 'codex'], lang: 'es', fileOverrides: {}, excluded: [], ...o });
const repoOf = (o = opts()) => memDir({ ...render(design, { lang: o.lang, targets: o.targets }) });
const agentOf = (g: typeof design) => g.nodes.find((n) => n.id === 'a')!.data.d as { prompt: string; description: string };

describe('traer cambios del repo', () => {
  it('sin cambios no propone nada', async () => {
    const p = await planRepoPull(design, opts(), repoOf());
    expect(p.changes).toEqual([]);
    expect(p.missing).toEqual([]);
    expect(p.same).toBeGreaterThan(3);
  });

  it('un agente editado en .claude/agents actualiza la pieza (y llega a todas las plataformas)', async () => {
    const dir = repoOf();
    dir.files['.claude/agents/revisor.md'] = dir.files['.claude/agents/revisor.md'].replace('Sos revisor.', 'Sos revisor estricto.');
    const p = await planRepoPull(design, opts(), dir);
    expect(p.changes).toHaveLength(1);
    const [c] = p.changes;
    expect(c.type).toBe('update');
    expect(c.paths).toContain('.claude/agents/revisor.md');
    expect(c.after).toContain('Sos revisor estricto.');
    const { graph: g, overrides } = applyRepoPull(design, p.changes);
    expect(agentOf(g).prompt).toBe('Sos revisor estricto.');
    expect(overrides).toEqual([]);
    // Con el cambio aplicado, .claude ya coincide; .codex queda desactualizado hasta el próximo guardado.
    expect((await planRepoPull(g, opts({ targets: ['claude'] }), dir)).changes).toEqual([]);
    expect(render(g, { lang: 'es', targets: ['codex'] })['.codex/agents/revisor.toml']).toContain('Sos revisor estricto.');
  });

  it('la memoria editada en CLAUDE.md actualiza el proyecto', async () => {
    const dir = repoOf(opts({ targets: ['claude'] }));
    dir.files['CLAUDE.md'] = dir.files['CLAUDE.md'].replace('- Usar pnpm.', '- Usar pnpm.\n- No tocar dist/.');
    const p = await planRepoPull(design, opts({ targets: ['claude'] }), dir);
    const c = p.changes.find((x) => x.key === 'update:project');
    expect(c).toBeTruthy();
    const { graph: g } = applyRepoPull(design, [c!]);
    expect((g.nodes[0].data.d as { memory: string }).memory).toContain('No tocar dist/.');
  });

  it('una pieza nueva en el repo se ofrece para crear', async () => {
    const dir = repoOf();
    dir.files['.claude/commands/deploy.md'] = '---\ndescription: Publica la tienda\n---\n\nCorré `pnpm deploy`.\n';
    const p = await planRepoPull(design, opts(), dir);
    const c = p.changes.find((x) => x.type === 'create');
    expect(c?.label).toContain('/deploy');
    const { graph: g } = applyRepoPull(design, [c!]);
    expect(g.nodes.some((n) => n.data.d.kind === 'command' && n.data.d.name === 'deploy')).toBe(true);
  });

  it('lo que no es de ningún campo queda como edición manual del archivo', async () => {
    const dir = repoOf();
    const path = '.codex/agents/revisor.toml';
    dir.files[path] += '\n# nota a mano\n';
    const p = await planRepoPull(design, opts(), dir);
    const c = p.changes.find((x) => x.type === 'file');
    expect(c?.override?.path).toBe(path);
    const { overrides } = applyRepoPull(design, [c!]);
    expect(overrides[0]?.value.content).toContain('# nota a mano');
    expect((await planRepoPull(design, opts({ fileOverrides: { [path]: overrides[0]!.value } }), dir)).changes).toEqual([]);
  });

  it('informa los archivos que faltan en la carpeta', async () => {
    const dir = repoOf();
    delete dir.files['AGENTS.md'];
    const p = await planRepoPull(design, opts(), dir);
    expect(p.missing).toContain('AGENTS.md');
  });

  it.each([...LANGS])('reconoce los cambios con contenido en %s', async (lang) => {
    const o = opts({ lang, targets: ['claude'] });
    const dir = repoOf(o);
    dir.files['.claude/agents/revisor.md'] = dir.files['.claude/agents/revisor.md'].replace('Sos revisor.', 'Otro prompt.');
    const p = await planRepoPull(design, o, dir);
    expect(p.changes.map((c) => c.type)).toEqual(['update']);
    expect(agentOf(applyRepoPull(design, p.changes).graph).prompt).toBe('Otro prompt.');
  });
});
