import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '../generators';
import { importFromRepo } from '../importers/repo';
import { designFromPlan } from '../ai';
import { initialGraph, useStore } from '../store';
import { newCanaryPhrase } from '../defaults';
import type { ProjectData } from '../types';
import { ALL_TARGETS, graph } from './helpers';
import { memDir } from './memfs';

const canary = { enabled: true, phrase: '🐤 CANARIO-TEST', agents: true, style: 'marker' as const };
const all = { lang: 'es' as const, targets: [...ALL_TARGETS] };

describe('canario de contexto', () => {
  const g = graph([
    ['project', 'project', { name: 'tienda', memory: '# Tienda\n\nUna tienda.\n\n## Comandos\n\n`npm test`', canary }],
    ['a', 'agent', { name: 'rev', description: 'Revisa', prompt: 'Sos revisor.' }],
  ]);
  const f = render(g, all);

  it('va arriba de cada archivo de memoria: después de la introducción y antes de la primera sección', () => {
    for (const path of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursor/rules/proyecto.mdc']) {
      const text = f[path];
      expect(text, path).toContain('`🐤 CANARIO-TEST`');
      expect(text.indexOf('Una tienda.'), path).toBeLessThan(text.indexOf('Canario de contexto'));
      expect(text.indexOf('Canario de contexto'), path).toBeLessThan(text.indexOf('## Comandos'));
    }
    expect(f['CLAUDE.md'].startsWith('# Tienda\n\nUna tienda.\n\n## Canario de contexto')).toBe(true);
    expect(f['CLAUDE.md']).toContain('No inventes archivos');
  });

  it('los subagentes empiezan su informe con la marca (en todas las plataformas)', () => {
    for (const path of ['.claude/agents/rev.md', '.opencode/agents/rev.md', '.codex/agents/rev.toml', '.gemini/agents/rev.md', '.cursor/agents/rev.md', '.github/agents/rev.agent.md'])
      expect(f[path], path).toContain('Empezá tu informe final con `🐤 CANARIO-TEST`');
  });

  it('se puede desactivar, o dejar solo en la memoria', () => {
    const off = render(graph([['project', 'project', { canary: { ...canary, enabled: false } }]]), all);
    expect(off['CLAUDE.md']).not.toContain('CANARIO');
    const noAgents = render(graph([['project', 'project', { canary: { ...canary, agents: false } }], ['a', 'agent', { name: 'x' }]]), { lang: 'es', targets: ['claude'] });
    expect(noAgents['CLAUDE.md']).toContain('CANARIO');
    expect(noAgents['.claude/agents/x.md']).not.toContain('CANARIO');
  });

  it('variante con nombre: el agente se dirige al usuario por su nombre, y se recupera al importar', async () => {
    const byName = { enabled: true, phrase: 'Ana', agents: true, style: 'name' as const };
    const gn = graph([
      ['project', 'project', { name: 'x', memory: '# X\n\nIntro.\n\n## Uso', canary: byName }],
      ['a', 'agent', { name: 'rev', description: 'Revisa', prompt: 'Sos revisor.' }],
    ]);
    const fn = render(gn, { lang: 'es', targets: ['claude'] });
    expect(fn['CLAUDE.md']).toContain('Dirigite siempre a mí como **Ana**: empezá **cada** respuesta con “Ana,”');
    expect(fn['CLAUDE.md']).not.toContain('CANARIO');
    expect(fn['.claude/agents/rev.md']).toContain('Empezá tu informe final con “Informe para Ana:”');
    const { graph: back } = await importFromRepo(memDir({ ...fn }));
    expect((back.nodes.find((n) => n.id === 'project')!.data.d as ProjectData).canary).toEqual(byName);
    expect((back.nodes.find((n) => n.data.d.kind === 'agent')!.data.d as { prompt: string }).prompt).toBe('Sos revisor.');
    expect(render(back, { lang: 'es', targets: ['claude'] })['CLAUDE.md']).toBe(fn['CLAUDE.md']);
  });

  it('las marcas generadas son únicas y reconocibles', () => {
    const a = newCanaryPhrase(), b = newCanaryPhrase();
    expect(a).toMatch(/^🐤 CANARIO-[A-Z2-9]{4}$/);
    expect(a).not.toBe(b);
  });

  it('al importar un repo se conserva la marca y no se duplica la sección', async () => {
    const { graph: back } = await importFromRepo(memDir({ ...render(g, { lang: 'es', targets: ['claude'] }) }));
    const p = back.nodes.find((n) => n.id === 'project')!.data.d as ProjectData;
    expect(p.canary).toEqual(canary);
    expect(p.memory).not.toContain('Canario');
    const agent = back.nodes.find((n) => n.data.d.kind === 'agent')!.data.d as { prompt: string };
    expect(agent.prompt).toBe('Sos revisor.');
    // Regenerar lo importado produce el mismo CLAUDE.md
    expect(render(back, { lang: 'es', targets: ['claude'] })['CLAUDE.md']).toBe(render(g, { lang: 'es', targets: ['claude'] })['CLAUDE.md']);
  });
});

