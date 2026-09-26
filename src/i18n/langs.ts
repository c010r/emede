/* Idiomas de la interfaz y del contenido generado. */

export const LANGS = ['es', 'en', 'pt', 'fr', 'it', 'zh', 'yue', 'hi', 'bn'] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_INFO: Record<Lang, {
  /** Nombre en el propio idioma (para el selector). */
  native: string;
  /** Nombre para indicarle a la IA en qué idioma escribir (los prompts internos están en español). */
  ai: string;
  /** Etiqueta BCP 47 para <html lang> y formatos de fecha. */
  bcp47: string;
}> = {
  es: { native: 'Español', ai: 'español', bcp47: 'es' },
  en: { native: 'English', ai: 'inglés', bcp47: 'en' },
  pt: { native: 'Português (Brasil)', ai: 'portugués de Brasil', bcp47: 'pt-BR' },
  fr: { native: 'Français', ai: 'francés', bcp47: 'fr' },
  it: { native: 'Italiano', ai: 'italiano', bcp47: 'it' },
  zh: { native: '简体中文（普通话）', ai: 'chino mandarín en caracteres simplificados', bcp47: 'zh-CN' },
  yue: { native: '粵語（繁體）', ai: 'cantonés escrito en caracteres chinos tradicionales', bcp47: 'yue-HK' },
  hi: { native: 'हिन्दी', ai: 'hindi (escritura devanagari)', bcp47: 'hi' },
  bn: { native: 'বাংলা', ai: 'bengalí (escritura bengalí)', bcp47: 'bn' },
};

/** Idioma del navegador si está soportado (cantonés: zh-HK / zh-MO / yue). */
export function detectLang(list: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]): Lang {
  for (const raw of list) {
    const l = raw.toLowerCase();
    if (l.startsWith('yue') || l === 'zh-hk' || l === 'zh-mo') return 'yue';
    const base = l.split('-')[0] as Lang;
    if ((LANGS as readonly string[]).includes(base)) return base;
  }
  return 'es';
}
