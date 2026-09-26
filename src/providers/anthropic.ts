import { t } from '../i18n';
import Anthropic from '@anthropic-ai/sdk';
import { stripHidden } from '../sanitize';
import { BusyError, toJsonSchema, type Adapter, type LLMRequest } from '../llm';

/*
 * Anthropic Claude con el SDK oficial, desde el navegador (la clave va solo a api.anthropic.com).
 * - Respuesta JSON: output_config.format con JSON Schema.
 * - Streaming con finalMessage(): las respuestas largas (un diseño completo) no chocan con el timeout HTTP.
 * - Sin temperature: los modelos actuales no la aceptan.
 * - En los modelos con clasificadores de seguridad (Opus 5, Fable 5.1), si el modelo rechaza el pedido,
 *   la API lo reintenta en el mismo llamado con un modelo de respaldo (server-side fallbacks).
 */

const client = (apiKey: string) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });

const WITH_FALLBACKS = /^claude-(opus-5|fable-5-1)$/;

const retryAfterMs = (e: InstanceType<typeof Anthropic.APIError>) => {
  const v = e.headers?.get?.('retry-after');
  const secs = v ? parseFloat(v) : NaN;
  return Number.isFinite(secs) ? Math.ceil(secs * 1000) : undefined;
};

/** Errores del SDK → errores de la app (reintentables o no), del más específico al más general. */
function mapError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new Error(t('err.badKey', { provider: 'Anthropic' }));
  if (e instanceof Anthropic.PermissionDeniedError) return new Error(t('err.forbidden', { provider: 'Anthropic', msg: e.message }));
  if (e instanceof Anthropic.NotFoundError) return new BusyError(t('err.modelGone'), undefined, true);
  if (e instanceof Anthropic.RateLimitError) return new BusyError(t('err.rateLimit'), retryAfterMs(e), false, undefined, true);
  if (e instanceof Anthropic.InternalServerError) return new BusyError(t('err.overloaded', { provider: 'Anthropic' }), retryAfterMs(e));
  if (e instanceof Anthropic.BadRequestError) return new Error(t('err.rejected', { provider: 'Anthropic', msg: e.message }));
  if (e instanceof Anthropic.APIConnectionError) return new Error(t('err.connect', { host: 'api.anthropic.com' }));
  if (e instanceof Anthropic.APIError) return new Error(t('err.status', { provider: 'Anthropic', status: e.status ?? '', msg: e.message }));
  return e instanceof Error ? e : new Error(String(e));
}

async function once(req: LLMRequest, model: string): Promise<string> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(req.files ?? []).map((f): Anthropic.Beta.BetaContentBlockParam => ({
      type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data },
    })),
    { type: 'text', text: req.prompt },
  ];
  try {
    const stream = client(req.apiKey).beta.messages.stream({
      model,
      max_tokens: 64000,
      ...(req.system ? { system: req.system } : {}),
      messages: [{ role: 'user', content }],
      ...(req.schema ? { output_config: { format: { type: 'json_schema', schema: toJsonSchema(req.schema) } } } : {}),
      ...(WITH_FALLBACKS.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    } as Anthropic.Beta.MessageCreateParamsStreaming);
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal')
      throw new Error(msg.stop_details?.explanation ? t('err.refusalWhy', { why: msg.stop_details.explanation }) : t('err.refusal'));
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (msg.stop_reason === 'max_tokens') throw new Error(t('err.cutOff'));
    if (!text) throw new Error(t('err.emptyReply', { provider: 'Claude', reason: msg.stop_reason ?? t('err.noReason') }));
    return stripHidden(text);
  } catch (e) {
    throw mapError(e);
  }
}

/** Opus antes que Sonnet y Haiku; dentro de cada familia, la versión más nueva primero. */
function compare(a: string, b: string): number {
  const family = (m: string) => (/fable|mythos/.test(m) ? 1 : /opus/.test(m) ? 0 : /sonnet/.test(m) ? 2 : /haiku/.test(m) ? 3 : 4);
  const version = (m: string) => parseFloat((m.match(/-(\d+)(?:-(\d))?(?:-|$)/)?.slice(1).filter(Boolean).join('.')) ?? '0');
  return family(a) - family(b) || version(b) - version(a) || a.localeCompare(b);
}

export const anthropic: Adapter = {
  once,
  compare,
  async list(cfg) {
    try {
      const ids: string[] = [];
      for await (const m of client(cfg.apiKey).models.list()) ids.push(m.id);
      return ids;
    } catch (e) {
      throw mapError(e);
    }
  },
};
