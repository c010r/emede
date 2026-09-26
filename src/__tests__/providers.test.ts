import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiOf, hasAI, migrateSettings } from '../providers';
import { BusyError, generate, generateJSON, listModels, setWaitHandler, toJsonSchema } from '../llm';
import { compat, openai } from '../providers/openai';
import { proxyAllowed } from '../../server/api.ts';
import type { Settings } from '../types';

/* SDK de Anthropic simulado: guarda el pedido y devuelve lo que indique cada prueba. */
const sdk = vi.hoisted(() => ({
  params: [] as Record<string, unknown>[],
  reply: null as unknown,
  error: null as unknown,
}));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status: number;
    headers: Headers;
    constructor(status: number, message: string, headers: Record<string, string> = {}) {
      super(message);
      this.status = status;
      this.headers = new Headers(headers);
    }
  }
  class RateLimitError extends APIError {}
  class InternalServerError extends APIError {}
  class AuthenticationError extends APIError {}
  class NotFoundError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class BadRequestError extends APIError {}
  class APIConnectionError extends Error {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    static InternalServerError = InternalServerError;
    static AuthenticationError = AuthenticationError;
    static NotFoundError = NotFoundError;
    static PermissionDeniedError = PermissionDeniedError;
    static BadRequestError = BadRequestError;
    static APIConnectionError = APIConnectionError;
    opts: unknown;
    constructor(opts: unknown) {
      this.opts = opts;
    }
    beta = {
      messages: {
        stream: (p: Record<string, unknown>) => {
          sdk.params.push(p);
          return { finalMessage: async () => { if (sdk.error) throw sdk.error; return sdk.reply; } };
        },
      },
    };
    models = {
      list: async function* () {
        yield { id: 'claude-haiku-4-5' };
        yield { id: 'claude-opus-5' };
        yield { id: 'claude-sonnet-5' };
      },
    };
  }
  return { default: Anthropic };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setWaitHandler(null);
  sdk.params = [];
  sdk.error = null;
});

const settings = (s: Partial<Settings>): Settings => ({ provider: 'gemini', keys: {}, models: {}, lang: 'es', targets: ['claude'], ...s });
const SCHEMA = { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' }, tags: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['ok'] };

describe('ajustes de proveedores', () => {
  it('migra la clave de Gemini de versiones anteriores', () => {
    const s = migrateSettings({ apiKey: 'AIza1', model: 'gemini-x', lang: 'es' } as Partial<Settings>);
    expect(s).toMatchObject({ keys: { gemini: 'AIza1' }, models: { gemini: 'gemini-x' } });
    expect(s).not.toHaveProperty('apiKey');
  });

  it('cada proveedor conserva su clave y su modelo', () => {
    const s = settings({ provider: 'anthropic', keys: { gemini: 'g', anthropic: 'a' }, models: { gemini: 'gemini-x' } });
    expect(aiOf(s)).toMatchObject({ provider: 'anthropic', apiKey: 'a', model: 'claude-opus-5' });
    expect(aiOf({ ...s, provider: 'gemini' })).toMatchObject({ apiKey: 'g', model: 'gemini-x' });
  });

  it('un servidor local compatible no necesita clave', () => {
    expect(hasAI(settings({ provider: 'compat', baseUrl: 'http://localhost:11434/v1', models: { compat: 'llama3' } }))).toBe(true);
    expect(hasAI(settings({ provider: 'compat', baseUrl: 'https://openrouter.ai/api/v1', models: { compat: 'x' } }))).toBe(false);
    expect(hasAI(settings({ provider: 'openai' }))).toBe(false);
  });

  it('traduce el esquema al formato JSON Schema estándar', () => {
    expect(toJsonSchema(SCHEMA)).toEqual({
      type: 'object',
      properties: { ok: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['ok'], additionalProperties: false,
    });
  });
});

describe('Anthropic (SDK simulado)', () => {
  const cfg = { provider: 'anthropic' as const, apiKey: 'sk-ant-x', model: 'claude-opus-5' };

  it('pide JSON con esquema, adjunta PDF, sin temperature y con respaldo ante rechazos', async () => {
    sdk.reply = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":true}' }] };
    const out = await generateJSON<{ ok: boolean }>({ ...cfg, system: 'sys', prompt: 'hola', schema: SCHEMA, temperature: 0, files: [{ mimeType: 'application/pdf', data: 'QUJD' }] });
    expect(out).toEqual({ ok: true });
    const p = sdk.params[0] as { messages: { content: { type: string }[] }[]; output_config: { format: { type: string } }; temperature?: number; fallbacks?: string; betas?: string[] };
    expect(p.output_config.format.type).toBe('json_schema');
    expect(p.messages[0].content.map((b) => b.type)).toEqual(['document', 'text']);
    expect(p.temperature).toBeUndefined();
    expect(p).toMatchObject({ fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
  });

  it('modelos sin clasificadores no llevan el parámetro de respaldo', async () => {
    sdk.reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    await generate({ ...cfg, model: 'claude-haiku-4-5', system: '', prompt: 'x' });
    expect(sdk.params[0]).not.toHaveProperty('fallbacks');
  });

  it('un rechazo por seguridad se informa en vez de devolver texto vacío', async () => {
    sdk.reply = { stop_reason: 'refusal', stop_details: { explanation: 'categoría x' }, content: [] };
    await expect(generate({ ...cfg, system: '', prompt: 'x' })).rejects.toThrow(/políticas de seguridad: categoría x/);
  });

  it('límite de pedidos: espera lo que indica retry-after y reintenta', async () => {
    vi.useFakeTimers();
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    sdk.error = new (Anthropic as unknown as { RateLimitError: new (s: number, m: string, h: object) => Error }).RateLimitError(429, 'rate', { 'retry-after': '3' });
    const waited = vi.fn();
    setWaitHandler(waited);
    const p = generate({ ...cfg, system: '', prompt: 'x' });
    await vi.advanceTimersByTimeAsync(0);
    sdk.error = null;
    sdk.reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'listo' }] };
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBe('listo');
    expect(waited).toHaveBeenCalledWith('claude-opus-5', 3000);
  });

  it('clave inválida: error claro, sin reintentos', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    sdk.error = new (Anthropic as unknown as { AuthenticationError: new (s: number, m: string) => Error }).AuthenticationError(401, 'bad');
    await expect(generate({ ...cfg, system: '', prompt: 'x' })).rejects.toThrow('La API key de Anthropic no es válida.');
    expect(sdk.params).toHaveLength(1);
  });

  it('lista los modelos con Opus primero', async () => {
    expect(await listModels(cfg)).toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);
  });
});

