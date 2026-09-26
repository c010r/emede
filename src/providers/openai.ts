import { t } from '../i18n';
import { stripHidden } from '../sanitize';
import { BusyError, toJsonSchema, type Adapter, type LLMRequest } from '../llm';
import type { LLMConfig } from '.';

/*
 * OpenAI y servicios compatibles con su API (OpenRouter, DeepSeek, Groq, Mistral, xAI, Ollama, LM Studio…).
 * Los compatibles pasan por el servidor local de emede cuando está: muchos no aceptan pedidos directos
 * del navegador (CORS) y los locales (Ollama) no los aceptan por defecto.
 */

const OPENAI = 'https://api.openai.com/v1';
const base = (cfg: LLMConfig) => (cfg.provider === 'openai' ? OPENAI : (cfg.baseUrl ?? '').trim().replace(/\/+$/, ''));

let viaServer: () => boolean = () => false;
/** Lo configura el arranque de la app: hay servidor local para hacer de intermediario. */
export const setCompatProxy = (fn: () => boolean) => {
  viaServer = fn;
};

interface Res {
  status: number;
  headers: { get(k: string): string | null };
  json(): Promise<unknown>;
}

async function call(cfg: LLMConfig, path: string, body?: unknown): Promise<Res> {
  const url = `${base(cfg)}${path}`;
  if (!/^https?:\/\//.test(url)) throw new Error(t('err.noBaseUrl'));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const init = { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) };
  try {
    if (cfg.provider === 'compat' && viaServer()) {
      return await fetch('/api/ai/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, ...init }) });
    }
    return await fetch(url, init);
  } catch {
    throw new Error(t(/localhost|127\.0\.0\.1/.test(url) ? 'err.connectLocal' : 'err.connect', { host: new URL(url).host }));
  }
}

type ErrBody = { error?: { message?: string; code?: string; type?: string } | string };
const errMessage = (j: ErrBody, status: number) => (typeof j.error === 'string' ? j.error : j.error?.message) ?? `El proveedor respondió ${status}`;

function toError(res: Res, j: ErrBody, provider: string): Error {
  const message = errMessage(j, res.status);
  const code = typeof j.error === 'object' ? j.error?.code ?? j.error?.type : '';
  const after = parseFloat(res.headers.get('retry-after') ?? message.match(/try again in ([\d.]+)s/i)?.[1] ?? '');
  const retry = Number.isFinite(after) ? Math.ceil(after * 1000) : undefined;
  if (res.status === 401) return new Error(t('err.badKey', { provider }));
  if (res.status === 404 || code === 'model_not_found') return new BusyError(`${t('err.modelGone')} ${message}`, undefined, true);
  if (res.status === 429 && code === 'insufficient_quota') return new BusyError(t('err.noCredit'));
  if (res.status === 429) return new BusyError(t('err.rateLimit'), retry, false, undefined, true);
  if (res.status >= 500) return new BusyError(`${t('err.overloaded', { provider })} (${res.status})`, retry);
  return new Error(message);
}

function adapterFor(kind: 'openai' | 'compat'): Adapter {
  const label = (cfg: LLMConfig) => (kind === 'openai' ? 'OpenAI' : new URL(base(cfg) || 'http://proveedor').host);

  async function once(req: LLMRequest, model: string): Promise<string> {
    if (req.files?.length && kind === 'compat')
      throw new Error(t('err.noPdf'));
    const user = req.files?.length
      ? [
          ...req.files.map((f, i) => ({ type: 'file', file: { filename: `adjunto-${i + 1}.pdf`, file_data: `data:${f.mimeType};base64,${f.data}` } })),
          { type: 'text', text: req.prompt },
        ]
      : req.prompt;
    const messages = [...(req.system ? [{ role: 'system', content: req.system }] : []), { role: 'user', content: user }];
    const body = (structured: boolean) => ({
      model, messages,
      // Los modelos de razonamiento de OpenAI no aceptan temperature: solo se manda a los compatibles.
      ...(kind === 'compat' && req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.schema && structured
        ? { response_format: { type: 'json_schema', json_schema: { name: 'respuesta', schema: toJsonSchema(req.schema), strict: false } } }
        : {}),
    });

    let res = await call({ ...req, provider: kind }, '/chat/completions', body(true));
    let j = (await res.json().catch(() => ({}))) as ErrBody & { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    // Proveedores sin salida estructurada: se pide el JSON en el texto.
    if (res.status === 400 && req.schema && kind === 'compat') {
      const withSchema = { ...req, prompt: `${req.prompt}\n\nRespondé SOLO con JSON válido que cumpla este JSON Schema, sin texto alrededor:\n${JSON.stringify(toJsonSchema(req.schema))}` };
      res = await call({ ...req, provider: kind }, '/chat/completions', { ...body(false), messages: [...messages.slice(0, -1), { role: 'user', content: withSchema.prompt }] });
      j = (await res.json().catch(() => ({}))) as typeof j;
    }
    if (res.status >= 400) throw toError(res, j, label(req));
    const choice = j.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (choice?.finish_reason === 'length') throw new Error(t('err.cutOff'));
    if (!text) throw new Error(t('err.emptyReply', { provider: label(req), reason: choice?.finish_reason ?? t('err.noReason') }));
    return stripHidden(text);
  }

  return {
    once,
    compare: kind === 'openai'
      ? (a, b) => Number(/mini|nano/.test(a)) - Number(/mini|nano/.test(b)) || b.localeCompare(a)
      : undefined,
    async list(cfg) {
      const res = await call({ ...cfg, provider: kind }, '/models');
      const j = (await res.json().catch(() => ({}))) as ErrBody & { data?: { id: string }[] };
      if (res.status >= 400) throw toError(res, j, label(cfg));
      const ids = (j.data ?? []).map((m) => m.id);
      return kind === 'openai'
        ? ids.filter((id) => /^(gpt-|o\d|chatgpt)/.test(id) && !/audio|realtime|tts|transcribe|image|embedding|search|moderation|instruct/.test(id))
        : ids;
    },
  };
}

export const openai = adapterFor('openai');
export const compat = adapterFor('compat');
