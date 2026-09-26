/*
 * Defensa contra el "Rules File Backdoor": instrucciones ocultas con caracteres Unicode invisibles
 * (ancho cero, controles de dirección de texto, caracteres "tag") que una persona no ve pero el modelo sí lee.
 * Se aplica a todo lo que entra (importación de repos, respuestas de la IA, diseños .json) y a lo que se genera.
 *
 * Se conservan los que tienen uso legítimo visible:
 * - el selector de variante U+FE0F de los emoji;
 * - ZWJ (U+200D) entre emoji (👨‍💻);
 * - ZWNJ/ZWJ (U+200C/U+200D) entre dos letras de escrituras que los usan para formar conjuntos
 *   (devanagari, bengalí, telugu, tamil, árabe, persa…). Sueltos, repetidos o junto a letras latinas siguen siendo ocultos.
 */

const HIDDEN = new RegExp(
  [
    '[\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180E]', // guion suave, rellenos y marcas invisibles
    '[\\u200B\\u200E\\u200F]', // ancho cero y marcas de dirección (ZWNJ/ZWJ se revisan aparte)
    '[\\u202A-\\u202E]', // incrustaciones y anulaciones bidi
    '[\\u2060-\\u2064\\u2066-\\u2069\\u206A-\\u206F]', // unión de palabra, invisibles, aislamientos bidi
    '[\\u3164\\uFFA0]', // rellenos de Hangul
    '\\uFEFF', // BOM / espacio de ancho cero
    '[\\u{E0000}-\\u{E007F}]', // caracteres "tag": pueden codificar texto ASCII completo
    '[\\u{1D173}-\\u{1D17A}]', // formato musical invisible
  ].join('|'),
  'gu',
);

const EMOJI = /\p{Extended_Pictographic}/u;

export interface HiddenChar {
  code: string;
  name: string;
  line: number;
}

const NAMES: Record<string, string> = {
  '200B': 'espacio de ancho cero', '200C': 'no-unión de ancho cero', '200D': 'unión de ancho cero',
  '200E': 'marca izquierda-a-derecha', '200F': 'marca derecha-a-izquierda', FEFF: 'BOM / ancho cero',
  '202E': 'anulación derecha-a-izquierda', '2066': 'aislamiento de dirección', '00AD': 'guion suave',
};

const describe = (ch: string) => {
  const code = ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
  const tag = code.length > 4 && code.startsWith('E00');
  return { code: `U+${code}`, name: NAMES[code] ?? (tag ? 'carácter tag (texto oculto)' : 'carácter invisible') };
};

const ZWNJ = '\u200C';
const ZWJ = '\u200D';
/** Letra o signo combinante de una escritura que no es latina (donde ZWNJ/ZWJ forman parte de la ortografía). */
const JOINING_SCRIPT = /[\p{L}\p{M}]/u;
const isJoiningLetter = (ch: string) => JOINING_SCRIPT.test(ch) && (ch.codePointAt(0) ?? 0) > 0x024f;

/** Carácter completo antes de la posición i (respeta pares sustitutos). */
function charBefore(text: string, i: number) {
  const low = text.charCodeAt(i - 1);
  return low >= 0xdc00 && low <= 0xdfff ? text.slice(i - 2, i) : (text[i - 1] ?? '');
}

/**
 * ZWJ entre dos emoji (👨‍💻), o ZWNJ/ZWJ entre dos letras de escrituras que los usan (లైన్‌ను, क्‍ष):
 * legítimos. En cualquier otro lugar se consideran ocultos.
 */
function isLegitJoiner(text: string, i: number) {
  const next = String.fromCodePoint(text.codePointAt(i + 1) ?? 32);
  const prev = charBefore(text, i);
  if (isJoiningLetter(prev) && isJoiningLetter(next)) return true;
  if (text[i] !== ZWJ) return false;
  // ❤️‍🔥: el selector de variante va antes del ZWJ
  const emojiPrev = prev === '\uFE0F' ? charBefore(text, i - 1) : prev;
  return EMOJI.test(emojiPrev) && EMOJI.test(next);
}

/** Lista los caracteres ocultos (con su línea) sin modificar el texto. */
export function findHidden(text: string): HiddenChar[] {
  const out: HiddenChar[] = [];
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') line++;
    if (ch === ZWJ || ch === ZWNJ) {
      if (!isLegitJoiner(text, i)) out.push({ ...describe(ch), line });
      continue;
    }
    const cp = text.codePointAt(i)!;
    const full = String.fromCodePoint(cp);
    HIDDEN.lastIndex = 0;
    if (HIDDEN.test(full)) {
      // Un BOM al principio del archivo es habitual y no esconde nada.
      if (!(cp === 0xfeff && i === 0)) out.push({ ...describe(full), line });
    }
    if (cp > 0xffff) i++;
  }
  return out;
}

/** Quita los caracteres ocultos (respetando emoji). */
export function stripHidden(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ZWJ || ch === ZWNJ) {
      if (isLegitJoiner(text, i)) out += ch;
      continue;
    }
    const cp = text.codePointAt(i)!;
    const full = String.fromCodePoint(cp);
    HIDDEN.lastIndex = 0;
    if (!HIDDEN.test(full)) out += full;
    if (cp > 0xffff) i++;
  }
  return out;
}

/** Aplica stripHidden a todos los strings de una estructura (respuesta JSON de la IA, diseño importado). */
export function stripHiddenDeep<T>(value: T): T {
  if (typeof value === 'string') return stripHidden(value) as T;
  if (Array.isArray(value)) return value.map(stripHiddenDeep) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripHiddenDeep(v)])) as T;
  return value;
}

/** Cuenta los caracteres ocultos en todos los strings de una estructura. */
export function countHiddenDeep(value: unknown): number {
  if (typeof value === 'string') return findHidden(value).length;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countHiddenDeep(v), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce((n: number, v) => n + countHiddenDeep(v), 0);
  return 0;
}
