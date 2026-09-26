import { CONTENT, type ContentKey } from '../generators/content';

/*
 * Reconocer, al leer un repo, los textos que agrega emede (índices, canario, "Delegá esta tarea…"),
 * en cualquiera de los idiomas del contenido. Los patrones salen de las mismas plantillas que usa el generador
 * (generators/content.ts), así importar y generar no se desincronizan al agregar un idioma.
 */

const all = (key: ContentKey) => [...new Set(Object.values(CONTENT).map((c) => c[key]))];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Plantilla → expresión regular. Las variables se vuelven grupos de captura (en el orden en que aparecen);
 * el punto final es opcional (el modelo o una persona pueden haberlo quitado).
 */
function fromTemplate(tpl: string): RegExp {
  const src = tpl.split(/(\{\w+\})/).map((part) => (/^\{\w+\}$/.test(part) ? '(.+?)' : esc(part))).join('');
  return new RegExp(`^${src.replace(/(\\\.|。|।)$/, '(?:$1)?')}$`);
}

const alt = (xs: string[]) => xs.map(esc).join('|');
const heading = (keys: ContentKey[]) => keys.flatMap(all);

/** "## Plan del proyecto\n\n…" → "Plan del proyecto". */
const planTitles = all('plan').map((p) => p.split('\n')[0].replace(/^##\s*/, ''));

/** Secciones que agrega emede al archivo de memoria (se regeneran solas). */
export const GENERATED_SECTIONS = new RegExp(`^## (${alt([...heading(['agents', 'skills', 'canaryTitle', 'guardsTitle']), ...planTitles])})\\s*$`);
export const RULES_SECTION = new RegExp(`^## (${alt(all('rules'))})\\s*$`);
export const APPLIES_TO = new RegExp(`^_(?:${alt(all('appliesTo'))}): \`(.+)\`_$`);

/** Líneas agregadas a los prompts, con el valor que referencian. */
const DELEGATE = all('delegate').map(fromTemplate);
const USE_SKILLS = all('useSkills').map(fromTemplate);
const MCP = all('mcp').map(fromTemplate);
const AGENT_CANARY = [...all('agentCanaryName'), ...all('agentCanaryMarker')].map(fromTemplate);

const match = (list: RegExp[], line: string) => {
  for (const re of list) {
    const m = line.trim().match(re);
    if (m) return m;
  }
  return null;
};

export const matchDelegate = (line: string) => match(DELEGATE, line)?.[1];
export const matchUseSkills = (line: string) => match(USE_SKILLS, line)?.[1];
export const matchMcp = (line: string) => match(MCP, line)?.[1];
export const isAgentCanary = (line: string) => !!match(AGENT_CANARY, line);

/** Canario en el archivo de memoria: marca o nombre. */
export function canaryIn(text: string): { style: 'marker' | 'name'; phrase: string } | null {
  for (const line of text.split('\n')) {
    const marker = match(all('canaryMarker').map(fromTemplate), line);
    if (marker) return { style: 'marker', phrase: marker[1] };
    const name = match(all('canaryName').map(fromTemplate), line);
    if (name) return { style: 'name', phrase: name[1] };
  }
  return null;
}

/** "Flujo /x. Usar solo cuando…" al principio de la descripción de un comando convertido en skill. */
export function stripCmdSkillPrefix(description: string): string {
  for (const tpl of all('cmdSkill')) {
    // Todo lo que está antes de {d}: "Flujo /{n}. Usar solo cuando el usuario lo pida explícitamente. "
    const prefix = tpl.split('{d}')[0].trim();
    const re = new RegExp(`^${prefix.split(/(\{\w+\})/).map((p) => (/^\{\w+\}$/.test(p) ? '\\S+' : esc(p))).join('')}\\s*`);
    if (re.test(description)) return description.replace(re, '');
  }
  return description;
}

/** Frases de "los argumentos que el usuario indique" (Codex/Cursor sin marcador) → $ARGUMENTS. */
export const ARG_PHRASES = new RegExp(alt(all('args')), 'g');
