import { t } from './i18n';
import type { LLMConfig, Provider } from './providers';
import { gemini } from './providers/gemini';
import { compat, openai } from './providers/openai';

/*
 * Capa común de IA para todos los proveedores: reintentos, espera por límite por minuto,
 * cambio de modelo cuando uno está saturado o retirado, JSON estructurado, listar y probar modelos.
 * Cada proveedor (src/providers/*) solo sabe hacer un pedido y listar sus modelos.
 */

export interface LLMRequest extends LLMConfig {
  system: string;
  prompt: string;
  /** Esquema de la respuesta JSON (formato de Gemini: tipos en mayúscula; cada proveedor lo traduce). */
  schema?: object;
  temperature?: number;
  /** Archivos adjuntos (p. ej. un PDF), en base64. */
  files?: { mimeType: string; data: string }[];
}

export interface Adapter {
  /** Un pedido. Lanza BusyError si conviene reintentar o cambiar de modelo. */
  once(req: LLMRequest, model: string): Promise<string>;
  list(cfg: LLMConfig): Promise<string[]>;
  /** Orden de preferencia de modelos (más conveniente primero). */
  compare?(a: string, b: string): number;
}

/** Error recuperable cambiando de modelo (saturado, sin cuota, retirado) o esperando (límite por minuto). */
export class BusyError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
    /** El modelo ya no existe o no está habilitado: reintentarlo no sirve. */
    readonly gone = false,
    /** Modelo que el proveedor sugiere usar en su lugar, si lo indica. */
    readonly suggested?: string,
    /** Límite de pedidos por minuto: alcanza con esperar, no hace falta cambiar de modelo. */
    readonly rate = false,
  ) {
    super(message);
  }
}

let anthropicAdapter: Promise<Adapter> | null = null;

/** Adaptador del proveedor. El de Anthropic trae su SDK: se descarga recién cuando se usa. */
export async function adapter(p: Provider = 'gemini'): Promise<Adapter> {
  switch (p) {
    case 'gemini': return gemini;
    case 'openai': return openai;
    case 'compat': return compat;
    case 'anthropic': return (anthropicAdapter ??= import('./providers/anthropic').then((m) => m.anthropic));
  }
}

/* ---------- modelo saturado: reintento y cambio de modelo ---------- */

/** Recibe el modelo que falló y el mensaje; devuelve el modelo con el que reintentar, o null para cancelar. */
export type BusyHandler = (model: string, message: string) => Promise<string | null>;

let busyHandler: BusyHandler | null = null;
let pendingChoice: Promise<string | null> | null = null;
/** Última elección del usuario, para que las llamadas en paralelo la reutilicen sin volver a preguntar. */
let lastChoice: { from: string; to: string; at: number } | null = null;

export function setBusyHandler(h: BusyHandler | null) {
  busyHandler = h;
}

/** Aviso mientras se espera por el límite de pedidos por minuto (para mostrar una cuenta regresiva). */
let waitHandler: ((model: string, ms: number) => void) | null = null;
export function setWaitHandler(h: ((model: string, ms: number) => void) | null) {
  waitHandler = h;
}

/** Aviso cuando la app cambia de modelo sola porque el proveedor indicó un reemplazo. */
let autoSwitchHandler: ((from: string, to: string) => void) | null = null;
export function setAutoSwitchHandler(h: ((from: string, to: string) => void) | null) {
  autoSwitchHandler = h;
}

