import type { Settings } from '../types';
import { t } from '../i18n';
import { LANGS } from '../i18n/langs';

/*
 * Proveedores de IA. Cada uno tiene su clave y su modelo guardados aparte,
 * así cambiar de proveedor no borra la configuración de los otros.
 */

export const PROVIDERS = ['gemini', 'anthropic', 'openai', 'compat'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_INFO: Record<Provider, {
  label: string;
  keyUrl?: string;
  keyPlaceholder: string;
  defaultModel: string;
  /** Lee PDF adjuntos (para "Desde plan"). */
  pdf: boolean;
  /** Única página a la que se envía la clave. */
  host: string;
}> = {
  gemini: {
    label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', keyPlaceholder: 'AIza…',
    defaultModel: 'gemini-3.8-flash', pdf: true, host: 'generativelanguage.googleapis.com',
  },
  anthropic: {
    label: 'Anthropic Claude', keyUrl: 'https://console.anthropic.com/settings/keys', keyPlaceholder: 'sk-ant-…',
    defaultModel: 'claude-opus-5', pdf: true, host: 'api.anthropic.com',
  },
  openai: {
    label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-…',
    defaultModel: 'gpt-5', pdf: true, host: 'api.openai.com',
  },
  compat: {
    label: 'Compatible con OpenAI', keyPlaceholder: 'opcional para servidores locales',
    defaultModel: '', pdf: false, host: '',
  },
};

/** Servicios que hablan el formato de OpenAI: se elige uno y se completa la URL base. */
export const COMPAT_PRESETS = [
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
  { label: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { label: 'Mistral', url: 'https://api.mistral.ai/v1' },
  { label: 'xAI (Grok)', url: 'https://api.x.ai/v1' },
  { label: 'Ollama (local)', url: 'http://localhost:11434/v1' },
  { label: 'LM Studio (local)', url: 'http://localhost:1234/v1' },
];

/** Proveedor, clave y modelo con los que se hace cada pedido. */
export interface LLMConfig {
  provider?: Provider;
  apiKey: string;
  model: string;
  /** URL base (solo "compatible con OpenAI"). */
  baseUrl?: string;
}

export function aiOf(s: Settings): Required<LLMConfig> {
  const provider = s.provider ?? 'gemini';
  return {
    provider,
    apiKey: s.keys?.[provider] ?? '',
    model: s.models?.[provider] || PROVIDER_INFO[provider].defaultModel,
    baseUrl: s.baseUrl ?? '',
  };
}

/** Nombre del proveedor para mostrar (el de "compatible" se traduce). */
export const providerLabel = (p: Provider) => (p === 'compat' ? t('set.compatLabel') : PROVIDER_INFO[p].label);

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url.trim());

/** Hay con qué llamar a la IA: clave del proveedor elegido (o un servidor local compatible, que no la necesita). */
export function hasAI(s: Settings): boolean {
  const c = aiOf(s);
  if (c.provider === 'compat') return !!c.baseUrl.trim() && (!!c.apiKey || isLocal(c.baseUrl)) && !!c.model;
  return !!c.apiKey;
}

/** Ajustes de versiones anteriores (una sola clave, de Gemini) al formato con varios proveedores. */
export function migrateSettings(s: Partial<Settings> & { apiKey?: string; model?: string }): Partial<Settings> {
  const { apiKey, model, ...rest } = s;
  // Idiomas que ya no se ofrecen (maratí, telugu, tamil): se vuelve a detectar el del navegador.
  const known = (l: unknown) => (LANGS as readonly unknown[]).includes(l);
  if (rest.uiLang && !known(rest.uiLang)) delete rest.uiLang;
  if (rest.lang && !known(rest.lang)) delete rest.lang;
  if (!apiKey && !model) return rest;
  return {
    ...rest,
    keys: { gemini: apiKey ?? '', ...rest.keys },
    models: { gemini: model ?? PROVIDER_INFO.gemini.defaultModel, ...rest.models },
  };
}
