import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { candidates, improveDescriptions, NONE, resolveChoice, runRouting, suggestCases, type RoutingCase } from '../routing';
import type { AgentData } from '../types';
import { graph } from './helpers';

const g = graph([
  ['project', 'project', { name: 'tienda' }],
  ['a', 'agent', { name: 'revisor', description: 'Revisa PRs. Usar antes de abrir un PR.', prompt: 'SECRETO-DEL-PROMPT: revisá el diff.' }],
  ['s', 'skill', { name: 'migraciones', description: 'Base de datos.', instructions: 'Creá migraciones con prisma migrate.' }],
  ['c', 'command', { name: 'deploy', description: 'Publica', prompt: 'x' }],
]);

/** Gemini simulado: cada llamada devuelve lo que arme `reply` con el prompt recibido. */
function fakeGemini(reply: (prompt: string, system: string) => object) {
  const calls: { prompt: string; system: string }[] = [];
  vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const prompt = body.contents[0].parts.at(-1).text as string;
    const system = body.systemInstruction?.parts?.[0]?.text ?? '';
    calls.push({ prompt, system });
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply(prompt, system)) }] } }] }) };
  });
  return calls;
}

const settings = () => useStore.getState().settings;
beforeEach(() => {
  vi.unstubAllGlobals();
  useStore.getState().setSettings({ provider: 'gemini', keys: { gemini: 'k' }, models: { gemini: 'gemini-x' } });
});
afterEach(() => vi.unstubAllGlobals());

const cases: RoutingCase[] = [
  { id: 'c1', request: 'mirá mis cambios antes del PR', expect: 'agent:revisor' },
  { id: 'c2', request: 'agregá una columna email a users', expect: 'skill:migraciones' },
  { id: 'c3', request: 'explicame este error de TypeScript', expect: NONE },
];

describe('prueba de enrutamiento', () => {
  it('los candidatos son agentes y skills (los comandos se invocan a mano)', () => {
    expect(candidates(g).map((c) => c.key)).toEqual(['agent:revisor', 'skill:migraciones']);
  });

  it('normaliza la elección del modelo', () => {
    const list = candidates(g);
    expect(resolveChoice('agent:revisor', list)).toBe('agent:revisor');
    expect(resolveChoice('Revisor', list)).toBe('agent:revisor');
    expect(resolveChoice('skill: migraciones', list)).toBe('skill:migraciones');
    expect(resolveChoice('ninguno', list)).toBe(NONE);
    expect(resolveChoice('agent:inventado', list)).toBe(NONE);
  });

  it('el modelo ve solo nombre y descripción, y se marca qué acertó', async () => {
    const calls = fakeGemini(() => ({
      results: [
        { index: 0, choice: 'agent:revisor', reason: 'Es una revisión.' },
        { index: 1, choice: 'none', reason: 'La descripción no dice cuándo usarla.' },
        { index: 2, choice: 'none', reason: 'Tarea general.' },
      ],
    }));
    const res = await runRouting(g, cases, settings());
    expect(res.map((r) => [r.caseId, r.chosen, r.ok])).toEqual([
      ['c1', 'agent:revisor', true], ['c2', NONE, false], ['c3', NONE, true],
    ]);
    // Como en la herramienta real: las descripciones sí, el cuerpo del agente no.
    expect(calls[0].prompt).toContain('Revisa PRs. Usar antes de abrir un PR.');
    expect(calls[0].prompt).not.toContain('SECRETO-DEL-PROMPT');
    expect(calls[0].prompt).not.toContain('deploy');
  });

  it('los casos sugeridos salen de lo que hace cada pieza y descartan claves inventadas', async () => {
    const calls = fakeGemini(() => ({
      cases: [
        { request: 'revisá el PR 12', expect: 'agent:revisor' },
        { request: 'hacé un café', expect: 'agent:barista' },
        { request: '  ', expect: 'none' },
      ],
    }));
    const res = await suggestCases(g, settings());
    expect(res.map((c) => [c.request, c.expect])).toEqual([['revisá el PR 12', 'agent:revisor'], ['hacé un café', NONE]]);
    expect(calls[0].prompt).toContain('prisma migrate'); // se usa el cuerpo, no la descripción
  });

  it('mejorar descripciones toca solo las piezas involucradas en los fallos', async () => {
    fakeGemini(() => ({
      pieces: [
        { key: 'skill:migraciones', description: 'Crea y aplica migraciones de base de datos. Usar al cambiar el esquema.' },
        { key: 'agent:revisor', description: 'No debería cambiar.' },
      ],
    }));
    const results = [
      { caseId: 'c1', chosen: 'agent:revisor', reason: '', ok: true },
      { caseId: 'c2', chosen: NONE, reason: '', ok: false },
    ];
    const { graph: out, changed } = await improveDescriptions(g, cases, results, settings());
    expect(changed).toEqual(['s']);
    expect((out.nodes.find((n) => n.id === 's')!.data.d as AgentData).description).toContain('Usar al cambiar el esquema');
    expect((out.nodes.find((n) => n.id === 'a')!.data.d as AgentData).description).toBe('Revisa PRs. Usar antes de abrir un PR.');
  });
});
