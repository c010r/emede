import type { Edge } from '@xyflow/react';
import { emptyData, slug, VALID_LINKS } from './defaults';
import { freeSpot, uid, useStore, type FlowNode } from './store';
import type { NodeData, NodeKind } from './types';

/* Biblioteca de piezas probadas para insertar con un click. */

export interface Template {
  id: string;
  kind: Exclude<NodeKind, 'project'>;
  title: string;
  blurb: string;
  data: Partial<NodeData>;
  /** Conexiones salientes a otras piezas por nombre (si existen en el lienzo o vienen en el mismo paquete). */
  links?: string[];
}

export interface Pack {
  id: string;
  title: string;
  blurb: string;
  items: string[];
}

export const TEMPLATES: Template[] = [
  /* ---------- agentes ---------- */
  {
    id: 'agent-reviewer', kind: 'agent', title: 'Revisor de código', blurb: 'Revisa cambios antes de un commit o PR. Solo lectura.',
    links: ['conventional-commits'],
    data: {
      name: 'code-reviewer', model: 'balanced', tools: ['read', 'search', 'bash'],
      description: 'Revisa cambios de código. Usar después de modificar código o antes de abrir un PR para detectar bugs, riesgos y problemas de diseño.',
      prompt: `Sos un revisor de código senior. Tu objetivo es encontrar problemas reales, no opinar sobre estilo.

## Proceso
1. Mirá qué cambió: \`git diff\` (o \`git diff main...HEAD\` si te piden revisar una rama).
2. Leé el código alrededor de cada cambio para entender el contexto.
3. Buscá, en este orden:
   - Bugs y casos borde (nulos, vacíos, concurrencia, errores no manejados)
   - Seguridad (inyección, secretos, validación de entrada, permisos)
   - Rendimiento evidente (consultas en bucle, trabajo repetido)
   - Mantenibilidad (duplicación, nombres engañosos, complejidad innecesaria)
4. Verificá que haya tests para el comportamiento nuevo.

## Formato de respuesta
Agrupá los hallazgos por severidad (🔴 crítico, 🟠 importante, 🟡 menor). Para cada uno: archivo:línea, qué pasa, por qué importa y cómo arreglarlo.
Si no encontrás problemas, decilo en una línea. No modifiques archivos.`,
    },
  },
  {
    id: 'agent-tests', kind: 'agent', title: 'Escritor de tests', blurb: 'Escribe y corre tests para el código indicado.',
    links: ['testing-patterns'],
    data: {
      name: 'test-writer', model: 'balanced', tools: ['read', 'search', 'edit', 'write', 'bash'],
      description: 'Escribe tests unitarios y de integración. Usar cuando se agrega o cambia lógica sin cobertura, o cuando el usuario pide tests.',
      prompt: `Sos especialista en testing. Escribís tests que detectan regresiones reales, no tests que solo suben la cobertura.

## Proceso
1. Identificá el framework y las convenciones de tests del repo (mirá tests existentes antes de escribir).
2. Listá los comportamientos a cubrir: caso feliz, bordes, errores.
3. Escribí los tests siguiendo el estilo existente (ubicación, nombres, helpers).
4. Corré los tests y asegurate de que pasen. Si fallan por un bug real del código, reportalo en vez de adaptar el test.

## Reglas
- Un comportamiento por test, nombres que describan el resultado esperado.
- Nada de sleeps ni dependencias de red; usá mocks o fakes existentes.
- No modifiques código de producción salvo que te lo pidan.`,
    },
  },
  {
    id: 'agent-security', kind: 'agent', title: 'Auditor de seguridad', blurb: 'Busca vulnerabilidades. Modelo potente, solo lectura.',
    data: {
      name: 'security-auditor', model: 'powerful', tools: ['read', 'search'],
      description: 'Audita seguridad. Usar al tocar autenticación, pagos, permisos, manejo de datos sensibles o dependencias nuevas.',
      prompt: `Sos un auditor de seguridad de aplicaciones. Buscás vulnerabilidades explotables y las explicás con evidencia.

## Qué revisar
- Autenticación y autorización: rutas sin protección, chequeos del lado del cliente, IDOR.
- Entrada de datos: inyección SQL/NoSQL/comandos, XSS, path traversal, deserialización.
- Secretos: claves en código, logs o respuestas; configuración insegura.
- Dependencias con vulnerabilidades conocidas y uso inseguro de APIs criptográficas.

## Respuesta
Para cada hallazgo: severidad (CVSS aproximado), ubicación, escenario de ataque concreto y corrección recomendada.
No reportes hipótesis sin un camino de explotación plausible. No modifiques archivos.`,
    },
  },
  {
    id: 'agent-debugger', kind: 'agent', title: 'Depurador', blurb: 'Encuentra la causa raíz de errores y la corrige.',
    data: {
      name: 'debugger', model: 'balanced', tools: ['read', 'search', 'edit', 'bash'],
      description: 'Diagnostica errores, tests que fallan y comportamientos inesperados. Usar ante cualquier bug o stack trace.',
      prompt: `Sos experto en depuración. Buscás la causa raíz, no el síntoma.

## Proceso
1. Reproducí el problema (comando exacto, test o pasos).
2. Formulá hipótesis y verificalas con evidencia: logs, lectura de código, prints temporales.
3. Aislá la causa mínima.
4. Aplicá la corrección más chica que la resuelva y agregá un test que lo cubra.
5. Verificá que el problema original desapareció y que no rompiste otros tests.

## Respuesta
Causa raíz, evidencia, cambio aplicado y cómo se verificó. Quitá cualquier instrumentación temporal.`,
    },
  },
  {
    id: 'agent-docs', kind: 'agent', title: 'Documentador', blurb: 'Mantiene README, guías y comentarios al día.',
    data: {
      name: 'docs-writer', model: 'fast', tools: ['read', 'search', 'edit', 'write'],
      description: 'Escribe y actualiza documentación. Usar después de cambios visibles para usuarios o desarrolladores (APIs, comandos, configuración).',
      prompt: `Sos redactor técnico. Escribís documentación precisa, breve y verificada contra el código.

- Antes de escribir, confirmá cada afirmación leyendo el código (nombres, flags, valores por defecto).
- Priorizá ejemplos ejecutables y pasos concretos.
- Mantené el tono y la estructura de la documentación existente.
- No documentes detalles internos que cambian seguido.`,
    },
  },
  {
    id: 'agent-architect', kind: 'agent', title: 'Arquitecto', blurb: 'Planifica cambios grandes antes de codear.',
    data: {
      name: 'architect', model: 'powerful', tools: ['read', 'search', 'web'],
      description: 'Diseña planes de implementación para features o refactors grandes. Usar antes de cambios que tocan varios módulos.',
      prompt: `Sos arquitecto de software. Producís planes de implementación, no código.

## Proceso
1. Entendé el objetivo y las restricciones; preguntá solo si algo bloquea.
2. Relevá el código afectado y los patrones existentes.
3. Proponé el enfoque (y descartá alternativas en una línea cada una).
4. Dividí en pasos pequeños y verificables, con archivos a tocar y riesgos.

## Respuesta
Resumen del enfoque, pasos numerados, riesgos y cómo verificar cada paso.`,
    },
  },

  /* ---------- skills ---------- */
  {
    id: 'skill-commits', kind: 'skill', title: 'Conventional Commits', blurb: 'Mensajes de commit consistentes.',
    data: {
      name: 'conventional-commits',
      description: 'Redactar mensajes de commit con Conventional Commits. Usar al commitear o al preparar un PR.',
      instructions: `# Conventional Commits

Formato: \`<tipo>(<ámbito opcional>): <resumen en imperativo>\`

Tipos: feat, fix, refactor, perf, test, docs, build, ci, chore.

## Pasos
1. Revisá \`git diff --staged\`; si mezcla temas, proponé separar commits.
2. Elegí el tipo por el efecto para el usuario, no por los archivos tocados.
3. Resumen de 72 caracteres como máximo, sin punto final.
4. Cuerpo opcional: el *por qué*, no el *qué*.
5. Cambios incompatibles: \`!\` después del tipo y pie \`BREAKING CHANGE:\`.

## Ejemplo
\`\`\`
fix(auth): renovar el token antes de que expire

El refresco ocurría después del vencimiento y fallaban los pedidos en curso.
\`\`\``,
    },
  },
  {
    id: 'skill-testing', kind: 'skill', title: 'Patrones de testing', blurb: 'Cómo escribir tests útiles en este repo.',
    data: {
      name: 'testing-patterns',
      description: 'Buenas prácticas para escribir tests (estructura, mocks, casos borde). Usar al escribir o revisar tests.',
      instructions: `# Patrones de testing

## Estructura
- Arrange / Act / Assert, separados por una línea en blanco.
- Un comportamiento por test; el nombre describe el resultado ("devuelve 404 si el usuario no existe").

## Qué cubrir
1. Caso feliz.
2. Bordes: vacío, nulo, límites, duplicados.
3. Errores: excepciones, respuestas inválidas, timeouts.

## Dobles de prueba
- Mockeá solo los límites del sistema (red, reloj, disco, servicios externos).
- Preferí fakes en memoria a mocks con expectativas frágiles.

## Checklist
- [ ] El test falla si se revierte el cambio
- [ ] No depende del orden ni del reloj real
- [ ] Corre en menos de un segundo`,
    },
  },
  {
    id: 'skill-changelog', kind: 'skill', title: 'Changelog y release notes', blurb: 'Notas de versión a partir de los commits.',
    data: {
      name: 'release-notes',
      description: 'Generar changelog o notas de versión a partir del historial de git. Usar al preparar una release.',
      instructions: `# Release notes

1. Obtené los commits desde el último tag: \`git log $(git describe --tags --abbrev=0)..HEAD --oneline\`.
2. Agrupá por tipo: ✨ Novedades (feat), 🐛 Correcciones (fix), ⚡ Rendimiento (perf), 💥 Cambios incompatibles.
3. Reescribí cada entrada desde el punto de vista del usuario, no del código.
4. Omití refactors, tests y tareas internas salvo que afecten al usuario.
5. Sugerí el número de versión según SemVer (major si hay cambios incompatibles).`,
    },
  },
  {
    id: 'skill-migrations', kind: 'skill', title: 'Migraciones seguras', blurb: 'Cambios de esquema sin downtime.',
    data: {
      name: 'safe-migrations',
      description: 'Crear migraciones de base de datos seguras y reversibles. Usar al modificar el esquema.',
      instructions: `# Migraciones seguras

## Reglas
- Toda migración debe poder revertirse (escribí el down).
- Nunca borres ni renombres columnas en un solo paso: agregá la nueva, migrá datos, desplegá, y recién después eliminá la vieja.
- Índices en tablas grandes: creación concurrente si el motor lo permite.
- Separá cambios de esquema de migraciones de datos.

## Checklist
- [ ] Probada con \`up\` → \`down\` → \`up\` en una base local
- [ ] Compatible con la versión anterior del código desplegado
- [ ] Sin bloqueos largos sobre tablas con tráfico`,
    },
  },

  /* ---------- comandos ---------- */
  {
    id: 'cmd-commit', kind: 'command', title: '/commit', blurb: 'Crea un commit con mensaje convencional.', links: ['conventional-commits'],
    data: {
      name: 'commit', description: 'Crear un commit con los cambios actuales', argumentHint: '[mensaje o contexto opcional]',
      prompt: `1. Mirá \`git status\` y \`git diff\`.
2. Si hay cambios sin stagear que corresponden al mismo tema, agregalos; si hay temas mezclados, proponé separarlos.
3. Redactá el mensaje siguiendo Conventional Commits. Contexto adicional del usuario: $ARGUMENTS
4. Creá el commit y mostrá el hash y el resumen.`,
    },
  },
  {
    id: 'cmd-pr', kind: 'command', title: '/pr', blurb: 'Prepara la descripción de un pull request.',
    data: {
      name: 'pr', description: 'Preparar título y descripción de un pull request', argumentHint: '[rama base]',
      prompt: `Prepará un pull request de la rama actual contra $ARGUMENTS (por defecto main).

1. Revisá \`git log\` y \`git diff\` contra la rama base.
2. Escribí un título claro y una descripción con: qué cambia, por qué, cómo probarlo y riesgos.
3. Listá los tests agregados o modificados.
4. Si hay algo incompleto (TODOs, tests faltantes), señalalo al final.`,
    },
  },
  {
    id: 'cmd-review', kind: 'command', title: '/review', blurb: 'Revisión completa delegada al revisor.', links: ['code-reviewer'],
    data: {
      name: 'review', description: 'Revisar los cambios actuales o una rama', argumentHint: '[rama o archivos]',
      prompt: 'Revisá los cambios indicados ($ARGUMENTS; si no se indica nada, los cambios sin commitear) y devolvé los hallazgos ordenados por severidad.',
    },
  },
  {
    id: 'cmd-fix-issue', kind: 'command', title: '/fix-issue', blurb: 'Resuelve un issue de punta a punta.', links: ['debugger'],
    data: {
      name: 'fix-issue', description: 'Investigar y resolver un issue', argumentHint: '[número o descripción del issue]',
      prompt: `Resolvé el issue: $ARGUMENTS

1. Si es un número, leelo con \`gh issue view\`.
2. Reproducí el problema y encontrá la causa raíz.
3. Implementá la corrección mínima y agregá un test que lo cubra.
4. Corré los tests y el linter.
5. Resumí el cambio y sugerí un mensaje de commit que referencie el issue.`,
    },
  },
  {
    id: 'cmd-test', kind: 'command', title: '/test', blurb: 'Escribe tests para un archivo o módulo.', links: ['test-writer'],
    data: {
      name: 'test', description: 'Escribir tests para el código indicado', argumentHint: '[ruta o función]',
      prompt: 'Escribí tests para $ARGUMENTS cubriendo caso feliz, bordes y errores. Corrélos y reportá el resultado.',
    },
  },
  {
    id: 'cmd-explain', kind: 'command', title: '/explain', blurb: 'Explica cómo funciona una parte del código.',
    data: {
      name: 'explain', description: 'Explicar cómo funciona una parte del código', argumentHint: '[ruta, función o flujo]',
      prompt: `Explicá cómo funciona $ARGUMENTS.

- Empezá por el propósito en dos líneas.
- Seguí el flujo principal paso a paso citando archivo:línea.
- Señalá dependencias, efectos secundarios y partes no obvias.
- No modifiques archivos.`,
    },
  },

  /* ---------- reglas ---------- */
  {
    id: 'rule-minimal', kind: 'rule', title: 'Cambios mínimos', blurb: 'Hacer solo lo pedido, sin refactors de yapa.',
    data: {
      name: 'cambios-minimos', description: 'Limitar los cambios a lo pedido', alwaysApply: true, globs: '',
      content: `- Hacé solo lo que se pidió; si ves otras mejoras, mencionalas al final sin aplicarlas.
- No reformatees archivos enteros ni cambies nombres que no hacen falta.
- Seguí el estilo del código que rodea al cambio.`,
    },
  },
  {
    id: 'rule-secrets', kind: 'rule', title: 'Sin secretos', blurb: 'Nunca exponer claves ni datos sensibles.',
    data: {
      name: 'sin-secretos', description: 'Protección de secretos y datos sensibles', alwaysApply: true, globs: '',
      content: `- Nunca escribas claves, tokens ni contraseñas en el código, tests, logs o commits: usá variables de entorno.
- No leas ni muestres el contenido de archivos .env salvo que el usuario lo pida.
- Si encontrás un secreto expuesto, avisá de inmediato y recomendá rotarlo.`,
    },
  },
  {
    id: 'rule-tests', kind: 'rule', title: 'Tests obligatorios', blurb: 'Todo cambio de lógica lleva test.',
    data: {
      name: 'tests-obligatorios', description: 'Cada cambio de comportamiento incluye tests', alwaysApply: true, globs: '',
      content: `- Todo cambio de comportamiento lleva un test que falle sin el cambio.
- Corré los tests afectados antes de dar la tarea por terminada y reportá el resultado.
- No borres ni saltees tests que fallan para que pase la suite.`,
    },
  },
  {
    id: 'rule-ts', kind: 'rule', title: 'TypeScript estricto', blurb: 'Tipado sin atajos en archivos .ts/.tsx.',
    data: {
      name: 'typescript-estricto', description: 'Reglas de tipado para TypeScript', alwaysApply: false, globs: '**/*.ts, **/*.tsx',
      content: `- Prohibido \`any\`; usá \`unknown\` y estrechá el tipo.
- Nada de \`@ts-ignore\`; si es inevitable, \`@ts-expect-error\` con el motivo.
- Tipos de retorno explícitos en funciones exportadas.
- Preferí uniones discriminadas a flags booleanos combinados.`,
    },
  },

  /* ---------- MCP ---------- */
  {
    id: 'mcp-github', kind: 'mcp', title: 'GitHub', blurb: 'Issues, PRs y repos (servidor remoto oficial).',
    data: { name: 'github', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: 'Authorization=Bearer ${GITHUB_TOKEN}', command: '', args: '', env: '' },
  },
  {
    id: 'mcp-playwright', kind: 'mcp', title: 'Playwright', blurb: 'Controla un navegador para probar la app.',
    data: { name: 'playwright', transport: 'stdio', command: 'npx', args: '@playwright/mcp@latest', env: '' },
  },
  {
    id: 'mcp-context7', kind: 'mcp', title: 'Context7', blurb: 'Documentación actualizada de librerías.',
    data: { name: 'context7', transport: 'stdio', command: 'npx', args: '-y @upstash/context7-mcp', env: '' },
  },
  {
    id: 'mcp-sentry', kind: 'mcp', title: 'Sentry', blurb: 'Errores de producción (remoto, con OAuth).',
    data: { name: 'sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp', command: '', args: '', env: '' },
  },

  /* ---------- hooks ---------- */
  {
    id: 'hook-prettier', kind: 'hook', title: 'Formatear con Prettier', blurb: 'Corre Prettier después de cada edición.',
    data: { name: 'prettier', description: 'Mantiene el formato consistente sin que el agente tenga que acordarse.', command: 'npx prettier --write .' },
  },
  {
    id: 'hook-eslint', kind: 'hook', title: 'Arreglar con ESLint', blurb: 'Corre ESLint --fix después de cada edición.',
    data: { name: 'eslint', description: 'Corrige automáticamente lo que ESLint puede arreglar solo.', command: 'npx eslint --fix .' },
  },
];

