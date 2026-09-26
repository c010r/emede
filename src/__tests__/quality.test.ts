import { afterEach, describe, expect, it, vi } from 'vitest';
import { qualityIssues, similarity } from '../quality';
import { auditDesign } from '../audit';
import { initialGraph, useStore } from '../store';
import { emptyData } from '../defaults';
import type { NodeData, ProjectData } from '../types';
import { graph } from './helpers';

describe('chequeos estáticos de calidad', () => {
  it('detecta principios abstractos sin ejemplos concretos', () => {
    const g = graph([['r', 'rule', { name: 'estilo', content: '- Seguí SOLID y KISS.\n- Usá tabs.' }]]);
    expect(qualityIssues(g).some((i) => i.nodeId === 'r' && i.message.includes('principios abstractos'))).toBe(true);
  });

  it('no molesta cuando el principio viene con explicación concreta', () => {
    const g = graph([['r', 'rule', { name: 'estilo', content: '- DRY: si copiás un bloque de más de 10 líneas por tercera vez, extraelo a src/lib y agregá un test que cubra ambos usos.' }]]);
    expect(qualityIssues(g).filter((i) => i.message.includes('abstractos'))).toEqual([]);
  });

  it('detecta instrucciones vagas', () => {
    const g = graph([['a', 'agent', { name: 'dev', prompt: 'Hacé los cambios apropiados y corré tests cuando sea necesario, etc.' }]]);
    expect(qualityIssues(g).some((i) => i.message.includes('vagas'))).toBe(true);
  });

  it('detecta agentes con descripciones casi iguales', () => {
    expect(similarity('Revisa el código de los pull requests', 'Revisa el código de pull requests nuevos')).toBeGreaterThan(0.6);
    const g = graph([
      ['a', 'agent', { name: 'rev1', description: 'Revisa el código de los pull requests antes de mergear' }],
      ['b', 'agent', { name: 'rev2', description: 'Revisa el código de los pull requests antes de mergear cambios' }],
    ]);
    expect(qualityIssues(g).some((i) => i.nodeId === 'b' && i.message.includes('casi iguales'))).toBe(true);
  });

  it('pide que las skills digan cuándo usarse', () => {
    const vague = graph([['s', 'skill', { name: 'migraciones', description: 'Procedimiento de migraciones de base de datos seguras' }]]);
    const clear = graph([['s', 'skill', { name: 'migraciones', description: 'Usar cuando se modifica el esquema de la base de datos' }]]);
    expect(qualityIssues(vague).some((i) => i.message.includes('cuándo usarla'))).toBe(true);
    expect(qualityIssues(clear).some((i) => i.message.includes('cuándo usarla'))).toBe(false);
  });
});

describe('auditoría con IA (simulada)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mapea hallazgos a nodos, no varía y no repite lo ya tratado', async () => {
    const g = initialGraph();
    g.nodes.push({ id: 'a1', type: 'card', position: { x: 0, y: 0 }, data: { d: { ...emptyData('agent'), name: 'code-reviewer', prompt: 'Revisá bien.' } as NodeData } });
    const p = g.nodes[0].data.d as ProjectData;
    p.review = { ignored: [], treated: ['/deploy: no tiene rollback'] };
    useStore.getState().setSettings({ keys: { gemini: 'k' } });
    useStore.getState().loadProject({ id: 'audit', graph: g });
    let body: { contents: { parts: { text: string }[] }[]; generationConfig: { temperature: number } } | undefined;
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return {
        ok: true, status: 200, json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            score: 62, summary: 'Faltan criterios verificables.',
            findings: [
              { kind: 'agent', name: 'Code Reviewer', severity: 'warn', issue: 'Prompt vago', suggestion: 'Definí el proceso' },
              { kind: 'skill', name: 'testing', severity: 'warn', issue: 'Falta una skill de testing', suggestion: 'Agregala' },
              { kind: 'project', name: 'x', severity: 'error', issue: 'No dice cómo desplegar', suggestion: 'x', question: '¿Dónde se despliega?' },
            ],
          }) }] } }],
        }),
      };
    });
    const res = await auditDesign();
    const prompt = body!.contents[0].parts.at(-1)!.text;
    expect(prompt).toContain('[agent] code-reviewer');
    expect(prompt).toContain('/deploy: no tiene rollback');
    expect(prompt).toContain('findings vacío');
    expect(body!.generationConfig.temperature).toBe(0);
    expect(res.score).toBe(62);
    expect(res.findings[0]).toMatchObject({ nodeId: 'a1', kind: 'agent' });
    expect(res.findings[1].nodeId).toBeUndefined();
    expect(res.findings[2]).toMatchObject({ nodeId: 'project', question: '¿Dónde se despliega?' });
  });
});
