import { create } from 'zustand';
import { es, type Messages } from './es';
import { LANG_INFO, type Lang } from './langs';

/*
 * Traducciones de la interfaz. El español es la fuente y va incluido; los demás idiomas se descargan
 * al elegirlos. Cada idioma es un Record con las mismas claves que es.ts: TypeScript marca las que falten.
 * Variables: "{nombre}" en el texto, t('clave', { nombre: 'x' }).
 */

export type MsgKey = keyof Messages;

const loaders: Record<Exclude<Lang, 'es'>, () => Promise<Messages>> = {
  en: () => import('./en').then((m) => m.en),
  pt: () => import('./pt').then((m) => m.pt),
  fr: () => import('./fr').then((m) => m.fr),
  it: () => import('./it').then((m) => m.it),
  zh: () => import('./zh').then((m) => m.zh),
  yue: () => import('./yue').then((m) => m.yue),
  hi: () => import('./hi').then((m) => m.hi),
  bn: () => import('./bn').then((m) => m.bn),
};

let dict: Messages = es;

/** Idioma activo de la interfaz (los componentes se suscriben para volver a dibujarse al cambiarlo). */
export const useI18n = create<{ lang: Lang }>()(() => ({ lang: 'es' }));

export async function setUILang(lang: Lang): Promise<void> {
  dict = lang === 'es' ? es : await (loaders[lang] ?? (async () => es))();
  if (typeof document !== 'undefined') document.documentElement.lang = LANG_INFO[lang].bcp47;
  useI18n.setState({ lang });
}

export const uiLang = () => useI18n.getState().lang;

export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  const s = dict[key] ?? es[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Igual que t(), pero el componente se vuelve a dibujar cuando cambia el idioma. */
export function useT(): typeof t {
  useI18n((s) => s.lang);
  return t;
}
