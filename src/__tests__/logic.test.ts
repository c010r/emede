import { afterEach, describe, expect, it, vi } from 'vitest';
import { collapse, diffLines, diffStats } from '../diff';
import { parseStack, suggestCommands } from '../stack';
import { validate } from '../validate';
import { computeOutput } from '../output';
import { render } from '../generators';
import { generate, setBusyHandler, setWaitHandler } from '../llm';
import { graph } from './helpers';

describe('diff', () => {
  it('detecta agregados y borrados', () => {
    const d = diffLines('a\nb\nc', 'a\nx\nc\nd');
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
    expect(d.map((l) => l.type)).toEqual(['same', 'del', 'add', 'same', 'add']);
  });
  it('colapsa zonas sin cambios', () => {
    const before = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l15', 'X');
    expect(collapse(diffLines(before, after), 2).filter((l) => l.type === 'gap')).toHaveLength(2);
  });
});

describe('stack', () => {
  it('interpreta texto libre y deduce comandos', () => {
    const items = parseStack('Next.js 15, pnpm, Vitest, Celery');
    expect(items.map((i) => i.id)).toEqual(['nextjs', 'pnpm', 'vitest', 'custom-celery']);
    expect(suggestCommands(items)).toMatchObject({ dev: 'pnpm dev', test: 'pnpm test' });
  });
  it('la herramienta de test elegida manda sobre el framework', () => {
    expect(suggestCommands(parseStack('Django, uv, pytest')).test).toBe('uv run pytest');
  });
});

describe('validador', () => {
  const run = (g: ReturnType<typeof graph>, targets = ['claude'] as const) => {
    const files = computeOutput(render(g, { lang: 'es', targets: [...targets] }), {}, []);
    return validate(g, { targets: [...targets] }, files);
  };
  it('marca agentes sin descripción como error y nombres duplicados', () => {
    const issues = run(graph([['a', 'agent', { name: 'x' }], ['b', 'agent', { name: 'X' }]]));
    expect(issues.filter((i) => i.level === 'error' && i.message.includes('descripción'))).toHaveLength(2);
    expect(issues.some((i) => i.nodeId === 'b' && i.message.includes('mismo nombre'))).toBe(true);
  });
  it('avisa si no hay plataformas', () => {
    expect(validate(graph([]), { targets: [] }, [])[0]).toMatchObject({ level: 'error' });
  });
  it('avisa si lo que se carga en cada sesión pesa demasiado (en tokens)', () => {
    const memory = Array.from({ length: 400 }, (_, i) => `- Regla número ${i}: usá nombres descriptivos en las funciones.`).join('\n');
    const issue = run(graph([['project', 'project', { memory }]])).find((i) => i.code === 'memory-long');
    expect(issue?.path).toBe('CLAUDE.md');
    expect(issue?.message).toMatch(/≈\d/);
    // Una memoria corta no avisa.
    expect(run(graph([['project', 'project', { memory: '# Proyecto' }]])).some((i) => i.code === 'memory-long')).toBe(false);
  });
  it('un diseño completo no tiene errores', () => {
    const g = graph([
      ['project', 'project', { description: 'Tienda', test: 'npm test', memory: '# x' }],
      ['a', 'agent', { name: 'reviewer', description: 'Revisa PRs antes de mergear', prompt: 'Sos revisor.' }],
    ]);
    expect(run(g).filter((i) => i.level !== 'info')).toEqual([]);
  });
});

describe('gemini: esperas y reintentos', () => {
  afterEach(() => {
    vi.useRealTimers();
    setBusyHandler(null);
    setWaitHandler(null);
  });

  it('con límite por minuto espera y reintenta el mismo modelo sin preguntar', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return calls === 1
        ? { ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded for metric: requests per minute. Please retry in 7s.' } }) }
        : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
    });
    const asked = vi.fn(async () => null);
    const waited = vi.fn();
    setBusyHandler(asked);
    setWaitHandler(waited);
    const p = generate({ apiKey: 'k', model: 'm', system: '', prompt: '' });
    await vi.advanceTimersByTimeAsync(7000);
    expect(await p).toBe('ok');
    expect(waited).toHaveBeenCalledWith('m', 7000);
    expect(asked).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('cuota cero: pide otro modelo de inmediato', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('/pro:')
        ? { ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded, limit: 0, model: pro' } }) }
        : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok flash' }] } }] }) });
    setBusyHandler(async () => 'flash');
    expect(await generate({ apiKey: 'k', model: 'pro', system: '', prompt: '' })).toBe('ok flash');
    vi.unstubAllGlobals();
  });
});
