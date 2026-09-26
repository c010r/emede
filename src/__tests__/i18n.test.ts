import { describe, expect, it } from 'vitest';
import { es } from '../i18n/es';
import { LANGS, detectLang } from '../i18n/langs';
import { CONTENT } from '../generators/content';
import { setUILang, t } from '../i18n';

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const load = async (lang: string) => (await import(`../i18n/${lang}.ts`))[lang] as Record<string, string>;

describe('traducciones de la interfaz', () => {
  for (const lang of LANGS.filter((l) => l !== 'es')) {
    it(`${lang}: todas las claves, con las mismas variables y sin textos vacíos`, async () => {
      const dict = await load(lang);
      expect(Object.keys(dict).sort()).toEqual(Object.keys(es).sort());
      for (const [k, v] of Object.entries(es)) {
        expect(dict[k]?.trim(), `${lang}.${k} vacío`).toBeTruthy();
        expect(vars(dict[k]), `${lang}.${k}: variables`).toEqual(vars(v));
      }
    });
  }

  it('los idiomas que no son de alfabeto latino no dejan frases en español sin traducir', async () => {
    for (const lang of ['zh', 'yue', 'hi', 'bn']) {
      const dict = await load(lang);
      const untranslated = Object.entries(dict).filter(([k, v]) => v === es[k as keyof typeof es] && /[a-záéíóúñ]{4,} [a-záéíóúñ]{4,}/i.test(v));
      expect(untranslated.map(([k]) => k), lang).toEqual([]);
    }
  });

  it('cambia de idioma y reemplaza variables', async () => {
    await setUILang('en');
    expect(t('dash.noMatch', { q: 'x' })).toContain('“x”');
    expect(t('dash.open')).toBe('Open');
    await setUILang('es');
    expect(t('dash.open')).toBe('Abrir');
  });

  it('detecta el idioma del navegador', () => {
    expect(detectLang(['pt-BR'])).toBe('pt');
    expect(detectLang(['zh-HK'])).toBe('yue');
    expect(detectLang(['zh-CN'])).toBe('zh');
    expect(detectLang(['de-DE', 'bn-IN'])).toBe('bn');
    expect(detectLang(['de-DE'])).toBe('es');
  });
});

describe('textos del contenido generado', () => {
  for (const lang of LANGS) {
    it(`${lang}: mismas variables que el español`, () => {
      for (const [k, v] of Object.entries(CONTENT.es)) {
        expect(vars(CONTENT[lang][k as keyof typeof CONTENT.es]), `${lang}.${k}`).toEqual(vars(v));
      }
    });
  }
});