export const PACKS: Pack[] = [
  {
    id: 'pack-pr', title: 'Flujo de PR', blurb: 'Revisor + /commit + /pr + /review + Conventional Commits.',
    items: ['agent-reviewer', 'skill-commits', 'cmd-commit', 'cmd-pr', 'cmd-review'],
  },
  {
    id: 'pack-quality', title: 'Calidad', blurb: 'Escritor de tests + depurador + /test + /fix-issue + reglas base.',
    items: ['agent-tests', 'agent-debugger', 'skill-testing', 'cmd-test', 'cmd-fix-issue', 'rule-tests', 'rule-minimal'],
  },
  {
    id: 'pack-safe', title: 'Seguridad', blurb: 'Auditor de seguridad + regla de secretos.',
    items: ['agent-security', 'rule-secrets'],
  },
];

/** Nombres ya presentes en el lienzo, por tipo. */
export function existingNames(nodes: FlowNode[]) {
  return new Set(nodes.filter((n) => n.data.d.kind !== 'project').map((n) => `${n.data.d.kind}:${slug(n.data.d.name)}`));
}
export const templateKey = (t: Template) => `${t.kind}:${slug(String(t.data.name))}`;

/**
 * Inserta plantillas (salteando las que ya están) y crea sus conexiones con nodos existentes
 * o del mismo lote. Es un solo paso de deshacer.
 */
