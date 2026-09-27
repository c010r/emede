import type { Provider } from './providers';
import type { StackItem } from './stack';

export type NodeKind = 'project' | 'agent' | 'skill' | 'command' | 'rule' | 'mcp';

/** Herramientas genéricas; cada adaptador las traduce al vocabulario de su plataforma. */
export const TOOLS = ['read', 'edit', 'write', 'bash', 'search', 'web'] as const;
export type Tool = (typeof TOOLS)[number];


/** Nivel de modelo genérico; se mapea por plataforma. */
export type ModelTier = 'inherit' | 'fast' | 'balanced' | 'powerful';

export interface ProjectData {
  kind: 'project';
  name: string;
  description: string;
  /** Tecnologías elegidas en el selector visual. */
  stackItems: StackItem[];
  /** Notas libres sobre el stack (versiones, particularidades). */
  stack: string;
  dev: string;
  build: string;
  test: string;
  lint: string;
  structure: string;
  conventions: string;
  /** Canario de contexto: marca que el agente debe repetir; si desaparece, perdió las instrucciones. */
  canary?: Canary;
  /** Permisos y hooks que se aplican técnicamente en cada herramienta. */
  guards?: Guards;
  /** Plan del proyecto (generado por IA u otro); si existe se escribe en docs/PLAN.md. */
  plan?: string;
  /** Memoria de la reparación de problemas (no se escribe en ningún archivo generado). */
  review?: Review;
  /** Última sincronización con el vault de Obsidian. */
  vault?: VaultSync;
  /** Casos de la prueba de enrutamiento (no se escriben en ningún archivo generado). */
  routing?: RoutingCase[];
  /** Cuerpo principal del archivo de memoria (CLAUDE.md / AGENTS.md / GEMINI.md…). */
  memory: string;
}

export interface AgentData {
  kind: 'agent';
  name: string;
  description: string;
  model: ModelTier;
  tools: Tool[];
  prompt: string;
}

export interface SkillData {
  kind: 'skill';
  name: string;
  description: string;
  instructions: string;
}

export interface CommandData {
  kind: 'command';
  name: string;
  description: string;
  argumentHint: string;
  /** Usa $ARGUMENTS como marcador; cada adaptador lo traduce. */
  prompt: string;
}

export interface RuleData {
  kind: 'rule';
  name: string;
  description: string;
  /** Globs separados por coma. Vacío = aplica siempre. */
  globs: string;
  alwaysApply: boolean;
  content: string;
}

export interface McpData {
  kind: 'mcp';
  name: string;
  transport: 'stdio' | 'http';
  command: string;
  args: string;
  url: string;
  /** KEY=valor por línea. Los valores secretos se escriben como referencia a variables de entorno. */
  env: string;
  /** Encabezados HTTP (servidores remotos), "Nombre=valor" por línea. */
  headers?: string;
}

export type NodeData = ProjectData | AgentData | SkillData | CommandData | RuleData | McpData;

export const TARGETS = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
} as const;
export type Target = keyof typeof TARGETS;

export type { Lang } from './i18n/langs';
import type { Lang } from './i18n/langs';

export interface Settings {
  /** Proveedor de IA elegido. */
  provider: Provider;
  /** Clave de cada proveedor (se conservan todas al cambiar de proveedor). */
  keys: Partial<Record<Provider, string>>;
  /** Modelo elegido en cada proveedor. */
  models: Partial<Record<Provider, string>>;
  /** URL base del proveedor "compatible con OpenAI" (OpenRouter, Ollama…). */
  baseUrl?: string;
  /** Idioma del contenido generado (archivos para los agentes). */
  lang: Lang;
  /** Idioma de la interfaz. */
  uiLang?: Lang;
  targets: Target[];
  /** Carpeta del vault de Obsidian donde se crean los espejos de los proyectos. */
  vaultFolder?: string;
  /** Ruta del vault de Obsidian en el disco (la usa el servidor local). */
  vaultPath?: string;
  /** Ya se pasó por la pantalla de instalación (idioma, IA y Obsidian). */
  setupDone?: boolean;
}

export type FileMap = Record<string, string>;

export interface Canary {
  enabled: boolean;
  /** Marca única que el agente escribe al inicio de cada respuesta, p. ej. "🐤 CANARIO-7F3K". */
  phrase: string;
  /** También los subagentes empiezan sus informes con la marca. */
  agents: boolean;
  /** marker: una marca/código al inicio de cada respuesta · name: el agente se dirige al usuario por su nombre. */
  style?: 'marker' | 'name';
}

/** Estado del espejo en Obsidian: dónde está y cómo estaba cada nota al sincronizar. */
export interface VaultSync {
  /** Carpeta del proyecto dentro del vault, p. ej. "emede/mi-proyecto". */
  path: string;
  /**
   * Por pieza (id del nodo, "plan" o "canvas"): ruta de la nota y huellas del contenido al sincronizar.
   * `vault` detecta ediciones en Obsidian; `emede`, cambios hechos en emede desde entonces.
   */
  notes: Record<string, { path: string; vault: string; emede: string }>;
}

/** Lo que ya se decidió sobre los problemas, para que la reparación y la auditoría no vuelvan a marcarlo. */
export interface RoutingCase {
  id: string;
  request: string;
  /** Pieza que debería elegirse ("agent:revisor", "skill:pruebas") o "none" si ninguna aplica. */
  expect: string;
}

export interface Review {
  /** Claves de problemas que el usuario decidió dejar así. */
  ignored: string[];
  /** Hallazgos de auditoría ya tratados (corregidos o decididos), en texto, para no repetirlos. */
  treated: string[];
}

/** Guardarraíles: lo que se tiene que cumplir se aplica con permisos y hooks, no solo con instrucciones. */
export interface Guards {
  enabled: boolean;
  /** Rutas que el agente no puede leer ni editar (globs, una por línea). */
  protectPaths: string;
  /** Comandos prohibidos (prefijos, uno por línea). */
  denyCommands: string;
  /** Comandos que requieren confirmación. */
  askCommands: string;
  /** Comandos que se aprueban solos (además de los de test y lint del proyecto). */
  allowCommands: string;
  /** Se ejecuta después de cada edición (formateador). */
  formatCommand: string;
  /** El agente no puede terminar si fallan los tests del proyecto. */
  testGate: boolean;
  /** Sandbox de Codex. */
  sandbox: 'read-only' | 'workspace-write';
  /** Acceso a la red dentro del sandbox. */
  network: boolean;
}