describe('OpenAI y compatibles (HTTP simulado)', () => {
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    ({ status, ok: status < 400, headers: new Headers(headers), json: async () => body });

  it('OpenAI: salida estructurada, PDF como archivo y sin temperature', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return reply(200, { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] });
    });
    const out = await openai.once({ provider: 'openai', apiKey: 'sk', model: 'gpt-5', system: 's', prompt: 'p', schema: SCHEMA, temperature: 0, files: [{ mimeType: 'application/pdf', data: 'QUJD' }] }, 'gpt-5');
    expect(out).toBe('{"ok":true}');
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0].body).toMatchObject({ response_format: { type: 'json_schema' } });
    expect(calls[0].body).not.toHaveProperty('temperature');
    expect(JSON.stringify(calls[0].body.messages)).toContain('data:application/pdf;base64,QUJD');
  });

  it('compatible sin salida estructurada: reintenta pidiendo el JSON en el texto', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      return body.response_format
        ? reply(400, { error: { message: 'response_format not supported' } })
        : reply(200, { choices: [{ message: { content: '```json\n{"ok":false}\n```' } }] });
    });
    const out = await generateJSON<{ ok: boolean }>({ provider: 'compat', baseUrl: 'http://localhost:11434/v1/', apiKey: '', model: 'llama3', system: '', prompt: 'p', schema: SCHEMA });
    expect(out).toEqual({ ok: false });
    expect(JSON.stringify(bodies[1].messages)).toContain('JSON Schema');
  });

  it('compatible: no acepta PDF y avisa', async () => {
    await expect(compat.once({ provider: 'compat', baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'm', system: '', prompt: 'p', files: [{ mimeType: 'application/pdf', data: 'x' }] }, 'm'))
      .rejects.toThrow(/no lee PDF/);
  });

  it('errores: clave inválida, modelo inexistente, sin saldo y sobrecarga', async () => {
    const run = async (status: number, body: unknown) => {
      vi.stubGlobal('fetch', async () => reply(status, body));
      return openai.once({ provider: 'openai', apiKey: 'sk', model: 'm', system: '', prompt: 'p' }, 'm').catch((e) => e);
    };
    expect((await run(401, { error: { message: 'x' } })).message).toBe('La API key de OpenAI no es válida.');
    expect(await run(404, { error: { message: 'x', code: 'model_not_found' } })).toMatchObject({ gone: true });
    const quota = await run(429, { error: { message: 'x', code: 'insufficient_quota' } });
    expect(quota).toBeInstanceOf(BusyError);
    expect(quota.rate).toBe(false);
    expect(await run(503, {})).toBeInstanceOf(BusyError);
  });

  it('OpenAI: lista solo modelos de texto', async () => {
    vi.stubGlobal('fetch', async () => reply(200, { data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }, { id: 'whisper-1' }, { id: 'gpt-4o-realtime' }, { id: 'text-embedding-3' }] }));
    expect(await listModels({ provider: 'openai', apiKey: 'sk', model: '' })).toEqual(['gpt-5', 'gpt-5-mini']);
  });
});

describe('intermediario del servidor local', () => {
  it('solo reenvía a APIs de IA por https o al propio equipo', () => {
    expect(proxyAllowed('https://openrouter.ai/api/v1/chat/completions')).toBe(true);
    expect(proxyAllowed('http://localhost:11434/v1/models')).toBe(true);
    expect(proxyAllowed('http://example.com/v1/chat/completions')).toBe(false);
    expect(proxyAllowed('https://example.com/admin')).toBe(false);
    expect(proxyAllowed('file:///etc/passwd')).toBe(false);
    expect(proxyAllowed('https://user:pass@example.com/v1/models')).toBe(false);
  });
});