export function applyTemplates(list: Template[]): string[] {
  const st = useStore.getState();
  const nodes = [...st.nodes];
  const edges: Edge[] = [...st.edges];
  const have = existingNames(nodes);
  const added: FlowNode[] = [];
  for (const t of list) {
    if (have.has(templateKey(t))) continue;
    const node: FlowNode = {
      id: `${t.kind}-${uid()}`, type: 'card', position: freeSpot(nodes, t.kind),
      data: { d: { ...emptyData(t.kind), ...t.data, kind: t.kind } as NodeData },
    };
    nodes.push(node);
    added.push(node);
    have.add(templateKey(t));
  }
  for (const t of list) {
    const from = nodes.find((n) => `${n.data.d.kind}:${slug(n.data.d.name)}` === templateKey(t));
    for (const name of t.links ?? []) {
      const to = nodes.find((n) => n.data.d.kind !== 'project' && slug(n.data.d.name) === slug(name));
      if (from && to && VALID_LINKS.some(([a, b]) => a === from.data.d.kind && b === to.data.d.kind) && !edges.some((e) => e.source === from.id && e.target === to.id))
        edges.push({ id: `e-${from.id}-${to.id}`, source: from.id, target: to.id, animated: true });
    }
  }
  if (added.length || edges.length !== st.edges.length) st.setGraph({ nodes, edges });
  return added.map((n) => n.id);
}