function askForModel(model: string, message: string, tried: Set<string>): Promise<string | null> {
  // Reusar la elección reciente de otra llamada paralela, solo si este pedido no la probó ya.
  if (lastChoice && lastChoice.from === model && !tried.has(lastChoice.to) && Date.now() - lastChoice.at < 120_000)
    return Promise.resolve(lastChoice.to);
  if (!busyHandler) return Promise.resolve(null);
  pendingChoice ??= busyHandler(model, message)
    .then((next) => {
      if (next && next !== model) lastChoice = { from: model, to: next, at: Date.now() };
      return next;
    })
    .finally(() => {
      pendingChoice = null;
    });
  return pendingChoice;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generate(req: LLMRequest): Promise<string> {
  const provider = req.provider ?? 'gemini';
  if (!req.apiKey && provider !== 'compat') throw new Error(t('err.noKey'));
  const a = await adapter(provider);
  let model = req.model.replace(/^models\//, '');
  const tried = new Set<string>();
  let retriedSame = false;
  let rateWaits = 0;
  for (let attempt = 0; attempt < 16; attempt++) {
    tried.add(model);
    try {
      return await a.once(req, model);
    } catch (e) {
      if (!(e instanceof BusyError)) throw e;
      // Modelo retirado con reemplazo sugerido por el proveedor: cambiar solo, sin preguntar.
      if (e.gone && e.suggested && !tried.has(e.suggested)) {
        autoSwitchHandler?.(model, e.suggested);
        lastChoice = { from: model, to: e.suggested, at: Date.now() };
        model = e.suggested;
        continue;
      }
      // Límite por minuto: esperar lo que indica el proveedor (o un backoff creciente) y reintentar el mismo modelo.
      if (e.rate && rateWaits < 4) {
        const ms = Math.min(e.retryAfterMs ?? 15_000 * (rateWaits + 1), 65_000);
        rateWaits++;
        waitHandler?.(model, ms);
        await sleep(ms);
        continue;
      }
      // Un reintento automático con el mismo modelo si el corte parece breve.
      const wait = e.retryAfterMs ?? 2000;
      if (!e.gone && !retriedSame && wait <= 30_000 && !/cuota para este modelo/.test(e.message)) {
        retriedSame = true;
        await sleep(wait);
        continue;
      }
      const next = await askForModel(model, e.message, tried);
      if (!next) throw new Error(`${model}: ${e.message}`);
      if (next !== model) retriedSame = false;
      model = next;
    }
  }
  throw new Error(t('err.tooManyRetries'));
}

export async function generateJSON<T>(req: LLMRequest & { schema: object }): Promise<T> {
  const text = await generate(req);
  try {
    return JSON.parse(unfenceJson(text)) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error(t('err.badJson'));
  }
}

/** Hace un pedido mínimo para saber si el modelo responde con esta clave ahora mismo. */
export async function probeModel(cfg: LLMConfig, model = cfg.model): Promise<{ ok: boolean; message: string }> {
  try {
    const a = await adapter(cfg.provider);
    await a.once({ ...cfg, system: '', prompt: 'Respondé solo: ok' }, model);
    return { ok: true, message: 'responde' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function listModels(cfg: LLMConfig): Promise<string[]> {
  const a = await adapter(cfg.provider);
  return (await a.list(cfg)).sort(a.compare ?? ((x, y) => x.localeCompare(y)));
}

/** Orden de preferencia de modelos del proveedor. */
export async function modelComparer(p: Provider = 'gemini'): Promise<(a: string, b: string) => number> {
  return (await adapter(p)).compare ?? ((x, y) => x.localeCompare(y));
}

/**
 * Devuelve un modelo que responda con esta clave: el actual si funciona;
 * si no, el primero de la lista (en orden de preferencia) que pase la prueba.
 */
export async function findWorkingModel(
  cfg: LLMConfig, candidates: string[], onProbe?: (model: string) => void,
): Promise<{ model: string | null; reason: string }> {
  onProbe?.(cfg.model);
  const first = await probeModel(cfg);
  if (first.ok) return { model: cfg.model, reason: '' };
  for (const m of candidates.filter((x) => x !== cfg.model).slice(0, 6)) {
    onProbe?.(m);
    if ((await probeModel(cfg, m)).ok) return { model: m, reason: first.message };
  }
  return { model: null, reason: first.message };
}

/** Quita un bloque ```markdown ... ``` envolvente si el modelo lo agregó. */
export const unfence = (s: string) =>
  s.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();

const unfenceJson = (s: string) => s.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();

/**
 * Esquema de Gemini (OpenAPI con tipos en mayúscula) → JSON Schema estándar, para Anthropic y OpenAI.
 * Los objetos no admiten propiedades extra.
 */
export function toJsonSchema(s: unknown): Record<string, unknown> {
  if (!s || typeof s !== 'object') return {};
  const o = s as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof o.type === 'string') out.type = o.type.toLowerCase();
  if (o.description) out.description = o.description;
  if (o.enum) out.enum = o.enum;
  if (o.items) out.items = toJsonSchema(o.items);
  if (o.properties) {
    out.properties = Object.fromEntries(Object.entries(o.properties as object).map(([k, v]) => [k, toJsonSchema(v)]));
    out.required = o.required ?? [];
    out.additionalProperties = false;
  }
  return out;
}
