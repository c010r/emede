import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { answerQuestions, currentIssues, repairAll, useRepair } from '../repair';
import type { AgentData, ProjectData, RuleData } from '../types';
import { graph } from './helpers';

const load = (g: ReturnType<typeof graph>, apiKey = '') => {
  useStore.getState().setSettings({ keys: { gemini: apiKey }, targets: ['claude'] });
  useStore.getState().loadProject({ id: 'r', graph: g });
  useRepair.setState({ questions: [], showQuestions: false, report: '', audit: null, running: false, requested: false });
};
const data = <T>(id: string) => useStore.getState().nodes.find((n) => n.id === id)?.data.d as T;
const codes = () => currentIssues().map((i) => `${i.code}:${i.nodeId ?? ''}`);

/** Gemini simulado: cada llamada devuelve lo que arme `reply` con el prompt recibido. */
function fakeGemini(reply: (prompt: string) => object) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
    const prompt = JSON.parse(String(init.body)).contents[0].parts.at(-1).text as string;
    calls.push(prompt);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply(prompt)) }] } }] }) };
  });
  return calls;
}

const described = { description: 'Proyecto de prueba', test: 'npm test', memory: '# Proyecto' };

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('reparación sin IA', () => {
  it('arregla sola lo fijo y pregunta lo que no puede decidir', async () => {
    load(graph([
      ['project', 'project', described],
      ['a', 'agent', { name: 'revisor', description: 'Revisa PRs. Usar cuando hay un diff listo.', prompt: 'Sos revisor.' }],
      ['b', 'agent', { name: 'Revisor', description: 'Escribe tests. Usar cuando falta cobertura.', prompt: 'Sos tester.' }],
      ['c', 'command', { name: 'fix', description: 'Arregla un bug', prompt: 'Arreglá $ARGUMENTS' }],
      ['r', 'rule', { name: 'estilo', description: 'Estilo', alwaysApply: false, globs: '', content: '- Usá tabs.' }],
    ]));
    await repairAll({ fresh: true });

    expect(data<AgentData>('b').name).toBe('revisor-2'); // nombre duplicado
    expect(codes()).not.toContain('args-hint:c');
    const qs = useRepair.getState().questions;
    expect(qs.map((q) => q.key)).toEqual(['rule-scope:r']);
    expect(useRepair.getState().showQuestions).toBe(true);

    await answerQuestions(new Map([['rule-scope:r', { choice: [], values: { globs: 'src/**/*.ts' } }]]));
    expect(data<RuleData>('r').globs).toBe('src/**/*.ts');
    expect(useRepair.getState().questions).toEqual([]);
  });

  it('"dejarlo así" no se vuelve a marcar y queda guardado en el proyecto', async () => {
    load(graph([['project', 'project', described], ['r', 'rule', { name: 'estilo', description: 'Estilo', alwaysApply: false, content: '- Usá tabs.' }]]));
    await repairAll({ fresh: true });
    await answerQuestions(new Map([['rule-scope:r', { choice: [], values: {}, ignore: true }]]));
    expect(codes()).not.toContain('rule-scope:r');
    expect(data<ProjectData>('project').review?.ignored).toContain('rule-scope:r');
    await repairAll({ fresh: true });
    expect(useRepair.getState().questions).toEqual([]);
  });

  it('un nodo vacío pregunta para qué sirve en vez de inventarlo', async () => {
    load(graph([['project', 'project', described], ['x', 'skill']]));
    await repairAll({ fresh: true });
    expect(useRepair.getState().questions.map((q) => q.key)).toContain('purpose:x');
    await answerQuestions(new Map([['purpose:x', { choice: ['delete'], values: {} }]]));
    expect(data('x')).toBeUndefined();
  });
});

describe('reparación con IA (simulada)', () => {
  it('corrige todo en un paso que se deshace con un Ctrl+Z', async () => {
    load(graph([
      ['project', 'project', described],
      ['a', 'agent', { name: 'revisor', description: '', prompt: 'Revisá los cambios apropiadamente, etc.' }],
    ]), 'k');
    const calls = fakeGemini(() => ({
      fixes: [
        { id: 'a', field: 'description', value: 'Revisa diffs antes de mergear. Usar cuando hay un PR listo para revisión.' },
        { id: 'a', field: 'prompt', value: 'Sos revisor. 1. Leé el diff. 2. Corré npm test. 3. Listá errores con archivo y línea.' },
        { id: 'a', field: 'tools', value: 'read, search, hackear' },
      ],
    }));
    await repairAll({ fresh: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('No uses: "apropiado"'); // la IA recibe las mismas reglas que los chequeos
    expect(currentIssues().filter((i) => i.nodeId === 'a')).toEqual([]);
    expect(data<AgentData>('a').tools).toEqual(['read', 'search']);
    useStore.getState().undo();
    expect(data<AgentData>('a').description).toBe('');
  });

  it('si la IA no lo resuelve en dos intentos, pregunta en vez de insistir', async () => {
    load(graph([
      ['project', 'project', described],
      ['a', 'agent', { name: 'revisor', description: 'Revisa', prompt: 'Sos revisor.' }],
    ]), 'k');
    const calls = fakeGemini(() => ({ fixes: [{ id: 'a', field: 'description', value: 'Revisa' }] }));
    await repairAll({ fresh: true });

    expect(calls).toHaveLength(2);
    const q = useRepair.getState().questions.find((x) => x.key === 'short-description:a');
    expect(q?.title).toMatch(/No pude resolverlo/);

    // La respuesta vuelve a la IA con el nodo.
    fakeGemini(() => ({ fixes: [{ id: 'a', field: 'description', value: 'Revisa PRs de backend. Usar cuando un PR toca src/api.' }] }));
    await answerQuestions(new Map([['short-description:a', { choice: [], values: { text: 'Solo revisa backend' } }]]));
    expect(data<AgentData>('a').description).toMatch(/Usar cuando/);
  });

  it('las preguntas de la IA llegan al modal', async () => {
    load(graph([
      ['project', 'project', described],
      ['a', 'agent', { name: 'deployer', description: 'Despliega', prompt: 'Desplegá.' }],
    ]), 'k');
    fakeGemini(() => ({ fixes: [], questions: [{ id: 'a', question: '¿Dónde se despliega?', options: ['Vercel', 'AWS'] }] }));
    await repairAll({ fresh: true });
    const q = useRepair.getState().questions.find((x) => x.title === '¿Dónde se despliega?');
    expect(q?.options?.map((o) => o.label)).toEqual(['Vercel', 'AWS']);
    expect(q?.nodeId).toBe('a');
  });
});