describe('plan del proyecto', () => {
  it('se escribe en docs/PLAN.md y la memoria lo referencia; al importar se recupera', async () => {
    const g = graph([['project', 'project', { name: 'x', memory: '# X', plan: '# Plan\n\n1. Fase uno' }]]);
    const f = render(g, { lang: 'es', targets: ['claude', 'codex'] });
    expect(f['docs/PLAN.md']).toBe('# Plan\n\n1. Fase uno\n');
    expect(f['CLAUDE.md']).toContain('docs/PLAN.md');
    expect(f['AGENTS.md']).toContain('docs/PLAN.md');
    const { graph: back } = await importFromRepo(memDir({ ...f }));
    const p = back.nodes.find((n) => n.id === 'project')!.data.d as ProjectData;
    expect(p.plan).toBe('# Plan\n\n1. Fase uno');
    expect(p.memory).not.toContain('Plan del proyecto');
  });
});

describe('generar desde un plan (IA simulada)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = {
    project: { name: 'Mi App', description: 'Gestión de turnos', stack: 'Next.js 15, PostgreSQL', memory: '# Mi App', dev: 'npm run dev' },
    agents: [{ name: 'backend', description: 'API y datos', tools: ['read', 'edit'], prompt: 'Sos backend.', skills: ['migraciones'] }],
    skills: [{ name: 'migraciones', description: 'Migrar', instructions: 'Pasos' }],
    commands: [{ name: 'siguiente-tarea', description: 'Avanza', prompt: 'Tomá la próxima tarea de docs/PLAN.md', agent: 'backend' }],
    rules: [{ name: 'sin-orm-raw', description: 'x', content: '- No SQL crudo' }],
    planMarkdown: '# Transcripción del PDF',
  };
  const stub = () => {
    const bodies: { contents: { parts: Record<string, unknown>[] }[] }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) };
    });
    return bodies;
  };

  it('manda el texto del plan, arma el grafo y guarda el plan', async () => {
    const bodies = stub();
    useStore.getState().setSettings({ keys: { gemini: 'k' } });
    useStore.getState().loadProject({ id: 'p', graph: initialGraph() });
    const g = await designFromPlan({ text: '# Plan\n\nFase 1: API de turnos', keepPlan: true, keepProject: false });
    const prompt = String(bodies[0].contents[0].parts.at(-1)!.text);
    expect(prompt).toContain('Fase 1: API de turnos');
    expect(prompt).toContain('planMarkdown: dejalo vacío');
    const p = g.nodes.find((n) => n.id === 'project')!.data.d as ProjectData;
    expect(p.name).toBe('mi-app');
    expect(p.plan).toBe('# Plan\n\nFase 1: API de turnos');
    expect(p.stackItems.map((i) => i.id)).toEqual(['nextjs', 'postgresql']);
    expect(g.edges).toHaveLength(2); // comando → agente y agente → skill
  });

  it('con PDF lo adjunta como archivo y usa la transcripción como plan', async () => {
    const bodies = stub();
    const g = await designFromPlan({ pdf: { name: 'plan.pdf', data: 'JVBERi0x' }, keepPlan: true, keepProject: false });
    expect(bodies[0].contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'application/pdf', data: 'JVBERi0x' } });
    expect(String(bodies[0].contents[0].parts.at(-1)!.text)).toContain('transcribí el plan completo');
    expect((g.nodes[0].data.d as ProjectData).plan).toBe('# Transcripción del PDF');
  });

  it('sin plan no llama a la IA', async () => {
    await expect(designFromPlan({ text: '  ', keepPlan: true, keepProject: false })).rejects.toThrow(/Pegá el plan/);
  });
});
