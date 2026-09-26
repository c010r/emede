import { t } from './i18n';
import type { Graph } from './store';
import type { NodeData } from './types';

/*
 * Chequeos estáticos de calidad de instrucciones, basados en lo que se sabe que funciona con agentes:
 * instrucciones concretas y verificables sí cambian el comportamiento; principios abstractos casi no.
 */

export interface QualityIssue {
  level: 'warn' | 'info';
  code: 'abstract' | 'vague' | 'similar' | 'skill-trigger';
  message: string;
  nodeId: string;
}

/** Texto "instruccional" de cada tipo de nodo. */
const bodyOf = (d: NodeData): string => {
  switch (d.kind) {
    case 'project': return `${d.memory}\n${d.conventions}`;
    case 'agent': return d.prompt;
    case 'skill': return d.instructions;
    case 'command': return d.prompt;
    case 'rule': return d.content;
    default: return '';
  }
};

const ABSTRACT = /\b(SOLID|KISS|YAGNI|DRY|clean code|c[oó]digo limpio|best practices|buenas pr[aá]cticas|mejores pr[aá]cticas|clean architecture)\b/i;
const VAGUE = /\b(apropiad[oa]s?|adecuad[oa]s?|cuando sea necesario|si corresponde|seg[uú]n convenga|seg[uú]n sea necesario|lo que haga falta|etc\.|appropriate(?:ly)?|as needed|when necessary|properly|and so on)/gi;
/** Palabras que indican cuándo usar una skill, en los idiomas del contenido (sin \b: no sirve fuera del alfabeto latino). */
const TRIGGER = new RegExp([
  'cuando', 'usar', 'usala', 'usalo', 'úsala', 'úsalo', 'antes de', 'después de', 'si el usuario', // es
  'when', 'use ', 'before', 'after', // en
  'quando', 'utilizar', 'antes', 'depois', // pt / it
  'quand', 'utiliser', 'avant', 'après', // fr
  'usare', 'prima di', 'dopo', // it
  '当', '時', '时', '使用', '用於', '用于', // zh / yue
  'जब', 'उपयोग', 'इस्तेमाल', // hi
  'যখন', 'ব্যবহার', // bn
  'जेव्हा', 'वापर', // mr
  'ఎప్పుడు', 'ఉపయోగ', // te
  'போது', 'பயன்படுத்த', // ta
].join('|'), 'i');

/** Largo mínimo de una descripción útil. El chino dice lo mismo en menos caracteres. */
export const minDescription = (s: string) => (/[\u3400-\u9fff]/.test(s) ? 10 : 25);

const words = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{4,}/g) ?? []);

/** Similitud de Jaccard entre dos descripciones (palabras de 4+ letras). */
export function similarity(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export function qualityIssues(g: Graph): QualityIssue[] {
  const out: QualityIssue[] = [];
  const label = (d: NodeData) => (d.kind === 'command' ? `/${d.name}` : d.name);

  for (const n of g.nodes) {
    const d = n.data.d;
    const body = bodyOf(d);
    if (!body.trim()) continue;

    // Principios abstractos en una línea corta, sin nada concreto que el agente pueda aplicar.
    const abstractLine = body.split('\n').find((l) => ABSTRACT.test(l) && l.trim().split(/\s+/).length <= 12);
    if (abstractLine)
      out.push({
        level: 'info', code: 'abstract', nodeId: n.id,
        message: t('val.abstract', { label: label(d), line: abstractLine.trim().slice(0, 60) }),
      });

    const vague = [...new Set((body.match(VAGUE) ?? []).map((v) => v.toLowerCase()))];
    if (vague.length >= 2)
      out.push({
        level: 'info', code: 'vague', nodeId: n.id,
        message: t('val.vague', { label: label(d), list: vague.slice(0, 4).map((v) => `“${v}”`).join(', ') }),
      });
  }

  // Descripciones casi iguales: el modelo elige agente o skill por la descripción y puede confundirse.
  for (const kind of ['agent', 'skill'] as const) {
    const list = g.nodes.filter((n) => n.data.d.kind === kind && 'description' in n.data.d && n.data.d.description.trim());
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].data.d as { name: string; description: string };
        const b = list[j].data.d as { name: string; description: string };
        if (similarity(a.description, b.description) >= 0.6)
          out.push({
            level: 'warn', code: 'similar', nodeId: list[j].id,
            message: t('val.similar', { a: a.name, b: b.name }),
          });
      }
  }

  // Skills que no dicen cuándo usarse: se activan por descripción.
  for (const n of g.nodes) {
    const d = n.data.d;
    if (d.kind === 'skill' && d.description.trim().length >= minDescription(d.description) && !TRIGGER.test(d.description))
      out.push({ level: 'info', code: 'skill-trigger', nodeId: n.id, message: t('val.skillTrigger', { name: d.name }) });
  }
  return out;
}
