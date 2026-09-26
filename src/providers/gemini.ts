import { t } from '../i18n';
import { stripHidden } from '../sanitize';
import { BusyError, type Adapter } from '../llm';

/* Google Gemini (API de Google AI Studio), llamado directo desde el navegador. */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Límite por minuto (no diario ni de cuota cero): se resuelve esperando. */
const isRateLimit = (status: number, message: string) =>
  status === 429 && !/limit:\s*0(?!\d)/.test(message) && !/per.?day|PerDay|daily/i.test(message);

const isBusy = (status: number, message: string) =>
  status === 503 || status === 429 ||
  /high demand|overloaded|unavailable|resource.?exhausted|quota|try again later/i.test(message);

const isGone = (status: number, message: string) =>
  status === 404 || /no longer available|not found|is not supported|deprecated|retired|discontinued/i.test(message);

/** Extrae el modelo sugerido de mensajes como "Please update your code to use models/gemini-x-flash". */
const suggestedModel = (message: string) => message.match(/use\s+(?:models\/)?(gemini-[\w.-]*\w)/i)?.[1];

/** Traduce los errores de cuota de Google a algo entendible. */
function explain(status: number, message: string): string {
  if (/limit:\s*0(?!\d)/.test(message))
    return t('err.geminiNoQuota');
  if (status === 429 && /per.?minute|PerMinute|retry in/i.test(message))
    return t('err.rateLimit');
  if (/quota/i.test(message)) return t('err.geminiQuota', { msg: message.split('\n')[0] });
  return message;
}

/** Lee el retraso sugerido por Google ("Please retry in 12.3s" o RetryInfo.retryDelay). */
function retryDelayMs(json: { error?: { message?: string; details?: { retryDelay?: string }[] } }): number | undefined {
  const d = json.error?.details?.find((x) => x.retryDelay)?.retryDelay;
  const secs = d ? parseFloat(d) : parseFloat(json.error?.message?.match(/retry in ([\d.]+)s/i)?.[1] ?? '');
  return Number.isFinite(secs) ? Math.ceil(secs * 1000) : undefined;
}

/** Modelos que no sirven para generar texto (imagen, voz, tiempo real, embeddings…). */
const NON_TEXT = /image|tts|audio|live|embedding|aqa|robotics|computer-use|veo|imagen/i;

/** Versión numérica del modelo: "gemini-3.8-flash" → 3.8. */
const modelVersion = (m: string) => parseFloat(m.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? '0');

/** Orden de preferencia: estables antes que preview/exp, flash antes que el resto, versión más nueva primero. */
export function compareModels(a: string, b: string): number {
  const tier = (m: string) =>
    (/preview|exp|latest/.test(m) ? 2 : 0) + (/flash/.test(m) ? 0 : 1) + (/lite/.test(m) ? 0.5 : 0);
  return tier(a) - tier(b) || modelVersion(b) - modelVersion(a) || a.localeCompare(b);
}

export const gemini: Adapter = {
  compare: compareModels,

  async once(req, model) {
    const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
      body: JSON.stringify({
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        contents: [{
          role: 'user',
          parts: [...(req.files ?? []).map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.data } })), { text: req.prompt }],
        }],
        generationConfig: {
          temperature: req.temperature ?? 0.6,
          ...(req.schema ? { responseMimeType: 'application/json', responseSchema: req.schema } : {}),
        },
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const raw: string = json?.error?.message ?? `Gemini respondió ${res.status}`;
      const message = explain(res.status, raw);
      if (isGone(res.status, raw)) throw new BusyError(message, undefined, true, suggestedModel(raw));
      if (isRateLimit(res.status, raw)) throw new BusyError(message, retryDelayMs(json), false, undefined, true);
      throw isBusy(res.status, raw) ? new BusyError(message, retryDelayMs(json)) : new Error(message);
    }
    const cand = json.candidates?.[0];
    const text = (cand?.content?.parts ?? [])
      .filter((p: { thought?: boolean }) => !p.thought)
      .map((p: { text?: string }) => p.text ?? '')
      .join('');
    if (!text) throw new Error(t('err.emptyReply', { provider: 'Gemini', reason: cand?.finishReason ?? json.promptFeedback?.blockReason ?? t('err.noReason') }));
    // Todo lo que devuelve el modelo se trata como no confiable: sin caracteres invisibles.
    return stripHidden(text);
  },

  async list(cfg) {
    const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': cfg.apiKey } });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `Error ${res.status}`);
    return (json.models ?? [])
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
        m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent') && !NON_TEXT.test(m.name))
      .map((m: { name: string }) => m.name.replace(/^models\//, ''));
  },
};
